import { PrivyClient, type AuthorizationContext } from '@privy-io/node';

let client: PrivyClient | undefined;

export function getPrivyClient(): PrivyClient {
  if (client) return client;
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new Error('Missing PRIVY_APP_ID or PRIVY_APP_SECRET');
  client = new PrivyClient({ appId, appSecret });
  return client;
}

export function getAuthorizationContext(): AuthorizationContext | undefined {
  const key = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
  if (!key) return undefined;
  return { authorization_private_keys: [key] };
}

export async function extractUserId(request: Request): Promise<string | undefined> {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    console.log('[extractUserId] No Bearer token in request');
    return undefined;
  }
  try {
    const privy = getPrivyClient();
    const claims = await privy.utils().auth().verifyAccessToken(token);
    const uid = (claims as any).userId || (claims as any).sub;
    console.log('[extractUserId] claims keys:', Object.keys(claims as any));
    console.log('[extractUserId] resolved userId:', uid);
    return uid;
  } catch (err: any) {
    console.error('[extractUserId] Token verification failed:', err?.message);
    return undefined;
  }
}
