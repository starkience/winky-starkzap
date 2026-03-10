'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { StarkSDK, OnboardStrategy } from 'starkzap';
import type { WalletInterface } from 'starkzap';
import { useBlinkDetection } from '@/hooks/use-blink-detection';
import { useWinkyContract } from '@/hooks/use-winky-contract';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { GAME_CONFIG, NETWORK, API_URL, STORAGE_KEYS, VOYAGER_TX_URL } from '@/lib/constants';

const GAME_DURATION = 30;

function formatAddress(addr: string | null | undefined): string {
  if (!addr) return '';
  if (!addr.startsWith('0x')) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function normalizeAddress(addr: string): string {
  return addr.replace(/^0x0*/i, '0x').toLowerCase();
}

type GamePhase = 'idle' | 'ready' | 'countdown' | 'playing' | 'result';

interface StoredTwitterProfile {
  username: string;
  name: string;
  profileImageUrl: string;
}

export function RankedGame() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();

  const [sdkWallet, setSdkWallet] = useState<WalletInterface | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const setupAttemptedRef = useRef(false);

  const [gamePhase, setGamePhase] = useState<GamePhase>('idle');
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [countdownNumber, setCountdownNumber] = useState(3);
  const [finalScore, setFinalScore] = useState(0);
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blinkCountRef = useRef(0);

  const twitterProfile = user?.twitter ?? null;
  const twitterUsername = twitterProfile?.username ?? null;

  const isConnected = ready && authenticated && !!sdkWallet && !loggingOut;
  const isPlaying = gamePhase === 'playing';
  const showGameArea = gamePhase === 'ready' || gamePhase === 'countdown' || gamePhase === 'playing';
  const loginBusy = !ready || walletLoading;

  const {
    recordBlink,
    txLog: blinkTxLog,
    clearLog: clearBlinkLog,
    pendingCount: blinkPendingCount,
  } = useWinkyContract({
    wallet: sdkWallet,
    walletAddress,
    isAuthenticated: ready && authenticated,
  });

  const { leaderboard, isLoading: leaderboardLoading, refetch: refetchLeaderboard } = useLeaderboard(walletAddress || undefined);

  const [allTwitterProfiles, setAllTwitterProfiles] = useState<Record<string, StoredTwitterProfile>>({});

  useEffect(() => {
    if (leaderboardLoading || leaderboard.length === 0) return;
    const addresses = leaderboard.map((e) => normalizeAddress(e.address)).join(',');
    fetch(`/api/twitter-profiles?addresses=${encodeURIComponent(addresses)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.profiles) setAllTwitterProfiles(data.profiles);
      })
      .catch(() => {});
  }, [leaderboardLoading, leaderboard]);

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768 || ('ontouchstart' in window && window.innerWidth <= 1024));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Wallet setup via Starkzap SDK
  useEffect(() => {
    if (!ready || !authenticated || !user?.id) return;
    if (loggingOut) setLoggingOut(false);
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

        const baseUrl = API_URL || window.location.origin;

        if (!wId || !wPk) {
          const token = await getAccessToken();
          const resp = await fetch(`${baseUrl}/api/wallet/starknet`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ privyUserId: user.id }),
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
          paymaster: { nodeUrl: `${baseUrl}/api/paymaster` },
        });

        const { wallet } = await sdk.onboard({
          strategy: OnboardStrategy.Privy,
          deploy: 'if_needed',
          feeMode: 'sponsored',
          privy: {
            resolve: async () => ({
              walletId: wId!,
              publicKey: wPk!,
              serverUrl: `${baseUrl}/api/wallet/sign`,
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

  const handleLogin = useCallback(() => {
    login({ loginMethods: ['twitter'] });
  }, [login]);

  const handleLogout = useCallback(() => {
    setLoggingOut(true);
    setSdkWallet(null);
    setWalletAddress(null);
    setGamePhase('idle');
    setupAttemptedRef.current = false;
    try {
      Object.values(STORAGE_KEYS).forEach(k => {
        try { window.localStorage.removeItem(k); } catch {}
      });
    } catch {}
    logout().catch(() => {});
  }, [logout]);

  // Blink detection
  const gamePhaseRef = useRef<GamePhase>('idle');
  useEffect(() => { gamePhaseRef.current = gamePhase; }, [gamePhase]);

  const handleBlink = useCallback((count: number) => {
    if (gamePhaseRef.current === 'playing') {
      recordBlink(count, twitterUsername || undefined);
    }
  }, [recordBlink, twitterUsername]);

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

  // Game timer
  useEffect(() => {
    if (gamePhase !== 'playing') return;
    setTimeLeft(GAME_DURATION);

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          const score = blinkCountRef.current;
          setFinalScore(score);
          setGamePhase('result');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gamePhase]);

  // Handlers
  const handlePlay = useCallback(() => {
    if (!isConnected) return;
    resetDetection();
    blinkCountRef.current = 0;
    setFinalScore(0);
    setError(null);
    clearBlinkLog();
    setGamePhase('ready');
  }, [isConnected, resetDetection, clearBlinkLog]);

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
    setFinalScore(0);
    setTimeLeft(GAME_DURATION);
    clearBlinkLog();
    setGamePhase('idle');
    refetchLeaderboard();
  }, [resetDetection, clearBlinkLog, refetchLeaderboard]);

  const handleCopyAddress = useCallback(() => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [walletAddress]);

  // Leaderboard display helpers
  const userRankEntry = walletAddress
    ? leaderboard.find(e => normalizeAddress(e.address) === normalizeAddress(walletAddress))
    : null;

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

      {/* LEFT: Webcam + Controls */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        position: 'relative',
      }}>

        {/* Header bar */}
        <div style={{
          padding: isMobile ? '12px 16px' : '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img src="/logo.png" alt="Winky" style={{ height: '32px', width: 'auto', objectFit: 'contain' }} />
            {NETWORK === 'sepolia' && (
              <span style={{ fontSize: '9px', color: '#f59e0b', padding: '3px 8px', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', fontWeight: 700, background: 'rgba(245,158,11,0.08)', letterSpacing: '0.5px' }}>
                Testnet
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isConnected && walletAddress ? (
              <>
                <button onClick={handleCopyAddress} className="sidebar-wallet-btn" style={{ padding: '8px 12px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', flexShrink: 0, boxShadow: '0 0 6px rgba(34,197,94,0.5)' }} />
                  <span style={{ fontFamily: "'SF Mono', Monaco, monospace", fontSize: '12px' }}>
                    {copied ? 'Copied!' : formatAddress(walletAddress)}
                  </span>
                </button>
                <button onClick={handleLogout} className="sidebar-disconnect-btn" style={{ padding: '8px 10px' }}>&times;</button>
              </>
            ) : (
              <button
                onClick={handleLogin}
                disabled={loginBusy}
                className={`sidebar-connect-btn${walletLoading ? ' sidebar-connect-btn--loading' : ''}`}
                style={{ padding: '10px 20px', fontSize: '13px' }}
              >
                {walletLoading ? <span>Setting Up<span className="dots-anim" /></span> : !ready ? <span>Loading<span className="dots-anim" /></span> : 'Connect Wallet'}
              </button>
            )}
          </div>
        </div>

        {/* Webcam area */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: isMobile ? '16px' : '24px',
          minHeight: 0,
          position: 'relative',
        }}>
          {/* IDLE state */}
          {gamePhase === 'idle' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', textAlign: 'center' }}>
              <h1 style={{ fontSize: isMobile ? '28px' : '42px', fontWeight: 900, color: '#A6A4A7', margin: 0, lineHeight: 1.2 }}>
                Blink. Earn.<br />Climb the ranks.
              </h1>
              <p style={{ fontSize: '14px', color: '#555', fontWeight: 500, maxWidth: '400px', lineHeight: 1.6, margin: 0 }}>
                Every blink is a real transaction on Starknet. Zero gas. Zero cost. Just blink and climb the global leaderboard.
              </p>
              <button
                onClick={isConnected ? handlePlay : handleLogin}
                disabled={loginBusy}
                className={`sidebar-play-btn${isConnected ? ' sidebar-play-btn--active' : ''}`}
                style={{ padding: '16px 48px', fontSize: '18px' }}
              >
                {isConnected ? 'Start Blinking' : 'Connect to Play'}
              </button>
              {userRankEntry && (
                <div style={{ display: 'flex', gap: '24px', marginTop: '8px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '10px', color: '#555', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', margin: '0 0 4px' }}>Your Rank</p>
                    <p style={{ fontSize: '32px', fontWeight: 900, color: '#C0B4DA', margin: 0 }}>#{userRankEntry.rank}</p>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '10px', color: '#555', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', margin: '0 0 4px' }}>Total Blinks</p>
                    <p style={{ fontSize: '32px', fontWeight: 900, color: '#A6A4A7', margin: 0 }}>{userRankEntry.blinks.toLocaleString()}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* GAME: webcam + overlay */}
          {showGameArea && (
            <div style={{
              width: '100%',
              maxWidth: '640px',
              aspectRatio: '4 / 3',
              position: 'relative',
              borderRadius: '16px',
              overflow: 'hidden',
              border: '2px solid rgba(255,255,255,0.08)',
              background: '#111',
            }}>
              <video
                ref={(el) => { videoRef.current = el; }}
                autoPlay playsInline muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' }}
              />
              <canvas
                ref={(el) => { canvasRef.current = el; }}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }}
              />

              {/* Camera loading */}
              {gamePhase === 'ready' && !cameraReady && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 5 }}>
                  <div className="spinner" style={{ width: '32px', height: '32px' }} />
                </div>
              )}

              {/* Countdown overlay */}
              {gamePhase === 'countdown' && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', zIndex: 5 }}>
                  <span style={{ fontSize: '96px', fontWeight: 900, color: '#C0B4DA', textShadow: '0 0 40px rgba(192,180,218,0.5)', animation: 'pulse 1s ease-in-out infinite' }}>
                    {countdownNumber}
                  </span>
                </div>
              )}

              {/* Playing HUD */}
              {gamePhase === 'playing' && (
                <div style={{
                  position: 'absolute', top: '16px', left: '16px', right: '16px',
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                  zIndex: 5, pointerEvents: 'none',
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{
                      fontSize: '48px', fontWeight: 900, lineHeight: 1,
                      fontVariantNumeric: 'tabular-nums', color: '#C0B4DA',
                      textShadow: '0 2px 12px rgba(0,0,0,0.6)',
                    }}>
                      {blinkCount}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '1.5px', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>blinks</span>
                  </div>
                  <div style={{
                    padding: '8px 16px',
                    background: 'rgba(0,0,0,0.5)',
                    borderRadius: '10px',
                    backdropFilter: 'blur(8px)',
                  }}>
                    <span style={{
                      fontSize: '28px', fontWeight: 900, fontVariantNumeric: 'tabular-nums',
                      color: timeLeft <= 5 ? '#ef4444' : timeLeft <= 10 ? '#f59e0b' : '#fff',
                      transition: 'color 0.3s',
                    }}>
                      0:{timeLeft.toString().padStart(2, '0')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Ready controls (under webcam) */}
          {gamePhase === 'ready' && cameraReady && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginTop: '20px' }}>
              <button onClick={handleStart} className="game-start-btn">START</button>
              <span style={{ fontSize: '13px', color: '#555', fontWeight: 600 }}>Press to begin your 30s session</span>
              <button onClick={handlePlayAgain} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: '12px', fontWeight: 700, cursor: 'pointer', padding: '4px 12px' }}>
                Cancel
              </button>
            </div>
          )}

          {/* Result */}
          {gamePhase === 'result' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', textAlign: 'center' }}>
              <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#C0B4DA', margin: 0 }}>
                Session Complete!
              </h2>
              <div style={{
                padding: '32px 48px', background: '#141414', borderRadius: '16px',
                border: '2px solid rgba(192,180,218,0.2)',
              }}>
                <p style={{ fontSize: '10px', color: '#666', fontWeight: 800, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '2px' }}>Blinks Recorded</p>
                <p style={{ fontSize: '64px', fontWeight: 900, color: '#C0B4DA', margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{finalScore}</p>
                <p style={{ fontSize: '12px', color: '#555', fontWeight: 600, margin: '12px 0 0' }}>
                  Each blink was a real Starknet transaction
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                    `I just blinked ${finalScore} times in 30 seconds on @WinkyStarkzap\n\nEvery blink = a real transaction on Starknet. Zero gas.\n\nTry it: https://winky-starkzap.vercel.app`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="share-popup-btn"
                >
                  Share on <svg viewBox="0 0 24 24" className="share-popup-x-icon" aria-label="X"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                </a>
                <button onClick={handlePlayAgain} className="result-play-again-btn" style={{ margin: 0 }}>
                  Play Again
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* RIGHT: Transaction Log + Leaderboard */}
      <aside style={{
        width: isMobile ? '100%' : '360px',
        minWidth: isMobile ? undefined : '360px',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: isMobile ? 'none' : '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(17,17,17,0.6)',
        backdropFilter: 'blur(20px)',
        height: isMobile ? 'auto' : '100%',
        overflow: 'hidden',
        flexShrink: 0,
      }}>

        {/* Transaction Log */}
        <div style={{
          flex: showGameArea || gamePhase === 'result' ? 1 : 'none',
          minHeight: showGameArea || gamePhase === 'result' ? '200px' : '0px',
          display: 'flex',
          flexDirection: 'column',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          overflow: 'hidden',
          transition: 'min-height 0.3s',
        }}>
          <div style={{
            padding: '14px 20px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#A6A4A7', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Transactions
            </span>
            {isPlaying && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', fontWeight: 700, color: '#22c55e' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s ease-in-out infinite' }} />
                LIVE
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            {blinkTxLog.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: '#333', fontSize: '12px', fontWeight: 600 }}>
                {isPlaying
                  ? (blinkPendingCount > 0 ? 'Sending\u2026' : 'Blink to record transactions')
                  : 'Transactions will appear here during gameplay'}
              </div>
            )}
            {[...blinkTxLog].reverse().map((tx, idx, arr) => {
              const opacity = 0.25 + 0.75 * (idx / Math.max(arr.length - 1, 1));
              const statusColor = tx.status === 'success' ? '#22c55e' : tx.status === 'pending' ? '#f59e0b' : tx.status === 'skipped' ? '#555' : '#ef4444';
              return (
                <div key={tx.id} style={{
                  padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.03)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                  opacity,
                }}>
                  <div style={{ minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: statusColor, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      Blink #{tx.blinkNumber}
                    </span>
                    <span style={{ fontSize: '10px', color: '#555', fontWeight: 600 }}>
                      {tx.status === 'pending' ? 'sending\u2026' : tx.status}
                    </span>
                  </div>
                  {VOYAGER_TX_URL && tx.hash && (
                    <a
                      href={`${VOYAGER_TX_URL}/${tx.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tx-voyager-link"
                      aria-label="View on Voyager"
                    >
                      &#x2197;
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Leaderboard */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}>
          <div style={{
            padding: '14px 20px 10px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#A6A4A7', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Leaderboard
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '9px', fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '1px' }}>
                {leaderboard.length} blinkers
              </span>
              <button
                onClick={() => refetchLeaderboard()}
                disabled={leaderboardLoading}
                style={{
                  background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                  color: '#A6A4A7', fontSize: '14px', cursor: 'pointer', padding: '2px 6px',
                  transition: 'background 0.15s', opacity: leaderboardLoading ? 0.4 : 1,
                }}
                aria-label="Refresh leaderboard"
              >
                &#x21bb;
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {leaderboardLoading ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <div className="spinner" style={{ width: '24px', height: '24px' }} />
                <span style={{ fontSize: '12px', color: '#555', fontWeight: 600 }}>Loading leaderboard...</span>
              </div>
            ) : leaderboard.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#333', fontSize: '12px', fontWeight: 600 }}>
                No blinks recorded yet. Be the first!
              </div>
            ) : (
              leaderboard.slice(0, 50).map((entry, idx) => {
                const norm = normalizeAddress(entry.address);
                const isMe = walletAddress && norm === normalizeAddress(walletAddress);
                const profile = allTwitterProfiles[norm];
                const displayName = profile ? `@${profile.username}` : entry.username;
                const avatarUrl = profile?.profileImageUrl;

                return (
                  <div
                    key={entry.address}
                    className="sidebar-leaderboard-row"
                    style={{
                      padding: '10px 16px',
                      ...(isMe ? { background: 'rgba(192,180,218,0.06)' } : {}),
                      ...(idx < 3 ? {
                        background: idx === 0 ? 'rgba(255,215,0,0.06)' : idx === 1 ? 'rgba(192,192,192,0.06)' : 'rgba(205,127,50,0.06)',
                      } : {}),
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <span style={{
                        fontSize: '12px', fontWeight: 800,
                        color: idx === 0 ? '#ffd700' : idx === 1 ? '#c0c0c0' : idx === 2 ? '#cd7f32' : '#555',
                        width: '24px', textAlign: 'center', flexShrink: 0,
                      }}>
                        {entry.rank}
                      </span>
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, #333, #444)', flexShrink: 0 }} />
                      )}
                      {profile ? (
                        <a
                          href={`https://x.com/${profile.username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: '12px', fontWeight: isMe ? 700 : 600,
                            color: isMe ? '#C0B4DA' : '#A6A4A7',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            textDecoration: 'none', transition: 'color 0.15s',
                          }}
                        >
                          {displayName}
                        </a>
                      ) : (
                        <span style={{
                          fontSize: '12px', fontWeight: isMe ? 700 : 600,
                          color: isMe ? '#C0B4DA' : '#A6A4A7',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {displayName}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#A6A4A7', fontVariantNumeric: 'tabular-nums' }}>
                        {entry.blinks.toLocaleString()}
                      </span>
                      <span style={{ fontSize: '9px', fontWeight: 600, color: '#555' }}>blinks</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          style={{
            position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
            padding: '12px 20px', background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.25)', borderRadius: '12px',
            color: '#ef4444', fontSize: '13px', fontWeight: 600, zIndex: 100,
            fontFamily: "'Manrope', sans-serif", maxWidth: '90vw',
            display: 'flex', alignItems: 'center', gap: '12px',
            backdropFilter: 'blur(12px)',
          }}
        >
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss error" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px', fontWeight: 800, lineHeight: 1 }}>&times;</button>
        </div>
      )}
    </div>
  );
}
