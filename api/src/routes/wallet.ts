import { Router, Request, Response } from 'express'
import { getPrivyClient } from '../lib/privyClient'

const router = Router()

const walletCache = new Map<string, { id: string; publicKey: string; address?: string }>()

router.post('/starknet', async (req: Request, res: Response) => {
  try {
    const privy = getPrivyClient()
    const wallet = await privy.wallets().create({ chain_type: 'starknet' })
    const result = {
      id: wallet.id,
      address: wallet.address,
      publicKey: (wallet as any).public_key || (wallet as any).publicKey,
    }
    walletCache.set(wallet.id, result)
    return res.status(200).json({ wallet: result })
  } catch (error: any) {
    console.error('Error creating wallet:', error?.message)
    return res.status(500).json({ error: error?.message || 'Failed to create wallet' })
  }
})

router.post('/sign', async (req: Request, res: Response) => {
  try {
    const { walletId, hash } = (req.body || {}) as any
    if (!walletId || !hash) {
      return res.status(400).json({ error: 'walletId and hash are required' })
    }
    const privy = getPrivyClient()
    const result = await privy.wallets().rawSign(walletId, { params: { hash } })
    return res.status(200).json({ signature: (result as any).signature })
  } catch (error: any) {
    console.error('Error signing:', error?.message)
    return res.status(500).json({ error: error?.message || 'Failed to sign' })
  }
})

export default router
