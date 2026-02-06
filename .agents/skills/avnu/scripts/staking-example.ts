/**
 * avnu Staking Example
 *
 * Complete workflow demonstrating:
 * 1. Getting staking pool info
 * 2. Checking user's staking position
 * 3. Staking tokens
 * 4. Claiming rewards (with restake option)
 * 5. Initiating unstake (with cooldown)
 * 6. Completing unstake after cooldown
 *
 * Usage:
 *   npx ts-node staking-example.ts [command]
 *
 * Commands:
 *   info     - Show pool and user staking info
 *   stake    - Stake tokens
 *   claim    - Claim rewards
 *   unstake  - Initiate unstake
 *   withdraw - Complete unstake after cooldown
 *
 * Environment variables:
 *   STARKNET_ACCOUNT_ADDRESS - Your wallet address
 *   STARKNET_PRIVATE_KEY - Your private key (never commit!)
 *   STARKNET_RPC_URL - Optional custom RPC URL
 */

import { Account, RpcProvider } from 'starknet';
import {
  getAvnuStakingInfo,
  getUserStakingInfo,
  executeStake,
  executeClaimRewards,
  executeInitiateUnstake,
  executeUnstake,
} from '@avnu/avnu-sdk';
import { formatUnits } from 'ethers';
import 'dotenv/config';

// Token addresses (mainnet)
const TOKENS = {
  ETH: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
  STRK: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
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


// Get pool and user staking information
async function getStakingInfo(): Promise<void> {
  const account = setupAccount();

  console.log('📊 Staking Information');
  console.log('======================');

  // Pool info
  console.log('\n🏊 Pool Info:');
  const poolInfo = await getAvnuStakingInfo();
  console.log(`   Pool Address: ${poolInfo.poolAddress}`);
  console.log(`   Total Staked: ${formatUnits(poolInfo.totalStaked)} STRK`);
  console.log(`   APY: ${(poolInfo.apy * 100).toFixed(2)}%`);
  console.log(`   Commission: ${(poolInfo.commission * 100).toFixed(2)}%`);

  // User info
  console.log('\n👤 Your Position:');
  const userInfo = await getUserStakingInfo(TOKENS.STRK, account.address);
  console.log(`   Staked: ${formatUnits(userInfo.stakedAmount)} STRK`);
  console.log(`   Pending Rewards: ${formatUnits(userInfo.pendingRewards)} STRK`);

  if (userInfo.unbondingAmount > 0) {
    console.log(`\n⏳ Unbonding:`);
    console.log(`   Amount: ${formatUnits(userInfo.unbondingAmount)} STRK`);

    if (userInfo.unbondingEndDate) {
      const now = new Date();
      const endDate = new Date(userInfo.unbondingEndDate);
      const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysLeft > 0) {
        console.log(`   Days Remaining: ${daysLeft}`);
        console.log(`   Ready On: ${endDate.toLocaleDateString()}`);
      } else {
        console.log(`   ✅ Ready to withdraw!`);
      }
    }
  }

  if (userInfo.claimableAmount > 0) {
    console.log(`\n💰 Claimable: ${formatUnits(userInfo.claimableAmount)} STRK`);
  }

  // Calculate daily rewards
  if (userInfo.stakedAmount > 0) {
    const dailyReward = (Number(userInfo.stakedAmount) * poolInfo.apy) / 365;
    console.log(`\n📈 Estimated Daily Rewards: ${formatUnits(BigInt(Math.floor(dailyReward)))} STRK`);
  }
}

// Stake tokens
async function stakeTokens(amount: bigint): Promise<string> {
  const account = setupAccount();
  const poolInfo = await getAvnuStakingInfo();

  console.log('🔒 Staking Tokens');
  console.log('=================');
  console.log(`Amount: ${formatUnits(amount)} STRK`);
  console.log(`Pool: ${poolInfo.poolAddress.slice(0, 10)}...`);
  console.log(`Current APY: ${(poolInfo.apy * 100).toFixed(2)}%`);

  console.log('\n⏳ Submitting stake transaction...');

  const result = await executeStake({
    provider: account,
    poolAddress: poolInfo.poolAddress,
    amount,
  });

  console.log('\n✅ Staked Successfully!');
  console.log(`   Transaction: ${result.transactionHash}`);
  console.log(`   View on Starkscan: https://starkscan.co/tx/${result.transactionHash}`);

  return result.transactionHash;
}

// Claim rewards
async function claimRewards(restake: boolean = false): Promise<string> {
  const account = setupAccount();
  const poolInfo = await getAvnuStakingInfo();
  const userInfo = await getUserStakingInfo(TOKENS.STRK, account.address);

  console.log('💰 Claiming Rewards');
  console.log('===================');
  console.log(`Pending Rewards: ${formatUnits(userInfo.pendingRewards)} STRK`);
  console.log(`Action: ${restake ? 'Claim and Restake' : 'Claim to Wallet'}`);

  if (userInfo.pendingRewards === BigInt(0)) {
    console.log('\n⚠️  No rewards to claim.');
    return '';
  }

  console.log('\n⏳ Submitting claim transaction...');

  const result = await executeClaimRewards({
    provider: account,
    poolAddress: poolInfo.poolAddress,
    restake,
  });

  console.log('\n✅ Rewards Claimed!');
  console.log(`   Transaction: ${result.transactionHash}`);

  if (restake) {
    console.log('   Rewards have been added to your staked balance.');
  } else {
    console.log('   Rewards have been sent to your wallet.');
  }

  return result.transactionHash;
}

