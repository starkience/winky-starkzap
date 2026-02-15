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

import { useState, useEffect } from 'react';
import { useLeaderboard, LeaderboardEntry } from '@/hooks/use-leaderboard';
import { TwitterProfile } from '@/hooks/use-twitter-auth';
import { generateBlinkCard } from '@/lib/generate-blink-card';

interface LeaderboardModalProps {
  userAddress?: string;
  twitterProfile?: TwitterProfile | null;
  onTwitterConnect?: () => void;
  onClose: () => void;
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

export function LeaderboardModal({ userAddress, twitterProfile, onTwitterConnect, onClose }: LeaderboardModalProps) {
  const { leaderboard, isLoading, loadingStatus, error, userRank, refetch } = useLeaderboard(userAddress);

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
        }
      })
      .catch((err) => console.error('[Leaderboard] Failed to fetch Twitter profiles:', err));
  }, [isLoading, leaderboard]);

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
            {twitterProfile ? (
              <div
                className="leaderboard-twitter-btn leaderboard-twitter-btn--connected"
                style={{ cursor: 'default' }}
              >
                <img
                  src={twitterProfile.profileImageUrl}
                  alt=""
                  className="leaderboard-twitter-btn-avatar"
                />
                @{twitterProfile.username}
              </div>
            ) : onTwitterConnect ? (
              <button
                className="leaderboard-twitter-btn"
                onClick={onTwitterConnect}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                Connect
              </button>
            ) : null}
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
        {!error && (
          <div className="leaderboard-columns">
            <span className="leaderboard-col-rank">Rank</span>
            <span className="leaderboard-col-avatar"></span>
            <span className="leaderboard-col-user">User</span>
            <span className="leaderboard-col-blinks"># Blinks</span>
            <span className="leaderboard-col-action"></span>
          </div>
        )}

        {/* Content */}
        <div className="leaderboard-body">
          {isLoading ? (
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
              // Find the current user's entry
              const currentUserEntry = leaderboard.find((entry) => {
                const entryNorm = normalizeAddress(entry.address);
                const matchByAddress =
                  !!userAddress && entryNorm === normalizeAddress(userAddress);
                const matchByTwitterWallet =
                  !!twitterProfile?.wallet && entryNorm === normalizeAddress(twitterProfile.wallet);
                return matchByAddress || matchByTwitterWallet;
              });

              // Pin the current user above #1 if they're not in the top 3
              const showPinned = currentUserEntry && currentUserEntry.rank > 3;

              return (
                <>
                  {/* Pinned current user row */}
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

                  {/* Full leaderboard */}
                  {leaderboard.map((entry) => {
                    const entryNorm = normalizeAddress(entry.address);
                    const matchByAddress =
                      !!userAddress && entryNorm === normalizeAddress(userAddress);
                    const matchByTwitterWallet =
                      !!twitterProfile?.wallet && entryNorm === normalizeAddress(twitterProfile.wallet);
                    const isCurrentUser = matchByAddress || matchByTwitterWallet;

                    // For the current user, prefer the client-side twitterProfile (freshest).
                    // For other users, use the server-side stored profile.
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
