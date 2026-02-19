'use client';

/**
 * Privy + React Query Providers
 *
 * Uses Privy for social login (email, Google, Twitter, etc.).
 * All wallet operations happen via the Express backend API.
 */

import { ReactNode, useState } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastContainer } from 'react-toastify';
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

  const loginMethods = (process.env.NEXT_PUBLIC_PRIVY_LOGIN_METHODS || 'email')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as any;

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
      <QueryClientProvider client={queryClient}>
        {children}
        <ToastContainer
          position="bottom-right"
          theme="dark"
          autoClose={5000}
        />
      </QueryClientProvider>
    </PrivyProvider>
  );
}
