import { getPrivyClient } from './privyClient'

const publicKeyCache = new Map<string, { publicKey: string; address?: string; chainType: string }>()

export async function getStarknetWallet(walletId: string) {
  if (!walletId) throw new Error('walletId is required')

  const cached = publicKeyCache.get(walletId)
  if (cached) return { ...cached, wallet: null }

  const privy = getPrivyClient()
  const wallet: any = await privy.walletApi.getWallet({ id: walletId })
  const chainType = wallet?.chainType || wallet?.chain_type
  if (!wallet || !chainType || chainType !== 'starknet') {
    throw new Error('Provided wallet is not a Starknet wallet')
  }
  const publicKey: string | undefined = wallet.public_key || wallet.publicKey
  if (!publicKey) throw new Error('Wallet missing Starknet public key')
  const address: string | undefined = wallet.address

  publicKeyCache.set(walletId, { publicKey, address, chainType })

  return { publicKey, address, chainType, wallet }
}
