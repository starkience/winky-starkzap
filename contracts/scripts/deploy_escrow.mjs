import { RpcProvider, Account, Signer, CallData, hash, ec, encode, stark } from 'starknet';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RPC_URL = 'https://rpc.starknet-testnet.lava.build';
const DEPLOYER_ADDRESS = '0x073551d509481e49390d1e3242ebbdca86dc070b1c8b07dda3d94a6155ee8813';
const PRIVATE_KEY = readFileSync(
  join(process.env.HOME, '.starkli-wallets/deployer/private_key.txt'),
  'utf-8',
).trim();

const OWNER = DEPLOYER_ADDRESS;
const USDC_SEPOLIA = '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8';
const FEE_BPS = 500;

class ArgentSigner extends Signer {
  constructor(privateKey) {
    super(privateKey);
  }

  async signRaw(msgHash) {
    const ownerSig = await super.signRaw(msgHash);
    return [
      ownerSig.r.toString(),
      ownerSig.s.toString(),
      '0',
      '0',
    ];
  }
}

async function main() {
  console.log('=== BlinkEscrow Deployment to Starknet Sepolia ===\n');

  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const chainId = await provider.getChainId();
  console.log('Chain ID:', chainId);

  const signer = new ArgentSigner(PRIVATE_KEY);
  const account = new Account({
    provider,
    address: DEPLOYER_ADDRESS,
    signer,
  });
  console.log('Deployer:', DEPLOYER_ADDRESS);

  const sierraPath = join(__dirname, '../target/dev/winky_starkzap_BlinkEscrow.contract_class.json');
  const casmPath = join(__dirname, '../target/dev/winky_starkzap_BlinkEscrow.compiled_contract_class.json');

  const sierra = JSON.parse(readFileSync(sierraPath, 'utf-8'));
  const casm = JSON.parse(readFileSync(casmPath, 'utf-8'));

  const classHash = hash.computeContractClassHash(sierra);
  const compiledClassHash = hash.computeCompiledClassHash(casm);
  console.log('Sierra class hash:', classHash);
  console.log('Compiled class hash:', compiledClassHash);

  // Step 1: Declare
  console.log('\n[1/2] Declaring contract class...');
  try {
    const declareRes = await account.declare({ contract: sierra, casm });
    console.log('Declare tx:', declareRes.transaction_hash);
    console.log('Waiting for confirmation...');
    await provider.waitForTransaction(declareRes.transaction_hash);
    console.log('Declared!');
  } catch (err) {
    const msg = err.message || JSON.stringify(err);
    if (msg.includes('already declared') || msg.includes('is already declared')) {
      console.log('Class already declared, continuing...');
    } else {
      const last300 = msg.slice(-300);
      console.error('Declare error (tail):', last300);
      throw err;
    }
  }

  // Step 2: Deploy
  console.log('\n[2/2] Deploying contract...');
  const constructorCalldata = CallData.compile([OWNER, USDC_SEPOLIA, FEE_BPS]);

  const deployRes = await account.deployContract({
    classHash,
    constructorCalldata,
  });

  console.log('Deploy tx:', deployRes.transaction_hash);
  console.log('Contract address:', deployRes.contract_address);
  console.log('Waiting for confirmation...');
  await provider.waitForTransaction(deployRes.transaction_hash);

  console.log('\n=== Deployment Successful! ===');
  console.log('Contract:', deployRes.contract_address);
  console.log('Voyager:', `https://sepolia.voyager.online/contract/${deployRes.contract_address}`);
}

main().catch((err) => {
  console.error('\nDeployment failed:', err.message?.slice(-400) || err);
  process.exit(1);
});
