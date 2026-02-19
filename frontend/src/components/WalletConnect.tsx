'use client';

/**
 * WalletConnect Component
 *
 * Provides wallet connection UI using Privy social login.
 */

import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export function WalletConnect() {
  const { login, logout, ready, authenticated, user } = usePrivy();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !ready) {
    return (
      <div className="main">
        <div className="connect-screen">
          <div className="description"><p>Loading...</p></div>
        </div>
      </div>
    );
  }

  if (authenticated && user) {
    return (
      <div className="main">
        <div className="connect-screen">
          <div className="wallet-connected">
            <div className="wallet-address">
              {user.email?.address || user.id}
            </div>
            <button onClick={() => logout()} className="disconnect-btn">
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
            onClick={() => login()}
            className="connect-btn"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              border: 'none',
            }}
          >
            Sign Up with Privy
          </button>

          <div style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            textAlign: 'center',
            marginTop: '12px',
            opacity: 0.7,
          }}>
            Email, Google, Twitter &mdash; no wallet needed
          </div>
        </div>

        <p className="hint" style={{ marginTop: '32px', fontSize: '12px' }}>
          Powered by Starknet &amp; Privy
        </p>
      </div>
    </div>
  );
}
