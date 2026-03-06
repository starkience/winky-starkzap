import { Router, Request, Response } from 'express'
import { getPrivyClient, getAuthorizationContext } from '../lib/privyClient'

const router = Router()

router.post('/starknet', async (req: Request, res: Response) => {
  try {
    const privy = getPrivyClient()
    const auth = (req as any).auth
    const userId: string | undefined = auth?.userId || auth?.sub

    if (userId) {
      for await (const w of privy.wallets().list({ chain_type: 'starknet', user_id: userId })) {
        return res.status(200).json({
          wallet: {
            id: w.id,
            address: w.address,
            publicKey: (w as any).public_key || (w as any).publicKey,
          },
        })
      }
    }

    const createOpts: Record<string, unknown> = { chain_type: 'starknet' }
    if (userId) createOpts.owner = { user_id: userId }

    const wallet = await privy.wallets().create(createOpts as any)
    return res.status(200).json({
      wallet: {
        id: wallet.id,
        address: wallet.address,
        publicKey: (wallet as any).public_key || (wallet as any).publicKey,
      },
    })
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
    const authorization_context = getAuthorizationContext()
    const result = await privy.wallets().rawSign(walletId, {
      params: { hash },
      ...(authorization_context ? { authorization_context } : {}),
    })
    return res.status(200).json({ signature: (result as any).signature })
  } catch (error: any) {
    console.error('Error signing:', error?.message)
    return res.status(500).json({ error: error?.message || 'Failed to sign' })
  }
})

export default router
