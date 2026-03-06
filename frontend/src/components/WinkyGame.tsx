'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { StarkSDK, OnboardStrategy } from 'starkzap';
import type { WalletInterface } from 'starkzap';
import { useBlinkDetection } from '@/hooks/use-blink-detection';
import { useWinkyContract } from '@/hooks/use-winky-contract';
import { useEscrow } from '@/hooks/use-escrow';
import { GAME_CONFIG, NETWORK, API_URL, STORAGE_KEYS, VOYAGER_TX_URL, ESCROW_CONTRACT_ADDRESS } from '@/lib/constants';
import { BlinkChart } from '@/components/BlinkChart';

interface PendingChallenge {
  id: string;
  challengerUsername: string;
  challengerAddress: string;
  targetUsername: string;
  stake: number;
  createdAt: number;
}

// ─── Types & Constants ───

type GamePhase = 'idle' | 'ready' | 'countdown' | 'playing' | 'result';

const BET_AMOUNTS = [1, 5, 10, 25, 50];
const GAME_DURATION = 30;

interface LeaderboardEntry {
  id: string;
  name: string;
  blinks: number;
  earnings: number;
  twitter?: string;
}

const INITIAL_LEADERBOARD: LeaderboardEntry[] = [
  { id: '1', name: '@BlinkMaster', blinks: 87, earnings: 150, twitter: 'BlinkMaster' },
  { id: '2', name: '@EyeStorm', blinks: 72, earnings: 95, twitter: 'EyeStorm' },
  { id: '3', name: '@CryptoWinker', blinks: 65, earnings: 80, twitter: 'CryptoWinker' },
  { id: '4', name: '@WinkKing', blinks: 58, earnings: 60, twitter: 'WinkKing' },
  { id: '5', name: '@StarkBlinker', blinks: 45, earnings: 35, twitter: 'StarkBlinker' },
  { id: '6', name: '@NeonWink', blinks: 41, earnings: 25, twitter: 'NeonWink' },
  { id: '7', name: '@BlinkQueen', blinks: 38, earnings: 20, twitter: 'BlinkQueen' },
  { id: '8', name: '@DuelChamp', blinks: 33, earnings: 15, twitter: 'DuelChamp' },
];

interface BlinkerCard {
  id: string;
  twitter: string;
  blinks: number;
  stake: number;
  profileImage?: string;
}

const SAMPLE_BLINKERS: BlinkerCard[] = [
  { id: 'b1', twitter: 'BlinkMaster', blinks: 87, stake: 50, profileImage: 'https://pbs.twimg.com/profile_images/1683325380441128960/yRsRRjGO_400x400.jpg' },
  { id: 'b2', twitter: 'EyeStorm', blinks: 72, stake: 25, profileImage: 'https://pbs.twimg.com/profile_images/1780044069882368000/NwsmQIr5_400x400.jpg' },
  { id: 'b3', twitter: 'CryptoWinker', blinks: 65, stake: 50, profileImage: 'https://pbs.twimg.com/profile_images/1760101604832280576/JbwBO1xd_400x400.jpg' },
  { id: 'b4', twitter: 'WinkKing', blinks: 58, stake: 10, profileImage: 'https://pbs.twimg.com/profile_images/1590968738642079744/dG3MlRz6_400x400.jpg' },
  { id: 'b5', twitter: 'StarkBlinker', blinks: 45, stake: 5, profileImage: 'https://pbs.twimg.com/profile_images/1696931646816247808/eJgo1IN3_400x400.jpg' },
  { id: 'b6', twitter: 'NeonWink', blinks: 41, stake: 25, profileImage: 'https://pbs.twimg.com/profile_images/1657463800311214080/pruVMU9d_400x400.jpg' },
];

