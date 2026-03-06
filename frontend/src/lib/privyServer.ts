import { PrivyClient } from '@privy-io/node';

let client: PrivyClient | undefined;

export function getPrivyClient(): PrivyClient {
  if (client) return client;
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new Error('Missing PRIVY_APP_ID or PRIVY_APP_SECRET');
  client = new PrivyClient({ appId, appSecret });
  return client;
}

export async function extractUserId(request: Request): Promise<string | undefined> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return undefined;
  try {
    const privy = getPrivyClient();
    const claims = await privy.utils().auth().verifyAccessToken(token);
    return (claims as any).userId || (claims as any).sub;
  } catch {
    return undefined;
  }
}
