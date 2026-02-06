# Configuration Guide

Complete reference for setting up and configuring the avnu SDK.

## Installation

```bash
# npm
npm install @avnu/avnu-sdk starknet

# yarn
yarn add @avnu/avnu-sdk starknet

# pnpm
pnpm add @avnu/avnu-sdk starknet
```

### Peer Dependencies

The SDK requires `starknet` as a peer dependency:

```json
{
  "dependencies": {
    "@avnu/avnu-sdk": "latest",
    "starknet": "latest"
  }
}
```

For DCA functionality, you'll also need `moment`:

```bash
npm install moment
```

## Environment Variables

### Required Variables (Direct Account)

```bash
# .env
STARKNET_ACCOUNT_ADDRESS=0x1234567890abcdef...
STARKNET_PRIVATE_KEY=0xabcdef1234567890...
```

### Optional Variables

```bash
# Custom RPC endpoint (default: public RPC)
STARKNET_RPC_URL=https://rpc.starknet.lava.build

# For gasfree (sponsored) transactions - dApp pays gas
# Get your key at https://portal.avnu.fi
AVNU_PAYMASTER_API_KEY=your-paymaster-api-key

# For testnet development
STARKNET_NETWORK=sepolia
```

> ⚠️ **Security Warning**: `AVNU_PAYMASTER_API_KEY` must NEVER be exposed in frontend code. Only use it in server-side code (Node.js scripts, Server Actions, API routes). See [gasfree-frontend.md](gasfree-frontend.md) for secure frontend patterns.

### .env.example Template

```bash
# Starknet Account Configuration
# NEVER commit your private key!
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...

# RPC Configuration
# Default: https://rpc.starknet.lava.build
STARKNET_RPC_URL=

# Network: mainnet or sepolia
STARKNET_NETWORK=mainnet

# Gasfree (Sponsored) Transactions
# Get your key at: https://portal.avnu.fi
# WARNING: Keep server-side only, never expose in frontend!
AVNU_PAYMASTER_API_KEY=
```

## Account Setup

### Direct Account (Scripts/Backend)

```typescript
import { Account, RpcProvider } from 'starknet';
import 'dotenv/config';

// Validate environment
if (!process.env.STARKNET_ACCOUNT_ADDRESS) {
  throw new Error('STARKNET_ACCOUNT_ADDRESS is required');
}
if (!process.env.STARKNET_PRIVATE_KEY) {
  throw new Error('STARKNET_PRIVATE_KEY is required');
}

// Setup provider
const provider = new RpcProvider({
  nodeUrl: process.env.STARKNET_RPC_URL || 'https://rpc.starknet.lava.build',
});

// Setup account
const account = new Account(
  provider,
  process.env.STARKNET_ACCOUNT_ADDRESS,
  process.env.STARKNET_PRIVATE_KEY
);
```

### Wallet Account (Frontend)

```typescript
import { WalletAccount, RpcProvider } from 'starknet';

const provider = new RpcProvider({
  nodeUrl: 'https://rpc.starknet.lava.build',
});

// Using get-starknet or wallet SDK
async function connectWallet() {
  // Example with get-starknet
  const starknet = await connect();

  if (starknet.isConnected) {
    const account = new WalletAccount(
      provider,
      starknet.account
    );
    return account;
  }

  throw new Error('Wallet not connected');
}
```

## SDK Options

### AvnuOptions Interface

```typescript
import { AvnuOptions } from '@avnu/avnu-sdk';

const options: AvnuOptions = {
  // Main API base URL
  baseUrl: 'https://starknet.api.avnu.fi', // Default for mainnet

  // DCA (Impulse) API base URL
  impulseBaseUrl: 'https://starknet.impulse.avnu.fi', // Default for mainnet

  // Request cancellation
  abortSignal: controller.signal,

  // Response signature verification (optional)
  avnuPublicKey: '0x...',
};
```

### Network Configuration

```typescript
const NETWORKS = {
  mainnet: {
    baseUrl: 'https://starknet.api.avnu.fi',
    impulseBaseUrl: 'https://starknet.impulse.avnu.fi',
    rpcUrl: 'https://rpc.starknet.lava.build',
  },
  sepolia: {
    baseUrl: 'https://sepolia.api.avnu.fi',
    impulseBaseUrl: 'https://sepolia.impulse.avnu.fi',
    rpcUrl: 'https://rpc.starknet-sepolia.lava.build',
  },
};

function getNetworkConfig(network: 'mainnet' | 'sepolia') {
  return NETWORKS[network];
}

// Usage
const config = getNetworkConfig(process.env.STARKNET_NETWORK as 'mainnet' | 'sepolia' || 'mainnet');
```

### Creating a Configured SDK Instance

```typescript
import { getQuotes, executeSwap, AvnuOptions } from '@avnu/avnu-sdk';

class AvnuClient {
  private options: AvnuOptions;
  private account: Account;

  constructor(account: Account, network: 'mainnet' | 'sepolia' = 'mainnet') {
    this.account = account;
    this.options = {
      baseUrl: NETWORKS[network].baseUrl,
      impulseBaseUrl: NETWORKS[network].impulseBaseUrl,
    };
  }

  async getQuotes(request: QuoteRequest) {
    return getQuotes(request, this.options);
  }

  async swap(request: QuoteRequest, slippage: number) {
    const quotes = await this.getQuotes(request);
    return executeSwap({
      provider: this.account,
      quote: quotes[0],
      slippage,
      executeApprove: true,
    });
  }
}
```

## RPC Providers

### Public RPC Endpoints

