'use client';

import { useCallback, useState, useRef } from 'react';
import { RpcProvider } from 'starknet';
import type { WalletInterface } from 'starkzap';
import {
  ESCROW_CONTRACT_ADDRESS,
  TOKENS,
  USDC_DECIMALS,
  RPC_URL,
  VOYAGER_TX_URL,
} from '@/lib/constants';

export type DuelStatus = 'created' | 'joined' | 'resolved' | 'draw' | 'cancelled';

export interface DuelInfo {
  id: number;
  player1: string;
  player2: string;
  stake: bigint;
  status: DuelStatus;
}

export interface DuelTxResult {
  duelId: number;
  txHash: string;
  voyagerUrl: string;
}

const STATUS_MAP: Record<number, DuelStatus> = {
  0: 'created',
  1: 'joined',
  2: 'resolved',
  3: 'draw',
  4: 'cancelled',
};

function usdcToU256(dollars: number): [string, string] {
  const raw = BigInt(Math.round(dollars * 10 ** USDC_DECIMALS));
  const mask = (BigInt(1) << BigInt(128)) - BigInt(1);
  const low = (raw & mask).toString();
  const high = (raw >> BigInt(128)).toString();
  return [low, high];
}

function getProvider(): RpcProvider {
  return new RpcProvider({ nodeUrl: RPC_URL });
}

interface UseEscrowOpts {
  wallet: WalletInterface | null;
  walletAddress: string | null;
}

export function useEscrow({ wallet, walletAddress }: UseEscrowOpts) {
  const [isCreating, setIsCreating] = useState(false);
  const [lastTx, setLastTx] = useState<DuelTxResult | null>(null);
  const [escrowError, setEscrowError] = useState<string | null>(null);
  const activeDuelIdRef = useRef<number | null>(null);

  const createDuel = useCallback(async (stakeDollars: number): Promise<DuelTxResult | null> => {
    if (!wallet || !ESCROW_CONTRACT_ADDRESS) {
      setEscrowError('Wallet not connected or escrow not configured');
      return null;
    }

    setIsCreating(true);
    setEscrowError(null);

    try {
      const [stakeLow, stakeHigh] = usdcToU256(stakeDollars);

      const tx = await wallet.execute(
        [
          {
            contractAddress: TOKENS.USDC,
            entrypoint: 'approve',
            calldata: [ESCROW_CONTRACT_ADDRESS, stakeLow, stakeHigh],
          },
          {
            contractAddress: ESCROW_CONTRACT_ADDRESS,
            entrypoint: 'create_duel',
            calldata: [stakeLow, stakeHigh],
          },
        ],
        { feeMode: 'sponsored' },
      );

      const txHash = tx.hash;
      const voyagerUrl = VOYAGER_TX_URL ? `${VOYAGER_TX_URL}/${txHash}` : '';

      const provider = getProvider();
      const count = await provider.callContract({
        contractAddress: ESCROW_CONTRACT_ADDRESS,
        entrypoint: 'get_duel_count',
        calldata: [],
      });
      const duelId = Number(BigInt(count[0] || '1')) - 1;
      activeDuelIdRef.current = duelId;

      const result: DuelTxResult = { duelId, txHash, voyagerUrl };
      setLastTx(result);
      return result;
    } catch (err: any) {
      const raw = err.message || 'Failed to create duel';
      console.error('[createDuel]', raw);

      const isInsufficientFunds =
        raw.includes('u256_sub Overflow') || raw.includes('insufficient') || raw.includes('balance');
      const msg = isInsufficientFunds
        ? 'INSUFFICIENT_USDC'
        : raw.length > 120 ? raw.slice(0, 120) + '\u2026' : raw;

      setEscrowError(msg);
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [wallet]);

  const getDuel = useCallback(async (duelId: number): Promise<DuelInfo | null> => {
    try {
      const provider = getProvider();
      const result = await provider.callContract({
        contractAddress: ESCROW_CONTRACT_ADDRESS,
        entrypoint: 'get_duel',
        calldata: [duelId.toString()],
      });

      const player1 = result[0] || '0x0';
      const player2 = result[1] || '0x0';
      const stakeLow = BigInt(result[2] || '0');
      const stakeHigh = BigInt(result[3] || '0');
      const stake = stakeLow + (stakeHigh << BigInt(128));
      const status = STATUS_MAP[Number(result[4] || '0')] || 'created';

      return { id: duelId, player1, player2, stake, status };
    } catch (err: any) {
      console.error('[getDuel]', err.message);
      return null;
    }
  }, []);

  const getDuelCount = useCallback(async (): Promise<number> => {
    try {
      const provider = getProvider();
      const result = await provider.callContract({
        contractAddress: ESCROW_CONTRACT_ADDRESS,
        entrypoint: 'get_duel_count',
        calldata: [],
      });
      return Number(BigInt(result[0] || '0'));
    } catch {
      return 0;
    }
  }, []);

  const getUsdcBalance = useCallback(async (): Promise<number> => {
    if (!walletAddress) return 0;
    try {
      const provider = getProvider();
      const result = await provider.callContract({
        contractAddress: TOKENS.USDC,
        entrypoint: 'balanceOf',
        calldata: [walletAddress],
      });
      const low = BigInt(result[0] || '0');
      const high = BigInt(result[1] || '0');
      const raw = low + (high << BigInt(128));
      return Number(raw) / 10 ** USDC_DECIMALS;
    } catch {
      return 0;
    }
  }, [walletAddress]);

  const [isJoining, setIsJoining] = useState(false);

  const joinDuel = useCallback(async (duelId: number, stakeDollars: number): Promise<{ txHash: string } | null> => {
    if (!wallet || !ESCROW_CONTRACT_ADDRESS) {
      setEscrowError('Wallet not connected or escrow not configured');
      return null;
    }

    setIsJoining(true);
    setEscrowError(null);

    try {
      const [stakeLow, stakeHigh] = usdcToU256(stakeDollars);

      const tx = await wallet.execute(
        [
          {
            contractAddress: TOKENS.USDC,
            entrypoint: 'approve',
            calldata: [ESCROW_CONTRACT_ADDRESS, stakeLow, stakeHigh],
          },
          {
            contractAddress: ESCROW_CONTRACT_ADDRESS,
            entrypoint: 'join_duel',
            calldata: [duelId.toString()],
          },
        ],
        { feeMode: 'sponsored' },
      );

      return { txHash: tx.hash };
    } catch (err: any) {
      const raw = err.message || 'Failed to join duel';
      console.error('[joinDuel]', raw);

      const isInsufficientFunds =
        raw.includes('u256_sub Overflow') || raw.includes('insufficient') || raw.includes('balance');
      const isDuelNotOpen = raw.includes('Duel not open');
      setEscrowError(
        isDuelNotOpen ? 'DUEL_NOT_OPEN' :
        isInsufficientFunds ? 'INSUFFICIENT_USDC' :
        raw.length > 120 ? raw.slice(0, 120) + '\u2026' : raw
      );
      return null;
    } finally {
      setIsJoining(false);
    }
  }, [wallet]);

  const clearEscrowError = useCallback(() => setEscrowError(null), []);

  return {
    createDuel,
    joinDuel,
    getDuel,
    getDuelCount,
    getUsdcBalance,
    isCreating,
    isJoining,
    lastTx,
    escrowError,
    clearEscrowError,
    activeDuelId: activeDuelIdRef.current,
    isReady: !!wallet && !!ESCROW_CONTRACT_ADDRESS,
  };
}
