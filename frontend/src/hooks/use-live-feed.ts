'use client';

/**
 * Hook that provides a live feed of blink events from all users.
 *
 * Real-time: subscribes to Pusher WebSocket channel for instant updates.
 * Initial load: fetches recent on-chain events from /api/recent-blinks.
 * Twitter resolution: resolves usernames via /api/twitter-profiles.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Pusher from 'pusher-js';

export interface LiveBlinkEvent {
  id: string;
  address: string;
  txHash: string;
  timestamp: number;
  userTotal: number;
  twitterUsername?: string;
}

const MAX_EVENTS = 20;

const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY || '';
const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'eu';

/** Normalize a Starknet address: strip leading zeros after 0x, lowercase. */
function normalizeAddress(addr: string): string {
  return addr.replace(/^0x0*/i, '0x').toLowerCase();
}

export function useLiveFeed() {
  const [events, setEvents] = useState<LiveBlinkEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const twitterCacheRef = useRef<Record<string, string | null>>({});
  const pusherRef = useRef<Pusher | null>(null);

  /** Resolve Twitter usernames for a batch of addresses. */
  const resolveTwitterUsernames = useCallback(async (addresses: string[]) => {
    const unknown = addresses.filter(
      (a) => twitterCacheRef.current[normalizeAddress(a)] === undefined,
    );
    if (unknown.length === 0) return;

    try {
      const normalized = unknown.map((a) => normalizeAddress(a));
      const res = await fetch(
        `/api/twitter-profiles?addresses=${encodeURIComponent(normalized.join(','))}`,
      );
      const data = await res.json();
      if (data.profiles) {
        for (const addr of normalized) {
          const profile = data.profiles[addr];
          twitterCacheRef.current[addr] = profile?.username ?? null;
        }
      }
    } catch {
      // Non-fatal
    }
  }, []);

  /** Fetch initial recent events from the on-chain API. */
  const fetchInitial = useCallback(async () => {
    try {
      const res = await fetch('/api/recent-blinks');
      const data = await res.json();

      if (!data.events || data.events.length === 0) {
        setIsLoading(false);
        return;
      }

      // Resolve Twitter usernames
      const addresses = data.events.map((e: any) => e.address);
      await resolveTwitterUsernames(addresses);

      const initial: LiveBlinkEvent[] = data.events.map((e: any) => ({
        id: e.txHash,
        address: e.address,
        txHash: e.txHash,
        timestamp: e.timestamp,
        userTotal: e.userTotal,
        twitterUsername: twitterCacheRef.current[normalizeAddress(e.address)] ?? undefined,
      }));

      setEvents(initial.slice(0, MAX_EVENTS));
      setIsLoading(false);
    } catch (err) {
      console.error('[useLiveFeed] initial fetch error:', err);
      setIsLoading(false);
    }
  }, [resolveTwitterUsernames]);

  useEffect(() => {
    // Load initial events from on-chain data
    fetchInitial();

    // Connect to Pusher for real-time updates
    if (!PUSHER_KEY) {
      console.warn('[useLiveFeed] No PUSHER_KEY configured, falling back to polling');
      return;
    }

    const pusher = new Pusher(PUSHER_KEY, {
      cluster: PUSHER_CLUSTER,
    });
    pusherRef.current = pusher;

    const channel = pusher.subscribe('blinks');

    channel.bind('new-blink', async (data: any) => {
      // Resolve Twitter username if not provided
      let twitterUsername = data.twitterUsername;
      if (!twitterUsername && data.address) {
        const norm = normalizeAddress(data.address);
        if (twitterCacheRef.current[norm] === undefined) {
          await resolveTwitterUsernames([data.address]);
        }
        twitterUsername = twitterCacheRef.current[norm] ?? undefined;
      }

      const newEvent: LiveBlinkEvent = {
        id: data.txHash,
        address: data.address,
        txHash: data.txHash,
        timestamp: data.timestamp || Date.now(),
        userTotal: data.userTotal || 0,
        twitterUsername,
      };

      setEvents((prev) => {
        // Deduplicate by txHash
        const filtered = prev.filter((e) => e.id !== newEvent.id);
        return [newEvent, ...filtered].slice(0, MAX_EVENTS);
      });
    });

    return () => {
      channel.unbind_all();
      pusher.unsubscribe('blinks');
      pusher.disconnect();
      pusherRef.current = null;
    };
  }, [fetchInitial, resolveTwitterUsernames]);

  return { events, isLoading };
}