// Initiate unstake (starts cooldown)
async function initiateUnstake(amount: bigint): Promise<string> {
  const account = setupAccount();
  const poolInfo = await getAvnuStakingInfo();
  const userInfo = await getUserStakingInfo(TOKENS.STRK, account.address);

  console.log('🔓 Initiating Unstake');
  console.log('=====================');
  console.log(`Amount: ${formatUnits(amount)} STRK`);
  console.log(`Currently Staked: ${formatUnits(userInfo.stakedAmount)} STRK`);
  console.log(`Cooldown Period: 21 days`);

  if (amount > userInfo.stakedAmount) {
    throw new Error('Insufficient staked balance');
  }

  console.log('\n⚠️  Note: Tokens will not earn rewards during the cooldown period.');
  console.log('\n⏳ Submitting unstake initiation...');

  const result = await executeInitiateUnstake({
    provider: account,
    poolAddress: poolInfo.poolAddress,
    amount,
  });

  const readyDate = new Date();
  readyDate.setDate(readyDate.getDate() + 21);

  console.log('\n✅ Unstake Initiated!');
  console.log(`   Transaction: ${result.transactionHash}`);
  console.log(`   Cooldown Started: ${new Date().toLocaleDateString()}`);
  console.log(`   Ready to Withdraw: ${readyDate.toLocaleDateString()}`);

  return result.transactionHash;
}

// Complete unstake after cooldown
async function completeUnstake(): Promise<string> {
  const account = setupAccount();
  const poolInfo = await getAvnuStakingInfo();
  const userInfo = await getUserStakingInfo(TOKENS.STRK, account.address);

  console.log('✅ Completing Unstake');
  console.log('=====================');
  console.log(`Claimable Amount: ${formatUnits(userInfo.claimableAmount)} STRK`);

  if (userInfo.claimableAmount === BigInt(0)) {
    if (userInfo.unbondingAmount > BigInt(0)) {
      console.log('\n⏳ Tokens are still in cooldown period.');
      console.log(`   Unbonding Amount: ${formatUnits(userInfo.unbondingAmount)} STRK`);
      if (userInfo.unbondingEndDate) {
        console.log(`   Ready On: ${new Date(userInfo.unbondingEndDate).toLocaleDateString()}`);
      }
      return '';
    }
    console.log('\n⚠️  No tokens available to withdraw.');
    return '';
  }

  console.log('\n⏳ Submitting withdrawal...');

  const result = await executeUnstake({
    provider: account,
    poolAddress: poolInfo.poolAddress,
  });

  console.log('\n✅ Unstake Complete!');
  console.log(`   Transaction: ${result.transactionHash}`);
  console.log('   Tokens have been returned to your wallet.');

  return result.transactionHash;
}

// Auto-compound function
async function autoCompound(minRewards: bigint = BigInt(1e18)): Promise<string | null> {
  const account = setupAccount();
  const poolInfo = await getAvnuStakingInfo();
  const userInfo = await getUserStakingInfo(TOKENS.STRK, account.address);

  console.log('🔄 Auto-Compound Check');
  console.log('======================');
  console.log(`Pending Rewards: ${formatUnits(userInfo.pendingRewards)} STRK`);
  console.log(`Minimum Threshold: ${formatUnits(minRewards)} STRK`);

  if (userInfo.pendingRewards < minRewards) {
    console.log('\n⏳ Below threshold, skipping compound.');
    return null;
  }

  console.log('\n⏳ Compounding rewards...');

  const result = await executeClaimRewards({
    provider: account,
    poolAddress: poolInfo.poolAddress,
    restake: true,
  });

  console.log('\n✅ Compounded!');
  console.log(`   Transaction: ${result.transactionHash}`);

  return result.transactionHash;
}

// Main demo function
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'info';

  try {
    switch (command) {
      case 'info':
        await getStakingInfo();
        break;

      case 'stake':
        const stakeAmount = args[1] ? BigInt(parseFloat(args[1]) * 1e18) : BigInt(10e18);
        await stakeTokens(stakeAmount);
        break;

      case 'claim':
        const restake = args[1] === 'restake';
        await claimRewards(restake);
        break;

      case 'compound':
        await autoCompound();
        break;

      case 'unstake':
        const unstakeAmount = args[1] ? BigInt(parseFloat(args[1]) * 1e18) : BigInt(10e18);
        await initiateUnstake(unstakeAmount);
        break;

      case 'withdraw':
        await completeUnstake();
        break;

      default:
        console.log('Available commands:');
        console.log('  info              - Show pool and user staking info');
        console.log('  stake [amount]    - Stake tokens (default: 10 STRK)');
        console.log('  claim [restake]   - Claim rewards (add "restake" to compound)');
        console.log('  compound          - Auto-compound if above threshold');
        console.log('  unstake [amount]  - Initiate unstake (default: 10 STRK)');
        console.log('  withdraw          - Complete unstake after cooldown');
    }
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
