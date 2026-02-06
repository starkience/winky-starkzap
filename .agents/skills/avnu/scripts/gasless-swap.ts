/**
 * avnu Gasless Swap Example
 *
 * Demonstrates paying transaction fees in ERC-20 tokens instead of ETH
 * using the starknet.js PaymasterRpc with avnu's paymaster endpoint.
 *
 * Usage:
 *   npx ts-node gasless-swap.ts [mode]
 *
 * Modes:
 *   gasless    - Pay gas in USDC (default)
 *   estimated  - Estimate fees before execution
 *   fallback   - Try gasless, fallback to ETH if fails
 *
 * Environment variables:
 *   STARKNET_ACCOUNT_ADDRESS - Your wallet address
 *   STARKNET_PRIVATE_KEY - Your private key (never commit!)
 *   STARKNET_RPC_URL - Optional custom RPC URL
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

// Paymaster URL
const PAYMASTER_URL = 'https://starknet.api.avnu.fi/paymaster/v1';

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

// Create paymaster instance
function createPaymaster(): PaymasterRpc {
  return new PaymasterRpc({
    nodeUrl: PAYMASTER_URL,
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
  console.log(`  Gas (regular): $${quote.gasFeesInUsd.toFixed(4)}`);

  return quote;
}

// Execute gasless swap using avnu SDK
async function executeGaslessSwap(): Promise<string> {
  const account = setupAccount();
  const paymaster = createPaymaster();

  console.log('Gasless Swap (Pay Gas in USDC)');
  console.log('==============================');
  console.log(`Wallet: ${account.address.slice(0, 10)}...`);

  // Check paymaster availability
  const isAvailable = await paymaster.isAvailable();
  if (!isAvailable) {
    throw new Error('Paymaster is not available');
  }
  console.log('Paymaster: Available');

  const quote = await getSwapQuote(account);

  console.log('\nExecuting gasless swap...');
  console.log('  Gas will be paid in USDC');

  const result = await executeSwap({
    provider: account,
    quote,
    slippage: 0.01,
    executeApprove: true,
    paymaster: {
      active: true,
      provider: paymaster,
      params: {
        feeMode: { mode: 'default', gasToken: TOKENS.USDC },
      },
    },
  });

  console.log('\nGasless Swap Successful!');
  console.log(`  Transaction: ${result.transactionHash}`);
  console.log('  Gas was paid in USDC, not ETH!');
  console.log(`  View: https://starkscan.co/tx/${result.transactionHash}`);

  return result.transactionHash;
}

// Execute with fee estimation (using starknet.js directly)
async function executeWithEstimation(): Promise<string> {
  const account = setupAccount();
  const paymaster = createPaymaster();

  console.log('Gasless Swap with Fee Estimation');
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

  // Define fee mode
  const feeDetails: PaymasterDetails = {
    feeMode: { mode: 'default', gasToken: TOKENS.USDC },
  };

  // Estimate fees
  console.log('Estimating fees...');
  const estimation = await account.estimatePaymasterTransactionFee(calls, feeDetails);
  console.log(`  Estimated gas fee: ${estimation.suggested_max_fee_in_gas_token} (in gas token units)`);

  // Execute with estimated max fee
  console.log('\nExecuting transaction...');
  const result = await account.executePaymasterTransaction(
    calls,
    feeDetails,
    estimation.suggested_max_fee_in_gas_token
  );

  console.log('\nGasless Swap Successful!');
  console.log(`  Transaction: ${result.transaction_hash}`);
  console.log(`  View: https://starkscan.co/tx/${result.transaction_hash}`);

  // Wait for confirmation
  const receipt = await account.waitForTransaction(result.transaction_hash);
  console.log(`  Status: ${receipt.execution_status}`);

  return result.transaction_hash;
}

// Execute with fallback to regular gas
async function executeWithFallback(): Promise<string> {
  const account = setupAccount();
  const paymaster = createPaymaster();

  console.log('Swap with Paymaster Fallback');
  console.log('============================');
  console.log(`Wallet: ${account.address.slice(0, 10)}...`);

  const quote = await getSwapQuote(account);

  console.log('\nAttempting gasless swap...');

  try {
    const result = await executeSwap({
      provider: account,
      quote,
      slippage: 0.01,
      executeApprove: true,
      paymaster: {
        active: true,
        provider: paymaster,
        params: {
          feeMode: { mode: 'default', gasToken: TOKENS.USDC },
        },
      },
    });

    console.log('\nGasless Swap Successful!');
    console.log(`  Transaction: ${result.transactionHash}`);
    return result.transactionHash;
  } catch (error: any) {
    console.log(`\nGasless failed: ${error.message}`);
    console.log('Falling back to regular gas (ETH)...');

    // Fallback to regular swap
    const result = await executeSwap({
      provider: account,
      quote,
      slippage: 0.01,
      executeApprove: true,
    });

    console.log('\nRegular Swap Successful!');
    console.log(`  Transaction: ${result.transactionHash}`);
    console.log('  Gas was paid in ETH');
    return result.transactionHash;
  }
}

// Show supported gas tokens
async function showSupportedTokens(): Promise<void> {
  const paymaster = createPaymaster();

  console.log('Supported Gas Tokens');
  console.log('====================');

  const isAvailable = await paymaster.isAvailable();
  console.log(`Paymaster available: ${isAvailable}`);

  if (!isAvailable) {
    console.log('Cannot fetch tokens - paymaster unavailable');
    return;
  }

  const tokens = await paymaster.getSupportedTokens();
  console.log(`\nFound ${tokens.length} supported tokens:\n`);

  tokens.forEach((token, i) => {
    console.log(`${i + 1}. ${token.tokenAddress}`);
    console.log(`   Price in STRK: ${token.priceInStrk}`);
  });
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'gasless';

  try {
    switch (mode) {
      case 'gasless':
        await executeGaslessSwap();
        break;

      case 'estimated':
        await executeWithEstimation();
        break;

      case 'fallback':
        await executeWithFallback();
        break;

      case 'tokens':
        await showSupportedTokens();
        break;

      default:
        console.log('Available modes:');
        console.log('  gasless    - Pay gas in USDC (default)');
        console.log('  estimated  - Estimate fees before execution');
        console.log('  fallback   - Try gasless, fallback to ETH');
        console.log('  tokens     - Show supported gas tokens');
    }
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  }
}

main();
