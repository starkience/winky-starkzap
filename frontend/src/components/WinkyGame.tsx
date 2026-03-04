'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { StarkSDK, OnboardStrategy } from 'starkzap';
import type { WalletInterface } from 'starkzap';
import { useBlinkDetection } from '@/hooks/use-blink-detection';
import { GAME_CONFIG, NETWORK, API_URL, STORAGE_KEYS } from '@/lib/constants';
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
  const handleBlink = useCallback((_count: number) => {
    // Blink counting is handled by the hook's blinkCount state
  }, []);

  const {
    videoRef,
    canvasRef,
    isReady: isDetectorReady,
    isRunning,
    blinkCount,
    start: startDetection,
    reset: resetDetection,
  } = useBlinkDetection(handleBlink, {
    earThreshold: GAME_CONFIG.EAR_THRESHOLD,
    debounceMs: GAME_CONFIG.BLINK_DEBOUNCE_MS,
    enabled: isPlaying,
  });

  // Sync blink count ref for use in intervals
  useEffect(() => {
    blinkCountRef.current = blinkCount;
  }, [blinkCount]);

  // Update chart data on every blink during playing
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

  // ─── Start camera when entering ready phase ───
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

          // Mock opponent reveal after 2s
          setTimeout(() => {
            const mockOpponent = Math.floor(Math.random() * 40) + 20;
            setOpponentScore(mockOpponent);
            setOpponentRevealed(true);
          }, 2000);

          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Chart data collection every 500ms
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
    if (finalScore <= opponentScore) return;
    if (!walletAddress) return;

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

  const handleBack = useCallback(() => {
    setGamePhase('idle');
  }, []);

  // Determine winner
  const isWinner = opponentRevealed && opponentScore !== null && finalScore > opponentScore;
  const isDraw = opponentRevealed && opponentScore !== null && finalScore === opponentScore;
  const isLoser = opponentRevealed && opponentScore !== null && finalScore < opponentScore;

  const loginBusy = !ready || walletLoading;

  // ─── Render ───
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100vh',
      overflow: 'hidden',
      background: '#0A0A0A',
      fontFamily: "'Manrope', sans-serif",
    }}>

      {/* ─── Header ─── */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: isMobile ? '12px 16px' : '16px 32px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img src="/logo.png" alt="Wink." style={{ height: isMobile ? '28px' : '36px', objectFit: 'contain' }} />
          {!isMobile && (
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#555', letterSpacing: '1px', textTransform: 'uppercase' }}>
              PVP Blink Duel
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isConnected && walletAddress ? (
            <>
              <button
                onClick={handleCopyAddress}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: isMobile ? '8px 14px' : '10px 20px',
                  background: 'rgba(192, 180, 218, 0.08)',
                  border: '2px solid #C0B4DA',
                  borderRadius: '10px',
                  color: '#C0B4DA',
                  fontSize: isMobile ? '13px' : '15px',
                  fontWeight: 700,
                  fontFamily: "'Manrope', sans-serif",
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                {copied ? 'Copied!' : formatAddress(walletAddress)}
              </button>
              <button
                onClick={handleLogout}
                style={{
                  padding: isMobile ? '8px 12px' : '10px 16px',
                  background: 'transparent',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '8px',
                  color: '#ef4444',
                  fontSize: '13px',
                  fontWeight: 600,
                  fontFamily: "'Manrope', sans-serif",
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                Logout
              </button>
            </>
          ) : (
            <button
              onClick={handleLogin}
              disabled={loginBusy}
              style={{
                padding: isMobile ? '10px 20px' : '12px 32px',
                background: walletLoading ? '#6366f1' : '#C0B4DA',
                border: 'none',
                borderRadius: '10px',
                color: '#fff',
                fontSize: isMobile ? '14px' : '16px',
                fontWeight: 800,
                fontFamily: "'Manrope', sans-serif",
                cursor: loginBusy ? 'wait' : 'pointer',
                opacity: loginBusy ? 0.7 : 1,
                transition: 'all 0.2s',
                boxShadow: '0 2px 12px rgba(192, 180, 218, 0.3)',
              }}
            >
              {walletLoading ? 'Setting up...' : !ready ? 'Loading...' : 'Connect'}
            </button>
          )}
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'auto',
        padding: isMobile ? '20px 16px' : '40px 32px',
      }}>

        {/* ═══ IDLE PHASE ═══ */}
        {gamePhase === 'idle' && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: isMobile ? '24px' : '32px',
            width: '100%',
            maxWidth: '600px',
          }}>
            {/* Bet amount buttons */}
            <div style={{ textAlign: 'center' }}>
              <p style={{
                fontSize: '12px', fontWeight: 700, color: '#555',
                marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1.5px',
              }}>
                Bet Amount (USDC)
              </p>
              <div style={{
                display: 'flex', gap: isMobile ? '8px' : '12px',
                justifyContent: 'center', flexWrap: 'wrap',
              }}>
                {BET_AMOUNTS.map(amount => (
                  <button
                    key={amount}
                    onClick={() => setSelectedBet(amount)}
                    style={{
                      padding: isMobile ? '10px 18px' : '12px 24px',
                      background: selectedBet === amount ? '#C0B4DA' : 'transparent',
                      border: `2px solid ${selectedBet === amount ? '#C0B4DA' : 'rgba(255,255,255,0.12)'}`,
                      borderRadius: '12px',
                      color: selectedBet === amount ? '#fff' : '#666',
                      fontSize: isMobile ? '15px' : '18px',
                      fontWeight: 800,
                      fontFamily: "'Manrope', sans-serif",
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      minWidth: isMobile ? '54px' : '64px',
                      boxShadow: selectedBet === amount ? '0 4px 16px rgba(192, 180, 218, 0.35)' : 'none',
                    }}
                  >
                    ${amount}
                  </button>
                ))}
              </div>
            </div>

            {/* Play button */}
            <button
              onClick={isConnected ? handlePlay : handleLogin}
              disabled={loginBusy}
              style={{
                padding: isMobile ? '18px 48px' : '22px 80px',
                background: isConnected ? '#C0B4DA' : 'rgba(166, 164, 167, 0.12)',
                border: isConnected ? '3px solid #C0B4DA' : '3px solid rgba(166, 164, 167, 0.15)',
                borderRadius: '16px',
                color: isConnected ? '#fff' : '#555',
                fontSize: isMobile ? '20px' : '28px',
                fontWeight: 900,
                fontFamily: "'Manrope', sans-serif",
                cursor: isConnected ? 'pointer' : loginBusy ? 'wait' : 'pointer',
                transition: 'all 0.3s',
                letterSpacing: '1px',
                boxShadow: isConnected ? '0 8px 32px rgba(192, 180, 218, 0.35)' : 'none',
              }}
              onMouseEnter={(e) => {
                if (isConnected) {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.style.boxShadow = '0 12px 40px rgba(192, 180, 218, 0.5)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = isConnected ? '0 8px 32px rgba(192, 180, 218, 0.35)' : 'none';
              }}
            >
              {isConnected ? 'Play' : 'Connect to play'}
            </button>

            {/* Leaderboard */}
            <div style={{
              width: '100%',
              background: '#111',
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.06)',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: isMobile ? '16px 16px 12px' : '20px 24px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <h3 style={{ fontSize: isMobile ? '16px' : '18px', fontWeight: 800, color: '#A6A4A7', margin: 0 }}>
                  Leaderboard
                </h3>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Blinks / Earnings
                </span>
              </div>
              <div>
                {leaderboard.map((entry, idx) => (
                  <div
                    key={entry.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: isMobile ? '12px 16px' : '14px 24px',
                      borderBottom: idx < leaderboard.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      transition: 'background 0.15s',
                      background: idx === 0 ? 'rgba(255, 215, 0, 0.04)' : idx === 1 ? 'rgba(192, 192, 192, 0.03)' : idx === 2 ? 'rgba(205, 127, 50, 0.03)' : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                      <span style={{
                        fontSize: '14px', fontWeight: 800,
                        color: idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : idx === 2 ? '#CD7F32' : '#444',
                        width: '28px', textAlign: 'center', flexShrink: 0,
                      }}>
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`}
                      </span>
                      <span style={{
                        fontSize: isMobile ? '13px' : '15px',
                        fontWeight: 600,
                        color: '#A6A4A7',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {entry.name}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '12px' : '24px', flexShrink: 0 }}>
                      <span style={{
                        fontSize: isMobile ? '13px' : '15px',
                        fontWeight: 700,
                        color: '#C0B4DA',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {entry.blinks}
                      </span>
                      <span style={{
                        fontSize: isMobile ? '13px' : '15px',
                        fontWeight: 800,
                        color: '#22c55e',
                        minWidth: '60px',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        ${entry.earnings}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ GAME AREA (always in DOM for video ref stability) ═══ */}
        <div style={showGameArea ? {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px',
          width: '100%',
          maxWidth: '800px',
        } : {
          position: 'fixed' as const,
          top: '-9999px',
          left: '-9999px',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
          pointerEvents: 'none' as const,
        }}>
          {/* Back button (ready phase only) */}
          {gamePhase === 'ready' && (
            <button
              onClick={handleBack}
              style={{
                alignSelf: 'flex-start',
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '8px',
                color: '#666',
                fontSize: '13px',
                fontWeight: 600,
                fontFamily: "'Manrope', sans-serif",
                cursor: 'pointer',
              }}
            >
              ← Back
            </button>
          )}

          {/* Bet info display */}
          {showGameArea && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              fontSize: '14px', color: '#666', fontWeight: 600,
            }}>
              <span>Betting</span>
              <span style={{ color: '#C0B4DA', fontWeight: 900, fontSize: '20px' }}>${selectedBet}</span>
              <span>USDC</span>
            </div>
          )}

          {/* Game layout: countdown (left) + webcam (center) */}
          <div style={{
            display: 'flex',
            alignItems: isMobile ? 'center' : 'flex-start',
            flexDirection: isMobile ? 'column' : 'row',
            gap: isMobile ? '16px' : '32px',
            width: '100%',
            justifyContent: 'center',
          }}>

            {/* Countdown timer (left side, playing only) */}
            {gamePhase === 'playing' && (
              <div style={{
                display: 'flex',
                flexDirection: isMobile ? 'row' : 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: isMobile ? '20px' : '8px',
                minWidth: isMobile ? 'auto' : '140px',
                order: isMobile ? -1 : 0,
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    fontSize: isMobile ? '56px' : '80px',
                    fontWeight: 900,
                    color: timeLeft <= 5 ? '#ef4444' : timeLeft <= 10 ? '#f59e0b' : '#C0B4DA',
                    lineHeight: 1,
                    transition: 'color 0.3s',
                    textShadow: timeLeft <= 5
                      ? '0 0 30px rgba(239, 68, 68, 0.5)'
                      : '0 0 20px rgba(192, 180, 218, 0.2)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {timeLeft}
                  </div>
                  <span style={{
                    fontSize: '11px', fontWeight: 700, color: '#555',
                    textTransform: 'uppercase', letterSpacing: '2px',
                  }}>
                    seconds
                  </span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    fontSize: isMobile ? '40px' : '48px',
                    fontWeight: 900,
                    color: '#22c55e',
                    lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {blinkCount}
                  </div>
                  <span style={{
                    fontSize: '11px', fontWeight: 700, color: '#555',
                    textTransform: 'uppercase', letterSpacing: '1px',
                  }}>
                    blinks
                  </span>
                </div>
              </div>
            )}

            {/* Webcam container */}
            <div style={{
              position: 'relative',
              width: isMobile ? '100%' : '480px',
              maxWidth: '480px',
              aspectRatio: '4 / 3',
              borderRadius: '16px',
              overflow: 'hidden',
              background: '#111',
              border: '2px solid rgba(255,255,255,0.08)',
              flexShrink: 0,
            }}>
              <video
                ref={(el) => { videoRef.current = el; }}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scaleX(-1)',
                  display: 'block',
                }}
              />
              <canvas
                ref={(el) => { canvasRef.current = el; }}
                width={480}
                height={360}
                style={{
                  position: 'absolute',
                  top: 0, left: 0,
                  width: '100%', height: '100%',
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              />

              {/* Loading camera overlay */}
              {gamePhase === 'ready' && !cameraReady && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(0,0,0,0.7)',
                  zIndex: 5,
                  gap: '12px',
                }}>
                  <div className="spinner" />
                  <span style={{ color: '#A6A4A7', fontSize: '14px', fontWeight: 600 }}>
                    Starting camera...
                  </span>
                </div>
              )}

              {/* START button overlay */}
              {gamePhase === 'ready' && cameraReady && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(0,0,0,0.3)',
                  zIndex: 5,
                }}>
                  <button
                    onClick={handleStart}
                    style={{
                      padding: '20px 64px',
                      background: '#C0B4DA',
                      border: 'none',
                      borderRadius: '16px',
                      color: '#fff',
                      fontSize: '32px',
                      fontWeight: 900,
                      fontFamily: "'Manrope', sans-serif",
                      cursor: 'pointer',
                      letterSpacing: '4px',
                      boxShadow: '0 8px 32px rgba(192, 180, 218, 0.5)',
                      transition: 'transform 0.15s, box-shadow 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.08)';
                      e.currentTarget.style.boxShadow = '0 12px 40px rgba(192, 180, 218, 0.6)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                      e.currentTarget.style.boxShadow = '0 8px 32px rgba(192, 180, 218, 0.5)';
                    }}
                  >
                    START
                  </button>
                </div>
              )}

              {/* 3-2-1 Countdown overlay */}
              {gamePhase === 'countdown' && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(0,0,0,0.5)',
                  zIndex: 5,
                }}>
                  <span style={{
                    fontSize: '120px',
                    fontWeight: 900,
                    color: '#C0B4DA',
                    textShadow: '0 0 40px rgba(192, 180, 218, 0.6)',
                    animation: 'pulse 1s ease-in-out infinite',
                  }}>
                    {countdownNumber}
                  </span>
                </div>
              )}

              {/* Score overlay on mobile during play */}
              {gamePhase === 'playing' && isMobile && (
                <div style={{
                  position: 'absolute',
                  top: '8px', right: '12px',
                  zIndex: 5,
                  fontSize: '36px',
                  fontWeight: 900,
                  color: '#C0B4DA',
                  textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                }}>
                  {blinkCount}
                </div>
              )}
            </div>
          </div>

          {/* Chart below webcam */}
          {(gamePhase === 'playing' || (showGameArea && chartData.length > 1)) && (
            <div style={{
              width: '100%',
              maxWidth: '620px',
              background: '#111',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.06)',
              padding: isMobile ? '12px 8px' : '16px 16px',
            }}>
              <p style={{
                fontSize: '11px', fontWeight: 700, color: '#555',
                margin: '0 0 8px 4px', textTransform: 'uppercase', letterSpacing: '1px',
              }}>
                Blink Performance
              </p>
              <BlinkChart data={chartData} height={isMobile ? 140 : 180} />
            </div>
          )}
        </div>

        {/* ═══ RESULT PHASE ═══ */}
        {gamePhase === 'result' && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '24px',
            width: '100%',
            maxWidth: '500px',
            textAlign: 'center',
          }}>
            <h2 style={{
              fontSize: isMobile ? '24px' : '32px',
              fontWeight: 900,
              color: '#A6A4A7',
              margin: 0,
            }}>
              Time&apos;s Up!
            </h2>

            {/* User score */}
            <div style={{
              padding: '24px 40px',
              background: '#141414',
              borderRadius: '16px',
              border: '2px solid rgba(192, 180, 218, 0.2)',
              width: '100%',
            }}>
              <p style={{ fontSize: '12px', color: '#666', fontWeight: 700, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                Your Blinks
              </p>
              <p style={{
                fontSize: isMobile ? '48px' : '64px',
                fontWeight: 900,
                color: '#C0B4DA',
                margin: 0,
                lineHeight: 1,
              }}>
                {finalScore}
              </p>
            </div>

            {/* Opponent loading */}
            {!opponentRevealed && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: '12px', padding: '24px',
              }}>
                <div className="spinner" />
                <p style={{ fontSize: '14px', color: '#666', fontWeight: 600 }}>
                  Waiting for opponent...
                </p>
              </div>
            )}

            {/* Opponent score + result */}
            {opponentRevealed && opponentScore !== null && (
              <>
                <div style={{
                  padding: '24px 40px',
                  background: '#141414',
                  borderRadius: '16px',
                  border: '2px solid rgba(255,255,255,0.06)',
                  width: '100%',
                }}>
                  <p style={{ fontSize: '12px', color: '#666', fontWeight: 700, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '1.5px' }}>
                    Opponent&apos;s Blinks
                  </p>
                  <p style={{
                    fontSize: isMobile ? '48px' : '64px',
                    fontWeight: 900,
                    color: '#A6A4A7',
                    margin: 0,
                    lineHeight: 1,
                  }}>
                    {opponentScore}
                  </p>
                </div>

                {/* Win/Lose/Draw banner */}
                <div style={{
                  padding: '20px 32px',
                  borderRadius: '16px',
                  background: isWinner
                    ? 'rgba(34, 197, 94, 0.1)'
                    : isDraw
                      ? 'rgba(245, 158, 11, 0.1)'
                      : 'rgba(239, 68, 68, 0.1)',
                  border: `2px solid ${isWinner
                    ? 'rgba(34, 197, 94, 0.3)'
                    : isDraw
                      ? 'rgba(245, 158, 11, 0.3)'
                      : 'rgba(239, 68, 68, 0.3)'}`,
                  width: '100%',
                }}>
                  <p style={{
                    fontSize: isMobile ? '24px' : '32px',
                    fontWeight: 900,
                    color: isWinner ? '#22c55e' : isDraw ? '#f59e0b' : '#ef4444',
                    margin: 0,
                  }}>
                    {isWinner ? 'YOU WIN!' : isDraw ? 'DRAW!' : 'YOU LOSE'}
                  </p>
                  {isWinner && (
                    <p style={{ fontSize: '16px', color: '#22c55e', fontWeight: 700, margin: '8px 0 0' }}>
                      +${(selectedBet * 2 * 0.95).toFixed(2)} USDC
                    </p>
                  )}
                  {isDraw && (
                    <p style={{ fontSize: '16px', color: '#f59e0b', fontWeight: 700, margin: '8px 0 0' }}>
                      Bet returned
                    </p>
                  )}
                  {isLoser && (
                    <p style={{ fontSize: '16px', color: '#ef4444', fontWeight: 700, margin: '8px 0 0' }}>
                      -${selectedBet} USDC
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Performance chart */}
            {chartData.length > 1 && (
              <div style={{
                width: '100%',
                background: '#141414',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.06)',
                padding: '16px',
              }}>
                <p style={{
                  fontSize: '11px', color: '#555', fontWeight: 700,
                  margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '1px',
                }}>
                  Your Performance
                </p>
                <BlinkChart data={chartData} height={isMobile ? 130 : 160} />
              </div>
            )}

            {/* Play again */}
            <button
              onClick={handlePlayAgain}
              style={{
                padding: '16px 48px',
                background: '#C0B4DA',
                border: 'none',
                borderRadius: '12px',
                color: '#fff',
                fontSize: '18px',
                fontWeight: 800,
                fontFamily: "'Manrope', sans-serif",
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: '0 4px 20px rgba(192, 180, 218, 0.4)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              Play Again
            </button>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 24px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px',
            color: '#ef4444',
            fontSize: '14px',
            fontWeight: 600,
            fontFamily: "'Manrope', sans-serif",
            zIndex: 100,
            maxWidth: '90vw',
          }}>
            {error}
            <button
              onClick={() => setError(null)}
              style={{
                marginLeft: '12px',
                background: 'none',
                border: 'none',
                color: '#ef4444',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: 800,
              }}
            >
              ×
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
