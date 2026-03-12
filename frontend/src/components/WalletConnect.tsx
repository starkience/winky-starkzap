'use client';

/**
 * WalletConnect Component
 *
 * Provides wallet connection UI using Cartridge Controller.
 */

import { useState, useEffect } from 'react';
import { useCartridgeWallet } from '@/context/CartridgeWalletContext';

export function WalletConnect() {
  const { connect, disconnect, wallet, address, username, loading } = useCartridgeWallet();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="main">
        <div className="connect-screen">
          <div className="description"><p>Loading...</p></div>
        </div>
      </div>
    );
  }

  if (wallet && address) {
    const displayName = username || `${address.slice(0, 6)}...${address.slice(-4)}`;
    return (
      <div className="main">
        <div className="connect-screen">
          <div className="wallet-connected">
            <div className="wallet-address">
              {displayName}
            </div>
            <button onClick={disconnect} className="disconnect-btn">
              Logout
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
          Sign up to start
        </p>

        <div className="wallet-connectors">
          <button
            onClick={connect}
            disabled={loading}
            className="connect-btn"
            style={{
              background: '#C0B4DA',
              border: 'none',
            }}
          >
            {loading ? <><span>Connecting</span><span className="dots-anim" /></> : 'Connect'}
          </button>

          <div style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            textAlign: 'center',
            marginTop: '12px',
            opacity: 0.7,
          }}>
            Passkey or social login &mdash; no wallet needed
          </div>
        </div>

        <p className="hint" style={{ marginTop: '32px', fontSize: '12px' }}>
          Powered by the Starkzap SDK
        </p>
      </div>
    </div>
  );
}