| Provider | Mainnet URL | Rate Limit |
|----------|-------------|------------|
| Lava | `https://rpc.starknet.lava.build` | Free tier |
| Infura | `https://starknet-mainnet.infura.io/v3/{KEY}` | Free tier |
| Alchemy | `https://starknet-mainnet.g.alchemy.com/v2/{KEY}` | Free tier |

### Using Custom RPC

```typescript
import { RpcProvider } from 'starknet';

// With API key
const provider = new RpcProvider({
  nodeUrl: `https://starknet-mainnet.infura.io/v3/${process.env.INFURA_KEY}`,
});

// With custom headers
const provider = new RpcProvider({
  nodeUrl: 'https://your-rpc-endpoint.com',
  headers: {
    'Authorization': `Bearer ${process.env.RPC_TOKEN}`,
  },
});
```

## Security Best Practices

### Private Key Management

```typescript
// NEVER do this
const privateKey = '0x1234...'; // Hardcoded private key

// ALWAYS use environment variables
const privateKey = process.env.STARKNET_PRIVATE_KEY;

// Validate before use
if (!privateKey) {
  throw new Error('Private key not configured');
}

// For production: Use secret managers
// AWS Secrets Manager, HashiCorp Vault, etc.
```

### .gitignore

```gitignore
# Environment files
.env
.env.local
.env.*.local

# Never commit these
*.pem
*.key
secrets/
```

### API Key Protection

```typescript
// ❌ Frontend: NEVER include API keys
// Bad - exposed in client bundle
const paymaster = new PaymasterRpc({
  headers: { 'x-paymaster-api-key': 'your-key-here' },
});

// ✅ Good - Server-side only (scripts, Server Actions, API routes)
const paymaster = new PaymasterRpc({
  nodeUrl: 'https://starknet.paymaster.avnu.fi',
  headers: { 'x-paymaster-api-key': process.env.AVNU_PAYMASTER_API_KEY! },
});

// ✅ Good - Frontend uses Server Actions
// See gasfree-frontend.md for complete pattern
async function sponsoredSwap(calls: Call[]) {
  // Server Action handles API key
  const prepared = await serverBuildSponsoredTx(account.address, calls);
  const signed = await signPaymasterTransaction({ provider: account, typedData: prepared.typed_data });
  return serverExecuteSponsoredTx(account.address, signed);
}
```

### Getting a Paymaster API Key

1. Go to [portal.avnu.fi](https://portal.avnu.fi)
2. Connect using your starknet wallet
3. Create a new api key
4. Fund your key with some STRK on mainnet (free on Sepolia)
5. Add to your `.env` file (server-side only!):

```bash
AVNU_PAYMASTER_API_KEY=your-api-key-here
```

## TypeScript Configuration

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### For BigInt Support

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020"]
  }
}
```

## Complete Setup Example

```typescript
// src/config/avnu.ts
import { Account, RpcProvider } from 'starknet';
import { AvnuOptions, PaymasterRpc } from '@avnu/avnu-sdk';
import 'dotenv/config';

// Network configuration
const NETWORK = (process.env.STARKNET_NETWORK || 'mainnet') as 'mainnet' | 'sepolia';

const NETWORKS = {
  mainnet: {
    baseUrl: 'https://starknet.api.avnu.fi',
    impulseBaseUrl: 'https://starknet.impulse.avnu.fi',
    paymasterUrl: 'https://starknet.api.avnu.fi/paymaster/v1',
    rpcUrl: process.env.STARKNET_RPC_URL || 'https://rpc.starknet.lava.build',
  },
  sepolia: {
    baseUrl: 'https://sepolia.api.avnu.fi',
    impulseBaseUrl: 'https://sepolia.impulse.avnu.fi',
    paymasterUrl: 'https://sepolia.api.avnu.fi/paymaster/v1',
    rpcUrl: process.env.STARKNET_RPC_URL || 'https://rpc.starknet-sepolia.lava.build',
  },
};

const config = NETWORKS[NETWORK];

// Provider
export const provider = new RpcProvider({
  nodeUrl: config.rpcUrl,
});

// Account (only for scripts/backend)
export function getAccount(): Account {
  const address = process.env.STARKNET_ACCOUNT_ADDRESS;
  const privateKey = process.env.STARKNET_PRIVATE_KEY;

  if (!address || !privateKey) {
    throw new Error('Account credentials not configured');
  }

  return new Account(provider, address, privateKey);
}

// SDK Options
export const avnuOptions: AvnuOptions = {
  baseUrl: config.baseUrl,
  impulseBaseUrl: config.impulseBaseUrl,
};

// Paymaster
export function getPaymaster(sponsored = false): PaymasterRpc {
  const options: any = {
    nodeUrl: config.paymasterUrl,
  };

  if (sponsored && process.env.AVNU_PAYMASTER_API_KEY) {
    options.headers = {
      'x-api-key': process.env.AVNU_PAYMASTER_API_KEY,
    };
  }

  return new PaymasterRpc(options);
}

// Token addresses
export const TOKENS = {
  ETH: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
  STRK: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  USDC: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
  USDT: '0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8',
};
```

Usage:

```typescript
// src/swap.ts
import { getQuotes, executeSwap } from '@avnu/avnu-sdk';
import { getAccount, avnuOptions, TOKENS } from './config/avnu';

const account = getAccount();

const quotes = await getQuotes({
  sellTokenAddress: TOKENS.ETH,
  buyTokenAddress: TOKENS.USDC,
  sellAmount: BigInt(1e18),
  takerAddress: account.address,
}, avnuOptions);

await executeSwap({
  provider: account,
  quote: quotes[0],
  slippage: 0.01,
  executeApprove: true,
});
```