function formatAddress(addr: string | null | undefined): string {
  if (!addr) return '';
  if (!addr.startsWith('0x')) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ─── Component ───

export function WinkyGame() {
  const { ready, authenticated, user, login, logout } = usePrivy();

  // Wallet state (Starkzap SDK)
  const [sdkWallet, setSdkWallet] = useState<WalletInterface | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const setupAttemptedRef = useRef(false);

  // Game state
  const [gamePhase, setGamePhase] = useState<GamePhase>('idle');
  const [selectedBet, setSelectedBet] = useState<number>(5);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [chartData, setChartData] = useState<Array<{ time: number; blinks: number }>>([]);
  const [countdownNumber, setCountdownNumber] = useState(3);
  const [finalScore, setFinalScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState<number | null>(null);
  const [opponentRevealed, setOpponentRevealed] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(INITIAL_LEADERBOARD);

  // UI state
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const blinkCountRef = useRef(0);
  const gameStartTimeRef = useRef(0);
  const leaderboardUpdatedRef = useRef(false);

  // On-chain escrow
  const {
    createDuel,
    getUsdcBalance,
    isCreating: isDuelCreating,
    lastTx: duelTx,
    escrowError,
    clearEscrowError,
  } = useEscrow({ wallet: sdkWallet, walletAddress });

  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [duelTxHash, setDuelTxHash] = useState<string | null>(null);

  // Twitter profile from Privy
  const twitterProfile = user?.twitter ?? null;
  const twitterUsername = twitterProfile?.username ?? null;

  // Challenge state
  const [challengeTarget, setChallengeTarget] = useState('');
  const [isSendingChallenge, setIsSendingChallenge] = useState(false);
  const [challengeSent, setChallengeSent] = useState<string | null>(null);
  const [pendingChallenges, setPendingChallenges] = useState<PendingChallenge[]>([]);
  const [blinkerSearch, setBlinkerSearch] = useState('');

  // On-chain blink counter (1 blink = 1 Starknet tx)
  const {
    recordBlink,
    txLog: blinkTxLog,
    clearLog: clearBlinkLog,
    pendingCount: blinkPendingCount,
  } = useWinkyContract({
    wallet: sdkWallet,
    walletAddress,
    isAuthenticated: ready && authenticated,
  });

  const isConnected = ready && authenticated && !!sdkWallet;
  const isPlaying = gamePhase === 'playing';
  const showGameArea = gamePhase === 'ready' || gamePhase === 'countdown' || gamePhase === 'playing';

  // Fetch USDC balance when wallet connects
  useEffect(() => {
    if (!isConnected || !walletAddress) return;
    getUsdcBalance().then(setUsdcBalance);
  }, [isConnected, walletAddress, getUsdcBalance]);

  // Insufficient USDC flag (shown inline next to Play button)
  const [needsFunding, setNeedsFunding] = useState(false);

  // Surface escrow errors
  useEffect(() => {
    if (escrowError) {
      if (escrowError === 'INSUFFICIENT_USDC') {
        setNeedsFunding(true);
      } else {
        setError(escrowError);
      }
      clearEscrowError();
    }
  }, [escrowError, clearEscrowError]);

  // ─── Poll for incoming challenges ───
  useEffect(() => {
    if (!twitterUsername) return;

    const fetchChallenges = async () => {
      try {
        const res = await fetch(`/api/challenge?username=${encodeURIComponent(twitterUsername)}`);
        const data = await res.json();
        if (data.challenges?.length > 0) {
          setPendingChallenges(data.challenges);
        }
      } catch {}
    };

    fetchChallenges();
    const interval = setInterval(fetchChallenges, 10_000);
    return () => clearInterval(interval);
  }, [twitterUsername]);

  // ─── Subscribe to Pusher for real-time challenges ───
  useEffect(() => {
    if (!twitterUsername) return;
    const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'eu';
    if (!pusherKey) return;

    let pusher: any;
    let channel: any;

    import('pusher-js').then((PusherModule) => {
      const PusherClass = PusherModule.default;
      pusher = new PusherClass(pusherKey, { cluster: pusherCluster });
      channel = pusher.subscribe(`challenges-${twitterUsername.toLowerCase()}`);
      channel.bind('new-challenge', (data: PendingChallenge) => {
        setPendingChallenges(prev => {
          if (prev.some(c => c.id === data.id)) return prev;
          return [data, ...prev];
        });
      });
    });

    return () => {
      if (channel) channel.unbind_all();
      if (pusher) {
        pusher.unsubscribe(`challenges-${twitterUsername.toLowerCase()}`);
        pusher.disconnect();
      }
    };
  }, [twitterUsername]);

  // ─── Send challenge handler ───
  const handleSendChallenge = useCallback(async () => {
    if (!twitterUsername || !challengeTarget.trim()) return;
    setIsSendingChallenge(true);
    setChallengeSent(null);
    try {
      const target = challengeTarget.trim().replace(/^@/, '');
      const res = await fetch('/api/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengerUsername: twitterUsername,
          challengerAddress: walletAddress || '',
          targetUsername: target,
          stake: selectedBet,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      setChallengeSent(target);
      setChallengeTarget('');
      setTimeout(() => setChallengeSent(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to send challenge');
    } finally {
      setIsSendingChallenge(false);
    }
  }, [twitterUsername, challengeTarget, walletAddress, selectedBet]);

  const handleDismissChallenge = useCallback((id: string) => {
    setPendingChallenges(prev => prev.filter(c => c.id !== id));
  }, []);

  // ─── Mobile detection ───
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768 || ('ontouchstart' in window && window.innerWidth <= 1024));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // ─── Wallet setup via Starkzap SDK ───
  useEffect(() => {
    if (!ready || !authenticated || !user?.id) return;
    if (sdkWallet) return;
    if (setupAttemptedRef.current || walletLoading) return;
    setupAttemptedRef.current = true;

    const setupWallet = async () => {
      setWalletLoading(true);
      try {
        const storedUser = window.localStorage.getItem(STORAGE_KEYS.userId);
        if (storedUser && storedUser !== user.id) {
          window.localStorage.removeItem(STORAGE_KEYS.walletId);
          window.localStorage.removeItem(STORAGE_KEYS.walletAddress);
          window.localStorage.removeItem(STORAGE_KEYS.publicKey);
        }
        window.localStorage.setItem(STORAGE_KEYS.userId, user.id);

        let wId = window.localStorage.getItem(STORAGE_KEYS.walletId);
        let wPk = window.localStorage.getItem(STORAGE_KEYS.publicKey);

        if (!wId || !wPk) {
          const resp = await fetch(`${API_URL}/api/wallet/starknet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(data?.error || 'Create wallet failed');
          const w = data.wallet || {};
          wId = w.id || null;
          wPk = w.publicKey || w.public_key || null;
          if (wId) window.localStorage.setItem(STORAGE_KEYS.walletId, wId);
          if (wPk) window.localStorage.setItem(STORAGE_KEYS.publicKey, wPk);
        }

        if (!wId || !wPk) throw new Error('Failed to get wallet credentials');

        const sdk = new StarkSDK({
          network: NETWORK === 'mainnet' ? 'mainnet' : 'sepolia',
          paymaster: { nodeUrl: `${API_URL}/api/paymaster` },
        });

        const { wallet } = await sdk.onboard({
          strategy: OnboardStrategy.Privy,
          deploy: 'if_needed',
          feeMode: 'sponsored',
          privy: {
            resolve: async () => ({
              walletId: wId!,
              publicKey: wPk!,
              serverUrl: `${API_URL}/api/wallet/sign`,
            }),
          },
        });

        const addr = wallet.address;
        setSdkWallet(wallet);
        setWalletAddress(addr);
        if (addr) window.localStorage.setItem(STORAGE_KEYS.walletAddress, addr);
      } catch (err: any) {
        console.error('[setupWallet] Error:', err.message);
        setError(err.message || 'Wallet setup failed');
      } finally {
        setWalletLoading(false);
      }
    };
    setupWallet();
  }, [ready, authenticated, user?.id, sdkWallet, walletLoading]);

  const handleLogin = useCallback(() => {
    login({ loginMethods: ['email', 'twitter'] });
  }, [login]);

  const handleLogout = useCallback(async () => {
    try {
      Object.values(STORAGE_KEYS).forEach(k => {
        try { window.localStorage.removeItem(k); } catch {}
      });
    } catch {}
    setSdkWallet(null);
    setWalletAddress(null);
    setupAttemptedRef.current = false;
    try { await logout(); } catch {}
  }, [logout]);

  // ─── Blink detection ───
  const gamePhaseRef = useRef<GamePhase>('idle');
  useEffect(() => { gamePhaseRef.current = gamePhase; }, [gamePhase]);

  const handleBlink = useCallback((count: number) => {
    if (gamePhaseRef.current === 'playing') {
      recordBlink(count);
    }
  }, [recordBlink]);

  const {
    videoRef,
    canvasRef,
    isReady: isDetectorReady,
    blinkCount,
    start: startDetection,
    reset: resetDetection,
  } = useBlinkDetection(handleBlink, {
    earThreshold: GAME_CONFIG.EAR_THRESHOLD,
    debounceMs: GAME_CONFIG.BLINK_DEBOUNCE_MS,
    enabled: isPlaying,
  });

  useEffect(() => { blinkCountRef.current = blinkCount; }, [blinkCount]);

  useEffect(() => {
    if (gamePhase === 'playing' && gameStartTimeRef.current > 0) {
      const elapsed = (Date.now() - gameStartTimeRef.current) / 1000;
      setChartData(prev => {
        const last = prev[prev.length - 1];
        if (last && Math.abs(last.time - elapsed) < 0.05) {
          return [...prev.slice(0, -1), { time: Math.round(elapsed * 10) / 10, blinks: blinkCount }];
        }
        return [...prev, { time: Math.round(elapsed * 10) / 10, blinks: blinkCount }];
      });
    }
  }, [blinkCount, gamePhase]);

  useEffect(() => {
    if (gamePhase === 'ready' && isDetectorReady && !cameraReady) {
      startDetection()
        .then(() => setCameraReady(true))
        .catch((err) => {
          console.error('Failed to start camera:', err);
          setError('Camera access required to play');
          setGamePhase('idle');
        });
    }
  }, [gamePhase, isDetectorReady, cameraReady, startDetection]);

  // ─── Game timer ───
  useEffect(() => {
    if (gamePhase !== 'playing') return;
    gameStartTimeRef.current = Date.now();
    setTimeLeft(GAME_DURATION);
    setChartData([{ time: 0, blinks: 0 }]);

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          if (chartIntervalRef.current) clearInterval(chartIntervalRef.current);
          const score = blinkCountRef.current;
          setFinalScore(score);
          setGamePhase('result');
          leaderboardUpdatedRef.current = false;
          setTimeout(() => {
            setOpponentScore(Math.floor(Math.random() * 40) + 20);
            setOpponentRevealed(true);
          }, 2000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    chartIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - gameStartTimeRef.current) / 1000;
      setChartData(prev => {
        const last = prev[prev.length - 1];
        if (last && Math.abs(last.time - elapsed) < 0.3) return prev;
        return [...prev, { time: Math.round(elapsed * 10) / 10, blinks: blinkCountRef.current }];
      });
    }, 500);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (chartIntervalRef.current) clearInterval(chartIntervalRef.current);
    };
  }, [gamePhase]);

  // ─── Leaderboard update after win ───
  useEffect(() => {
    if (!opponentRevealed || opponentScore === null || leaderboardUpdatedRef.current) return;
    if (finalScore <= opponentScore || !walletAddress) return;
    leaderboardUpdatedRef.current = true;
    const displayName = formatAddress(walletAddress);
    setLeaderboard(prev => {
      const existing = prev.find(e => e.name === displayName);
      if (existing) {
        return prev.map(e =>
          e.name === displayName
            ? { ...e, blinks: finalScore, earnings: Math.round((e.earnings + selectedBet * 2 * 0.95) * 100) / 100 }
            : e
        ).sort((a, b) => b.earnings - a.earnings);
      }
      return [
        { id: `user-${Date.now()}`, name: displayName, blinks: finalScore, earnings: Math.round(selectedBet * 2 * 0.95 * 100) / 100 },
        ...prev,
      ].sort((a, b) => b.earnings - a.earnings);
    });
  }, [opponentRevealed, opponentScore, finalScore, walletAddress, selectedBet]);

  // ─── Handlers ───
  const handlePlay = useCallback(async () => {
    if (!isConnected) return;
    resetDetection();
    blinkCountRef.current = 0;
    setChartData([]);
    setFinalScore(0);
    setOpponentScore(null);
    setOpponentRevealed(false);
    setError(null);
    setNeedsFunding(false);
    setDuelTxHash(null);
    clearBlinkLog();

    if (ESCROW_CONTRACT_ADDRESS) {
      const result = await createDuel(selectedBet);
      if (!result) return;
      setDuelTxHash(result.txHash);
      getUsdcBalance().then(setUsdcBalance);
    }

    setGamePhase('ready');
  }, [isConnected, resetDetection, createDuel, selectedBet, getUsdcBalance, clearBlinkLog]);

  const handleAcceptChallenge = useCallback((challenge: PendingChallenge) => {
    setPendingChallenges(prev => prev.filter(c => c.id !== challenge.id));
    setSelectedBet(challenge.stake);
    if (isConnected) {
      handlePlay();
    }
  }, [isConnected, handlePlay]);

  const handleStart = useCallback(() => {
    setGamePhase('countdown');
    setCountdownNumber(3);
    resetDetection();
    blinkCountRef.current = 0;
    setTimeout(() => setCountdownNumber(2), 1000);
    setTimeout(() => setCountdownNumber(1), 2000);
    setTimeout(() => setGamePhase('playing'), 3000);
  }, [resetDetection]);

  const handlePlayAgain = useCallback(() => {
    resetDetection();
    blinkCountRef.current = 0;
    setChartData([]);
    setFinalScore(0);
    setOpponentScore(null);
    setOpponentRevealed(false);
    setTimeLeft(GAME_DURATION);
    leaderboardUpdatedRef.current = false;
    clearBlinkLog();
    setGamePhase('idle');
  }, [resetDetection, clearBlinkLog]);

  const handleCopyAddress = useCallback(() => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [walletAddress]);

  const isWinner = opponentRevealed && opponentScore !== null && finalScore > opponentScore;
  const isDraw = opponentRevealed && opponentScore !== null && finalScore === opponentScore;
  const isLoser = opponentRevealed && opponentScore !== null && finalScore < opponentScore;
  const loginBusy = !ready || walletLoading;

  // ─── Sidebar content (shared across all phases) ───
  const sidebarContent = (
    <aside style={{
      width: isMobile ? '100%' : '320px',
      minWidth: isMobile ? undefined : '320px',
      display: 'flex',
      flexDirection: 'column',
      borderLeft: isMobile ? 'none' : '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(17,17,17,0.6)',
      backdropFilter: 'blur(20px)',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Brand */}
      <div style={{
        padding: '20px 20px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/logo.png" alt="Winky" width={44} height={44} style={{ objectFit: 'contain' }} />
          </div>
          {NETWORK === 'sepolia' && (
            <span style={{ fontSize: '9px', color: '#f59e0b', padding: '3px 8px', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', fontWeight: 700, background: 'rgba(245,158,11,0.08)', letterSpacing: '0.5px' }}>
              Testnet
            </span>
          )}
        </div>

        {/* Connect / Address */}
        {isConnected && walletAddress ? (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleCopyAddress}
              className="sidebar-wallet-btn"
              aria-label={copied ? 'Address copied' : 'Copy wallet address'}
            >
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', flexShrink: 0, boxShadow: '0 0 6px rgba(34,197,94,0.5)' }} aria-hidden="true" />
              <span style={{ fontFamily: "'SF Mono', Monaco, monospace", fontSize: '12px', letterSpacing: '0.3px' }}>
                {copied ? 'Copied!' : formatAddress(walletAddress)}
              </span>
            </button>
            <button
              onClick={handleLogout}
              className="sidebar-disconnect-btn"
              aria-label="Disconnect wallet"
            >
              &times;
            </button>
          </div>
        ) : (
          <button
            onClick={handleLogin}
            disabled={loginBusy}
            className={`sidebar-connect-btn${walletLoading ? ' sidebar-connect-btn--loading' : ''}`}
          >
            {walletLoading ? 'Setting Up\u2026' : !ready ? 'Loading\u2026' : 'Connect Wallet'}
          </button>
        )}
      </div>

      {/* Challenge (only when wallet connected + Twitter linked via Privy) */}
      {isConnected && twitterUsername && (
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#1d9bf0" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#1d9bf0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              @{twitterUsername}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={challengeTarget}
              onChange={(e) => setChallengeTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSendChallenge(); }}
              placeholder="@username"
              className="challenge-input"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              onClick={handleSendChallenge}
              disabled={isSendingChallenge || !challengeTarget.trim()}
              className="challenge-send-btn"
            >
              {isSendingChallenge ? '\u2026' : 'Challenge'}
            </button>
          </div>
          {challengeSent && (
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#22c55e', textAlign: 'center' }}>
              Challenge sent to @{challengeSent}!
            </span>
          )}
        </div>
      )}

      {/* Bet + Play */}
      <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: '10px', fontWeight: 800, color: '#555', textTransform: 'uppercase', letterSpacing: '2px', margin: 0 }}>
            Stake (USDC)
          </p>
          {isConnected && usdcBalance !== null && (
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#A6A4A7', fontVariantNumeric: 'tabular-nums' }}>
              Balance: ${usdcBalance.toFixed(2)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {BET_AMOUNTS.map(amount => (
            <button
              key={amount}
              onClick={() => setSelectedBet(amount)}
              disabled={isDuelCreating || showGameArea}
              className={`sidebar-bet-btn${selectedBet === amount ? ' sidebar-bet-btn--active' : ''}`}
            >
              ${amount}
            </button>
          ))}
        </div>
        <button
          onClick={isConnected ? handlePlay : handleLogin}
          disabled={loginBusy || showGameArea || isDuelCreating}
          className={`sidebar-play-btn${isConnected && !showGameArea && !isDuelCreating ? ' sidebar-play-btn--active' : ''}`}
        >
          {isDuelCreating ? 'Depositing\u2026' : showGameArea ? 'In Game\u2026' : isConnected ? `Play ($${selectedBet})` : 'Connect to Play'}
        </button>
        {needsFunding && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 14px', background: 'rgba(250,204,21,0.06)',
            border: '1px solid rgba(250,204,21,0.18)', borderRadius: '10px',
          }}>
            <span style={{ fontSize: '16px', lineHeight: 1, flexShrink: 0 }}>&#9888;</span>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#facc15', lineHeight: 1.5 }}>
              Send USDC to your address to place bets
            </span>
            <button
              onClick={() => setNeedsFunding(false)}
              style={{ background: 'none', border: 'none', color: '#facc15', cursor: 'pointer', fontSize: '14px', fontWeight: 800, lineHeight: 1, marginLeft: 'auto', flexShrink: 0, opacity: 0.5 }}
              aria-label="Dismiss"
            >&times;</button>
          </div>
        )}
        {duelTx && (
          <a
            href={duelTx.voyagerUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '10px', fontWeight: 600, color: '#C0B4DA', textDecoration: 'none', textAlign: 'center' }}
          >
            Duel #{duelTx.duelId} created \u2197
          </a>
        )}
      </div>

      {/* Leaderboard */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} aria-label="Leaderboard">
        <div style={{
          padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 800, color: '#A6A4A7', textWrap: 'balance' }}>Leaderboard</span>
          <span style={{ fontSize: '9px', fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Blinks / Earned
          </span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {leaderboard.map((entry, idx) => (
            <div
              key={entry.id}
              className="sidebar-leaderboard-row"
              style={{
                background: idx === 0 ? 'rgba(255,215,0,0.04)' : idx === 1 ? 'rgba(192,192,192,0.03)' : idx === 2 ? 'rgba(205,127,50,0.03)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <span style={{
                  fontSize: '13px', fontWeight: 800, width: '24px', textAlign: 'center', flexShrink: 0,
                  color: idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : idx === 2 ? '#CD7F32' : '#444',
                }} aria-hidden="true">
                  {idx === 0 ? '\u{1F947}' : idx === 1 ? '\u{1F948}' : idx === 2 ? '\u{1F949}' : `${idx + 1}`}
                </span>
                {entry.twitter ? (
                  <a
                    href={`https://x.com/${entry.twitter}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: '12px', fontWeight: 600, color: '#A6A4A7',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      textDecoration: 'none', transition: 'color 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#1d9bf0'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#A6A4A7'; }}
                  >
                    {entry.name}
                  </a>
                ) : (
                  <span style={{
                    fontSize: '12px', fontWeight: 600, color: '#A6A4A7',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {entry.name}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#C0B4DA', fontVariantNumeric: 'tabular-nums' }}>
                  {entry.blinks}
                </span>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#22c55e', minWidth: '48px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  ${entry.earnings}
                </span>
              </div>
            </div>
          ))}
        </div>
      </nav>
    </aside>
  );

  // ─── Render ───
  return (
    <div style={{
      display: 'flex',
      width: '100%',
      height: '100vh',
      overflow: 'hidden',
      background: '#0A0A0A',
      fontFamily: "'Manrope', sans-serif",
      flexDirection: isMobile ? 'column' : 'row',
      touchAction: 'manipulation',
    }}>

      {/* ═══ MAIN AREA ═══ */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
      }}>

        {/* ─── Challenge notifications ─── */}
        {gamePhase === 'idle' && pendingChallenges.length > 0 && (
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {pendingChallenges.map(c => (
              <div key={c.id} className="challenge-banner">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '14px', fontWeight: 800, color: '#C0B4DA', margin: 0 }}>
                    @{c.challengerUsername} challenged you!
                  </p>
                  <p style={{ fontSize: '12px', fontWeight: 600, color: '#555', margin: '4px 0 0' }}>
                    ${c.stake} USDC &middot; 30s Blink Duel
                  </p>
                </div>
                <button
                  onClick={() => handleAcceptChallenge(c)}
                  className="challenge-accept-btn"
                >
                  Accept
                </button>
                <button
                  onClick={() => handleDismissChallenge(c.id)}
                  className="challenge-dismiss-btn"
                  aria-label="Dismiss challenge"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ─── IDLE: battle blinkers ─── */}
        {gamePhase === 'idle' && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            gap: '24px',
            padding: '36px 32px',
            overflowY: 'auto',
          }}>
            <div style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: '36px', fontWeight: 900, color: '#A6A4A7', margin: 0, lineHeight: 1.2 }}>
                Bet. Blink.<br />Winner wins it all.
              </h1>
            </div>

            {/* Header row: title + search */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              <p className="idle-section-title" style={{ margin: 0 }}>Battle these blinkers</p>
              <input
                type="text"
                value={blinkerSearch}
                onChange={(e) => setBlinkerSearch(e.target.value)}
                placeholder="Search @username\u2026"
                className="challenge-input"
                spellCheck={false}
                autoComplete="off"
                style={{ maxWidth: '220px', padding: '9px 14px', fontSize: '12px' }}
              />
            </div>

            {/* Blinker cards */}
            <div className="blinker-grid">
              {SAMPLE_BLINKERS
                .filter(b => !blinkerSearch || b.twitter.toLowerCase().includes(blinkerSearch.replace(/^@/, '').toLowerCase()))
                .map(b => (
                <div key={b.id} className="blinker-card" onClick={() => setChallengeTarget(b.twitter)}>
                  {b.profileImage ? (
                    <img src={b.profileImage} alt="" className="blinker-card-bg" />
                  ) : (
                    <div className="blinker-card-bg blinker-card-bg--placeholder" />
                  )}
                  <div className="blinker-card-overlay" />
                  <div className="blinker-card-content">
                    <span className="blinker-card-stat">Blinked {b.blinks} times</span>
                    <span className="blinker-card-stake">Take ${b.stake}</span>
                    <a
                      href={`https://x.com/${b.twitter}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="blinker-card-name"
                      onClick={(e) => e.stopPropagation()}
                    >
                      @{b.twitter}
                    </a>
                  </div>
                </div>
              ))}
              {blinkerSearch && SAMPLE_BLINKERS.filter(b => b.twitter.toLowerCase().includes(blinkerSearch.replace(/^@/, '').toLowerCase())).length === 0 && (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '32px 0' }}>
                  <p style={{ fontSize: '13px', fontWeight: 600, color: '#444', margin: 0 }}>
                    No blinkers found for &ldquo;{blinkerSearch}&rdquo;
                  </p>
                </div>
              )}
            </div>

            {challengeSent && (
              <p style={{ fontSize: '12px', fontWeight: 600, color: '#22c55e', textAlign: 'center', margin: 0 }}>
                Challenge sent to @{challengeSent}!
              </p>
            )}
          </div>
        )}

        {/* ─── GAME PHASES: top bar (webcam + stats) + bottom row (tx log + chart) ─── */}
        <div style={showGameArea ? {
          display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, position: 'relative',
        } : {
          position: 'fixed' as const, top: '-9999px', left: '-9999px',
          width: '1px', height: '1px', overflow: 'hidden', pointerEvents: 'none' as const,
        }}>
          {/* Top bar: webcam + stats/controls to the right */}
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '16px',
            padding: '12px 16px', flexShrink: 0,
          }}>
            {/* Webcam */}
            <div style={{
              position: 'relative', width: '176px', height: '132px',
              borderRadius: '10px', overflow: 'hidden',
              border: '2px solid rgba(255,255,255,0.1)', background: '#111',
              flexShrink: 0,
            }}>
              <video
                ref={(el) => { videoRef.current = el; }}
                autoPlay playsInline muted
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' }}
              />
              <canvas
                ref={(el) => { canvasRef.current = el; }}
                width={176} height={132}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }}
              />
              {gamePhase === 'ready' && !cameraReady && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 5 }}>
                  <div className="spinner" style={{ width: '24px', height: '24px' }} />
                </div>
              )}
            </div>

            {/* Stats / controls to the right of webcam */}
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '132px', gap: '10px' }}>
              {gamePhase === 'playing' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <span style={{ fontSize: '40px', fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: '#C0B4DA' }}>
                      {blinkCount}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#555', textTransform: 'uppercase', letterSpacing: '1.5px' }}>blinks</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{
                      fontSize: '22px', fontWeight: 900, fontVariantNumeric: 'tabular-nums',
                      color: timeLeft <= 5 ? '#ef4444' : timeLeft <= 10 ? '#f59e0b' : '#A6A4A7',
                      transition: 'color 0.3s',
                    }}>
                      0:{timeLeft.toString().padStart(2, '0')}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.08)' }} aria-hidden="true">|</span>
                    <span style={{ fontSize: '14px', fontWeight: 800, color: '#C0B4DA' }}>${selectedBet} USDC</span>
                    {duelTxHash && VOYAGER_TX_URL && (
                      <>
                        <span style={{ color: 'rgba(255,255,255,0.08)' }} aria-hidden="true">|</span>
                        <a
                          href={`${VOYAGER_TX_URL}/${duelTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tx-voyager-link"
                          aria-label="View duel transaction on Voyager"
                        >
                          Tx &#x2197;
                        </a>
                      </>
                    )}
                  </div>
                </div>
              )}
              {gamePhase === 'ready' && cameraReady && (
                <>
                  <button onClick={handleStart} className="game-start-btn">
                    START
                  </button>
                  <span style={{ fontSize: '13px', color: '#555', fontWeight: 600 }}>Press to begin your 30s duel</span>
                </>
              )}
              {gamePhase === 'ready' && !cameraReady && (
                <span style={{ fontSize: '14px', color: '#555', fontWeight: 600 }}>Starting camera&#x2026;</span>
              )}
              {gamePhase === 'countdown' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span style={{ fontSize: '64px', fontWeight: 900, color: '#C0B4DA', lineHeight: 1, textShadow: '0 0 30px rgba(192,180,218,0.4)', animation: 'pulse 1s ease-in-out infinite' }}>
                    {countdownNumber}
                  </span>
                  <span style={{ fontSize: '16px', color: '#666', fontWeight: 700 }}>Get ready&#x2026;</span>
                </div>
              )}
            </div>
          </div>

          {/* Bottom row: tx log (left, under webcam) + chart (right, fills space) */}
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* Tx log column (same width as webcam, only during playing) */}
            {gamePhase === 'playing' && (
              <div style={{
                width: '192px', minWidth: '192px', padding: '0 0 12px 12px', flexShrink: 0,
                display: 'flex', flexDirection: 'column',
              }}>
                <div style={{
                  flex: 1, borderRadius: '10px', background: '#111',
                  border: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex', flexDirection: 'column', overflow: 'hidden',
                  minHeight: 0,
                }}>
                  <div style={{
                    padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
                  }}>
                    <span style={{ fontSize: '9px', fontWeight: 800, color: '#A6A4A7', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      Transactions
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '8px', fontWeight: 700, color: '#22c55e' }}>
                      <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s ease-in-out infinite' }} />
                      LIVE
                    </div>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    {blinkTxLog.length === 0 && (
                      <div style={{ padding: '12px', textAlign: 'center', color: '#333', fontSize: '10px' }}>
                        {blinkPendingCount > 0 ? 'Sending\u2026' : 'Blink to record txs'}
                      </div>
                    )}
                    {[...blinkTxLog].reverse().map((tx, idx, arr) => {
                      const opacity = 0.25 + 0.75 * (idx / Math.max(arr.length - 1, 1));
                      const statusColor = tx.status === 'success' ? '#22c55e' : tx.status === 'pending' ? '#f59e0b' : tx.status === 'skipped' ? '#555' : '#ef4444';
                      return (
                        <div key={tx.id} style={{
                          padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.03)',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px',
                          opacity,
                        }}>
                          <div style={{ minWidth: 0, overflow: 'hidden' }}>
                            <span style={{ fontSize: '10px', fontWeight: 700, color: statusColor, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              Blink #{tx.blinkNumber}
                            </span>
                            <span style={{ fontSize: '9px', color: '#555', fontWeight: 600 }}>
                              {tx.status === 'pending' ? 'sending\u2026' : tx.status}
                            </span>
                          </div>
                          {VOYAGER_TX_URL && tx.hash && (
                            <a
                              href={`${VOYAGER_TX_URL}/${tx.hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="tx-voyager-link"
                              aria-label="View on Voyager"
                            >
                              &#x2197;
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Chart area */}
            <div style={{ flex: 1, position: 'relative', minWidth: 0, minHeight: 0 }}>
              {(gamePhase === 'playing' || chartData.length > 1) ? (
                <div style={{ position: 'absolute', inset: 0, padding: '0 8px 8px 0' }}>
                  {gamePhase === 'playing' && (
                    <div style={{
                      position: 'absolute', right: '20px', top: '8px', zIndex: 2,
                      display: 'flex', alignItems: 'center', gap: '6px',
                      fontSize: '10px', fontWeight: 700, color: '#ef4444',
                      textTransform: 'uppercase', letterSpacing: '1px',
                    }}>
                      LIVE
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s ease-in-out infinite' }} />
                    </div>
                  )}
                  <BlinkChart data={chartData} height={"100%"} />
                </div>
              ) : (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '100%', color: '#333', fontSize: '14px', fontWeight: 600,
                }}>
                  {gamePhase === 'ready' ? 'Chart will appear when you start' : ''}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── RESULT PHASE ─── */}
        {gamePhase === 'result' && (
          <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
            {/* Left column: tx log (bottom-up, fading) */}
            <div style={{
              width: '192px', minWidth: '192px', display: 'flex', flexDirection: 'column',
              padding: '12px 0 12px 12px', flexShrink: 0, overflow: 'hidden',
            }}>
              <div style={{
                flex: 1, borderRadius: '10px', background: '#111',
                border: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                minHeight: 0,
              }}>
                <div style={{
                  padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
                }}>
                  <span style={{ fontSize: '9px', fontWeight: 800, color: '#A6A4A7', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    Transactions
                  </span>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  {blinkTxLog.length === 0 && (
                    <div style={{ padding: '12px', textAlign: 'center', color: '#333', fontSize: '10px' }}>No transactions</div>
                  )}
                  {[...blinkTxLog].reverse().map((tx, idx, arr) => {
                    const opacity = 0.25 + 0.75 * (idx / Math.max(arr.length - 1, 1));
                    const statusColor = tx.status === 'success' ? '#22c55e' : tx.status === 'pending' ? '#f59e0b' : tx.status === 'skipped' ? '#555' : '#ef4444';
                    return (
                      <div key={tx.id} style={{
                        padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.03)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px',
                        opacity,
                      }}>
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, color: statusColor, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            Blink #{tx.blinkNumber}
                          </span>
                          <span style={{ fontSize: '9px', color: '#555', fontWeight: 600 }}>
                            {tx.status === 'pending' ? 'sending\u2026' : tx.status}
                          </span>
                        </div>
                        {VOYAGER_TX_URL && tx.hash && (
                          <a
                            href={`${VOYAGER_TX_URL}/${tx.hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tx-voyager-link"
                            aria-label="View on Voyager"
                          >
                            &#x2197;
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right area: result content */}
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '24px',
              padding: '32px', overflow: 'auto',
            }}>
              <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#A6A4A7', margin: 0, textWrap: 'balance' }}>
                Time&apos;s Up!
              </h2>
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <div style={{
                  padding: '24px 36px', background: '#141414', borderRadius: '14px',
                  border: '2px solid rgba(192,180,218,0.2)', textAlign: 'center', minWidth: '160px',
                }}>
                  <p style={{ fontSize: '10px', color: '#666', fontWeight: 800, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '2px' }}>Your Blinks</p>
                  <p style={{ fontSize: '48px', fontWeight: 900, color: '#C0B4DA', margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{finalScore}</p>
                </div>
                {opponentRevealed && opponentScore !== null && (
                  <div style={{
                    padding: '24px 36px', background: '#141414', borderRadius: '14px',
                    border: '2px solid rgba(255,255,255,0.06)', textAlign: 'center', minWidth: '160px',
                  }}>
                    <p style={{ fontSize: '10px', color: '#666', fontWeight: 800, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '2px' }}>Opponent</p>
                    <p style={{ fontSize: '48px', fontWeight: 900, color: '#A6A4A7', margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{opponentScore}</p>
                  </div>
                )}
              </div>
              {!opponentRevealed && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }} aria-live="polite">
                  <div className="spinner" aria-hidden="true" />
                  <p style={{ fontSize: '13px', color: '#555', fontWeight: 600, margin: 0 }}>Waiting for opponent&#x2026;</p>
                </div>
              )}
              {opponentRevealed && opponentScore !== null && (
                <div style={{
                  padding: '20px 32px', borderRadius: '14px', textAlign: 'center',
                  background: isWinner ? 'rgba(34,197,94,0.08)' : isDraw ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)',
                  border: `2px solid ${isWinner ? 'rgba(34,197,94,0.25)' : isDraw ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.25)'}`,
                }} aria-live="polite">
                  <p style={{ fontSize: '28px', fontWeight: 900, margin: 0, color: isWinner ? '#22c55e' : isDraw ? '#f59e0b' : '#ef4444' }}>
                    {isWinner ? 'You Win!' : isDraw ? 'Draw!' : 'You Lose'}
                  </p>
                  <p style={{ fontSize: '14px', fontWeight: 700, margin: '8px 0 0', color: isWinner ? '#22c55e' : isDraw ? '#f59e0b' : '#ef4444' }}>
                    {isWinner ? `+$${(selectedBet * 2 * 0.95).toFixed(2)} USDC` : isDraw ? 'Bet returned' : `\u2212$${selectedBet} USDC`}
                  </p>
                </div>
              )}
              {chartData.length > 1 && (
                <div style={{ width: '100%', maxWidth: '500px', background: '#111', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)', padding: '16px' }}>
                  <BlinkChart data={chartData} height={140} />
                </div>
              )}
              {duelTxHash && VOYAGER_TX_URL && (
                <a
                  href={`${VOYAGER_TX_URL}/${duelTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '12px', fontWeight: 600, color: '#C0B4DA', textDecoration: 'none' }}
                >
                  View duel on Voyager &#x2197;
                </a>
              )}
              <button onClick={handlePlayAgain} className="result-play-again-btn">
                Play Again
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ═══ SIDEBAR ═══ */}
      {sidebarContent}

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
            padding: '12px 20px', background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.25)', borderRadius: '12px',
            color: '#ef4444', fontSize: '13px', fontWeight: 600, zIndex: 100,
            fontFamily: "'Manrope', sans-serif", maxWidth: '90vw',
            display: 'flex', alignItems: 'center', gap: '12px',
            backdropFilter: 'blur(12px)',
          }}
        >
          {error}
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            style={{
              background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px', fontWeight: 800, lineHeight: 1,
            }}
          >&times;</button>
        </div>
      )}
    </div>
  );
}
