'use client';

import { useState, useEffect } from 'react';
import { CHALLENGE_CONFIG } from '@/lib/constants';

export function ChallengeHealthBar({ className }: { className?: string }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const { START_TIME, END_TIME, DURATION_MS } = CHALLENGE_CONFIG;
  const isActive = now >= START_TIME && now < END_TIME;
  const isUpcoming = now < START_TIME;
  const isEnded = now >= END_TIME;

  let fraction = 1;
  let countdownText = '10:00:00';

  if (isActive) {
    const remaining = END_TIME - now;
    fraction = remaining / DURATION_MS;
    const h = Math.floor(remaining / 3_600_000);
    const m = Math.floor((remaining % 3_600_000) / 60_000);
    const s = Math.floor((remaining % 60_000) / 1000);
    countdownText = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  } else if (isUpcoming) {
    const untilStart = START_TIME - now;
    const h = Math.floor(untilStart / 3_600_000);
    const m = Math.floor((untilStart % 3_600_000) / 60_000);
    const s = Math.floor((untilStart % 60_000) / 1000);
    countdownText = `Starts in ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  } else if (isEnded) {
    fraction = 0;
    countdownText = '00:00:00 — Challenge Over';
  }

  const barColor = fraction > 0.5 ? '#22c55e' : fraction > 0.2 ? '#f59e0b' : '#ef4444';

  return (
    <div className={`challenge-bar-wrapper ${className ?? ''}`}>
      <div className="challenge-bar">
        <div className="challenge-bar-fill" style={{ width: `${fraction * 100}%`, background: barColor }} />
        <span className="challenge-bar-countdown">{countdownText}</span>
      </div>
      <span className="challenge-bar-prize-btn">{CHALLENGE_CONFIG.PRIZE_DESCRIPTION}</span>
    </div>
  );
}
