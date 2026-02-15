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

## Session Keys — The Biggest Unlock

Session keys remove the usual annoying wallet pop-ups you get for every singular user action. In Winky, this is critical — imagine approving a wallet pop-up for **every single blink**. Impossible.

### How Session Keys Work

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WITHOUT SESSION KEYS (Traditional)                  │
│                                                                             │
│  User Action ──► Wallet Pop-up ──► User Approves ──► TX Signed ──► Chain   │
│  User Action ──► Wallet Pop-up ──► User Approves ──► TX Signed ──► Chain   │
│  User Action ──► Wallet Pop-up ──► User Approves ──► TX Signed ──► Chain   │
│       ...          ⚠️ EVERY          😩 EVERY           🐌 SLOW             │
│                    SINGLE            SINGLE                                  │
│                    TIME              TIME                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         WITH SESSION KEYS (Starknet AA)                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │  STEP 1: One-time setup (only wallet pop-up the user sees)  │            │
│  │                                                              │            │
│  │  User Connects ──► Approves Session Policy ──► Done ✅       │            │
│  └─────────────────────────────────────────────────────────────┘            │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │  STEP 2: Session key generated                               │            │
│  │                                                              │            │
│  │  Temporary signing key created locally in the browser        │            │
│  │  Scoped to the approved policy — cannot do anything else     │            │
│  └─────────────────────────────────────────────────────────────┘            │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │  STEP 3: All future actions — zero pop-ups 🚀                │            │
│  │                                                              │            │
│  │  User Action ──► Signed locally by session key ──► Chain     │            │
│  │  User Action ──► Signed locally by session key ──► Chain     │            │
│  │  User Action ──► Signed locally by session key ──► Chain     │
│  │       ...         ✅ NO POP-UP     ⚡ INSTANT                 │            │
│  └─────────────────────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Session Policy — What Gets Approved

The session policy defines **exactly** which contracts and functions the app can call on the user's behalf. Nothing more.

```
┌──────────────────────────────────────────────────────────────┐
│                      SESSION POLICY                           │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Allowed Contract:                                      │  │
│  │  0x06c2cbb...b146 (WinkyBlink)                         │  │
│  │                                                         │  │
│  │  Allowed Function:                                      │  │
│  │  ├── record_blink()    ✅ Can call                      │  │
│  │  │                                                      │  │
│  │  Blocked (not in policy):                               │  │
│  │  ├── transfer()        ❌ Cannot call                   │  │
│  │  ├── approve()         ❌ Cannot call                   │  │
│  │  ├── Any other contract ❌ Cannot call                  │  │
│  │  └── Any other function ❌ Cannot call                  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  The user's funds and other assets are SAFE.                 │
│  The session key can ONLY do what the policy allows.         │
└──────────────────────────────────────────────────────────────┘
```

### Full Flow in Winky

```
┌──────────┐     ┌─────────────────────┐     ┌──────────────────────────────┐
│          │     │  CARTRIDGE           │     │  STARKNET                    │
│  USER    │     │  CONTROLLER          │     │  MAINNET                     │
│          │     │                      │     │                              │
└────┬─────┘     └──────────┬───────────┘     └──────────────┬───────────────┘
     │                      │                                │
     │  1. Connect          │                                │
     │─────────────────────►│                                │
     │                      │                                │
     │  2. Show session     │                                │
     │     policy prompt    │                                │
     │◄─────────────────────│                                │
     │                      │                                │
     │  3. User approves    │                                │
     │     (LAST POP-UP)    │                                │
     │─────────────────────►│                                │
     │                      │                                │
     │                      │  4. Generate temporary         │
     │                      │     session signing key        │
     │                      │     (stored in browser)        │
     │                      │                                │
     │                      │                                │
     │  ════════════════════╪════════════════════════════════╪══════════════
     │   GAMEPLAY BEGINS — NO MORE POP-UPS FROM THIS POINT  │
     │  ════════════════════╪════════════════════════════════╪══════════════
     │                      │                                │
     │  5. *blink*          │                                │
     │─────────────────────►│                                │
     │                      │  6. Session key signs TX       │
     │                      │     locally (no pop-up)        │
     │                      │                                │
     │                      │  7. Paymaster sponsors gas     │
     │                      │─────────────────────────────►  │
     │                      │                                │  8. record_blink()
     │                      │                                │     executed on-chain
     │                      │  9. TX confirmed               │
     │  10. UI updated      │◄─────────────────────────────  │
     │◄─────────────────────│                                │
     │                      │                                │
     │  11. *blink*         │                                │
     │─────────────────────►│  (repeat 6-10, still no       │
     │                      │   pop-up, still no gas fees)   │
     │  ...                 │                                │
     │                      │                                │
     │  12. *blink*         │                                │
     │─────────────────────►│  (and again...)                │
     │                      │                                │
```

### Why This Matters

| Without Session Keys | With Session Keys |
|---------------------|-------------------|
| Pop-up on **every** blink | Pop-up **once** at connection |
| User must approve each TX | TXs signed automatically |
| ~3-5 sec delay per approval | ~0ms signing overhead |
| Impossible for real-time apps | Enables blink = instant TX |
| Frustrating UX | Seamless, game-like UX |

