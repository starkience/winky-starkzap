'use client';

import { useState, useEffect } from 'react';
import { CHALLENGE_CONFIG } from '@/lib/constants';

export function ChallengeHealthBar({ className }: { className?: string }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const startTime = CHALLENGE_CONFIG.START_TIME;
  const endTime = startTime + CHALLENGE_CONFIG.DURATION_MS;
  const isActive = startTime > 0 && now >= startTime && now < endTime;
  const isUpcoming = startTime > 0 && now < startTime;
  const isEnded = startTime > 0 && now >= endTime;

  let fraction = 1;
  let countdownText = '12:00:00';

  if (startTime === 0) {
    countdownText = '12:00:00';
  } else if (isActive) {
    const remaining = endTime - now;
    fraction = remaining / CHALLENGE_CONFIG.DURATION_MS;
    const h = Math.floor(remaining / 3_600_000);
    const m = Math.floor((remaining % 3_600_000) / 60_000);
    const s = Math.floor((remaining % 60_000) / 1000);
    countdownText = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  } else if (isUpcoming) {
    countdownText = '12:00:00';
  } else if (isEnded) {
    fraction = 0;
    countdownText = '00:00:00';
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
