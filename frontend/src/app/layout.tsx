import type { Metadata } from 'next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Winky - Blink to Earn on Starknet',
  description:
    'A playful Starknet app where each blink triggers an on-chain transaction. Gasless, session-key powered.',
  openGraph: {
    title: 'Winky - Blink to Earn',
    description: 'Blink your way to the blockchain! 1 blink = 1 transaction.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
