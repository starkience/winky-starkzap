#!/bin/bash

# Winky Contract Deployment Script for Starknet Sepolia
#
# Prerequisites:
# 1. Install starkli: curl https://get.starkli.sh | sh
# 2. Install scarb: curl --proto '=https' --tlsv1.2 -sSf https://sh.starkup.sh | sh
# 3. Set up your wallet:
#    - starkli signer keystore from-key ~/.starkli-wallets/deployer/keystore.json
#    - Create account descriptor with your wallet details
#
# Environment variables needed:
# - STARKNET_ACCOUNT: Path to account descriptor JSON
# - STARKNET_KEYSTORE: Path to keystore file
# - STARKNET_RPC: RPC URL (defaults to Sepolia)

set -e

echo "================================================"
echo "  Winky Contract Deployment - Starknet Sepolia"
echo "================================================"
echo ""

# Configuration
RPC_URL="${STARKNET_RPC:-https://starknet-sepolia.public.blastapi.io/rpc/v0_7}"
ACCOUNT="${STARKNET_ACCOUNT:-~/.starkli-wallets/deployer/account.json}"
KEYSTORE="${STARKNET_KEYSTORE:-~/.starkli-wallets/deployer/keystore.json}"

echo "RPC: $RPC_URL"
echo "Account: $ACCOUNT"
echo ""

# Step 1: Build the contract
echo "[1/3] Building contract..."
cd "$(dirname "$0")/.."
scarb build

if [ ! -f "target/dev/winky_WinkyBlink.contract_class.json" ]; then
    echo "ERROR: Contract build failed. Check Scarb.toml and src/lib.cairo"
    exit 1
fi

echo "Build successful!"
echo ""

# Step 2: Declare the contract class
echo "[2/3] Declaring contract class..."
DECLARE_OUTPUT=$(starkli declare \
    --rpc "$RPC_URL" \
    --account "$ACCOUNT" \
    --keystore "$KEYSTORE" \
    target/dev/winky_WinkyBlink.contract_class.json \
    2>&1)

# Extract class hash from output
CLASS_HASH=$(echo "$DECLARE_OUTPUT" | grep -oE '0x[a-fA-F0-9]{64}' | head -1)

if [ -z "$CLASS_HASH" ]; then
    # Check if already declared
    if echo "$DECLARE_OUTPUT" | grep -q "already declared"; then
        CLASS_HASH=$(echo "$DECLARE_OUTPUT" | grep -oE '0x[a-fA-F0-9]{64}' | head -1)
        echo "Class already declared: $CLASS_HASH"
    else
        echo "ERROR: Failed to declare contract"
        echo "$DECLARE_OUTPUT"
        exit 1
    fi
else
    echo "Class declared: $CLASS_HASH"
fi
echo ""

# Step 3: Deploy the contract (no constructor args needed)
echo "[3/3] Deploying contract..."
DEPLOY_OUTPUT=$(starkli deploy \
    --rpc "$RPC_URL" \
    --account "$ACCOUNT" \
    --keystore "$KEYSTORE" \
    "$CLASS_HASH" \
    2>&1)

# Extract contract address
CONTRACT_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -oE '0x[a-fA-F0-9]{64}' | tail -1)

if [ -z "$CONTRACT_ADDRESS" ]; then
    echo "ERROR: Failed to deploy contract"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

echo ""
echo "================================================"
echo "  Deployment Successful!"
echo "================================================"
echo ""
echo "Class Hash:       $CLASS_HASH"
echo "Contract Address: $CONTRACT_ADDRESS"
echo ""
echo "View on Voyager:"
echo "https://sepolia.voyager.online/contract/$CONTRACT_ADDRESS"
echo ""
echo "Next steps:"
echo "1. Update your .env.local with:"
echo "   NEXT_PUBLIC_WINKY_CONTRACT_ADDRESS=$CONTRACT_ADDRESS"
echo ""
echo "2. Fund your paymaster API key on portal.avnu.fi (Sepolia)"
echo ""

# Save deployment info
echo "{
  \"network\": \"sepolia\",
  \"classHash\": \"$CLASS_HASH\",
  \"contractAddress\": \"$CONTRACT_ADDRESS\",
  \"deployedAt\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"
}" > deployments/sepolia.json 2>/dev/null || true

echo "Deployment info saved to deployments/sepolia.json"
