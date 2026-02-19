'use client';

/**
 * WinkyGame - Single-page blink counter with Starknet integration.
 *
 * Layout:
 *   Header floats on top of the left zone
 *   Body  – 75 % camera (full area)  |  25 % transaction log
 *
 * Camera feed starts immediately; blurry when wallet is not connected.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount, useDisconnect, useConnect } from '@starknet-react/core';
import { useBlinkDetection } from '@/hooks/use-blink-detection';
import { useWinkyContract, BlinkTransaction } from '@/hooks/use-winky-contract';
import { useTwitterAuth } from '@/hooks/use-twitter-auth';
import { GAME_CONFIG, VOYAGER_TX_URL, NETWORK } from '@/lib/constants';
import { generateBlinkCard } from '@/lib/generate-blink-card';
import { LeaderboardModal } from '@/components/Leaderboard';
import { useLiveFeed, LiveBlinkEvent, TopBlinker } from '@/hooks/use-live-feed';

export function WinkyGame() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { connect, connectAsync, connectors, isPending: isConnecting, status: connectStatus } = useConnect();

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
  const [connectClicked, setConnectClicked] = useState(false);
  const milestoneShownRef = useRef(
    typeof window !== 'undefined' && localStorage.getItem('winky_milestone_100') === '1'
  );

  // Twitter auth - optional, enhances leaderboard with user's position
  const twitter = useTwitterAuth(address);

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
      // Clean the URL param without reload
      params.delete('twitter_connected');
      const cleanUrl = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    }
  }, []);

  const cartridgeConnector = connectors[0] ?? undefined;
  const isConnectBusy = isConnecting || connectClicked;

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleConnect = useCallback(() => {
    if (isConnectBusy) return;
    const connector = cartridgeConnector || connectors[0];
    if (!connector) return;
    setConnectClicked(true);

    const tryConnect = (attempts: number) => {
      connectAsync({ connector }).catch((err) => {
        const isNotReady = String(err?.message || err).toLowerCase().includes('not ready');
        if (isNotReady && attempts > 0) {
          retryTimerRef.current = setTimeout(() => tryConnect(attempts - 1), 2000);
        } else {
          setConnectClicked(false);
        }
      });
    };
    tryConnect(20);
  }, [isConnectBusy, cartridgeConnector, connectors, connectAsync]);

  useEffect(() => {
    if (isConnected && retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, [isConnected]);

  const {
    recordBlink,
    getTotalBlinks,
    txLog,
    isReady: isContractReady,
  } = useWinkyContract();

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

  // Fetch persistent on-chain blink total when wallet connects
  useEffect(() => {
    if (isConnected && isContractReady) {
      getTotalBlinks().then((total) => {
        if (total > 0) setPersistentBlinks(total);
      }).catch(() => { /* non-fatal */ });
    }
  }, [isConnected, isContractReady, getTotalBlinks]);

  // Reset connect guard when wallet connects, or connect fails/is canceled
  useEffect(() => {
    if (isConnected) setConnectClicked(false);
  }, [isConnected]);

  const prevConnectStatusRef = useRef(connectStatus);
  useEffect(() => {
    const prev = prevConnectStatusRef.current;
    prevConnectStatusRef.current = connectStatus;
    // Reset guard when transitioning from pending back to idle (canceled) or error
    if (connectClicked && prev === 'pending' && (connectStatus === 'idle' || connectStatus === 'error')) {
      setConnectClicked(false);
    }
  }, [connectStatus, connectClicked]);

  // Live global blink feed
  const liveFeed = useLiveFeed();

  // Total = previous on-chain blinks + current session blinks
  const totalBlinkCount = persistentBlinks + blinkCount;

  // Milestone popup at 100 blinks — only fires once ever (persisted in localStorage).
  // Only triggers when the count crosses 100 during this session, not if the user
  // already had 100+ persistent blinks when they loaded the page.
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
              <span style={{ fontSize: '16px', fontWeight: 600, color: '#D23434', fontFamily: "'Manrope', sans-serif", alignSelf: 'flex-end' }}>
                Powered by{' '}
                <a
                  href="https://x.com/Starknet"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#D23434', textDecoration: 'none', transition: 'text-decoration 0.15s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                  onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                >
                  Starknet
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

          {/* Right: Connect / Address */}
          <div style={{ position: 'relative' }}>
            {isConnected && address ? (
              <div style={{ display: 'flex', gap: isMobile ? '4px' : '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {/* GitHub icon */}
                {!isMobile && (
                <a
                  href="https://github.com/starkience/winky"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '50%',
                    border: '3px solid #D23434',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    textDecoration: 'none',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#D23434';
                    (e.currentTarget.querySelector('svg') as SVGElement).style.fill = '#fff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    (e.currentTarget.querySelector('svg') as SVGElement).style.fill = '#D23434';
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#D23434" style={{ transition: 'fill 0.2s' }}>
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                  </svg>
                </a>
                )}
                {/* Info icon — tap-to-toggle on mobile, hover on desktop */}
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
                      border: isMobile ? '2px solid #D23434' : '3px solid #D23434',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: isMobile ? '14px' : '18px',
                      fontWeight: 800,
                      fontFamily: "'Manrope', sans-serif",
                      color: '#D23434',
                      transition: 'all 0.2s',
                      position: 'relative',
                      zIndex: showInfo && isMobile ? 3001 : 'auto',
                    }}
                  >
                    i
                  </div>
                  {showInfo && isMobile && (
                    /* Transparent backdrop — tapping anywhere outside dismisses the card */
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
                        background: '#fff',
                        borderRadius: '10px',
                        border: '2px solid rgba(0,0,0,0.08)',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                        zIndex: 3000,
                        fontFamily: "'Manrope', sans-serif",
                        fontSize: '14px',
                        fontWeight: 500,
                        color: '#333',
                        lineHeight: 1.6,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ fontWeight: 800, fontSize: '16px', marginBottom: '12px', color: '#111' }}>
                        How does Wink work?
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <li><strong>Zero gas fees:</strong> we funded a paymaster, so you pay nothing</li>
                        <li><strong>One session, no popups:</strong> you sign once and all blinks go through automatically</li>
                        <li><strong>1 blink = 1 transaction:</strong> each blink sends a real transaction on Starknet</li>
                        <li><strong>Instant feedback:</strong> transactions are pre-confirmed, then settled on L2</li>
                        <li><strong>Powered by Cartridge Controller,</strong> a smart wallet that handles sessions and gas for you</li>
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
                      // Fetch persistent on-chain total (not session count)
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
                      e.currentTarget.style.background = '#D23434';
                      e.currentTarget.style.color = '#fff';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#D23434';
                  }}
                >
                  {isGeneratingImage ? 'Generating...' : 'Generate Image'}
                </button>
                )}
                {/* Leaderboard button - always opens */}
                <button
                  onClick={() => setShowLeaderboard(true)}
                  className={isMobile ? 'winky-header-btn winky-header-btn--mobile' : 'winky-header-btn'}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#D23434';
                    e.currentTarget.style.color = '#fff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#D23434';
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
                        e.currentTarget.style.background = '#D23434';
                        e.currentTarget.style.color = '#fff';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#D23434';
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
                    const text = `I'm a Starknet Winker: blinked ${count} time${count !== 1 ? 's' : ''}, what about you? 👁️\n\nOne Blink is one Starknet transaction. Powered by Session Keys and Gasless transactions. All onchain.\n\nHow much can you blink: https://wink-on-starknet.com/`;
                    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#D23434';
                    e.currentTarget.style.color = '#fff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#D23434';
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
                  {address.slice(0, 6)}...{address.slice(-4)}
                </button>

                {showWalletMenu && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 8px)',
                      right: 0,
                      minWidth: '220px',
                      background: 'rgba(255, 255, 255, 0.97)',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      boxShadow: 'none',
                      backdropFilter: 'blur(12px)',
                      zIndex: 1000,
                    }}
                  >
                    <div
                      style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid rgba(0,0,0,0.06)',
                        fontSize: '11px',
                        fontFamily: "'Manrope', sans-serif",
                        color: '#555',
                        wordBreak: 'break-all',
                        lineHeight: 1.4,
                      }}
                    >
                      {address}
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(address);
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
                        borderBottom: '1px solid rgba(0,0,0,0.06)',
                        color: '#111',
                        fontSize: '13px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      Copy Address
                    </button>
                    <button
                      onClick={() => {
                        disconnect();
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
                        color: 'var(--error)',
                        fontSize: '13px',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
      </header>

      {/* ─── Mobile info card — overlays content below header ─── */}
      {showInfo && isMobile && (
        <div
          style={{
            position: 'absolute',
            top: headerRef.current ? `${headerRef.current.offsetHeight + 4}px` : '80px',
            left: '8px',
            right: '8px',
            zIndex: 3000,
            padding: '14px',
            background: '#fff',
            borderRadius: '10px',
            border: '2px solid rgba(0,0,0,0.08)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            fontFamily: "'Manrope', sans-serif",
            fontSize: '12px',
            fontWeight: 500,
            color: '#333',
            lineHeight: 1.6,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 800, fontSize: '14px', marginBottom: '12px', color: '#111' }}>
            How does Wink work?
          </div>
          <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li><strong>Zero gas fees:</strong> we funded a paymaster, so you pay nothing</li>
            <li><strong>One session, no popups:</strong> you sign once and all blinks go through automatically</li>
            <li><strong>1 blink = 1 transaction:</strong> each blink sends a real transaction on Starknet</li>
            <li><strong>Instant feedback:</strong> transactions are pre-confirmed, then settled on L2</li>
            <li><strong>Powered by Cartridge Controller,</strong> a smart wallet that handles sessions and gas for you</li>
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
        {/* Camera fills remaining space */}
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

          {/* Steps overlay — shown when not connected */}
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
                  <img
                    src="/steps.png"
                    alt="Steps: Sign up, Create a session, One blink one transaction, Share on X"
                    style={{
                      maxWidth: '420px',
                      width: '70%',
                      height: 'auto',
                      objectFit: 'contain',
                      filter: 'drop-shadow(0 0 40px rgba(255, 255, 255, 0.4)) drop-shadow(0 0 80px rgba(255, 255, 255, 0.3)) drop-shadow(0 0 140px rgba(255, 255, 255, 0.2))',
                    }}
                  />
                  <button
                    onClick={handleConnect}
                    disabled={isConnectBusy || !cartridgeConnector}
                    style={{
                      marginTop: '32px',
                      padding: '18px 64px',
                      fontSize: '22px',
                      fontWeight: 800,
                      fontFamily: "'Manrope', sans-serif",
                      background: '#D23434',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '10px',
                      cursor: (isConnectBusy || !cartridgeConnector) ? 'wait' : 'pointer',
                      opacity: (isConnectBusy || !cartridgeConnector) ? 0.6 : 1,
                      letterSpacing: '0.5px',
                      boxShadow: '0 4px 24px rgba(210, 52, 52, 0.5)',
                      transition: 'transform 0.15s, box-shadow 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.05)';
                      e.currentTarget.style.boxShadow = '0 6px 32px rgba(210, 52, 52, 0.6)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                      e.currentTarget.style.boxShadow = '0 4px 24px rgba(210, 52, 52, 0.5)';
                    }}
                  >
                    {isConnectBusy ? 'Connecting...' : !cartridgeConnector ? 'Loading...' : 'Sign Up'}
                  </button>
                </>
              )}
              {isMobile && (
                <button
                  onClick={handleConnect}
                  disabled={isConnectBusy || !cartridgeConnector}
                  style={{
                    padding: '18px 48px',
                    fontSize: '20px',
                    fontWeight: 800,
                    fontFamily: "'Manrope', sans-serif",
                    background: '#D23434',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: (isConnectBusy || !cartridgeConnector) ? 'wait' : 'pointer',
                    opacity: (isConnectBusy || !cartridgeConnector) ? 0.6 : 1,
                    letterSpacing: '0.5px',
                    boxShadow: '0 4px 20px rgba(210, 52, 52, 0.4)',
                  }}
                >
                  {isConnectBusy ? 'Connecting...' : !cartridgeConnector ? 'Loading...' : 'Sign Up'}
                </button>
              )}
            </div>
          )}

          {/* Blink counter top-right of camera */}
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
                color: '#D23434',
              }}
            >
              {totalBlinkCount}
            </div>
          )}

          {/* Fastest blinker — top-left of camera */}
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
                  style={{
                    color: 'inherit',
                    textDecoration: 'none',
                  }}
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

          {/* Live global blink feed ticker — only when signed in */}
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
        {/* Transaction log — fixed container, no scroll, items fade upward */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            padding: isMobile ? '0 12px' : '0 16px 0',
          }}
        >
          {/* Fade-out gradient at top */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: isMobile ? '40%' : '35%',
              background: 'linear-gradient(to bottom, var(--bg-primary) 0%, transparent 100%)',
              zIndex: 1,
              pointerEvents: 'none',
            }}
          />
          {/* Items pinned to bottom, overflow hidden (old ones disappear upward) */}
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
      </div>{/* end body 75/25 */}

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
              background: '#fff',
              borderRadius: '20px',
              padding: isMobile ? '32px 24px' : '48px 56px',
              maxWidth: '440px',
              width: '90vw',
              textAlign: 'center',
              boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
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
              color: '#111',
              margin: '0 0 8px',
            }}>
              100 Blinks!
            </h2>
            <p style={{
              fontSize: isMobile ? '14px' : '16px',
              color: '#555',
              margin: '0 0 28px',
              lineHeight: 1.5,
            }}>
              You just hit <strong>100 onchain blinks</strong> on Starknet. Tell the world you're in the Blink-ster crew.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
              <button
                onClick={() => {
                  const text = `I just hit 100 blinks on Starknet! Each blink is a real transaction. Powered by Session Keys and Gasless transactions. All onchain.\n\nCan you out-blink me? 👁️\nhttps://wink-on-starknet.com/`;
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
          userAddress={address}
          twitterProfile={twitter.profile}
          onTwitterConnect={twitter.connect}
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
      ? '#111111'
      : tx.status === 'skipped'
        ? '#d97706'
        : tx.status === 'error'
          ? '#dc2626'
          : 'rgba(0,0,0,0.3)';

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
        <div style={{ fontSize: titleSize, fontWeight: '800' }}>
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
                color: rowColor,
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
  // Show the most recent events — newest at the bottom, oldest at the top (scrolls up)
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
        // Fade out the topmost (oldest) item when we have a full list
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
            <span style={{ color: '#D23434', fontSize: isMobile ? '6px' : '8px' }}>&#9679;</span>
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
