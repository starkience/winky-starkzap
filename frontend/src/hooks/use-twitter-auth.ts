'use client';

/**
 * Hook to manage Twitter authentication state.
 *
 * After OAuth, the callback stores the profile in a cookie.
 * This hook reads the cookie on mount (even before wallet reconnects),
 * persists the data in localStorage, and provides connect/disconnect methods.
 *
 * Twitter auth is optional; it lets users see their rank in the leaderboard.
 */

import { useState, useEffect, useCallback } from 'react';

export interface TwitterProfile {
  id: string;
  username: string;
  name: string;
  profileImageUrl: string;
  wallet: string;
}

const STORAGE_KEY_PREFIX = 'winky_twitter_';
const STORAGE_KEY_CURRENT = 'winky_twitter_current';
const STORAGE_VERSION_KEY = 'winky_twitter_version';
const CURRENT_VERSION = '2'; // bump to invalidate cached profiles with broken image URLs

/** Fix any cached profile image URLs that used invalid variants.
 *  Removes _200x200, _400x400, _normal suffixes to get the original full-size image. */
function fixProfileImageUrl(profile: TwitterProfile): TwitterProfile {
  if (!profile.profileImageUrl) return profile;
  let url = profile.profileImageUrl;
  url = url.replace('_200x200', '');
  url = url.replace('_400x400', '');
  // Don't double-strip if already fixed
  if (url.includes('_normal')) {
    url = url.replace('_normal', '');
  }
  if (url !== profile.profileImageUrl) {
    return { ...profile, profileImageUrl: url };
  }
  return profile;
}

function getStorageKey(wallet: string): string {
  return `${STORAGE_KEY_PREFIX}${wallet.toLowerCase()}`;
}

/** Read a cookie value by name */
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Delete a cookie */
function deleteCookie(name: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

/**
 * Check if a Twitter profile exists (from cookie or localStorage)
 * without needing to instantiate the hook. Used for gating logic.
 */
export function hasTwitterProfile(): boolean {
  if (typeof window === 'undefined') return false;

  // Check cookie first (just returned from OAuth)
  const cookieData = getCookie('twitter_profile');
  if (cookieData) return true;

  // Check generic "current" key
  const current = localStorage.getItem(STORAGE_KEY_CURRENT);
  if (current) return true;

  return false;
}

export function useTwitterAuth(walletAddress?: string) {
  const [profile, setProfile] = useState<TwitterProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: process cookie first (fresh from OAuth), then localStorage
  useEffect(() => {
    // 0. Check storage version - clear stale data if format changed
    if (typeof window !== 'undefined') {
      const storedVersion = localStorage.getItem(STORAGE_VERSION_KEY);
      if (storedVersion !== CURRENT_VERSION) {
        // Clear all winky_twitter_ keys
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('winky_twitter_')) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
        localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_VERSION);
      }
    }

    // Helper: sync profile to server so other users see it in the leaderboard
    const syncToServer = (p: TwitterProfile, retries = 2) => {
      const addr = p.wallet || walletAddress;
      if (!addr) {
        console.warn('[TwitterAuth] syncToServer: no address available, skipping');
        return;
      }
      const doSync = (attempt: number) => {
        fetch('/api/twitter-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: addr,
            username: p.username,
            name: p.name,
            profileImageUrl: p.profileImageUrl,
          }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            console.log(`[TwitterAuth] synced @${p.username} for ${addr} to server`);
          })
          .catch((err) => {
            console.warn(`[TwitterAuth] syncToServer attempt ${attempt} failed:`, err);
            if (attempt < retries) {
              setTimeout(() => doSync(attempt + 1), 2000 * attempt);
            }
          });
      };
      doSync(1);
    };

    // 1. Check if we just came back from OAuth (cookie set by callback)
    const cookieData = getCookie('twitter_profile');
    if (cookieData) {
      try {
        const parsed: TwitterProfile = fixProfileImageUrl(JSON.parse(cookieData));

        // Store as generic "current" for immediate access
        localStorage.setItem(STORAGE_KEY_CURRENT, JSON.stringify(parsed));

        // Also store keyed by the wallet from the cookie data
        if (parsed.wallet) {
          localStorage.setItem(getStorageKey(parsed.wallet), JSON.stringify(parsed));
        }

        setProfile(parsed);
        deleteCookie('twitter_profile');
        syncToServer(parsed);
        setIsLoading(false);
        return;
      } catch {
        deleteCookie('twitter_profile');
      }
    }

    // 2. Check localStorage by wallet address (if available)
    if (walletAddress) {
      try {
        const stored = localStorage.getItem(getStorageKey(walletAddress));
        if (stored) {
          const parsed = fixProfileImageUrl(JSON.parse(stored));
          // Re-save with fixed URL and update the "current" key
          const fixed = JSON.stringify(parsed);
          localStorage.setItem(getStorageKey(walletAddress), fixed);
          localStorage.setItem(STORAGE_KEY_CURRENT, fixed);
          setProfile(parsed);
          syncToServer(parsed);
          setIsLoading(false);
          return;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // 3. Fallback: check generic "current" key (wallet might not have reconnected yet)
    try {
      const current = localStorage.getItem(STORAGE_KEY_CURRENT);
      if (current) {
        const parsed = fixProfileImageUrl(JSON.parse(current));
        localStorage.setItem(STORAGE_KEY_CURRENT, JSON.stringify(parsed));
        setProfile(parsed);
        syncToServer(parsed);
        setIsLoading(false);
        return;
      }
    } catch {
      // Ignore
    }

    setIsLoading(false);
  }, [walletAddress]);

  /** Redirect to Twitter OAuth flow */
  const connect = useCallback(() => {
    if (!walletAddress) return;
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || window.location.origin).trim();
    window.location.href = `${appUrl}/api/auth/twitter?wallet=${encodeURIComponent(walletAddress)}`;
  }, [walletAddress]);

  /** Remove stored Twitter profile */
  const disconnect = useCallback(() => {
    if (walletAddress) {
      localStorage.removeItem(getStorageKey(walletAddress));
    }
    localStorage.removeItem(STORAGE_KEY_CURRENT);
    deleteCookie('twitter_profile');
    setProfile(null);
  }, [walletAddress]);

  return {
    profile,
    isConnected: !!profile,
    isLoading,
    connect,
    disconnect,
  };
}
