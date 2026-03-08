'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { StarkSDK, OnboardStrategy } from 'starkzap';
import type { WalletInterface } from 'starkzap';
import { useBlinkDetection } from '@/hooks/use-blink-detection';
import { useWinkyContract } from '@/hooks/use-winky-contract';
import { useEscrow } from '@/hooks/use-escrow';
import { GAME_CONFIG, NETWORK, API_URL, STORAGE_KEYS, VOYAGER_TX_URL, ESCROW_CONTRACT_ADDRESS, TOKENS, USDC_DECIMALS } from '@/lib/constants';
import { BlinkChart } from '@/components/BlinkChart';

// ─── Types & Constants ───

type GamePhase = 'idle' | 'ready' | 'countdown' | 'playing' | 'result';
type GameMode = 'create' | 'challenge';

const BET_AMOUNTS = [1, 5, 10, 25, 50];
const GAME_DURATION = 30;

interface OpenChallenge {
  id: string;
  duelId: number;
  playerAddress: string;
  username: string;
  profileImage?: string;
  score: number;
  stake: number;
  createdAt: number;
}

interface CompletedChallenge {
  duelId: number;
  player1: { address: string; username: string; profileImage?: string; score: number };
  player2: { address: string; username: string; profileImage?: string; score: number };
  winnerAddress: string;
  isDraw: boolean;
  payout: number;
  completedAt: number;
}

