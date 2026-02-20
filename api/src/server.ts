import './fetchOverride'
import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
import { config as starknetConfig } from 'starknet'

const candidates = [
  path.resolve(__dirname, '.env.local'),
  path.resolve(__dirname, '.env'),
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../.env'),
]
for (const p of candidates) {
  if (fs.existsSync(p)) dotenv.config({ path: p })
}

starknetConfig.set('resourceBoundsOverhead', {
  l1_gas: { max_amount: 50, max_price_per_unit: 50 },
  l1_data_gas: { max_amount: 50, max_price_per_unit: 50 },
  l2_gas: { max_amount: 300, max_price_per_unit: 50 },
})

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

app.use('/', require('./routes/health').default || require('./routes/health'))
const { authMiddleware } = require('./middleware/auth')
app.use('/privy', authMiddleware, require('./routes/privy').default || require('./routes/privy'))

app.listen(PORT, () => {
  console.log(`Winky API v1.0.0`)
  console.log(`Server running on http://localhost:${PORT}`)
})
