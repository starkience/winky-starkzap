# Error Handling Guide

Complete reference for handling errors when using the avnu SDK.

## Error Categories

| Category | Examples | Recovery Strategy |
|----------|----------|-------------------|
| **Quote Errors** | No liquidity, quote expired | Retry with different params |
| **Execution Errors** | Slippage exceeded, insufficient balance | User action required |
| **Network Errors** | RPC timeout, connection failed | Automatic retry |
| **Contract Errors** | Revert, out of gas | Debug and fix |
| **Paymaster Errors** | Rejected, insufficient gas token | Fallback to regular tx |

## Quote Errors

### INSUFFICIENT_LIQUIDITY

No route found between tokens.

```typescript
try {
  const quotes = await getQuotes(request);
} catch (error: any) {
  if (error.message?.includes('INSUFFICIENT_LIQUIDITY')) {
    console.log('No route available. Suggestions:');
    console.log('1. Reduce trade amount');
    console.log('2. Try a different token pair');
    console.log('3. Route through a major token (ETH, USDC)');
  }
}
```

**Solutions:**
- Reduce the trade amount
- Try routing through intermediate tokens
- Check if the token is listed on any DEX

### QUOTE_EXPIRED

Quote is too old to execute (typically >30 seconds).

```typescript
async function executeWithFreshQuote(request: QuoteRequest, slippage: number) {
  const maxRetries = 3;

  for (let i = 0; i < maxRetries; i++) {
    const quotes = await getQuotes(request);

    try {
      return await executeSwap({
        provider: account,
        quote: quotes[0],
        slippage,
        executeApprove: true,
      });
    } catch (error: any) {
      if (error.message?.includes('QUOTE_EXPIRED')) {
        console.log(`Quote expired, refreshing... (attempt ${i + 1}/${maxRetries})`);
        continue;
      }
      throw error;
    }
  }

  throw new Error('Failed after max retries');
}
```

**Solutions:**
- Fetch a fresh quote before executing
- Reduce time between quote and execution

## Execution Errors

### SLIPPAGE_EXCEEDED

Price moved beyond tolerance during execution.

```typescript
try {
  await executeSwap({ provider: account, quote, slippage: 0.01 });
} catch (error: any) {
  if (error.message?.includes('SLIPPAGE_EXCEEDED') ||
      error.message?.includes('Insufficient tokens received')) {
    console.log('Price moved too much. Options:');
    console.log('1. Increase slippage tolerance');
    console.log('2. Refresh quote and retry');
    console.log('3. Wait for less volatile conditions');
  }
}
```

**Solutions:**
- Increase slippage tolerance
- Fetch new quote and retry immediately
- Use smaller trade sizes in volatile markets

### INSUFFICIENT_BALANCE

User doesn't have enough tokens.

```typescript
import { Contract, uint256 } from 'starknet';

async function checkBalance(
  tokenAddress: string,
  account: Account,
  requiredAmount: bigint
): Promise<boolean> {
  const tokenContract = new Contract(
    ERC20_ABI,
    tokenAddress,
    account
  );

  const balance = await tokenContract.balanceOf(account.address);
  const balanceBigInt = uint256.uint256ToBN(balance);

  if (balanceBigInt < requiredAmount) {
    console.log('Insufficient balance');
    console.log('Required:', requiredAmount.toString());
    console.log('Available:', balanceBigInt.toString());
    return false;
  }

  return true;
}

// Check before swap
const hasBalance = await checkBalance(
  TOKENS.ETH,
  account,
  quote.sellAmount
);

if (!hasBalance) {
  throw new Error('Insufficient balance for swap');
}
```

### APPROVAL_FAILED

Token approval transaction failed.

```typescript
try {
  await executeSwap({
    provider: account,
    quote,
    slippage: 0.01,
    executeApprove: true,
  });
} catch (error: any) {
  if (error.message?.includes('APPROVAL_FAILED')) {
    console.log('Token approval failed. Trying manual approval...');

    // Manual approval
    const tokenContract = new Contract(ERC20_ABI, quote.sellTokenAddress, account);
    await tokenContract.approve(AVNU_ROUTER, quote.sellAmount);

    // Retry without auto-approve
    await executeSwap({
      provider: account,
      quote,
      slippage: 0.01,
      executeApprove: false,
    });
  }
}
```

## Network Errors

### RPC_TIMEOUT

