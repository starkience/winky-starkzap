/**
 * avnu Gasfree Swap Example
 *
 * Demonstrates sponsored transactions where the dApp pays gas fees
 * on behalf of users using the avnu Paymaster API key.
 *
 * Usage:
 *   npx ts-node gasfree-swap.ts [mode]
 *
 * Modes:
 *   sponsored  - dApp pays gas (default)
 *   fallback   - Try gasfree, fallback to gasless, then ETH
 *
 * Environment variables:
 *   STARKNET_ACCOUNT_ADDRESS - Your wallet address
 *   STARKNET_PRIVATE_KEY - Your private key (never commit!)
 *   AVNU_PAYMASTER_API_KEY - Your avnu Paymaster API key (from portal.avnu.fi)
 *   STARKNET_RPC_URL - Optional custom RPC URL
 *
 * SECURITY: The API key must NEVER be exposed in frontend code.
 * For frontend dApps, use Server Actions (see gasfree-frontend.md).
 */

import { Account, RpcProvider, PaymasterRpc, type PaymasterDetails } from 'starknet';
import { getQuotes, executeSwap, quoteToCalls, Quote } from '@avnu/avnu-sdk';
import { formatUnits } from 'ethers';
import 'dotenv/config';

// Token addresses (mainnet)
const TOKENS = {
  ETH: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
  STRK: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  USDC: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
};

// Paymaster URLs
const GASFREE_PAYMASTER_URL = 'https://starknet.paymaster.avnu.fi';
const GASLESS_PAYMASTER_URL = 'https://starknet.api.avnu.fi/paymaster/v1';

// Setup provider and account
function setupAccount(): Account {
  const address = process.env.STARKNET_ACCOUNT_ADDRESS;
  const privateKey = process.env.STARKNET_PRIVATE_KEY;

  if (!address || !privateKey) {
    throw new Error(
      'Missing environment variables. Set STARKNET_ACCOUNT_ADDRESS and STARKNET_PRIVATE_KEY'
    );
  }

  const provider = new RpcProvider({
    nodeUrl: process.env.STARKNET_RPC_URL || 'https://rpc.starknet.lava.build',
  });

  return new Account(provider, address, privateKey);
}

// Create gasfree paymaster (requires API key)
function createGasfreePaymaster(): PaymasterRpc {
  const apiKey = process.env.AVNU_PAYMASTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Missing AVNU_PAYMASTER_API_KEY. Get one at https://portal.avnu.fi'
    );
  }

  return new PaymasterRpc({
    nodeUrl: GASFREE_PAYMASTER_URL,
    headers: {
      'x-paymaster-api-key': apiKey,
    },
  });
}

// Create gasless paymaster (no API key needed)
function createGaslessPaymaster(): PaymasterRpc {
  return new PaymasterRpc({
    nodeUrl: GASLESS_PAYMASTER_URL,
  });
}


// Get quote for swap
async function getSwapQuote(account: Account): Promise<Quote> {
  console.log('Fetching quote...');

  const quotes = await getQuotes({
    sellTokenAddress: TOKENS.USDC,
    buyTokenAddress: TOKENS.ETH,
    sellAmount: BigInt(10e6), // 10 USDC
    takerAddress: account.address,
  });

  if (quotes.length === 0) {
    throw new Error('No quotes available');
  }

  const quote = quotes[0];
  console.log(`  Sell: ${formatUnits(quote.sellAmount, 6)} USDC`);
  console.log(`  Buy: ${formatUnits(quote.buyAmount, 18)} ETH`);
  console.log(`  Gas (if paid normally): $${quote.gasFeesInUsd.toFixed(4)}`);

  return quote;
}

// Execute gasfree swap (dApp pays gas)
async function executeGasfreeSwap(): Promise<string> {
  const account = setupAccount();
  const paymaster = createGasfreePaymaster();

  console.log('Gasfree Swap (dApp Sponsors Gas)');
  console.log('================================');
  console.log(`Wallet: ${account.address.slice(0, 10)}...`);

  // Check paymaster availability
  const isAvailable = await paymaster.isAvailable();
  if (!isAvailable) {
    throw new Error('Gasfree paymaster is not available');
  }
  console.log('Paymaster: Available (sponsored mode)');

  const quote = await getSwapQuote(account);

  console.log('\nExecuting gasfree swap...');
  console.log('  Gas sponsored by dApp (user pays $0)');

  const result = await executeSwap({
    provider: account,
    quote,
    slippage: 0.01,
    executeApprove: true,
    paymaster: {
      active: true,
      provider: paymaster,
      params: {
        feeMode: { mode: 'sponsored' },
      },
    },
  });

  console.log('\nGasfree Swap Successful!');
  console.log(`  Transaction: ${result.transactionHash}`);
  console.log('  User paid $0 in gas fees!');
  console.log(`  View: https://starkscan.co/tx/${result.transactionHash}`);

  return result.transactionHash;
}

