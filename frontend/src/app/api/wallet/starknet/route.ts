import { NextResponse } from 'next/server';
import { getPrivyClient } from '@/lib/privyServer';

const PRIVY_AUTH_URL = 'https://auth.privy.io/api/v1';

function privyAuthHeaders() {
  const appId = process.env.PRIVY_APP_ID!;
  const appSecret = process.env.PRIVY_APP_SECRET!;
  return {
    Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`,
    'privy-app-id': appId,
    'Content-Type': 'application/json',
  };
}

async function getUserMetadata(userId: string): Promise<Record<string, any> | null> {
  try {
    const res = await fetch(`${PRIVY_AUTH_URL}/users/${encodeURIComponent(userId)}`, {
      headers: privyAuthHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.custom_metadata || null;
  } catch {
    return null;
  }
}

async function setUserMetadata(userId: string, metadata: Record<string, any>): Promise<void> {
  await fetch(`${PRIVY_AUTH_URL}/users/${encodeURIComponent(userId)}/custom_metadata`, {
    method: 'POST',
    headers: privyAuthHeaders(),
    body: JSON.stringify({ custom_metadata: metadata }),
  });
}

function toWalletResponse(w: any) {
  return {
    wallet: {
      id: w.id,
      address: w.address,
      publicKey: w.public_key || w.publicKey,
    },
  };
}

export async function POST(request: Request) {
  try {
    const privy = getPrivyClient();

    let userId: string | undefined;
    try {
      const body = await request.json();
      const candidate = body?.privyUserId;
      if (typeof candidate === 'string' && candidate.startsWith('did:privy:')) {
        userId = candidate;
      }
    } catch {}

    if (userId) {
      const meta = await getUserMetadata(userId);
      const storedWalletId = meta?.starknet_wallet_id;

      if (storedWalletId) {
        // Look up the wallet in the full list to get its details
        for await (const w of privy.wallets().list({ chain_type: 'starknet' })) {
          if (w.id === storedWalletId) {
            return NextResponse.json(toWalletResponse(w));
          }
        }
      }

      // No stored wallet — create an app-level wallet (no owner = app can sign)
      const wallet = await privy.wallets().create({ chain_type: 'starknet' });
      await setUserMetadata(userId, { starknet_wallet_id: wallet.id });
      return NextResponse.json(toWalletResponse(wallet));
    }

    const wallet = await privy.wallets().create({ chain_type: 'starknet' });
    return NextResponse.json(toWalletResponse(wallet));
  } catch (error: any) {
    console.error('[wallet/starknet] Error:', error?.message);
    return NextResponse.json(
      { error: error?.message || 'Failed to create wallet' },
      { status: 500 },
    );
  }
}
