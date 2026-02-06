# Swap Guide

Complete reference for token swaps using the avnu SDK.

## Quote Request Parameters

```typescript
import { getQuotes, QuoteRequest } from '@avnu/avnu-sdk';

const request: QuoteRequest = {
  // Required
  sellTokenAddress: '0x...', // Token to sell
  buyTokenAddress: '0x...',  // Token to buy
  sellAmount: BigInt(1e18),  // Amount in wei (use this OR buyAmount)

  // Optional
  buyAmount: BigInt(1e6),    // Exact output amount (alternative to sellAmount)
  takerAddress: '0x...',     // Wallet address (enables gas estimation)
  size: 3,                   // Number of quotes to return (default: 1)
  excludeSources: ['Ekubo'], // Exclude specific DEXs
  integratorFees: BigInt(50),         // Fee in bps (50 = 0.5%)
  integratorFeeRecipient: '0x...',    // Fee recipient address
  integratorName: 'MyDapp',           // For analytics
};

const quotes = await getQuotes(request);
```

## Quote Response Structure

```typescript
interface Quote {
  quoteId: string;           // Unique ID for building transaction
  sellTokenAddress: string;
  buyTokenAddress: string;
  sellAmount: bigint;        // Input amount
  buyAmount: bigint;         // Output amount (before fees)
  buyAmountWithoutFees: bigint;
  buyAmountInUsd: number;
  sellAmountInUsd: number;

  // Price analysis
  priceImpact: number;       // In basis points (20 = 0.2%), negative = loss
  priceRatioUsd: number;     // USD value ratio

  // Gas
  gasFees: bigint;           // In FRI
  gasFeesInUsd: number;

  // Fees
  fee: {
    avnuFees: bigint;
    avnuFeesBps: number;
    integratorFees: bigint;
    integratorFeesBps: number;
  };

  // Routing
  routes: Route[];           // DEX routing breakdown
  exactTokenTo: boolean;     // true if exact output swap
  estimatedSlippage: number; // SDK-estimated slippage
}

interface Route {
  name: string;              // DEX name (Jediswap, Ekubo, etc.)
  percent: number;           // Percentage through this route
  routes: Route[];           // Nested sub-routes
}
```

## Route Analysis

```typescript
const quote = quotes[0];

// Analyze routing
quote.routes.forEach(route => {
  console.log(`${route.name}: ${route.percent * 100}%`);

  // Check for split routes
  if (route.routes.length > 0) {
    route.routes.forEach(sub => {
      console.log(`  └─ ${sub.name}: ${sub.percent * 100}%`);
    });
  }
});

// Common route patterns:
// - Single DEX: 100% through one source
// - Split: 60% Jediswap, 40% Ekubo
// - Multi-hop: ETH → USDC → STRK
```

## Price Impact Analysis

```typescript
// Price impact thresholds (in basis points, divide by 100 for %)
const IMPACT_LOW = 10;       // < 0.1%
const IMPACT_MEDIUM = 100;   // < 1%
const IMPACT_HIGH = 500;     // < 5%
const IMPACT_SEVERE = 1000;  // > 10%

function analyzePriceImpact(quote: Quote): string {
  const impact = Math.abs(quote.priceImpact); // Negative = loss

  if (impact < IMPACT_LOW) return 'Excellent';
  if (impact < IMPACT_MEDIUM) return 'Good';
  if (impact < IMPACT_HIGH) return 'Moderate - consider smaller trade';
  if (impact < IMPACT_SEVERE) return 'High - split into multiple trades';
  return 'Severe - trade not recommended';
}
```

## Multi-Quote Comparison

```typescript
// Get multiple quotes
const quotes = await getQuotes({
  sellTokenAddress: ETH,
  buyTokenAddress: USDC,
  sellAmount: BigInt(10e18),
  size: 5,
});

// Compare quotes
quotes.forEach((quote, i) => {
  console.log(`Quote ${i + 1}:`);
  console.log(`  Buy: ${quote.buyAmount} (${quote.buyAmountInUsd} USD)`);
  console.log(`  Impact: ${(quote.priceImpact / 100).toFixed(2)}%`); // basis points to %
  console.log(`  Gas: ${quote.gasFeesInUsd.toFixed(4)} USD`);
  console.log(`  Routes: ${quote.routes.map(r => r.name).join(' + ')}`);
});

// Best quote is always first, but sometimes:
// - Quote 2 might have lower gas
// - Quote 3 might have lower price impact
```