function formatAddress(addr: string | null | undefined): string {
  if (!addr) return '';
  if (!addr.startsWith('0x')) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Strip Twitter's _normal / _200x200 / _400x400 suffix to get the original full-size image. */
function fullSizeTwitterImage(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace(/_(?:normal|200x200|400x400|bigger|mini)(?=\.)/, '');
}

// ─── Component ───

export function WinkyGame() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();

  // Wallet state (Starkzap SDK)
  const [sdkWallet, setSdkWallet] = useState<WalletInterface | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const setupAttemptedRef = useRef(false);

  // Game state
  const [gamePhase, setGamePhase] = useState<GamePhase>('idle');
  const [gameMode, setGameMode] = useState<GameMode>('create');
  const [challengeTarget, setChallengeTarget] = useState<OpenChallenge | null>(null);
  const [selectedBet, setSelectedBet] = useState<number>(5);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [chartData, setChartData] = useState<Array<{ time: number; blinks: number }>>([]);
  const [countdownNumber, setCountdownNumber] = useState(3);
  const [finalScore, setFinalScore] = useState(0);
  const [resolving, setResolving] = useState(false);

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

  // On-chain escrow
  const {
    createDuel,
    joinDuel,
    getUsdcBalance,
    isCreating: isDuelCreating,
    isJoining: isDuelJoining,
    lastTx: duelTx,
    escrowError,
    clearEscrowError,
  } = useEscrow({ wallet: sdkWallet, walletAddress });

  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [duelTxHash, setDuelTxHash] = useState<string | null>(null);

  // Twitter profile from Privy
  const twitterProfile = user?.twitter ?? null;
  const twitterUsername = twitterProfile?.username ?? null;

  // Challenges directory (loaded from API)
  const [openChallenges, setOpenChallenges] = useState<OpenChallenge[]>([]);
  const [completedChallenges, setCompletedChallenges] = useState<CompletedChallenge[]>([]);
  const [blinkerSearch, setBlinkerSearch] = useState('');
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null);

  // Withdraw modal state
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawRecipient, setWithdrawRecipient] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawTxHash, setWithdrawTxHash] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

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

  const [loggingOut, setLoggingOut] = useState(false);
  const isConnected = ready && authenticated && !!sdkWallet && !loggingOut;
  const isPlaying = gamePhase === 'playing';
  const showGameArea = gamePhase === 'ready' || gamePhase === 'countdown' || gamePhase === 'playing';
  const isBusy = isDuelCreating || isDuelJoining;

  // Sidebar leaderboard built from completed challenges
  interface LeaderboardRow { address: string; username: string; earned: number; topBlinks: number }
  const sidebarLeaderboard = (() => {
    const map = new Map<string, LeaderboardRow>();
    for (const c of completedChallenges) {
      if (c.isDraw) continue;
      const winNorm = c.winnerAddress.replace(/^0x0*/i, '0x').toLowerCase();
      const winner = c.player1.address.replace(/^0x0*/i, '0x').toLowerCase() === winNorm ? c.player1 : c.player2;
      const existing = map.get(winNorm);
      if (existing) {
        existing.earned += c.payout;
        if (winner.score > existing.topBlinks) existing.topBlinks = winner.score;
      } else {
        map.set(winNorm, { address: winNorm, username: winner.username, earned: c.payout, topBlinks: winner.score });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.earned - a.earned).slice(0, 10);
  })();

  // Fetch USDC balance when wallet connects + poll every 15s
  useEffect(() => {
    if (!isConnected || !walletAddress) return;
    getUsdcBalance().then(setUsdcBalance);
    const interval = setInterval(() => {
      getUsdcBalance().then(setUsdcBalance);
    }, 15_000);
    return () => clearInterval(interval);
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

  // ─── Fetch open + completed challenges for the directory ───
  const fetchOpenChallenges = useCallback(async () => {
    try {
      const res = await fetch('/api/challenge');
      const data = await res.json();
      if (data.challenges) setOpenChallenges(data.challenges);
      if (data.completed) setCompletedChallenges(data.completed);
    } catch {}
  }, []);

  useEffect(() => {
    fetchOpenChallenges();
    const interval = setInterval(fetchOpenChallenges, 10_000);
    return () => clearInterval(interval);
  }, [fetchOpenChallenges]);

  // ─── Recover abandoned challenges (user refreshed mid-game → score 0 → they lose) ───
  useEffect(() => {
    try {
      const raw = localStorage.getItem('winky_active_challenge');
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved?.duelId || !saved?.opponentAddress) return;

      const abandonScore = saved.lastScore ?? 0;
      const opponentScore = saved.opponentScore ?? 0;
      const isDraw = abandonScore === opponentScore;
      const challengerWins = abandonScore > opponentScore;
      const winnerAddress = isDraw
        ? '0x0'
        : challengerWins
          ? saved.challengerAddress
          : saved.opponentAddress;

      console.log(`[recover] Abandoned challenge duel #${saved.duelId}, score ${abandonScore} vs ${opponentScore}`);

      fetch('/api/challenge/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duelId: saved.duelId,
          winnerAddress,
          isDraw,
        }),
      })
        .then((res) => res.json())
        .then(() =>
          fetch('/api/challenge', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              duelId: saved.duelId,
              winnerAddress,
              isDraw,
              challenger: {
                address: saved.challengerAddress,
                username: saved.challengerUsername,
                profileImage: saved.challengerProfileImage,
                score: abandonScore,
              },
            }),
          }),
        )
        .then(() => {
          console.log('[recover] Abandoned duel resolved.');
          fetchOpenChallenges();
        })
        .catch((err) => console.error('[recover] Failed to resolve abandoned duel:', err))
        .finally(() => {
          localStorage.removeItem('winky_active_challenge');
        });
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Withdraw USDC handler ───
  const handleWithdraw = useCallback(async () => {
    if (!sdkWallet || !withdrawRecipient || !withdrawAmount) return;
    const amount = parseFloat(withdrawAmount);
    if (isNaN(amount) || amount <= 0) {
      setWithdrawError('Enter a valid amount');
      return;
    }
    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawTxHash(null);
    try {
      const raw = BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
      const mask = (BigInt(1) << BigInt(128)) - BigInt(1);
      const low = (raw & mask).toString();
      const high = (raw >> BigInt(128)).toString();

      const tx = await sdkWallet.execute(
        [{
          contractAddress: TOKENS.USDC,
          entrypoint: 'transfer',
          calldata: [withdrawRecipient, low, high],
        }],
        { feeMode: 'sponsored' },
      );
      setWithdrawTxHash(tx.hash);
      setWithdrawAmount('');
      setWithdrawRecipient('');
      getUsdcBalance().then(setUsdcBalance);
    } catch (err: any) {
      const msg = err.message || 'Transfer failed';
      if (msg.includes('u256_sub Overflow')) {
        setWithdrawError('Insufficient USDC balance');
      } else {
        setWithdrawError(msg.length > 100 ? msg.slice(0, 100) + '\u2026' : msg);
      }
    } finally {
      setWithdrawing(false);
    }
  }, [sdkWallet, withdrawRecipient, withdrawAmount, getUsdcBalance]);


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
    if (loggingOut) setLoggingOut(false);
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

        const baseUrl = API_URL || window.location.origin;

        if (!wId || !wPk) {
          const token = await getAccessToken();
          const resp = await fetch(`${baseUrl}/api/wallet/starknet`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ privyUserId: user.id }),
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
          paymaster: { nodeUrl: `${baseUrl}/api/paymaster` },
        });

        const { wallet } = await sdk.onboard({
          strategy: OnboardStrategy.Privy,
          deploy: 'if_needed',
          feeMode: 'sponsored',
          privy: {
            resolve: async () => ({
              walletId: wId!,
              publicKey: wPk!,
              serverUrl: `${baseUrl}/api/wallet/sign`,
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
    login({ loginMethods: ['twitter'] });
  }, [login]);

  const handleLogout = useCallback(() => {
    setLoggingOut(true);
    setSdkWallet(null);
    setWalletAddress(null);
    setUsdcBalance(null);
    setGamePhase('idle');
    setupAttemptedRef.current = false;
    try {
      Object.values(STORAGE_KEYS).forEach(k => {
        try { window.localStorage.removeItem(k); } catch {}
      });
    } catch {}
    logout().catch(() => {});
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
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    chartIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - gameStartTimeRef.current) / 1000;
      const currentBlinks = blinkCountRef.current;
      setChartData(prev => {
        const last = prev[prev.length - 1];
        if (last && Math.abs(last.time - elapsed) < 0.3) return prev;
        return [...prev, { time: Math.round(elapsed * 10) / 10, blinks: currentBlinks }];
      });
      try {
        const raw = localStorage.getItem('winky_active_challenge');
        if (raw) {
          const saved = JSON.parse(raw);
          saved.lastScore = currentBlinks;
          localStorage.setItem('winky_active_challenge', JSON.stringify(saved));
        }
      } catch {}
    }, 500);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (chartIntervalRef.current) clearInterval(chartIntervalRef.current);
    };
  }, [gamePhase]);

  // ─── Post-game: save challenge or resolve duel ───
  useEffect(() => {
    if (gamePhase !== 'result' || finalScore === 0 || !walletAddress) return;
    if (resolving) return;

    if (gameMode === 'create') {
      // Flow 1: Save the open challenge to the API so it appears in the directory
      const duelId = duelTx?.duelId;
      if (duelId === undefined) return;

      fetch('/api/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duelId,
          playerAddress: walletAddress,
          username: twitterUsername || formatAddress(walletAddress),
          profileImage: fullSizeTwitterImage(user?.twitter?.profilePictureUrl) || undefined,
          score: finalScore,
          stake: selectedBet,
        }),
      })
        .then(() => fetchOpenChallenges())
        .catch((err) => console.error('[challenge] Failed to post:', err));
    }

    if (gameMode === 'challenge' && challengeTarget) {
      // Flow 2: joinDuel already happened in handleStart — just resolve
      setResolving(true);

      (async () => {
        try {
          const opponentScore = challengeTarget.score;
          const isDraw = finalScore === opponentScore;
          const challengerWins = finalScore > opponentScore;
          const winnerAddress = isDraw
            ? '0x0'
            : challengerWins
              ? walletAddress
              : challengeTarget.playerAddress;

          const resolveRes = await fetch('/api/challenge/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              duelId: challengeTarget.duelId,
              winnerAddress,
              isDraw,
            }),
          });
          await resolveRes.json();

          await fetch('/api/challenge', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              duelId: challengeTarget.duelId,
              winnerAddress,
              isDraw,
              challenger: {
                address: walletAddress,
                username: twitterUsername || formatAddress(walletAddress),
                profileImage: fullSizeTwitterImage(user?.twitter?.profilePictureUrl) || undefined,
                score: finalScore,
              },
            }),
          });
          fetchOpenChallenges();

          try { localStorage.removeItem('winky_active_challenge'); } catch {}
        } catch (err: any) {
          console.error('[resolve] Failed:', err);
          setError('Failed to resolve duel on-chain');
        } finally {
          setResolving(false);
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamePhase, finalScore]);

  // ─── Handlers ───

  /** Flow 1: Create a new challenge — deposit, then blink */
  const handlePlay = useCallback(async () => {
    if (!isConnected) return;
    resetDetection();
    blinkCountRef.current = 0;
    setChartData([]);
    setFinalScore(0);
    setError(null);
    setNeedsFunding(false);
    setDuelTxHash(null);
    setGameMode('create');
    setChallengeTarget(null);
    setResolving(false);
    clearBlinkLog();

    if (ESCROW_CONTRACT_ADDRESS) {
      const result = await createDuel(selectedBet);
      if (!result) return;
      setDuelTxHash(result.txHash);
      getUsdcBalance().then(setUsdcBalance);
    }

    window.history.pushState({ winkyGame: true }, '');
    setGamePhase('ready');
  }, [isConnected, resetDetection, createDuel, selectedBet, getUsdcBalance, clearBlinkLog]);

  /** Flow 2: Accept an existing challenge — blink first, then match bet + resolve after game */
  const handleAcceptChallenge = useCallback(async (challenge: OpenChallenge) => {
    if (!isConnected) return;
    resetDetection();
    blinkCountRef.current = 0;
    setChartData([]);
    setFinalScore(0);
    setError(null);
    setNeedsFunding(false);
    setDuelTxHash(null);
    setGameMode('challenge');
    setChallengeTarget(challenge);
    setResolving(false);
    clearBlinkLog();
    setSelectedBet(challenge.stake);
    window.history.pushState({ winkyGame: true }, '');
    setGamePhase('ready');
  }, [isConnected, resetDetection, clearBlinkLog]);

  const handleStart = useCallback(async () => {
    if (gameMode === 'challenge' && challengeTarget && ESCROW_CONTRACT_ADDRESS) {
      setError(null);
      const result = await joinDuel(challengeTarget.duelId, challengeTarget.stake);
      if (!result || result.error) {
        const err = result?.error;
        if (err === 'DUEL_NOT_OPEN') {
          fetch('/api/challenge', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ duelId: challengeTarget.duelId }),
          }).then(() => fetchOpenChallenges()).catch(() => {});
          setError('This challenge is no longer available — it may have been cancelled or already accepted.');
        } else if (err === 'OWN_DUEL') {
          setError('You can\u2019t accept your own challenge.');
        } else if (err === 'INSUFFICIENT_USDC') {
          setError('Not enough USDC to match this bet. Fund your wallet first.');
          setNeedsFunding(true);
        } else {
          setError(err || 'Failed to join challenge.');
        }
        clearEscrowError();
        setChallengeTarget(null);
        setGameMode('create');
        setGamePhase('idle');
        return;
      }
      setDuelTxHash(result.txHash);
      getUsdcBalance().then(setUsdcBalance);

      try {
        localStorage.setItem('winky_active_challenge', JSON.stringify({
          duelId: challengeTarget.duelId,
          challengerAddress: walletAddress,
          challengerUsername: twitterUsername || formatAddress(walletAddress || ''),
          challengerProfileImage: fullSizeTwitterImage(user?.twitter?.profilePictureUrl) || undefined,
          opponentAddress: challengeTarget.playerAddress,
          opponentUsername: challengeTarget.username,
          opponentScore: challengeTarget.score,
          stake: challengeTarget.stake,
          startedAt: Date.now(),
        }));
      } catch {}
    }

    setGamePhase('countdown');
    setCountdownNumber(3);
    resetDetection();
    blinkCountRef.current = 0;
    setTimeout(() => setCountdownNumber(2), 1000);
    setTimeout(() => setCountdownNumber(1), 2000);
    setTimeout(() => setGamePhase('playing'), 3000);
  }, [resetDetection, gameMode, challengeTarget, joinDuel, clearEscrowError, fetchOpenChallenges, getUsdcBalance, walletAddress, twitterUsername, user]);

  const handlePlayAgain = useCallback(() => {
    resetDetection();
    blinkCountRef.current = 0;
    setChartData([]);
    setFinalScore(0);
    setChallengeTarget(null);
    setResolving(false);
    setTimeLeft(GAME_DURATION);
    clearBlinkLog();
    setGamePhase('idle');
    fetchOpenChallenges();
  }, [resetDetection, clearBlinkLog, fetchOpenChallenges]);

  // ─── Browser back button → return to idle (no challenge triggered) ───
  useEffect(() => {
    const onPopState = () => {
      if (gamePhase === 'ready') {
        handlePlayAgain();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [gamePhase, handlePlayAgain]);

  const handleCopyAddress = useCallback(() => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [walletAddress]);

  const opponentScore = challengeTarget?.score ?? null;
  const isWinner = gameMode === 'challenge' && opponentScore !== null && finalScore > opponentScore;
  const isDraw = gameMode === 'challenge' && opponentScore !== null && finalScore === opponentScore;
  const isLoser = gameMode === 'challenge' && opponentScore !== null && finalScore < opponentScore;
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
            <img src="/logo.png" alt="Winky" style={{ objectFit: 'contain', width: '100%', maxWidth: '280px', height: 'auto' }} />
          </div>
          {NETWORK === 'sepolia' && (
            <span style={{ fontSize: '9px', color: '#f59e0b', padding: '3px 8px', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', fontWeight: 700, background: 'rgba(245,158,11,0.08)', letterSpacing: '0.5px' }}>
              Testnet
            </span>
          )}
        </div>

        {/* Connect / Address */}
        {isConnected && walletAddress ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                onClick={() => { setShowWithdraw(true); setWithdrawError(null); setWithdrawTxHash(null); }}
                className="sidebar-withdraw-btn"
              >
                Withdraw
              </button>
              <button
                onClick={handleLogout}
                className="sidebar-disconnect-btn"
                aria-label="Disconnect wallet"
              >
                &times;
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleLogin}
            disabled={loginBusy}
            className={`sidebar-connect-btn${walletLoading ? ' sidebar-connect-btn--loading' : ''}`}
          >
            {walletLoading ? <span>Setting Up<span className="dots-anim" /></span> : !ready ? <span>Loading<span className="dots-anim" /></span> : 'Connect Wallet'}
          </button>
        )}
      </div>


      {/* Bet + Play */}
      <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {isConnected && usdcBalance !== null && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#A6A4A7', fontVariantNumeric: 'tabular-nums' }}>
              Balance: ${usdcBalance.toFixed(2)}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px' }}>
          {BET_AMOUNTS.map(amount => (
            <button
              key={amount}
              onClick={() => setSelectedBet(amount)}
              disabled={isBusy || showGameArea}
              className={`sidebar-bet-btn${selectedBet === amount ? ' sidebar-bet-btn--active' : ''}`}
            >
              ${amount}
            </button>
          ))}
        </div>
        <button
          onClick={isConnected ? handlePlay : handleLogin}
          disabled={loginBusy || showGameArea || isBusy}
          className={`sidebar-play-btn${isConnected && !showGameArea && !isBusy ? ' sidebar-play-btn--active' : ''}`}
        >
          {isBusy ? 'Depositing\u2026' : showGameArea ? 'In Game\u2026' : isConnected ? `Create Challenge ($${selectedBet})` : 'Connect to Play'}
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

      {/* Top 10 Leaderboard */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} aria-label="Leaderboard">
        <div style={{
          padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 800, color: '#A6A4A7' }}>Leaderboard</span>
          <span style={{ fontSize: '9px', fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Won / Blinks
          </span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sidebarLeaderboard.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: '#333', fontSize: '12px', fontWeight: 600 }}>
              No winners yet
            </div>
          )}
          {sidebarLeaderboard.map((entry, idx) => {
            const isMe = walletAddress && entry.address === walletAddress.replace(/^0x0*/i, '0x').toLowerCase();
            return (
              <div
                key={entry.address}
                className="sidebar-leaderboard-row"
                style={isMe ? { background: 'rgba(192,180,218,0.06)' } : undefined}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <span style={{ fontSize: '11px', fontWeight: 800, color: idx < 3 ? '#facc15' : '#555', width: '18px', textAlign: 'center', flexShrink: 0 }}>
                    {idx + 1}
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: isMe ? 700 : 600, color: isMe ? '#C0B4DA' : '#A6A4A7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.username}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, color: '#22c55e', fontVariantNumeric: 'tabular-nums' }}>
                    ${entry.earned}
                  </span>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#555', fontVariantNumeric: 'tabular-nums', minWidth: '32px', textAlign: 'right' }}>
                    {entry.topBlinks}
                  </span>
                </div>
              </div>
            );
          })}
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

        {/* ─── IDLE: challenge directory ─── */}
        {gamePhase === 'idle' && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            gap: '24px',
            padding: '36px 32px',
            overflowY: 'auto',
          }}>
            <div style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: '36px', fontWeight: 900, color: '#A6A4A7', margin: 0, lineHeight: 1.2 }}>
                Bet. Blink.<br />Winner takes it all.
              </h1>
            </div>

            {/* Header row: title + search */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              <p className="idle-section-title" style={{ margin: 0 }}>Battle these blinkers</p>
              <input
                type="text"
                value={blinkerSearch}
                onChange={(e) => setBlinkerSearch(e.target.value)}
                placeholder="Search @username"
                className="challenge-input"
                spellCheck={false}
                autoComplete="off"
                style={{ maxWidth: '220px', padding: '9px 14px', fontSize: '12px' }}
              />
            </div>

            {/* Challenge cards */}
            {(() => {
              const normalizedUser = walletAddress?.replace(/^0x0*/i, '0x').toLowerCase();
              const searchFiltered = openChallenges.filter(c =>
                !blinkerSearch || c.username.toLowerCase().includes(blinkerSearch.replace(/^@/, '').toLowerCase())
              );

              if (openChallenges.length === 0) {
                return (
                  <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                    <p style={{ fontSize: '15px', fontWeight: 700, color: '#444', margin: 0 }}>No open challenges yet</p>
                    <p style={{ fontSize: '13px', fontWeight: 500, color: '#333', margin: '8px 0 0' }}>
                      Place a bet and be the first to post a challenge!
                    </p>
                  </div>
                );
              }
              return (
                <div className="blinker-grid">
                  {searchFiltered.map(c => {
                    const isOwn = normalizedUser && c.playerAddress.replace(/^0x0*/i, '0x').toLowerCase() === normalizedUser;
                    const isFlipped = flippedCardId === c.id;
                    const canAfford = usdcBalance !== null && usdcBalance >= c.stake;
                    return (
                      <div
                        key={c.id}
                        className={`blinker-card-wrapper${isOwn ? ' blinker-card--own' : ''}`}
                        style={isOwn ? { pointerEvents: 'none' as const } : undefined}
                      >
                        <div className={`blinker-card-flipper${isFlipped ? ' blinker-card-flipper--flipped' : ''}`}>
                          {/* Front face */}
                          <div
                            className="blinker-card blinker-card-front"
                            onClick={() => { if (!isOwn && isConnected) setFlippedCardId(isFlipped ? null : c.id); }}
                          >
                            {c.profileImage ? (
                              <img src={c.profileImage} alt="" className="blinker-card-bg" />
                            ) : (
                              <div className="blinker-card-bg blinker-card-bg--placeholder" />
                            )}
                            {!isFlipped && (
                              <>
                                <div className="blinker-card-overlay" />
                                <div className="blinker-card-content">
                                  <span className="blinker-card-stat">Blinked {c.score} times</span>
                                  <span className="blinker-card-stake">${c.stake} USDC at stake</span>
                                  <span className="blinker-card-name">{c.username}</span>
                                  {isOwn && (
                                    <span style={{
                                      fontSize: '10px', fontWeight: 700, color: '#facc15',
                                      textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '4px',
                                    }}>
                                      Waiting for challenger&hellip;
                                    </span>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                          {/* Back face — challenge preview */}
                          <div className="blinker-card blinker-card-back" onClick={() => setFlippedCardId(null)}>
                            {c.profileImage ? (
                              <img src={c.profileImage} alt="" className="blinker-card-back-bg" />
                            ) : (
                              <div className="blinker-card-back-bg blinker-card-bg--placeholder" />
                            )}
                            <div className="blinker-card-back-overlay" />
                            <div className="blinker-card-back-content">
                              <div className="blinker-card-back-challenge-text">
                                <span className="blinker-card-stat">Blink {c.score + 1} times</span>
                                <span className="blinker-card-stake">Win ${c.stake * 2} USDC</span>
                              </div>
                              <div className="blinker-card-back-footer">
                                {!canAfford && (
                                  <div className="blinker-card-back-fund-notice" onClick={(e) => e.stopPropagation()}>
                                    <span>Add funds to your wallet to match this bet</span>
                                  </div>
                                )}
                                <div className="blinker-card-back-bottom">
                                  <a
                                    href={`https://x.com/${c.username}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="blinker-card-name"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    @{c.username}
                                  </a>
                                  <button
                                    className="blinker-card-back-enter-btn"
                                    onClick={(e) => { e.stopPropagation(); setFlippedCardId(null); handleAcceptChallenge(c); }}
                                  >
                                    Enter
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {blinkerSearch && searchFiltered.length === 0 && (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '32px 0' }}>
                      <p style={{ fontSize: '13px', fontWeight: 600, color: '#444', margin: 0 }}>
                        No challenges found for &ldquo;{blinkerSearch}&rdquo;
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Past Challenges */}
            {completedChallenges.length > 0 && (
              <>
                <p className="idle-section-title" style={{ margin: 0 }}>Past Challenges</p>
                <div className="blinker-grid">
                  {completedChallenges.slice(0, 9).map(c => {
                    const p1Won = !c.isDraw && c.winnerAddress.replace(/^0x0*/i, '0x').toLowerCase() === c.player1.address.replace(/^0x0*/i, '0x').toLowerCase();
                    const p2Won = !c.isDraw && !p1Won;
                    const winner = p1Won ? c.player1 : c.player2;
                    return (
                      <div key={c.duelId} className="past-card">
                        <div className={`past-card-half${p1Won ? ' past-card-half--won' : p2Won ? ' past-card-half--lost' : ''}`}>
                          {c.player1.profileImage ? (
                            <img src={c.player1.profileImage} alt="" className="past-card-img" />
                          ) : (
                            <div className="past-card-img past-card-img--placeholder" />
                          )}
                          <div className="past-card-half-overlay" />
                          <span className={`past-card-score${p1Won ? ' past-card-score--won' : p2Won ? ' past-card-score--lost' : ''}`}>
                            {c.player1.score}
                          </span>
                          <a
                            href={`https://x.com/${c.player1.username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="past-card-player-name"
                            onClick={(e) => e.stopPropagation()}
                          >
                            @{c.player1.username}
                          </a>
                        </div>
                        <div className={`past-card-half${p2Won ? ' past-card-half--won' : p1Won ? ' past-card-half--lost' : ''}`}>
                          {c.player2.profileImage ? (
                            <img src={c.player2.profileImage} alt="" className="past-card-img" />
                          ) : (
                            <div className="past-card-img past-card-img--placeholder" />
                          )}
                          <div className="past-card-half-overlay" />
                          <span className={`past-card-score${p2Won ? ' past-card-score--won' : p1Won ? ' past-card-score--lost' : ''}`}>
                            {c.player2.score}
                          </span>
                          <a
                            href={`https://x.com/${c.player2.username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="past-card-player-name"
                            onClick={(e) => e.stopPropagation()}
                          >
                            @{c.player2.username}
                          </a>
                        </div>
                        <div className="past-card-center-label">
                          <span className="past-card-center-text">
                            {c.isDraw
                              ? `Draw \u2014 $${c.payout / 2} returned`
                              : (<><a href={`https://x.com/${winner.username}`} target="_blank" rel="noopener noreferrer">{winner.username}</a>{` won $${c.payout}`}</>)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Powered by Starknet */}
            <div className="powered-by-starknet">
              <span>Powered by</span>
              <img src="/starknet-logo.png" alt="Starknet" />
            </div>

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
                  <button
                    onClick={handlePlayAgain}
                    style={{
                      marginTop: '8px', background: 'none', border: 'none',
                      color: 'rgba(255,255,255,0.35)', fontSize: '12px', fontWeight: 700,
                      cursor: 'pointer', padding: '4px 12px',
                    }}
                  >
                    Cancel
                  </button>
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
              {/* ── Flow 1: Challenge created ── */}
              {gameMode === 'create' && (
                <>
                  <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#C0B4DA', margin: 0 }}>
                    Challenge Posted!
                  </h2>
                  <div style={{
                    padding: '24px 36px', background: '#141414', borderRadius: '14px',
                    border: '2px solid rgba(192,180,218,0.2)', textAlign: 'center', minWidth: '160px',
                  }}>
                    <p style={{ fontSize: '10px', color: '#666', fontWeight: 800, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '2px' }}>Your Blinks</p>
                    <p style={{ fontSize: '48px', fontWeight: 900, color: '#C0B4DA', margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{finalScore}</p>
                  </div>
                  <div style={{
                    padding: '16px 28px', borderRadius: '12px', textAlign: 'center',
                    background: 'rgba(192,180,218,0.06)', border: '1px solid rgba(192,180,218,0.15)',
                  }}>
                    <p style={{ fontSize: '14px', fontWeight: 700, color: '#A6A4A7', margin: 0 }}>
                      ${selectedBet} USDC at stake
                    </p>
                    <p style={{ fontSize: '12px', fontWeight: 500, color: '#555', margin: '6px 0 0' }}>
                      Your challenge is now live. Anyone can accept and try to beat your {finalScore} blinks!
                    </p>
                  </div>
                </>
              )}

              {/* ── Flow 2: Challenge result (vs opponent) ── */}
              {gameMode === 'challenge' && challengeTarget && (
                <>
                  <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#A6A4A7', margin: 0 }}>
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
                    <div style={{
                      padding: '24px 36px', background: '#141414', borderRadius: '14px',
                      border: '2px solid rgba(255,255,255,0.06)', textAlign: 'center', minWidth: '160px',
                    }}>
                      <p style={{ fontSize: '10px', color: '#666', fontWeight: 800, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '2px' }}>{challengeTarget.username}</p>
                      <p style={{ fontSize: '48px', fontWeight: 900, color: '#A6A4A7', margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{challengeTarget.score}</p>
                    </div>
                  </div>
                  {resolving && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div className="spinner" />
                      <p style={{ fontSize: '13px', color: '#555', fontWeight: 600, margin: 0 }}>Resolving on-chain&#x2026;</p>
                    </div>
                  )}
                  {!resolving && (
                    <div style={{
                      padding: '20px 32px', borderRadius: '14px', textAlign: 'center',
                      background: isWinner ? 'rgba(34,197,94,0.08)' : isDraw ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)',
                      border: `2px solid ${isWinner ? 'rgba(34,197,94,0.25)' : isDraw ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.25)'}`,
                    }}>
                      <p style={{ fontSize: '28px', fontWeight: 900, margin: 0, color: isWinner ? '#22c55e' : isDraw ? '#f59e0b' : '#ef4444' }}>
                        {isWinner ? 'You Win!' : isDraw ? 'Draw!' : 'You Lose'}
                      </p>
                      <p style={{ fontSize: '14px', fontWeight: 700, margin: '8px 0 0', color: isWinner ? '#22c55e' : isDraw ? '#f59e0b' : '#ef4444' }}>
                        {isWinner ? `+$${(selectedBet * 2).toFixed(2)} USDC` : isDraw ? 'Bet returned' : `\u2212$${selectedBet} USDC`}
                      </p>
                    </div>
                  )}
                </>
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
                Back to Home
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ═══ SIDEBAR ═══ */}
      {sidebarContent}

      {/* Withdraw modal */}
      {showWithdraw && (
        <div className="withdraw-backdrop" onClick={() => setShowWithdraw(false)}>
          <div className="withdraw-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 900, color: '#A6A4A7', margin: 0 }}>Send USDC</h2>
              <button
                onClick={() => setShowWithdraw(false)}
                style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '20px', fontWeight: 800, lineHeight: 1 }}
              >&times;</button>
            </div>

            {usdcBalance !== null && (
              <div className="withdraw-balance">
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#555' }}>Available balance</span>
                <span style={{ fontSize: '28px', fontWeight: 900, color: '#C0B4DA' }}>${usdcBalance.toFixed(2)}</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '10px', fontWeight: 800, color: '#555', textTransform: 'uppercase', letterSpacing: '1.5px' }}>Recipient Address</label>
              <input
                type="text"
                value={withdrawRecipient}
                onChange={(e) => setWithdrawRecipient(e.target.value)}
                placeholder="0x..."
                className="withdraw-input"
                spellCheck={false}
                autoComplete="off"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '10px', fontWeight: 800, color: '#555', textTransform: 'uppercase', letterSpacing: '1.5px' }}>Amount (USDC)</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  className="withdraw-input"
                  style={{ flex: 1 }}
                />
                <button
                  onClick={() => { if (usdcBalance) setWithdrawAmount(usdcBalance.toFixed(2)); }}
                  className="withdraw-max-btn"
                >
                  MAX
                </button>
              </div>
            </div>

            {withdrawError && (
              <p style={{ fontSize: '12px', fontWeight: 600, color: '#ef4444', margin: 0, textAlign: 'center' }}>
                {withdrawError}
              </p>
            )}

            {withdrawTxHash && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '12px', fontWeight: 600, color: '#22c55e', margin: '0 0 4px' }}>Transfer sent!</p>
                <a
                  href={`${VOYAGER_TX_URL}/${withdrawTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '11px', fontWeight: 600, color: '#C0B4DA', textDecoration: 'underline' }}
                >
                  View on Voyager \u2197
                </a>
              </div>
            )}

            <button
              onClick={handleWithdraw}
              disabled={withdrawing || !withdrawRecipient || !withdrawAmount}
              className="withdraw-send-btn"
            >
              {withdrawing ? 'Sending\u2026' : '\u2197 Send USDC'}
            </button>

            <p style={{ fontSize: '10px', fontWeight: 500, color: '#444', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
              Transfer your USDC to your Ready wallet or any Starknet wallet
            </p>
          </div>
        </div>
      )}

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
