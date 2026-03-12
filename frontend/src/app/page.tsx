'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useCartridgeWallet } from '@/context/CartridgeWalletContext';
import { CHALLENGE_CONFIG, STORAGE_KEYS } from '@/lib/constants';
import { ChallengeHealthBar } from '@/components/ChallengeHealthBar';

const RankedGame = dynamic(
  () => import('@/components/RankedGame').then(m => ({ default: m.RankedGame })),
  { ssr: false, loading: () => null },
);

const LeaderboardModal = dynamic(
  () => import('@/components/Leaderboard').then(m => ({ default: m.LeaderboardModal })),
  { ssr: false, loading: () => null },
);

function InfoPopup({ show, onClose }: { show: boolean; onClose: () => void }) {
  if (!show) return null;
  return (
    <>
      <div className="info-tooltip-backdrop" onClick={onClose} />
      <div className="info-popup-card">
        <button className="info-popup-close" onClick={onClose} aria-label="Close">&times;</button>
        <p className="info-tooltip-title">How it works</p>
        <ul className="info-tooltip-list">
          <li>Every blink is a real transaction on Starknet</li>
          <li>Gas is fully covered &mdash; zero cost to you</li>
          <li>12-hour ranked challenge &mdash; top 3 share {CHALLENGE_CONFIG.PRIZE}</li>
          <li>Blink detection powered by <a href="https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker" target="_blank" rel="noopener noreferrer">MediaPipe</a></li>
          <li>No data leaves your device &mdash; webcam processing is 100% local</li>
          <li>Fully open source: <a href="https://github.com/starkience/winky-starkzap" target="_blank" rel="noopener noreferrer">GitHub</a></li>
        </ul>
      </div>
    </>
  );
}

function WelcomePopup({ onClose }: { onClose: () => void }) {
  return (
    <div className="welcome-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="welcome-modal">
        <button className="welcome-close" onClick={onClose} aria-label="Close">&times;</button>
        <h2 className="welcome-title">Blink to Earn</h2>
        <p className="welcome-text rainbow-text" style={{ fontSize: '16px', fontWeight: 900, textAlign: 'center', margin: '0 0 12px' }}>
          {CHALLENGE_CONFIG.PRIZE} prize pool distributed among the top 3!
        </p>
        <p className="welcome-text">
          This is a <strong>12-hour blink competition</strong>. Every blink you make is a <strong>real transaction on Starknet</strong>. Gas is fully covered &mdash; zero cost to you.<br /><br />
          Climb the <strong>global leaderboard</strong> by blinking the most. Your blinks accumulate across sessions.<br /><br />
          No data leaves your device &mdash; webcam processing is 100% local.
        </p>
        <button className="welcome-play-btn" onClick={onClose}>Let&apos;s Go</button>
      </div>
    </div>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  void searchParams;

  const { address: controllerAddress, username: controllerUsername } = useCartridgeWallet();
  const walletAddress = controllerAddress
    ?? (typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.controllerAddress) : null)
    ?? undefined;

  const [mounted, setMounted] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    setMounted(true);
    const welcomeKey = 'winky_welcome_v2';
    if (!sessionStorage.getItem(welcomeKey)) {
      setShowWelcome(true);
      sessionStorage.setItem(welcomeKey, '1');
    }
  }, []);

  const handleCloseWelcome = useCallback(() => {
    setShowWelcome(false);
  }, []);

  const handleShowLeaderboard = useCallback(() => setShowLeaderboard(true), []);
  const handleToggleInfo = useCallback(() => setShowInfo(v => !v), []);

  if (!mounted) return null;

  return (
    <div style={{ position: 'relative', width: '100%', minHeight: '100dvh' }}>
      {/* Desktop-only header */}
      <div className="app-header-bar">
        <button
          className="leaderboard-header-btn"
          onClick={handleShowLeaderboard}
        >
          Leaderboard
        </button>
        <button className="info-icon-btn" aria-label="How it works" onClick={handleToggleInfo}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
        </button>
        <ChallengeHealthBar className="challenge-bar-desktop-only" />
      </div>

      <InfoPopup show={showInfo} onClose={() => setShowInfo(false)} />

      <RankedGame
        onShowLeaderboard={handleShowLeaderboard}
        onToggleInfo={handleToggleInfo}
      />

      {showLeaderboard && (
        <LeaderboardModal mode="ranked" userAddress={walletAddress} controllerUsername={controllerUsername} onClose={() => setShowLeaderboard(false)} />
      )}

      {showWelcome && (
        <WelcomePopup onClose={handleCloseWelcome} />
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
