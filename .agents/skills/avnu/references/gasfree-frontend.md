# Gasfree Frontend Integration

Secure integration of sponsored (gasfree) transactions in frontend dApps. The API key must never be exposed to the client.

## Architecture Overview

Gasfree transactions require a 3-phase pattern to keep the API key secure:

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Client)                       │
├─────────────────────────────────────────────────────────────┤
│  1. User initiates action                                    │
│  2. Call Server Action to BUILD transaction                  │
│  3. User SIGNS with wallet (client-side)                     │
│  4. Call Server Action to EXECUTE transaction                │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      Backend (Server)                        │
├─────────────────────────────────────────────────────────────┤
│  BUILD: Prepare tx with API key → return typed_data         │
│  EXECUTE: Submit signed tx with API key → return hash       │
│                                                              │
│  🔒 AVNU_PAYMASTER_API_KEY stays here                       │
└─────────────────────────────────────────────────────────────┘
```

## Next.js Server Actions

### Server-Side Actions (API Key Protected)

```typescript
// app/actions/paymaster.ts
'use server';

import { PaymasterRpc, type Call } from 'starknet';
import {
  buildPaymasterTransaction,
  executePaymasterTransaction,
  type SignedPaymasterTransaction,
  type PreparedPaymasterTransaction,
} from '@avnu/avnu-sdk';

const PAYMASTER_URL = 'https://starknet.paymaster.avnu.fi';

const paymasterParams = {
  feeMode: { mode: 'sponsored' as const },
};

function getPaymaster(): PaymasterRpc {
  const apiKey = process.env.AVNU_PAYMASTER_API_KEY;
  if (!apiKey) {
    throw new Error('AVNU_PAYMASTER_API_KEY not configured');
  }

  return new PaymasterRpc({
    nodeUrl: PAYMASTER_URL,
    headers: {
      'x-paymaster-api-key': apiKey,
    },
  });
}

/**
 * Build a sponsored transaction (server-side)
 * Returns typed_data for client-side signing
 */
export async function buildSponsoredTransaction(
  userAddress: string,
  calls: Call[]
): Promise<PreparedPaymasterTransaction> {
  const paymaster = getPaymaster();

  return buildPaymasterTransaction({
    takerAddress: userAddress,
    paymaster: {
      provider: paymaster,
      params: paymasterParams,
    },
    calls,
  });
}

/**
 * Execute a signed sponsored transaction (server-side)
 * Submits the signed transaction to the network
 */
export async function executeSponsoredTransaction(
  userAddress: string,
  signedTransaction: SignedPaymasterTransaction
): Promise<{ transactionHash: string }> {
  const paymaster = getPaymaster();

  return executePaymasterTransaction({
    takerAddress: userAddress,
    paymaster: {
      provider: paymaster,
      params: paymasterParams,
    },
    signedTransaction,
  });
}
```

### Client-Side Hook

```typescript
// hooks/use-sponsored-transaction.ts
'use client';

import { useState, useCallback } from 'react';
import { type Call, type AccountInterface } from 'starknet';
import { signPaymasterTransaction } from '@avnu/avnu-sdk';
import {
  buildSponsoredTransaction,
  executeSponsoredTransaction,
} from '@/app/actions/paymaster';

interface UseSponsoredTransactionOptions {
  account: AccountInterface | undefined;
  onSuccess?: (txHash: string) => void;
  onError?: (error: Error) => void;
}

interface UseSponsoredTransactionResult {
  execute: (calls: Call[]) => Promise<string | undefined>;
  isLoading: boolean;
  error: Error | null;
  txHash: string | null;
}

export function useSponsoredTransaction({
  account,
  onSuccess,
  onError,
}: UseSponsoredTransactionOptions): UseSponsoredTransactionResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const execute = useCallback(
    async (calls: Call[]): Promise<string | undefined> => {
      if (!account) {
        const err = new Error('Wallet not connected');
        setError(err);
        onError?.(err);
        return;
      }

      setIsLoading(true);
      setError(null);
      setTxHash(null);

      try {
        // Phase 1: Build on server (API key safe)
        const prepared = await buildSponsoredTransaction(
          account.address,
          calls
        );

        // Phase 2: Sign on client (user's wallet)
        const signed = await signPaymasterTransaction({
          provider: account,
          typedData: prepared.typed_data,
        });

        // Phase 3: Execute on server (API key safe)
        const result = await executeSponsoredTransaction(
          account.address,
          signed
        );

        setTxHash(result.transactionHash);
        onSuccess?.(result.transactionHash);
        return result.transactionHash;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        onError?.(error);
        return;
      } finally {
        setIsLoading(false);
      }
    },
    [account, onSuccess, onError]
  );

  return { execute, isLoading, error, txHash };
}
```

### Usage in Components

```tsx
// components/SponsoredSwapButton.tsx
'use client';

import { useSponsoredTransaction } from '@/hooks/use-sponsored-transaction';
import { useAccount } from '@starknet-react/core';
import { quoteToCalls, getQuotes } from '@avnu/avnu-sdk';

