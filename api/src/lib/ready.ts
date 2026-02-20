import { Account, CallData, CairoOption, CairoOptionVariant, CairoCustomEnum, hash, num } from "starknet";
import { getRpcProvider, setupPaymaster } from "./provider";
import { RawSigner } from "./rawSigner";

function buildReadyConstructor(publicKey: string) {
  const signerEnum = new CairoCustomEnum({ Starknet: { pubkey: publicKey } });
  const guardian = new CairoOption(CairoOptionVariant.None);
  return CallData.compile({ owner: signerEnum, guardian });
}

export function computeReadyAddress(publicKey: string) {
  const calldata = buildReadyConstructor(publicKey);
  return hash.calculateContractAddressFromHash(
    publicKey,
    process.env.READY_CLASSHASH as string,
    calldata,
    0
  );
}

export async function buildReadyAccount({
  walletId,
  publicKey,
  classHash,
  userJwt,
  userId,
  origin,
  paymasterRpc,
}: {
  walletId: string;
  publicKey: string;
  classHash: string;
  userJwt: string;
  userId?: string;
  origin?: string;
  paymasterRpc?: any;
}): Promise<{ account: Account; address: string }> {
  const provider = getRpcProvider();
  const constructorCalldata = buildReadyConstructor(publicKey);
  const address = hash.calculateContractAddressFromHash(
    publicKey,
    classHash,
    constructorCalldata,
    0
  );
  const account = new Account({
    provider,
    address,
    signer: new (class extends RawSigner {
      async signRaw(messageHash: string): Promise<[string, string]> {
        const sig = await rawSign(walletId, messageHash, {
          userJwt,
          userId,
          origin,
        });
        const body = sig.slice(2);
        return [`0x${body.slice(0, 64)}`, `0x${body.slice(64)}`];
      }
    })(),
    ...(paymasterRpc ? { paymaster: paymasterRpc } : {}),
  });
  return { account, address };
}

export async function rawSign(
  walletId: string,
  messageHash: string,
  opts: { userJwt: string; userId?: string; origin?: string }
) {
  const appId = process.env.PRIVY_APP_ID;
  if (!appId) throw new Error("Missing PRIVY_APP_ID");
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appSecret) throw new Error("Missing PRIVY_APP_SECRET");
  const url = `https://api.privy.io/v1/wallets/${walletId}/raw_sign`;
  const body = { params: { hash: messageHash } };

  const headers: Record<string, string> = {
    "privy-app-id": appId,
    "Authorization": `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
    "Content-Type": "application/json",
  };

  if (opts.origin) headers["Origin"] = opts.origin;
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text}`);
  }

  if (!resp.ok)
    throw new Error(data?.error || data?.message || `HTTP ${resp.status}`);
  const sig: string | undefined =
    data?.signature ||
    data?.result?.signature ||
    data?.data?.signature ||
    data?.result?.data?.signature ||
    (typeof data === "string" ? data : undefined);
  if (!sig || typeof sig !== "string")
    throw new Error("No signature returned from Privy");
  return sig.startsWith("0x") ? sig : `0x${sig}`;
}

export async function deployReadyAccount({
  walletId,
  publicKey,
  classHash,
  userJwt,
  userId,
  origin,
}: {
  walletId: string;
  publicKey: string;
  classHash: string;
  userJwt: string;
  userId?: string;
  origin?: string;
}) {
  const provider = getRpcProvider();
  const { paymasterRpc, isSponsored, gasToken } = await setupPaymaster();

  const constructorCalldata = buildReadyConstructor(publicKey);
  const contractAddress = hash.calculateContractAddressFromHash(
    publicKey,
    classHash,
    constructorCalldata,
    0
  );

  const constructorHex: string[] = (Array.isArray(constructorCalldata)
    ? (constructorCalldata as any[])
    : ([] as any[])
  ).map((v: any) => num.toHex(v));

  const deploymentData = {
    class_hash: classHash,
    salt: publicKey,
    calldata: constructorHex,
    address: contractAddress,
    version: 1,
  } as const;

  const { account } = await buildReadyAccount({
    walletId,
    publicKey,
    classHash,
    userJwt,
    userId,
    origin,
    paymasterRpc,
  });

  const winkyContract = process.env.WINKY_CONTRACT_ADDRESS;
  const initialCall = {
    contractAddress: winkyContract,
    entrypoint: 'record_blink',
    calldata: [],
  };

  const paymasterDetails = {
    feeMode: isSponsored
      ? { mode: "sponsored" as const }
      : { mode: "default" as const, gasToken: gasToken },
    deploymentData,
  };

  console.log(
    `Deploying Ready account with paymaster in ${
      isSponsored ? "sponsored" : "default"
    } mode...`
  );

  let maxFee = undefined;

  if (!isSponsored) {
    console.log("Estimating fees...");
    const feeEstimation = await account.estimatePaymasterTransactionFee(
      [initialCall],
      paymasterDetails
    );
    const suggested = feeEstimation.suggested_max_fee_in_gas_token;
    console.log("Estimated fee:", suggested.toString());
    const withMargin15 = (v: any) => {
      const bi = BigInt(v.toString());
      return (bi * 3n + 1n) / 2n;
    };
    maxFee = withMargin15(suggested);
  }

  console.log("Executing paymaster transaction...");
  const res = await account.executePaymasterTransaction(
    [initialCall],
    paymasterDetails,
    maxFee
  );

  console.log("Transaction hash:", res.transaction_hash);

  return res;
}

export async function getReadyAccount({
  walletId,
  publicKey,
  classHash,
  userJwt,
  userId,
  origin,
}: {
  walletId: string;
  publicKey: string;
  classHash: string;
  userJwt: string;
  userId?: string;
  origin?: string;
}): Promise<{ account: Account; address: string }> {
  return buildReadyAccount({
    walletId,
    publicKey,
    classHash,
    userJwt,
    userId,
    origin,
  });
}
