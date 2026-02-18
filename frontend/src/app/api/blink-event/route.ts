/**
 * POST /api/blink-event
 *
 * Receives a blink event from a client and broadcasts it to all
 * connected clients via Pusher WebSocket.
 *
 * Body: { address, txHash, userTotal, twitterUsername? }
 */

import { NextRequest, NextResponse } from 'next/server';
import Pusher from 'pusher';

export const dynamic = 'force-dynamic';

let pusherInstance: Pusher | null = null;

function getPusher(): Pusher {
  if (!pusherInstance) {
    const appId = process.env.PUSHER_APP_ID || '';
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY || '';
    const secret = process.env.PUSHER_SECRET || '';
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'eu';

    if (!appId || !key || !secret) {
      throw new Error(`Pusher not configured: appId=${!!appId}, key=${!!key}, secret=${!!secret}`);
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

    const pusher = getPusher();

    await pusher.trigger('blinks', 'new-blink', {
      address,
      txHash,
      userTotal: userTotal || 0,
      twitterUsername: twitterUsername || null,
      timestamp: Date.now(),
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[blink-event] Error:', err.message || err);
    return NextResponse.json({ error: err.message || 'Failed to broadcast' }, { status: 500 });
  }
}
