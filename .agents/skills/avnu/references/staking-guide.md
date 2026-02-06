# Staking Guide

Complete reference for staking operations using the avnu SDK.

## Supported Staking Tokens

| Token | Address | Unbonding Period |
|-------|---------|------------------|
| STRK | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` | 21 days |
| WBTC | `0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac` | 7 days |
| tBTC | `0x04daa17763b286d1e59b97c283C0b8C949994C361e426A28F743c67bDfE9a32f` | 7 days |
| SolvBTC | `0x0593e034DdA23eea82d2bA9a30960ED42CF4A01502Cc2351Dc9B9881F9931a68` | 7 days |
| LBTC | `0x036834A40984312F7f7de8D31e3f6305B325389eAEeA5B1c0664b2fB936461a4` | 7 days |

## Getting Staking Information

### Pool Information

```typescript
import { getAvnuStakingInfo } from '@avnu/avnu-sdk';

const stakingInfo = await getAvnuStakingInfo();

console.log('Total Value Locked:', stakingInfo.totalStaked);
console.log('APY:', stakingInfo.apy);
console.log('Commission:', stakingInfo.commission);
console.log('Pool Address:', stakingInfo.poolAddress);
```

### User Position

```typescript
import { getUserStakingInfo } from '@avnu/avnu-sdk';

const userInfo = await getUserStakingInfo(
  TOKENS.STRK,      // Token address
  account.address   // User address
);

console.log('Staked Amount:', userInfo.stakedAmount);
console.log('Pending Rewards:', userInfo.pendingRewards);
console.log('Unbonding Amount:', userInfo.unbondingAmount);
console.log('Claimable Amount:', userInfo.claimableAmount);
```

### User Staking Info Structure

```typescript
interface UserStakingInfo {
  stakedAmount: bigint;      // Currently staked
  pendingRewards: bigint;    // Unclaimed rewards
  unbondingAmount: bigint;   // In cooldown period
  unbondingEndDate: Date;    // When unbonding completes
  claimableAmount: bigint;   // Ready to withdraw
  stakingHistory: StakingEvent[];
}

interface StakingEvent {
  type: 'STAKE' | 'UNSTAKE' | 'CLAIM_REWARDS';
  amount: bigint;
  timestamp: Date;
  txHash: string;
}
```

## Staking Tokens

### Using executeStake

```typescript
import { executeStake } from '@avnu/avnu-sdk';

const result = await executeStake({
  provider: account,
  poolAddress: '0xpool...',
  amount: BigInt(100e18), // 100 STRK
});

console.log('Staked successfully');
console.log('Tx Hash:', result.transactionHash);
```

### Using stakeToCalls (Manual)

```typescript
import { stakeToCalls } from '@avnu/avnu-sdk';

const calls = await stakeToCalls({
  poolAddress: '0xpool...',
  userAddress: account.address,
  amount: BigInt(100e18),
});

// Execute the staking calls
const tx = await account.execute(calls);
```

### With Paymaster (Gasless)

```typescript
import { PaymasterRpc } from 'starknet';
import { executeStake } from '@avnu/avnu-sdk';

const paymaster = new PaymasterRpc({
  nodeUrl: 'https://starknet.api.avnu.fi/paymaster/v1',
});

const result = await executeStake({
  provider: account,
  poolAddress: '0xpool...',
  amount: BigInt(100e18),
  paymaster: {
    active: true,
    provider: paymaster,
    params: {
      feeMode: { mode: 'default', gasToken: TOKENS.STRK },
    },
  },
});
```

## Claiming Rewards

### Claim and Withdraw

```typescript
import { executeClaimRewards } from '@avnu/avnu-sdk';

const result = await executeClaimRewards({
  provider: account,
  poolAddress: '0xpool...',
  restake: false, // Withdraw to wallet
});

console.log('Rewards claimed:', result.transactionHash);
```

### Claim and Restake (Compound)

```typescript
const result = await executeClaimRewards({
  provider: account,
  poolAddress: '0xpool...',
  restake: true, // Add rewards to staked amount
});
```

### Using claimRewardsToCalls

```typescript
import { claimRewardsToCalls } from '@avnu/avnu-sdk';

const calls = await claimRewardsToCalls({
  poolAddress: '0xpool...',
  userAddress: account.address,
  restake: true,
});

