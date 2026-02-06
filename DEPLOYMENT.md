# Deployment Guide

## Prerequisites

- [Scarb](https://docs.swmansion.com/scarb/) (Cairo package manager)
- [sncast](https://foundry-rs.github.io/starknet-foundry/) (Starknet CLI)
- [Slot CLI](https://docs.cartridge.gg/slot/getting-started) (Cartridge paymaster management)
- Node.js 18+
- Vercel CLI (`npm i -g vercel`)

## 1. Deploy Contract

```bash
cd contracts
scarb build

# Declare the contract class
sncast --account <ACCOUNT> declare --contract-name WinkyBlink --network mainnet

# Deploy an instance
sncast --account <ACCOUNT> deploy --class-hash <CLASS_HASH> --network mainnet
```

## 2. Set Up Paymaster

```bash
# Login to Slot
slot auth login

# Create a team (one-time)
slot teams create <TEAM_NAME>

# Purchase credits at https://cartridge.gg (linked to your team)

# Create paymaster
slot paymaster <PM_NAME> create --team <TEAM_NAME> --budget 1000 --unit CREDIT

# Add policy for your contract
slot paymaster <PM_NAME> policy add \
  --contract <CONTRACT_ADDRESS> \
  --entrypoint record_blink
```

## 3. Deploy Frontend

```bash
cd frontend
npm install --legacy-peer-deps

# Set environment variables on Vercel
vercel env add NEXT_PUBLIC_NETWORK        # "mainnet" or "sepolia"
vercel env add NEXT_PUBLIC_WINKY_CONTRACT_ADDRESS  # deployed contract address

# Deploy
vercel --prod
```

## 4. Monitor

```bash
# Check paymaster budget and usage
slot paymaster <PM_NAME> info

# View recent transactions
slot paymaster <PM_NAME> transactions

# Add more budget
slot paymaster <PM_NAME> budget increase --amount 1000 --unit CREDIT
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_NETWORK` | Target network | `mainnet` |
| `NEXT_PUBLIC_WINKY_CONTRACT_ADDRESS` | Deployed contract | `0x06c2c...` |

No API keys or private keys are needed in the frontend. The Cartridge Paymaster is managed entirely via the Slot CLI.
