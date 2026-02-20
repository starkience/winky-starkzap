import type { WalletApiRequestSignatureInput } from "@privy-io/server-auth";
import { generateAuthorizationSignature } from "@privy-io/server-auth/wallet-api";

export async function getUserAuthorizationKey({
  userJwt,
  userId,
}: {
  userJwt: string;
  userId?: string;
}): Promise<string> {
  const authKey = process.env.PRIVY_WALLET_AUTH_PRIVATE_KEY;
  if (!authKey) {
    throw new Error(
      "PRIVY_WALLET_AUTH_PRIVATE_KEY is required for server wallet signing"
    );
  }
  return authKey.trim();
}

export function buildAuthorizationSignature({
  input,
  authorizationKey,
}: {
  input: WalletApiRequestSignatureInput;
  authorizationKey: string;
}): string {
  const signature = generateAuthorizationSignature({
    input,
    authorizationPrivateKey: authorizationKey,
  });

  return signature;
}
