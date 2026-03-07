/**
 * Challenge API — stores open blink challenges (in-memory MVP).
 *
 * POST   /api/challenge          — Create an open challenge after finishing a game
 * GET    /api/challenge           — List all open challenges
 * PATCH  /api/challenge           — Mark a challenge as completed / remove it
 *
 * In production, replace in-memory store with a database.
 */

import { NextRequest, NextResponse } from 'next/server';
import Pusher from 'pusher';

export const dynamic = 'force-dynamic';

export interface OpenChallenge {
  id: string;
  duelId: number;
  playerAddress: string;
  username: string;
  profileImage?: string;
  score: number;
  stake: number;
  createdAt: number;
}

const openChallenges: Map<string, OpenChallenge> = new Map();

const CHALLENGE_TTL_MS = 60 * 60 * 1000; // 1 hour

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
  openChallenges.forEach((c, id) => {
    if (now - c.createdAt > CHALLENGE_TTL_MS) {
      openChallenges.delete(id);
    }
  });
}

/** POST — Save a new open challenge after the creator finishes blinking */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { duelId, playerAddress, username, profileImage, score, stake } = body;

    if (duelId === undefined || !playerAddress || score === undefined || !stake) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    pruneExpired();

    const id = `challenge-${duelId}`;

    const challenge: OpenChallenge = {
      id,
      duelId: Number(duelId),
      playerAddress,
      username: username || `${playerAddress.slice(0, 6)}...${playerAddress.slice(-4)}`,
      profileImage,
      score: Number(score),
      stake: Number(stake),
      createdAt: Date.now(),
    };

    openChallenges.set(id, challenge);

    const pusher = getPusher();
    if (pusher) {
      await pusher.trigger('challenges', 'new-challenge', challenge).catch(() => {});
    }

    return NextResponse.json({ ok: true, challenge });
  } catch (err: any) {
    console.error('[challenge] POST error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}

/** GET — List all open challenges */
export async function GET() {
  pruneExpired();

  const list = Array.from(openChallenges.values()).sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ challenges: list });
}

/** PATCH — Remove a challenge (after it's been accepted and completed) */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { duelId } = body;

    if (duelId === undefined) {
      return NextResponse.json({ error: 'duelId required' }, { status: 400 });
    }

    const id = `challenge-${duelId}`;
    openChallenges.delete(id);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}
