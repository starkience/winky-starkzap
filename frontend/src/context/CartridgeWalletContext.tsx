'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { WalletInterface } from 'starkzap';
import { NETWORK, STORAGE_KEYS, CONTROLLER_POLICIES } from '@/lib/constants';

interface CartridgeWalletState {
  wallet: WalletInterface | null;
  address: string | null;
  username: string | null;
  loading: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const CartridgeWalletContext = createContext<CartridgeWalletState | null>(null);

export function useCartridgeWallet(): CartridgeWalletState {
  const ctx = useContext(CartridgeWalletContext);
  if (!ctx) throw new Error('useCartridgeWallet must be used within CartridgeWalletProvider');
  return ctx;
}

/**
 * Wraps the raw Controller account to conform to WalletInterface.
 * The Controller's execute() handles session keys and the Slot paymaster
 * internally via the keychain — no separate paymaster call is needed.
 */
function createControllerWallet(
  controller: any,
  account: any,
  addr: string,
): WalletInterface {
  return {
    get address() { return addr; },
    async execute(calls: any[], _options?: any) {
      const result = await account.execute(calls);
      return {
        hash: result.transaction_hash,
        async wait() {},
      };
    },
    async isDeployed() { return true; },
    async ensureReady() {},
    getController() { return controller; },
    async username() {
      try { return await controller.username?.() ?? undefined; } catch { return undefined; }
    },
    async disconnect() {
      try { await controller.disconnect(); } catch {}
    },
  } as any;
}

let controllerReadyPromise: Promise<any> | null = null;
let cachedController: any = null;

async function createController(): Promise<any> {
  const { default: Controller, toSessionPolicies } = await import('@cartridge/controller');

  const policies = CONTROLLER_POLICIES.map(p => ({
    target: p.target,
    method: p.method,
  }));

  const chainId = NETWORK === 'mainnet'
    ? '0x534e5f4d41494e'
    : '0x534e5f5345504f4c4941';

  const controller = new Controller({
    defaultChainId: chainId as any,
    policies: toSessionPolicies(policies),
    slot: 'winky-pm',
  });

  let waited = 0;
  const maxWait = 20000;
  let pollMs = 100;
  while (!controller.isReady() && waited < maxWait) {
    const sleepMs = Math.min(pollMs, maxWait - waited);
    await new Promise(r => setTimeout(r, sleepMs));
    waited += sleepMs;
    pollMs = Math.min(pollMs * 1.5, 1000);
  }

  if (!controller.isReady()) {
    console.warn('[CartridgeWallet] Controller did not become ready within timeout');
    return null;
  }

  return controller;
}

function preInitController() {
  if (controllerReadyPromise || typeof window === 'undefined') return controllerReadyPromise;

  controllerReadyPromise = createController().then(ctrl => {
    if (ctrl) {
      cachedController = ctrl;
    } else {
      controllerReadyPromise = null;
    }
    return ctrl;
  }).catch(err => {
    console.error('[CartridgeWallet] preInit failed:', err);
    controllerReadyPromise = null;
    return null;
  });

  return controllerReadyPromise;
}

export function CartridgeWalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletInterface | null>(null);
  const [address, setAddress] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEYS.controllerAddress);
  });
  const [username, setUsername] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEYS.controllerUsername);
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectingRef = useRef(false);
  const controllerRef = useRef<any>(null);

  useEffect(() => {
    preInitController();
  }, []);

  const connect = useCallback(async () => {
    if (connectingRef.current || wallet) return;
    connectingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      let controller = cachedController;
      if (!controller || !controller.isReady()) {
        cachedController = null;
        controllerReadyPromise = null;
        controller = await createController();
        if (controller) {
          cachedController = controller;
        }
      }
      if (!controller || !controller.isReady()) {
        throw new Error('Controller failed to initialize. Please refresh the page and try again.');
      }
      controllerRef.current = controller;

      const connectedAccount = await controller.connect();
      if (!connectedAccount || typeof connectedAccount.address !== 'string') {
        throw new Error('Connection cancelled or failed. Please try again.');
      }

      const addr = connectedAccount.address;
      const w = createControllerWallet(controller, connectedAccount, addr);

      setWallet(w);
      setAddress(addr);
      localStorage.setItem(STORAGE_KEYS.controllerAddress, addr);

      let resolvedName: string | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          resolvedName = await controller.username?.();
        } catch {}
        if (resolvedName) break;
        await new Promise(r => setTimeout(r, 500));
      }
      if (resolvedName) {
        setUsername(resolvedName);
        localStorage.setItem(STORAGE_KEYS.controllerUsername, resolvedName);
      }
    } catch (err: any) {
      const msg = err?.message || 'Controller connection failed';
      if (!msg.includes('User aborted') && !msg.includes('cancelled') && !msg.includes('CANCELED')) {
        setError(msg);
      }
      console.error('[CartridgeWallet] connect error:', msg);
    } finally {
      setLoading(false);
      connectingRef.current = false;
    }
  }, [wallet]);

  const disconnect = useCallback(() => {
    const ctrl = controllerRef.current;
    controllerRef.current = null;
    cachedController = null;
    controllerReadyPromise = null;

    setWallet(null);
    setAddress(null);
    setUsername(null);
    setError(null);
    try {
      localStorage.removeItem(STORAGE_KEYS.controllerAddress);
      localStorage.removeItem(STORAGE_KEYS.controllerUsername);
    } catch {}

    if (ctrl) {
      try { ctrl.disconnect(); } catch {}
    }
  }, []);

  return (
    <CartridgeWalletContext.Provider
      value={{ wallet, address, username, loading, error, connect, disconnect }}
    >
      {children}
    </CartridgeWalletContext.Provider>
  );
}
