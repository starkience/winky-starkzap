# Paymaster Guide

Complete reference for gasless and gasfree transactions using the avnu Paymaster with starknet.js.

## Overview

The Paymaster enables two modes of gas abstraction:

| Mode | Description | Who Pays | API Key Required |
|------|-------------|----------|------------------|
| **Gasless** (default) | User pays gas in ERC-20 token | User (in chosen token) | No |
| **Gasfree** (sponsored) | dApp sponsors the gas | dApp (invisible to user) | Yes |

**When to use each:**
- **Gasless**: User doesn't have ETH but has tokens (USDC, STRK). No backend required.
- **Gasfree**: Better UX, zero gas friction. Requires API key and secure backend.

## PaymasterRpc Setup

`PaymasterRpc` comes from starknet.js and implements `PaymasterInterface`.

```typescript
import { PaymasterRpc } from 'starknet';

const paymaster = new PaymasterRpc({
  nodeUrl: 'https://starknet.api.avnu.fi/paymaster/v1',
});

// Check if paymaster is available
const isAvailable = await paymaster.isAvailable();
console.log('Paymaster available:', isAvailable);

// Get supported tokens
const tokens = await paymaster.getSupportedTokens();
tokens.forEach(t => console.log(t.tokenAddress, t.priceInStrk));
```

## Gasless Swap

User pays transaction fees in a supported ERC-20 token instead of ETH.

### Using avnu SDK executeSwap

```typescript
import { PaymasterRpc, type PaymasterDetails } from 'starknet';
import { executeSwap, getQuotes } from '@avnu/avnu-sdk';

const paymaster = new PaymasterRpc({
  nodeUrl: 'https://starknet.api.avnu.fi/paymaster/v1',
});

const quotes = await getQuotes({
  sellTokenAddress: TOKENS.USDC,
  buyTokenAddress: TOKENS.ETH,
  sellAmount: BigInt(100e6), // 100 USDC
  takerAddress: account.address,
});

const result = await executeSwap({
  provider: account,
  quote: quotes[0],
  slippage: 0.01,
  paymaster: {
    active: true,
    provider: paymaster,
    params: {
      feeMode: { mode: 'default', gasToken: TOKENS.USDC },
    },
  },
});

console.log('Tx Hash:', result.transactionHash);
```

### Using starknet.js Directly (With Fee Estimation)

For more control, use starknet.js paymaster methods directly:

```typescript
import { PaymasterRpc, type PaymasterDetails } from 'starknet';
import { quoteToCalls } from '@avnu/avnu-sdk';

const paymaster = new PaymasterRpc({
  nodeUrl: 'https://starknet.api.avnu.fi/paymaster/v1',
});

// 1. Build calls from quote
const { calls } = await quoteToCalls({
  quote: quotes[0],
  takerAddress: account.address,
  slippage: 0.01,
  includeApprove: true,
});

// 2. Define fee mode
const feeDetails: PaymasterDetails = {
  feeMode: { mode: 'default', gasToken: TOKENS.USDC },
};

// 3. Estimate fees (recommended)
const estimation = await account.estimatePaymasterTransactionFee(calls, feeDetails);
console.log('Estimated fee:', estimation.suggested_max_fee_in_gas_token);

// 4. Execute with max fee
const result = await account.executePaymasterTransaction(
  calls,
  feeDetails,
  estimation.suggested_max_fee_in_gas_token
);

const receipt = await account.waitForTransaction(result.transaction_hash);
```

## Supported Gas Tokens

| Token | Address | Typical Gas Cost |
|-------|---------|------------------|
| USDC | `0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8` | ~$0.01-0.10 |
| USDT | `0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8` | ~$0.01-0.10 |
| STRK | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | ~$0.01-0.10 |
| ETH | `0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7` | ~$0.01-0.10 |

Query supported tokens dynamically:

```typescript
const tokens = await paymaster.getSupportedTokens();
tokens.forEach(token => {
  console.log('Address:', token.tokenAddress);
  console.log('Price in STRK:', token.priceInStrk);
});
```

## Paymaster with DCA

```typescript
import { PaymasterRpc } from 'starknet';
import { executeCreateDca } from '@avnu/avnu-sdk';

const paymaster = new PaymasterRpc({
  nodeUrl: 'https://starknet.api.avnu.fi/paymaster/v1',
});

const result = await executeCreateDca({
  provider: account,
  order: dcaOrder,
  paymaster: {
    active: true,
    provider: paymaster,
    params: {
      feeMode: { mode: 'default', gasToken: TOKENS.USDC },
    },
  },
});
```

## Paymaster with Staking

