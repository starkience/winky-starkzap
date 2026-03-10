'use client';

/**
 * LeaderboardModal - Displays ranked users by on-chain blink count.
 *
 * Layout:
 *   [Avatar]  @twitter_username  |  # blinks  |  Rank  |  Blink-o-nator ID button
 *
 * The leaderboard is open to everyone. Twitter sign-in is optional and lets
 * users see their own position pinned above rank #1.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLeaderboard, LeaderboardEntry } from '@/hooks/use-leaderboard';
import { TwitterProfile } from '@/hooks/use-twitter-auth';
import { generateBlinkCard } from '@/lib/generate-blink-card';

interface LeaderboardModalProps {
  userAddress?: string;
  twitterProfile?: TwitterProfile | null;
  onClose: () => void;
  mode?: 'ranked' | 'pvp';
}

/** Normalize a Starknet address by stripping leading zeros after 0x, then lowercasing. */
function normalizeAddress(addr: string): string {
  return addr.replace(/^0x0*/i, '0x').toLowerCase();
}

/** Lightweight Twitter profile info fetched from the server for any user. */
interface StoredTwitterProfile {
  username: string;
  name: string;
  profileImageUrl: string;
}

interface PvPLeaderboardRow {
  address: string;
  username: string;
  earned: number;
  topBlinks: number;
  profileImage?: string;
}

