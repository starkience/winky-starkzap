# DCA Guide

Complete reference for Dollar Cost Averaging (recurring buys) using the avnu SDK.

## DCA Order Configuration

```typescript
import { executeCreateDca, CreateDcaOrder } from '@avnu/avnu-sdk';
import moment from 'moment';

const dcaOrder: CreateDcaOrder = {
  // Required
  sellTokenAddress: '0x...',     // Token to sell (e.g., USDC)
  buyTokenAddress: '0x...',      // Token to buy (e.g., ETH)
  sellAmount: '100000000',       // Total amount to spend (100 USDC, 6 decimals)
  sellAmountPerCycle: '10000000', // Amount per execution (10 USDC)
  frequency: moment.duration(1, 'day'), // Execution interval
  traderAddress: '0x...',        // Your wallet address

  // Optional - Pricing Strategy
  pricingStrategy: {
    tokenToMinAmount: '3000000000',  // Min acceptable (3000 USDC per ETH)
    tokenToMaxAmount: '4000000000',  // Max acceptable (4000 USDC per ETH)
  },
};
```

## Frequency Options

```typescript
import moment from 'moment';

// Supported frequencies
const frequencies = {
  hourly: moment.duration(1, 'hour'),
  every4Hours: moment.duration(4, 'hours'),
  every8Hours: moment.duration(8, 'hours'),
  daily: moment.duration(1, 'day'),
  every2Days: moment.duration(2, 'days'),
  weekly: moment.duration(1, 'week'),
  biweekly: moment.duration(2, 'weeks'),
  monthly: moment.duration(1, 'month'),
};

// Calculate iterations
function calculateIterations(
  totalAmount: bigint,
  amountPerCycle: bigint
): number {
  return Number(totalAmount / amountPerCycle);
}

// Example: 100 USDC total, 10 USDC per cycle = 10 iterations
const iterations = calculateIterations(
  BigInt(100_000_000), // 100 USDC
  BigInt(10_000_000)   // 10 USDC per cycle
);
// Result: 10 executions over 10 days (if daily)
```

## Creating DCA Orders

### Using executeCreateDca (Recommended)

```typescript
import { executeCreateDca } from '@avnu/avnu-sdk';

const result = await executeCreateDca({
  provider: account,
  order: dcaOrder,
});

console.log('DCA Order Created');
console.log('Tx Hash:', result.transactionHash);
```

### Using createDcaToCalls (Manual Execution)

```typescript
import { createDcaToCalls } from '@avnu/avnu-sdk';

const { calls } = await createDcaToCalls(dcaOrder);

// Execute manually (useful for batching with other calls)
const tx = await account.execute(calls);
```

### With Paymaster (Gasless)

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
      feeMode: { mode: 'default', gasToken: USDC },
    },
  },
});
```

## Fetching DCA Orders

### Get All Orders

```typescript
import { getDcaOrders, DcaOrderStatus } from '@avnu/avnu-sdk';

// Get active orders
const activeOrders = await getDcaOrders({
  traderAddress: account.address,
  status: DcaOrderStatus.ACTIVE,
  page: 0,
  size: 20,
});

// Get all orders (any status)
const allOrders = await getDcaOrders({
  traderAddress: account.address,
  page: 0,
  size: 50,
});

// Pagination
console.log('Total orders:', allOrders.totalElements);
console.log('Current page:', allOrders.page);
console.log('Has more:', allOrders.hasNext);
```

### Order Status Values

```typescript
enum DcaOrderStatus {
  INDEXING = 'INDEXING',  // Order being indexed (just created)
  ACTIVE = 'ACTIVE',      // Order is executing
  CLOSED = 'CLOSED',      // Order completed or cancelled
}
```

### Order Structure

```typescript
interface DcaOrder {
  orderAddress: string;        // Unique order contract address
  creatorAddress: string;      // Trader's wallet
  sellTokenAddress: string;
  buyTokenAddress: string;
  sellAmount: string;          // Total amount to sell
  sellAmountPerCycle: string;  // Amount per execution
  frequency: number;           // Interval in seconds
  iterations: number;          // Total number of executions

  // Progress
  amountSold: string;          // Amount already sold
  amountBought: string;        // Amount already bought
  executedTradesCount: number; // Completed executions

  // Dates
  startDate: string;           // ISO date
  endDate: string;             // ISO date (estimated)

  // Status
  status: DcaOrderStatus;

  // Execution history
  trades: DcaTrade[];
}