```typescript
import { PaymasterRpc } from 'starknet';
import { executeStake } from '@avnu/avnu-sdk';

const paymaster = new PaymasterRpc({
  nodeUrl: 'https://starknet.api.avnu.fi/paymaster/v1',
});

const result = await executeStake({
  provider: account,
  poolAddress: '0xpool...',
  amount: BigInt(100e18),
  paymaster: {
    active: true,
    provider: paymaster,
    params: {
      feeMode: { mode: 'default', gasToken: TOKENS.STRK },
    },
  },
});
```

## Error Handling

```typescript
try {
  const result = await executeSwap({
    provider: account,
    quote,
    slippage: 0.01,
    paymaster: {
      active: true,
      provider: paymaster,
      params: {
        feeMode: { mode: 'default', gasToken: TOKENS.USDC },
      },
    },
  });
} catch (error: any) {
  if (error.message?.includes('PAYMASTER_REJECTED')) {
    // Transaction not eligible - fallback to regular gas
    console.log('Paymaster rejected, using ETH for gas');
    const result = await executeSwap({
      provider: account,
      quote,
      slippage: 0.01,
    });
  }

  if (error.message?.includes('INSUFFICIENT_BALANCE')) {
    // User doesn't have enough of the gas token
    console.log('Need more tokens for gas fees');
  }

  throw error;
}
```

## Best Practices

### Fallback to Regular Gas

```typescript
async function executeWithPaymasterFallback(
  account: Account,
  quote: Quote,
  slippage: number
) {
  const paymaster = new PaymasterRpc({
    nodeUrl: 'https://starknet.api.avnu.fi/paymaster/v1',
  });

  try {
    // Try gasless first
    return await executeSwap({
      provider: account,
      quote,
      slippage,
      paymaster: {
        active: true,
        provider: paymaster,
        params: {
          feeMode: { mode: 'default', gasToken: TOKENS.USDC },
        },
      },
    });
  } catch (error) {
    console.log('Paymaster failed, falling back to ETH gas');
    // Fallback to regular execution
    return await executeSwap({
      provider: account,
      quote,
      slippage,
    });
  }
}
```

### Check Paymaster Availability

```typescript
const paymaster = new PaymasterRpc({
  nodeUrl: 'https://starknet.api.avnu.fi/paymaster/v1',
});

const isAvailable = await paymaster.isAvailable();
if (!isAvailable) {
  console.log('Paymaster unavailable, using regular gas');
  // Execute without paymaster
}
```

### Fee Estimation Before Execution

Always estimate fees to show users the expected cost:

```typescript
const feeDetails: PaymasterDetails = {
  feeMode: { mode: 'default', gasToken: TOKENS.USDC },
};

const estimation = await account.estimatePaymasterTransactionFee(calls, feeDetails);

// Show user the expected fee
console.log('Gas fee:', estimation.suggested_max_fee_in_gas_token, 'USDC');

// Get user confirmation before executing
const confirmed = await askUserConfirmation(estimation.suggested_max_fee_in_gas_token);
if (confirmed) {
  await account.executePaymasterTransaction(
    calls,
    feeDetails,
    estimation.suggested_max_fee_in_gas_token
  );
}
```

## Types Reference

From starknet.js:

```typescript
import {
  PaymasterRpc,
  PaymasterInterface,
  type PaymasterDetails,
  type PaymasterOptions,
} from 'starknet';

// PaymasterOptions
interface PaymasterOptions {
  nodeUrl: string;
  headers?: Record<string, string>;
}

// PaymasterDetails
interface PaymasterDetails {
  feeMode: FeeMode;
  deploymentData?: ACCOUNT_DEPLOYMENT_DATA;
  timeBounds?: PaymasterTimeBounds;
}

// FeeMode for gasless (default mode)
interface DefaultFeeMode {
  mode: 'default';
  gasToken: string; // Token address for gas payment
}

// FeeMode for gasfree (sponsored mode)
interface SponsoredFeeMode {
  mode: 'sponsored';
}
```

---

## Gasfree (Sponsored Transactions)