// Execute gasfree with starknet.js directly (for more control)
async function executeGasfreeWithStarknetJs(): Promise<string> {
  const account = setupAccount();
  const paymaster = createGasfreePaymaster();

  console.log('Gasfree Swap (starknet.js Direct)');
  console.log('=================================');
  console.log(`Wallet: ${account.address.slice(0, 10)}...`);

  const quote = await getSwapQuote(account);

  // Build calls from quote
  console.log('\nBuilding transaction calls...');
  const { calls } = await quoteToCalls({
    quote,
    takerAddress: account.address,
    slippage: 0.01,
    includeApprove: true,
  });

  // Sponsored fee mode (no gasToken needed)
  const feeDetails: PaymasterDetails = {
    feeMode: { mode: 'sponsored' },
  };

  // Execute sponsored transaction
  console.log('Executing sponsored transaction...');
  const result = await account.executePaymasterTransaction(calls, feeDetails);

  console.log('\nGasfree Swap Successful!');
  console.log(`  Transaction: ${result.transaction_hash}`);
  console.log(`  View: https://starkscan.co/tx/${result.transaction_hash}`);

  // Wait for confirmation
  const receipt = await account.waitForTransaction(result.transaction_hash);
  console.log(`  Status: ${receipt.execution_status}`);

  return result.transaction_hash;
}

// Execute with cascading fallback: gasfree → gasless → regular
async function executeWithFallback(): Promise<string> {
  const account = setupAccount();

  console.log('Swap with Cascading Fallback');
  console.log('============================');
  console.log(`Wallet: ${account.address.slice(0, 10)}...`);
  console.log('Strategy: gasfree → gasless → regular ETH');

  const quote = await getSwapQuote(account);

  // Try gasfree first (dApp pays)
  if (process.env.AVNU_PAYMASTER_API_KEY) {
    console.log('\n[1/3] Attempting gasfree (sponsored)...');
    try {
      const gasfreePaymaster = createGasfreePaymaster();
      const result = await executeSwap({
        provider: account,
        quote,
        slippage: 0.01,
        executeApprove: true,
        paymaster: {
          active: true,
          provider: gasfreePaymaster,
          params: {
            feeMode: { mode: 'sponsored' },
          },
        },
      });

      console.log('\nGasfree Swap Successful!');
      console.log(`  Transaction: ${result.transactionHash}`);
      console.log('  User paid $0 in gas!');
      return result.transactionHash;
    } catch (error: any) {
      console.log(`  Failed: ${error.message}`);
    }
  } else {
    console.log('\n[1/3] Skipping gasfree (no API key configured)');
  }

  // Fallback to gasless (user pays in token)
  console.log('\n[2/3] Attempting gasless (pay in USDC)...');
  try {
    const gaslessPaymaster = createGaslessPaymaster();
    const result = await executeSwap({
      provider: account,
      quote,
      slippage: 0.01,
      executeApprove: true,
      paymaster: {
        active: true,
        provider: gaslessPaymaster,
        params: {
          feeMode: { mode: 'default', gasToken: TOKENS.USDC },
        },
      },
    });

    console.log('\nGasless Swap Successful!');
    console.log(`  Transaction: ${result.transactionHash}`);
    console.log('  User paid gas in USDC');
    return result.transactionHash;
  } catch (error: any) {
    console.log(`  Failed: ${error.message}`);
  }

  // Final fallback to regular gas
  console.log('\n[3/3] Using regular ETH gas...');
  const result = await executeSwap({
    provider: account,
    quote,
    slippage: 0.01,
    executeApprove: true,
  });

  console.log('\nRegular Swap Successful!');
  console.log(`  Transaction: ${result.transactionHash}`);
  console.log('  User paid gas in ETH');
  return result.transactionHash;
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'sponsored';

  try {
    switch (mode) {
      case 'sponsored':
        await executeGasfreeSwap();
        break;

      case 'direct':
        await executeGasfreeWithStarknetJs();
        break;

      case 'fallback':
        await executeWithFallback();
        break;

      default:
        console.log('Gasfree Swap - dApp-sponsored gas transactions\n');
        console.log('Available modes:');
        console.log('  sponsored  - dApp pays gas via API key (default)');
        console.log('  direct     - Same, using starknet.js directly');
        console.log('  fallback   - Try gasfree → gasless → ETH\n');
        console.log('Required environment variables:');
        console.log('  STARKNET_ACCOUNT_ADDRESS');
        console.log('  STARKNET_PRIVATE_KEY');
        console.log('  AVNU_PAYMASTER_API_KEY (from portal.avnu.fi)');
    }
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  }
}

main();
