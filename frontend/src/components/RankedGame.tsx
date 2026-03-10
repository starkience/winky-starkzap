'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { StarkSDK, OnboardStrategy } from 'starkzap';
import type { WalletInterface } from 'starkzap';
import { useBlinkDetection } from '@/hooks/use-blink-detection';
import { useWinkyContract } from '@/hooks/use-winky-contract';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { GAME_CONFIG, NETWORK, API_URL, STORAGE_KEYS, VOYAGER_TX_URL } from '@/lib/constants';

function formatAddress(addr: string | null | undefined): string {
  if (!addr) return '';
  if (!addr.startsWith('0x')) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function normalizeAddress(addr: string): string {
  return addr.replace(/^0x0*/i, '0x').toLowerCase();
}

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

  const [active, setActive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const blinkCountRef = useRef(0);

  const twitterProfile = user?.twitter ?? null;
  const twitterUsername = twitterProfile?.username ?? null;

  const isConnected = ready && authenticated && !!sdkWallet && !loggingOut;
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
  const syncedRef = useRef(false);

  // Sync current user's Privy Twitter profile to Edge Config so others can see it
  useEffect(() => {
    if (!walletAddress || !twitterProfile || syncedRef.current) return;
    syncedRef.current = true;

    const profilePicUrl = (twitterProfile as any).profilePictureUrl || '';
    const fullSizeUrl = profilePicUrl.replace('_normal', '').replace('_200x200', '').replace('_400x400', '');

    fetch('/api/twitter-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: walletAddress,
        username: twitterProfile.username,
        name: twitterProfile.name || twitterProfile.username,
        profileImageUrl: fullSizeUrl,
      }),
    }).catch(() => {});
  }, [walletAddress, twitterProfile]);

  // Fetch Twitter profiles for all leaderboard addresses
  useEffect(() => {
    if (leaderboardLoading || leaderboard.length === 0) return;
    const addresses = leaderboard.map((e) => normalizeAddress(e.address)).join(',');
    fetch(`/api/twitter-profiles?addresses=${encodeURIComponent(addresses)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.profiles) {
          setAllTwitterProfiles(data.profiles);

          // Safety net: if current user has Privy Twitter but isn't in Edge Config yet, sync now
          if (twitterProfile && walletAddress) {
            const norm = normalizeAddress(walletAddress);
            if (!data.profiles[norm]) {
              const profilePicUrl = (twitterProfile as any).profilePictureUrl || '';
              const fullSizeUrl = profilePicUrl.replace('_normal', '').replace('_200x200', '').replace('_400x400', '');
              fetch('/api/twitter-profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  address: walletAddress,
                  username: twitterProfile.username,
                  name: twitterProfile.name || twitterProfile.username,
                  profileImageUrl: fullSizeUrl,
                }),
              })
                .then(() => {
                  // Re-fetch profiles so the avatar appears immediately
                  return fetch(`/api/twitter-profiles?addresses=${encodeURIComponent(addresses)}`);
                })
                .then((r) => r.json())
                .then((d) => { if (d.profiles) setAllTwitterProfiles(d.profiles); })
                .catch(() => {});
            }
          }
        }
      })
      .catch(() => {});
  }, [leaderboardLoading, leaderboard, twitterProfile, walletAddress]);

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
    setActive(false);
    setupAttemptedRef.current = false;
    try {
      Object.values(STORAGE_KEYS).forEach(k => {
        try { window.localStorage.removeItem(k); } catch {}
      });
    } catch {}
    logout().catch(() => {});
  }, [logout]);

  // Blink detection — always active when `active` is true (no game phase gating)
  const activeRef = useRef(false);
  useEffect(() => { activeRef.current = active; }, [active]);

  const handleBlink = useCallback((count: number) => {
    if (activeRef.current) {
      recordBlink(count, twitterUsername || undefined);
    }
  }, [recordBlink, twitterUsername]);

  const {
    videoRef,
    canvasRef,
    isReady: isDetectorReady,
    blinkCount,
    start: startDetection,
    stop: stopDetection,
    reset: resetDetection,
  } = useBlinkDetection(handleBlink, {
    earThreshold: GAME_CONFIG.EAR_THRESHOLD,
    debounceMs: GAME_CONFIG.BLINK_DEBOUNCE_MS,
    enabled: active,
  });

  useEffect(() => { blinkCountRef.current = blinkCount; }, [blinkCount]);

  // Auto-start camera + detection once active + detector ready
  useEffect(() => {
    if (active && isDetectorReady && !cameraReady) {
      startDetection()
        .then(() => setCameraReady(true))
        .catch((err) => {
          console.error('Failed to start camera:', err);
          setError('Camera access required to play');
          setActive(false);
        });
    }
  }, [active, isDetectorReady, cameraReady, startDetection]);

  const handleStart = useCallback(() => {
    if (!isConnected) return;
    resetDetection();
    blinkCountRef.current = 0;
    setError(null);
    clearBlinkLog();
    setCameraReady(false);
    setActive(true);
  }, [isConnected, resetDetection, clearBlinkLog]);

  const handleStop = useCallback(() => {
    stopDetection();
    setActive(false);
    setCameraReady(false);
    refetchLeaderboard();
  }, [stopDetection, refetchLeaderboard]);

  const handleCopyAddress = useCallback(() => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [walletAddress]);

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
          {/* IDLE */}
          {!active && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', textAlign: 'center' }}>
              <h1 style={{ fontSize: isMobile ? '28px' : '42px', fontWeight: 900, color: '#A6A4A7', margin: 0, lineHeight: 1.2 }}>
                Blink. Earn.<br />Climb the ranks.
              </h1>
              <p style={{ fontSize: '14px', color: '#555', fontWeight: 500, maxWidth: '400px', lineHeight: 1.6, margin: 0 }}>
                Every blink is a real transaction on Starknet. Zero gas. Zero cost. No time limit &mdash; just blink and climb the global leaderboard.
              </p>
              {isConnected ? (
                <button
                  onClick={handleStart}
                  className="sidebar-play-btn sidebar-play-btn--active"
                  style={{ padding: '16px 48px', fontSize: '18px' }}
                >
                  Start Blinking
                </button>
              ) : (
                <p style={{ fontSize: '13px', color: '#666', fontWeight: 600, margin: 0 }}>
                  Connect your wallet to start blinking
                </p>
              )}
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

          {/* ACTIVE: webcam */}
          {active && (
            <>
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

                {!cameraReady && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 5 }}>
                    <div className="spinner" style={{ width: '32px', height: '32px' }} />
                  </div>
                )}

                {/* Blink count HUD — persistent total from on-chain */}
                {cameraReady && (
                  <div style={{
                    position: 'absolute', top: '16px', left: '16px',
                    display: 'flex', flexDirection: 'column', gap: '4px',
                    zIndex: 5, pointerEvents: 'none',
                  }}>
                    <span style={{
                      fontSize: '48px', fontWeight: 900, lineHeight: 1,
                      fontVariantNumeric: 'tabular-nums', color: '#C0B4DA',
                      textShadow: '0 2px 12px rgba(0,0,0,0.6)',
                    }}>
                      {((userRankEntry?.blinks ?? 0) + blinkCount).toLocaleString()}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '1.5px', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
                      total blinks
                    </span>
                  </div>
                )}
              </div>

              {/* Stop button */}
              <button
                onClick={handleStop}
                style={{
                  marginTop: '16px',
                  padding: '10px 32px',
                  background: 'rgba(239,68,68,0.1)',
                  border: '1.5px solid rgba(239,68,68,0.3)',
                  borderRadius: '10px',
                  color: '#ef4444',
                  fontSize: '13px',
                  fontWeight: 800,
                  fontFamily: "'Manrope', sans-serif",
                  cursor: 'pointer',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                Stop Session
              </button>
            </>
          )}
        </div>
      </main>

      {/* RIGHT SIDEBAR */}
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

        {/* Brand + Auth */}
        <div style={{
          padding: isMobile ? '14px 16px 12px' : '20px 20px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: isMobile ? '10px' : '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <img src="/logo.png" alt="Winky" style={{ objectFit: 'contain', width: '100%', maxWidth: isMobile ? '160px' : '280px', height: 'auto' }} />
            {NETWORK === 'sepolia' && (
              <span style={{ fontSize: '9px', color: '#f59e0b', padding: '3px 8px', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', fontWeight: 700, background: 'rgba(245,158,11,0.08)', letterSpacing: '0.5px' }}>
                Testnet
              </span>
            )}
          </div>

          {isConnected && walletAddress ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleCopyAddress}
                className="sidebar-wallet-btn"
                aria-label={copied ? 'Address copied' : 'Copy wallet address'}
              >
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', flexShrink: 0, boxShadow: '0 0 6px rgba(34,197,94,0.5)' }} aria-hidden="true" />
                <span style={{ fontFamily: "'SF Mono', Monaco, monospace", fontSize: '12px', letterSpacing: '0.3px' }}>
                  {copied ? 'Copied!' : formatAddress(walletAddress)}
                </span>
              </button>
              <button
                onClick={handleLogout}
                className="sidebar-disconnect-btn"
                aria-label="Disconnect wallet"
              >
                &times;
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              disabled={loginBusy}
              className={`sidebar-connect-btn${walletLoading ? ' sidebar-connect-btn--loading' : ''}`}
            >
              {walletLoading ? <span>Setting Up<span className="dots-anim" /></span> : !ready ? <span>Loading<span className="dots-anim" /></span> : 'Connect Wallet'}
            </button>
          )}
        </div>

        {/* Transaction Log */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}>
          <div style={{
            padding: '10px 20px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: '#A6A4A7', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Transactions
            </span>
            {active && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', fontWeight: 700, color: '#22c55e' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s ease-in-out infinite' }} />
                LIVE
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            {blinkTxLog.length === 0 && (
              <div style={{ padding: '20px 16px', textAlign: 'center', color: '#333', fontSize: '11px', fontWeight: 600 }}>
                {active
                  ? (blinkPendingCount > 0 ? 'Sending\u2026' : 'Blink to record transactions')
                  : 'Start blinking to see transactions'}
              </div>
            )}
            {[...blinkTxLog].reverse().map((tx, idx, arr) => {
              const opacity = 0.25 + 0.75 * (idx / Math.max(arr.length - 1, 1));
              const statusColor = tx.status === 'success' ? '#22c55e' : tx.status === 'pending' ? '#f59e0b' : tx.status === 'skipped' ? '#555' : '#ef4444';
              return (
                <div key={tx.id} style={{
                  padding: '7px 16px', borderBottom: '1px solid rgba(255,255,255,0.03)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                  opacity,
                }}>
                  <div style={{ minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: statusColor, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      Blink #{tx.blinkNumber}
                    </span>
                    <span style={{ fontSize: '9px', color: '#555', fontWeight: 600 }}>
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
