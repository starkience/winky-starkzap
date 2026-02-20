import { RpcProvider, PaymasterRpc } from 'starknet'

const providerCache = new Map<string, RpcProvider>()
let cachedPaymaster: PaymasterRpc | null = null

export function getRpcProvider(opts?: { blockIdentifier?: 'pre_confirmed' | 'latest' | 'pending' }): RpcProvider {
  const rpcUrl = process.env.RPC_URL as string
  if (!rpcUrl) throw new Error('Missing RPC_URL')
  const key = `${rpcUrl}|${opts?.blockIdentifier || ''}`
  const existing = providerCache.get(key)
  if (existing) return existing
  const provider = new RpcProvider({ nodeUrl: rpcUrl, ...(opts?.blockIdentifier ? { blockIdentifier: opts.blockIdentifier } : {}) })
  providerCache.set(key, provider)
  return provider
}

export function getPaymasterRpc(): PaymasterRpc {
  if (cachedPaymaster) return cachedPaymaster
  const url = process.env.PAYMASTER_URL || 'https://starknet.paymaster.avnu.fi'
  const headers: Record<string, string> | undefined = process.env.PAYMASTER_API_KEY
    ? { 'x-paymaster-api-key': process.env.PAYMASTER_API_KEY as string }
    : undefined
  cachedPaymaster = new PaymasterRpc(headers ? { nodeUrl: url, headers } : { nodeUrl: url })
  return cachedPaymaster
}

export async function setupPaymaster(): Promise<{ paymasterRpc: PaymasterRpc; isSponsored: boolean; gasToken?: string }> {
  const isSponsored = (process.env.PAYMASTER_MODE || 'sponsored').toLowerCase() === 'sponsored'
  if (isSponsored && !process.env.PAYMASTER_API_KEY) {
    throw new Error("PAYMASTER_API_KEY is required when PAYMASTER_MODE is 'sponsored'")
  }
  const paymasterRpc = getPaymasterRpc()

  // Probe the paymaster URL to diagnose connectivity/format issues
  const probeUrl = process.env.PAYMASTER_URL || 'https://starknet.paymaster.avnu.fi'
  try {
    const probeResp = await fetch(probeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.PAYMASTER_API_KEY
          ? { 'x-paymaster-api-key': process.env.PAYMASTER_API_KEY }
          : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'paymaster_isAvailable',
        params: {},
        id: 1,
      }),
    })
    const probeText = await probeResp.text()
    console.log(`[setupPaymaster] probe status=${probeResp.status} body=${probeText.slice(0, 500)}`)
  } catch (probeErr: any) {
    console.error('[setupPaymaster] probe fetch error:', probeErr.message)
  }

  let available = true
  try {
    available = await paymasterRpc.isAvailable()
  } catch (err: any) {
    console.warn('[setupPaymaster] isAvailable() threw, assuming available:', err.message)
  }
  if (!available) throw new Error('Paymaster service is not available')

  let gasToken: string | undefined
  if (!isSponsored) {
    const supported = await paymasterRpc.getSupportedTokens()
    gasToken = (process.env.GAS_TOKEN_ADDRESS as string) || supported[0]?.token_address
    if (!gasToken) throw new Error('No supported gas tokens available (and GAS_TOKEN_ADDRESS not set)')
  }
  return { paymasterRpc, isSponsored, gasToken }
}
