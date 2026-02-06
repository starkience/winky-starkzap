# Tokens & Prices Guide

Complete reference for token lists and market data using the avnu SDK.

## Fetching Tokens

### Basic Token List

```typescript
import { fetchTokens } from '@avnu/avnu-sdk';

const page = await fetchTokens();

page.content.forEach(token => {
  console.log(`${token.symbol}: ${token.address}`);
  console.log(`  Decimals: ${token.decimals}`);
  console.log(`  Tags: ${token.tags.join(', ')}`);
  console.log(`  Daily Volume: $${token.lastDailyVolumeUsd}`);
});
```

### Paginated Fetching

```typescript
const page = await fetchTokens({
  page: 0,      // 0-indexed page number
  size: 50,     // Tokens per page (max: 100)
});

console.log('Total tokens:', page.totalElements);
console.log('Total pages:', page.totalPages);
console.log('Current page:', page.number);
console.log('Has next:', page.hasNext);
```

### Fetch All Tokens

```typescript
async function fetchAllTokens(): Promise<Token[]> {
  const allTokens: Token[] = [];
  let currentPage = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await fetchTokens({ page: currentPage, size: 100 });
    allTokens.push(...result.content);
    hasMore = result.hasNext;
    currentPage++;
  }

  return allTokens;
}
```

### Filtering by Tags

```typescript
// Only verified tokens
const verified = await fetchTokens({
  tags: ['Verified'],
});

// Multiple tags (OR logic)
const safeTokens = await fetchTokens({
  tags: ['Verified', 'Unruggable'],
});
```

### Search Tokens

```typescript
// Search by name, symbol, or address
const results = await fetchTokens({
  search: 'ETH',
});

// Search by partial address
const results2 = await fetchTokens({
  search: '0x049d3657',
});
```

## Token Tags

| Tag | Description | Trust Level |
|-----|-------------|-------------|
| `Verified` | Audited, well-known tokens | High |
| `Unruggable` | Has anti-rug mechanisms | High |
| `AVNU` | Official avnu tokens | High |
| `Community` | Community-listed | Medium |
| `Unknown` | Not verified | Low |

### Filtering Strategy

```typescript
// For trading apps - only show safe tokens
const tradingTokens = await fetchTokens({
  tags: ['Verified', 'Unruggable'],
});

// For explorers - show all but warn on Unknown
const allTokens = await fetchTokens();
const unknown = allTokens.content.filter(t => t.tags.includes('Unknown'));
```

## Fetch Token by Address

```typescript
import { fetchTokenByAddress } from '@avnu/avnu-sdk';

const eth = await fetchTokenByAddress(
  '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7'
);

console.log(eth.name);      // "Ether"
console.log(eth.symbol);    // "ETH"
console.log(eth.decimals);  // 18
console.log(eth.tags);      // ["Verified"]
console.log(eth.logoUri);   // URL to logo image
```

## Fetch Verified Token by Symbol

```typescript
import { fetchVerifiedTokenBySymbol } from '@avnu/avnu-sdk';

try {
  const eth = await fetchVerifiedTokenBySymbol('ETH');
  const strk = await fetchVerifiedTokenBySymbol('STRK');
  const usdc = await fetchVerifiedTokenBySymbol('USDC');

  console.log('ETH:', eth.address);
  console.log('STRK:', strk.address);
  console.log('USDC:', usdc.address);
} catch (error) {
  // Token not found or not verified
  console.error('Token not found');
}
```

## Token Structure

```typescript
interface Token {
  address: string;           // Contract address
  name: string;              // Full name (e.g., "Ether")
  symbol: string;            // Symbol (e.g., "ETH")
  decimals: number;          // Token decimals (e.g., 18)
  logoUri: string | null;    // URL to logo image
  lastDailyVolumeUsd: number; // 24h trading volume
  tags: TokenTag[];          // Trust/category tags
  extensions: {              // Additional metadata
    [key: string]: string;
  };
}

type TokenTag = 'Unknown' | 'Verified' | 'Community' | 'Unruggable' | 'AVNU';
```

## Getting Token Prices

### Current Prices