With gasfree mode, the dApp pays for gas fees on behalf of users. This requires an API key from the [avnu Portal](https://portal.avnu.fi).

### PaymasterRpc Setup with API Key

```typescript
import { PaymasterRpc } from 'starknet';

const paymaster = new PaymasterRpc({
  nodeUrl: 'https://starknet.paymaster.avnu.fi',
  headers: {
    'x-paymaster-api-key': process.env.AVNU_PAYMASTER_API_KEY!,
  },
});
```

> ⚠️ **Security**: The API key must NEVER be exposed in frontend code. Always keep it server-side.

### Gasfree Swap (Backend/Scripts)

```typescript
import { PaymasterRpc } from 'starknet';
import { executeSwap, getQuotes } from '@avnu/avnu-sdk';

const paymaster = new PaymasterRpc({
  nodeUrl: 'https://starknet.paymaster.avnu.fi',
  headers: {
    'x-paymaster-api-key': process.env.AVNU_PAYMASTER_API_KEY!,
  },
});

const quotes = await getQuotes({
  sellTokenAddress: TOKENS.USDC,
  buyTokenAddress: TOKENS.ETH,
  sellAmount: BigInt(100e6),
  takerAddress: account.address,
});

const result = await executeSwap({
  provider: account,
  quote: quotes[0],
  slippage: 0.01,
  paymaster: {
    active: true,
    provider: paymaster,
    params: {
      feeMode: { mode: 'sponsored' },
    },
  },
});

console.log('Tx Hash:', result.transactionHash);
// User paid $0 in gas!
```

### Gasfree with starknet.js Directly

```typescript
import { PaymasterRpc, type PaymasterDetails } from 'starknet';
import { quoteToCalls } from '@avnu/avnu-sdk';

const paymaster = new PaymasterRpc({
  nodeUrl: 'https://starknet.paymaster.avnu.fi',
  headers: {
    'x-paymaster-api-key': process.env.AVNU_PAYMASTER_API_KEY!,
  },
});

// Build calls
const { calls } = await quoteToCalls({
  quote: quotes[0],
  takerAddress: account.address,
  slippage: 0.01,
  includeApprove: true,
});

// Sponsored fee mode (no gasToken needed)
const feeDetails: PaymasterDetails = {
  feeMode: { mode: 'sponsored' },
};

// Execute sponsored transaction
const result = await account.executePaymasterTransaction(calls, feeDetails);
const receipt = await account.waitForTransaction(result.transaction_hash);
```

### Gasfree Frontend Integration

For frontend dApps, the API key must stay server-side. Use a 3-phase pattern:

1. **Build** (Server): Prepare transaction with API key
2. **Sign** (Client): User signs with their wallet
3. **Execute** (Server): Submit with API key

See [gasfree-frontend.md](gasfree-frontend.md) for complete Next.js integration with Server Actions.

### Fallback Pattern: Gasfree → Gasless → Regular

```typescript
async function executeWithGasfreeFallback(
  account: Account,
  quote: Quote,
  slippage: number
) {
  const gasfreePaymaster = new PaymasterRpc({
    nodeUrl: 'https://starknet.paymaster.avnu.fi',
    headers: {
      'x-paymaster-api-key': process.env.AVNU_PAYMASTER_API_KEY!,
    },
  });

  const gaslessPaymaster = new PaymasterRpc({
    nodeUrl: 'https://starknet.api.avnu.fi/paymaster/v1',
  });

  // Try gasfree first (dApp pays)
  try {
    return await executeSwap({
      provider: account,
      quote,
      slippage,
      paymaster: {
        active: true,
        provider: gasfreePaymaster,
        params: { feeMode: { mode: 'sponsored' } },
      },
    });
  } catch (e) {
    console.log('Gasfree failed, trying gasless...');
  }

  // Fallback to gasless (user pays in token)
  try {
    return await executeSwap({
      provider: account,
      quote,
      slippage,
      paymaster: {
        active: true,
        provider: gaslessPaymaster,
        params: { feeMode: { mode: 'default', gasToken: TOKENS.USDC } },
      },
    });
  } catch (e) {
    console.log('Gasless failed, using regular ETH gas...');
  }

  // Final fallback to regular gas
  return await executeSwap({
    provider: account,
    quote,
    slippage,
  });
}
```

### Gasless vs Gasfree Comparison

| Aspect | Gasless (default) | Gasfree (sponsored) |
|--------|-------------------|---------------------|
| Who pays gas | User (in ERC-20 token) | dApp |
| API key | Not required | Required |
| Paymaster URL | `starknet.api.avnu.fi/paymaster/v1` | `starknet.paymaster.avnu.fi` |
| feeMode | `{ mode: 'default', gasToken: '0x...' }` | `{ mode: 'sponsored' }` |
| Frontend-safe | Yes | No (needs backend) |
| Best for | Users without ETH | Zero-friction UX |

### API Key Security

```typescript
// ❌ NEVER do this (API key exposed in client bundle)
const paymaster = new PaymasterRpc({
  headers: { 'x-paymaster-api-key': 'your-key-here' },
});

// ✅ Always use environment variables (server-side only)
const paymaster = new PaymasterRpc({
  nodeUrl: 'https://starknet.paymaster.avnu.fi',
  headers: { 'x-paymaster-api-key': process.env.AVNU_PAYMASTER_API_KEY! },
});

// ✅ For frontend: use Server Actions (see gasfree-frontend.md)
```

### Getting an API Key

1. Go to [portal.avnu.fi](https://portal.avnu.fi)
2. Connect using your starknet wallet
3. Create a new api key
4. Fund your key with some STRK on mainnet (free on Sepolia)
5. Add to your `.env` file (server-side only!):

```bash
AVNU_PAYMASTER_API_KEY=your-api-key-here
```
