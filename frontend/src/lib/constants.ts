/**
 * Starknet Contract and App Configuration
 */

// Network configuration
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || 'sepolia') as
  | 'mainnet'
  | 'sepolia'
  | 'devnet';

// Starknet RPC URL (configurable via env, defaults to Alchemy)
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ||
  'https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/yR5Pmn0DMRTd2lhPE-sh3';

// Backend API URL
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');

// Block explorer URLs
export const EXPLORER_URLS = {
  mainnet: 'https://voyager.online',
  sepolia: 'https://sepolia.voyager.online',
  devnet: '',
} as const;

export const VOYAGER_URL = EXPLORER_URLS[NETWORK];
export const VOYAGER_TX_URL = VOYAGER_URL ? `${VOYAGER_URL}/tx` : '';

// Deployed WinkyStarkzap contract address
export const WINKY_CONTRACT_ADDRESSES = {
  mainnet: '0x004918f613695bbd6ad40b853564b1fc6ab7e1630ecbc2c7db7705cdb937983f',
  sepolia: '0x05d1dfe0ae2b796ac73bf995901c0987b15e8af6f2cb414189a4749feba8666b',
  devnet: '0x048a3823f3e8fd09dbd779855c5cb02a23542de272ad9edcd502230e14e20377',
} as const;

export const WINKY_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_WINKY_CONTRACT_ADDRESS ||
  WINKY_CONTRACT_ADDRESSES[NETWORK] ||
  WINKY_CONTRACT_ADDRESSES['sepolia']
).trim();

// Token addresses (mainnet)
export const TOKENS = {
  ETH: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
  STRK: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  USDC: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
} as const;

// Game configuration
export const GAME_CONFIG = {
  EAR_THRESHOLD: 0.21,
  BLINK_DEBOUNCE_MS: 200,
  MAX_PENDING_TXS: 50,
  TX_TIMEOUT_MS: 30000,
} as const;

// localStorage keys for wallet state
export const STORAGE_KEYS = {
  userId: 'winky_privy_user_id',
  walletId: 'winky_wallet_id',
  walletAddress: 'winky_wallet_address',
  publicKey: 'winky_public_key',
} as const;
