'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { StarkSDK, OnboardStrategy } from 'starkzap';
import type { WalletInterface } from 'starkzap';
import { useBlinkDetection } from '@/hooks/use-blink-detection';
import { useLiveFeed } from '@/hooks/use-live-feed';
import { GAME_CONFIG, NETWORK, API_URL, STORAGE_KEYS, VOYAGER_TX_URL } from '@/lib/constants';
import { BlinkChart } from '@/components/BlinkChart';

// ─── Types & Constants ───

type GamePhase = 'idle' | 'ready' | 'countdown' | 'playing' | 'result';

const BET_AMOUNTS = [1, 5, 10, 25, 50];
const GAME_DURATION = 30;

interface LeaderboardEntry {
  id: string;
  name: string;
  blinks: number;
  earnings: number;
}

const INITIAL_LEADERBOARD: LeaderboardEntry[] = [
  { id: '1', name: 'BlinkMaster.stark', blinks: 87, earnings: 150 },
  { id: '2', name: 'EyeStorm', blinks: 72, earnings: 95 },
  { id: '3', name: '0x7a3f...d912', blinks: 65, earnings: 80 },
  { id: '4', name: 'WinkKing', blinks: 58, earnings: 60 },
  { id: '5', name: '0x9b2c...e4a1', blinks: 45, earnings: 35 },
  { id: '6', name: 'StarkBlinker', blinks: 41, earnings: 25 },
  { id: '7', name: '0x3d1e...f7b2', blinks: 38, earnings: 20 },
  { id: '8', name: 'NeonWink', blinks: 33, earnings: 15 },
];

