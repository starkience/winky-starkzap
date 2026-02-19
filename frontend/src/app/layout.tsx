import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import './globals.css';

const Providers = dynamic(() => import('./providers').then(m => ({ default: m.Providers })), {
  ssr: false,
});

export const metadata: Metadata = {
  title: 'Winky - Blink on Starknet',
  description:
    'A playful Starknet app where each blink triggers an on-chain transaction. Gasless, Privy-powered.',
  openGraph: {
    title: 'Winky - Blink on Starknet',
    description: 'One blink is one Starknet transaction. Powered by Privy social login and Gasless transactions.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
