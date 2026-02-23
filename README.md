# Winky Starkzap

**A blinking app on Starknet.** Every blink is a gasless on-chain transaction.

> **Contract address (mainnet):** [`0x004918f613695bbd6ad40b853564b1fc6ab7e1630ecbc2c7db7705cdb937983f`](https://voyager.online/contract/0x004918f613695bbd6ad40b853564b1fc6ab7e1630ecbc2c7db7705cdb937983f)

Winky uses your webcam to detect eye blinks in real time. Each blink fires a transaction to a smart contract on Starknet. Gas fees are fully sponsored, users pay nothing. No wallet extension, no seed phrase, no crypto knowledge required.

---

## From Web2 to Web3 with the Starkzap SDK

This project is a step-by-step example of how to take an existing web app and add Web3 features using the [Starkzap SDK](https://github.com/starknet-edu/awesome-starkzap).

**The starting point:** a simple Next.js blinking app. The camera detects blinks, and a counter goes up. That's it, pure Web2.

**The end result:** the same app, but every blink is now a real transaction on Starknet. Users log in with their email (no wallet needed), gas is paid for them, and everything happens seamlessly in the background.

Here's how we got there.

---

## Step 1: Understand the Architecture

The Starkzap SDK handles wallet connection, account deployment, transaction signing, and paymaster integration on the frontend. A minimal Express backend holds secrets (Privy App Secret, AVNU API key) and exposes three endpoints.

```
┌─────────────────────────────────────────────────────────────────────┐
│                           USER (Browser)                            │
│                                                                     │
│  1. Login via email/Google ──► Privy SDK ──► Privy Cloud            │
│  2. Blink detected          │              (creates Starknet        │
│                              │               keypair for user)      │
│  3. SDK.onboard() ───────────┤                                      │
│  4. wallet.execute() ────────┤                                      │
└──────────────┬───────────────┘                                      │
               │                                                      │
               │  POST /api/wallet/starknet  (create wallet)          │
               │  POST /api/wallet/sign      (sign hash)              │
               │  POST /api/paymaster/*      (proxy to AVNU)          │
               ▼                                                      │
┌─────────────────────────────────┐                                   │
│    MINIMAL EXPRESS BACKEND      │                                   │
│                                 │     ┌───────────────────┐         │
│  1. Create wallet ──────────────┼────►│   Privy Wallet    │         │
│  2. Sign hash ──────────────────┼────►│   API (rawSign)   │         │
│  3. Proxy paymaster ────────────┼────►│   AVNU Paymaster  │         │
│                                 │     └───────────────────┘         │
└─────────────────────────────────┘                                   │
                                                                      │
               SDK handles deploy + execute directly ─────────────────┤
                                                 ▼                    │
                                    ┌───────────────────────┐         │
                                    │      STARKNET         │         │
                                    │                       │         │
                                    │  WinkyStarkzap        │         │
                                    │  Contract             │         │
                                    │  - record_blink()     │         │
                                    │  - get_user_blinks()  │         │
                                    │  - get_total_blinks() │         │
                                    └───────────────────────┘         │
```

**In short:** the user never touches a wallet, never pays gas, and never signs a popup. The SDK handles wallet creation, deployment, signing, and paymaster -- the backend only holds secrets and proxies requests.

```
winky/
├── api/                  # Minimal Express backend (3 endpoints)
│   └── src/
│       ├── lib/          # Privy client
│       └── routes/       # wallet.ts (create + sign), paymaster.ts (proxy)
├── frontend/             # Next.js app + Starkzap SDK
│   └── src/
│       ├── app/          # Providers (Privy), layout, page
│       ├── components/   # Game UI (WinkyGame.tsx uses SDK)
│       └── hooks/        # Blink detection, contract interaction via SDK
└── contracts/            # Cairo smart contract
```

The backend exists because it holds secrets (Privy App Secret, AVNU Paymaster API key) that must never be exposed to the browser.

---

## Step 2: Add Social Login with Privy

[Privy](https://www.privy.io/) lets users log in with email, SMS, Google, or Twitter, no wallet extension needed. Behind the scenes, Privy creates a Starknet keypair for the user and manages it securely.

**Why Privy?** Your users don't need to know what a wallet is. They sign up with their email, and a Starknet account is automatically created for them in the background. Frictionless onboarding, onchain account.

### What changed in the frontend

To go from Web2 to Web3, we added Privy as the login method. This is what gives the app frictionless onboarding while creating an onchain account for each user. We wrapped the app with Privy's provider in [`frontend/src/app/providers.tsx`](frontend/src/app/providers.tsx):

```tsx
import { PrivyProvider } from '@privy-io/react-auth';

export function Providers({ children }) {
  return (
    <PrivyProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}>
      {children}
    </PrivyProvider>
  );
}
```

And added a Privy login call in the game component:

```tsx
import { usePrivy } from '@privy-io/react-auth';

const { login, authenticated, user, getAccessToken } = usePrivy();
```

That's it on the frontend. One provider, one hook.

**Setup:** Create a Privy app at [console.privy.io](https://console.privy.io) and enable your preferred login methods (email, Google, etc.).

---

## Step 3: Smart Accounts via the Starkzap SDK

On Starknet, every account is a **smart contract**. When Privy generates a keypair for a user, that keypair still needs a smart account contract deployed on-chain. The Starkzap SDK handles this automatically.

The SDK's `onboard()` method creates the wallet, connects it, and deploys the smart account if needed:

```typescript
import { StarkSDK, OnboardStrategy } from '@starkware-ecosystem/starkzap';

const sdk = new StarkSDK({
  network: 'mainnet',
  paymaster: { nodeUrl: `${API_URL}/api/paymaster` },
});

const { wallet } = await sdk.onboard({
  strategy: OnboardStrategy.Privy,
  deploy: 'if_needed',
  feeMode: 'sponsored',
  privy: {
    resolve: async () => ({
      walletId: savedWalletId,
      publicKey: savedPublicKey,
      serverUrl: `${API_URL}/api/wallet/sign`,
    }),
  },
});
```

The backend only needs two wallet endpoints:

| File | Purpose |
|------|---------|
| [`api/src/lib/privyClient.ts`](api/src/lib/privyClient.ts) | Privy server client (holds App Secret) |
| [`api/src/routes/wallet.ts`](api/src/routes/wallet.ts) | Create wallet + sign hash (2 endpoints) |
| [`api/src/routes/paymaster.ts`](api/src/routes/paymaster.ts) | Proxy paymaster requests to AVNU |

---

## Step 4: Gasless Transactions with AVNU Paymaster

Nobody wants to buy crypto just to use your app. The [AVNU Paymaster](https://docs.avnu.fi/) sponsors gas fees so your users pay nothing.

In **sponsored mode**, your dApp covers the gas. You get an API key from [portal.avnu.fi](https://portal.avnu.fi), fund it with STRK, and set up a paymaster proxy on the backend.

The backend proxies paymaster requests to AVNU, adding the API key server-side:

```typescript
// api/src/routes/paymaster.ts
router.all('/*', async (req, res) => {
  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers: { 'x-paymaster-api-key': API_KEY },
    body: JSON.stringify(req.body),
  });
  res.send(await upstream.text());
});
```

The frontend points the SDK's paymaster to this proxy:

```typescript
const sdk = new StarkSDK({
  network: 'mainnet',
  paymaster: { nodeUrl: `${API_URL}/api/paymaster` },
});
```

The API key stays server-side, never exposed to the frontend.

---

## Step 5: Executing Transactions (No Popups)

With a traditional wallet, every transaction triggers a popup asking the user to approve and sign. That would make a blinking game unusable.

The Starkzap SDK solves this: once onboarded, the wallet object can execute transactions directly. The SDK signs via the backend's `/api/wallet/sign` endpoint and submits through the paymaster proxy. No popups, no interruptions.

From the frontend, recording a blink is a single SDK call:

```typescript
const tx = await wallet.execute(
  [{
    contractAddress: WINKY_CONTRACT_ADDRESS,
    entrypoint: 'record_blink',
    calldata: [],
  }],
  { feeMode: 'sponsored' },
);

console.log('Transaction hash:', tx.hash);
```

The SDK handles signing (via the backend), paymaster submission, and nonce management. Zero friction.

---

## Step 6: Get an RPC URL

To talk to Starknet, the SDK needs an RPC endpoint. We used [Alchemy](https://www.alchemy.com/), but you can use any Starknet RPC provider (Nethermind, Lava, etc.).

Sign up at your provider, create a Starknet app, and add the URL to your environment:

```
RPC_URL=https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/YOUR_KEY
```

---

## Step 7: Transaction Throughput

In a blinking game, transactions fire rapidly -- often faster than a single RPC round-trip can complete. We solved this with **concurrent transaction slots** and **timeouts**.

### Concurrent slots

The frontend maintains a counter of in-flight transactions. Up to `MAX_CONCURRENT_TXS` blinks can be processed simultaneously. Only when all slots are occupied does a blink get skipped.

```typescript
// frontend/src/hooks/use-winky-contract.ts
const TX_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_TXS = 3;
```

Each blink fires immediately without waiting for the previous one to confirm. If the network is fast, all 3 slots stay open. If it slows down, the slots fill up and excess blinks are gracefully skipped rather than queued indefinitely.

### Timeouts

Every `wallet.execute()` call uses a 20-second timeout. If the RPC or paymaster hangs, the slot is freed instead of blocking forever.

### Tuning for your app

To allow more concurrency, increase `MAX_CONCURRENT_TXS`. To tolerate slower RPCs, increase `TX_TIMEOUT_MS`. Both are constants at the top of [`frontend/src/hooks/use-winky-contract.ts`](frontend/src/hooks/use-winky-contract.ts).

---

## Summary: What Changed

| Area | Before (Web2) | After (Web3 via Starkzap SDK) |
|------|---------------|-------------------------------|
| **Login** | None / simple auth | Privy social login (email, Google, SMS) |
| **Blink recording** | Database insert | On-chain transaction via `wallet.execute()` |
| **Gas fees** | N/A | Sponsored by AVNU Paymaster (free for users) |
| **Transaction signing** | N/A | SDK signs via backend PrivySigner (no popups) |
| **Wallet** | None | Smart account (auto-created + auto-deployed) |
| **Backend** | None | Minimal Express API (3 endpoints) |

### Result

In just a few plug-and-play integrations, we added full Web3 functionality without adding end-user friction or forcing anyone to download a wallet extension or acquire tokens.

### Key files

**Backend:**
- `api/src/routes/wallet.ts` -- Create wallet + sign hash
- `api/src/routes/paymaster.ts` -- Proxy paymaster requests to AVNU
- `api/src/lib/privyClient.ts` -- Privy server client

**Frontend:**
- `frontend/src/app/providers.tsx` -- Privy provider
- `frontend/src/components/WinkyGame.tsx` -- SDK onboarding + game UI
- `frontend/src/hooks/use-winky-contract.ts` -- `wallet.execute()` for blinks
- `frontend/package.json` -- `@starkware-ecosystem/starkzap`, `@privy-io/react-auth`

---

## Quick Start

### Prerequisites

- Node.js 18+
- A [Privy](https://console.privy.io) app (App ID + Secret)
- An [AVNU Paymaster](https://portal.avnu.fi) API key
- A Starknet RPC URL ([Alchemy](https://www.alchemy.com/), Nethermind, etc.)

### Run Locally

```bash
# Backend
cd api
npm install
cp .env.example .env    # Fill in your credentials
npm run dev

# Frontend (separate terminal)
cd frontend
npm install --legacy-peer-deps
cp .env.example .env.local    # Fill in your Privy App ID
npm run dev
```

Backend runs on `http://localhost:3000`, frontend on `http://localhost:3001`.

### Build the Contract

```bash
cd contracts
scarb build
scarb test
```

---

## Contract

Deployed on Starknet mainnet at [`0x004918f613695bbd6ad40b853564b1fc6ab7e1630ecbc2c7db7705cdb937983f`](https://voyager.online/contract/0x004918f613695bbd6ad40b853564b1fc6ab7e1630ecbc2c7db7705cdb937983f).

The `WinkyStarkzap` Cairo smart contract exposes these functions:

| Function | Type | Description |
|----------|------|-------------|
| `record_blink()` | external | Record a blink for the caller |
| `get_user_blinks(user)` | view | Get total blinks for a user |
| `get_total_blinks()` | view | Get global blink count |

---

## Learn More

- [Starkzap SDK](https://github.com/starknet-edu/awesome-starkzap), the SDK this project is built with
- [Privy Docs](https://docs.privy.io/), embedded wallets and social login
- [AVNU Paymaster](https://docs.avnu.fi/), gasless and sponsored transactions
- [Starknet.js](https://starknetjs.com/docs/guides/account/paymaster), starknet.js paymaster integration

## License

MIT
