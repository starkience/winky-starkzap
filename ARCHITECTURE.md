# Winky - Blink on Starknet

A Starknet application that records eye blinks on-chain in real time. Each blink triggers a gasless transaction via the Cartridge Controller.

**1 blink = 1 transaction. No popups. No gas fees.**

## How It Works

1. User connects with **Cartridge Controller** (passkey-based, self-custodial wallet)
2. Session policies pre-approve `record_blink()` calls -- no popups during gameplay
3. MediaPipe face tracking detects blinks via the webcam
4. Each blink fires a transaction to the `WinkyBlink` contract on Starknet mainnet
5. **Cartridge Paymaster** sponsors all gas fees -- completely free for users

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js / React)                 │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────┐  ┌──────────────────┐                   │
│  │ WinkyGame.tsx    │  │ use-blink-       │                   │
│  │                  │  │ detection.ts     │                   │
│  │ - Camera feed    │  │                  │                   │
│  │ - Blink counter  │  │ - MediaPipe      │                   │
│  │ - TX log panel   │  │ - EAR algorithm  │                   │
│  │ - Wallet button  │  │ - 30+ FPS        │                   │
│  └────────┬─────────┘  └────────┬─────────┘                  │
│           │                     │                              │
│           │               blink detected                       │
│           │                     │                              │
│           ▼                     ▼                              │
│  ┌──────────────────────────────────────────┐                 │
│  │ use-winky-contract.ts                     │                 │
│  │                                           │                 │
│  │ - account.execute([{ record_blink }])     │                 │
│  │ - Sequential processing (no nonce issues) │                 │
│  │ - TX log management                       │                 │
│  └──────────────────────────────────────────┘                 │
│                         │                                      │
│  ┌──────────────────────┼──────────────────────┐              │
│  │ providers.tsx         │                      │              │
│  │                       │                      │              │
│  │ - ControllerConnector (dynamic import)       │              │
│  │ - Session policies for record_blink          │              │
│  │ - Cartridge RPC endpoints (v0_9)             │              │
│  │ - StarknetConfig + jsonRpcProvider           │              │
│  └──────────────────────┼──────────────────────┘              │
└──────────────────────────┼─────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    CARTRIDGE CONTROLLER                        │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  - Passkey authentication (no seed phrase)                    │
│  - Session keys auto-sign pre-approved transactions           │
│  - Built-in nonce management (parallel TX support)            │
│  - Keychain iframe at x.cartridge.gg                          │
│                                                               │
│  ┌──────────────────────────────────────────┐                │
│  │ Cartridge Paymaster (winky-pm)            │                │
│  │                                           │                │
│  │ - Sponsors gas for record_blink calls     │                │
│  │ - Budget: credits (USD-denominated)       │                │
│  │ - ~$0.0015 per transaction                │                │
│  │ - Managed via Slot CLI                    │                │
│  └──────────────────────────────────────────┘                │
│                                                               │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    STARKNET MAINNET                            │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  WinkyBlink Contract                                          │
│  0x06c2cbb364d72017b16172c2429f1cf906e71c2f24c319b96d4419f94c34b146
│                                                               │
│  Storage:                                                     │
│  ├─ user_blinks: Map<ContractAddress, u64>                   │
│  └─ total_blinks: u64                                        │
│                                                               │
│  Functions:                                                   │
│  ├─ record_blink()              [external]                   │
│  ├─ get_user_blinks(user) → u64 [view]                      │
│  ├─ get_total_blinks() → u64    [view]                       │
│  └─ get_version() → felt252     [view]                       │
│                                                               │
│  Events:                                                      │
│  └─ Blink { user, timestamp, user_total, global_total }      │
│                                                               │
│  Explorer: https://voyager.online                             │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

## Transaction Flow

```
User blinks
    → MediaPipe detects blink (EAR < 0.21)
    → account.execute([{ record_blink }])
    → Cartridge session key signs (NO popup)
    → Paymaster sponsors gas ($0 for user)
    → Transaction on-chain (~2-6s confirmation)
```

No batching, no queuing. Each blink is its own transaction. The Cartridge Controller handles nonce management internally, so rapid sequential transactions don't collide.

## Blink Detection

```
Camera frame capture:     ~33ms (30 FPS)
MediaPipe inference:      ~20-50ms
EAR calculation:          ~1ms
Blink detection logic:    ~1ms
Debounce filter:          200ms window
─────────────────────────────────
Total blink-to-event:     ~250-300ms
```

