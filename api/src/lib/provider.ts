import https from 'https'
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

function makeRobustFetch(): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as any).url
    const method = init?.method || 'GET'
    const bodyStr = init?.body ? String(init.body) : undefined
    const reqHeaders: Record<string, string> = {}
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { reqHeaders[k] = v })
      } else if (Array.isArray(init.headers)) {
        init.headers.forEach(([k, v]) => { reqHeaders[k] = v })
      } else {
        Object.assign(reqHeaders, init.headers)
      }
    }

    return new Promise<Response>((resolve, reject) => {
      const parsed = new URL(url)
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
      }
      const req = https.request(options, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          const headers = new Headers()
          for (const [k, v] of Object.entries(res.headers)) {
            if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
          }
          resolve(new Response(body, {
            status: res.statusCode || 200,
            statusText: res.statusMessage || 'OK',
            headers,
          }))
        })
      })
      req.on('error', reject)
      if (bodyStr) req.write(bodyStr)
      req.end()
    })
  }
}

export function getPaymasterRpc(): PaymasterRpc {
  if (cachedPaymaster) return cachedPaymaster
  const url = process.env.PAYMASTER_URL || 'https://starknet.paymaster.avnu.fi'
  const headers: Record<string, string> | undefined = process.env.PAYMASTER_API_KEY
    ? { 'x-paymaster-api-key': process.env.PAYMASTER_API_KEY as string }
    : undefined
  cachedPaymaster = new PaymasterRpc({
    nodeUrl: url,
    ...(headers ? { headers } : {}),
    baseFetch: makeRobustFetch(),
  } as any)
  return cachedPaymaster
}

export async function setupPaymaster(): Promise<{ paymasterRpc: PaymasterRpc; isSponsored: boolean; gasToken?: string }> {
  const isSponsored = (process.env.PAYMASTER_MODE || 'sponsored').toLowerCase() === 'sponsored'
  if (isSponsored && !process.env.PAYMASTER_API_KEY) {
    throw new Error("PAYMASTER_API_KEY is required when PAYMASTER_MODE is 'sponsored'")
  }
  const paymasterRpc = getPaymasterRpc()

  let available = true
  try {
    available = await paymasterRpc.isAvailable()
    console.log('[setupPaymaster] isAvailable:', available)
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