```typescript
import { getPrices } from '@avnu/avnu-sdk';

const prices = await getPrices([
  '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7', // ETH
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d', // STRK
  '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8', // USDC
]);

prices.forEach(price => {
  console.log('Token:', price.address);
  console.log('Decimals:', price.decimals);

  // Global market price (from aggregated sources like CoinGecko)
  if (price.globalMarket) {
    console.log('Global Price:', price.globalMarket.usd);
  }

  // Starknet-specific price (from on-chain liquidity)
  if (price.starknetMarket) {
    console.log('Starknet Price:', price.starknetMarket.usd);
  }
});
```

### Price Structure

```typescript
interface TokenPrice {
  address: string;
  decimals: number;
  globalMarket: {
    usd: number;           // Price in USD
  } | null;
  starknetMarket: {
    usd: number;           // Price on Starknet
  } | null;
}
```

### Price Arbitrage Detection

```typescript
async function checkArbitrage(tokenAddress: string): Promise<number> {
  const [price] = await getPrices([tokenAddress]);

  if (!price.globalMarket || !price.starknetMarket) {
    return 0;
  }

  const global = price.globalMarket.usd;
  const starknet = price.starknetMarket.usd;
  const diff = ((starknet - global) / global) * 100;

  console.log(`Price difference: ${diff.toFixed(2)}%`);
  return diff;
}
```

## Common Token Addresses

```typescript
const MAINNET_TOKENS = {
  ETH: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
  STRK: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  USDC: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
  USDT: '0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8',
  DAI: '0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3',
  WBTC: '0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac',
};

const SEPOLIA_TOKENS = {
  ETH: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
  STRK: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  // Test tokens may differ - check docs
};
```

## Building a Token Selector

```typescript
interface TokenSelectorOption {
  address: string;
  symbol: string;
  name: string;
  logoUri: string | null;
  priceUsd: number | null;
  isVerified: boolean;
}

async function getTokenOptions(): Promise<TokenSelectorOption[]> {
  // Get verified tokens
  const tokens = await fetchTokens({
    tags: ['Verified'],
    size: 100,
  });

  // Get prices for all tokens
  const addresses = tokens.content.map(t => t.address);
  const prices = await getPrices(addresses);
  const priceMap = new Map(prices.map(p => [p.address, p]));

  return tokens.content.map(token => ({
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    logoUri: token.logoUri,
    priceUsd: priceMap.get(token.address)?.starknetMarket?.usd ?? null,
    isVerified: token.tags.includes('Verified'),
  }));
}
```

## Calculating Token Values

```typescript
async function getTokenValue(
  tokenAddress: string,
  amount: bigint,
  decimals: number
): Promise<number> {
  const [price] = await getPrices([tokenAddress]);

  if (!price.starknetMarket) {
    throw new Error('Price not available');
  }

  // Convert from wei to decimal
  const decimalAmount = Number(amount) / Math.pow(10, decimals);
  return decimalAmount * price.starknetMarket.usd;
}

// Example: Get USD value of 1.5 ETH
const ethValue = await getTokenValue(
  MAINNET_TOKENS.ETH,
  BigInt(1.5e18),
  18
);
console.log('Value: $', ethValue.toFixed(2));
```

## Token Extensions

Some tokens have additional metadata in the `extensions` field:

```typescript
const token = await fetchTokenByAddress(tokenAddress);

// Check for website
if (token.extensions.website) {
  console.log('Website:', token.extensions.website);
}

// Check for social links
if (token.extensions.twitter) {
  console.log('Twitter:', token.extensions.twitter);
}

// Check for coingecko ID (for additional data)
if (token.extensions.coingeckoId) {
  console.log('CoinGecko:', token.extensions.coingeckoId);
}
```

## Best Practices

### Caching Token Data

```typescript
// Token metadata changes infrequently
// Cache for at least 5 minutes
const TOKEN_CACHE_TTL = 5 * 60 * 1000;

let tokenCache: Map<string, { token: Token; timestamp: number }> = new Map();

async function getCachedToken(address: string): Promise<Token> {
  const cached = tokenCache.get(address);

  if (cached && Date.now() - cached.timestamp < TOKEN_CACHE_TTL) {
    return cached.token;
  }

  const token = await fetchTokenByAddress(address);
  tokenCache.set(address, { token, timestamp: Date.now() });
  return token;
}
```

### Price Refresh Strategy

```typescript
// Prices are more volatile - refresh frequently for trading
// but can be cached for display purposes

// Trading: Fetch fresh each time
// Display: Cache for 30 seconds
// Portfolio: Cache for 1-5 minutes
```
