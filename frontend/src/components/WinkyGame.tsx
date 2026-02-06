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
import { GAME_CONFIG, VOYAGER_TX_URL, NETWORK } from '@/lib/constants';

export function WinkyGame() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { connect, connectors, isPending: isConnecting } = useConnect();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const cartridgeConnector = mounted ? connectors[0] : undefined;

  const {
    recordBlink,
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ─── Full-width Header ─── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          flexShrink: 0,
          padding: '16px 32px',
        }}
      >
          {/* Left: Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/winky-logo.png" alt="Winky" style={{ height: '40px', objectFit: 'contain' }} />
            {NETWORK === 'sepolia' && (
              <span
                style={{
                  fontSize: '10px',
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
              <>
                <button
                  onClick={() => setShowWalletMenu((prev) => !prev)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  padding: '8px 14px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '10px',
                  color: 'var(--success)',
                    fontSize: '16px',
                    fontFamily: "'Space Grotesk', sans-serif",
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
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
                        fontFamily: "'Inter', sans-serif",
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
              </>
            ) : (
            <button
              onClick={() => cartridgeConnector && connect({ connector: cartridgeConnector })}
              disabled={isConnecting || !cartridgeConnector}
              style={{
                padding: '10px 32px',
                background: 'transparent',
                border: '2px solid #D23434',
                borderRadius: '10px',
                color: '#D23434',
                fontSize: '16px',
                fontWeight: 500,
                fontFamily: "'Space Grotesk', sans-serif",
                letterSpacing: '1px',
                cursor: isConnecting ? 'wait' : 'pointer',
                transition: 'all 0.2s',
                opacity: isConnecting ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#D23434';
                e.currentTarget.style.color = '#fff';
                e.currentTarget.style.borderColor = '#D23434';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#D23434';
                e.currentTarget.style.borderColor = '#D23434';
              }}
            >
              {isConnecting ? 'Connecting...' : 'Sign Up'}
            </button>
            )}
          </div>
      </header>

      {/* ─── Body: 75/25 split ─── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* ─── Left 75 %: Camera ─── */}
      <div
        style={{
          flex: 3,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          padding: '8px 48px 40px',
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

          {/* Loading overlay */}
          {isLoading && (
            <div className="overlay loading">
              <div className="spinner"></div>
              <p>{isDetectorReady ? 'Starting camera...' : 'Loading face detector...'}</p>
            </div>
          )}

          {/* Connect prompt */}
          {!isConnected && !isLoading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 3,
              }}
            >
              <p
                style={{
                  fontSize: '18px',
                  color: '#fff',
                  fontWeight: 600,
                  textShadow: 'none',
                }}
              >
                Connect wallet to start blinking
              </p>
            </div>
          )}

          {/* Stats bar pinned at bottom of camera */}
          {!isLoading && isRunning && (
            <div
              style={{
                position: 'absolute',
                bottom: '12px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 5,
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                padding: '6px 16px',
                background: 'rgba(0, 0, 0, 0.45)',
                backdropFilter: 'blur(10px)',
                borderRadius: '8px',
                fontFamily: "'Inter', sans-serif",
                fontSize: '12px',
                color: 'rgba(255,255,255,0.7)',
              }}
            >
              <span>FPS <span style={{ color: '#fff', fontWeight: '500' }}>{fps}</span></span>
              <span style={{ opacity: 0.3 }}>|</span>
              <span>EAR <span style={{ color: '#fff', fontWeight: '500' }}>{currentEAR.toFixed(3)}</span></span>
              <span style={{ opacity: 0.3 }}>|</span>
              <span>Blinks <span style={{ color: '#fff', fontWeight: '600', fontSize: '14px' }}>{blinkCount}</span></span>
              <button
                onClick={resetDetection}
                title="Reset counter"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '22px',
                  height: '22px',
                  padding: 0,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  color: 'rgba(255,255,255,0.7)',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#fff';
                  e.currentTarget.style.color = '#fff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
                  e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="error-banner" style={{ position: 'absolute', bottom: '16px', left: '16px', right: '16px', zIndex: 10 }}>
            {error}
          </div>
        )}
      </div>

      {/* ─── Right 25 %: Sign Up + Transaction log ─── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Transaction log */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: '0 16px 40px',
            overflow: 'hidden',
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 30%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 30%)',
          }}
        >
        {isConnected && txLog.length > 0 ? (
          [...txLog].reverse().map((tx) => (
            <TxLogItem key={tx.id} tx={tx} />
          ))
        ) : (
          <div
            style={{
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '13px',
              padding: '16px 0',
            }}
          >
            {isConnected ? 'Blink to record on-chain' : 'Connect to see transactions'}
          </div>
        )}
        </div>
      </div>
      </div>{/* end body 75/25 */}
    </div>
  );
}

// ─── Transaction Log Item ───
function TxLogItem({ tx }: { tx: BlinkTransaction }) {
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

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '5px 0',
        color: rowColor,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '15px', fontWeight: '600' }}>
          Blink #{tx.blinkNumber}
        </div>
        <div style={{ marginTop: '1px' }}>
          {tx.hash && VOYAGER_TX_URL ? (
            <a
              href={`${VOYAGER_TX_URL}/${tx.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '13px',
                fontFamily: "'Inter', sans-serif",
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
                fontSize: '13px',
                fontFamily: "'Inter', sans-serif",
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
          fontSize: '13px',
          opacity: 0.55,
          whiteSpace: 'nowrap',
          paddingTop: '2px',
          fontFamily: "'Inter', sans-serif",
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
