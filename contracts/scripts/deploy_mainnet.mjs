import { RpcProvider, Account, ec, stark, hash, CallData, Contract } from 'starknet';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RPC_URL = 'https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/yR5Pmn0DMRTd2lhPE-sh3';

// OZ Account class hash on mainnet (v0.14.0)
const OZ_ACCOUNT_CLASS_HASH = '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f';

// Mainnet USDC address (Circle native USDC)
const USDC_MAINNET = '0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb';

const FEE_BPS = 500; // 5%

const DEPLOYMENTS_DIR = join(__dirname, '../deployments');
const MAINNET_ACCOUNT_FILE = join(DEPLOYMENTS_DIR, 'mainnet_oz_account.json');
const MAINNET_DEPLOYMENT_FILE = join(DEPLOYMENTS_DIR, 'mainnet_escrow.json');

async function createAccount() {
  console.log('\n=== Step 1: Create OZ Account for Mainnet ===\n');

  if (existsSync(MAINNET_ACCOUNT_FILE)) {
    const existing = JSON.parse(readFileSync(MAINNET_ACCOUNT_FILE, 'utf-8'));
    console.log('Account already exists:');
    console.log('  Address:', existing.address);
    return existing;
  }

  const privateKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);

  const constructorCalldata = CallData.compile({ publicKey });

  const address = hash.calculateContractAddressFromHash(
    publicKey,
    OZ_ACCOUNT_CLASS_HASH,
    constructorCalldata,
    0
  );

  const accountInfo = { address, privateKey, publicKey, classHash: OZ_ACCOUNT_CLASS_HASH };

  writeFileSync(MAINNET_ACCOUNT_FILE, JSON.stringify(accountInfo, null, 2));

  console.log('New OZ Account created:');
  console.log('  Address:', address);
  console.log('  Public key:', publicKey);
  console.log('\n  >>> IMPORTANT: Fund this address with ETH or STRK on mainnet <<<');
  console.log('  Voyager:', `https://voyager.online/contract/${address}`);
  console.log('\n  Saved to:', MAINNET_ACCOUNT_FILE);

  return accountInfo;
}

async function deployAccount(provider, accountInfo) {
  console.log('\n=== Step 2: Deploy OZ Account ===\n');

  try {
    const nonce = await provider.getNonceForAddress(accountInfo.address);
    console.log('Account already deployed (nonce:', nonce, ')');
    return;
  } catch {
    // Account not deployed yet
  }

  // Check balance
  const ethAddress = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';
  const strkAddress = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

  let hasETH = false;
  let hasSTRK = false;
  try {
    const ethContract = new Contract(
      [{ name: 'balanceOf', type: 'function', inputs: [{ name: 'account', type: 'felt' }], outputs: [{ name: 'balance', type: 'Uint256' }], stateMutability: 'view' }],
      ethAddress, provider
    );
    const ethBal = await provider.callContract({ contractAddress: ethAddress, entrypoint: 'balanceOf', calldata: [accountInfo.address] });
    const bal = BigInt(ethBal[0] || '0');
    console.log('ETH balance:', bal.toString(), '(', Number(bal) / 1e18, 'ETH )');
    hasETH = bal > 0n;
  } catch (e) {
    console.log('Could not check ETH balance:', e.message?.slice(0, 100));
  }

  try {
    const strkBal = await provider.callContract({ contractAddress: strkAddress, entrypoint: 'balanceOf', calldata: [accountInfo.address] });
    const bal = BigInt(strkBal[0] || '0');
    console.log('STRK balance:', bal.toString(), '(', Number(bal) / 1e18, 'STRK )');
    hasSTRK = bal > 0n;
  } catch (e) {
    console.log('Could not check STRK balance:', e.message?.slice(0, 100));
  }

  if (!hasETH && !hasSTRK) {
    console.log('\n  >>> Account has no funds. Please send ETH or STRK to:', accountInfo.address);
    console.log('  >>> Then run this script again.');
    process.exit(0);
  }

  console.log('Deploying OZ account...');
  const account = new Account({ provider, address: accountInfo.address, signer: accountInfo.privateKey });

  const { transaction_hash, contract_address } = await account.deployAccount({
    classHash: accountInfo.classHash,
    constructorCalldata: CallData.compile({ publicKey: accountInfo.publicKey }),
    addressSalt: accountInfo.publicKey,
  });

  console.log('Deploy tx:', transaction_hash);
  console.log('Waiting for confirmation...');
  await provider.waitForTransaction(transaction_hash);
  console.log('Account deployed at:', contract_address);
}