export function SponsoredSwapButton() {
  const { account } = useAccount();

  const { execute, isLoading, error, txHash } = useSponsoredTransaction({
    account,
    onSuccess: (hash) => {
      console.log('Swap successful:', hash);
    },
    onError: (err) => {
      console.error('Swap failed:', err);
    },
  });

  const handleSwap = async () => {
    if (!account) return;

    // Get quote
    const quotes = await getQuotes({
      sellTokenAddress: TOKENS.USDC,
      buyTokenAddress: TOKENS.ETH,
      sellAmount: BigInt(100e6),
      takerAddress: account.address,
    });

    // Build calls
    const { calls } = await quoteToCalls({
      quote: quotes[0],
      takerAddress: account.address,
      slippage: 0.01,
      includeApprove: true,
    });

    // Execute sponsored transaction
    await execute(calls);
  };

  return (
    <div>
      <button onClick={handleSwap} disabled={isLoading || !account}>
        {isLoading ? 'Processing...' : 'Swap (Gas-Free)'}
      </button>

      {txHash && (
        <p>
          Success!{' '}
          <a href={`https://starkscan.co/tx/${txHash}`}>View transaction</a>
        </p>
      )}

      {error && <p className="error">{error.message}</p>}
    </div>
  );
}
```

## SDK Functions Reference

### buildPaymasterTransaction

Prepares a transaction for signing. Must be called server-side with API key.

```typescript
import { buildPaymasterTransaction } from '@avnu/avnu-sdk';

const prepared = await buildPaymasterTransaction({
  takerAddress: userAddress,
  paymaster: {
    provider: paymaster, // PaymasterRpc with API key
    params: { feeMode: { mode: 'sponsored' } },
  },
  calls: [
    {
      contractAddress: '0x...',
      entrypoint: 'transfer',
      calldata: ['0x...', '100'],
    },
  ],
});

// Returns: { typed_data: TypedData, ... }
```

### signPaymasterTransaction

Signs the prepared transaction with the user's wallet. Called client-side.

```typescript
import { signPaymasterTransaction } from '@avnu/avnu-sdk';

const signed = await signPaymasterTransaction({
  provider: account, // User's wallet account
  typedData: prepared.typed_data,
});

// Returns: SignedPaymasterTransaction
```

### executePaymasterTransaction

Submits the signed transaction. Must be called server-side with API key.

```typescript
import { executePaymasterTransaction } from '@avnu/avnu-sdk';

const result = await executePaymasterTransaction({
  takerAddress: userAddress,
  paymaster: {
    provider: paymaster, // PaymasterRpc with API key
    params: { feeMode: { mode: 'sponsored' } },
  },
  signedTransaction: signed,
});

// Returns: { transactionHash: string }
```

## Alternative: API Routes

If not using Server Actions, use API routes:

```typescript
// app/api/paymaster/build/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { buildPaymasterTransaction } from '@avnu/avnu-sdk';
import { getPaymaster } from '@/lib/paymaster';

export async function POST(request: NextRequest) {
  const { userAddress, calls } = await request.json();

  const prepared = await buildPaymasterTransaction({
    takerAddress: userAddress,
    paymaster: {
      provider: getPaymaster(),
      params: { feeMode: { mode: 'sponsored' } },
    },
    calls,
  });

  return NextResponse.json(prepared);
}
```

```typescript
// app/api/paymaster/execute/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { executePaymasterTransaction } from '@avnu/avnu-sdk';
import { getPaymaster } from '@/lib/paymaster';

export async function POST(request: NextRequest) {
  const { userAddress, signedTransaction } = await request.json();

  const result = await executePaymasterTransaction({
    takerAddress: userAddress,
    paymaster: {
      provider: getPaymaster(),
      params: { feeMode: { mode: 'sponsored' } },
    },
    signedTransaction,
  });

  return NextResponse.json(result);
}
```

## Error Handling

```typescript
export function useSponsoredTransaction({ account, onError }) {
  const execute = async (calls: Call[]) => {
    try {
      // ... transaction flow
    } catch (err: any) {
      // Handle specific errors
      if (err.message?.includes('PAYMASTER_REJECTED')) {
        // Transaction not eligible for sponsorship
        // Option: fallback to gasless or regular gas
        onError?.(new Error('Transaction not eligible for sponsorship'));
      } else if (err.message?.includes('USER_REJECTED')) {
        // User cancelled the signature
        onError?.(new Error('Transaction cancelled'));
      } else if (err.message?.includes('INSUFFICIENT_FUNDS')) {
        // dApp's sponsorship budget exhausted
        onError?.(new Error('Sponsorship unavailable, please try again'));
      } else {
        onError?.(err);
      }
    }
  };

  return { execute };
}
```

## Fallback Strategy

For production apps, implement graceful degradation:

```typescript
async function executeWithFallback(account: AccountInterface, calls: Call[]) {
  // Try sponsored (gasfree) first
  try {
    const prepared = await buildSponsoredTransaction(account.address, calls);
    const signed = await signPaymasterTransaction({
      provider: account,
      typedData: prepared.typed_data,
    });
    return await executeSponsoredTransaction(account.address, signed);
  } catch (e) {
    console.log('Sponsored failed, trying gasless...');
  }

  // Fallback to gasless (user pays in token)
  const gaslessPaymaster = new PaymasterRpc({
    nodeUrl: 'https://starknet.api.avnu.fi/paymaster/v1',
  });

  try {
    const result = await account.executePaymasterTransaction(calls, {
      feeMode: { mode: 'default', gasToken: TOKENS.USDC },
    });
    return { transactionHash: result.transaction_hash };
  } catch (e) {
    console.log('Gasless failed, using regular gas...');
  }

  // Final fallback to regular ETH gas
  const result = await account.execute(calls);
  return { transactionHash: result.transaction_hash };
}
```

## Security Checklist

- [ ] API key stored in environment variable (`AVNU_PAYMASTER_API_KEY`)
- [ ] API key only accessed in Server Actions or API routes
- [ ] No API key in client-side code or React components
- [ ] Server Actions marked with `'use server'`
- [ ] API routes validate input before processing
- [ ] Error messages don't expose sensitive details