const tx = await account.execute(calls);
```

## Unstaking (Two-Step Process)

Unstaking requires two steps with a cooldown period in between.

### Step 1: Initiate Unstake

```typescript
import { executeInitiateUnstake } from '@avnu/avnu-sdk';

const result = await executeInitiateUnstake({
  provider: account,
  poolAddress: '0xpool...',
  amount: BigInt(50e18), // Unstake 50 STRK
});

console.log('Unstake initiated:', result.transactionHash);
console.log('Cooldown starts now - wait 21 days for STRK');
```

### Step 2: Complete Unstake (After Cooldown)

```typescript
import { executeUnstake } from '@avnu/avnu-sdk';

// Must wait for cooldown period to complete!
const result = await executeUnstake({
  provider: account,
  poolAddress: '0xpool...',
});

console.log('Unstake complete:', result.transactionHash);
console.log('Tokens returned to wallet');
```

### Checking Unbonding Status

```typescript
const userInfo = await getUserStakingInfo(TOKENS.STRK, account.address);

if (userInfo.unbondingAmount > 0) {
  const now = new Date();
  const endDate = userInfo.unbondingEndDate;

  if (now >= endDate) {
    console.log('Unbonding complete! Ready to withdraw:', userInfo.unbondingAmount);
    // Can now call executeUnstake
  } else {
    const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    console.log(`Unbonding in progress. ${daysLeft} days remaining`);
    console.log('Amount:', userInfo.unbondingAmount);
  }
}
```

## Unbonding Periods

| Token | Cooldown Period | Notes |
|-------|-----------------|-------|
| STRK | 21 days | Starknet native staking |
| BTC variants | 7 days | WBTC, tBTC, SolvBTC, LBTC |

During the cooldown period:
- Tokens do not earn rewards
- Cannot cancel the unstaking
- Must wait full period before withdrawing

## Staking Lifecycle

```
                    ┌─────────────────────────────┐
                    │                             │
                    ▼                             │
    Wallet ───► executeStake ───► Staked ────────┤
                                    │             │
                                    │ (earning)   │
                                    ▼             │
                            executeClaimRewards   │
                                    │             │
                         ┌──────────┴──────────┐  │
                         │                     │  │
                    restake=true          restake=false
                         │                     │
                         └──────► Wallet ◄─────┘

    Staked ───► executeInitiateUnstake ───► Unbonding (21 days)
                                                │
                                                ▼
                                        executeUnstake ───► Wallet
```

## Reward Calculation

Rewards accumulate continuously based on:

```typescript
// Simplified reward calculation
const dailyReward = stakedAmount * (apy / 365);

// Example: 1000 STRK staked at 5% APY
const staked = 1000;
const apy = 0.05;
const dailyReward = staked * (apy / 365); // ≈ 0.137 STRK/day

// Monthly rewards
const monthlyReward = dailyReward * 30; // ≈ 4.1 STRK/month
```

Actual APY varies based on:
- Total staked in pool
- Network inflation rate
- Protocol performance

## Best Practices

### Staking Strategy

```typescript
// 1. Check current APY before staking
const info = await getAvnuStakingInfo();
console.log('Current APY:', info.apy);

// 2. Consider gas costs for claiming
// Claim less frequently if staking small amounts
const minClaimThreshold = BigInt(10e18); // 10 STRK

const userInfo = await getUserStakingInfo(TOKENS.STRK, account.address);
if (userInfo.pendingRewards >= minClaimThreshold) {
  await executeClaimRewards({
    provider: account,
    poolAddress: info.poolAddress,
    restake: true, // Compound for maximum returns
  });
}
```

### Auto-Compound Script

```typescript
async function autoCompound(
  account: Account,
  poolAddress: string,
  minRewards: bigint
) {
  const userInfo = await getUserStakingInfo(TOKENS.STRK, account.address);

  if (userInfo.pendingRewards >= minRewards) {
    const result = await executeClaimRewards({
      provider: account,
      poolAddress,
      restake: true,
    });
    console.log('Compounded:', userInfo.pendingRewards);
    return result;
  }

  console.log('Below threshold, waiting...');
  return null;
}
```

### Partial Unstaking

```typescript
// You can unstake partial amounts
const userInfo = await getUserStakingInfo(TOKENS.STRK, account.address);
const stakedAmount = userInfo.stakedAmount;

// Unstake 25%
const unstakeAmount = stakedAmount / BigInt(4);

await executeInitiateUnstake({
  provider: account,
  poolAddress: '0xpool...',
  amount: unstakeAmount,
});
```
