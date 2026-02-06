/**
 * Starknet Contract and Token Addresses
 */

// Network configuration - Switch between mainnet, sepolia, and devnet
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || 'sepolia') as
  | 'mainnet'
  | 'sepolia'
  | 'devnet';

// Alchemy API key (set NEXT_PUBLIC_ALCHEMY_API_KEY in .env.local)
const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || '';

// RPC endpoints (Alchemy)
export const RPC_URLS = {
  mainnet: `https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/${ALCHEMY_API_KEY}`,
  sepolia: `https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/${ALCHEMY_API_KEY}`,
  devnet: 'http://localhost:5050',
} as const;

export const STARKNET_RPC_URL =
  process.env.NEXT_PUBLIC_STARKNET_RPC_URL || RPC_URLS[NETWORK];

// Block explorer URLs
export const EXPLORER_URLS = {
  mainnet: 'https://voyager.online',
  sepolia: 'https://sepolia.voyager.online',
  devnet: '', // No explorer for devnet
} as const;

export const VOYAGER_URL = EXPLORER_URLS[NETWORK];
export const VOYAGER_TX_URL = VOYAGER_URL ? `${VOYAGER_URL}/tx` : '';

// Deployed WinkyBlink contract address
export const WINKY_CONTRACT_ADDRESSES = {
  mainnet: '0x06c2cbb364d72017b16172c2429f1cf906e71c2f24c319b96d4419f94c34b146',
  sepolia: '0x05d1dfe0ae2b796ac73bf995901c0987b15e8af6f2cb414189a4749feba8666b',
  devnet: '0x048a3823f3e8fd09dbd779855c5cb02a23542de272ad9edcd502230e14e20377',
} as const;

export const WINKY_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_WINKY_CONTRACT_ADDRESS ||
  WINKY_CONTRACT_ADDRESSES[NETWORK] ||
  WINKY_CONTRACT_ADDRESSES['sepolia'] // fallback to sepolia if NETWORK doesn't match
).trim();

// Token addresses (mainnet)
export const TOKENS = {
  ETH: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
  STRK: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  USDC: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
} as const;

// Game configuration
export const GAME_CONFIG = {
  // Blink detection
  EAR_THRESHOLD: 0.21,
  BLINK_DEBOUNCE_MS: 200,

  // Transaction queue
  MAX_PENDING_TXS: 50,
  TX_TIMEOUT_MS: 30000,
} as const;
