import { NextResponse } from 'next/server';
import { getPrivyClient, extractUserId } from '@/lib/privyServer';

export async function POST(request: Request) {
  try {
    const privy = getPrivyClient();
    const userId = await extractUserId(request);
    console.log('[wallet/starknet] userId:', userId || 'NOT FOUND');

    if (userId) {
      const existing: any[] = [];
      for await (const w of privy.wallets().list({ chain_type: 'starknet', user_id: userId })) {
        existing.push(w);
      }
      console.log('[wallet/starknet] existing wallets:', existing.length);

      if (existing.length > 0) {
        const w = existing[0];
        console.log('[wallet/starknet] returning existing wallet:', w.id, w.address);
        return NextResponse.json({
          wallet: {
            id: w.id,
            address: w.address,
            publicKey: (w as any).public_key || (w as any).publicKey,
          },
        });
      }
    }

    console.log('[wallet/starknet] creating new wallet, owner:', userId || 'none');
    const createOpts: Record<string, unknown> = { chain_type: 'starknet' };
    if (userId) createOpts.owner = { user_id: userId };

    const wallet = await privy.wallets().create(createOpts as any);
    console.log('[wallet/starknet] created wallet:', wallet.id, wallet.address);
    return NextResponse.json({
      wallet: {
        id: wallet.id,
        address: wallet.address,
        publicKey: (wallet as any).public_key || (wallet as any).publicKey,
      },
    });
  } catch (error: any) {
    console.error('[wallet/starknet] Error:', error?.message);
    return NextResponse.json(
      { error: error?.message || 'Failed to create wallet' },
      { status: 500 },
    );
  }
}
