'use client';

/**
 * App Providers
 *
 * Privy is kept in the tree (inactive in the UI) for potential future use.
 * The active wallet flow uses the Cartridge Controller via CartridgeWalletProvider.
 */

import { ReactNode, useState } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastContainer } from 'react-toastify';
import { CartridgeWalletProvider } from '@/context/CartridgeWalletContext';
import 'react-toastify/dist/ReactToastify.css';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5,
        retry: 3,
      },
    },
  }));

  const loginMethods: ('twitter')[] = ['twitter'];

  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ''}
      config={{
        loginMethods,
        appearance: {
          theme: 'dark',
        },
      }}
    >
      <CartridgeWalletProvider>
        <QueryClientProvider client={queryClient}>
          {children}
          <ToastContainer
            position="bottom-right"
            theme="dark"
            autoClose={5000}
          />
        </QueryClientProvider>
      </CartridgeWalletProvider>
    </PrivyProvider>
  );
}
