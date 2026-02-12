'use client';

/**
 * Hook to fetch and manage leaderboard data from on-chain Blink events.
 *
 * Queries all Blink events emitted by the WinkyBlink contract,
 * aggregates per-user blink counts (using the user_total field
 * from the latest event per user), and returns a sorted leaderboard.
 *
 * Event structure (from Cairo):
 *   keys[0] = sn_keccak("Blink")
 *   keys[1] = user address  (#[key])
 *   data[0] = timestamp      (u64)
 *   data[1] = user_total     (u64)
 *   data[2] = global_total   (u64)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { RpcProvider, hash } from 'starknet';
import { WINKY_CONTRACT_ADDRESS, CARTRIDGE_RPC_URL, NETWORK } from '@/lib/constants';

export interface LeaderboardEntry {
  address: string;
  username: string;
  blinks: number;
  rank: number;
}

export interface UseLeaderboardResult {
  leaderboard: LeaderboardEntry[];
  isLoading: boolean;
  loadingStatus: string;
  error: string | null;
  userRank: number | null;
  refetch: () => void;
}

/** Truncate a hex address to 0x1234...abcd format */
function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Cache to avoid refetching on every modal open */
let cachedLeaderboard: LeaderboardEntry[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

/** Compute the Blink event selector once */
const BLINK_EVENT_KEY = hash.getSelectorFromName('Blink');

/**
 * Block number to start scanning events from.
 * Set to just before the contract's first event to skip empty block ranges.
 * Without this, the RPC scans from genesis (takes ~23s instead of ~1.5s).
 */
const EVENT_START_BLOCK: Record<string, number> = {
  mainnet: 6_709_742,
  sepolia: 0,
  devnet: 0,
};

/**
 * Fetch all Blink events from the contract, paginating through results.
 * Calls onProgress with status updates during pagination.
 */
async function fetchBlinkEvents(
  provider: RpcProvider,
  onProgress: (status: string) => void,
): Promise<Map<string, number>> {
  const userBlinks = new Map<string, number>();
  let continuationToken: string | undefined = undefined;
  let totalEvents = 0;
  let page = 0;

  const startBlock = EVENT_START_BLOCK[NETWORK] ?? 0;

  do {
    page++;
    const params: any = {
      address: WINKY_CONTRACT_ADDRESS,
      keys: [[BLINK_EVENT_KEY]],
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
      const userAddress = event.keys[1];
      const userTotal = Number(BigInt(event.data[1]));

      const current = userBlinks.get(userAddress) ?? 0;
      if (userTotal > current) {
        userBlinks.set(userAddress, userTotal);
      }
    }

    totalEvents += response.events.length;
    continuationToken = response.continuation_token;

    if (continuationToken) {
      onProgress(`Scanning chain... ${totalEvents.toLocaleString()} events found`);
    }
  } while (continuationToken);

  onProgress(`Processing ${totalEvents.toLocaleString()} events...`);
  return userBlinks;
}

/**
 * Build a sorted leaderboard from the user blinks map.
 */
function buildLeaderboard(
  userBlinks: Map<string, number>,
): LeaderboardEntry[] {
  return Array.from(userBlinks.entries())
    .map(([address, blinks]) => ({
      address,
      username: truncateAddress(address),
      blinks,
      rank: 0,
    }))
    .sort((a, b) => b.blinks - a.blinks)
    .map((entry, idx) => ({
      ...entry,
      rank: idx + 1,
    }));
}

export function useLeaderboard(userAddress?: string): UseLeaderboardResult {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState('Connecting to Starknet...');
  const [error, setError] = useState<string | null>(null);
  const [userRank, setUserRank] = useState<number | null>(null);
  const providerRef = useRef<RpcProvider | null>(null);

  if (!providerRef.current) {
    providerRef.current = new RpcProvider({ nodeUrl: CARTRIDGE_RPC_URL });
  }

  const fetchLeaderboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setLoadingStatus('Connecting to Starknet...');

    // Check cache first
    const now = Date.now();
    if (cachedLeaderboard && now - cacheTimestamp < CACHE_TTL_MS) {
      setLeaderboard(cachedLeaderboard);
      if (userAddress) {
        const entry = cachedLeaderboard.find(
          (e) => e.address.toLowerCase() === userAddress.toLowerCase(),
        );
        setUserRank(entry?.rank ?? null);
      }
      setIsLoading(false);
      return;
    }

    try {
      const provider = providerRef.current!;

      setLoadingStatus('Fetching on-chain blink events...');
      const userBlinks = await fetchBlinkEvents(provider, setLoadingStatus);

      setLoadingStatus('Building leaderboard...');
      const data = buildLeaderboard(userBlinks);

      cachedLeaderboard = data;
      cacheTimestamp = Date.now();

      setLeaderboard(data);

      if (userAddress) {
        const entry = data.find(
          (e) => e.address.toLowerCase() === userAddress.toLowerCase(),
        );
        setUserRank(entry?.rank ?? null);
      } else {
        setUserRank(null);
      }
    } catch (err: any) {
      console.error('[useLeaderboard] Failed to fetch events:', err);
      setError('Failed to load leaderboard. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  return {
    leaderboard,
    isLoading,
    loadingStatus,
    error,
    userRank,
    refetch: fetchLeaderboard,
  };
}
