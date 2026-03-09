/**
 * Challenge API — stores open + completed blink challenges in Vercel Edge Config.
 *
 * POST   /api/challenge  — Create an open challenge after finishing a game
 * GET    /api/challenge   — List all open + past challenges
 * PATCH  /api/challenge   — Complete a challenge (move from open → past)
 */

import { NextRequest, NextResponse } from 'next/server';

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

export interface CompletedChallenge {
  duelId: number;
  player1: { address: string; username: string; profileImage?: string; score: number };
  player2: { address: string; username: string; profileImage?: string; score: number };
  winnerAddress: string;
  isDraw: boolean;
  payout: number;
  completedAt: number;
}

const EDGE_CONFIG_ID = (process.env.EDGE_CONFIG_ID || '').trim();
const VERCEL_API_TOKEN = (process.env.VERCEL_API_TOKEN || '').trim();
const VERCEL_TEAM_ID = (process.env.VERCEL_TEAM_ID || '').trim();

const CHALLENGE_TTL_MS = Infinity; // Challenges stay live forever (funds are locked on-chain until accepted or cancelled)
const COMPLETED_TTL_MS = Infinity; // Past challenges stay visible forever

function challengeKey(duelId: number): string {
  return `duel_${duelId}`;
}

function completedKey(duelId: number): string {
  return `done_${duelId}`;
}

async function edgeConfigWrite(items: Array<{ operation: string; key: string; value?: any }>): Promise<boolean> {
  if (!EDGE_CONFIG_ID || !VERCEL_API_TOKEN) {
    console.error('[challenge] Missing EDGE_CONFIG_ID or VERCEL_API_TOKEN');
    return false;
  }

  const teamParam = VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : '';
  const res = await fetch(
    `https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items${teamParam}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${VERCEL_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error('[challenge] Edge Config write failed:', res.status, errText);
    return false;
  }
  return true;
}

async function edgeConfigReadAll(): Promise<Record<string, any> | null> {
  if (!EDGE_CONFIG_ID || !VERCEL_API_TOKEN) {
    console.error('[challenge] Missing EDGE_CONFIG_ID or VERCEL_API_TOKEN');
    return null;
  }

  const teamParam = VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : '';
  const res = await fetch(
    `https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items${teamParam}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${VERCEL_API_TOKEN}` },
      cache: 'no-store',
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error('[challenge] Edge Config read failed:', res.status, errText);
    return null;
  }

  const items: Array<{ key: string; value: any }> = await res.json();
  const result: Record<string, any> = {};
  for (const item of items) {
    result[item.key] = item.value;
  }
  return result;
}

/** POST — Save a new open challenge after the creator finishes blinking */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { duelId, playerAddress, username, profileImage, score, stake } = body;

    if (duelId === undefined || !playerAddress || score === undefined || !stake) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const challenge: OpenChallenge = {
      id: `challenge-${duelId}`,
      duelId: Number(duelId),
      playerAddress,
      username: username || `${playerAddress.slice(0, 6)}...${playerAddress.slice(-4)}`,
      profileImage,
      score: Number(score),
      stake: Number(stake),
      createdAt: Date.now(),
    };

    const key = challengeKey(challenge.duelId);
    const ok = await edgeConfigWrite([{ operation: 'upsert', key, value: challenge }]);

    if (!ok) {
      return NextResponse.json({ error: 'Failed to save challenge' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, challenge });
  } catch (err: any) {
    console.error('[challenge] POST error:', err.message);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}

/** GET — List all open challenges + past completed challenges */
export async function GET() {
  try {
    const allItems = await edgeConfigReadAll();
    const challenges: OpenChallenge[] = [];
    const completed: CompletedChallenge[] = [];
    const now = Date.now();
    const expiredKeys: string[] = [];

    if (allItems) {
      for (const [key, value] of Object.entries(allItems)) {
        if (!value || typeof value !== 'object') continue;

        if (key.startsWith('duel_')) {
          const c = value as OpenChallenge;
          if (now - c.createdAt > CHALLENGE_TTL_MS) {
            expiredKeys.push(key);
          } else {
            challenges.push(c);
          }
        }

        if (key.startsWith('done_')) {
          const c = value as CompletedChallenge;
          if (now - c.completedAt > COMPLETED_TTL_MS) {
            expiredKeys.push(key);
          } else {
            completed.push(c);
          }
        }
      }
    }

    if (expiredKeys.length > 0) {
      edgeConfigWrite(expiredKeys.map((key) => ({ operation: 'delete', key }))).catch(() => {});
    }

    challenges.sort((a, b) => b.createdAt - a.createdAt);
    completed.sort((a, b) => b.completedAt - a.completedAt);

    return NextResponse.json({ challenges, completed });
  } catch (err: any) {
    console.error('[challenge] GET error:', err.message);
    return NextResponse.json({ challenges: [], completed: [], error: err.message }, { status: 500 });
  }
}

/**
 * PATCH — Complete a challenge: remove from open, save to completed history.
 * Body: { duelId, winnerAddress, isDraw, challenger: { address, username, profileImage, score } }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { duelId, winnerAddress, isDraw, challenger } = body;

    if (duelId === undefined) {
      return NextResponse.json({ error: 'duelId required' }, { status: 400 });
    }

    const openKey = challengeKey(duelId);
    const doneKey = completedKey(duelId);

    const allItems = await edgeConfigReadAll();
    const openChallenge = allItems?.[openKey] as OpenChallenge | undefined;

    const ops: Array<{ operation: string; key: string; value?: any }> = [
      { operation: 'delete', key: openKey },
    ];

    if (openChallenge && challenger) {
      const payout = openChallenge.stake * 2;
      const record: CompletedChallenge = {
        duelId: Number(duelId),
        player1: {
          address: openChallenge.playerAddress,
          username: openChallenge.username,
          profileImage: openChallenge.profileImage,
          score: openChallenge.score,
        },
        player2: {
          address: challenger.address,
          username: challenger.username,
          profileImage: challenger.profileImage,
          score: challenger.score,
        },
        winnerAddress: isDraw ? '0x0' : winnerAddress,
        isDraw: !!isDraw,
        payout,
        completedAt: Date.now(),
      };
      ops.push({ operation: 'upsert', key: doneKey, value: record });
    }

    const ok = await edgeConfigWrite(ops);
    if (!ok) {
      return NextResponse.json({ error: 'Failed to update challenge' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}
