/**
 * GET /api/recent-blinks
 *
 * Returns the most recent Blink events from the WinkyBlink contract.
 * Results are cached server-side for 5 seconds to avoid hammering the RPC.
 *
 * Event structure (from Cairo):
 *   keys[0] = sn_keccak("Blink")
 *   keys[1] = user address  (#[key])
 *   data[0] = timestamp      (u64)
 *   data[1] = user_total     (u64)
 *   data[2] = global_total   (u64)
 */

import { NextResponse } from 'next/server';
import { RpcProvider, hash } from 'starknet';

export const dynamic = 'force-dynamic';

const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || 'sepolia') as 'mainnet' | 'sepolia' | 'devnet';

const WINKY_CONTRACT_ADDRESSES: Record<string, string> = {
  mainnet: '0x004918f613695bbd6ad40b853564b1fc6ab7e1630ecbc2c7db7705cdb937983f',
  sepolia: '0x05d1dfe0ae2b796ac73bf995901c0987b15e8af6f2cb414189a4749feba8666b',
  devnet: '0x048a3823f3e8fd09dbd779855c5cb02a23542de272ad9edcd502230e14e20377',
};

const CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_WINKY_CONTRACT_ADDRESS || WINKY_CONTRACT_ADDRESSES[NETWORK] || WINKY_CONTRACT_ADDRESSES['sepolia']
).trim();

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ||
  'https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/yR5Pmn0DMRTd2lhPE-sh3';
const BLINK_EVENT_KEY = hash.getSelectorFromName('Blink');

const EVENT_START_BLOCK: Record<string, number> = {
  mainnet: 6_976_636,
  sepolia: 0,
  devnet: 0,
};

// In-memory cache (per serverless instance)
let cachedEvents: RecentBlink[] = [];
let cacheTime = 0;
const CACHE_TTL_MS = 3_000;

interface RecentBlink {
  address: string;
  txHash: string;
  timestamp: number;
  userTotal: number;
  globalTotal: number;
  blockNumber: number;
}

export async function GET() {
  try {
    const now = Date.now();

    // Serve from cache if fresh
    if (cachedEvents.length > 0 && now - cacheTime < CACHE_TTL_MS) {
      return NextResponse.json({ events: cachedEvents }, {
        headers: { 'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5' },
      });
    }

    const provider = new RpcProvider({ nodeUrl: RPC_URL });

    const startBlock = EVENT_START_BLOCK[NETWORK] ?? 0;
    const allEvents: RecentBlink[] = [];
    let continuationToken: string | undefined = undefined;

    do {
      const params: any = {
        address: CONTRACT_ADDRESS,
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
        allEvents.push({
          address: event.keys[1],
          txHash: event.transaction_hash,
          timestamp: Number(BigInt(event.data[0])) * 1000,
          userTotal: Number(BigInt(event.data[1])),
          globalTotal: Number(BigInt(event.data[2])),
          blockNumber: event.block_number ?? 0,
        });
      }

      continuationToken = response.continuation_token;
    } while (continuationToken);

    // Sort by timestamp descending (most recent first), take last 20
    allEvents.sort((a, b) => b.timestamp - a.timestamp);
    const recentEvents = allEvents.slice(0, 20);

    // Update cache
    cachedEvents = recentEvents;
    cacheTime = now;

    return NextResponse.json({ events: recentEvents }, {
      headers: { 'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5' },
    });
  } catch (err: any) {
    console.error('[recent-blinks] Error:', err);
    // Return cached data if available, even if stale
    if (cachedEvents.length > 0) {
      return NextResponse.json({ events: cachedEvents });
    }
    return NextResponse.json({ events: [], error: 'Failed to fetch recent blinks' }, { status: 500 });
  }
}
