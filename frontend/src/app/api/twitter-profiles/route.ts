/**
 * GET /api/twitter-profiles?addresses=0x1,0x2,...
 *
 * Returns a map of wallet addresses → Twitter profile info for all
 * addresses that have linked their Twitter account.
 *
 * POST /api/twitter-profiles
 * Body: { address, username, name, profileImageUrl }
 *
 * Saves a wallet → Twitter profile mapping via Vercel Edge Config.
 */

import { NextRequest, NextResponse } from 'next/server';

const EDGE_CONFIG_ID = process.env.EDGE_CONFIG_ID || '';
const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN || '';
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || '';

/** Normalize a Starknet address: strip leading zeros after 0x, lowercase. */
function normalizeAddress(addr: string): string {
  return addr.replace(/^0x0*/i, '0x').toLowerCase();
}

/** Edge Config key for a wallet address. Uses underscores (keys can't contain colons). */
function profileKey(addr: string): string {
  return `tw_${normalizeAddress(addr).replace('0x', '')}`;
}

/** Read all items from Edge Config via REST API (no SDK connection string needed). */
async function edgeConfigReadAll(): Promise<Array<{ key: string; value: any }>> {
  if (!EDGE_CONFIG_ID || !VERCEL_API_TOKEN) return [];

  const teamParam = VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : '';
  const res = await fetch(
    `https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items${teamParam}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${VERCEL_API_TOKEN}` },
      cache: 'no-store',
    },
  );

  if (!res.ok) return [];
  return res.json();
}

export async function GET(request: NextRequest) {
  try {
    const addressesParam = request.nextUrl.searchParams.get('addresses');

    const allItems = await edgeConfigReadAll();
    const itemMap = new Map<string, any>();
    for (const item of allItems) {
      itemMap.set(item.key, item.value);
    }

    if (!addressesParam) {
      const profiles: Record<string, any> = {};
      itemMap.forEach((value, key) => {
        if (key.startsWith('tw_') && value) {
          const addr = '0x' + key.replace('tw_', '');
          profiles[addr] = value;
        }
      });
      return NextResponse.json({ profiles });
    }

    const addresses = addressesParam.split(',').map((a) => normalizeAddress(a.trim()));
    const profiles: Record<string, any> = {};
    for (let i = 0; i < addresses.length; i++) {
      const key = profileKey(addresses[i]);
      const value = itemMap.get(key);
      if (value) {
        profiles[addresses[i]] = value;
      }
    }

    return NextResponse.json({ profiles });
  } catch (err: any) {
    console.error('[twitter-profiles] GET error:', err);
    return NextResponse.json({ profiles: {}, error: 'Failed to fetch profiles' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, username, name, profileImageUrl } = body;

    if (!address || !username) {
      return NextResponse.json({ error: 'address and username required' }, { status: 400 });
    }

    if (!EDGE_CONFIG_ID || !VERCEL_API_TOKEN) {
      console.error('[twitter-profiles] Missing EDGE_CONFIG_ID or VERCEL_API_TOKEN');
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const key = profileKey(address);
    const profile = { username, name: name || username, profileImageUrl: profileImageUrl || '' };

    const teamParam = VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : '';
    const res = await fetch(
      `https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items${teamParam}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${VERCEL_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [{ operation: 'upsert', key, value: profile }],
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error('[twitter-profiles] Edge Config upsert failed:', res.status, errText);
      return NextResponse.json({ error: 'Failed to save profile', detail: errText }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[twitter-profiles] POST error:', err);
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 });
  }
}
