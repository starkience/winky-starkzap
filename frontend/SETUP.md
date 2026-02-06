# Frontend Setup

## Environment Variables

Create a `.env.local` file:

```bash
# Network: "mainnet" or "sepolia"
NEXT_PUBLIC_NETWORK=mainnet

# Deployed WinkyBlink contract address
NEXT_PUBLIC_WINKY_CONTRACT_ADDRESS=0x06c2cbb364d72017b16172c2429f1cf906e71c2f24c319b96d4419f94c34b146
```

No API keys or secrets are needed. Gas fees are sponsored by the Cartridge Paymaster (configured via Slot CLI, not in the frontend).

## Installation

```bash
npm install --legacy-peer-deps
```

## Development

```bash
npm run dev
```

The app runs at `http://localhost:3000`. Camera access requires HTTPS in production but works on localhost for development.

## Production Build

```bash
npm run build
npm start
```

## Deploy to Vercel

```bash
npx vercel --prod
```

Set `NEXT_PUBLIC_NETWORK` and `NEXT_PUBLIC_WINKY_CONTRACT_ADDRESS` in Vercel's environment variables (Settings > Environment Variables).
