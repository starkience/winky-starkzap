/**
 * avnu Swap Example
 *
 * Complete workflow demonstrating:
 * 1. Account setup
 * 2. Getting quotes
 * 3. Analyzing routes and price impact
 * 4. Executing swap with slippage protection
 * 5. Transaction confirmation
 *
 * Usage:
 *   npx ts-node swap-example.ts
 *
 * Environment variables:
 *   STARKNET_ACCOUNT_ADDRESS - Your wallet address
 *   STARKNET_PRIVATE_KEY - Your private key (never commit!)
 *   STARKNET_RPC_URL - Optional custom RPC URL
 */

import { Account, RpcProvider } from 'starknet';
import { getQuotes, executeSwap, Quote } from '@avnu/avnu-sdk';
import { formatUnits } from 'ethers';
import 'dotenv/config';

// Token addresses (mainnet)
const TOKENS = {
  ETH: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
  STRK: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  USDC: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
};

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

// Analyze quote details
function analyzeQuote(quote: Quote): void {
  console.log('\n📊 Quote Analysis:');
  console.log(`   Sell: ${formatUnits(quote.sellAmount, 18)} ETH`);
  console.log(`   Buy: ${formatUnits(quote.buyAmount, 6)} USDC`);
  console.log(`   Buy (USD): $${quote.buyAmountInUsd.toFixed(2)}`);
  console.log(`   Price Impact: ${(quote.priceImpact / 100).toFixed(4)}%`);
  console.log(`   Gas Fees: $${quote.gasFeesInUsd.toFixed(4)}`);

  // Route breakdown
  console.log('\n🛤️  Routes:');
  quote.routes.forEach((route) => {
    console.log(`   ${route.name}: ${(route.percent * 100).toFixed(1)}%`);
    route.routes?.forEach((sub) => {
      console.log(`     └─ ${sub.name}: ${(sub.percent * 100).toFixed(1)}%`);
    });
  });

  // Fees
  console.log('\n💰 Fees:');
  console.log(`   avnu Fee: ${quote.fee.avnuFeesBps} bps`);
  if (quote.fee.integratorFeesBps > 0) {
    console.log(`   Integrator Fee: ${quote.fee.integratorFeesBps} bps`);
  }
}


// Main swap function
async function swap(
  sellTokenAddress: string,
  buyTokenAddress: string,
  sellAmount: bigint,
  slippage: number = 0.01
): Promise<string> {
  const account = setupAccount();

  console.log('🔄 avnu Swap Example');
  console.log('====================');
  console.log(`Wallet: ${account.address}`);
  console.log(`Selling: ${formatUnits(sellAmount, 18)} tokens`);
  console.log(`Slippage: ${slippage * 100}%`);

  // Step 1: Get quotes
  console.log('\n⏳ Fetching quotes...');
  const quotes = await getQuotes({
    sellTokenAddress,
    buyTokenAddress,
    sellAmount,
    takerAddress: account.address,
    size: 3, // Get top 3 quotes for comparison
  });

  if (quotes.length === 0) {
    throw new Error('No quotes available. Check liquidity or try a smaller amount.');
  }

  // Show all quotes
  console.log(`\n✅ Received ${quotes.length} quotes:`);
  quotes.forEach((q, i) => {
    console.log(
      `   ${i + 1}. Buy: ${formatUnits(q.buyAmount, 6)} | Impact: ${(q.priceImpact / 100).toFixed(
        3
      )}% | Gas: $${q.gasFeesInUsd.toFixed(4)}`
    );
  });

  // Analyze best quote
  const bestQuote = quotes[0];
  analyzeQuote(bestQuote);

  // Step 2: Price impact check (priceImpact is in basis points, 500 = 5%)
  if (Math.abs(bestQuote.priceImpact) > 500) {
    console.log('\n⚠️  WARNING: High price impact detected!');
    console.log('   Consider splitting into smaller trades.');
  }

  // Step 3: Execute swap
  console.log('\n⏳ Executing swap...');
  const result = await executeSwap({
    provider: account,
    quote: bestQuote,
    slippage,
    executeApprove: true, // Auto-approve if needed
  });

  console.log('\n✅ Swap submitted!');
  console.log(`   Transaction Hash: ${result.transactionHash}`);

  // Step 4: Wait for confirmation
  console.log('\n⏳ Waiting for confirmation...');
  const provider = account as unknown as RpcProvider;
  const receipt = await provider.waitForTransaction(result.transactionHash);

  if (receipt.execution_status === 'SUCCEEDED') {
    console.log('\n🎉 Swap successful!');
    console.log(`   View on Starkscan: https://starkscan.co/tx/${result.transactionHash}`);
  } else {
    console.log('\n❌ Swap failed!');
    console.log(`   Status: ${receipt.execution_status}`);
    if (receipt.revert_reason) {
      console.log(`   Reason: ${receipt.revert_reason}`);
    }
  }

  return result.transactionHash;
}

// Example: Swap 0.01 ETH to USDC
async function main() {
  try {
    const txHash = await swap(
      TOKENS.ETH,
      TOKENS.USDC,
      BigInt(0.01e18), // 0.01 ETH
      0.01 // 1% slippage
    );

    console.log('\nDone! Transaction:', txHash);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
