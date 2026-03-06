import { NextResponse } from 'next/server';
import { getPrivyClient, extractUserId } from '@/lib/privyServer';

export async function POST(request: Request) {
  try {
    const privy = getPrivyClient();
    const userId = await extractUserId(request);

    if (userId) {
      for await (const w of privy.wallets().list({ chain_type: 'starknet', user_id: userId })) {
        return NextResponse.json({
          wallet: {
            id: w.id,
            address: w.address,
            publicKey: (w as any).public_key || (w as any).publicKey,
          },
        });
      }
    }

    const createOpts: Record<string, unknown> = { chain_type: 'starknet' };
    if (userId) createOpts.owner = { user_id: userId };

    const wallet = await privy.wallets().create(createOpts as any);
    return NextResponse.json({
      wallet: {
        id: wallet.id,
        address: wallet.address,
        publicKey: (wallet as any).public_key || (wallet as any).publicKey,
      },
    });
  } catch (error: any) {
    console.error('Error creating wallet:', error?.message);
    return NextResponse.json(
      { error: error?.message || 'Failed to create wallet' },
      { status: 500 },
    );
  }
}
