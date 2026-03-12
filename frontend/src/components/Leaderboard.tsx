'use client';

/**
 * LeaderboardModal - Displays ranked users by on-chain blink count.
 *
 * Layout:
 *   Rank  |  Username  |  # Blinks
 *
 * Usernames come from Cartridge Controller (stored in Edge Config).
 */

import { useState, useEffect, useRef } from 'react';
import { useLeaderboard, LeaderboardEntry } from '@/hooks/use-leaderboard';

interface LeaderboardModalProps {
  userAddress?: string;
  controllerUsername?: string | null;
  onClose: () => void;
  mode?: 'ranked' | 'pvp';
}

function normalizeAddress(addr: string): string {
  return addr.replace(/^0x0*/i, '0x').toLowerCase();
}

interface StoredProfile {
  username: string;
  name: string;
  profileImageUrl: string;
}

interface PvPLeaderboardRow {
  address: string;
  username: string;
  earned: number;
  topBlinks: number;
}

export function LeaderboardModal({ userAddress, controllerUsername, onClose, mode = 'ranked' }: LeaderboardModalProps) {
  const { leaderboard, isLoading, loadingStatus, error, userRank, refetch } = useLeaderboard(userAddress);

  const [pvpLeaderboard, setPvpLeaderboard] = useState<PvPLeaderboardRow[]>([]);
  const [pvpLoading, setPvpLoading] = useState(false);

  useEffect(() => {
    if (mode !== 'pvp') return;
    setPvpLoading(true);
    fetch('/api/challenge')
      .then(r => r.json())
      .then(data => {
        const completed = data.completed || [];
        const map = new Map<string, PvPLeaderboardRow>();
        for (const c of completed) {
          if (c.isDraw) continue;
          const winNorm = (c.winnerAddress || '').replace(/^0x0*/i, '0x').toLowerCase();
          const p1Norm = (c.player1?.address || '').replace(/^0x0*/i, '0x').toLowerCase();
          const winner = p1Norm === winNorm ? c.player1 : c.player2;
          if (!winner) continue;
          const existing = map.get(winNorm);
          if (existing) {
            existing.earned += c.payout || 0;
            if (winner.score > existing.topBlinks) existing.topBlinks = winner.score;
          } else {
            map.set(winNorm, {
              address: winNorm,
              username: winner.username || `${winNorm.slice(0, 6)}...${winNorm.slice(-4)}`,
              earned: c.payout || 0,
              topBlinks: winner.score || 0,
            });
          }
        }
        const sorted = Array.from(map.values()).sort((a, b) => b.earned - a.earned);
        setPvpLeaderboard(sorted);

        if (sorted.length > 0) {
          const addrs = sorted.map(e => e.address).join(',');
          fetch(`/api/twitter-profiles?addresses=${encodeURIComponent(addrs)}`)
            .then(r => r.json())
            .then(profileData => {
              if (profileData.profiles) {
                setPvpLeaderboard(prev => prev.map(entry => {
                  const profile = profileData.profiles[entry.address];
                  if (profile) {
                    return { ...entry, username: profile.username || entry.username };
                  }
                  return entry;
                }));
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setPvpLoading(false));
  }, [mode]);

  const overlayRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const handleTouchMove = (e: TouchEvent) => {
      const body = bodyRef.current;
      if (!body) {
        e.preventDefault();
        return;
      }

      const target = e.target as Node;
      if (body.contains(target)) {
        if (body.scrollTop <= 0) {
          const touch = e.touches[0];
          const startY = (overlay as HTMLDivElement & { _startY?: number })._startY;
          if (startY !== undefined && touch.clientY > startY) {
            e.preventDefault();
          }
        }
        return;
      }

      e.preventDefault();
    };

    const handleTouchStart = (e: TouchEvent) => {
      (overlay as HTMLDivElement & { _startY?: number })._startY = e.touches[0].clientY;
    };

    overlay.addEventListener('touchstart', handleTouchStart, { passive: true });
    overlay.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      overlay.removeEventListener('touchstart', handleTouchStart);
      overlay.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  const [allProfiles, setAllProfiles] = useState<Record<string, StoredProfile>>({});

  useEffect(() => {
    if (isLoading || leaderboard.length === 0) return;

    const addresses = leaderboard.map((e) => normalizeAddress(e.address)).join(',');
    fetch(`/api/twitter-profiles?addresses=${encodeURIComponent(addresses)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.profiles) {
          const merged = { ...data.profiles };
          if (controllerUsername && userAddress) {
            const norm = normalizeAddress(userAddress);
            if (!merged[norm]) {
              merged[norm] = { username: controllerUsername, name: controllerUsername, profileImageUrl: '' };
            }
          }
          setAllProfiles(merged);
        }
      })
      .catch((err) => console.error('[Leaderboard] Failed to fetch profiles:', err));
  }, [isLoading, leaderboard, userAddress, controllerUsername]);

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isLoading) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const interval = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isLoading]);

  function getDisplayName(address: string): string {
    const norm = normalizeAddress(address);
    const profile = allProfiles[norm];
    if (profile?.username) return profile.username;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  return (
    <div
      ref={overlayRef}
      className="leaderboard-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="leaderboard-modal">
        {/* Header */}
        <div className="leaderboard-header">
          <div className="leaderboard-title-group">
            <h2 className="leaderboard-title">Leaderboard</h2>
            {!isLoading && !error && (
              <span className="leaderboard-subtitle">
                {leaderboard.length} winker{leaderboard.length !== 1 ? 's' : ''}
                {userRank !== null && (
                  <> &middot; Your rank: <strong>#{userRank}</strong></>
                )}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              className="leaderboard-refresh"
              onClick={() => refetch()}
              disabled={isLoading}
              aria-label="Refresh leaderboard"
              title="Refresh"
            >
              &#x21bb;
            </button>
            <button
              className="leaderboard-close"
              onClick={onClose}
              aria-label="Close leaderboard"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Column labels */}
        {!error && mode === 'ranked' && (
          <div className="leaderboard-columns">
            <span className="leaderboard-col-rank">Rank</span>
            <span className="leaderboard-col-user">User</span>
            <span className="leaderboard-col-blinks"># Blinks</span>
          </div>
        )}
        {mode === 'pvp' && (
          <div className="leaderboard-columns">
            <span className="leaderboard-col-rank">Rank</span>
            <span className="leaderboard-col-user">User</span>
            <span className="leaderboard-col-blinks">$ Won</span>
            <span className="leaderboard-col-action">Top Blinks</span>
          </div>
        )}

        {/* Content */}
        <div ref={bodyRef} className="leaderboard-body">
          {mode === 'pvp' ? (
            pvpLoading ? (
              <div className="leaderboard-loading">
                <div className="spinner" />
                <span className="leaderboard-loading-status">Loading PvP leaderboard...</span>
              </div>
            ) : pvpLeaderboard.length === 0 ? (
              <div className="leaderboard-empty">No PvP winners yet. Be the first!</div>
            ) : (
              pvpLeaderboard.map((entry, idx) => {
                const isMe = userAddress && entry.address === normalizeAddress(userAddress);
                const rankClass = idx < 3 ? `leaderboard-row--rank-${idx + 1}` : '';
                return (
                  <div
                    key={entry.address}
                    className={`leaderboard-row ${rankClass} ${isMe ? 'leaderboard-row--current' : ''}`}
                  >
                    <div className="leaderboard-cell-rank">
                      <span className="leaderboard-rank-number">{idx + 1}</span>
                    </div>
                    <div className="leaderboard-cell-user">
                      <span className="leaderboard-username">{entry.username}</span>
                    </div>
                    <div className="leaderboard-cell-blinks">
                      <span className="leaderboard-blink-count" style={{ color: '#22c55e' }}>${entry.earned}</span>
                    </div>
                    <div className="leaderboard-cell-action">
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#A6A4A7' }}>
                        {entry.topBlinks}
                      </span>
                    </div>
                  </div>
                );
              })
            )
          ) : (
            isLoading ? (
              <div className="leaderboard-loading">
                <div className="spinner" />
                <span className="leaderboard-loading-status">{loadingStatus}</span>
                <span className="leaderboard-loading-elapsed">{elapsed}s</span>
              </div>
            ) : error ? (
              <div className="leaderboard-error">
                <span>{error}</span>
                <button className="leaderboard-retry-btn" onClick={() => refetch()}>
                  Try again
                </button>
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="leaderboard-empty">No blinks recorded yet. Be the first!</div>
            ) : (
              (() => {
                const currentUserEntry = leaderboard.find((entry) => {
                  if (!userAddress) return false;
                  return normalizeAddress(entry.address) === normalizeAddress(userAddress);
                });

                const showPinned = !!currentUserEntry;

                return (
                  <>
                    {showPinned && currentUserEntry && (
                      <>
                        <LeaderboardRow
                          entry={currentUserEntry}
                          isCurrentUser={true}
                          displayName={getDisplayName(currentUserEntry.address)}
                        />
                        <div className="leaderboard-pinned-separator">
                          <span className="leaderboard-pinned-dots">&#8226;&#8226;&#8226;</span>
                        </div>
                      </>
                    )}

                    {leaderboard.map((entry) => {
                      const entryNorm = normalizeAddress(entry.address);
                      const isCurrentUser = !!userAddress && entryNorm === normalizeAddress(userAddress);

                      return (
                        <LeaderboardRow
                          key={entry.address}
                          entry={entry}
                          isCurrentUser={isCurrentUser}
                          displayName={getDisplayName(entry.address)}
                        />
                      );
                    })}
                  </>
                );
              })()
            )
          )}
        </div>
      </div>
    </div>
  );
}

function LeaderboardRow({
  entry,
  isCurrentUser,
  displayName,
}: {
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
  displayName: string;
}) {
  const rankClass = entry.rank <= 3 ? `leaderboard-row--rank-${entry.rank}` : '';

  return (
    <div
      className={`leaderboard-row ${rankClass} ${isCurrentUser ? 'leaderboard-row--current' : ''}`}
    >
      <div className="leaderboard-cell-rank">
        <span className="leaderboard-rank-number">{entry.rank}</span>
      </div>

      <div className="leaderboard-cell-user">
        <span className="leaderboard-username">{displayName}</span>
      </div>

      <div className="leaderboard-cell-blinks">
        <span className="leaderboard-blink-count">{entry.blinks.toLocaleString()}</span>
        <span className="leaderboard-blink-label">blinks</span>
      </div>
    </div>
  );
}
