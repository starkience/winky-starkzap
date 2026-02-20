'use client';

/**
 * WinkyGame - Single-page blink counter with Starknet integration.
 *
 * Layout:
 *   Header floats on top of the left zone
 *   Body  – 75 % camera (full area)  |  25 % transaction log
 *
 * Camera feed starts immediately; blurry when wallet is not ready.
 * Uses Privy for social login and backend API for wallet operations.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useBlinkDetection } from '@/hooks/use-blink-detection';
import { useWinkyContract, BlinkTransaction } from '@/hooks/use-winky-contract';
import { useTwitterAuth } from '@/hooks/use-twitter-auth';
import { GAME_CONFIG, VOYAGER_TX_URL, NETWORK, API_URL, STORAGE_KEYS } from '@/lib/constants';
import { generateBlinkCard } from '@/lib/generate-blink-card';
import { LeaderboardModal } from '@/components/Leaderboard';
import { useLiveFeed, LiveBlinkEvent, TopBlinker } from '@/hooks/use-live-feed';

function formatAddress(addr: string | null | undefined): string {
  if (!addr) return '';
  if (!addr.startsWith('0x')) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function WinkyGame() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [persistentBlinks, setPersistentBlinks] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showMilestone, setShowMilestone] = useState(false);
  const milestoneShownRef = useRef(
    typeof window !== 'undefined' && localStorage.getItem('winky_milestone_100') === '1'
  );

  // Wallet state managed via backend API + localStorage
  const [walletId, setWalletId] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [deployed, setDeployed] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);
  const setupAttemptedRef = useRef(false);

  const isConnected = authenticated && !!walletId && deployed;

  // Twitter auth - optional, enhances leaderboard
  const twitter = useTwitterAuth(walletAddress || undefined);

  useEffect(() => {
    setMounted(true);
    const checkMobile = () => {
      const mobile = window.innerWidth <= 768
        || ('ontouchstart' in window && window.innerWidth <= 1024);
      setIsMobile(mobile);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Auto-open leaderboard when returning from Twitter OAuth
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('twitter_connected')) {
      setShowLeaderboard(true);
      params.delete('twitter_connected');
      const cleanUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    }
  }, []);

  // Restore wallet state from localStorage when Privy auth is ready
  useEffect(() => {
    if (!ready || !authenticated || !user?.id) return;
    try {
      const storedUser = window.localStorage.getItem(STORAGE_KEYS.userId);
      if (storedUser && storedUser !== user.id) {
        window.localStorage.removeItem(STORAGE_KEYS.walletId);
        window.localStorage.removeItem(STORAGE_KEYS.walletAddress);
        window.localStorage.removeItem(STORAGE_KEYS.publicKey);
        window.localStorage.removeItem(STORAGE_KEYS.deployedWalletId);
        setWalletId(null);
        setWalletAddress(null);
        setPublicKey(null);
        setDeployed(false);
      }
      window.localStorage.setItem(STORAGE_KEYS.userId, user.id);
      const lsId = window.localStorage.getItem(STORAGE_KEYS.walletId);
      const lsAddr = window.localStorage.getItem(STORAGE_KEYS.walletAddress);
      const lsPk = window.localStorage.getItem(STORAGE_KEYS.publicKey);
      if (lsId) setWalletId(lsId);
      if (lsAddr) setWalletAddress(lsAddr);
      if (lsPk) setPublicKey(lsPk);
      const lsDeployed = window.localStorage.getItem(STORAGE_KEYS.deployedWalletId);
      if (lsId && lsDeployed === lsId) setDeployed(true);
    } catch {}
  }, [ready, authenticated, user?.id]);

  // Persist wallet state
  useEffect(() => { try { if (walletId) window.localStorage.setItem(STORAGE_KEYS.walletId, walletId); } catch {} }, [walletId]);
  useEffect(() => { try { if (walletAddress) window.localStorage.setItem(STORAGE_KEYS.walletAddress, walletAddress); } catch {} }, [walletAddress]);
  useEffect(() => { try { if (publicKey) window.localStorage.setItem(STORAGE_KEYS.publicKey, publicKey); } catch {} }, [publicKey]);

  // Fetch existing wallets from backend when authenticated
  useEffect(() => {
    if (!ready || !authenticated || !user?.id) return;
    if (walletId || walletAddress) return;

    const fetchWallets = async () => {
      try {
        const resp = await fetch(
          `${API_URL}/privy/user-wallets?userId=${encodeURIComponent(user.id)}&t=${Date.now()}`
        );
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) return;
        const list = Array.isArray(data.wallets) ? data.wallets : [];
        if (list.length > 0) {
          const w = list.find((v: any) => v?.publicKey) || list[0];
          if (w.id) setWalletId(w.id);
          if (w.address) setWalletAddress(w.address);
          if (w.publicKey) setPublicKey(w.publicKey);
        }
      } catch {}
    };
    fetchWallets();
  }, [ready, authenticated, user?.id, walletId, walletAddress]);

  // Auto-create + auto-deploy wallet after login (runs once per session)
  useEffect(() => {
    if (!ready || !authenticated || !user?.id) return;
    if (walletId && deployed) return;
    if (setupAttemptedRef.current || walletLoading) return;
    setupAttemptedRef.current = true;

    const setupWallet = async () => {
      setWalletLoading(true);
      try {
        const userJwt = await getAccessToken();
        if (!userJwt) { setWalletLoading(false); return; }

        let wId = walletId;
        let wAddr = walletAddress;

        // Create wallet if needed
        if (!wId) {
          const resp = await fetch(`${API_URL}/privy/create-wallet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chainType: 'starknet' }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data?.error || 'Create wallet failed');
          const w = data.wallet || {};
          wId = w.id || null;
          wAddr = w.address || null;
          const pk = w.public_key || w.publicKey || null;
          if (wId) setWalletId(wId);
          if (wAddr) setWalletAddress(wAddr);
          if (pk) setPublicKey(pk);
        }

        // Deploy wallet if not yet deployed
        if (wId && !deployed) {
          const lsDeployed = window.localStorage.getItem(STORAGE_KEYS.deployedWalletId);
          if (lsDeployed === wId) {
            setDeployed(true);
            setWalletLoading(false);
            return;
          }

          const resp = await fetch(`${API_URL}/privy/deploy-wallet`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${userJwt}`,
            },
            body: JSON.stringify({ walletId: wId }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data?.error || 'Deploy failed');
          if (data.address) setWalletAddress(data.address);
          if (data.publicKey) setPublicKey(data.publicKey);
          window.localStorage.setItem(STORAGE_KEYS.deployedWalletId, wId);
          setDeployed(true);
        }
      } catch (err: any) {
        console.error('[setupWallet] Error:', err.message);
        setError(err.message || 'Wallet setup failed');
      } finally {
        setWalletLoading(false);
      }
    };
    setupWallet();
  }, [ready, authenticated, user?.id, walletId, deployed, walletLoading, getAccessToken, walletAddress]);

  const handleLogin = useCallback(() => {
    login();
  }, [login]);

  const handleLogout = useCallback(async () => {
    try {
      Object.values(STORAGE_KEYS).forEach(k => {
        try { window.localStorage.removeItem(k); } catch {}
      });
    } catch {}
    setWalletId(null);
    setWalletAddress(null);
    setPublicKey(null);
    setDeployed(false);
    setShowWalletMenu(false);
    try { await logout(); } catch {}
  }, [logout]);

  const {
    recordBlink,
    getTotalBlinks,
    txLog,
    isReady: isContractReady,
  } = useWinkyContract({
    walletId,
    walletAddress,
    getAccessToken,
    isAuthenticated: authenticated,
  });

  const handleBlink = useCallback((count: number) => {
    if (isConnected && isContractReady) {
      recordBlink(persistentBlinks + count, twitter.profile?.username);
    }
  }, [isConnected, isContractReady, recordBlink, persistentBlinks, twitter.profile?.username]);

  const {
    videoRef,
    canvasRef,
    isReady: isDetectorReady,
    isRunning,
    blinkCount,
    currentEAR,
    fps,
    start: startDetection,
    reset: resetDetection,
  } = useBlinkDetection(handleBlink, {
    earThreshold: GAME_CONFIG.EAR_THRESHOLD,
    debounceMs: GAME_CONFIG.BLINK_DEBOUNCE_MS,
    enabled: isConnected,
  });

  useEffect(() => {
    if (isDetectorReady && isLoading) {
      startDetection()
        .then(() => setIsLoading(false))
        .catch((err) => {
          console.error('Failed to start camera:', err);
          setError('Enable camera access to be the ultimate Blink-o-nator Terminator');
          setIsLoading(false);
        });
    }
  }, [isDetectorReady, isLoading, startDetection]);

  // Fetch persistent on-chain blink total when wallet is ready
  useEffect(() => {
    if (isConnected && isContractReady) {
      getTotalBlinks().then((total) => {
        if (total > 0) setPersistentBlinks(total);
      }).catch(() => {});
    }
  }, [isConnected, isContractReady, getTotalBlinks]);

  // Live global blink feed
  const liveFeed = useLiveFeed();

  const totalBlinkCount = persistentBlinks + blinkCount;

  // Milestone popup at 100 blinks
  useEffect(() => {
    if (
      totalBlinkCount >= 100 &&
      persistentBlinks < 100 &&
      !milestoneShownRef.current
    ) {
      milestoneShownRef.current = true;
      localStorage.setItem('winky_milestone_100', '1');
      setShowMilestone(true);
    }
  }, [totalBlinkCount, persistentBlinks]);

  const loginBusy = !ready || walletLoading;
  const displayAddress = walletAddress || '';
  const displayName = user?.email?.address || formatAddress(walletAddress) || user?.id || '';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: isMobile ? '100dvh' : 'calc(100vh / 0.85)',
      overflow: 'hidden',
      position: isMobile ? 'fixed' : 'relative',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    }}>

      {/* ─── Header ─── */}
      <header
        ref={headerRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          flexShrink: 0,
          padding: isMobile ? '8px 12px' : '12px 32px',
          flexWrap: 'wrap',
          gap: isMobile ? '6px' : '8px',
        }}
      >
          {/* Left: Logo */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: isMobile ? '6px' : '10px', flexShrink: 0 }}>
            <img src="/logo.png" alt="Wink." style={{ height: isMobile ? '28px' : '40px', objectFit: 'contain' }} />
            {!isMobile && (
              <span style={{ fontSize: '16px', fontWeight: 600, color: '#C0B4DA', fontFamily: "'Manrope', sans-serif", alignSelf: 'flex-end' }}>
                Powered by the{' '}
                <a
                  href="https://github.com/keep-starknet-strange/awesome-starkzap"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#C0B4DA', textDecoration: 'none', transition: 'text-decoration 0.15s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                  onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                >
                  Starkzap SDK
                </a>
              </span>
            )}
            {NETWORK === 'mainnet' && (
              <span
                style={{
                  fontSize: isMobile ? '9px' : '10px',
                  color: '#16a34a',
                  padding: '2px 6px',
                  border: '1px solid #16a34a',
                  borderRadius: '4px',
                  fontWeight: 600,
                  background: 'rgba(22,163,74,0.1)',
                }}
              >
                Mainnet
              </span>
            )}
            {NETWORK === 'sepolia' && (
              <span
                style={{
                  fontSize: isMobile ? '9px' : '10px',
                  color: 'var(--warning)',
                  padding: '2px 6px',
                  border: '1px solid var(--warning)',
                  borderRadius: '4px',
                  fontWeight: 600,
                  background: 'rgba(245,166,35,0.1)',
                }}
              >
                Sepolia
              </span>
            )}
          </div>

          {/* Right: User menu */}
          <div style={{ position: 'relative' }}>
            {isConnected && displayAddress ? (
              <div style={{ display: 'flex', gap: isMobile ? '4px' : '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {/* GitHub icon */}
                {!isMobile && (
                <a
                  href="https://github.com/starkience/winky-starkzap"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '50%',
                    border: '3px solid #C0B4DA',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    textDecoration: 'none',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#C0B4DA';
                    (e.currentTarget.querySelector('svg') as SVGElement).style.fill = '#fff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    (e.currentTarget.querySelector('svg') as SVGElement).style.fill = '#C0B4DA';
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#C0B4DA" style={{ transition: 'fill 0.2s' }}>
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                  </svg>
                </a>
                )}
                {/* Info icon */}
                <div
                  style={{ position: 'relative' }}
                  onClick={() => isMobile && setShowInfo((prev) => !prev)}
                  onMouseEnter={() => !isMobile && setShowInfo(true)}
                  onMouseLeave={() => !isMobile && setShowInfo(false)}
                >
                  <div
                    style={{
                      width: isMobile ? '32px' : '38px',
                      height: isMobile ? '32px' : '38px',
                      borderRadius: '50%',
                      border: isMobile ? '2px solid #C0B4DA' : '3px solid #C0B4DA',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: isMobile ? '14px' : '18px',
                      fontWeight: 800,
                      fontFamily: "'Manrope', sans-serif",
                      color: '#C0B4DA',
                      transition: 'all 0.2s',
                      position: 'relative',
                      zIndex: showInfo && isMobile ? 3001 : 'auto',
                    }}
                  >
                    i
                  </div>
                  {showInfo && isMobile && (
                    <div
                      onClick={(e) => { e.stopPropagation(); setShowInfo(false); }}
                      style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 2999,
                        background: 'transparent',
                      }}
                    />
                  )}
                  {showInfo && !isMobile && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 8px)',
                        left: 0,
                        width: '380px',
                        maxWidth: '380px',
                        padding: '20px',
                        background: '#1a1a1a',
                        borderRadius: '10px',
                        border: '2px solid rgba(255,255,255,0.08)',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
                        zIndex: 3000,
                        fontFamily: "'Manrope', sans-serif",
                        fontSize: '14px',
                        fontWeight: 500,
                        color: '#A6A4A7',
                        lineHeight: 1.6,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ fontWeight: 800, fontSize: '16px', marginBottom: '12px', color: '#C0B4DA' }}>
                        How does Wink work?
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <li><strong>Zero gas fees:</strong> powered by AVNU paymaster, so you pay nothing</li>
                        <li><strong>Social login, no popups:</strong> sign in once via Privy and all blinks go through automatically</li>
                        <li><strong>1 blink = 1 transaction:</strong> each blink sends a real transaction on Starknet</li>
                        <li><strong>Instant feedback:</strong> transactions are pre-confirmed, then settled on L2</li>
                        <li><strong>Powered by Privy + Starkzap,</strong> bringing Web3 to any app with social login</li>
                      </ul>
                    </div>
                  )}
                </div>
                {/* Generate Image button */}
                {!isMobile && (
                <button
                  onClick={async () => {
                    if (isGeneratingImage) return;
                    setIsGeneratingImage(true);
                    try {
                      const totalBlinks = await getTotalBlinks();
                      const count = totalBlinks > 0 ? totalBlinks : blinkCount;
                      const blob = await generateBlinkCard(count);
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `winky-${count}-blinks.png`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      console.error('[WinkyGame] Failed to generate blink card:', err);
                    } finally {
                      setIsGeneratingImage(false);
                    }
                  }}
                  disabled={isGeneratingImage}
                  className="winky-header-btn"
                  style={{
                    cursor: isGeneratingImage ? 'wait' : 'pointer',
                    opacity: isGeneratingImage ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isGeneratingImage) {
                      e.currentTarget.style.background = '#C0B4DA';
                      e.currentTarget.style.color = '#fff';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#C0B4DA';
                  }}
                >
                  {isGeneratingImage ? 'Generating...' : 'Generate Image'}
                </button>
                )}
                {/* Leaderboard button */}
                <button
                  onClick={() => setShowLeaderboard(true)}
                  className={isMobile ? 'winky-header-btn winky-header-btn--mobile' : 'winky-header-btn'}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#C0B4DA';
                    e.currentTarget.style.color = '#fff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#C0B4DA';
                  }}
                >
                  {isMobile ? 'LB' : 'Leaderboard'}
                </button>
                {/* Get Image button on mobile */}
                {isMobile && (
                  <button
                    onClick={async () => {
                      if (isGeneratingImage) return;
                      setIsGeneratingImage(true);
                      try {
                        const totalBlinks = await getTotalBlinks();
                        const count = totalBlinks > 0 ? totalBlinks : blinkCount;
                        const blob = await generateBlinkCard(count);
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `winky-${count}-blinks.png`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch (err) {
                        console.error('[WinkyGame] Failed to generate blink card:', err);
                      } finally {
                        setIsGeneratingImage(false);
                      }
                    }}
                    disabled={isGeneratingImage}
                    className="winky-header-btn winky-header-btn--mobile"
                    style={{
                      cursor: isGeneratingImage ? 'wait' : 'pointer',
                      opacity: isGeneratingImage ? 0.6 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!isGeneratingImage) {
                        e.currentTarget.style.background = '#C0B4DA';
                        e.currentTarget.style.color = '#fff';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#C0B4DA';
                    }}
                  >
                    {isGeneratingImage ? '...' : 'Get image'}
                  </button>
                )}
                {/* Tweet button */}
                {!isMobile && (
                <a
                  href="#"
                  className="winky-header-btn"
                  onClick={async (e) => {
                    e.preventDefault();
                    const totalBlinks = await getTotalBlinks();
                    const count = totalBlinks > 0 ? totalBlinks : blinkCount;
                    const text = `I'm a Starknet Winker: blinked ${count} time${count !== 1 ? 's' : ''}, what about you? 👁️\n\nOne Blink is one Starknet transaction. Powered by Privy social login and Gasless transactions. All onchain.\n\nHow much can you blink: https://wink-on-starknet.com/`;
                    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#C0B4DA';
                    e.currentTarget.style.color = '#fff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#C0B4DA';
                  }}
                >
                  Tweeeeeet it
                </a>
                )}
                <button
                  onClick={() => setShowWalletMenu((prev) => !prev)}
                  className="winky-header-btn-wallet"
                  style={isMobile ? { padding: '6px 12px', fontSize: '12px' } : undefined}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: 'var(--success)',
                      boxShadow: 'none',
                      flexShrink: 0,
                    }}
                  />
                  {formatAddress(displayAddress) || displayName}
                </button>

                {showWalletMenu && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 8px)',
                      right: 0,
                      minWidth: '220px',
                      background: 'rgba(26, 26, 26, 0.97)',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
                      backdropFilter: 'blur(12px)',
                      zIndex: 1000,
                    }}
                  >
                    <div
                      style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        fontSize: '11px',
                        fontFamily: "'Manrope', sans-serif",
                        color: '#A6A4A7',
                        wordBreak: 'break-all',
                        lineHeight: 1.4,
                      }}
                    >
                      {displayAddress || displayName}
                    </div>
                    {displayAddress && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(displayAddress);
                        setShowWalletMenu(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        width: '100%',
                        padding: '12px 16px',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                        color: '#A6A4A7',
                        fontSize: '13px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      Copy Address
                    </button>
                    )}
                    <button
                      onClick={handleLogout}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        width: '100%',
                        padding: '12px 16px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--error)',
                        fontSize: '13px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
      </header>

      {/* ─── Mobile info card ─── */}
      {showInfo && isMobile && (
        <div
          style={{
            position: 'absolute',
            top: headerRef.current ? `${headerRef.current.offsetHeight + 4}px` : '80px',
            left: '8px',
            right: '8px',
            zIndex: 3000,
            padding: '14px',
            background: '#1a1a1a',
            borderRadius: '10px',
            border: '2px solid rgba(255,255,255,0.08)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
            fontFamily: "'Manrope', sans-serif",
            fontSize: '12px',
            fontWeight: 500,
            color: '#A6A4A7',
            lineHeight: 1.6,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 800, fontSize: '14px', marginBottom: '12px', color: '#C0B4DA' }}>
            How does Wink work?
          </div>
          <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li><strong>Zero gas fees:</strong> powered by AVNU paymaster, so you pay nothing</li>
            <li><strong>Social login, no popups:</strong> sign in once via Privy and all blinks go through automatically</li>
            <li><strong>1 blink = 1 transaction:</strong> each blink sends a real transaction on Starknet</li>
            <li><strong>Instant feedback:</strong> transactions are pre-confirmed, then settled on L2</li>
            <li><strong>Powered by Privy + Starkzap,</strong> bringing Web3 to any app with social login</li>
          </ul>
        </div>
      )}

      {/* ─── Body: 75/25 horizontal on desktop, stacked on mobile ─── */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}>

      {/* ─── Camera section ─── */}
      <div
        style={{
          flex: isMobile ? 'none' : 3,
          height: isMobile ? '55vh' : 'auto',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          padding: isMobile ? '4px 8px 4px' : '8px 48px 40px',
        }}
      >
        <div
          className="video-container"
          style={{ position: 'relative', flex: 1, minHeight: 0 }}
        >
          <video
            ref={(el) => { videoRef.current = el; }}
            autoPlay
            playsInline
            muted
            className="video-feed"
            style={{
              filter: !isConnected ? 'blur(14px) brightness(0.6)' : 'none',
              transition: 'filter 0.4s ease',
            }}
          />
          <canvas
            ref={(el) => { canvasRef.current = el; }}
            width={400}
            height={300}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 2,
              opacity: !isConnected ? 0 : 1,
              transition: 'opacity 0.4s ease',
            }}
          />

          {/* Overlay — shown when not connected */}
          {!isConnected && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: isMobile ? '24px' : '0',
                zIndex: 3,
              }}
            >
              {!isMobile && (
                <>
                  <button
                    onClick={handleLogin}
                    disabled={loginBusy}
                    style={{
                      marginTop: '32px',
                      padding: '18px 64px',
                      fontSize: '22px',
                      fontWeight: 800,
                      fontFamily: "'Manrope', sans-serif",
                      background: walletLoading ? '#6366f1' : '#C0B4DA',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '10px',
                      cursor: loginBusy ? 'wait' : 'pointer',
                      opacity: loginBusy ? 0.6 : 1,
                      letterSpacing: '0.5px',
                      boxShadow: '0 4px 24px rgba(192, 180, 218, 0.5)',
                      transition: 'transform 0.15s, box-shadow 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.05)';
                      e.currentTarget.style.boxShadow = '0 6px 32px rgba(192, 180, 218, 0.6)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                      e.currentTarget.style.boxShadow = '0 4px 24px rgba(192, 180, 218, 0.5)';
                    }}
                  >
                    {walletLoading ? 'Setting up wallet...' : !ready ? 'Loading...' : 'Sign Up'}
                  </button>
                </>
              )}
              {isMobile && (
                <button
                  onClick={handleLogin}
                  disabled={loginBusy}
                  style={{
                    padding: '18px 48px',
                    fontSize: '20px',
                    fontWeight: 800,
                    fontFamily: "'Manrope', sans-serif",
                    background: walletLoading ? '#6366f1' : '#C0B4DA',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: loginBusy ? 'wait' : 'pointer',
                    opacity: loginBusy ? 0.6 : 1,
                    letterSpacing: '0.5px',
                    boxShadow: '0 4px 20px rgba(192, 180, 218, 0.4)',
                  }}
                >
                  {walletLoading ? 'Setting up...' : !ready ? 'Loading...' : 'Sign Up'}
                </button>
              )}
            </div>
          )}

          {/* Blink counter */}
          {!isLoading && isRunning && (
            <div
              style={{
                position: 'absolute',
                top: isMobile ? '4px' : '-4px',
                right: isMobile ? '8px' : '20px',
                zIndex: 5,
                fontFamily: "'Manrope', sans-serif",
                fontSize: isMobile ? '48px' : '90px',
                fontWeight: 700,
                color: '#C0B4DA',
              }}
            >
              {totalBlinkCount}
            </div>
          )}

          {/* Fastest blinker */}
          {isConnected && liveFeed.topBlinker && liveFeed.topBlinker.rpm >= 2 && (
            <div
              style={{
                position: 'absolute',
                top: isMobile ? '6px' : '8px',
                left: isMobile ? '8px' : '20px',
                zIndex: 5,
                maxWidth: isMobile ? '60%' : '50%',
                fontFamily: "'Manrope', sans-serif",
                fontSize: isMobile ? '20px' : '66px',
                fontWeight: 800,
                lineHeight: 1.2,
                animation: 'rainbow 0.5s linear infinite',
                textShadow: '0 0 8px rgba(255,255,255,0.4)',
              }}
            >
              Fastest blinker:
              <br />
              {liveFeed.topBlinker.displayName.startsWith('@') ? (
                <a
                  href={`https://x.com/${liveFeed.topBlinker.displayName.slice(1)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'inherit', textDecoration: 'none' }}
                  onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                  onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                >
                  {liveFeed.topBlinker.displayName}
                </a>
              ) : (
                liveFeed.topBlinker.displayName
              )}{' '}
              at {liveFeed.topBlinker.rpm} bpm
            </div>
          )}

          {/* Live feed ticker */}
          {isConnected && liveFeed.events.length > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 4,
                overflow: 'hidden',
                background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)',
                padding: isMobile ? '16px 10px 10px' : '20px 20px 14px',
                borderRadius: isMobile ? '0 0 12px 12px' : '0 0 20px 20px',
                pointerEvents: 'none',
              }}
            >
              <LiveFeedTicker events={liveFeed.events} isMobile={isMobile} />
            </div>
          )}
        </div>

        {error && (
          <div className="error-banner" style={{ position: 'absolute', bottom: '16px', left: '16px', right: '16px', zIndex: 10 }}>
            {error}
          </div>
        )}
      </div>

      {/* ─── TX log section ─── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: isMobile ? '0 0 8px' : '8px 0 40px',
          minHeight: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            padding: isMobile ? '0 12px' : '0 16px 0',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: isMobile ? '40%' : '35%',
              background: 'linear-gradient(to bottom, #0A0A0A 0%, transparent 100%)',
              zIndex: 1,
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: isMobile ? '0 12px' : '0 16px',
              display: 'flex',
              flexDirection: 'column-reverse',
              overflow: 'hidden',
              height: '100%',
            }}
          >
          {isConnected && txLog.length > 0 ? (
            txLog.map((tx) => (
              <TxLogItem key={tx.id} tx={tx} compact={isMobile} />
            ))
          ) : null}
          </div>
        </div>
      </div>
      </div>

      {/* Milestone Popup — 100 blinks */}
      {showMilestone && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(6px)',
          }}
          onClick={() => setShowMilestone(false)}
        >
          <div
            style={{
              background: '#1a1a1a',
              borderRadius: '20px',
              padding: isMobile ? '32px 24px' : '48px 56px',
              maxWidth: '440px',
              width: '90vw',
              textAlign: 'center',
              boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
              fontFamily: "'Manrope', sans-serif",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '56px', marginBottom: '12px' }}>
              👁️
            </div>
            <h2 style={{
              fontSize: isMobile ? '22px' : '28px',
              fontWeight: 900,
              color: '#C0B4DA',
              margin: '0 0 8px',
            }}>
              100 Blinks!
            </h2>
            <p style={{
              fontSize: isMobile ? '14px' : '16px',
              color: '#A6A4A7',
              margin: '0 0 28px',
              lineHeight: 1.5,
            }}>
              You just hit <strong>100 onchain blinks</strong> on Starknet. Tell the world you&apos;re in the Blink-ster crew.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
              <button
                onClick={() => {
                  const text = `I just hit 100 blinks on Starknet! Each blink is a real transaction. Powered by Privy social login and Gasless transactions. All onchain.\n\nCan you out-blink me? 👁️\nhttps://wink-on-starknet.com/`;
                  window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
                  setShowMilestone(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  padding: '14px 32px',
                  fontSize: '16px',
                  fontWeight: 800,
                  fontFamily: "'Manrope', sans-serif",
                  background: '#000',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  width: '100%',
                  maxWidth: '280px',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                Share on X
              </button>
              <button
                onClick={() => setShowMilestone(false)}
                style={{
                  padding: '10px 24px',
                  fontSize: '14px',
                  fontWeight: 600,
                  fontFamily: "'Manrope', sans-serif",
                  background: 'transparent',
                  color: '#888',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Keep blinking
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard Modal */}
      {showLeaderboard && (
        <LeaderboardModal
          userAddress={walletAddress || undefined}
          twitterProfile={twitter.profile}
          onClose={() => setShowLeaderboard(false)}
        />
      )}
    </div>
  );
}

// ─── Transaction Log Item ───
function TxLogItem({ tx, compact = false }: { tx: BlinkTransaction; compact?: boolean }) {
  const rowColor =
    tx.status === 'success'
      ? '#C0B4DA'
      : tx.status === 'skipped'
        ? '#E96D25'
        : tx.status === 'error'
          ? '#ef4444'
          : 'rgba(255,255,255,0.3)';

  const timeAgo = getTimeAgo(tx.timestamp);

  const displayHash = tx.hash
    ? `${tx.hash.slice(0, 6)}…${tx.hash.slice(-4)}`
    : tx.status === 'pending'
      ? 'pending…'
      : '0x0000…0000';

  const titleSize = compact ? '18px' : '36px';
  const hashSize = compact ? '14px' : '32px';
  const timeSize = compact ? '14px' : '32px';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: compact ? '6px' : '10px',
        padding: compact ? '3px 0' : '5px 0',
        color: rowColor,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: titleSize, fontWeight: '800', color: rowColor }}>
          Blink #{tx.blinkNumber}
        </div>
        <div style={{ marginTop: '1px' }}>
          {tx.hash && VOYAGER_TX_URL ? (
            <a
              href={`${VOYAGER_TX_URL}/${tx.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: hashSize,
                fontWeight: '800',
                fontFamily: "'Manrope', sans-serif",
                color: '#DEE2C7',
                opacity: 0.7,
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
            >
              {displayHash}
            </a>
          ) : (
            <span
              style={{
                fontSize: hashSize,
                fontWeight: '800',
                fontFamily: "'Manrope', sans-serif",
                color: '#DEE2C7',
                opacity: 0.6,
              }}
            >
              {displayHash}
            </span>
          )}
        </div>
      </div>
      <span
        style={{
          fontSize: timeSize,
          fontWeight: '800',
          color: '#DEE2C7',
          opacity: 0.55,
          whiteSpace: 'nowrap',
          paddingTop: '2px',
          fontFamily: "'Manrope', sans-serif",
        }}
      >
        {timeAgo}
      </span>
    </div>
  );
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// ─── Live Feed Ticker ───
function LiveFeedTicker({ events, isMobile }: { events: LiveBlinkEvent[]; isMobile: boolean }) {
  const maxVisible = isMobile ? 5 : 10;
  const visible = events.slice(0, maxVisible).reverse();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: isMobile ? '2px' : '3px',
        pointerEvents: 'auto',
      }}
    >
      {visible.map((ev, idx) => {
        const displayName = ev.twitterUsername
          ? `@${ev.twitterUsername}`
          : `${ev.address.slice(0, 6)}...${ev.address.slice(-4)}`;
        const txShort = `${ev.txHash.slice(0, 6)}...${ev.txHash.slice(-4)}`;
        const ago = getTimeAgo(ev.timestamp);
        const isTopFading = idx === 0 && visible.length >= maxVisible;

        return (
          <div
            key={ev.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: isMobile ? '6px' : '8px',
              fontFamily: "'Manrope', sans-serif",
              fontSize: isMobile ? '10px' : '13px',
              fontWeight: 600,
              color: 'rgba(255,255,255,0.9)',
              lineHeight: 1.3,
              opacity: isTopFading ? 0.3 : 1,
              transition: 'opacity 0.5s ease-out',
            }}
          >
            <span style={{ color: '#C0B4DA', fontSize: isMobile ? '6px' : '8px' }}>&#9679;</span>
            <span style={{ fontWeight: 800 }}>{displayName}</span>
            <span style={{ opacity: 0.7 }}>blinked</span>
            <a
              href={`https://voyager.online/tx/${ev.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'rgba(255,255,255,0.6)',
                textDecoration: 'none',
                fontFamily: "'SF Mono', Monaco, monospace",
                fontSize: isMobile ? '9px' : '11px',
              }}
            >
              {txShort}
            </a>
            <span style={{ opacity: 0.5, whiteSpace: 'nowrap' }}>{ago}</span>
          </div>
        );
      })}
    </div>
  );
}