### Security Model

- **Scoped permissions**: The session key can ONLY call functions defined in the policy
- **Temporary**: The key is tied to the browser session — closing the tab ends it
- **No fund access**: The policy doesn't include `transfer()` or token approvals
- **User-controlled**: The user sees exactly what they're approving before granting the session
- **Powered by Account Abstraction**: Starknet's native AA makes this possible at the protocol level — no hacks or workarounds

## Paymaster — How Gas Gets Paid

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PAYMASTER FLOW                                      │
│                                                                              │
│  ┌──────────┐     ┌──────────────────┐     ┌────────────────────────────┐   │
│  │           │     │  CARTRIDGE       │     │  CARTRIDGE                 │   │
│  │  APP      │     │  SESSION KEY     │     │  PAYMASTER SERVICE         │   │
│  │           │     │  (in browser)    │     │  (Sender Address)          │   │
│  └─────┬────┘     └────────┬─────────┘     └─────────────┬──────────────┘   │
│        │                   │                              │                  │
│        │  1. User blinks   │                              │                  │
│        │  → record_blink() │                              │                  │
│        │──────────────────►│                              │                  │
│        │                   │                              │                  │
│        │                   │  2. Session key signs        │                  │
│        │                   │     the TX locally           │                  │
│        │                   │     (no pop-up)              │                  │
│        │                   │                              │                  │
│        │                   │  3. Signed payload sent      │                  │
│        │                   │     to Cartridge service     │                  │
│        │                   │─────────────────────────────►│                  │
│        │                   │                              │                  │
│        │                   │               ┌──────────────┴──────────────┐   │
│        │                   │               │  4. POLICY CHECK            │   │
│        │                   │               │                             │   │
│        │                   │               │  Is this call allowed?      │   │
│        │                   │               │                             │   │
│        │                   │               │  Contract: 0x06c2...b146    │   │
│        │                   │               │  Function: record_blink()   │   │
│        │                   │               │                             │   │
│        │                   │               │  ✅ MATCHES POLICY          │   │
│        │                   │               └──────────────┬──────────────┘   │
│        │                   │                              │                  │
│        │                   │               ┌──────────────┴──────────────┐   │
│        │                   │               │  5. SUBMIT & PAY            │   │
│        │                   │               │                             │   │
│        │                   │               │  Sender Address submits     │   │
│        │                   │               │  INVOKE v3 TX to Starknet   │   │
│        │                   │               │  sequencer and pays the     │   │
│        │                   │               │  gas fee in STRK            │   │
│        │                   │               │                             │   │
│        │                   │               │  Cost: ~$0.0015             │   │
│        │                   │               │  Deducted from: dev budget  │   │
│        │                   │               │  User pays: $0              │   │
│        │                   │               └──────────────┬──────────────┘   │
│        │                   │                              │                  │
│        │                   │                              ▼                  │
│        │                   │               ┌────────────────────────────┐    │
│        │                   │               │  STARKNET MAINNET          │    │
│        │                   │               │                            │    │
│        │                   │               │  record_blink() executes   │    │
│        │                   │               │                            │    │
│        │                   │               │  caller = Intended Address │    │
│        │                   │               │  (user's wallet 0x048e...) │    │
│        │                   │               │                            │    │
│        │                   │               │  NOT the Sender Address    │    │
│        │                   │               └────────────────────────────┘    │
│        │                   │                                                 │
└────────┴───────────────────┴─────────────────────────────────────────────────┘
```

### Two Addresses on Every Transaction

When you look at a Winky transaction on Voyager, you'll see two addresses:

```
┌──────────────────────────────────────────────────────────────┐
│  VOYAGER TRANSACTION VIEW                                     │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Intended Address (WHO wants it done)                    │ │
│  │  0x048e...5c3                                            │ │
│  │                                                          │ │
│  │  → The USER's Cartridge Controller wallet                │ │
│  │  → This is what get_caller_address() returns             │ │
│  │  → The blink is recorded against THIS address            │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Sender Address (WHO delivered & paid)                   │ │
│  │  0x0163...34f                                            │ │
│  │                                                          │ │
│  │  → Cartridge's infrastructure service                    │ │
│  │  → Submitted the TX to the Starknet sequencer            │ │
│  │  → Paid the gas fee via the paymaster budget             │ │
│  │  → The user never interacted with this address           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│  Analogy: Writing a letter                                   │
│  • Intended Address = the author (you wrote it)              │
│  • Sender Address = the courier (they delivered it)          │
│  • The recipient sees YOUR name, not the courier's           │
└──────────────────────────────────────────────────────────────┘
```

### Developer Paymaster Management

```bash
# Check paymaster status
slot paymaster winky-pm info

# Example output:
# Budget:   $10.00 total | $5.06 spent | 50.6% usage
# Lifetime: 3,974 TXs | 0 reverted | 100% success rate
# Policies: 1 (record_blink on WinkyBlink contract)

# Add more budget
slot paymaster winky-pm budget increase --amount 1000 --unit CREDIT

# View recent transactions
slot paymaster winky-pm transactions

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
