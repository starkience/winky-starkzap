'use client';

/**
 * Hook to interact with the WinkyBlink contract via the backend API.
 *
 * 1 blink = 1 transaction via Privy + AVNU paymaster (auto-signed, zero gas).
 * The backend handles signing via Privy Wallet API and paymaster submission.
 */

import { useCallback, useState, useRef } from 'react';
import { RpcProvider, hash } from 'starknet';
import { API_URL, WINKY_CONTRACT_ADDRESS, NETWORK } from '@/lib/constants';

const BLINK_EVENT_KEY = hash.getSelectorFromName('Blink');
const EVENT_START_BLOCK: Record<string, number> = {
  mainnet: 6_938_534,
  sepolia: 0,
  devnet: 0,
};

const RPC_URLS: Record<string, string> = {
  mainnet: 'https://free-rpc.nethermind.io/mainnet-juno/rpc/v0_7',
  sepolia: 'https://free-rpc.nethermind.io/sepolia-juno/rpc/v0_7',
  devnet: 'http://localhost:5050',
};

function getReadProvider(): RpcProvider {
  return new RpcProvider({ nodeUrl: RPC_URLS[NETWORK] || RPC_URLS.sepolia });
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

export function useWinkyContract({ walletId, walletAddress, getAccessToken, isAuthenticated }: UseWinkyContractOpts) {
  const [txLog, setTxLog] = useState<BlinkTransaction[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const isProcessingRef = useRef(false);

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

  const recordBlink = useCallback(async (blinkNumber: number, twitterUsername?: string): Promise<BlinkTransaction> => {
    const txId = `blink-${blinkNumber}-${Date.now()}`;

    if (!isAuthenticated || !walletId) {
      console.warn(`[recordBlink] Not authenticated or no walletId`);
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

    if (isProcessingRef.current) {
      const skippedTx: BlinkTransaction = {
        id: txId,
        status: 'skipped',
        error: 'Previous TX still processing',
        blinkNumber,
        timestamp: Date.now(),
      };
      addToLog(skippedTx);
      return skippedTx;
    }

    isProcessingRef.current = true;
    setIsProcessing(true);

    const pendingTx: BlinkTransaction = {
      id: txId,
      status: 'pending',
      blinkNumber,
      timestamp: Date.now(),
    };
    addToLog(pendingTx);
    setPendingCount((c) => c + 1);

    try {
      console.log(`[recordBlink] Executing TX for blink #${blinkNumber}...`);

      const userJwt = await getAccessToken();
      if (!userJwt) throw new Error('Unable to get auth token. Please re-login.');

      const resp = await fetch(`${API_URL}/privy/record-blink`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userJwt}`,
        },
        body: JSON.stringify({ walletId, wait: false }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      const txHash = data?.transactionHash;
      console.log(`[recordBlink] SUCCESS #${blinkNumber}: ${txHash}`);

      updateInLog(txId, { status: 'success', hash: txHash });
      setPendingCount((c) => Math.max(0, c - 1));
      isProcessingRef.current = false;
      setIsProcessing(false);

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
      const errorMsg = err.message || 'Transaction failed';
      console.error(`[recordBlink] FAIL #${blinkNumber}:`, errorMsg);

      const shortError = errorMsg.length > 100 ? errorMsg.substring(0, 100) + '...' : errorMsg;
      updateInLog(txId, { status: 'error', error: shortError });

      setPendingCount((c) => Math.max(0, c - 1));
      isProcessingRef.current = false;
      setIsProcessing(false);

      return { ...pendingTx, status: 'error', error: errorMsg };
    }
  }, [isAuthenticated, walletId, walletAddress, getAccessToken, addToLog, updateInLog]);

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
