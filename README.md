# Winky

**Blink on Starknet.** Every blink is a gasless on-chain transaction.

[Contract on Voyager](https://voyager.online/contract/0x06c2cbb364d72017b16172c2429f1cf906e71c2f24c319b96d4419f94c34b146)

## What is Winky?

Winky uses your webcam to detect eye blinks in real time with MediaPipe face tracking. Each blink fires a transaction to a Cairo smart contract on Starknet mainnet. Gas fees are fully sponsored -- users pay nothing.

- **1 blink = 1 transaction** (no batching)
- **No wallet popups** during gameplay (Cartridge session keys)
- **No gas fees** for users (Cartridge Paymaster)
- **No browser extension** needed (passkey authentication)

## How It Works

```
You blink → MediaPipe detects it → Cartridge signs & sends TX → Recorded on Starknet
```

1. Connect with [Cartridge Controller](https://cartridge.gg/controller) (passkey-based wallet)
2. Grant a session that pre-approves `record_blink()` calls
3. Start blinking -- each blink is recorded on-chain instantly
4. View your transaction log in real time

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Smart Contract | [Cairo](https://www.cairo-lang.org/) on Starknet |
| Wallet | [Cartridge Controller](https://cartridge.gg/controller) |
| Gas Sponsorship | [Cartridge Paymaster](https://docs.cartridge.gg/slot/paymaster) |
| Eye Tracking | [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) |
| Frontend | Next.js / React |
| Hosting | Vercel |

## Quick Start

### Prerequisites

- Node.js 18+
- [Scarb](https://docs.swmansion.com/scarb/) (for contract development)

### Run Locally

```bash
# Frontend
cd frontend
npm install --legacy-peer-deps
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and allow camera access.

### Build Contract

```bash
cd contracts
scarb build
scarb test
```

## Project Structure

```
winky/
├── contracts/
│   ├── src/lib.cairo           # WinkyBlink contract (Cairo)
│   └── tests/test_winky.cairo  # Contract tests
├── frontend/
│   ├── src/
│   │   ├── app/providers.tsx   # Cartridge Controller setup
│   │   ├── components/         # Game UI + wallet connect
│   │   ├── hooks/              # Blink detection + contract interaction
│   │   └── lib/constants.ts    # Network config + addresses
│   └── public/mediapipe/       # Face landmark model
├── ARCHITECTURE.md             # Detailed technical docs
└── DEPLOYMENT.md               # Deployment guide
```

## Contract

The `WinkyBlink` contract is deployed on Starknet mainnet:

**Address:** [`0x06c2cbb364d72017b16172c2429f1cf906e71c2f24c319b96d4419f94c34b146`](https://voyager.online/contract/0x06c2cbb364d72017b16172c2429f1cf906e71c2f24c319b96d4419f94c34b146)

| Function | Type | Description |
|----------|------|-------------|
| `record_blink()` | external | Record a blink for the caller |
| `get_user_blinks(user)` | view | Get total blinks for a user |
| `get_total_blinks()` | view | Get global blink count |
| `get_version()` | view | Contract version |

Each `record_blink()` call emits a `Blink` event with the user address, timestamp, and running totals.

## License

MIT