export function LeaderboardModal({ userAddress, twitterProfile, onClose, mode = 'ranked' }: LeaderboardModalProps) {
  const { leaderboard, isLoading, loadingStatus, error, userRank, refetch } = useLeaderboard(userAddress);

  // PvP leaderboard data
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
            if (winner.profileImage && !existing.profileImage) existing.profileImage = winner.profileImage;
          } else {
            map.set(winNorm, {
              address: winNorm,
              username: winner.username || `${winNorm.slice(0, 6)}...${winNorm.slice(-4)}`,
              earned: c.payout || 0,
              topBlinks: winner.score || 0,
              profileImage: winner.profileImage,
            });
          }
        }
        const sorted = Array.from(map.values()).sort((a, b) => b.earned - a.earned);
        setPvpLeaderboard(sorted);

        // Fetch Twitter profiles for PvP leaderboard entries
        if (sorted.length > 0) {
          const addrs = sorted.map(e => e.address).join(',');
          fetch(`/api/twitter-profiles?addresses=${encodeURIComponent(addrs)}`)
            .then(r => r.json())
            .then(profileData => {
              if (profileData.profiles) {
                setPvpLeaderboard(prev => prev.map(entry => {
                  const profile = profileData.profiles[entry.address];
                  if (profile) {
                    return {
                      ...entry,
                      username: profile.username || entry.username,
                      profileImage: profile.profileImageUrl || entry.profileImage,
                    };
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

  // Prevent pull-to-refresh on mobile: block touchmove on the overlay unless
  // it originates inside the scrollable leaderboard-body AND that body can scroll.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const handleTouchMove = (e: TouchEvent) => {
      const body = bodyRef.current;
      if (!body) {
        // No scrollable body yet (loading) — block all pull gestures
        e.preventDefault();
        return;
      }

      // If the touch target is inside the scrollable body, let it scroll
      // UNLESS the body is already at the very top and the user is pulling down
      const target = e.target as Node;
      if (body.contains(target)) {
        if (body.scrollTop <= 0) {
          // At the very top — check direction
          const touch = e.touches[0];
          const startY = (overlay as HTMLDivElement & { _startY?: number })._startY;
          if (startY !== undefined && touch.clientY > startY) {
            // Pulling down from the top — block to prevent browser refresh
            e.preventDefault();
          }
        }
        // Otherwise allow normal scroll
        return;
      }

      // Touch is outside the body (e.g. on the header, overlay bg) — block it
      e.preventDefault();
    };

    const handleTouchStart = (e: TouchEvent) => {
      // Store the starting Y so we can detect pull-down direction
      (overlay as HTMLDivElement & { _startY?: number })._startY = e.touches[0].clientY;
    };

    overlay.addEventListener('touchstart', handleTouchStart, { passive: true });
    overlay.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      overlay.removeEventListener('touchstart', handleTouchStart);
      overlay.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  // Server-side Twitter profiles for ALL users (wallet → profile)
  const [allTwitterProfiles, setAllTwitterProfiles] = useState<Record<string, StoredTwitterProfile>>({});

  // Fetch all Twitter profiles once the leaderboard data is loaded
  useEffect(() => {
    if (isLoading || leaderboard.length === 0) return;

    const addresses = leaderboard.map((e) => normalizeAddress(e.address)).join(',');
    fetch(`/api/twitter-profiles?addresses=${encodeURIComponent(addresses)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.profiles) {
          setAllTwitterProfiles(data.profiles);

          // Safety net: if the current user has a Twitter profile client-side
          // but it's not on the server, sync it now
          if (twitterProfile && userAddress) {
            const norm = normalizeAddress(userAddress);
            if (!data.profiles[norm]) {
              console.log('[Leaderboard] Current user profile missing from server, syncing...');
              fetch('/api/twitter-profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  address: userAddress,
                  username: twitterProfile.username,
                  name: twitterProfile.name,
                  profileImageUrl: twitterProfile.profileImageUrl,
                }),
              }).catch(() => { /* non-fatal */ });
            }
          }
        }
      })
      .catch((err) => console.error('[Leaderboard] Failed to fetch Twitter profiles:', err));
  }, [isLoading, leaderboard, twitterProfile, userAddress]);

  // Elapsed timer while loading
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
            <span className="leaderboard-col-avatar"></span>
            <span className="leaderboard-col-user">User</span>
            <span className="leaderboard-col-blinks"># Blinks</span>
            <span className="leaderboard-col-action"></span>
          </div>
        )}
        {mode === 'pvp' && (
          <div className="leaderboard-columns">
            <span className="leaderboard-col-rank">Rank</span>
            <span className="leaderboard-col-avatar"></span>
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
                    <div className="leaderboard-cell-avatar">
                      {entry.profileImage ? (
                        <img src={entry.profileImage} alt={entry.username} className="leaderboard-avatar" />
                      ) : (
                        <div className="leaderboard-avatar-placeholder" />
                      )}
                    </div>
                    <div className="leaderboard-cell-user">
                      <a
                        href={`https://x.com/${entry.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="leaderboard-username leaderboard-username--link"
                      >
                        @{entry.username}
                      </a>
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
                  const entryNorm = normalizeAddress(entry.address);
                  const matchByAddress =
                    !!userAddress && entryNorm === normalizeAddress(userAddress);
                  const matchByTwitterWallet =
                    !!twitterProfile?.wallet && entryNorm === normalizeAddress(twitterProfile.wallet);
                  return matchByAddress || matchByTwitterWallet;
                });

                const showPinned = currentUserEntry && currentUserEntry.rank > 3;

                return (
                  <>
                    {showPinned && currentUserEntry && (
                      <>
                        <LeaderboardRow
                          key={`pinned-${currentUserEntry.address}`}
                          entry={currentUserEntry}
                          isCurrentUser={true}
                          twitterProfile={twitterProfile ?? null}
                          storedProfile={allTwitterProfiles[normalizeAddress(currentUserEntry.address)] ?? null}
                        />
                        <div className="leaderboard-pinned-separator">
                          <span className="leaderboard-pinned-dots">&#8226;&#8226;&#8226;</span>
                        </div>
                      </>
                    )}

                    {leaderboard.map((entry) => {
                      const entryNorm = normalizeAddress(entry.address);
                      const matchByAddress =
                        !!userAddress && entryNorm === normalizeAddress(userAddress);
                      const matchByTwitterWallet =
                        !!twitterProfile?.wallet && entryNorm === normalizeAddress(twitterProfile.wallet);
                      const isCurrentUser = matchByAddress || matchByTwitterWallet;

                      const storedProfile = allTwitterProfiles[entryNorm] ?? null;

                      return (
                        <LeaderboardRow
                          key={entry.address}
                          entry={entry}
                          isCurrentUser={isCurrentUser}
                          twitterProfile={isCurrentUser ? (twitterProfile ?? null) : null}
                          storedProfile={storedProfile}
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
  twitterProfile,
  storedProfile,
}: {
  entry: LeaderboardEntry;
  isCurrentUser: boolean;
  twitterProfile: TwitterProfile | null;
  storedProfile: StoredTwitterProfile | null;
}) {
  const [isGenerating, setIsGenerating] = useState(false);

  // Prefer client-side Twitter profile (current user), fall back to server-stored profile (any user)
  const effectiveTwitter = twitterProfile
    ? { username: twitterProfile.username, profileImageUrl: twitterProfile.profileImageUrl }
    : storedProfile
      ? { username: storedProfile.username, profileImageUrl: storedProfile.profileImageUrl }
      : null;

  const displayName = effectiveTwitter
    ? `@${effectiveTwitter.username}`
    : entry.username || `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}`;
  const avatarUrl = effectiveTwitter?.profileImageUrl;

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const blob = await generateBlinkCard(entry.blinks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `winky-${entry.blinks}-blinks.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Leaderboard] Failed to generate blink card:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const rankClass = entry.rank <= 3 ? `leaderboard-row--rank-${entry.rank}` : '';

  return (
    <div
      className={`leaderboard-row ${rankClass} ${isCurrentUser ? 'leaderboard-row--current' : ''}`}
    >
      {/* Rank */}
      <div className="leaderboard-cell-rank">
        <span className="leaderboard-rank-number">{entry.rank}</span>
      </div>

      {/* Avatar */}
      <div className="leaderboard-cell-avatar">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayName}
            className="leaderboard-avatar"
          />
        ) : (
          <div className="leaderboard-avatar-placeholder" />
        )}
      </div>

      {/* Username */}
      <div className="leaderboard-cell-user">
        {effectiveTwitter ? (
          <a
            href={`https://x.com/${effectiveTwitter.username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="leaderboard-username leaderboard-username--link"
          >
            {displayName}
          </a>
        ) : (
          <span className="leaderboard-username">{displayName}</span>
        )}
      </div>

      {/* Blink count */}
      <div className="leaderboard-cell-blinks">
        <span className="leaderboard-blink-count">{entry.blinks.toLocaleString()}</span>
        <span className="leaderboard-blink-label">blinks</span>
      </div>

      {/* Blink-o-nator ID button - only for the current user's row */}
      <div className="leaderboard-cell-action">
        {isCurrentUser && (
          <button
            className="leaderboard-generate-btn"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              'Generating...'
            ) : (
              <>
                Blink-o-nator ID
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
