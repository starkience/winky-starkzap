'use client';

import { useAccount } from '@starknet-react/core';
import { WalletConnect } from '@/components/WalletConnect';
import { WinkyGame } from '@/components/WinkyGame';

export default function Home() {
  const { isConnected } = useAccount();

  return (
    <main className="min-h-screen">
      {isConnected ? <WinkyGame /> : <WalletConnect />}
    </main>
  );
}
