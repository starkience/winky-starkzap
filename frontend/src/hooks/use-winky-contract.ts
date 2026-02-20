'use client';

/**
 * Hook to interact with the WinkyBlink contract via the backend API.
 *
 * 1 blink = 1 transaction via Privy + AVNU paymaster (auto-signed, zero gas).
 * The backend handles signing via Privy Wallet API and paymaster submission.
 */

import { useCallback, useState, useRef } from 'react';
import { RpcProvider, hash } from 'starknet';
import { API_URL, WINKY_CONTRACT_ADDRESS, NETWORK, RPC_URL } from '@/lib/constants';

const BLINK_EVENT_KEY = hash.getSelectorFromName('Blink');
const EVENT_START_BLOCK: Record<string, number> = {
  mainnet: 6_976_636,
  sepolia: 0,
  devnet: 0,
};

function getReadProvider(): RpcProvider {
  return new RpcProvider({ nodeUrl: RPC_URL });
}

export interface BlinkTransaction {
  id: string;
  status: 'pending' | 'success' | 'error' | 'skipped';
  hash?: string;
  error?: string;
  blinkNumber: number;
  timestamp: number;
}

interface UseWinkyContractOpts {
  walletId: string | null;
  walletAddress: string | null;
  getAccessToken: () => Promise<string | null>;
  isAuthenticated: boolean;
}

const TX_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_TXS = 3;

export function useWinkyContract({ walletId, walletAddress, getAccessToken, isAuthenticated }: UseWinkyContractOpts) {
  const [txLog, setTxLog] = useState<BlinkTransaction[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const inflightRef = useRef(0);
  const cachedJwtRef = useRef<{ token: string; expires: number } | null>(null);

  const addToLog = useCallback((tx: BlinkTransaction) => {
    setTxLog((prev) => {
      return [tx, ...prev.filter(t => t.id !== tx.id)];
    });
  }, []);

  const updateInLog = useCallback((id: string, updates: Partial<BlinkTransaction>) => {
    setTxLog((prev) =>
      prev.map(tx => tx.id === id ? { ...tx, ...updates } : tx)
    );
  }, []);

  const getCachedToken = useCallback(async (): Promise<string | null> => {
    const now = Date.now();
    if (cachedJwtRef.current && cachedJwtRef.current.expires > now) {
      return cachedJwtRef.current.token;
    }
    const token = await getAccessToken();
    if (token) {
      cachedJwtRef.current = { token, expires: now + 55_000 };
    }
    return token;
  }, [getAccessToken]);

  const executeBlink = useCallback(async (blinkNumber: number, twitterUsername?: string): Promise<BlinkTransaction> => {
    const txId = `blink-${blinkNumber}-${Date.now()}`;

    const pendingTx: BlinkTransaction = {
      id: txId,
      status: 'pending',
      blinkNumber,
      timestamp: Date.now(),
    };
    addToLog(pendingTx);
    setPendingCount((c) => c + 1);

    try {
      const userJwt = await getCachedToken();
      if (!userJwt) throw new Error('Unable to get auth token. Please re-login.');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TX_TIMEOUT_MS);

      const resp = await fetch(`${API_URL}/privy/record-blink`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userJwt}`,
        },
        body: JSON.stringify({ walletId, wait: false }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      const txHash = data?.transactionHash;

      updateInLog(txId, { status: 'success', hash: txHash });
      setPendingCount((c) => Math.max(0, c - 1));

      fetch('/api/blink-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: walletAddress,
          txHash,
          userTotal: blinkNumber,
          twitterUsername: twitterUsername || undefined,
        }),
      }).catch(() => {});

      return { ...pendingTx, status: 'success', hash: txHash };
    } catch (err: any) {
      const errorMsg = err.name === 'AbortError'
        ? 'Transaction timed out'
        : (err.message || 'Transaction failed');
      console.error(`[recordBlink] FAIL #${blinkNumber}:`, errorMsg);

      const shortError = errorMsg.length > 100 ? errorMsg.substring(0, 100) + '...' : errorMsg;
      updateInLog(txId, { status: 'error', error: shortError });
      setPendingCount((c) => Math.max(0, c - 1));

      return { ...pendingTx, status: 'error', error: errorMsg };
    }
  }, [walletId, walletAddress, getCachedToken, addToLog, updateInLog]);

  const recordBlink = useCallback(async (blinkNumber: number, twitterUsername?: string): Promise<BlinkTransaction> => {
    const txId = `blink-${blinkNumber}-${Date.now()}`;

    if (!isAuthenticated || !walletId) {
      const tx: BlinkTransaction = {
        id: txId,
        status: 'error',
        error: 'Not logged in or wallet not created',
        blinkNumber,
        timestamp: Date.now(),
      };
      addToLog(tx);
      return tx;
    }

    if (inflightRef.current >= MAX_CONCURRENT_TXS) {
      const skippedTx: BlinkTransaction = {
        id: txId,
        status: 'skipped',
        error: `${MAX_CONCURRENT_TXS} TXs in flight`,
        blinkNumber,
        timestamp: Date.now(),
      };
      addToLog(skippedTx);
      return skippedTx;
    }

    inflightRef.current++;
    setIsProcessing(true);

    const result = await executeBlink(blinkNumber, twitterUsername);

    inflightRef.current--;
    if (inflightRef.current === 0) setIsProcessing(false);

    return result;
  }, [isAuthenticated, walletId, addToLog, executeBlink]);

  const clearLog = useCallback(() => {
    setTxLog([]);
  }, []);

  const getTotalBlinks = useCallback(async (): Promise<number> => {
    if (!walletAddress) return 0;
    try {
      const provider = getReadProvider();
      const startBlock = EVENT_START_BLOCK[NETWORK] ?? 0;
      let total = 0;
      let continuationToken: string | undefined = undefined;

      do {
        const params: any = {
          address: WINKY_CONTRACT_ADDRESS,
          keys: [[BLINK_EVENT_KEY], [walletAddress]],
          chunk_size: 1000,
        };
        if (startBlock > 0) {
          params.from_block = { block_number: startBlock };
        }
        if (continuationToken) {
          params.continuation_token = continuationToken;
        }

        const response = await provider.getEvents(params);

        for (const event of response.events) {
          const userTotal = Number(BigInt(event.data[1]));
          if (userTotal > total) total = userTotal;
        }

        continuationToken = response.continuation_token;
      } while (continuationToken);

      return total;
    } catch (err) {
      console.error('[getTotalBlinks] Failed:', err);
      return 0;
    }
  }, [walletAddress]);

  return {
    recordBlink,
    getTotalBlinks,
    txLog,
    clearLog,
    isPending: pendingCount > 0,
    isProcessing,
    pendingCount,
    isReady: isAuthenticated && !!walletId,
  };
}
