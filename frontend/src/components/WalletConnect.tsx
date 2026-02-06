'use client';

/**
 * WalletConnect Component
 *
 * Provides wallet connection UI using Cartridge Controller.
 * Uses starknet-react for connection management.
 */

import { useState, useEffect } from 'react';
import { useConnect, useDisconnect, useAccount } from '@starknet-react/core';

export function WalletConnect() {
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { address, isConnected } = useAccount();
  
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Get the Cartridge connector
  const cartridgeConnector = mounted ? connectors[0] : undefined;

  if (isConnected && address) {
    return (
      <div className="main">
        <div className="connect-screen">
          <div className="wallet-connected">
            <div className="wallet-address">
              {address.slice(0, 6)}...{address.slice(-4)}
            </div>
            <button onClick={() => disconnect()} className="disconnect-btn">
              Disconnect
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="main">
      <div className="connect-screen">
        <div className="logo">
          <h1>Winky</h1>
        </div>
        <p className="tagline">Blink Counter on Starknet</p>
        <p className="description">
          Count your blinks with eye tracking
        </p>

        <p className="hint" style={{ marginTop: '24px' }}>
          Connect to start
        </p>

        {error && (
          <div className="error-banner" style={{ marginBottom: '16px' }}>
            {error.message}
          </div>
        )}

        <div className="wallet-connectors">
          {!mounted ? (
            <div className="description">
              <p>Loading...</p>
            </div>
          ) : (
            <>
              {cartridgeConnector && (
                <button
                  onClick={() => connect({ connector: cartridgeConnector })}
                  disabled={isPending}
                  className="connect-btn"
                  style={{
                    background: 'linear-gradient(135deg, #F5A623, #F76B1C)',
                    border: 'none',
                  }}
                >
                  {isPending ? 'Connecting...' : 'Connect with Cartridge'}
                </button>
              )}

              <div style={{ 
                fontSize: '11px', 
                color: 'var(--text-secondary)', 
                textAlign: 'center',
                marginTop: '12px',
                opacity: 0.7,
              }}>
                Built-in session keys - no popups per transaction
              </div>

            </>
          )}
        </div>

        <p className="hint" style={{ marginTop: '32px', fontSize: '12px' }}>
          Powered by Starknet
        </p>
      </div>
    </div>
  );
}
