/**
 * POST /api/challenge/resolve
 *
 * Resolves a duel on-chain as the escrow contract owner.
 * Body: { duelId, winnerAddress, isDraw }
 */

import { NextRequest, NextResponse } from 'next/server';
import { Account } from 'starknet';

export const dynamic = 'force-dynamic';

const ESCROW_ADDRESS = (
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS ||
  '0x603029a4adfef65887a4e55e2436dcd81770e3e77c30b6e8d8540ed120bf018'
).trim();

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ||
  'https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/yR5Pmn0DMRTd2lhPE-sh3';

const OWNER_ADDRESS = (process.env.ESCROW_OWNER_ADDRESS || '').trim();
const OWNER_PRIVATE_KEY = (process.env.ESCROW_OWNER_PRIVATE_KEY || '').trim();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { duelId, winnerAddress, isDraw } = body;

    if (duelId === undefined || (!winnerAddress && !isDraw)) {
      return NextResponse.json({ error: 'duelId and winnerAddress (or isDraw) required' }, { status: 400 });
    }

    if (!OWNER_ADDRESS || !OWNER_PRIVATE_KEY) {
      console.error('[resolve] Missing ESCROW_OWNER_ADDRESS or ESCROW_OWNER_PRIVATE_KEY');
      return NextResponse.json({ error: 'Server not configured for resolution' }, { status: 500 });
    }

    const ownerAccount = new Account({
      provider: { nodeUrl: RPC_URL },
      address: OWNER_ADDRESS,
      signer: OWNER_PRIVATE_KEY,
    });

    const winner = isDraw ? '0x0' : winnerAddress;

    const tx = await ownerAccount.execute([
      {
        contractAddress: ESCROW_ADDRESS,
        entrypoint: 'resolve_duel',
        calldata: [duelId.toString(), winner, isDraw ? '1' : '0'],
      },
    ]);

    console.log(`[resolve] Duel #${duelId} resolved. TX: ${tx.transaction_hash}`);

    return NextResponse.json({
      ok: true,
      txHash: tx.transaction_hash,
    });
  } catch (err: any) {
    console.error('[resolve] Error:', err.message);
    return NextResponse.json({ error: err.message || 'Resolution failed' }, { status: 500 });
  }
}