Request timed out.

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const isRetryable =
        error.message?.includes('timeout') ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('fetch failed');

      if (isRetryable && i < maxRetries - 1) {
        console.log(`Retrying... (${i + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay * (i + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

// Usage
const quotes = await withRetry(() => getQuotes(request));
```

### Using AbortSignal

```typescript
const controller = new AbortController();

// Set timeout
const timeoutId = setTimeout(() => controller.abort(), 10000);

try {
  const quotes = await getQuotes(request, {
    abortSignal: controller.signal,
  });
} catch (error: any) {
  if (error.name === 'AbortError') {
    console.log('Request was cancelled or timed out');
  }
} finally {
  clearTimeout(timeoutId);
}
```

## Contract Errors

### Parsing Revert Reasons

```typescript
function parseRevertError(error: any): string {
  const message = error.message || '';

  // Common revert patterns
  if (message.includes('Insufficient tokens received')) {
    return 'Slippage exceeded - price moved too much';
  }
  if (message.includes('Withdrawal limit reached')) {
    return 'Token has withdrawal limits';
  }
  if (message.includes('hodl limit active')) {
    return 'Token has hold limits (anti-bot)';
  }
  if (message.includes('u256_sub Overflow')) {
    return 'Insufficient balance';
  }
  if (message.includes('not enough allowance')) {
    return 'Token approval needed';
  }

  return 'Contract error: ' + message;
}
```

### Transaction Reverted

```typescript
try {
  const tx = await account.execute(calls);
  const receipt = await account.waitForTransaction(tx.transaction_hash);

  if (receipt.execution_status === 'REVERTED') {
    console.log('Transaction reverted');
    console.log('Revert reason:', receipt.revert_reason);

    // Parse and handle specific revert reasons
    const reason = parseRevertError({ message: receipt.revert_reason });
    console.log('Parsed reason:', reason);
  }
} catch (error) {
  console.log('Execution failed:', error);
}
```

## Paymaster Errors

### PAYMASTER_REJECTED

Transaction not eligible for sponsorship.

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
    return await executeSwap({
      provider: account,
      quote,
      slippage,
      paymaster: {
        active: true,
        provider: paymaster,
        params: {
          feeMode: { mode: 'sponsored' },
        },
      },
    });
  } catch (error: any) {
    if (error.message?.includes('PAYMASTER_REJECTED')) {
      console.log('Sponsorship unavailable, using regular gas');
      return await executeSwap({
        provider: account,
        quote,
        slippage,
      });
    }
    throw error;
  }
}
```

### INSUFFICIENT_GAS_TOKEN

User doesn't have enough of the gas token for gasless mode.

```typescript
try {
  await executeSwap({
    provider: account,
    quote,
    slippage: 0.01,
    paymaster: {
      active: true,
      provider: paymaster,
      params: {
        feeMode: {
          mode: 'gasless',
          gasTokenAddress: TOKENS.USDC,
          maxGasTokenAmount: BigInt(5e6),
        },
      },
    },
  });
} catch (error: any) {
  if (error.message?.includes('INSUFFICIENT_GAS_TOKEN')) {
    console.log('Not enough USDC for gas. Options:');
    console.log('1. Add more USDC to wallet');
    console.log('2. Use a different gas token');
    console.log('3. Use regular ETH for gas');
  }
}
```

## Comprehensive Error Handler

```typescript
interface ErrorResult {
  code: string;
  message: string;
  recoverable: boolean;
  suggestion: string;
}

function handleAvnuError(error: any): ErrorResult {
  const message = error.message || String(error);

  // Quote errors
  if (message.includes('INSUFFICIENT_LIQUIDITY')) {
    return {
      code: 'INSUFFICIENT_LIQUIDITY',
      message: 'No route found for this trade',
      recoverable: true,
      suggestion: 'Try reducing the amount or using a different token pair',
    };
  }

  if (message.includes('QUOTE_EXPIRED')) {
    return {
      code: 'QUOTE_EXPIRED',
      message: 'Quote has expired',
      recoverable: true,
      suggestion: 'Refresh the quote and try again',
    };
  }

  // Execution errors
  if (message.includes('SLIPPAGE_EXCEEDED') ||
      message.includes('Insufficient tokens received')) {
    return {
      code: 'SLIPPAGE_EXCEEDED',
      message: 'Price moved too much during execution',
      recoverable: true,
      suggestion: 'Increase slippage tolerance or try again',
    };
  }

  if (message.includes('u256_sub Overflow') ||
      message.includes('INSUFFICIENT_BALANCE')) {
    return {
      code: 'INSUFFICIENT_BALANCE',
      message: 'Not enough tokens in wallet',
      recoverable: false,
      suggestion: 'Add more tokens to your wallet',
    };
  }

  // Paymaster errors
  if (message.includes('PAYMASTER_REJECTED')) {
    return {
      code: 'PAYMASTER_REJECTED',
      message: 'Transaction not eligible for gas sponsorship',
      recoverable: true,
      suggestion: 'Try using regular gas or check eligibility',
    };
  }

  // Network errors
  if (message.includes('timeout') || message.includes('fetch failed')) {
    return {
      code: 'NETWORK_ERROR',
      message: 'Network request failed',
      recoverable: true,
      suggestion: 'Check your internet connection and try again',
    };
  }

  // Unknown error
  return {
    code: 'UNKNOWN_ERROR',
    message: message,
    recoverable: false,
    suggestion: 'Contact support if the issue persists',
  };
}

// Usage
try {
  await executeSwap({ ... });
} catch (error) {
  const result = handleAvnuError(error);

  console.log(`Error [${result.code}]: ${result.message}`);
  console.log(`Suggestion: ${result.suggestion}`);

  if (result.recoverable) {
    // Could retry or show retry button
  }
}
```

## Logging Best Practices

```typescript
// Log enough context for debugging
function logSwapAttempt(
  quote: Quote,
  slippage: number,
  result: 'success' | 'error',
  error?: any
) {
  const log = {
    timestamp: new Date().toISOString(),
    action: 'swap',
    sellToken: quote.sellTokenAddress,
    buyToken: quote.buyTokenAddress,
    sellAmount: quote.sellAmount.toString(),
    buyAmount: quote.buyAmount.toString(),
    slippage,
    quoteId: quote.quoteId,
    result,
    error: error ? {
      message: error.message,
      code: handleAvnuError(error).code,
    } : undefined,
  };

  console.log(JSON.stringify(log));
}
```
