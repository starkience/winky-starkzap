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

const LeaderboardModal = dynamic(
  () => import('@/components/Leaderboard').then(m => ({ default: m.LeaderboardModal })),
  { ssr: false, loading: () => null },
);

type AppMode = 'ranked' | 'pvp';

function ModeToggle({ mode, onChange }: { mode: AppMode; onChange: (m: AppMode) => void }) {
  return (
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
  );
}

function LandingPage({ onSelect }: { onSelect: (m: AppMode) => void }) {
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
        <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
          <button className="landing-mode-btn" onClick={() => onSelect('ranked')}>
            Ranked
          </button>
          <button className="landing-mode-btn landing-mode-btn--alt" onClick={() => onSelect('pvp')}>
            PvP
          </button>
        </div>
      </div>
      <div className="powered-by-starknet">
        <span>Powered by</span>
        <img src="/starknet-logo.png" alt="Starknet" />
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
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (sessionStorage.getItem('winky_launched') === '1' || initialChallengeId !== undefined) {
      setLaunched(true);
    }
    if (initialChallengeId !== undefined) {
      setMode('pvp');
    }
  }, [initialChallengeId]);

  const handleModeSelect = (m: AppMode) => {
    setMode(m);
    sessionStorage.setItem('winky_launched', '1');
    setLaunched(true);
  };

  if (!mounted) return null;

  if (!launched) {
    return <LandingPage onSelect={handleModeSelect} />;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div className="app-header-bar">
        <ModeToggle mode={mode} onChange={setMode} />
        <button
          className="leaderboard-header-btn"
          onClick={() => setShowLeaderboard(true)}
        >
          Leaderboard
        </button>
      </div>

      {mode === 'ranked' ? (
        <RankedGame />
      ) : (
        <WinkyGame initialChallengeId={initialChallengeId} />
      )}

      {showLeaderboard && (
        <LeaderboardModal mode={mode} onClose={() => setShowLeaderboard(false)} />
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
