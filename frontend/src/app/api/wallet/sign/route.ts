import { NextResponse } from 'next/server';
import { getPrivyClient } from '@/lib/privyServer';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { walletId, hash } = body;

    if (!walletId || !hash) {
      return NextResponse.json(
        { error: 'walletId and hash are required' },
        { status: 400 },
      );
    }

    const privy = getPrivyClient();
    const result = await privy.wallets().rawSign(walletId, { params: { hash } });
    return NextResponse.json({ signature: (result as any).signature });
  } catch (error: any) {
    console.error('Error signing:', error?.message);
    return NextResponse.json(
      { error: error?.message || 'Failed to sign' },
      { status: 500 },
    );
  }
}
