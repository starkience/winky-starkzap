import { Router, Request, Response } from 'express'

const router = Router()

const AVNU_URL = (process.env.PAYMASTER_URL || 'https://starknet.paymaster.avnu.fi').replace(/\/+$/, '')
const API_KEY = (process.env.PAYMASTER_API_KEY || '').trim()

async function proxyPaymaster(req: Request, res: Response) {
  try {
    const subPath = (req.params as any).path || req.path?.replace(/^\//, '') || ''
    const targetUrl = subPath ? `${AVNU_URL}/${subPath}` : AVNU_URL

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (API_KEY) {
      headers['x-paymaster-api-key'] = API_KEY
    }

    const fetchOpts: RequestInit = {
      method: req.method,
      headers,
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOpts.body = JSON.stringify(req.body)
    }

    console.log(`[paymaster-proxy] ${req.method} -> ${targetUrl}`)

    const upstream = await fetch(targetUrl, fetchOpts)
    const text = await upstream.text()

    console.log(`[paymaster-proxy] ${upstream.status} (${text.length} bytes)`)

    res.status(upstream.status)
    upstream.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        res.setHeader(key, value)
      }
    })
    res.setHeader('Content-Type', 'application/json')
    return res.send(text)
  } catch (error: any) {
    console.error('Paymaster proxy error:', error?.message)
    return res.status(502).json({ error: error?.message || 'Paymaster proxy failed' })
  }
}

router.all('/', proxyPaymaster)
router.all('{*path}', proxyPaymaster)

export default router