### Eye Aspect Ratio (EAR)

```
EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)

p1, p4: horizontal eye corners
p2, p3: upper lid landmarks
p5, p6: lower lid landmarks

EAR < 0.21 for 2+ consecutive frames → eye closed
EAR returns above threshold → blink completed
```

## Project Structure

```
winky/
├── contracts/
│   ├── Scarb.toml              # Cairo project config (starknet 2.15.0)
│   ├── snfoundry.toml          # snforge test config
│   ├── src/
│   │   └── lib.cairo           # WinkyBlink contract
│   └── tests/
│       └── test_winky.cairo    # Contract tests
│
├── frontend/
│   ├── package.json            # Dependencies
│   ├── next.config.js          # Next.js + WASM config
│   ├── vercel.json             # Vercel deployment config
│   ├── src/
│   │   ├── app/
│   │   │   ├── globals.css     # Global styles
│   │   │   ├── layout.tsx      # Root layout
│   │   │   ├── page.tsx        # Main page
│   │   │   └── providers.tsx   # StarknetConfig + ControllerConnector
│   │   ├── components/
│   │   │   ├── WalletConnect.tsx  # Connect screen
│   │   │   └── WinkyGame.tsx      # Game UI + TX log
│   │   ├── hooks/
│   │   │   ├── use-blink-detection.ts   # MediaPipe eye tracking
│   │   │   └── use-winky-contract.ts    # Contract interaction
│   │   └── lib/
│   │       └── constants.ts    # Addresses, network config
│   └── public/
│       └── mediapipe/          # Face landmark model + WASM
│
└── ARCHITECTURE.md
```

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Smart Contract | Cairo | 2.15.0 |
| Contract Framework | Scarb | latest |
| Testing | snforge (Starknet Foundry) | 0.56.0 |
| Frontend | Next.js + React | 14.x |
| Wallet | Cartridge Controller | 0.12.2 |
| Connector | @cartridge/connector | 0.12.2 |
| Starknet SDK | starknet.js | 8.9.2 |
| React Hooks | @starknet-react/core | 5.0.3 |
| Eye Tracking | MediaPipe Face Landmarker | 0.10.x |
| Hosting | Vercel | - |
| Explorer | Voyager | - |

## Deployment

### Contract

```bash
cd contracts
scarb build
sncast --account <ACCOUNT> declare --contract-name WinkyBlink --network mainnet
sncast --account <ACCOUNT> deploy --class-hash <CLASS_HASH> --network mainnet
```

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps
npm run build

# Deploy to Vercel
npx vercel --prod
```

### Environment Variables (Vercel)

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_NETWORK` | `mainnet` |
| `NEXT_PUBLIC_WINKY_CONTRACT_ADDRESS` | `0x06c2cbb364d72017b16172c2429f1cf906e71c2f24c319b96d4419f94c34b146` |

### Paymaster Management

```bash
# Check status
slot paymaster winky-pm info

# View recent transactions
slot paymaster winky-pm transactions

# Add budget
slot paymaster winky-pm budget increase --amount 1000 --unit CREDIT

# Manage policies
slot paymaster winky-pm policy list
slot paymaster winky-pm policy add --contract <ADDRESS> --entrypoint <FUNCTION>
```

## Key Design Decisions

**Why Cartridge Controller over Argent/Braavos?**
- Built-in session keys with no additional library (`@argent/x-sessions` had nonce issues with rapid transactions)
- Internal nonce management allows fast sequential transactions without collisions
- Passkey-based authentication -- no seed phrase, no browser extension
- Native paymaster integration -- gasless transactions with zero additional code

**Why 1:1 instead of batching?**
- Cartridge Controller handles nonce management internally
- No nonce collisions even with rapid transactions
- Simpler code, better UX (each blink is immediately reflected)
- ~$0.0015 per transaction makes individual transactions affordable

**Why dynamic import for ControllerConnector?**
- The `@cartridge/connector` package bundles WASM modules
- WASM can't run during Next.js SSR/prerendering
- Dynamic `import()` inside `useEffect` ensures client-side only loading

## Cost

| Metric | Value |
|--------|-------|
| Cost per blink | ~$0.0015 |
| Blinks per $1 | ~666 |
| Blinks per $10 | ~6,600 |
