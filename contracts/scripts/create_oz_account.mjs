import { RpcProvider, Account, Signer, CallData, hash, ec, stark, constants } from 'starknet';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const RPC_URL = 'https://rpc.starknet-testnet.lava.build';

const OZ_ACCOUNT_CLASS_HASH = '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f';

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  
  const privateKey = stark.randomAddress();
  console.log('Private key:', privateKey);
  
  const starkKeyPub = ec.starkCurve.getStarkKey(privateKey);
  console.log('Public key:', starkKeyPub);
  
  const constructorCalldata = CallData.compile({ publicKey: starkKeyPub });
  
  const contractAddress = hash.calculateContractAddressFromHash(
    starkKeyPub,
    OZ_ACCOUNT_CLASS_HASH,
    constructorCalldata,
    0
  );
  
  console.log('\n=== New OZ Account ===');
  console.log('Address:', contractAddress);
  console.log('Private key:', privateKey);
  console.log('Public key:', starkKeyPub);
  console.log('\nFund this address with STRK on Sepolia using:');
  console.log('https://starknet-faucet.vercel.app/');
  console.log('or https://faucet.goerli.starknet.io/');
  console.log('\nThen run: node scripts/deploy_oz_and_escrow.mjs');
  
  const accountInfo = {
    address: contractAddress,
    privateKey,
    publicKey: starkKeyPub,
    classHash: OZ_ACCOUNT_CLASS_HASH,
  };
  
  writeFileSync(
    join(import.meta.dirname, '../deployments/oz_account.json'),
    JSON.stringify(accountInfo, null, 2)
  );
  console.log('\nSaved to deployments/oz_account.json');
}

main().catch(console.error);
