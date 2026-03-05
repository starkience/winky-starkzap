/**
 * POST /api/challenge — Create a challenge
 * Body: { challengerUsername, challengerAddress, targetUsername, stake }
 *
 * GET /api/challenge?username=<twitter_username> — Fetch pending challenges for a user
 *
 * Challenges are broadcast via Pusher and stored in-memory (server-side).
 * In production, use a database. This is a lightweight MVP.
 */

import { NextRequest, NextResponse } from 'next/server';
import Pusher from 'pusher';

export const dynamic = 'force-dynamic';

interface Challenge {
  id: string;
  challengerUsername: string;
  challengerAddress: string;
  targetUsername: string;
  stake: number;
  createdAt: number;
  status: 'pending' | 'accepted' | 'expired';
}

const challenges: Record<string, Challenge> = {};

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let pusherInstance: Pusher | null = null;

function getPusher(): Pusher | null {
  if (pusherInstance) return pusherInstance;
  const appId = process.env.PUSHER_APP_ID || '';
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY || '';
  const secret = process.env.PUSHER_SECRET || '';
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'eu';
  if (!appId || !key || !secret) return null;
  pusherInstance = new Pusher({ appId, key, secret, cluster, useTLS: true });
  return pusherInstance;
}

function pruneExpired() {
  const now = Date.now();
  for (const id of Object.keys(challenges)) {
    if (now - challenges[id].createdAt > CHALLENGE_TTL_MS) {
      delete challenges[id];
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { challengerUsername, challengerAddress, targetUsername, stake } = body;

    if (!challengerUsername || !targetUsername || !stake) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (challengerUsername.toLowerCase() === targetUsername.toLowerCase()) {
      return NextResponse.json({ error: 'Cannot challenge yourself' }, { status: 400 });
    }

    pruneExpired();

    const id = `challenge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const challenge: Challenge = {
      id,
      challengerUsername: challengerUsername.replace(/^@/, ''),
      challengerAddress: challengerAddress || '',
      targetUsername: targetUsername.replace(/^@/, ''),
      stake: Number(stake),
      createdAt: Date.now(),
      status: 'pending',
    };

    challenges[id] = challenge;

    const pusher = getPusher();
    if (pusher) {
      const channel = `challenges-${challenge.targetUsername.toLowerCase()}`;
      await pusher.trigger(channel, 'new-challenge', challenge);
    }

    return NextResponse.json({ ok: true, challenge });
  } catch (err: any) {
    console.error('[challenge] POST error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get('username');
  if (!username) {
    return NextResponse.json({ error: 'username required' }, { status: 400 });
  }

  pruneExpired();

  const target = username.replace(/^@/, '').toLowerCase();
  const pending: Challenge[] = [];
  for (const id of Object.keys(challenges)) {
    const c = challenges[id];
    if (c.targetUsername.toLowerCase() === target && c.status === 'pending') {
      pending.push(c);
    }
  }

  return NextResponse.json({ challenges: pending });
}
