/**
 * POST /api/blink-event
 *
 * Receives a blink event from a client, stores it in an in-memory buffer,
 * and broadcasts it to all connected clients via Pusher WebSocket (if configured).
 *
 * GET /api/blink-event
 *
 * Returns the in-memory buffer of recent blink events (up to 50).
 * This supplements the on-chain data from /api/recent-blinks with events
 * that haven't been confirmed on-chain yet.
 *
 * Body: { address, txHash, userTotal, twitterUsername? }
 */

import { NextRequest, NextResponse } from 'next/server';
import Pusher from 'pusher';

export const dynamic = 'force-dynamic';

interface BufferedEvent {
  address: string;
  txHash: string;
  userTotal: number;
  twitterUsername: string | null;
  timestamp: number;
}

const MAX_BUFFER = 50;
const recentBuffer: BufferedEvent[] = [];

let pusherInstance: Pusher | null = null;
let pusherFailed = false;

function getPusher(): Pusher | null {
  if (pusherFailed) return null;

  if (!pusherInstance) {
    const appId = process.env.PUSHER_APP_ID || '';
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY || '';
    const secret = process.env.PUSHER_SECRET || '';
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'eu';

    if (!appId || !key || !secret) {
      console.warn('[blink-event] Pusher not configured, events will be buffered only');
      pusherFailed = true;
      return null;
    }

    pusherInstance = new Pusher({ appId, key, secret, cluster, useTLS: true });
  }
  return pusherInstance;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, txHash, userTotal, twitterUsername } = body;

    if (!address || !txHash) {
      return NextResponse.json({ error: 'address and txHash required' }, { status: 400 });
    }

    const event: BufferedEvent = {
      address,
      txHash,
      userTotal: userTotal || 0,
      twitterUsername: twitterUsername || null,
      timestamp: Date.now(),
    };

    // Store in buffer (dedup by txHash)
    const existingIdx = recentBuffer.findIndex(e => e.txHash === txHash);
    if (existingIdx === -1) {
      recentBuffer.unshift(event);
      if (recentBuffer.length > MAX_BUFFER) recentBuffer.pop();
    }

    // Try to broadcast via Pusher (non-fatal if unavailable)
    const pusher = getPusher();
    if (pusher) {
      try {
        await pusher.trigger('blinks', 'new-blink', event);
      } catch (err: any) {
        console.warn('[blink-event] Pusher trigger failed:', err.message);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[blink-event] Error:', err.message || err);
    return NextResponse.json({ error: err.message || 'Failed to process' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ events: recentBuffer }, {
    headers: { 'Cache-Control': 'no-cache, no-store' },
  });
}
