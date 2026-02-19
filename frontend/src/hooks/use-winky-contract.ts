'use client';

/**
 * Hook to interact with the WinkyBlink contract
 * 1 blink = 1 transaction via Cartridge Controller (auto-approved by session policies)
 *
 * Uses account.execute() directly instead of useSendTransaction,
 * which hangs with the Cartridge Controller connector.
 */

import { useCallback, useState, useRef } from 'react';
import { useAccount, useProvider } from '@starknet-react/core';
import { hash } from 'starknet';
import { WINKY_CONTRACT_ADDRESS, NETWORK } from '@/lib/constants';

const BLINK_EVENT_KEY = hash.getSelectorFromName('Blink');
const EVENT_START_BLOCK: Record<string, number> = {
  mainnet: 6_938_534,
  sepolia: 0,
  devnet: 0,
};

// No limit on transaction log entries

export interface BlinkTransaction {
  id: string;
  status: 'pending' | 'success' | 'error' | 'skipped';
  hash?: string;
  error?: string;
  blinkNumber: number;
  timestamp: number;
}

export function useWinkyContract() {
  const { isConnected, account, address } = useAccount();
  const { provider } = useProvider();
  const [txLog, setTxLog] = useState<BlinkTransaction[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  // Use a ref for the processing lock - refs update instantly, state doesn't
  const isProcessingRef = useRef(false);

  // Add transaction to log
  const addToLog = useCallback((tx: BlinkTransaction) => {
    setTxLog((prev) => {
      return [tx, ...prev.filter(t => t.id !== tx.id)];
    });
  }, []);

  // Update transaction in log
  const updateInLog = useCallback((id: string, updates: Partial<BlinkTransaction>) => {
    setTxLog((prev) =>
      prev.map(tx => tx.id === id ? { ...tx, ...updates } : tx)
    );
  }, []);

  // Record a blink on-chain using account.execute() directly
  const recordBlink = useCallback(async (blinkNumber: number, twitterUsername?: string): Promise<BlinkTransaction> => {
    const txId = `blink-${blinkNumber}-${Date.now()}`;

    if (!isConnected || !account) {
      console.warn(`[recordBlink] Not connected or no account`);
      const tx: BlinkTransaction = {
        id: txId,
        status: 'error',
        error: 'Wallet not connected',
        blinkNumber,
        timestamp: Date.now(),
      };
      addToLog(tx);
      return tx;
    }

    // If already processing, skip this blink to avoid nonce issues
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
      console.log(`[recordBlink] Account address: ${account.address}`);
      console.log(`[recordBlink] Account chainId: ${(account as any).chainId || 'unknown'}`);
      console.log(`[recordBlink] Account channel: ${(account as any).channel?.nodeUrl || (account as any).provider?.channel?.nodeUrl || 'unknown'}`);
      console.log(`[recordBlink] Contract address: ${WINKY_CONTRACT_ADDRESS}`);

      // Use account.execute() directly - works with Cartridge Controller
      // Session policies auto-approve this call (no popup)
      const response = await account.execute([
        {
          contractAddress: WINKY_CONTRACT_ADDRESS,
          entrypoint: 'record_blink',
          calldata: [],
        },
      ]);

      const txHash = typeof response === 'object' && 'transaction_hash' in response
        ? response.transaction_hash
        : String(response);

      console.log(`[recordBlink] SUCCESS #${blinkNumber}: ${txHash}`);

      updateInLog(txId, { status: 'success', hash: txHash });
      setPendingCount((c) => Math.max(0, c - 1));
      isProcessingRef.current = false;
      setIsProcessing(false);

      // Broadcast to live feed via Pusher (fire-and-forget)
      fetch('/api/blink-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: account.address,
          txHash,
          userTotal: blinkNumber,
          twitterUsername: twitterUsername || undefined,
        }),
      }).catch(() => { /* non-fatal */ });

      return { ...pendingTx, status: 'success', hash: txHash };
    } catch (err: any) {
      const errorMsg = err.message || 'Transaction failed';
      console.error(`[recordBlink] FAIL #${blinkNumber}:`, errorMsg);
      console.error(`[recordBlink] Full error:`, JSON.stringify(err, Object.getOwnPropertyNames(err)));
      console.error(`[recordBlink] Error code:`, err.code);
      console.error(`[recordBlink] Error data:`, err.data);

      const shortError = errorMsg.length > 100 ? errorMsg.substring(0, 100) + '...' : errorMsg;
      updateInLog(txId, { status: 'error', error: shortError });

      setPendingCount((c) => Math.max(0, c - 1));
      isProcessingRef.current = false;
      setIsProcessing(false);

      return { ...pendingTx, status: 'error', error: errorMsg };
    }
  }, [isConnected, account, addToLog, updateInLog]);

  // Clear transaction log
  const clearLog = useCallback(() => {
    setTxLog([]);
  }, []);

  /** Read the user's blink count from events since the launch block */
  const getTotalBlinks = useCallback(async (): Promise<number> => {
    if (!address || !provider) return 0;
    try {
      const startBlock = EVENT_START_BLOCK[NETWORK] ?? 0;
      let total = 0;
      let continuationToken: string | undefined = undefined;

      do {
        const params: any = {
          address: WINKY_CONTRACT_ADDRESS,
          keys: [[BLINK_EVENT_KEY], [address]],
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
  }, [address, provider]);

  return {
    recordBlink,
    getTotalBlinks,
    txLog,
    clearLog,
    isPending: pendingCount > 0,
    isProcessing,
    pendingCount,
    isReady: isConnected && !!account,
  };
}
