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

// Backend API URL (empty = same origin, used for Next.js API routes)
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');

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
  USDC: '0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb',
  USDC_BRIDGED: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
} as const;

// USDC decimals (6 on Starknet mainnet)
export const USDC_DECIMALS = 6;

// BlinkEscrow contract (PVP duel betting)
export const ESCROW_CONTRACT_ADDRESSES = {
  mainnet: '0x603029a4adfef65887a4e55e2436dcd81770e3e77c30b6e8d8540ed120bf018',
  sepolia: '',
  devnet: '',
} as const;

export const ESCROW_CONTRACT_ADDRESS = (
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS ||
  ESCROW_CONTRACT_ADDRESSES[NETWORK] ||
  ''
).trim();

export const ESCROW_OWNER = '0x3d9115d5e585ecadd25b64e7c4dd80a00130077255a73b9ab89e93bbc9da550';
export const ESCROW_FEE_BPS = 0; // no fee — 100% to winner

// Game configuration
export const GAME_CONFIG = {
  EAR_THRESHOLD: 0.21,
  BLINK_DEBOUNCE_MS: 200,
  MAX_PENDING_TXS: 50,
  TX_TIMEOUT_MS: 30000,
} as const;

// 10-hour challenge configuration — March 12 2026, 06:30–16:30 UTC
export const CHALLENGE_CONFIG = {
  START_TIME: new Date('2026-03-12T06:30:00Z').getTime(),
  END_TIME: new Date('2026-03-12T16:30:00Z').getTime(),
  DURATION_MS: 10 * 60 * 60 * 1000,
  PRIZE: '$100',
  PRIZE_DESCRIPTION: '$100 split among top 3',
  START_BLOCK: 7_627_844,         // Current block at ~01:30 UTC Mar 12 — timestamp filter handles precise cutoff
} as const;

// localStorage keys for wallet state
export const STORAGE_KEYS = {
  userId: 'winky_privy_user_id',
  walletId: 'winky_wallet_id',
  walletAddress: 'winky_wallet_address',
  publicKey: 'winky_public_key',
  controllerAddress: 'winky_controller_address',
  controllerUsername: 'winky_controller_username',
} as const;

// Cartridge Controller session policies
export const CONTROLLER_POLICIES = [
  { target: WINKY_CONTRACT_ADDRESS, method: 'record_blink' },
] as const;
