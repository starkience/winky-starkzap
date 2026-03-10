'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

const WinkyGame = dynamic(
  () => import('@/components/WinkyGame').then(m => ({ default: m.WinkyGame })),
  { ssr: false, loading: () => null },
);

const RankedGame = dynamic(
  () => import('@/components/RankedGame').then(m => ({ default: m.RankedGame })),
  { ssr: false, loading: () => null },
);

type AppMode = 'ranked' | 'pvp';

function ModeToggle({ mode, onChange }: { mode: AppMode; onChange: (m: AppMode) => void }) {
  return (
    <div className="mode-toggle-wrapper">
      <div className="mode-toggle">
        <button
          className={`mode-toggle-btn${mode === 'ranked' ? ' mode-toggle-btn--active' : ''}`}
          onClick={() => onChange('ranked')}
        >
          Ranked
        </button>
        <button
          className={`mode-toggle-btn${mode === 'pvp' ? ' mode-toggle-btn--active' : ''}`}
          onClick={() => onChange('pvp')}
        >
          PvP
        </button>
        <div
          className="mode-toggle-slider"
          style={{ transform: mode === 'pvp' ? 'translateX(100%)' : 'translateX(0)' }}
        />
      </div>
    </div>
  );
}

function LandingPage({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="landing-page">
      <div className="landing-content">
        <img src="/logo.png" alt="Winky" width={120} height={120} className="landing-logo" />
        <h1 className="landing-headline">
          Blink. On-chain.
        </h1>
        <p className="landing-sub">
          Every blink is a real transaction on Starknet. Zero gas. Climb the leaderboard or challenge anyone to a PvP blink duel.
        </p>
        <button onClick={onLaunch} className="landing-cta">
          Launch App
        </button>
      </div>
    </div>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const challengeParam = searchParams.get('challenge');
  const initialChallengeId = challengeParam ? Number(challengeParam) : undefined;

  const [launched, setLaunched] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<AppMode>('ranked');

  useEffect(() => {
    setMounted(true);
    if (sessionStorage.getItem('winky_launched') === '1' || initialChallengeId !== undefined) {
      setLaunched(true);
    }
    if (initialChallengeId !== undefined) {
      setMode('pvp');
    }
  }, [initialChallengeId]);

  if (!mounted) return null;

  if (!launched) {
    return (
      <LandingPage
        onLaunch={() => {
          sessionStorage.setItem('winky_launched', '1');
          setLaunched(true);
        }}
      />
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <ModeToggle mode={mode} onChange={setMode} />
      {mode === 'ranked' ? (
        <RankedGame />
      ) : (
        <WinkyGame initialChallengeId={initialChallengeId} />
      )}
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
