'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const WinkyGame = dynamic(
  () => import('@/components/WinkyGame').then(m => ({ default: m.WinkyGame })),
  { ssr: false, loading: () => null },
);

function LandingPage({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="landing-page">
      <div className="landing-content">
        <img src="/logo.png" alt="Winky" width={120} height={120} className="landing-logo" />
        <h1 className="landing-headline">
          Bet. Blink.<br />Winner takes it all.
        </h1>
        <p className="landing-sub">
          Challenge anyone to a 30-second blink duel on Starknet.
        </p>
        <button onClick={onLaunch} className="landing-cta">
          Launch App
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const [launched, setLaunched] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (sessionStorage.getItem('winky_launched') === '1') {
      setLaunched(true);
    }
  }, []);

  if (!mounted) return null;

  if (launched) return <WinkyGame />;

  return (
    <LandingPage
      onLaunch={() => {
        sessionStorage.setItem('winky_launched', '1');
        setLaunched(true);
      }}
    />
  );
}
