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

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
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

/** Load an image, returning null on failure. */
function loadImg(src: string, crossOrigin = true): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Draw a challenge card PNG and trigger download. */
async function downloadChallengeCard(opts: { score: number; stake: number; username: string; profileImage?: string }) {
  const W = 600, H = 360, R = 24;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const [profileImg, logoImg] = await Promise.all([
    opts.profileImage ? loadImg(opts.profileImage) : Promise.resolve(null),
    loadImg('/logo.png', false),
  ]);

  ctx.fillStyle = '#0A0A0A';
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, R); ctx.fill(); ctx.clip();

  if (profileImg) {
    ctx.globalAlpha = 0.35;
    const scale = Math.max(W / profileImg.width, H / profileImg.height);
    const sw = profileImg.width * scale, sh = profileImg.height * scale;
    ctx.drawImage(profileImg, (W - sw) / 2, (H - sh) / 2, sw, sh);
    ctx.globalAlpha = 1;
  }

  const grad = ctx.createLinearGradient(0, H * 0.3, 0, H);
  grad.addColorStop(0, 'rgba(10,10,10,0.3)');
  grad.addColorStop(1, 'rgba(10,10,10,0.92)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  if (logoImg) {
    const lh = 32;
    const lw = (logoImg.width / logoImg.height) * lh;
    ctx.drawImage(logoImg, 20, 12, lw, lh);
  }

  ctx.fillStyle = 'rgba(192,180,218,0.15)';
  const badge = `$${opts.stake * 2} USDC Prize`;
  ctx.font = '800 14px Manrope, sans-serif';
  const bw = ctx.measureText(badge).width + 24;
  ctx.beginPath(); ctx.roundRect(W - bw - 24, 20, bw, 30, 8); ctx.fill();
  ctx.fillStyle = '#C0B4DA'; ctx.textAlign = 'center'; ctx.fillText(badge, W - bw / 2 - 24, 40);

  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = '900 64px Manrope, sans-serif';
  ctx.fillText(String(opts.score), 28, H - 90);
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '700 20px Manrope, sans-serif';
  ctx.fillText('blinks in 30s', 28, H - 60);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '600 15px Manrope, sans-serif';
  ctx.fillText(`@${opts.username}`, 28, H - 28);
  ctx.textAlign = 'right'; ctx.fillStyle = '#C0B4DA'; ctx.font = '800 18px Manrope, sans-serif';
  ctx.fillText('Can you beat me?', W - 28, H - 32);

  const link = document.createElement('a');
  link.download = `winky-challenge-${opts.score}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

/** Draw a win card PNG (split red/green like past challenge cards) and trigger download. */
async function downloadWinCard(opts: {
  winnerUsername: string; winnerScore: number; winnerImage?: string;
  loserUsername: string; loserScore: number; loserImage?: string;
  payout: number;
}) {
  const W = 600, H = 360, R = 24;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const [loserImg, winnerImg] = await Promise.all([
    opts.loserImage ? loadImg(opts.loserImage) : Promise.resolve(null),
    opts.winnerImage ? loadImg(opts.winnerImage) : Promise.resolve(null),
  ]);

  ctx.fillStyle = '#0A0A0A';
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, R); ctx.fill(); ctx.clip();

  const half = W / 2;

  // Left half (loser - red)
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, half, H); ctx.clip();
  if (loserImg) {
    const scale = Math.max(half / loserImg.width, H / loserImg.height);
    ctx.drawImage(loserImg, (half - loserImg.width * scale) / 2, (H - loserImg.height * scale) / 2, loserImg.width * scale, loserImg.height * scale);
  }
  ctx.fillStyle = 'rgba(239, 68, 68, 0.4)'; ctx.fillRect(0, 0, half, H);
  ctx.restore();

  // Right half (winner - green)
  ctx.save(); ctx.beginPath(); ctx.rect(half, 0, half, H); ctx.clip();
  if (winnerImg) {
    const scale = Math.max(half / winnerImg.width, H / winnerImg.height);
    ctx.drawImage(winnerImg, half + (half - winnerImg.width * scale) / 2, (H - winnerImg.height * scale) / 2, winnerImg.width * scale, winnerImg.height * scale);
  }
  ctx.fillStyle = 'rgba(34, 197, 94, 0.4)'; ctx.fillRect(half, 0, half, H);
  ctx.restore();

  // Center label — "username won $X"
  const labelText = `${opts.winnerUsername} won $${opts.payout}`;
  ctx.font = '900 22px Manrope, sans-serif';
  const lbw = ctx.measureText(labelText).width + 40;
  const lbh = 38;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.beginPath(); ctx.roundRect((W - lbw) / 2, 12, lbw, lbh, 10); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(labelText, W / 2, 12 + lbh / 2);

  // Loser score + name (left)
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
  ctx.fillStyle = '#ef4444'; ctx.font = '900 72px Manrope, sans-serif';
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 12;
  ctx.fillText(String(opts.loserScore), half / 2, H - 60);
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '700 16px Manrope, sans-serif';
  ctx.fillText(`@${opts.loserUsername}`, half / 2, H - 28);
  ctx.shadowBlur = 0;

  // Winner score + name (right)
  ctx.fillStyle = '#22c55e'; ctx.font = '900 72px Manrope, sans-serif';
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 12;
  ctx.fillText(String(opts.winnerScore), half + half / 2, H - 60);
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '700 16px Manrope, sans-serif';
  ctx.fillText(`@${opts.winnerUsername}`, half + half / 2, H - 28);
  ctx.shadowBlur = 0;

  const link = document.createElement('a');
  link.download = `winky-win-${opts.winnerScore}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ─── Component ───

