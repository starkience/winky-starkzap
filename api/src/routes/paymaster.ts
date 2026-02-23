import { Router, Request, Response } from 'express'

const router = Router()

const AVNU_URL = process.env.PAYMASTER_URL || 'https://starknet.paymaster.avnu.fi'
const API_KEY = (process.env.PAYMASTER_API_KEY || '').trim()

router.all('/*', async (req: Request, res: Response) => {
  try {
    const targetPath = req.params[0] || ''
    const targetUrl = `${AVNU_URL}/${targetPath}`.replace(/\/+$/, '')

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

    const upstream = await fetch(targetUrl, fetchOpts)
    const text = await upstream.text()

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
})

export default router
