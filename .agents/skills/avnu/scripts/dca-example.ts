/**
 * avnu DCA (Dollar Cost Averaging) Example
 *
 * Complete workflow demonstrating:
 * 1. Creating a DCA order (recurring buy)
 * 2. Fetching user's DCA orders
 * 3. Monitoring order progress
 * 4. Cancelling a DCA order
 *
 * Usage:
 *   npx ts-node dca-example.ts
 *
 * Environment variables:
 *   STARKNET_ACCOUNT_ADDRESS - Your wallet address
 *   STARKNET_PRIVATE_KEY - Your private key (never commit!)
 *   STARKNET_RPC_URL - Optional custom RPC URL
 */

import { Account, RpcProvider } from 'starknet';
import {
  executeCreateDca,
  getDcaOrders,
  executeCancelDca,
  DcaOrderStatus,
  DcaOrder,
} from '@avnu/avnu-sdk';
import { formatUnits } from 'ethers';
import moment from 'moment';
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


// Display order details
function displayOrder(order: DcaOrder): void {
  const progress = order.executedTradesCount / order.iterations;

  console.log(`\n📋 Order: ${order.orderAddress.slice(0, 10)}...`);
  console.log(`   Status: ${order.status}`);
  console.log(`   Pair: ${order.sellTokenAddress.slice(0, 8)}... → ${order.buyTokenAddress.slice(0, 8)}...`);
  console.log(`   Total: ${formatUnits(order.sellAmount, 6)} | Per Cycle: ${formatUnits(order.sellAmountPerCycle, 6)}`);
  console.log(`   Progress: ${order.executedTradesCount}/${order.iterations} (${(progress * 100).toFixed(0)}%)`);
  console.log(`   Sold: ${formatUnits(order.amountSold, 6)} | Bought: ${formatUnits(order.amountBought, 18)}`);

  if (order.startDate) {
    console.log(`   Started: ${new Date(order.startDate).toLocaleDateString()}`);
  }

  // Show recent trades
  if (order.trades && order.trades.length > 0) {
    console.log('   Recent Trades:');
    order.trades.slice(-3).forEach((trade) => {
      const status = trade.status === 'SUCCEEDED' ? '✅' : trade.status === 'PENDING' ? '⏳' : '❌';
      console.log(`     ${status} ${formatUnits(trade.sellAmount, 6)} → ${formatUnits(trade.buyAmount, 18)}`);
    });
  }
}

// Create a new DCA order
async function createDcaOrder(
  sellToken: string,
  buyToken: string,
  totalAmount: bigint,
  amountPerCycle: bigint,
  frequencyDays: number
): Promise<string> {
  const account = setupAccount();
  const iterations = Number(totalAmount / amountPerCycle);

  console.log('📈 Creating DCA Order');
  console.log('=====================');
  console.log(`Sell Token: ${sellToken.slice(0, 10)}...`);
  console.log(`Buy Token: ${buyToken.slice(0, 10)}...`);
  console.log(`Total Amount: ${formatUnits(totalAmount, 6)}`);
  console.log(`Per Cycle: ${formatUnits(amountPerCycle, 6)}`);
  console.log(`Frequency: Every ${frequencyDays} day(s)`);
  console.log(`Iterations: ${iterations}`);

  const order = {
    sellTokenAddress: sellToken,
    buyTokenAddress: buyToken,
    sellAmount: totalAmount.toString(),
    sellAmountPerCycle: amountPerCycle.toString(),
    frequency: moment.duration(frequencyDays, 'days'),
    traderAddress: account.address,
  };

  console.log('\n⏳ Submitting DCA order...');

  const result = await executeCreateDca({
    provider: account,
    order,
  });

  console.log('\n✅ DCA Order Created!');
  console.log(`   Transaction: ${result.transactionHash}`);
  console.log(`   View on Starkscan: https://starkscan.co/tx/${result.transactionHash}`);

  return result.transactionHash;
}

// Fetch and display all DCA orders
async function listDcaOrders(status?: DcaOrderStatus): Promise<DcaOrder[]> {
  const account = setupAccount();

  console.log('\n📋 Fetching DCA Orders');
  console.log('======================');

  const response = await getDcaOrders({
    traderAddress: account.address,
    status,
    page: 0,
    size: 20,
  });

  console.log(`Found ${response.totalElements} orders`);

  if (response.content.length === 0) {
    console.log('No orders found.');
    return [];
  }

  response.content.forEach(displayOrder);

  return response.content;
}

// Cancel a DCA order
async function cancelDcaOrder(orderAddress: string): Promise<string> {
  const account = setupAccount();

  console.log('\n❌ Cancelling DCA Order');
  console.log('=======================');
  console.log(`Order: ${orderAddress}`);

  const result = await executeCancelDca({
    provider: account,
    orderAddress,
  });

  console.log('\n✅ DCA Order Cancelled!');
  console.log(`   Transaction: ${result.transactionHash}`);
  console.log('   Remaining funds will be returned to your wallet.');

  return result.transactionHash;
}

// Monitor a specific order
async function monitorOrder(orderAddress: string): Promise<void> {
  const account = setupAccount();

  console.log('\n👁️  Monitoring DCA Order');
  console.log('========================');

  const response = await getDcaOrders({
    traderAddress: account.address,
    page: 0,
    size: 100,
  });

  const order = response.content.find((o) => o.orderAddress === orderAddress);

  if (!order) {
    console.log('Order not found.');
    return;
  }

  displayOrder(order);

  // Calculate average price if we have executed trades
  if (BigInt(order.amountBought) > 0 && BigInt(order.amountSold) > 0) {
    const avgPrice =
      (Number(order.amountSold) / 1e6) / (Number(order.amountBought) / 1e18);
    console.log(`\n   📊 Average Price: ${avgPrice.toFixed(2)} USDC per token`);
  }

  // Show next execution time
  const pendingTrade = order.trades?.find((t) => t.status === 'PENDING');
  if (pendingTrade && pendingTrade.expectedTradeDate) {
    const nextDate = new Date(pendingTrade.expectedTradeDate);
    const now = new Date();
    const hoursUntil = (nextDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    console.log(`\n   ⏰ Next execution in ${hoursUntil.toFixed(1)} hours`);
    console.log(`      ${nextDate.toLocaleString()}`);
  }
}

// Main demo function
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'list';

  try {
    switch (command) {
      case 'create':
        // Example: DCA 50 USDC into ETH, $10 per day for 5 days
        await createDcaOrder(
          TOKENS.USDC, // Sell USDC
          TOKENS.ETH, // Buy ETH
          BigInt(50e6), // Total 50 USDC
          BigInt(10e6), // 10 USDC per cycle
          1 // Daily
        );
        break;

      case 'list':
        await listDcaOrders();
        break;

      case 'active':
        await listDcaOrders(DcaOrderStatus.ACTIVE);
        break;

      case 'cancel':
        if (!args[1]) {
          console.log('Usage: npx ts-node dca-example.ts cancel <orderAddress>');
          process.exit(1);
        }
        await cancelDcaOrder(args[1]);
        break;

      case 'monitor':
        if (!args[1]) {
          console.log('Usage: npx ts-node dca-example.ts monitor <orderAddress>');
          process.exit(1);
        }
        await monitorOrder(args[1]);
        break;

      default:
        console.log('Available commands:');
        console.log('  create  - Create a new DCA order');
        console.log('  list    - List all DCA orders');
        console.log('  active  - List active DCA orders');
        console.log('  cancel  - Cancel a DCA order');
        console.log('  monitor - Monitor a specific order');
    }
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
