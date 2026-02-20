import https from 'https'

const originalFetch = globalThis.fetch

function doHttpsRequest(
  url: string,
  method: string,
  reqHeaders: Record<string, string>,
  bodyStr: string | undefined,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const parsed = new URL(url)
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          console.log(`[fetch-override] ${method} ${url} -> ${res.statusCode} (${body.length} bytes)`)
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
      },
    )
    req.on('error', (err) => {
      console.error(`[fetch-override] ${method} ${url} error: ${err.message}`)
      reject(err)
    })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : (input as any).url || String(input)

  const isPaymaster = url.includes('paymaster')
  if (!isPaymaster) {
    return originalFetch(input, init)
  }

  const method = init?.method || 'GET'
  const bodyStr = init?.body ? String(init.body) : undefined
  const reqHeaders: Record<string, string> = {}
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => { reqHeaders[k] = v.trim() })
    } else if (Array.isArray(init.headers)) {
      init.headers.forEach(([k, v]) => { reqHeaders[k] = v.trim() })
    } else {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        reqHeaders[k] = v.trim()
      }
    }
  }

  const maxRetries = 3
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await doHttpsRequest(url, method, reqHeaders, bodyStr)
    if (resp.status === 429 && attempt < maxRetries) {
      const waitMs = (attempt + 1) * 3000
      console.log(`[fetch-override] 429 rate limited, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`)
      await new Promise(r => setTimeout(r, waitMs))
      continue
    }
    return resp
  }
  return doHttpsRequest(url, method, reqHeaders, bodyStr)
}

console.log('[fetch-override] Patched globalThis.fetch for paymaster URLs (with retry)')
