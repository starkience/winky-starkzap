import { Request, Response, NextFunction } from 'express'
import { getPrivyClient } from '../lib/privyClient'

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const header = (req.headers['authorization'] as string) || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return next()
    try {
      const privy = getPrivyClient()
      const claims = await privy.utils().auth().verifyAccessToken(token)
      ;(req as any).auth = { ...claims, token }
    } catch {}
    return next()
  } catch {
    return next()
  }
}