## Slippage Strategies

### Auto Slippage

```typescript
// SDK can estimate optimal slippage
const quote = quotes[0];
if (quote.estimatedSlippage) {
  // Use SDK estimate (typically 0.5-2%)
  const slippage = quote.estimatedSlippage;
}
```

### Manual Slippage by Token Type

| Token Category | Slippage | Rationale |
|----------------|----------|-----------|
| Stablecoin pairs (USDC/USDT) | 0.1% | Prices tightly pegged |
| Major tokens (ETH, STRK) | 0.5-1% | Good liquidity |
| Mid-cap tokens | 1-2% | Moderate volatility |
| Low-cap/new tokens | 2-5% | High volatility, low liquidity |
| During high volatility | +1-2% | Markets moving fast |

### Slippage Helper Functions

```typescript
import { calculateMinReceivedAmount, calculateMaxSpendAmount } from '@avnu/avnu-sdk';

const slippage = 0.01; // 1%

// For exact input swaps (selling exact amount)
const minReceived = calculateMinReceivedAmount(quote.buyAmount, slippage);

// For exact output swaps (buying exact amount)
const maxSpend = calculateMaxSpendAmount(quote.sellAmount, slippage);
```

## Building Swap Calls

### Using quoteToCalls (Recommended)

```typescript
import { quoteToCalls } from '@avnu/avnu-sdk';

const { chainId, calls } = await quoteToCalls({
  quote: quotes[0],
  takerAddress: account.address,
  slippage: 0.01,
  includeApprove: true, // Include approval if needed
});

// calls includes:
// 1. Token approval (if includeApprove && needed)
// 2. Swap call
```

### Manual Execution

```typescript
// Execute with custom logic
const tx = await account.execute(calls);
await account.waitForTransaction(tx.transaction_hash);
```

## Handling Quote Expiry

Quotes are valid for approximately 30 seconds. Handle expiry:

```typescript
async function executeWithFreshQuote(
  request: QuoteRequest,
  slippage: number,
  maxRetries = 3
) {
  for (let i = 0; i < maxRetries; i++) {
    const quotes = await getQuotes(request);
    const quote = quotes[0];

    try {
      return await executeSwap({
        provider: account,
        quote,
        slippage,
        executeApprove: true,
      });
    } catch (error: any) {
      if (error.message?.includes('QUOTE_EXPIRED') && i < maxRetries - 1) {
        console.log('Quote expired, refreshing...');
        continue;
      }
      throw error;
    }
  }
}
```

## Edge Cases

### No Liquidity

```typescript
try {
  const quotes = await getQuotes(request);
  if (quotes.length === 0) {
    console.log('No route found. Try:');
    console.log('1. Reduce trade size');
    console.log('2. Use a different token pair');
    console.log('3. Try multi-hop through a major token');
  }
} catch (error: any) {
  if (error.message?.includes('INSUFFICIENT_LIQUIDITY')) {
    // Handle no liquidity
  }
}
```

### Large Trades

For large trades (>$100k), consider:

```typescript
// 1. Split into smaller chunks
const chunks = 5;
const chunkAmount = totalAmount / BigInt(chunks);

for (let i = 0; i < chunks; i++) {
  await executeSwap({
    provider: account,
    quote: await getQuotes({ ...request, sellAmount: chunkAmount })[0],
    slippage: 0.01,
  });
  // Wait between trades to let liquidity rebalance
  await new Promise(r => setTimeout(r, 5000));
}

// 2. Use limit orders / TWAP (Time-Weighted Average Price)
// Contact avnu for institutional trading features
```

### Integrator Fees

```typescript
const quotes = await getQuotes({
  sellTokenAddress: ETH,
  buyTokenAddress: USDC,
  sellAmount: BigInt(1e18),
  integratorFees: BigInt(50),           // 0.5% = 50 bps
  integratorFeeRecipient: '0xYourWallet',
  integratorName: 'MyDapp',
});

// Fee is deducted from buy amount
// quote.buyAmount already reflects this deduction
// quote.fee.integratorFees shows your fee amount
```
