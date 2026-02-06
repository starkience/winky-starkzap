'use client';

/**
 * WinkyCounter - Simple Blink Counter with Starknet Integration
 *
 * Counts blinks in real-time using Cartridge Controller.
 * Transactions auto-execute via Controller session policies (no popups).
 */

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useDisconnect } from '@starknet-react/core';
import { useBlinkDetection } from '@/hooks/use-blink-detection';
import { useWinkyContract, BlinkTransaction } from '@/hooks/use-winky-contract';
import { GAME_CONFIG, VOYAGER_TX_URL, NETWORK } from '@/lib/constants';

export function WinkyGame() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTxLog, setShowTxLog] = useState(true);
  const [showWalletMenu, setShowWalletMenu] = useState(false);

  // Contract interaction - 1 blink = 1 transaction
  const { 
    recordBlink, 
    txLog, 
    clearLog, 
    isPending, 
    isReady: isContractReady 
  } = useWinkyContract();

  // Blink callback - transactions auto-execute via Cartridge session policies
  const handleBlink = useCallback((count: number) => {
    console.log(`[handleBlink] #${count} | connected=${isConnected} | contractReady=${isContractReady}`);
    
    if (isConnected && isContractReady) {
      console.log(`[handleBlink] -> calling recordBlink(${count})`);
      recordBlink(count);
    } else {
      console.warn(`[handleBlink] -> SKIPPED: connected=${isConnected} ready=${isContractReady}`);
    }
  }, [isConnected, isContractReady, recordBlink]);

  // Blink detection hook
  const {
    videoRef,
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

  // Start camera when detector is ready
  useEffect(() => {
    if (isDetectorReady && isLoading) {
      startDetection()
        .then(() => {
          setIsLoading(false);
        })
        .catch((err) => {
          console.error('Failed to start camera:', err);
          setError('Failed to access camera. Please allow camera permissions.');
          setIsLoading(false);
        });
    }
  }, [isDetectorReady, isLoading, startDetection]);

  return (
    <div className="winky-game">
      {/* Wallet Address Button - Top Right */}
      {isConnected && address && (
        <div
          style={{
            position: 'fixed',
            top: '16px',
            right: '16px',
            zIndex: 1000,
          }}
        >
          <button
            onClick={() => setShowWalletMenu((prev) => !prev)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              background: 'rgba(20, 20, 25, 0.95)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontFamily: "'SF Mono', Monaco, monospace",
              cursor: 'pointer',
              transition: 'all 0.2s',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 2px 12px rgba(0, 0, 0, 0.3)',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'var(--success)',
                boxShadow: '0 0 6px var(--success)',
                flexShrink: 0,
              }}
            />
            {address.slice(0, 6)}...{address.slice(-4)}
          </button>

          {/* Dropdown menu */}
          {showWalletMenu && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                minWidth: '220px',
                background: 'rgba(20, 20, 25, 0.98)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                overflow: 'hidden',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
                backdropFilter: 'blur(12px)',
              }}
            >
              {/* Full address */}
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  fontSize: '11px',
                  fontFamily: "'SF Mono', Monaco, monospace",
                  color: 'var(--text-secondary)',
                  wordBreak: 'break-all',
                  lineHeight: 1.4,
                }}
              >
                {address}
              </div>

              {/* Copy address */}
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
                  borderBottom: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Copy Address
              </button>

              {/* Disconnect */}
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
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <header className="game-header">
        <h1>Winky</h1>
        <p>Blink Counter {NETWORK === 'sepolia' && <span style={{ fontSize: '12px', color: 'var(--warning)' }}>(Sepolia)</span>}</p>
      </header>

      {/* Video Feed */}
      <div className="video-container">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="video-feed"
        />

        {/* Loading overlay */}
        {isLoading && (
          <div className="overlay loading">
            <div className="spinner"></div>
            <p>{isDetectorReady ? 'Starting camera...' : 'Loading face detector...'}</p>
          </div>
        )}

        {/* Blink count overlay */}
        {!isLoading && isRunning && (
          <div className="overlay playing">
            <div className="blink-counter" style={{ fontSize: '64px', fontWeight: 'bold' }}>
              {blinkCount}
            </div>
            <div style={{ fontSize: '18px', color: 'var(--text-secondary)' }}>
              blinks
            </div>
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      {/* Reset button */}
      {isRunning && (
        <div className="controls">
          <button onClick={resetDetection} className="start-btn">
            Reset Counter
          </button>
        </div>
      )}

      {/* Session status */}
      {isConnected && isRunning && (
        <div 
          style={{
            marginTop: '16px',
            padding: '16px 20px',
            background: 'rgba(30, 30, 35, 0.9)',
            borderRadius: '6px',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div 
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: 'var(--success)',
                boxShadow: '0 0 8px var(--success)',
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--success)' }}>
                Cartridge Session Active
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Transactions auto-execute via Controller policies
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats Panel */}
      {isRunning && (
        <div className="stats-panel">
          <div className="stat">
            <span className="label">FPS</span>
            <span className="value">{fps}</span>
          </div>
          <div className="stat">
            <span className="label">EAR</span>
            <span className="value">{currentEAR.toFixed(3)}</span>
          </div>
          <div className="stat">
            <span className="label">Blinks</span>
            <span className="value">{blinkCount}</span>
          </div>
          <div className="stat">
            <span className="label">Mode</span>
            <span className="value" style={{ color: 'var(--success)' }}>Auto</span>
          </div>
        </div>
      )}

      {/* Transaction Log Dashboard */}
      {isConnected && (
        <div 
          className="tx-log-dashboard"
          style={{
            position: 'fixed',
            bottom: '16px',
            right: '16px',
            width: '360px',
            maxHeight: 'calc(100vh - 32px)',
            background: 'rgba(20, 20, 25, 0.95)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            overflow: 'hidden',
            zIndex: 1000,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            flexDirection: 'column' as const,
          }}
        >
          {/* Header */}
          <div 
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              background: 'rgba(30, 30, 35, 0.9)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 'bold' }}>
                Transaction Log
              </span>
              {isPending && (
                <span 
                  style={{
                    padding: '2px 8px',
                    background: 'var(--warning)',
                    color: '#000',
                    borderRadius: '3px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                  }}
                >
                  PENDING
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {txLog.length > 0 && (
                <button
                  onClick={clearLog}
                  style={{
                    padding: '4px 8px',
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: '3px',
                    color: 'var(--text-secondary)',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setShowTxLog(!showTxLog)}
                style={{
                  padding: '4px 8px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: '3px',
                  color: 'var(--text-secondary)',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                {showTxLog ? '−' : '+'}
              </button>
            </div>
          </div>

          {/* Transaction List */}
          {showTxLog && (
            <div 
              style={{
                overflowY: 'auto',
                padding: '8px',
                flex: 1,
              }}
            >
              {txLog.length === 0 ? (
                <div 
                  style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                  }}
                >
                  No transactions yet. Blink to record on-chain!
                </div>
              ) : (
                txLog.map((tx) => (
                  <TxLogItem key={tx.id} tx={tx} />
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Transaction Log Item Component
function TxLogItem({ tx }: { tx: BlinkTransaction }) {
  const statusIcon = tx.status === 'pending' 
    ? '...' 
    : tx.status === 'success' 
      ? 'OK' 
      : tx.status === 'skipped'
        ? 'SKIP'
        : 'ERR';
  
  const statusColor = tx.status === 'pending' 
    ? 'var(--warning)' 
    : tx.status === 'success' 
      ? 'var(--success)' 
      : tx.status === 'skipped'
        ? 'var(--text-secondary)'
        : 'var(--error)';

  const timeAgo = getTimeAgo(tx.timestamp);

  return (
    <div 
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '10px 12px',
        marginBottom: '6px',
        background: 'rgba(40, 40, 45, 0.6)',
        borderRadius: '4px',
        borderLeft: `3px solid ${statusColor}`,
      }}
    >
      <span 
        style={{ 
          fontSize: '10px', 
          fontWeight: 'bold',
          color: statusColor,
          minWidth: '32px',
        }}
      >
        {statusIcon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: '500' }}>
            Blink #{tx.blinkNumber}
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            {timeAgo}
          </span>
        </div>
        {tx.hash && (
          <div style={{ marginTop: '4px' }}>
            {VOYAGER_TX_URL ? (
              <a
                href={`${VOYAGER_TX_URL}/${tx.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '11px',
                  color: 'var(--primary)',
                  textDecoration: 'none',
                  fontFamily: 'monospace',
                }}
              >
                {tx.hash.slice(0, 8)}...{tx.hash.slice(-6)}
              </a>
            ) : (
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                {tx.hash.slice(0, 8)}...{tx.hash.slice(-6)}
              </span>
            )}
          </div>
        )}
        {tx.error && (
          <div 
            style={{
              marginTop: '4px',
              fontSize: '11px',
              color: tx.status === 'skipped' ? 'var(--text-secondary)' : 'var(--error)',
              wordBreak: 'break-word',
              fontStyle: tx.status === 'skipped' ? 'italic' : 'normal',
            }}
          >
            {tx.error}
          </div>
        )}
      </div>
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
