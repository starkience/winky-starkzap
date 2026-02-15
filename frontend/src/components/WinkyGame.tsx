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

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useDisconnect, useConnect } from '@starknet-react/core';
import { useBlinkDetection } from '@/hooks/use-blink-detection';
import { useWinkyContract, BlinkTransaction } from '@/hooks/use-winky-contract';
import { useTwitterAuth } from '@/hooks/use-twitter-auth';
import { GAME_CONFIG, VOYAGER_TX_URL, NETWORK } from '@/lib/constants';
import { generateBlinkCard } from '@/lib/generate-blink-card';
import { LeaderboardModal } from '@/components/Leaderboard';

export function WinkyGame() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { connect, connectors, isPending: isConnecting } = useConnect();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

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

  const {
    recordBlink,
    getTotalBlinks,
    txLog,
    isReady: isContractReady,
  } = useWinkyContract();

  const handleBlink = useCallback((count: number) => {
    if (isConnected && isContractReady) {
      recordBlink(count);
    }
  }, [isConnected, isContractReady, recordBlink]);

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
          setError('Failed to access camera. Please allow camera permissions.');
          setIsLoading(false);
        });
    }
  }, [isDetectorReady, isLoading, startDetection]);

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
                  {showInfo && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 8px)',
                        right: isMobile ? '-8px' : 'auto',
                        left: isMobile ? undefined : 0,
                        width: isMobile ? 'calc(100vw - 16px)' : '380px',
                        maxWidth: isMobile ? 'calc(100vw - 16px)' : '380px',
                        padding: isMobile ? '14px' : '20px',
                        background: '#fff',
                        borderRadius: '10px',
                        border: '2px solid rgba(0,0,0,0.08)',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                        zIndex: 3000,
                        fontFamily: "'Manrope', sans-serif",
                        fontSize: isMobile ? '12px' : '14px',
                        fontWeight: 500,
                        color: '#333',
                        lineHeight: 1.6,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ fontWeight: 800, fontSize: isMobile ? '14px' : '16px', marginBottom: '12px', color: '#111' }}>
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
                {/* Tweet button */}
                {!isMobile && (
                <a
                  href="#"
                  className="winky-header-btn"
                  onClick={async (e) => {
                    e.preventDefault();
                    const totalBlinks = await getTotalBlinks();
                    const count = totalBlinks > 0 ? totalBlinks : blinkCount;
                    const text = `I'm a Starknet Winker: blinked ${count} time${count !== 1 ? 's' : ''}, what about you? 👁️\n\nOne Blink is one Starknet transaction. Powered by Session Keys and Gasless. All onchain.\n\nHow much can you blink: https://wink-on-starknet.com/`;
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
            ) : (
              <button
                onClick={() => {
                  const connector = cartridgeConnector || connectors[0];
                  if (connector) {
                    connect({ connector });
                  } else {
                    console.warn('[WinkyGame] Connector not ready, will retry in 2s...');
                    setTimeout(() => {
                      const c = connectors[0];
                      if (c) connect({ connector: c });
                      else console.error('[WinkyGame] Connector still not ready');
                    }, 2000);
                  }
                }}
                disabled={isConnecting}
                className={isMobile ? 'winky-header-btn winky-header-btn--mobile' : 'winky-header-btn'}
                style={{
                  cursor: isConnecting ? 'wait' : 'pointer',
                  opacity: isConnecting ? 0.6 : 1,
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
                {isConnecting ? 'Connecting...' : !cartridgeConnector ? 'Loading...' : 'Sign Up'}
              </button>
            )}
          </div>
      </header>

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
              transform: 'scaleX(-1)',
              zIndex: 2,
              opacity: !isConnected ? 0 : 1,
              transition: 'opacity 0.4s ease',
            }}
          />

          {/* Steps overlay — shown when camera is running but not connected */}
          {!isLoading && isRunning && !isConnected && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 3,
              }}
            >
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
              {blinkCount}
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
