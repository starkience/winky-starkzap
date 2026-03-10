'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { StarkSDK, OnboardStrategy } from 'starkzap';
import type { WalletInterface } from 'starkzap';
import { useBlinkDetection } from '@/hooks/use-blink-detection';
import { useWinkyContract } from '@/hooks/use-winky-contract';
import { useLeaderboard } from '@/hooks/use-leaderboard';
import { useLiveFeed } from '@/hooks/use-live-feed';
import { GAME_CONFIG, NETWORK, API_URL, STORAGE_KEYS, VOYAGER_TX_URL } from '@/lib/constants';

function formatAddress(addr: string | null | undefined): string {
  if (!addr) return '';
  if (!addr.startsWith('0x')) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function normalizeAddress(addr: string): string {
  return addr.replace(/^0x0*/i, '0x').toLowerCase();
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
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

  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const blinkCountRef = useRef(0);
  const txScrollRef = useRef<HTMLDivElement>(null);

  const twitterProfile = user?.twitter ?? null;
  const twitterUsername = twitterProfile?.username ?? null;

  const isConnected = ready && authenticated && !!sdkWallet && !loggingOut;
  const loginBusy = !ready || walletLoading;

  const {
    recordBlink,
    txLog: blinkTxLog,
    pendingCount: blinkPendingCount,
  } = useWinkyContract({
    wallet: sdkWallet,
    walletAddress,
    isAuthenticated: ready && authenticated,
  });

  const { leaderboard, isLoading: leaderboardLoading } = useLeaderboard(walletAddress || undefined);
  const { events: liveEvents, topBlinker, addEvent: addLiveEvent } = useLiveFeed();

  const [allTwitterProfiles, setAllTwitterProfiles] = useState<Record<string, StoredTwitterProfile>>({});
  const syncedRef = useRef(false);

  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (txScrollRef.current) {
      txScrollRef.current.scrollTop = txScrollRef.current.scrollHeight;
    }
  }, [blinkTxLog.length]);

  const injectedTxRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const tx of blinkTxLog) {
      if (tx.status === 'success' && tx.hash && walletAddress && !injectedTxRef.current.has(tx.id)) {
        injectedTxRef.current.add(tx.id);
        addLiveEvent({
          id: tx.hash,
          address: walletAddress,
          txHash: tx.hash,
          timestamp: tx.timestamp,
          userTotal: tx.blinkNumber,
          twitterUsername: twitterUsername || undefined,
        });
      }
    }
  }, [blinkTxLog, walletAddress, twitterUsername, addLiveEvent]);

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

  useEffect(() => {
    if (leaderboardLoading || leaderboard.length === 0) return;
    const addresses = leaderboard.map((e) => normalizeAddress(e.address)).join(',');
    fetch(`/api/twitter-profiles?addresses=${encodeURIComponent(addresses)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.profiles) {
          setAllTwitterProfiles(data.profiles);
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
                .then(() => fetch(`/api/twitter-profiles?addresses=${encodeURIComponent(addresses)}`))
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
    setCameraStarted(false);
    setCameraReady(false);
    setupAttemptedRef.current = false;
    try {
      Object.values(STORAGE_KEYS).forEach(k => {
        try { window.localStorage.removeItem(k); } catch {}
      });
    } catch {}
    logout().catch(() => {});
  }, [logout]);

  const onChainTotalRef = useRef(0);

  const handleBlink = useCallback((count: number) => {
    const actualNumber = onChainTotalRef.current + count;
    recordBlink(actualNumber, twitterUsername || undefined);
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
    enabled: isConnected,
  });

  useEffect(() => { blinkCountRef.current = blinkCount; }, [blinkCount]);

  // Auto-start camera when connected + detector ready
  useEffect(() => {
    if (isConnected && isDetectorReady && !cameraStarted) {
      setCameraStarted(true);
      resetDetection();
      startDetection()
        .then(() => setCameraReady(true))
        .catch((err) => {
          console.error('Failed to start camera:', err);
          setError('Camera access required to play');
          setCameraStarted(false);
        });
    }
  }, [isConnected, isDetectorReady, cameraStarted, startDetection, resetDetection]);

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

  const onChainTotal = userRankEntry?.blinks ?? 0;
  onChainTotalRef.current = onChainTotal;
  const totalBlinks = onChainTotal + blinkCount;

  // Header height to offset webcam
  const headerH = isMobile ? 50 : 56;

  // Mobile layout: single scrollable column
  // Desktop layout: webcam left, sidebar right
  const mobileContent = isMobile ? (
    <div style={{
      display: 'flex', flexDirection: 'column', width: '100%', height: '100dvh',
      overflow: 'auto', background: '#0A0A0A', fontFamily: "'Manrope', sans-serif",
      WebkitOverflowScrolling: 'touch',
    } as React.CSSProperties}>
      {/* Spacer for fixed header */}
      <div style={{ height: `${headerH + 8}px`, flexShrink: 0 }} />

      {/* Logo + Auth */}
      <div style={{ padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <img src="/logo.png" alt="Winky" style={{ objectFit: 'contain', maxWidth: '140px', height: 'auto' }} />
          {NETWORK === 'sepolia' && (
            <span style={{ fontSize: '9px', color: '#f59e0b', padding: '3px 8px', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', fontWeight: 700, background: 'rgba(245,158,11,0.08)', letterSpacing: '0.5px' }}>Testnet</span>
          )}
        </div>
        {isConnected && walletAddress ? (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleCopyAddress} className="sidebar-wallet-btn" aria-label={copied ? 'Address copied' : 'Copy wallet address'}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', flexShrink: 0, boxShadow: '0 0 6px rgba(34,197,94,0.5)' }} aria-hidden="true" />
              <span style={{ fontFamily: "'SF Mono', Monaco, monospace", fontSize: '12px', letterSpacing: '0.3px' }}>
                {copied ? 'Copied!' : formatAddress(walletAddress)}
              </span>
            </button>
            <button onClick={handleLogout} className="sidebar-disconnect-btn" aria-label="Disconnect wallet">&times;</button>
          </div>
        ) : (
          <button onClick={handleLogin} disabled={loginBusy} className={`sidebar-connect-btn${walletLoading ? ' sidebar-connect-btn--loading' : ''}`}>
            {walletLoading ? <span>Setting Up<span className="dots-anim" /></span> : !ready ? <span>Loading<span className="dots-anim" /></span> : 'Connect Wallet'}
          </button>
        )}
      </div>

      {/* Webcam */}
      <div style={{ padding: '0 12px', flexShrink: 0 }}>
        <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '2px solid rgba(255,255,255,0.08)', background: '#111', height: '44dvh' }}>
          <video ref={(el) => { videoRef.current = el; }} autoPlay playsInline muted controls={false} disablePictureInPicture
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' }} />
          <canvas ref={(el) => { canvasRef.current = el; }}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }} />
          {!cameraReady && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', zIndex: 5, gap: '20px', padding: '20px' }}>
              {!isConnected ? (
                <>
                  <button onClick={handleLogin} disabled={loginBusy} className={`sidebar-connect-btn${walletLoading ? ' sidebar-connect-btn--loading' : ''}`}
                    style={{ padding: '16px 44px', fontSize: '16px', minHeight: '48px' }}>
                    {walletLoading ? <span>Setting Up<span className="dots-anim" /></span> : !ready ? <span>Loading<span className="dots-anim" /></span> : 'Connect Wallet'}
                  </button>
                  <span style={{ fontSize: '13px', color: '#555', fontWeight: 500, textAlign: 'center' }}>Connect to start blinking on Starknet</span>
                </>
              ) : (
                <div className="spinner" style={{ width: '32px', height: '32px' }} />
              )}
            </div>
          )}
          {cameraReady && (
            <div style={{ position: 'absolute', bottom: '8px', left: '8px', zIndex: 5, pointerEvents: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '2px', maxWidth: '85%', maxHeight: '50%', overflow: 'hidden' }}>
              {[...liveEvents.slice(0, 8)].reverse().map((ev, idx, arr) => {
                const fadeRatio = idx / Math.max(arr.length - 1, 1);
                const opacity = 0.15 + 0.85 * fadeRatio;
                const isNewest = idx === arr.length - 1;
                const displayName = ev.twitterUsername ? `@${ev.twitterUsername}` : formatAddress(ev.address);
                return (
                  <div key={ev.id} style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.7)', textShadow: '0 1px 4px rgba(0,0,0,0.8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity, animation: isNewest ? 'live-feed-slide-in 0.3s ease-out' : undefined, transition: 'opacity 0.3s ease' }}>
                    <span style={{ color: '#C0B4DA', fontWeight: 700 }}>{displayName}</span>
                    {' blinked '}
                    <span style={{ fontFamily: "'SF Mono', Monaco, monospace", fontSize: '10px' }}>{formatAddress(ev.txHash)}</span>
                    {' '}<span style={{ color: 'rgba(255,255,255,0.5)' }}>{formatTimeAgo(ev.timestamp)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Total blinks + Fastest blinker (text only, no GIF) */}
      {isConnected && (
        <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Blinks</span>
          <span style={{ fontSize: '28px', fontWeight: 900, color: '#C0B4DA', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{totalBlinks.toLocaleString()}</span>
        </div>
      )}
      {topBlinker && (
        <div style={{ padding: '4px 16px 8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span className="rainbow-text" style={{ fontSize: '14px', fontWeight: 900, letterSpacing: '-0.3px' }}>Fastest:{' '}</span>
          {topBlinker.displayName.startsWith('@') ? (
            <a href={`https://x.com/${topBlinker.displayName.slice(1)}`} target="_blank" rel="noopener noreferrer" className="rainbow-text"
              style={{ fontSize: '14px', fontWeight: 900, letterSpacing: '-0.3px', textDecoration: 'none', cursor: 'pointer', pointerEvents: 'auto' }}>{topBlinker.displayName}</a>
          ) : (
            <span className="rainbow-text" style={{ fontSize: '14px', fontWeight: 900, letterSpacing: '-0.3px' }}>{topBlinker.displayName}</span>
          )}
          <span className="rainbow-text" style={{ fontSize: '14px', fontWeight: 900, letterSpacing: '-0.3px' }}>{' '}at {topBlinker.rpm} bpm</span>
        </div>
      )}

      {/* Transaction Log */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: '200px', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '48px', background: 'linear-gradient(to bottom, rgba(10,10,10,1) 0%, rgba(10,10,10,0.8) 40%, transparent 100%)', zIndex: 3, pointerEvents: 'none' }} />
        <div ref={txScrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 12px 16px', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
          {[...blinkTxLog].reverse().map((tx, idx, arr) => {
            const fadeRatio = idx / Math.max(arr.length - 1, 1);
            const opacity = 0.2 + 0.8 * fadeRatio;
            const isConfirmed = tx.status === 'success';
            const blinkColor = isConfirmed ? '#22c55e' : '#fff';
            const isNewest = idx === arr.length - 1;
            return (
              <div key={tx.id} className="ranked-tx-row" style={{ padding: '8px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', opacity, cursor: tx.hash ? 'pointer' : 'default', animation: isNewest ? 'tx-slide-in 0.25s ease-out' : undefined }}
                onClick={() => { if (tx.hash) window.open(`${VOYAGER_TX_URL}/${tx.hash}`, '_blank'); }}>
                <div style={{ minWidth: 0, overflow: 'hidden' }}>
                  <span className={isConfirmed ? 'ranked-tx-blink-label' : undefined} style={{ fontSize: '14px', fontWeight: 800, color: blinkColor, display: 'block', marginBottom: '2px', transition: 'color 0.15s' }}>Blink #{tx.blinkNumber}</span>
                  {tx.hash ? (
                    <span className="ranked-tx-hash" style={{ fontSize: '11px', fontWeight: 600, color: isConfirmed ? 'rgba(34,197,94,0.5)' : '#666', textDecoration: 'none', fontFamily: "'SF Mono', Monaco, monospace", transition: 'color 0.15s, text-decoration-color 0.15s' }}>{formatAddress(tx.hash)}</span>
                  ) : (
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#555', fontStyle: 'italic' }}>{tx.status === 'pending' ? 'sending\u2026' : tx.status === 'error' ? 'failed' : tx.status}</span>
                  )}
                </div>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#444', whiteSpace: 'nowrap', flexShrink: 0, paddingTop: '2px' }}>{formatTimeAgo(tx.timestamp)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  if (isMobile) {
    return (
      <>
        {mobileContent}
        {error && (
          <div role="alert" style={{ position: 'fixed', bottom: 'max(20px, env(safe-area-inset-bottom, 20px))', left: '50%', transform: 'translateX(-50%)', padding: '14px 20px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '12px', color: '#ef4444', fontSize: '13px', fontWeight: 600, zIndex: 100, fontFamily: "'Manrope', sans-serif", maxWidth: 'calc(100vw - 32px)', display: 'flex', alignItems: 'center', gap: '12px', backdropFilter: 'blur(12px)' }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss error" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '18px', fontWeight: 800, lineHeight: 1, minWidth: '32px', minHeight: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>&times;</button>
          </div>
        )}
      </>
    );
  }

  return (
    <div style={{
      display: 'flex',
      width: '100%',
      height: '100dvh',
      overflow: 'hidden',
      background: '#0A0A0A',
      fontFamily: "'Manrope', sans-serif",
      flexDirection: 'row',
    }}>

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
          padding: `${headerH + 12}px 32px 36px`,
          minHeight: 0,
        }}>
          {/* Webcam — always shown */}
          <div style={{
            flex: 1,
            position: 'relative',
            borderRadius: '16px',
            overflow: 'hidden',
            border: '2px solid rgba(255,255,255,0.08)',
            background: '#111',
            minHeight: 0,
          }}>
            <video
              ref={(el) => { videoRef.current = el; }}
              autoPlay playsInline muted
              controls={false}
              disablePictureInPicture
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' }}
            />
            <canvas
              ref={(el) => { canvasRef.current = el; }}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }}
            />

            {!cameraReady && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', zIndex: 5, gap: '20px', padding: '20px' }}>
                {!isConnected ? (
                  <button
                    onClick={handleLogin}
                    disabled={loginBusy}
                    className={`sidebar-connect-btn${walletLoading ? ' sidebar-connect-btn--loading' : ''}`}
                    style={{ padding: '16px 44px', fontSize: '15px', minHeight: '48px' }}
                  >
                    {walletLoading ? <span>Setting Up<span className="dots-anim" /></span> : !ready ? <span>Loading<span className="dots-anim" /></span> : 'Connect Wallet'}
                  </button>
                ) : (
                  <div className="spinner" style={{ width: '32px', height: '32px' }} />
                )}
              </div>
            )}

            {/* Live feed overlay */}
            {cameraReady && (
              <div style={{
                position: 'absolute', bottom: '12px', left: '12px',
                zIndex: 5, pointerEvents: 'none',
                display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                gap: '2px', maxWidth: '70%',
                maxHeight: '40%', overflow: 'hidden',
              }}>
                {[...liveEvents.slice(0, 8)].reverse().map((ev, idx, arr) => {
                  const fadeRatio = idx / Math.max(arr.length - 1, 1);
                  const opacity = 0.15 + 0.85 * fadeRatio;
                  const isNewest = idx === arr.length - 1;
                  const displayName = ev.twitterUsername ? `@${ev.twitterUsername}` : formatAddress(ev.address);
                  return (
                    <div key={ev.id} style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.7)', textShadow: '0 1px 4px rgba(0,0,0,0.8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity, animation: isNewest ? 'live-feed-slide-in 0.3s ease-out' : undefined, transition: 'opacity 0.3s ease' }}>
                      <span style={{ color: '#C0B4DA', fontWeight: 700 }}>{displayName}</span>
                      {' blinked '}
                      <span style={{ fontFamily: "'SF Mono', Monaco, monospace", fontSize: '10px' }}>{formatAddress(ev.txHash)}</span>
                      {' '}<span style={{ color: 'rgba(255,255,255,0.5)' }}>{formatTimeAgo(ev.timestamp)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* RIGHT SIDEBAR (desktop only) */}
      <aside style={{
        width: '360px', minWidth: '360px', display: 'flex', flexDirection: 'column',
        borderLeft: '1px solid rgba(255,255,255,0.06)', background: 'rgba(17,17,17,0.6)',
        backdropFilter: 'blur(20px)', height: '100%', overflow: 'hidden', flexShrink: 0,
      }}>
        <div style={{ padding: '20px 20px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <img src="/logo.png" alt="Winky" style={{ objectFit: 'contain', width: '100%', maxWidth: '280px', height: 'auto' }} />
            {NETWORK === 'sepolia' && (
              <span style={{ fontSize: '9px', color: '#f59e0b', padding: '3px 8px', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', fontWeight: 700, background: 'rgba(245,158,11,0.08)', letterSpacing: '0.5px' }}>Testnet</span>
            )}
          </div>
          {isConnected && walletAddress ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleCopyAddress} className="sidebar-wallet-btn" aria-label={copied ? 'Address copied' : 'Copy wallet address'}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', flexShrink: 0, boxShadow: '0 0 6px rgba(34,197,94,0.5)' }} aria-hidden="true" />
                <span style={{ fontFamily: "'SF Mono', Monaco, monospace", fontSize: '12px', letterSpacing: '0.3px' }}>{copied ? 'Copied!' : formatAddress(walletAddress)}</span>
              </button>
              <button onClick={handleLogout} className="sidebar-disconnect-btn" aria-label="Disconnect wallet">&times;</button>
            </div>
          ) : (
            <button onClick={handleLogin} disabled={loginBusy} className={`sidebar-connect-btn${walletLoading ? ' sidebar-connect-btn--loading' : ''}`}>
              {walletLoading ? <span>Setting Up<span className="dots-anim" /></span> : !ready ? <span>Loading<span className="dots-anim" /></span> : 'Connect Wallet'}
            </button>
          )}
        </div>
        {isConnected && (
          <div style={{ padding: '8px 20px 12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Blinks</span>
            <span style={{ fontSize: '28px', fontWeight: 900, color: '#C0B4DA', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{totalBlinks.toLocaleString()}</span>
          </div>
        )}
        {topBlinker && (() => {
          const normAddr = normalizeAddress(topBlinker.address);
          const profileImg = topBlinker.profileImageUrl || allTwitterProfiles[normAddr]?.profileImageUrl || null;
          return (
            <>
              <div style={{ padding: '8px 20px 12px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span className="rainbow-text" style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '-0.3px' }}>Fastest:{' '}</span>
                {topBlinker.displayName.startsWith('@') ? (
                  <a href={`https://x.com/${topBlinker.displayName.slice(1)}`} target="_blank" rel="noopener noreferrer" className="rainbow-text"
                    style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '-0.3px', textDecoration: 'none', cursor: 'pointer', pointerEvents: 'auto' }}>{topBlinker.displayName}</a>
                ) : (
                  <span className="rainbow-text" style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '-0.3px' }}>{topBlinker.displayName}</span>
                )}
                <span className="rainbow-text" style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '-0.3px' }}>{' '}at {topBlinker.rpm} bpm</span>
              </div>
              <div style={{ width: '100%', position: 'relative', overflow: 'hidden' }}>
                <img src="/fastest-blinker-dance.gif" alt="Fastest blinker dance" style={{ width: '100%', display: 'block' }} />
                {profileImg && (
                  <div className="head-track-overlay" style={{ position: 'absolute', width: '18%', aspectRatio: '1', borderRadius: '50%', overflow: 'hidden', border: '2px solid rgba(255,255,255,0.85)', boxShadow: '0 0 16px rgba(192,180,218,0.5)' }}>
                    <img src={profileImg} alt={topBlinker.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
              </div>
            </>
          );
        })()}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '80px', background: 'linear-gradient(to bottom, rgba(17,17,17,1) 0%, rgba(17,17,17,0.8) 40%, transparent 100%)', zIndex: 3, pointerEvents: 'none' }} />
          <div ref={txScrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 20px 36px' }}>
            {[...blinkTxLog].reverse().map((tx, idx, arr) => {
              const fadeRatio = idx / Math.max(arr.length - 1, 1);
              const opacity = 0.2 + 0.8 * fadeRatio;
              const isConfirmed = tx.status === 'success';
              const blinkColor = isConfirmed ? '#22c55e' : '#fff';
              const isNewest = idx === arr.length - 1;
              return (
                <div key={tx.id} className="ranked-tx-row" style={{ padding: '8px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', opacity, cursor: tx.hash ? 'pointer' : 'default', animation: isNewest ? 'tx-slide-in 0.25s ease-out' : undefined }}
                  onClick={() => { if (tx.hash) window.open(`${VOYAGER_TX_URL}/${tx.hash}`, '_blank'); }}>
                  <div style={{ minWidth: 0, overflow: 'hidden' }}>
                    <span className={isConfirmed ? 'ranked-tx-blink-label' : undefined} style={{ fontSize: '14px', fontWeight: 800, color: blinkColor, display: 'block', marginBottom: '2px', transition: 'color 0.15s' }}>Blink #{tx.blinkNumber}</span>
                    {tx.hash ? (
                      <span className="ranked-tx-hash" style={{ fontSize: '11px', fontWeight: 600, color: isConfirmed ? 'rgba(34,197,94,0.5)' : '#666', textDecoration: 'none', fontFamily: "'SF Mono', Monaco, monospace", transition: 'color 0.15s, text-decoration-color 0.15s' }}>{formatAddress(tx.hash)}</span>
                    ) : (
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#555', fontStyle: 'italic' }}>{tx.status === 'pending' ? 'sending\u2026' : tx.status === 'error' ? 'failed' : tx.status}</span>
                    )}
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#444', whiteSpace: 'nowrap', flexShrink: 0, paddingTop: '2px' }}>{formatTimeAgo(tx.timestamp)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {error && (
        <div
          role="alert"
          style={{
            position: 'fixed', bottom: isMobile ? 'max(20px, env(safe-area-inset-bottom, 20px))' : '20px',
            left: '50%', transform: 'translateX(-50%)',
            padding: '14px 20px', background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.25)', borderRadius: '12px',
            color: '#ef4444', fontSize: '13px', fontWeight: 600, zIndex: 100,
            fontFamily: "'Manrope', sans-serif", maxWidth: isMobile ? 'calc(100vw - 32px)' : '90vw',
            display: 'flex', alignItems: 'center', gap: '12px',
            backdropFilter: 'blur(12px)',
          }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '18px', fontWeight: 800, lineHeight: 1, minWidth: '32px', minHeight: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>&times;</button>
        </div>
      )}
    </div>
  );
}