function formatAddress(addr: string | null | undefined): string {
  if (!addr) return '';
  if (!addr.startsWith('0x')) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ─── Component ───

export function WinkyGame() {
  const { ready, authenticated, user, login, logout } = usePrivy();

  // Wallet state (Starkzap SDK)
  const [sdkWallet, setSdkWallet] = useState<WalletInterface | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const setupAttemptedRef = useRef(false);

  // Game state
  const [gamePhase, setGamePhase] = useState<GamePhase>('idle');
  const [selectedBet, setSelectedBet] = useState<number>(5);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [chartData, setChartData] = useState<Array<{ time: number; blinks: number }>>([]);
  const [countdownNumber, setCountdownNumber] = useState(3);
  const [finalScore, setFinalScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState<number | null>(null);
  const [opponentRevealed, setOpponentRevealed] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(INITIAL_LEADERBOARD);

  // UI state
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blinkCountRef = useRef(0);
  const gameStartTimeRef = useRef(0);
  const leaderboardUpdatedRef = useRef(false);

  // Live transaction feed
  const { events: liveEvents, isLoading: feedLoading } = useLiveFeed();

  const isConnected = ready && authenticated && !!sdkWallet;
  const isPlaying = gamePhase === 'playing';
  const showGameArea = gamePhase === 'ready' || gamePhase === 'countdown' || gamePhase === 'playing';

  // ─── Mobile detection ───
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768 || ('ontouchstart' in window && window.innerWidth <= 1024));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ─── Wallet setup via Starkzap SDK ───
  useEffect(() => {
    if (!ready || !authenticated || !user?.id) return;
    if (sdkWallet) return;
    if (setupAttemptedRef.current || walletLoading) return;
    setupAttemptedRef.current = true;

    const setupWallet = async () => {
      setWalletLoading(true);
      try {
        const storedUser = window.localStorage.getItem(STORAGE_KEYS.userId);
        if (storedUser && storedUser !== user.id) {
          window.localStorage.removeItem(STORAGE_KEYS.walletId);
          window.localStorage.removeItem(STORAGE_KEYS.walletAddress);
          window.localStorage.removeItem(STORAGE_KEYS.publicKey);
        }
        window.localStorage.setItem(STORAGE_KEYS.userId, user.id);

        let wId = window.localStorage.getItem(STORAGE_KEYS.walletId);
        let wPk = window.localStorage.getItem(STORAGE_KEYS.publicKey);

        if (!wId || !wPk) {
          const resp = await fetch(`${API_URL}/api/wallet/starknet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data?.error || 'Create wallet failed');
          const w = data.wallet || {};
          wId = w.id || null;
          wPk = w.publicKey || w.public_key || null;
          if (wId) window.localStorage.setItem(STORAGE_KEYS.walletId, wId);
          if (wPk) window.localStorage.setItem(STORAGE_KEYS.publicKey, wPk);
        }

        if (!wId || !wPk) throw new Error('Failed to get wallet credentials');

        const sdk = new StarkSDK({
          network: NETWORK === 'mainnet' ? 'mainnet' : 'sepolia',
          paymaster: { nodeUrl: `${API_URL}/api/paymaster` },
        });

        const { wallet } = await sdk.onboard({
          strategy: OnboardStrategy.Privy,
          deploy: 'if_needed',
          feeMode: 'sponsored',
          privy: {
            resolve: async () => ({
              walletId: wId!,
              publicKey: wPk!,
              serverUrl: `${API_URL}/api/wallet/sign`,
            }),
          },
        });

        const addr = wallet.address;
        setSdkWallet(wallet);
        setWalletAddress(addr);
        if (addr) window.localStorage.setItem(STORAGE_KEYS.walletAddress, addr);
      } catch (err: any) {
        console.error('[setupWallet] Error:', err.message);
        setError(err.message || 'Wallet setup failed');
      } finally {
        setWalletLoading(false);
      }
    };
    setupWallet();
  }, [ready, authenticated, user?.id, sdkWallet, walletLoading]);

  const handleLogin = useCallback(() => { login(); }, [login]);

  const handleLogout = useCallback(async () => {
    try {
      Object.values(STORAGE_KEYS).forEach(k => {
        try { window.localStorage.removeItem(k); } catch {}
      });
    } catch {}
    setSdkWallet(null);
    setWalletAddress(null);
    setupAttemptedRef.current = false;
    try { await logout(); } catch {}
  }, [logout]);

  // ─── Blink detection ───
  const handleBlink = useCallback((_count: number) => {}, []);

  const {
    videoRef,
    canvasRef,
    isReady: isDetectorReady,
    blinkCount,
    start: startDetection,
    reset: resetDetection,
  } = useBlinkDetection(handleBlink, {
    earThreshold: GAME_CONFIG.EAR_THRESHOLD,
    debounceMs: GAME_CONFIG.BLINK_DEBOUNCE_MS,
    enabled: isPlaying,
  });

  useEffect(() => { blinkCountRef.current = blinkCount; }, [blinkCount]);

  useEffect(() => {
    if (gamePhase === 'playing' && gameStartTimeRef.current > 0) {
      const elapsed = (Date.now() - gameStartTimeRef.current) / 1000;
      setChartData(prev => {
        const last = prev[prev.length - 1];
        if (last && Math.abs(last.time - elapsed) < 0.05) {
          return [...prev.slice(0, -1), { time: Math.round(elapsed * 10) / 10, blinks: blinkCount }];
        }
        return [...prev, { time: Math.round(elapsed * 10) / 10, blinks: blinkCount }];
      });
    }
  }, [blinkCount, gamePhase]);

  useEffect(() => {
    if (gamePhase === 'ready' && isDetectorReady && !cameraReady) {
      startDetection()
        .then(() => setCameraReady(true))
        .catch((err) => {
          console.error('Failed to start camera:', err);
          setError('Camera access required to play');
          setGamePhase('idle');
        });
    }
  }, [gamePhase, isDetectorReady, cameraReady, startDetection]);

  // ─── Game timer ───
  useEffect(() => {
    if (gamePhase !== 'playing') return;
    gameStartTimeRef.current = Date.now();
    setTimeLeft(GAME_DURATION);
    setChartData([{ time: 0, blinks: 0 }]);

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          if (chartIntervalRef.current) clearInterval(chartIntervalRef.current);
          const score = blinkCountRef.current;
          setFinalScore(score);
          setGamePhase('result');
          leaderboardUpdatedRef.current = false;
          setTimeout(() => {
            setOpponentScore(Math.floor(Math.random() * 40) + 20);
            setOpponentRevealed(true);
          }, 2000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    chartIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - gameStartTimeRef.current) / 1000;
      setChartData(prev => {
        const last = prev[prev.length - 1];
        if (last && Math.abs(last.time - elapsed) < 0.3) return prev;
        return [...prev, { time: Math.round(elapsed * 10) / 10, blinks: blinkCountRef.current }];
      });
    }, 500);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (chartIntervalRef.current) clearInterval(chartIntervalRef.current);
    };
  }, [gamePhase]);

  // ─── Leaderboard update after win ───
  useEffect(() => {
    if (!opponentRevealed || opponentScore === null || leaderboardUpdatedRef.current) return;
    if (finalScore <= opponentScore || !walletAddress) return;
    leaderboardUpdatedRef.current = true;
    const displayName = formatAddress(walletAddress);
    setLeaderboard(prev => {
      const existing = prev.find(e => e.name === displayName);
      if (existing) {
        return prev.map(e =>
          e.name === displayName
            ? { ...e, blinks: finalScore, earnings: Math.round((e.earnings + selectedBet * 2 * 0.95) * 100) / 100 }
            : e
        ).sort((a, b) => b.earnings - a.earnings);
      }
      return [
        { id: `user-${Date.now()}`, name: displayName, blinks: finalScore, earnings: Math.round(selectedBet * 2 * 0.95 * 100) / 100 },
        ...prev,
      ].sort((a, b) => b.earnings - a.earnings);
    });
  }, [opponentRevealed, opponentScore, finalScore, walletAddress, selectedBet]);

  // ─── Handlers ───
  const handlePlay = useCallback(() => {
    if (!isConnected) return;
    resetDetection();
    blinkCountRef.current = 0;
    setChartData([]);
    setFinalScore(0);
    setOpponentScore(null);
    setOpponentRevealed(false);
    setError(null);
    setGamePhase('ready');
  }, [isConnected, resetDetection]);

  const handleStart = useCallback(() => {
    setGamePhase('countdown');
    setCountdownNumber(3);
    resetDetection();
    blinkCountRef.current = 0;
    setTimeout(() => setCountdownNumber(2), 1000);
    setTimeout(() => setCountdownNumber(1), 2000);
    setTimeout(() => setGamePhase('playing'), 3000);
  }, [resetDetection]);

  const handlePlayAgain = useCallback(() => {
    resetDetection();
    blinkCountRef.current = 0;
    setChartData([]);
    setFinalScore(0);
    setOpponentScore(null);
    setOpponentRevealed(false);
    setTimeLeft(GAME_DURATION);
    leaderboardUpdatedRef.current = false;
    setGamePhase('idle');
  }, [resetDetection]);

  const handleCopyAddress = useCallback(() => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [walletAddress]);

  const isWinner = opponentRevealed && opponentScore !== null && finalScore > opponentScore;
  const isDraw = opponentRevealed && opponentScore !== null && finalScore === opponentScore;
  const isLoser = opponentRevealed && opponentScore !== null && finalScore < opponentScore;
  const loginBusy = !ready || walletLoading;

  // ─── Sidebar content (shared across all phases) ───
  const sidebarContent = (
    <div style={{
      width: isMobile ? '100%' : '300px',
      minWidth: isMobile ? undefined : '300px',
      display: 'flex',
      flexDirection: 'column',
      borderLeft: isMobile ? 'none' : '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(17,17,17,0.6)',
      backdropFilter: 'blur(20px)',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Sidebar header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/logo.png" alt="Wink." style={{ height: '28px', objectFit: 'contain' }} />
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
              PVP Duel
            </span>
          </div>
          {NETWORK === 'sepolia' && (
            <span style={{ fontSize: '9px', color: '#f59e0b', padding: '2px 6px', border: '1px solid #f59e0b', borderRadius: '4px', fontWeight: 600, background: 'rgba(245,158,11,0.1)' }}>
              Testnet
            </span>
          )}
        </div>

        {/* Connect / Address */}
        {isConnected && walletAddress ? (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={handleCopyAddress} style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 12px', background: 'rgba(192,180,218,0.08)',
              border: '1.5px solid rgba(192,180,218,0.3)', borderRadius: '8px',
              color: '#C0B4DA', fontSize: '12px', fontWeight: 700,
              fontFamily: "'Manrope', sans-serif", cursor: 'pointer',
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
              {copied ? 'Copied!' : formatAddress(walletAddress)}
            </button>
            <button onClick={handleLogout} style={{
              padding: '8px 10px', background: 'transparent',
              border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px',
              color: '#ef4444', fontSize: '11px', fontWeight: 600,
              fontFamily: "'Manrope', sans-serif", cursor: 'pointer',
            }}>
              ×
            </button>
          </div>
        ) : (
          <button onClick={handleLogin} disabled={loginBusy} style={{
            padding: '10px', background: walletLoading ? '#6366f1' : '#C0B4DA',
            border: 'none', borderRadius: '8px', color: '#fff',
            fontSize: '14px', fontWeight: 800, fontFamily: "'Manrope', sans-serif",
            cursor: loginBusy ? 'wait' : 'pointer', opacity: loginBusy ? 0.7 : 1,
            boxShadow: '0 2px 12px rgba(192,180,218,0.3)',
          }}>
            {walletLoading ? 'Setting up...' : !ready ? 'Loading...' : 'Connect Wallet'}
          </button>
        )}
      </div>

      {/* Bet + Play section */}
      <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '1.5px', margin: 0 }}>
          Stake (USDC)
        </p>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {BET_AMOUNTS.map(amount => (
            <button key={amount} onClick={() => setSelectedBet(amount)} style={{
              flex: 1, minWidth: '44px', padding: '8px 4px',
              background: selectedBet === amount ? '#C0B4DA' : 'transparent',
              border: `1.5px solid ${selectedBet === amount ? '#C0B4DA' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '8px',
              color: selectedBet === amount ? '#fff' : '#666',
              fontSize: '13px', fontWeight: 800, fontFamily: "'Manrope', sans-serif",
              cursor: 'pointer', transition: 'all 0.15s',
            }}>
              ${amount}
            </button>
          ))}
        </div>
        <button
          onClick={isConnected ? handlePlay : handleLogin}
          disabled={loginBusy || showGameArea}
          style={{
            padding: '12px', borderRadius: '10px', border: 'none',
            background: isConnected && !showGameArea ? '#C0B4DA' : 'rgba(166,164,167,0.12)',
            color: isConnected && !showGameArea ? '#fff' : '#555',
            fontSize: '16px', fontWeight: 900, fontFamily: "'Manrope', sans-serif",
            cursor: isConnected && !showGameArea ? 'pointer' : 'default',
            boxShadow: isConnected && !showGameArea ? '0 4px 16px rgba(192,180,218,0.3)' : 'none',
            transition: 'all 0.2s', letterSpacing: '0.5px',
          }}
        >
          {showGameArea ? 'In Game...' : isConnected ? 'Play' : 'Connect to play'}
        </button>
      </div>

      {/* Leaderboard */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 800, color: '#A6A4A7' }}>Leaderboard</span>
          <span style={{ fontSize: '9px', fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Blinks / Earned
          </span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {leaderboard.map((entry, idx) => (
            <div key={entry.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 16px',
              borderBottom: idx < leaderboard.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
              background: idx === 0 ? 'rgba(255,215,0,0.04)' : idx === 1 ? 'rgba(192,192,192,0.03)' : idx === 2 ? 'rgba(205,127,50,0.03)' : 'transparent',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <span style={{
                  fontSize: '12px', fontWeight: 800, width: '22px', textAlign: 'center', flexShrink: 0,
                  color: idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : idx === 2 ? '#CD7F32' : '#444',
                }}>
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`}
                </span>
                <span style={{
                  fontSize: '12px', fontWeight: 600, color: '#A6A4A7',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {entry.name}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#C0B4DA', fontVariantNumeric: 'tabular-nums' }}>
                  {entry.blinks}
                </span>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#22c55e', minWidth: '45px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  ${entry.earnings}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ─── Render ───
  return (
    <div style={{
      display: 'flex',
      width: '100%',
      height: '100vh',
      overflow: 'hidden',
      background: '#0A0A0A',
      fontFamily: "'Manrope', sans-serif",
      flexDirection: isMobile ? 'column' : 'row',
    }}>

      {/* ═══ MAIN AREA (left, fills remaining space) ═══ */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
      }}>

        {/* ─── IDLE: centered instructions ─── */}
        {gamePhase === 'idle' && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '24px',
            padding: '40px',
          }}>
            <div style={{ fontSize: '48px' }}>👁️</div>
            <h1 style={{ fontSize: '28px', fontWeight: 900, color: '#A6A4A7', margin: 0, textAlign: 'center' }}>
              Blink Duel
            </h1>
            <p style={{ fontSize: '15px', color: '#555', fontWeight: 500, textAlign: 'center', maxWidth: '400px', lineHeight: 1.6 }}>
              Select a stake from the sidebar and press <strong style={{ color: '#C0B4DA' }}>Play</strong> to start.
              You have 30 seconds to out-blink your opponent.
            </p>
            <div style={{ display: 'flex', gap: '32px' }}>
              {[
                { step: '1', label: 'Connect wallet' },
                { step: '2', label: 'Choose stake' },
                { step: '3', label: 'Blink to win' },
              ].map(s => (
                <div key={s.step} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '50%',
                    background: 'rgba(192,180,218,0.1)', border: '2px solid rgba(192,180,218,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '14px', fontWeight: 800, color: '#C0B4DA',
                  }}>{s.step}</div>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#666' }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── GAME PHASES: left column (webcam + tx log) + right area (chart/content) ─── */}
        <div style={showGameArea ? {
          display: 'flex', flex: 1, minHeight: 0, position: 'relative',
        } : {
          position: 'fixed' as const, top: '-9999px', left: '-9999px',
          width: '1px', height: '1px', overflow: 'hidden', pointerEvents: 'none' as const,
        }}>
          {/* Left column: webcam + stats + tx log */}
          <div style={{
            width: '192px', minWidth: '192px', display: 'flex', flexDirection: 'column',
            padding: '12px 0 12px 12px', gap: '8px', flexShrink: 0, overflow: 'hidden',
          }}>
            {/* Webcam */}
            <div style={{
              position: 'relative', width: '176px', height: '132px',
              borderRadius: '10px', overflow: 'hidden',
              border: '2px solid rgba(255,255,255,0.1)', background: '#111',
              flexShrink: 0,
            }}>
              <video
                ref={(el) => { videoRef.current = el; }}
                autoPlay playsInline muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' }}
              />
              <canvas
                ref={(el) => { canvasRef.current = el; }}
                width={176} height={132}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }}
              />
              {gamePhase === 'ready' && !cameraReady && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 5 }}>
                  <div className="spinner" style={{ width: '24px', height: '24px' }} />
                </div>
              )}
            </div>

            {/* Stats below webcam */}
            <div style={{ padding: '4px 2px', flexShrink: 0 }}>
              {gamePhase === 'playing' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                    <span style={{ fontSize: '28px', fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: '#C0B4DA' }}>
                      {blinkCount}
                    </span>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#555', textTransform: 'uppercase' }}>blinks</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '16px', fontWeight: 900, fontVariantNumeric: 'tabular-nums',
                      color: timeLeft <= 5 ? '#ef4444' : timeLeft <= 10 ? '#f59e0b' : '#A6A4A7',
                    }}>
                      0:{timeLeft.toString().padStart(2, '0')}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 800, color: '#C0B4DA' }}>${selectedBet}</span>
                  </div>
                </div>
              )}
              {gamePhase === 'ready' && cameraReady && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
                  <button
                    onClick={handleStart}
                    style={{
                      width: '100%', padding: '10px', background: '#C0B4DA', border: 'none',
                      borderRadius: '10px', color: '#fff', fontSize: '16px', fontWeight: 900,
                      fontFamily: "'Manrope', sans-serif", cursor: 'pointer', letterSpacing: '3px',
                      boxShadow: '0 4px 16px rgba(192,180,218,0.4)',
                    }}
                  >
                    START
                  </button>
                  <span style={{ fontSize: '11px', color: '#555', fontWeight: 600 }}>Press to begin</span>
                </div>
              )}
              {gamePhase === 'ready' && !cameraReady && (
                <span style={{ fontSize: '12px', color: '#555', fontWeight: 600 }}>Starting camera...</span>
              )}
              {gamePhase === 'countdown' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '36px', fontWeight: 900, color: '#C0B4DA', lineHeight: 1, animation: 'pulse 1s ease-in-out infinite' }}>
                    {countdownNumber}
                  </span>
                  <span style={{ fontSize: '12px', color: '#666', fontWeight: 700 }}>Get ready...</span>
                </div>
              )}
            </div>

            {/* Transaction log below webcam (playing phase only) */}
            {gamePhase === 'playing' && (
              <div style={{
                flex: 1, borderRadius: '10px', background: '#111',
                border: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                minHeight: 0,
              }}>
                <div style={{
                  padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
                }}>
                  <span style={{ fontSize: '9px', fontWeight: 800, color: '#A6A4A7', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    Transactions
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '8px', fontWeight: 700, color: '#22c55e' }}>
                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s ease-in-out infinite' }} />
                    LIVE
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>
                  {feedLoading && liveEvents.length === 0 && (
                    <div style={{ padding: '12px', textAlign: 'center', color: '#444', fontSize: '10px' }}>Loading...</div>
                  )}
                  {!feedLoading && liveEvents.length === 0 && (
                    <div style={{ padding: '12px', textAlign: 'center', color: '#444', fontSize: '10px' }}>No transactions yet</div>
                  )}
                  {liveEvents.map((ev) => {
                    const timeAgo = Math.floor((Date.now() - ev.timestamp) / 1000);
                    const timeStr = timeAgo < 60 ? `${timeAgo}s` : timeAgo < 3600 ? `${Math.floor(timeAgo / 60)}m` : `${Math.floor(timeAgo / 3600)}h`;
                    return (
                      <div key={ev.id} style={{
                        padding: '5px 8px', borderBottom: '1px solid rgba(255,255,255,0.03)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px',
                      }}>
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, color: '#A6A4A7', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {ev.twitterUsername ? `@${ev.twitterUsername}` : `${ev.address.slice(0, 6)}...${ev.address.slice(-4)}`}
                          </span>
                          <span style={{ fontSize: '9px', color: '#555', fontWeight: 600 }}>
                            #{ev.userTotal} · {timeStr}
                          </span>
                        </div>
                        {VOYAGER_TX_URL && ev.txHash && (
                          <a
                            href={`${VOYAGER_TX_URL}/${ev.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: '8px', fontWeight: 700, color: '#C0B4DA',
                              textDecoration: 'none', padding: '2px 5px',
                              border: '1px solid rgba(192,180,218,0.2)', borderRadius: '4px',
                              flexShrink: 0, whiteSpace: 'nowrap',
                            }}
                          >
                            ↗
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right area: chart / controls */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
            <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
              {(gamePhase === 'playing' || chartData.length > 1) ? (
                <div style={{ position: 'absolute', inset: 0, padding: '8px 8px 8px 0' }}>
                  {gamePhase === 'playing' && (
                    <div style={{
                      position: 'absolute', right: '20px', top: '16px', zIndex: 2,
                      display: 'flex', alignItems: 'center', gap: '6px',
                      fontSize: '10px', fontWeight: 700, color: '#ef4444',
                      textTransform: 'uppercase', letterSpacing: '1px',
                    }}>
                      LIVE
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s ease-in-out infinite' }} />
                    </div>
                  )}
                  <BlinkChart data={chartData} height={"100%"} />
                </div>
              ) : (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '100%', color: '#333', fontSize: '14px', fontWeight: 600,
                }}>
                  {gamePhase === 'ready' ? 'Chart will appear when you start' : ''}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── RESULT PHASE ─── */}
        {gamePhase === 'result' && (
          <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
            {/* Left column: tx log */}
            <div style={{
              width: '192px', minWidth: '192px', display: 'flex', flexDirection: 'column',
              padding: '12px 0 12px 12px', gap: '8px', flexShrink: 0, overflow: 'hidden',
            }}>
              <div style={{
                flex: 1, borderRadius: '10px', background: '#111',
                border: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                minHeight: 0,
              }}>
                <div style={{
                  padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
                }}>
                  <span style={{ fontSize: '9px', fontWeight: 800, color: '#A6A4A7', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    Transactions
                  </span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>
                  {liveEvents.length === 0 && (
                    <div style={{ padding: '12px', textAlign: 'center', color: '#444', fontSize: '10px' }}>No transactions</div>
                  )}
                  {liveEvents.map((ev) => {
                    const timeAgo = Math.floor((Date.now() - ev.timestamp) / 1000);
                    const timeStr = timeAgo < 60 ? `${timeAgo}s` : timeAgo < 3600 ? `${Math.floor(timeAgo / 60)}m` : `${Math.floor(timeAgo / 3600)}h`;
                    return (
                      <div key={ev.id} style={{
                        padding: '5px 8px', borderBottom: '1px solid rgba(255,255,255,0.03)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px',
                      }}>
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, color: '#A6A4A7', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {ev.twitterUsername ? `@${ev.twitterUsername}` : `${ev.address.slice(0, 6)}...${ev.address.slice(-4)}`}
                          </span>
                          <span style={{ fontSize: '9px', color: '#555', fontWeight: 600 }}>
                            #{ev.userTotal} · {timeStr}
                          </span>
                        </div>
                        {VOYAGER_TX_URL && ev.txHash && (
                          <a
                            href={`${VOYAGER_TX_URL}/${ev.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: '8px', fontWeight: 700, color: '#C0B4DA',
                              textDecoration: 'none', padding: '2px 5px',
                              border: '1px solid rgba(192,180,218,0.2)', borderRadius: '4px',
                              flexShrink: 0, whiteSpace: 'nowrap',
                            }}
                          >
                            ↗
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right area: result content */}
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '20px',
              padding: '32px', overflow: 'auto',
            }}>
              <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#A6A4A7', margin: 0 }}>
                Time&apos;s Up!
              </h2>
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <div style={{
                  padding: '20px 32px', background: '#141414', borderRadius: '14px',
                  border: '2px solid rgba(192,180,218,0.2)', textAlign: 'center', minWidth: '160px',
                }}>
                  <p style={{ fontSize: '10px', color: '#666', fontWeight: 700, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>Your Blinks</p>
                  <p style={{ fontSize: '48px', fontWeight: 900, color: '#C0B4DA', margin: 0, lineHeight: 1 }}>{finalScore}</p>
                </div>
                {opponentRevealed && opponentScore !== null && (
                  <div style={{
                    padding: '20px 32px', background: '#141414', borderRadius: '14px',
                    border: '2px solid rgba(255,255,255,0.06)', textAlign: 'center', minWidth: '160px',
                  }}>
                    <p style={{ fontSize: '10px', color: '#666', fontWeight: 700, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>Opponent</p>
                    <p style={{ fontSize: '48px', fontWeight: 900, color: '#A6A4A7', margin: 0, lineHeight: 1 }}>{opponentScore}</p>
                  </div>
                )}
              </div>
              {!opponentRevealed && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div className="spinner" />
                  <p style={{ fontSize: '13px', color: '#555', fontWeight: 600, margin: 0 }}>Waiting for opponent...</p>
                </div>
              )}
              {opponentRevealed && opponentScore !== null && (
                <div style={{
                  padding: '16px 28px', borderRadius: '12px', textAlign: 'center',
                  background: isWinner ? 'rgba(34,197,94,0.1)' : isDraw ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `2px solid ${isWinner ? 'rgba(34,197,94,0.3)' : isDraw ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}`,
                }}>
                  <p style={{ fontSize: '28px', fontWeight: 900, margin: 0, color: isWinner ? '#22c55e' : isDraw ? '#f59e0b' : '#ef4444' }}>
                    {isWinner ? 'YOU WIN!' : isDraw ? 'DRAW!' : 'YOU LOSE'}
                  </p>
                  <p style={{ fontSize: '14px', fontWeight: 700, margin: '6px 0 0', color: isWinner ? '#22c55e' : isDraw ? '#f59e0b' : '#ef4444' }}>
                    {isWinner ? `+$${(selectedBet * 2 * 0.95).toFixed(2)} USDC` : isDraw ? 'Bet returned' : `-$${selectedBet} USDC`}
                  </p>
                </div>
              )}
              {chartData.length > 1 && (
                <div style={{ width: '100%', maxWidth: '500px', background: '#111', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)', padding: '12px' }}>
                  <BlinkChart data={chartData} height={140} />
                </div>
              )}
              <button onClick={handlePlayAgain} style={{
                padding: '12px 40px', background: '#C0B4DA', border: 'none', borderRadius: '10px',
                color: '#fff', fontSize: '16px', fontWeight: 800, fontFamily: "'Manrope', sans-serif",
                cursor: 'pointer', boxShadow: '0 4px 16px rgba(192,180,218,0.4)',
              }}>
                Play Again
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ SIDEBAR (right) ═══ */}
      {sidebarContent}

      {/* Error banner */}
      {error && (
        <div style={{
          position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
          padding: '10px 20px', background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px',
          color: '#ef4444', fontSize: '13px', fontWeight: 600, zIndex: 100,
          fontFamily: "'Manrope', sans-serif", maxWidth: '90vw',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          {error}
          <button onClick={() => setError(null)} style={{
            background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px', fontWeight: 800,
          }}>×</button>
        </div>
      )}
    </div>
  );
}
