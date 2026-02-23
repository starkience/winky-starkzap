import { PrivyClient } from '@privy-io/node'

let client: PrivyClient | undefined

export function getPrivyClient(): PrivyClient {
  if (client) return client
  const appId = process.env.PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!appId || !appSecret) throw new Error('Missing PRIVY_APP_ID or PRIVY_APP_SECRET')
  client = new PrivyClient({ appId, appSecret })
  return client
}