async function declareAndDeployEscrow(provider, accountInfo) {
  console.log('\n=== Step 3: Declare & Deploy BlinkEscrow ===\n');

  const account = new Account({ provider, address: accountInfo.address, signer: accountInfo.privateKey });

  const sierraPath = join(__dirname, '../target/dev/winky_starkzap_BlinkEscrow.contract_class.json');
  const casmPath = join(__dirname, '../target/dev/winky_starkzap_BlinkEscrow.compiled_contract_class.json');

  const sierra = JSON.parse(readFileSync(sierraPath, 'utf-8'));
  const casm = JSON.parse(readFileSync(casmPath, 'utf-8'));

  const classHash = hash.computeContractClassHash(sierra);
  const compiledClassHash = hash.computeCompiledClassHash(casm);
  console.log('Sierra class hash:', classHash);
  console.log('Compiled class hash:', compiledClassHash);

  // Declare
  console.log('\nDeclaring contract...');
  try {
    const declareRes = await account.declare({ contract: sierra, casm });
    console.log('Declare tx:', declareRes.transaction_hash);
    await provider.waitForTransaction(declareRes.transaction_hash);
    console.log('Declared successfully!');
  } catch (err) {
    const msg = err.message || JSON.stringify(err);
    if (msg.includes('already declared') || msg.includes('is already declared') || msg.includes('class already declared')) {
      console.log('Class already declared, continuing...');
    } else {
      console.error('Declare error:', msg.slice(-400));
      throw err;
    }
  }

  // Deploy with constructor: (owner, token, fee_bps)
  console.log('\nDeploying BlinkEscrow...');
  const constructorCalldata = CallData.compile([
    accountInfo.address,  // owner
    USDC_MAINNET,         // token (USDC)
    FEE_BPS,              // fee (5%)
  ]);

  const deployRes = await account.deployContract({
    classHash,
    constructorCalldata,
  });

  console.log('Deploy tx:', deployRes.transaction_hash);
  await provider.waitForTransaction(deployRes.transaction_hash);

  const escrowAddress = deployRes.contract_address;
  console.log('\n=== BlinkEscrow Deployed! ===');
  console.log('Contract address:', escrowAddress);
  console.log('Voyager:', `https://voyager.online/contract/${escrowAddress}`);

  const deployment = {
    network: 'mainnet',
    address: escrowAddress,
    classHash,
    owner: accountInfo.address,
    token: USDC_MAINNET,
    feeBps: FEE_BPS,
    deployedAt: new Date().toISOString(),
  };

  writeFileSync(MAINNET_DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2));
  console.log('Saved to:', MAINNET_DEPLOYMENT_FILE);

  return deployment;
}

async function main() {
  console.log('=== BlinkEscrow Mainnet Deployment ===');

  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const chainId = await provider.getChainId();
  console.log('Chain ID:', chainId, '(mainnet)');

  // Step 1: Create/load account
  const accountInfo = await createAccount();

  // Step 2: Deploy account if needed
  await deployAccount(provider, accountInfo);

  // Step 3: Declare & deploy escrow
  const deployment = await declareAndDeployEscrow(provider, accountInfo);

  console.log('\n=== All done! ===');
  console.log('Update your frontend constants with:');
  console.log(`  ESCROW_CONTRACT_ADDRESS = '${deployment.address}'`);
}

main().catch((err) => {
  console.error('\nFailed:', err.message?.slice(-500) || err);
  process.exit(1);
});
