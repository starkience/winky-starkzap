import { Router, Request, Response } from 'express'

const router = Router()

router.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'Winky API running',
    version: '1.0.0',
    endpoints: {
      privyCreate: 'POST /privy/create-wallet',
      privyPublicKey: 'POST /privy/public-key',
      privyUserWallets: 'GET /privy/user-wallets?userId=…',
      privyDeploy: 'POST /privy/deploy-wallet',
      privyExecute: 'POST /privy/execute',
      privyRecordBlink: 'POST /privy/record-blink',
    },
  })
})

export default router