interface DcaTrade {
  status: 'PENDING' | 'SUCCEEDED' | 'CANCELLED';
  sellAmount: string;
  buyAmount: string;
  expectedTradeDate: string;
  actualTradeDate: string | null;
  txHash: string | null;
}
```

## Monitoring Order Progress

```typescript
async function monitorDcaOrder(orderAddress: string) {
  const orders = await getDcaOrders({
    traderAddress: account.address,
    page: 0,
    size: 100,
  });

  const order = orders.content.find(o => o.orderAddress === orderAddress);
  if (!order) throw new Error('Order not found');

  const progress = order.executedTradesCount / order.iterations;

  console.log(`Order: ${order.orderAddress}`);
  console.log(`Status: ${order.status}`);
  console.log(`Progress: ${order.executedTradesCount}/${order.iterations} (${(progress * 100).toFixed(0)}%)`);
  console.log(`Sold: ${order.amountSold}`);
  console.log(`Bought: ${order.amountBought}`);

  // Average price
  if (BigInt(order.amountSold) > 0) {
    const avgPrice = BigInt(order.amountSold) / BigInt(order.amountBought);
    console.log(`Avg Price: ${avgPrice}`);
  }

  // Next execution
  const pendingTrade = order.trades.find(t => t.status === 'PENDING');
  if (pendingTrade) {
    console.log(`Next execution: ${pendingTrade.expectedTradeDate}`);
  }
}
```

## Cancelling DCA Orders

```typescript
import { executeCancelDca, cancelDcaToCalls } from '@avnu/avnu-sdk';

// Using executeCancelDca
const result = await executeCancelDca({
  provider: account,
  orderAddress: '0xOrderAddress...',
});

// Using cancelDcaToCalls (manual)
const { calls } = await cancelDcaToCalls('0xOrderAddress...');
const tx = await account.execute(calls);
```

### What Happens on Cancel

1. Remaining unexecuted cycles are cancelled
2. Any unused funds are returned to your wallet
3. Already executed trades are not affected
4. Order status changes to `CLOSED`

## Pricing Strategy

Use pricing strategy to set acceptable price ranges:

```typescript
const dcaOrder = {
  sellTokenAddress: USDC,
  buyTokenAddress: ETH,
  sellAmount: '1000000000',        // 1000 USDC
  sellAmountPerCycle: '100000000', // 100 USDC per cycle
  frequency: moment.duration(1, 'day'),
  traderAddress: account.address,

  // Only execute if ETH price is between $2500 and $3500
  pricingStrategy: {
    // Min ETH per 100 USDC = 100/3500 = 0.0285 ETH
    tokenToMinAmount: '28500000000000000', // 0.0285 ETH (18 decimals)
    // Max ETH per 100 USDC = 100/2500 = 0.04 ETH
    tokenToMaxAmount: '40000000000000000', // 0.04 ETH
  },
};
```

### Pricing Strategy Logic

- If price is **above max**: Execution skipped, retried next cycle
- If price is **below min**: Execution skipped (you're getting less than expected)
- If price is **in range**: Execution proceeds

### No Pricing Strategy

Without pricing strategy, executions happen at market price regardless of conditions.

## Order Lifecycle

```
Created (INDEXING)
    │
    ▼
Active (ACTIVE)
    │
    ├──► Execute Cycle 1 ──► Trade SUCCEEDED/CANCELLED
    │
    ├──► Execute Cycle 2 ──► Trade SUCCEEDED/CANCELLED
    │
    ├──► ... (continues until all cycles complete)
    │
    ▼
Completed (CLOSED)

OR

Active (ACTIVE)
    │
    ├──► User cancels ──► Refund remaining funds
    │
    ▼
Cancelled (CLOSED)
```

## Best Practices

### Choosing Frequency

| Goal | Recommended Frequency |
|------|----------------------|
| Minimize volatility impact | Hourly or every 4 hours |
| Balance gas costs | Daily |
| Long-term accumulation | Weekly |
| Large amounts | Weekly or monthly |

### Amount Sizing

```typescript
// Rule of thumb: Each execution should be at least $10-20
// to make gas costs worthwhile

const minExecutionValue = 10; // USD
const gasEstimate = 0.50;     // USD per execution

// If selling USDC to buy ETH
const sellAmountPerCycle = Math.max(
  minExecutionValue + gasEstimate * 2, // Buffer for gas fluctuation
  20 // $20 minimum
);
```

### Token Decimals

Always account for token decimals:

```typescript
// USDC has 6 decimals
const usdcAmount = (amount: number) => BigInt(amount * 1e6);

// ETH/STRK have 18 decimals
const ethAmount = (amount: number) => BigInt(amount * 1e18);

// Example: DCA 100 USDC into ETH, 10 USDC per day
const order = {
  sellAmount: usdcAmount(100).toString(),
  sellAmountPerCycle: usdcAmount(10).toString(),
  // ...
};
```
