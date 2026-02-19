# Winky

**A blinking app on Starknet.** Every blink is a gasless on-chain transaction.

Winky uses your webcam to detect eye blinks in real time. Each blink fires a transaction to a smart contract on Starknet mainnet. Gas fees are fully sponsored -- users pay nothing. No wallet extension, no seed phrase, no crypto knowledge required.

[Live app](https://wink-on-starknet.com/) | [Contract on Voyager](https://voyager.online/contract/0x06c2cbb364d72017b16172c2429f1cf906e71c2f24c319b96d4419f94c34b146)

---

## From Web2 to Web3 with Starkzap

This project is a step-by-step example of how to take an existing web app and add Web3 features using the [Starkzap SDK](https://github.com/starknet-edu/starknet-privy-demo).

**The starting point:** a simple Next.js blinking app. The camera detects blinks, and a counter goes up. That's it -- pure Web2.

**The end result:** the same app, but every blink is now a real transaction on Starknet. Users log in with their email (no wallet needed), gas is paid for them, and everything happens seamlessly in the background.

Here's how we got there.

---

## Step 1: Understand the Architecture

Starkzap introduces a **client/server split**. The frontend handles login and UI. A backend Express server handles all blockchain operations: creating wallets, signing transactions, and talking to the paymaster.

```
User blinks → Frontend detects it → Backend API signs & sends TX → Starknet
```

```
winky/
├── api/                  # Express backend (Starkzap)
│   └── src/
│       ├── lib/          # Privy client, signer, paymaster, account logic
│       └── routes/       # API endpoints (create-wallet, deploy, record-blink)
├── frontend/             # Next.js app
│   └── src/
│       ├── app/          # Providers (Privy), layout, page
│       ├── components/   # Game UI
│       └── hooks/        # Blink detection, contract interaction via API
└── contracts/            # Cairo smart contract
```

The backend exists because it holds secrets (Privy App Secret, AVNU Paymaster API key) that must never be exposed to the browser.

---

## Step 2: Add Social Login with Privy

[Privy](https://www.privy.io/) lets users log in with email, SMS, Google, or Twitter -- no wallet extension needed. Behind the scenes, Privy creates a Starknet keypair for the user and manages it securely.

**Why Privy?** Your users don't need to know what a wallet is. They sign up with their email, and they have a Starknet account.

### What changed in the frontend

We replaced the wallet connector with Privy's provider in [`frontend/src/app/providers.tsx`](frontend/src/app/providers.tsx):

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

And swapped the wallet connect button for a Privy login call in the game component:

```tsx
import { usePrivy } from '@privy-io/react-auth';

const { login, authenticated, user, getAccessToken } = usePrivy();
```

That's it on the frontend. One provider, one hook.

**Setup:** Create a Privy app at [console.privy.io](https://console.privy.io) and enable your preferred login methods (email, Google, etc.).

---

## Step 3: Smart Accounts (Why You Need a Backend)

On Starknet, there are no simple keypair accounts like on Ethereum. Every account is a **smart contract**. When Privy generates a keypair for a user, that keypair still needs a smart account contract deployed on-chain to actually execute transactions.

We use **Argent Ready** (formerly Argent) as the smart account. It's the most battle-tested account contract on Starknet, securing over 90% of the network's value.

The backend handles this automatically:

1. **Create wallet** -- Privy generates a Starknet keypair for the user
2. **Deploy account** -- the backend deploys an Argent Ready smart account tied to that keypair
3. **Execute transactions** -- the backend signs calls using Privy's Wallet API and submits them

The key backend files from the Starkzap SDK:

| File | Purpose |
|------|---------|
| [`api/src/lib/privyClient.ts`](api/src/lib/privyClient.ts) | Privy server client (holds App Secret) |
| [`api/src/lib/ready.ts`](api/src/lib/ready.ts) | Argent Ready account deployment and signing |
| [`api/src/lib/rawSigner.ts`](api/src/lib/rawSigner.ts) | Custom signer that delegates to Privy `raw_sign` |
| [`api/src/lib/provider.ts`](api/src/lib/provider.ts) | RPC provider and AVNU Paymaster setup |
| [`api/src/routes/privy.ts`](api/src/routes/privy.ts) | API endpoints: create-wallet, deploy-wallet, record-blink |

---

## Step 4: Gasless Transactions with AVNU Paymaster

Nobody wants to buy crypto just to use your app. The [AVNU Paymaster](https://docs.avnu.fi/) sponsors gas fees so your users pay nothing.

In **sponsored mode**, your dApp covers the gas. You get an API key from [portal.avnu.fi](https://portal.avnu.fi), fund it with STRK, and add it to the backend `.env`:

```
PAYMASTER_URL=https://starknet.paymaster.avnu.fi
PAYMASTER_MODE=sponsored
PAYMASTER_API_KEY=your-api-key
```

The backend then uses `executePaymasterTransaction` from starknet.js to submit sponsored transactions:

```typescript
const paymasterDetails = { feeMode: { mode: 'sponsored' } };
const result = await account.executePaymasterTransaction(
  [call],
  paymasterDetails
);
```

The API key stays server-side -- never exposed to the frontend.

---

## Step 5: Session-Like Behavior (No Popups)

With a traditional wallet, every transaction triggers a popup asking the user to approve and sign. That would make a blinking game unusable.

Starkzap solves this architecturally: once the user logs in via Privy, the backend can sign transactions on their behalf using the Privy Wallet API. The user's Privy JWT acts as the session token. No popups, no interruptions.

From the frontend, recording a blink is just an API call:

```typescript
const jwt = await getAccessToken();
const resp = await fetch(`${API_URL}/privy/record-blink`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${jwt}`,
  },
  body: JSON.stringify({ walletId }),
});
```

The backend verifies the JWT, signs the transaction via Privy, and submits it through the paymaster. Zero friction.

---

## Step 6: Get an RPC URL

To talk to Starknet, your backend needs an RPC endpoint. We used [Alchemy](https://www.alchemy.com/), but you can use any Starknet RPC provider (Blast, Nethermind, Lava, etc.).

Sign up at your provider, create a Starknet app, and add the URL to `api/.env`:

```
RPC_URL=https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/YOUR_KEY
```

---

## Summary: What Changed

| Area | Before (Web2) | After (Web3 via Starkzap) |
|------|---------------|---------------------------|
| **Login** | None / simple auth | Privy social login (email, Google, SMS) |
| **Blink recording** | Database insert | On-chain transaction on Starknet |
| **Gas fees** | N/A | Sponsored by AVNU Paymaster (free for users) |
| **Transaction signing** | N/A | Backend signs via Privy Wallet API (no popups) |
| **Wallet** | None | Argent Ready smart account (auto-created) |
| **Backend** | None | Express API (Starkzap pattern) |

### Files that were added or changed

**New (backend):**
- `api/` -- entire Express server following the Starkzap SDK pattern

**Modified (frontend):**
- `providers.tsx` -- Privy replaces the previous wallet connector
- `WinkyGame.tsx` -- uses `usePrivy()` instead of wallet hooks
- `use-winky-contract.ts` -- calls backend API instead of signing directly
- `WalletConnect.tsx` -- Privy login button
- `constants.ts` -- API URL, removed old wallet-specific config
- `package.json` -- swapped wallet packages for `@privy-io/react-auth`

---

## Quick Start

### Prerequisites

- Node.js 18+
- A [Privy](https://console.privy.io) app (App ID + Secret)
- An [AVNU Paymaster](https://portal.avnu.fi) API key
- A Starknet RPC URL ([Alchemy](https://www.alchemy.com/), Blast, etc.)

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

The `WinkyBlink` contract is deployed on Starknet mainnet:

**Address:** [`0x06c2cbb364d72017b16172c2429f1cf906e71c2f24c319b96d4419f94c34b146`](https://voyager.online/contract/0x06c2cbb364d72017b16172c2429f1cf906e71c2f24c319b96d4419f94c34b146)

| Function | Type | Description |
|----------|------|-------------|
| `record_blink()` | external | Record a blink for the caller |
| `get_user_blinks(user)` | view | Get total blinks for a user |
| `get_total_blinks()` | view | Get global blink count |

---

## Learn More

- [Starkzap SDK (starknet-privy-demo)](https://github.com/starknet-edu/starknet-privy-demo) -- the reference implementation this project is based on
- [Privy Docs](https://docs.privy.io/) -- embedded wallets and social login
- [AVNU Paymaster](https://docs.avnu.fi/) -- gasless and sponsored transactions
- [Starknet.js Paymaster Guide](https://starknetjs.com/docs/guides/account/paymaster) -- starknet.js paymaster integration
- [Argent Ready](https://www.ready.co/developers) -- smart account contracts on Starknet

## License

MIT
