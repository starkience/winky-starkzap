import { NextResponse } from 'next/server';
import { getPrivyClient } from '@/lib/privyServer';

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

    // Read body to get the Privy user ID
    let userId: string | undefined;
    try {
      const body = await request.json();
      const candidate = body?.privyUserId;
      if (typeof candidate === 'string' && candidate.startsWith('did:privy:')) {
        userId = candidate;
      }
    } catch {}

    // If we have a user ID, look for an existing starknet wallet
    if (userId) {
      for await (const w of privy.wallets().list({ chain_type: 'starknet', user_id: userId })) {
        return NextResponse.json(toWalletResponse(w));
      }

      // No existing wallet — create one owned by this user
      const wallet = await privy.wallets().create({
        chain_type: 'starknet',
        owner: { user_id: userId },
      } as any);
      return NextResponse.json(toWalletResponse(wallet));
    }

    // No user ID — create an unowned wallet (fallback)
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
