'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
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

function WelcomePopup({ mode, onClose }: { mode: AppMode; onClose: () => void }) {
  return (
    <div className="welcome-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="welcome-modal">
        <button className="welcome-close" onClick={onClose} aria-label="Close">&times;</button>
        {mode === 'ranked' ? (
          <>
            <h2 className="welcome-title">Welcome to Ranked</h2>
            <p className="welcome-text">
              Every blink you make is a <strong>real transaction on Starknet</strong>. Gas is fully covered by a paymaster &mdash; zero cost to you.<br /><br />
              Climb the <strong>global leaderboard</strong> by blinking the most. Your total blinks are persistent and accumulate across sessions.<br /><br />
              Just connect your wallet and start blinking.
            </p>
          </>
        ) : (
          <>
            <h2 className="welcome-title">Welcome to PvP</h2>
            <p className="welcome-text">
              Challenge anyone to a <strong>30-second blink duel</strong>. Stake USDC &mdash; the winner takes the full pot.<br /><br />
              Create a challenge or accept an existing one. Your opponent&rsquo;s score stays <strong>hidden</strong> until the duel ends.<br /><br />
              Blink detection is 100% local &mdash; no data leaves your device.
            </p>
          </>
        )}
        <button className="welcome-play-btn" onClick={onClose}>Play</button>
      </div>
    </div>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const challengeParam = searchParams.get('challenge');
  const initialChallengeId = challengeParam ? Number(challengeParam) : undefined;

  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<AppMode>(initialChallengeId !== undefined ? 'pvp' : 'ranked');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [preloadedModes, setPreloadedModes] = useState<Set<AppMode>>(new Set());

  useEffect(() => {
    setMounted(true);

    const initialMode: AppMode = initialChallengeId !== undefined ? 'pvp' : 'ranked';
    setPreloadedModes(new Set([initialMode]));

    const welcomeKey = `winky_welcome_${initialMode}`;
    if (!sessionStorage.getItem(welcomeKey)) {
      setShowWelcome(true);
      sessionStorage.setItem(welcomeKey, '1');
    }
  }, [initialChallengeId]);

  const handleModeChange = useCallback((m: AppMode) => {
    setMode(m);
    setPreloadedModes(prev => new Set(prev).add(m));

    const welcomeKey = `winky_welcome_${m}`;
    if (!sessionStorage.getItem(welcomeKey)) {
      setShowWelcome(true);
      sessionStorage.setItem(welcomeKey, '1');
    }
  }, []);

  const handleCloseWelcome = useCallback(() => {
    setShowWelcome(false);
  }, []);

  if (!mounted) return null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div className="app-header-bar">
        <ModeToggle mode={mode} onChange={handleModeChange} />
        <button
          className="leaderboard-header-btn"
          onClick={() => setShowLeaderboard(true)}
        >
          Leaderboard
        </button>
      </div>

      <div style={mode === 'ranked' ? undefined : { position: 'fixed', top: '-200vh', left: '-200vw', width: '1px', height: '1px', overflow: 'hidden', pointerEvents: 'none' }}>
        {(mode === 'ranked' || preloadedModes.has('ranked')) && <RankedGame />}
      </div>
      <div style={mode === 'pvp' ? undefined : { position: 'fixed', top: '-200vh', left: '-200vw', width: '1px', height: '1px', overflow: 'hidden', pointerEvents: 'none' }}>
        {(mode === 'pvp' || preloadedModes.has('pvp')) && <WinkyGame initialChallengeId={initialChallengeId} />}
      </div>

      {showLeaderboard && (
        <LeaderboardModal mode={mode} onClose={() => setShowLeaderboard(false)} />
      )}

      {showWelcome && (
        <WelcomePopup mode={mode} onClose={handleCloseWelcome} />
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