export function WinkyGame({ initialChallengeId, onGamePhaseChange }: { initialChallengeId?: number; onGamePhaseChange?: (phase: string) => void }) {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();

  // Wallet state (Starkzap SDK)
  const [sdkWallet, setSdkWallet] = useState<WalletInterface | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const setupAttemptedRef = useRef(false);

  // Game state
  const [gamePhase, setGamePhase] = useState<GamePhase>('idle');
  useEffect(() => { onGamePhaseChange?.(gamePhase); }, [gamePhase, onGamePhaseChange]);
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
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [challengePopup, setChallengePopup] = useState<OpenChallenge | null>(null);
  const [challengePopupDismissed, setChallengePopupDismissed] = useState(false);

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

  useEffect(() => {
    if (initialChallengeId === undefined || challengePopupDismissed || openChallenges.length === 0) return;
    const match = openChallenges.find(c => c.duelId === initialChallengeId);
    if (match && !challengePopup) {
      setChallengePopup(match);
    }
  }, [initialChallengeId, openChallenges, challengePopupDismissed, challengePopup]);

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
      width: isMobile ? '100%' : '360px',
      minWidth: isMobile ? undefined : '360px',
      display: 'flex',
      flexDirection: 'column',
      borderLeft: isMobile ? 'none' : '1px solid rgba(255,255,255,0.06)',
      borderBottom: isMobile ? '1px solid rgba(255,255,255,0.06)' : 'none',
      background: 'rgba(17,17,17,0.6)',
      backdropFilter: 'blur(20px)',
      height: isMobile ? 'auto' : '100%',
      overflow: isMobile ? 'visible' : 'hidden',
      flexShrink: 0,
    }}>
      {/* Spacer for fixed header on mobile */}
      {isMobile && <div style={{ height: '54px', flexShrink: 0 }} />}
      {/* Brand */}
      <div style={{
        padding: isMobile ? '8px 16px 12px' : '20px 20px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: isMobile ? '10px' : '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/logo.png" alt="Winky" style={{ objectFit: 'contain', width: '100%', maxWidth: isMobile ? '160px' : '280px', height: 'auto' }} />
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
      <div style={{ padding: isMobile ? '14px 16px' : '20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: isMobile ? '10px' : '14px' }}>
        {isConnected && usdcBalance !== null && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: isMobile ? '12px' : '10px', fontWeight: 700, color: '#A6A4A7', fontVariantNumeric: 'tabular-nums' }}>
              Balance: ${usdcBalance.toFixed(2)}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', gap: isMobile ? '8px' : '6px' }}>
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

      {/* Empty space where leaderboard used to be — now in popup */}
      <div style={{ flex: isMobile ? 'none' : 1 }} />
    </aside>
  );

  // ─── Mobile idle early return (unified layout with Ranked) ───
  if (isMobile && gamePhase === 'idle') {
    return (
      <>
        <div style={{
          display: 'flex', flexDirection: 'column', width: '100%', height: '100dvh',
          overflow: 'auto', background: '#0A0A0A', fontFamily: "'Manrope', sans-serif",
          WebkitOverflowScrolling: 'touch', touchAction: 'manipulation',
        } as React.CSSProperties}>
          <div style={{ height: '58px', flexShrink: 0 }} />
          <div style={{ padding: '8px 12px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <img src="/logo.png" alt="Winky" style={{ objectFit: 'contain', maxWidth: '140px', height: 'auto' }} />
            {NETWORK === 'sepolia' && <span style={{ fontSize: '9px', color: '#f59e0b', padding: '3px 8px', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', fontWeight: 700, background: 'rgba(245,158,11,0.08)', letterSpacing: '0.5px' }}>Testnet</span>}
          </div>
          <div style={{ padding: '10px 12px 12px' }}>
            {isConnected && walletAddress ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleCopyAddress} className="sidebar-wallet-btn" aria-label={copied ? 'Address copied' : 'Copy wallet address'}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', flexShrink: 0, boxShadow: '0 0 6px rgba(34,197,94,0.5)' }} aria-hidden="true" />
                  <span style={{ fontFamily: "'SF Mono', Monaco, monospace", fontSize: '12px', letterSpacing: '0.3px' }}>{copied ? 'Copied!' : formatAddress(walletAddress)}</span>
                </button>
                <button onClick={() => { setShowWithdraw(true); setWithdrawError(null); setWithdrawTxHash(null); }} className="sidebar-withdraw-btn">Withdraw</button>
                <button onClick={handleLogout} className="sidebar-disconnect-btn" aria-label="Disconnect wallet">&times;</button>
              </div>
            ) : (
              <button onClick={handleLogin} disabled={loginBusy} className={`sidebar-connect-btn${walletLoading ? ' sidebar-connect-btn--loading' : ''}`}>
                {walletLoading ? <span>Setting Up<span className="dots-anim" /></span> : !ready ? <span>Loading<span className="dots-anim" /></span> : 'Connect Wallet'}
              </button>
            )}
          </div>
          <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {isConnected && usdcBalance !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#A6A4A7', fontVariantNumeric: 'tabular-nums' }}>Balance: ${usdcBalance.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              {BET_AMOUNTS.map(amount => (
                <button key={amount} onClick={() => setSelectedBet(amount)} disabled={isBusy || showGameArea}
                  className={`sidebar-bet-btn${selectedBet === amount ? ' sidebar-bet-btn--active' : ''}`}>${amount}</button>
              ))}
            </div>
            <button onClick={isConnected ? handlePlay : handleLogin} disabled={loginBusy || showGameArea || isBusy}
              className={`sidebar-play-btn${isConnected && !showGameArea && !isBusy ? ' sidebar-play-btn--active' : ''}`}>
              {isBusy ? 'Depositing\u2026' : showGameArea ? 'In Game\u2026' : isConnected ? `Create Challenge ($${selectedBet})` : 'Connect to Play'}
            </button>
            {needsFunding && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.18)', borderRadius: '10px' }}>
                <span style={{ fontSize: '16px', lineHeight: 1, flexShrink: 0 }}>&#9888;</span>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#facc15', lineHeight: 1.5 }}>Send USDC to your address to place bets</span>
                <button onClick={() => setNeedsFunding(false)} style={{ background: 'none', border: 'none', color: '#facc15', cursor: 'pointer', fontSize: '14px', fontWeight: 800, lineHeight: 1, marginLeft: 'auto', flexShrink: 0, opacity: 0.5 }} aria-label="Dismiss">&times;</button>
              </div>
            )}
            {duelTx && <a href={duelTx.voyagerUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '10px', fontWeight: 600, color: '#C0B4DA', textDecoration: 'none', textAlign: 'center' }}>Duel #{duelTx.duelId} created &#8599;</a>}
          </div>
          <div style={{ padding: '0 12px 8px' }}>
            <input type="text" value={blinkerSearch} onChange={(e) => setBlinkerSearch(e.target.value)} placeholder="Search @username" className="challenge-input" spellCheck={false} autoComplete="off" style={{ width: '100%', maxWidth: '100%' }} />
          </div>
          <div style={{ padding: '4px 16px 8px' }}>
            <p className="idle-section-title" style={{ margin: 0 }}>Battle these blinkers</p>
          </div>
          <div style={{ padding: '0 12px 24px' }}>
            {/* Cards rendered by desktop idle below will be duplicated — using separate mobile block */}
            {(() => {
              const normalizedUser = walletAddress?.replace(/^0x0*/i, '0x').toLowerCase();
              const searchFiltered = openChallenges.filter(c => !blinkerSearch || c.username.toLowerCase().includes(blinkerSearch.replace(/^@/, '').toLowerCase()));
              if (openChallenges.length === 0) return <div style={{ textAlign: 'center', padding: '48px 20px' }}><p style={{ fontSize: '15px', fontWeight: 700, color: '#444', margin: 0 }}>No open challenges yet</p><p style={{ fontSize: '13px', fontWeight: 500, color: '#333', margin: '8px 0 0' }}>Place a bet and be the first to post a challenge!</p></div>;
              return (<>
                <div className="blinker-grid">{searchFiltered.map(c => { const isOwn = normalizedUser && c.playerAddress.replace(/^0x0*/i, '0x').toLowerCase() === normalizedUser; const isFlipped = flippedCardId === c.id; const canAfford = usdcBalance !== null && usdcBalance >= c.stake; return (<div key={c.id} className={`blinker-card-wrapper${isOwn ? ' blinker-card--own' : ''}`}><div className={`blinker-card-flipper${isFlipped ? ' blinker-card-flipper--flipped' : ''}`}><div className="blinker-card blinker-card-front" onClick={() => { if (!isOwn && isConnected) setFlippedCardId(isFlipped ? null : c.id); }} style={isOwn ? { cursor: 'default' } : undefined}>{c.profileImage ? <img src={c.profileImage} alt="" className="blinker-card-bg" /> : <div className="blinker-card-bg blinker-card-bg--placeholder" />}{!isFlipped && (<><div className="blinker-card-overlay" /><button className="blinker-card-share-btn" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`${window.location.origin}/?challenge=${c.duelId}`).then(() => { setCopiedLinkId(c.id); setTimeout(() => setCopiedLinkId(prev => prev === c.id ? null : prev), 1500); }); }} aria-label="Copy challenge link">{copiedLinkId === c.id ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>}</button><div className="blinker-card-content">{isOwn ? <span className="blinker-card-stat">Blinked {c.score} times</span> : <span className="blinker-card-stat">Blinked <span className="blinker-card-score-blur">{c.score}</span> times</span>}<span className="blinker-card-stake">${c.stake} USDC at stake</span><span className="blinker-card-name">{c.username}</span>{isOwn && <span className="blinker-card-waiting">Waiting for challenger&hellip;</span>}</div></>)}</div><div className="blinker-card blinker-card-back" onClick={() => setFlippedCardId(null)}>{c.profileImage ? <img src={c.profileImage} alt="" className="blinker-card-back-bg" /> : <div className="blinker-card-back-bg blinker-card-bg--placeholder" />}<div className="blinker-card-back-overlay" /><div className="blinker-card-back-content"><div className="blinker-card-back-challenge-text"><span className="blinker-card-stat">Beat the score</span><span className="blinker-card-stake">Win ${c.stake * 2} USDC</span></div><div className="blinker-card-back-footer">{!canAfford && <div className="blinker-card-back-fund-notice" onClick={(e) => e.stopPropagation()}><span>Add funds to your wallet to match this bet</span></div>}<div className="blinker-card-back-bottom"><a href={`https://x.com/${c.username}`} target="_blank" rel="noopener noreferrer" className="blinker-card-name" onClick={(e) => e.stopPropagation()}>@{c.username}</a><button className="blinker-card-back-enter-btn" onClick={(e) => { e.stopPropagation(); setFlippedCardId(null); handleAcceptChallenge(c); }}>Enter</button></div></div></div></div></div></div>); })}{blinkerSearch && searchFiltered.length === 0 && <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '32px 0' }}><p style={{ fontSize: '13px', fontWeight: 600, color: '#444', margin: 0 }}>No challenges found for &ldquo;{blinkerSearch}&rdquo;</p></div>}</div>
                {completedChallenges.length > 0 && (<><p className="idle-section-title" style={{ margin: '20px 0 12px' }}>Past Challenges</p><div className="blinker-grid">{completedChallenges.slice(0, 9).map(c => { const p1Won = !c.isDraw && c.winnerAddress.replace(/^0x0*/i, '0x').toLowerCase() === c.player1.address.replace(/^0x0*/i, '0x').toLowerCase(); const winner = p1Won ? c.player1 : c.player2; const loser = p1Won ? c.player2 : c.player1; const left = c.isDraw ? c.player1 : loser; const right = c.isDraw ? c.player2 : winner; return (<div key={c.duelId} className="past-card"><div className={`past-card-half${c.isDraw ? '' : ' past-card-half--lost'}`}>{left.profileImage ? <img src={left.profileImage} alt="" className="past-card-img" /> : <div className="past-card-img past-card-img--placeholder" />}<div className="past-card-half-overlay" /><span className={`past-card-score${c.isDraw ? '' : ' past-card-score--lost'}`}>{left.score}</span><a href={`https://x.com/${left.username}`} target="_blank" rel="noopener noreferrer" className="past-card-player-name" onClick={(e) => e.stopPropagation()}>@{left.username}</a></div><div className={`past-card-half${c.isDraw ? '' : ' past-card-half--won'}`}>{right.profileImage ? <img src={right.profileImage} alt="" className="past-card-img" /> : <div className="past-card-img past-card-img--placeholder" />}<div className="past-card-half-overlay" /><span className={`past-card-score${c.isDraw ? '' : ' past-card-score--won'}`}>{right.score}</span><a href={`https://x.com/${right.username}`} target="_blank" rel="noopener noreferrer" className="past-card-player-name" onClick={(e) => e.stopPropagation()}>@{right.username}</a></div><div className="past-card-center-label"><span className="past-card-center-text">{c.isDraw ? `Draw \u2014 $${c.payout / 2} returned` : (<><a href={`https://x.com/${winner.username}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>@{winner.username}</a>{` won $${c.payout}`}</>)}</span></div></div>); })}</div></>)}
              </>);
            })()}
          </div>
          <div className="powered-by-starknet"><span>Powered by</span><img src="/starknet-logo.png" alt="Starknet" /></div>
        </div>
        {showWithdraw && <div className="withdraw-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowWithdraw(false); }}><div className="withdraw-modal"><button className="withdraw-close" onClick={() => setShowWithdraw(false)} aria-label="Close">&times;</button><h2 className="withdraw-title">Withdraw USDC</h2><input type="text" className="withdraw-input" placeholder="Destination address (0x...)" value={withdrawRecipient} onChange={(e) => setWithdrawRecipient(e.target.value)} spellCheck={false} autoComplete="off" /><input type="number" className="withdraw-input" placeholder="Amount (USDC)" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} min="0" step="0.01" />{withdrawError && <p className="withdraw-error">{withdrawError}</p>}{withdrawTxHash && <a href={`${VOYAGER_TX_URL}/${withdrawTxHash}`} target="_blank" rel="noopener noreferrer" className="withdraw-success">Withdrawal sent &#8599;</a>}<button className="withdraw-btn" disabled={withdrawing || !withdrawRecipient || !withdrawAmount} onClick={handleWithdraw}>{withdrawing ? 'Sending...' : 'Withdraw'}</button></div></div>}
        {challengePopup && <div className="challenge-popup-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setChallengePopup(null); setChallengePopupDismissed(true); } }}><div className="challenge-popup"><button className="challenge-popup-close" onClick={() => { setChallengePopup(null); setChallengePopupDismissed(true); }}>&times;</button><h3 style={{ color: '#A6A4A7', fontSize: '15px', fontWeight: 800, margin: 0, textAlign: 'center' }}>Challenge from @{challengePopup.username}</h3><div className="challenge-popup-card">{challengePopup.profileImage ? <img src={challengePopup.profileImage} alt="" className="challenge-popup-card-bg" /> : <div className="challenge-popup-card-bg challenge-popup-card-bg--placeholder" />}<div className="challenge-popup-card-overlay" /><div className="challenge-popup-card-content"><span className="blinker-card-stat">Blinked <span className="blinker-card-score-blur">{challengePopup.score}</span> times</span><span className="blinker-card-stake">${challengePopup.stake} USDC at stake</span><a href={`https://x.com/${challengePopup.username}`} target="_blank" rel="noopener noreferrer" className="blinker-card-name" onClick={(e) => e.stopPropagation()}>@{challengePopup.username}</a></div></div><button className="challenge-popup-enter-btn" onClick={() => { setChallengePopup(null); setChallengePopupDismissed(true); if (isConnected) handleAcceptChallenge(challengePopup); else handleLogin(); }}>{isConnected ? 'Enter Challenge' : 'Connect & Enter'}</button></div></div>}
        {error && <div role="alert" style={{ position: 'fixed', bottom: 'max(20px, env(safe-area-inset-bottom, 20px))', left: '50%', transform: 'translateX(-50%)', padding: '14px 20px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '12px', color: '#ef4444', fontSize: '13px', fontWeight: 600, zIndex: 100, fontFamily: "'Manrope', sans-serif", maxWidth: 'calc(100vw - 32px)', display: 'flex', alignItems: 'center', gap: '12px', backdropFilter: 'blur(12px)' }}><span style={{ flex: 1 }}>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '18px', fontWeight: 800, lineHeight: 1, minWidth: '32px', minHeight: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>&times;</button></div>}
      </>
    );
  }

  // ─── Desktop + non-idle mobile render ───
  return (
    <div style={{
      display: 'flex',
      width: '100%',
      height: '100vh',
      overflow: isMobile ? 'auto' : 'hidden',
      background: '#0A0A0A',
      fontFamily: "'Manrope', sans-serif",
      flexDirection: isMobile ? 'column' : 'row',
      touchAction: 'manipulation',
    }}>

      {/* ═══ SIDEBAR — mobile only (desktop uses right sidebar) ═══ */}
      {isMobile && sidebarContent}

      {/* ═══ MAIN AREA ═══ */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: isMobile ? 'auto' : 0,
        overflow: isMobile ? 'visible' : 'hidden',
        position: 'relative',
      }}>

        {/* ─── IDLE: challenge directory ─── */}
        {gamePhase === 'idle' && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            gap: isMobile ? '16px' : '24px',
            padding: isMobile ? '16px 12px 24px' : '36px 32px',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          } as React.CSSProperties}>
            {!isMobile && (
              <div style={{ textAlign: 'center' }}>
                <h1 style={{ fontSize: '36px', fontWeight: 900, color: '#A6A4A7', margin: 0, lineHeight: 1.2 }}>
                  Bet. Blink.<br />Winner takes it all.
                </h1>
              </div>
            )}

            {/* Header row: info + search */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: isMobile ? '10px' : '16px', flexWrap: 'wrap',
              maxWidth: '960px', width: '100%', margin: '0 auto',
              padding: isMobile ? '0 4px' : undefined,
            }}>
              <p className="idle-section-title" style={{ margin: 0 }}>Battle these blinkers</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: isMobile ? '1 1 auto' : undefined, justifyContent: 'flex-end' }}>
                <div className={`info-icon-wrapper${isMobile ? ' info-icon-wrapper--mobile' : ''}`}>
                  <button className="info-icon-btn" aria-label="How it works">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                  </button>
                  <div className="info-tooltip" style={isMobile ? { width: 'calc(100vw - 32px)', right: 0, left: 'auto', position: 'fixed', top: 'auto', marginTop: '8px' } : undefined}>
                    <p className="info-tooltip-title">How it works</p>
                    <ul className="info-tooltip-list">
                      <li>Create or accept a 30-second blink challenge</li>
                      <li>Stake USDC &mdash; winner takes the full pot</li>
                      <li>Opponent&rsquo;s score is hidden until the duel ends</li>
                      <li>Blink detection powered by <a href="https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker" target="_blank" rel="noopener noreferrer">MediaPipe</a>, an open-source eye tracking library by Google</li>
                      <li>No data leaves your device &mdash; webcam processing is 100% local</li>
                      <li>Fully open source: <a href="https://github.com/starkience/winky-starkzap" target="_blank" rel="noopener noreferrer">GitHub</a></li>
                    </ul>
                  </div>
                </div>
                <input
                  type="text"
                  value={blinkerSearch}
                  onChange={(e) => setBlinkerSearch(e.target.value)}
                  placeholder="Search @username"
                  className="challenge-input"
                  spellCheck={false}
                  autoComplete="off"
                  style={{ maxWidth: isMobile ? '160px' : '220px' }}
                />
              </div>
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
                      >
                        <div className={`blinker-card-flipper${isFlipped ? ' blinker-card-flipper--flipped' : ''}`}>
                          {/* Front face */}
                          <div
                            className="blinker-card blinker-card-front"
                            onClick={() => { if (!isOwn && isConnected) setFlippedCardId(isFlipped ? null : c.id); }}
                            style={isOwn ? { cursor: 'default' } : undefined}
                          >
                            {c.profileImage ? (
                              <img src={c.profileImage} alt="" className="blinker-card-bg" />
                            ) : (
                              <div className="blinker-card-bg blinker-card-bg--placeholder" />
                            )}
                            {!isFlipped && (
                              <>
                                <div className="blinker-card-overlay" />
                                <button
                                  className="blinker-card-share-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const url = `${window.location.origin}/?challenge=${c.duelId}`;
                                    navigator.clipboard.writeText(url).then(() => {
                                      setCopiedLinkId(c.id);
                                      setTimeout(() => setCopiedLinkId(prev => prev === c.id ? null : prev), 1500);
                                    });
                                  }}
                                  aria-label="Copy challenge link"
                                >
                                  {copiedLinkId === c.id ? (
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                  ) : (
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                                  )}
                                </button>
                                <div className="blinker-card-content">
                                  {isOwn ? (
                                    <span className="blinker-card-stat">Blinked {c.score} times</span>
                                  ) : (
                                    <span className="blinker-card-stat">
                                      Blinked <span className="blinker-card-score-blur">{c.score}</span> times
                                    </span>
                                  )}
                                  <span className="blinker-card-stake">${c.stake} USDC at stake</span>
                                  <span className="blinker-card-name">{c.username}</span>
                                  {isOwn && (
                                    <span className="blinker-card-waiting">
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
                                <span className="blinker-card-stat">Beat the score</span>
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
                <p className="idle-section-title" style={{ margin: 0, maxWidth: '960px', width: '100%', alignSelf: 'center' }}>Past Challenges</p>
                <div className="blinker-grid">
                  {completedChallenges.slice(0, 9).map(c => {
                    const p1Won = !c.isDraw && c.winnerAddress.replace(/^0x0*/i, '0x').toLowerCase() === c.player1.address.replace(/^0x0*/i, '0x').toLowerCase();
                    const winner = p1Won ? c.player1 : c.player2;
                    const loser = p1Won ? c.player2 : c.player1;
                    const left = c.isDraw ? c.player1 : loser;
                    const right = c.isDraw ? c.player2 : winner;
                    return (
                      <div key={c.duelId} className="past-card">
                        <div className={`past-card-half${c.isDraw ? '' : ' past-card-half--lost'}`}>
                          {left.profileImage ? (
                            <img src={left.profileImage} alt="" className="past-card-img" />
                          ) : (
                            <div className="past-card-img past-card-img--placeholder" />
                          )}
                          <div className="past-card-half-overlay" />
                          <span className={`past-card-score${c.isDraw ? '' : ' past-card-score--lost'}`}>
                            {left.score}
                          </span>
                          <a
                            href={`https://x.com/${left.username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="past-card-player-name"
                            onClick={(e) => e.stopPropagation()}
                          >
                            @{left.username}
                          </a>
                        </div>
                        <div className={`past-card-half${c.isDraw ? '' : ' past-card-half--won'}`}>
                          {right.profileImage ? (
                            <img src={right.profileImage} alt="" className="past-card-img" />
                          ) : (
                            <div className="past-card-img past-card-img--placeholder" />
                          )}
                          <div className="past-card-half-overlay" />
                          <span className={`past-card-score${c.isDraw ? '' : ' past-card-score--won'}`}>
                            {right.score}
                          </span>
                          <a
                            href={`https://x.com/${right.username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="past-card-player-name"
                            onClick={(e) => e.stopPropagation()}
                          >
                            @{right.username}
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
            display: 'flex',
            alignItems: isMobile ? 'center' : 'flex-start',
            gap: isMobile ? '12px' : '16px',
            padding: isMobile ? '10px 12px' : '12px 16px',
            flexShrink: 0,
            flexDirection: isMobile ? 'column' : 'row',
          }}>
            {/* Webcam */}
            <div style={{
              position: 'relative',
              width: isMobile ? '100%' : '176px',
              height: isMobile ? '200px' : '132px',
              borderRadius: '10px', overflow: 'hidden',
              border: '2px solid rgba(255,255,255,0.1)', background: '#111',
              flexShrink: 0,
            }}>
              <video
                ref={(el) => { videoRef.current = el; }}
                autoPlay playsInline muted
                controls={false}
                disablePictureInPicture
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

            {/* Stats / controls to the right of webcam (or below on mobile) */}
            <div style={{
              display: 'flex', flexDirection: 'column',
              justifyContent: 'center',
              minHeight: isMobile ? 'auto' : '132px',
              gap: isMobile ? '12px' : '10px',
              width: isMobile ? '100%' : 'auto',
              alignItems: isMobile ? 'center' : 'flex-start',
            }}>
              {gamePhase === 'playing' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: isMobile ? 'center' : 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <span style={{ fontSize: isMobile ? '48px' : '40px', fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: '#C0B4DA' }}>
                      {blinkCount}
                    </span>
                    <span style={{ fontSize: isMobile ? '13px' : '11px', fontWeight: 800, color: '#555', textTransform: 'uppercase', letterSpacing: '1.5px' }}>blinks</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '12px' : '16px', flexWrap: 'wrap', justifyContent: isMobile ? 'center' : 'flex-start' }}>
                    <span style={{
                      fontSize: isMobile ? '24px' : '22px', fontWeight: 900, fontVariantNumeric: 'tabular-nums',
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
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMobile ? 'center' : 'flex-start', gap: '8px', width: isMobile ? '100%' : 'auto' }}>
                  <button onClick={handleStart} className="game-start-btn" style={isMobile ? { width: '100%', maxWidth: '300px' } : undefined}>
                    START
                  </button>
                  <span style={{ fontSize: '13px', color: '#555', fontWeight: 600, textAlign: 'center' }}>Press to begin your 30s duel</span>
                  <button
                    onClick={handlePlayAgain}
                    style={{
                      marginTop: '4px', background: 'none', border: 'none',
                      color: 'rgba(255,255,255,0.35)', fontSize: '13px', fontWeight: 700,
                      cursor: 'pointer', padding: '8px 16px', minHeight: '36px',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {gamePhase === 'ready' && !cameraReady && (
                <span style={{ fontSize: '14px', color: '#555', fontWeight: 600 }}>Starting camera&#x2026;</span>
              )}
              {gamePhase === 'countdown' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', justifyContent: isMobile ? 'center' : 'flex-start' }}>
                  <span style={{ fontSize: isMobile ? '72px' : '64px', fontWeight: 900, color: '#C0B4DA', lineHeight: 1, textShadow: '0 0 30px rgba(192,180,218,0.4)', animation: 'pulse 1s ease-in-out infinite' }}>
                    {countdownNumber}
                  </span>
                  <span style={{ fontSize: '16px', color: '#666', fontWeight: 700 }}>Get ready&#x2026;</span>
                </div>
              )}
            </div>
          </div>

          {/* Bottom row: tx log (left, under webcam) + chart (right, fills space) */}
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', flex: 1, minHeight: 0 }}>
            {/* Tx log column (same width as webcam, only during playing — hidden on mobile) */}
            {gamePhase === 'playing' && !isMobile && (
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
                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 12px 12px' }}>
                    {blinkTxLog.length === 0 && (
                      <div style={{ padding: '12px', textAlign: 'center', color: '#333', fontSize: '10px' }}>
                        {blinkPendingCount > 0 ? 'Sending\u2026' : 'Blink to record txs'}
                      </div>
                    )}
                    {[...blinkTxLog].reverse().map((tx, idx, arr) => {
                      const fadeRatio = idx / Math.max(arr.length - 1, 1);
                      const opacity = 0.2 + 0.8 * fadeRatio;
                      const isConfirmed = tx.status === 'success';
                      const blinkColor = isConfirmed ? '#22c55e' : '#fff';
                      const isNewest = idx === arr.length - 1;
                      return (
                        <div key={tx.id} className="ranked-tx-row" style={{
                          padding: '8px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px',
                          opacity, cursor: tx.hash ? 'pointer' : 'default',
                          animation: isNewest ? 'tx-slide-in 0.25s ease-out' : undefined,
                        }}
                          onClick={() => { if (tx.hash) window.open(`${VOYAGER_TX_URL}/${tx.hash}`, '_blank'); }}>
                          <div style={{ minWidth: 0, overflow: 'hidden' }}>
                            <span className={isConfirmed ? 'ranked-tx-blink-label' : undefined} style={{ fontSize: '14px', fontWeight: 800, color: blinkColor, display: 'block', marginBottom: '2px', transition: 'color 0.15s' }}>Blink #{tx.blinkNumber}</span>
                            {tx.hash ? (
                              <span className="ranked-tx-hash" style={{ fontSize: '11px', fontWeight: 600, color: isConfirmed ? 'rgba(34,197,94,0.5)' : '#666', textDecoration: 'none', fontFamily: "'SF Mono', Monaco, monospace", transition: 'color 0.15s, text-decoration-color 0.15s' }}>{formatAddress(tx.hash)}</span>
                            ) : (
                              <span style={{ fontSize: '11px', fontWeight: 600, color: '#555', fontStyle: 'italic' }}>{tx.status === 'pending' ? 'sending\u2026' : tx.status === 'error' ? 'failed' : tx.status}</span>
                            )}
                          </div>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: '#444', whiteSpace: 'nowrap', flexShrink: 0, paddingTop: '2px' }}>{formatTimeAgo(tx.timestamp)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Chart area */}
            <div style={{ flex: 1, position: 'relative', minWidth: 0, minHeight: isMobile ? '180px' : 0 }}>
              {(gamePhase === 'playing' || chartData.length > 1) ? (
                <div style={{ position: isMobile ? 'relative' : 'absolute', inset: isMobile ? undefined : 0, padding: isMobile ? '8px 12px 12px' : '0 8px 8px 0', height: isMobile ? '180px' : undefined }}>
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
          <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: 0, overflow: isMobile ? 'auto' : 'hidden', WebkitOverflowScrolling: 'touch' }}>
            {/* Left column: tx log (hidden on mobile) */}
            <div style={{
              width: '192px', minWidth: '192px', display: isMobile ? 'none' : 'flex', flexDirection: 'column',
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
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 12px 12px' }}>
                  {blinkTxLog.length === 0 && (
                    <div style={{ padding: '12px', textAlign: 'center', color: '#333', fontSize: '10px' }}>No transactions</div>
                  )}
                  {[...blinkTxLog].reverse().map((tx, idx, arr) => {
                    const fadeRatio = idx / Math.max(arr.length - 1, 1);
                    const opacity = 0.2 + 0.8 * fadeRatio;
                    const isConfirmed = tx.status === 'success';
                    const blinkColor = isConfirmed ? '#22c55e' : '#fff';
                    const isNewest = idx === arr.length - 1;
                    return (
                      <div key={tx.id} className="ranked-tx-row" style={{
                        padding: '8px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px',
                        opacity, cursor: tx.hash ? 'pointer' : 'default',
                        animation: isNewest ? 'tx-slide-in 0.25s ease-out' : undefined,
                      }}
                        onClick={() => { if (tx.hash) window.open(`${VOYAGER_TX_URL}/${tx.hash}`, '_blank'); }}>
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                          <span className={isConfirmed ? 'ranked-tx-blink-label' : undefined} style={{ fontSize: '14px', fontWeight: 800, color: blinkColor, display: 'block', marginBottom: '2px', transition: 'color 0.15s' }}>Blink #{tx.blinkNumber}</span>
                          {tx.hash ? (
                            <span className="ranked-tx-hash" style={{ fontSize: '11px', fontWeight: 600, color: isConfirmed ? 'rgba(34,197,94,0.5)' : '#666', textDecoration: 'none', fontFamily: "'SF Mono', Monaco, monospace", transition: 'color 0.15s, text-decoration-color 0.15s' }}>{formatAddress(tx.hash)}</span>
                          ) : (
                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#555', fontStyle: 'italic' }}>{tx.status === 'pending' ? 'sending\u2026' : tx.status === 'error' ? 'failed' : tx.status}</span>
                          )}
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#444', whiteSpace: 'nowrap', flexShrink: 0, paddingTop: '2px' }}>{formatTimeAgo(tx.timestamp)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right area: result content */}
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: isMobile ? 'flex-start' : 'center',
              gap: isMobile ? '20px' : '24px',
              padding: isMobile ? '16px 12px 32px' : '32px',
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
            }}>
              {/* ── Flow 1: Challenge created ── */}
              {gameMode === 'create' && (
                <>
                  <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#C0B4DA', margin: 0 }}>
                    Challenge Posted!
                  </h2>

                  {/* Score + Stake row */}
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: '500px' }}>
                    <div style={{
                      flex: '1 1 140px', padding: '24px 28px', background: '#141414', borderRadius: '14px',
                      border: '2px solid rgba(192,180,218,0.2)', textAlign: 'center', minWidth: '140px',
                      display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    }}>
                      <p style={{ fontSize: '10px', color: '#666', fontWeight: 800, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '2px' }}>Your Blinks</p>
                      <p style={{ fontSize: '48px', fontWeight: 900, color: '#C0B4DA', margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{finalScore}</p>
                    </div>
                    <div style={{
                      flex: '2 1 200px', padding: '20px 24px', borderRadius: '14px',
                      background: 'rgba(192,180,218,0.06)', border: '1px solid rgba(192,180,218,0.15)',
                      display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    }}>
                      <p style={{ fontSize: '16px', fontWeight: 800, color: '#A6A4A7', margin: 0 }}>
                        ${selectedBet} at stake
                      </p>
                      <p style={{ fontSize: '12px', fontWeight: 500, color: '#555', margin: '6px 0 0', lineHeight: 1.5 }}>
                        your challenge is now live. Anyone can accept and try to beat your {finalScore} blinks!
                      </p>
                      {duelTxHash && VOYAGER_TX_URL && (
                        <a
                          href={`${VOYAGER_TX_URL}/${duelTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-block', marginTop: '10px', padding: '5px 12px', fontSize: '10px', fontWeight: 700,
                            color: '#C0B4DA', background: 'rgba(192,180,218,0.1)', borderRadius: '6px', textDecoration: 'none',
                            border: '1px solid rgba(192,180,218,0.15)', alignSelf: 'flex-start',
                          }}
                        >
                          View txn on Voyager &#x2197;
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Chart */}
                  {chartData.length > 1 && (
                    <div style={{ width: '100%', maxWidth: '500px', background: '#111', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)', padding: '16px' }}>
                      <BlinkChart data={chartData} height={140} />
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{
                    display: 'flex', gap: isMobile ? '10px' : '10px',
                    flexWrap: 'wrap', justifyContent: 'center',
                    width: isMobile ? '100%' : 'auto',
                    flexDirection: isMobile ? 'column' : 'row',
                    alignItems: 'center',
                  }}>
                    <button
                      className="share-popup-download-btn"
                      style={isMobile ? { width: '100%', maxWidth: '300px', justifyContent: 'center' } : undefined}
                      onClick={() => downloadChallengeCard({
                        score: finalScore,
                        stake: selectedBet,
                        username: twitterUsername || formatAddress(walletAddress || ''),
                        profileImage: fullSizeTwitterImage(user?.twitter?.profilePictureUrl),
                      })}
                    >
                      &#x2B07; Download Card
                    </button>
                    <a
                      href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                        `I just blinked ${finalScore} times. Can you out-blink me in 30 seconds?\n\nWinner wins it all: $${selectedBet * 2} USDC\n\nBlink here: https://winky-starkzap.vercel.app`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="share-popup-btn"
                      style={isMobile ? { width: '100%', maxWidth: '300px', justifyContent: 'center' } : undefined}
                    >
                      Share on <svg viewBox="0 0 24 24" className="share-popup-x-icon" aria-label="X"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                    </a>
                    <button onClick={handlePlayAgain} className="result-play-again-btn" style={isMobile ? { width: '100%', maxWidth: '300px', margin: 0 } : { margin: 0 }}>
                      Back to Home
                    </button>
                  </div>
                </>
              )}

              {/* ── Flow 2: Challenge result (vs opponent) ── */}
              {gameMode === 'challenge' && challengeTarget && (
                <>
                  <h2 style={{ fontSize: '28px', fontWeight: 900, color: '#A6A4A7', margin: 0, alignSelf: 'flex-start' }}>
                    Time&apos;s Up!
                  </h2>

                  {/* Score cards + result card row */}
                  <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: '640px' }}>
                    {/* Your Blinks */}
                    <div style={{
                      flex: '1 1 140px', padding: '24px 28px', background: '#141414', borderRadius: '14px',
                      border: '2px solid rgba(192,180,218,0.2)', textAlign: 'center', minWidth: '130px',
                      display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    }}>
                      <p style={{ fontSize: '10px', color: '#666', fontWeight: 800, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '2px' }}>Your Blinks</p>
                      <p style={{ fontSize: '48px', fontWeight: 900, color: '#C0B4DA', margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{finalScore}</p>
                    </div>
                    {/* Opponent */}
                    <div style={{
                      flex: '1 1 140px', padding: '24px 28px', background: '#141414', borderRadius: '14px',
                      border: '2px solid rgba(255,255,255,0.06)', textAlign: 'center', minWidth: '130px',
                      display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    }}>
                      <p style={{ fontSize: '10px', color: '#666', fontWeight: 800, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '2px' }}>{challengeTarget.username}</p>
                      <p style={{ fontSize: '48px', fontWeight: 900, color: '#A6A4A7', margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{challengeTarget.score}</p>
                    </div>
                    {/* Result card */}
                    {resolving ? (
                      <div style={{
                        flex: '1 1 160px', padding: '24px 28px', background: '#141414', borderRadius: '14px',
                        border: '2px solid rgba(255,255,255,0.06)', textAlign: 'center', minWidth: '160px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px',
                      }}>
                        <div className="spinner" />
                        <p style={{ fontSize: '12px', color: '#555', fontWeight: 600, margin: 0 }}>Resolving&#x2026;</p>
                      </div>
                    ) : (
                      <div style={{
                        flex: '1 1 160px', padding: '20px 24px', borderRadius: '14px', textAlign: 'center', minWidth: '160px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        background: isWinner ? 'rgba(34,197,94,0.08)' : isDraw ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)',
                        border: `2px solid ${isWinner ? 'rgba(34,197,94,0.25)' : isDraw ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.25)'}`,
                      }}>
                        <p style={{ fontSize: '28px', fontWeight: 900, margin: 0, color: isWinner ? '#22c55e' : isDraw ? '#f59e0b' : '#ef4444' }}>
                          {isWinner ? 'You Win!' : isDraw ? 'Draw!' : 'You Lose'}
                        </p>
                        <p style={{ fontSize: '14px', fontWeight: 700, margin: '6px 0 0', color: isWinner ? '#22c55e' : isDraw ? '#f59e0b' : '#ef4444' }}>
                          {isWinner ? `+$${(selectedBet * 2).toFixed(2)} USDC` : isDraw ? 'Bet returned' : `\u2212$${selectedBet} USDC`}
                        </p>
                        {duelTxHash && VOYAGER_TX_URL && (
                          <a
                            href={`${VOYAGER_TX_URL}/${duelTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-block', marginTop: '10px', padding: '4px 10px', fontSize: '10px', fontWeight: 700,
                              color: isWinner ? '#22c55e' : isDraw ? '#f59e0b' : '#ef4444',
                              background: isWinner ? 'rgba(34,197,94,0.1)' : isDraw ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                              borderRadius: '6px', textDecoration: 'none',
                              border: `1px solid ${isWinner ? 'rgba(34,197,94,0.2)' : isDraw ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)'}`,
                            }}
                          >
                            View duel on Voyager &#x2197;
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Chart */}
                  {chartData.length > 1 && (
                    <div style={{ width: '100%', maxWidth: '640px', background: '#111', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)', padding: '16px' }}>
                      <BlinkChart data={chartData} height={140} />
                    </div>
                  )}

                  {/* Action buttons */}
                  {!resolving && (
                    <div style={{
                      display: 'flex', gap: '10px',
                      flexWrap: 'wrap', justifyContent: 'center',
                      width: isMobile ? '100%' : 'auto',
                      flexDirection: isMobile ? 'column' : 'row',
                      alignItems: 'center',
                    }}>
                      {isWinner && (
                        <>
                          <button
                            className="share-popup-download-btn"
                            style={isMobile ? { width: '100%', maxWidth: '300px', justifyContent: 'center' } : undefined}
                            onClick={() => downloadWinCard({
                              winnerUsername: twitterUsername || formatAddress(walletAddress || ''),
                              winnerScore: finalScore,
                              winnerImage: fullSizeTwitterImage(user?.twitter?.profilePictureUrl),
                              loserUsername: challengeTarget.username,
                              loserScore: challengeTarget.score,
                              loserImage: challengeTarget.profileImage,
                              payout: selectedBet * 2,
                            })}
                          >
                            &#x2B07; Download Card
                          </button>
                          <a
                            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                              `I just beat @${challengeTarget.username} with ${finalScore} blinks and won $${selectedBet * 2} USDC\n\nPvP blink today: https://winky-starkzap.vercel.app`
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="share-popup-btn"
                            style={isMobile ? { width: '100%', maxWidth: '300px', justifyContent: 'center' } : undefined}
                          >
                            Share on <svg viewBox="0 0 24 24" className="share-popup-x-icon" aria-label="X"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                          </a>
                        </>
                      )}
                      <button onClick={handlePlayAgain} className="result-play-again-btn" style={isMobile ? { width: '100%', maxWidth: '300px', margin: 0 } : { margin: 0 }}>
                        Back to Home
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ═══ SIDEBAR (on desktop renders after main) ═══ */}
      {!isMobile && sidebarContent}

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

      {/* Challenge deep-link popup */}
      {challengePopup && (
        <div className="challenge-popup-overlay" onClick={() => { setChallengePopup(null); setChallengePopupDismissed(true); }}>
          <div className="challenge-popup" onClick={(e) => e.stopPropagation()}>
            <button className="challenge-popup-close" onClick={() => { setChallengePopup(null); setChallengePopupDismissed(true); }}>&times;</button>
            <div className="challenge-popup-card">
              {challengePopup.profileImage ? (
                <img src={challengePopup.profileImage} alt="" className="challenge-popup-card-bg" />
              ) : (
                <div className="challenge-popup-card-bg challenge-popup-card-bg--placeholder" />
              )}
              <div className="challenge-popup-card-overlay" />
              <div className="challenge-popup-card-content">
                <span className="blinker-card-stat">
                  Blinked <span className="blinker-card-score-blur">{challengePopup.score}</span> times
                </span>
                <span className="blinker-card-stake">${challengePopup.stake} USDC at stake</span>
                <a
                  href={`https://x.com/${challengePopup.username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="blinker-card-name"
                  onClick={(e) => e.stopPropagation()}
                >
                  @{challengePopup.username}
                </a>
              </div>
            </div>
            <button
              className="challenge-popup-enter-btn"
              onClick={() => {
                setChallengePopup(null);
                setChallengePopupDismissed(true);
                if (isConnected) {
                  handleAcceptChallenge(challengePopup);
                } else {
                  handleLogin();
                }
              }}
            >
              {isConnected ? 'Enter Challenge' : 'Connect & Enter'}
            </button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: isMobile ? 'max(20px, env(safe-area-inset-bottom, 20px))' : '20px',
            left: '50%', transform: 'translateX(-50%)',
            padding: '14px 20px', background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.25)', borderRadius: '12px',
            color: '#ef4444', fontSize: '13px', fontWeight: 600, zIndex: 100,
            fontFamily: "'Manrope', sans-serif", maxWidth: isMobile ? 'calc(100vw - 32px)' : '90vw',
            display: 'flex', alignItems: 'center', gap: '12px',
            backdropFilter: 'blur(12px)',
          }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            style={{
              background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer',
              fontSize: '18px', fontWeight: 800, lineHeight: 1,
              minWidth: '32px', minHeight: '32px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >&times;</button>
        </div>
      )}
    </div>
  );
}
