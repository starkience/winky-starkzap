'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

// ============================================================
// LAUNCH CONTROL
// Set to false on Wednesday to make the site fully public.
// When true, visitors must enter the passcode to access the app.
// ============================================================
const PRIVATE_MODE = true;
const PASSCODE = 'wink005';
// ============================================================

// Load WinkyGame only on the client — avoids all SSR hydration issues
const WinkyGame = dynamic(
  () => import('@/components/WinkyGame').then(m => ({ default: m.WinkyGame })),
  { ssr: false, loading: () => null },
);

function PasscodeGate({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code === PASSCODE) {
      sessionStorage.setItem('winky_unlocked', '1');
      onUnlock();
    } else {
      setError(true);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        padding: '40px',
        textAlign: 'center',
        fontFamily: "'Manrope', sans-serif",
        background: '#EDEEEC',
      }}
    >
      <img
        src="/logo.png"
        alt="Wink."
        style={{ height: '48px', objectFit: 'contain', marginBottom: '32px' }}
      />

      <p style={{ fontSize: '18px', fontWeight: 600, color: '#333', marginBottom: '24px' }}>
        Enter access code
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <input
          type="password"
          value={code}
          onChange={(e) => { setCode(e.target.value); setError(false); }}
          placeholder="Access code"
          autoFocus
          style={{
            padding: '12px 20px',
            fontSize: '16px',
            fontFamily: "'Manrope', sans-serif",
            border: `2px solid ${error ? '#D23434' : '#ccc'}`,
            borderRadius: '10px',
            outline: 'none',
            width: '240px',
            textAlign: 'center',
            letterSpacing: '4px',
            transition: 'border-color 0.2s',
            animation: shake ? 'shake 0.4s ease-in-out' : 'none',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '10px 32px',
            background: '#D23434',
            border: 'none',
            borderRadius: '10px',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 700,
            fontFamily: "'Manrope', sans-serif",
            letterSpacing: '1px',
            cursor: 'pointer',
            transition: 'opacity 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          ENTER
        </button>
      </form>

      {error && (
        <p style={{ color: '#D23434', fontSize: '13px', marginTop: '12px', fontWeight: 600 }}>
          Incorrect code
        </p>
      )}

      {/* Shake animation */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}

export default function Home() {
  const [unlocked, setUnlocked] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!PRIVATE_MODE || sessionStorage.getItem('winky_unlocked') === '1') {
      setUnlocked(true);
    }
  }, []);

  // Don't render anything until mounted (avoids hydration mismatch)
  if (!mounted) return null;

  // If PRIVATE_MODE is off, or user entered the passcode, show the app
  if (!PRIVATE_MODE || unlocked) {
    return <WinkyGame />;
  }

  // Otherwise show the passcode gate
  return <PasscodeGate onUnlock={() => setUnlocked(true)} />;
}
