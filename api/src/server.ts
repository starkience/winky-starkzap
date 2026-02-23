import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'

const candidates = [
  path.resolve(__dirname, '.env.local'),
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../.env'),
]
for (const p of candidates) {
  if (fs.existsSync(p)) dotenv.config({ path: p })
}

const app = express()
const PORT = Number(process.env.PORT || 3000)

app.use((req, _res, next) => {
  if (typeof req.url === 'string' && req.url.includes('//')) {
    const [p, q] = req.url.split('?')
    const normalized = p.replace(/\/{2,}/g, '/')
    req.url = q ? `${normalized}?${q}` : normalized
  }
  next()
})

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3001',
    credentials: true,
  })
)
app.use(express.json())

app.get('/', (_req, res) => {
  res.json({
    status: 'Winky API running',
    version: '2.0.0',
    endpoints: {
      walletCreate: 'POST /api/wallet/starknet',
      walletSign: 'POST /api/wallet/sign',
      paymaster: 'POST /api/paymaster/*',
    },
  })
})

import { authMiddleware } from './middleware/auth'
import walletRoutes from './routes/wallet'
import paymasterRoutes from './routes/paymaster'

app.use('/api/wallet', authMiddleware, walletRoutes)
app.use('/api/paymaster', paymasterRoutes)

app.listen(PORT, () => {
  console.log(`Winky API v2.0.0`)
  console.log(`Server running on http://localhost:${PORT}`)
})
