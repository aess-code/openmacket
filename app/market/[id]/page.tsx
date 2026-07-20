"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  useReadContracts,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { sepolia } from "wagmi/chains";
import { useQueryClient } from "@tanstack/react-query";
import { MARKET_ABI, USDT_ABI, USDT_ADDRESS, YES, NO } from "../../../constants";
import { parseUnits, formatUnits, Address } from "viem";
import { toast } from "sonner";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Share2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Lock,
  Clock,
  Trophy,
  AlertTriangle,
  X,
  Sparkles,
  ExternalLink,
  Info,
} from "lucide-react";
import Header from "../../../components/Header";

type TradeTab = "buy" | "sell";
type Side = "yes" | "no";

const STATUS_OPEN = 0;
const STATUS_CLOSING = 1;
const STATUS_SETTLED = 2;

// ── 链上交易确认进度条组件 ──────────────────────────────────────────────────
function TxProgressBar({ isPending, isConfirming }: { isPending: boolean; isConfirming: boolean }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isPending && !isConfirming) {
      setProgress(0);
      return;
    }
    if (isPending) setProgress(25);
    if (isConfirming) setProgress(70);

    const interval = setInterval(() => {
      setProgress((p) => {
        if (isPending && p < 35) return p + 2;
        if (isConfirming && p < 92) return p + 1;
        return p;
      });
    }, 300);
    return () => clearInterval(interval);
  }, [isPending, isConfirming]);

  if (!isPending && !isConfirming) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-1 bg-zinc-800/80">
      <div
        className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(99,102,241,0.5)]"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

// ── 发起关闭视图二次确认弹窗 ──────────────────────────────────────────────────
function ConfirmCloseModal({
  onConfirm,
  onCancel,
  isLoading,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-zinc-900 border border-zinc-700/80 rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start gap-3.5 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white mb-1">Request to Close View</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              This action is <span className="text-amber-400 font-semibold">irreversible</span>. A{" "}
              <span className="text-white font-semibold">21-day</span> waiting period will begin where trading remains open.
              Settlement happens automatically after 21 days based on the final confidence index.
            </p>
          </div>
        </div>
        <div className="flex gap-2.5 pt-2">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 py-2.5 rounded-xl text-xs font-semibold bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-amber-500 text-black hover:bg-amber-400 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {isLoading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Submitting...</>
            ) : "Confirm Close"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 结算奖励/退款领取弹窗 ──────────────────────────────────────────────────────
function ClaimRewardModal({
  amount,
  yesWins,
  isTie,
  onClaim,
  onDismiss,
  isLoading,
  isSuccess,
  question,
}: {
  amount: string;
  yesWins: boolean;
  isTie: boolean;
  onClaim: () => void;
  onDismiss: () => void;
  isLoading: boolean;
  isSuccess: boolean;
  question?: string;
}) {
  if (isSuccess) {
    const shareText = isTie
      ? `I staked on "${question || "a Pulse View"}" and got a full refund!`
      : `I staked on "${question || "a Pulse View"}" and won +${amount} USDT! 🎉`;
    const shareUrl = typeof window !== "undefined" ? window.location.href : "";
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;

    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onDismiss} />
        <div className="relative w-full sm:max-w-sm bg-zinc-900 border border-zinc-700/80 rounded-t-3xl sm:rounded-2xl p-6 pb-8 sm:pb-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
          <button
            onClick={onDismiss}
            className="absolute top-4 right-4 p-1.5 rounded-xl text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex justify-center mb-4 pt-2">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center animate-bounce">
              <CheckCircle2 className="w-9 h-9 text-emerald-400" />
            </div>
          </div>
          <div className="text-center mb-5">
            <h2 className="text-lg font-bold text-white mb-1">Claim Successful!</h2>
            <p className="text-2xl font-extrabold text-emerald-400 mb-1">+{amount} USDT</p>
            <p className="text-xs text-zinc-400">Tokens transferred to your wallet</p>
          </div>
          <div className="space-y-2">
            <a
              href={twitterUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 bg-[#1d9bf0] hover:bg-[#1a8cd8] text-white py-3 rounded-xl text-xs font-bold transition-all shadow-md active:scale-[0.98]"
            >
              <ExternalLink className="w-4 h-4" />
              Share on X (Twitter)
            </a>
            <button
              onClick={onDismiss}
              className="w-full py-2.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onDismiss} />
      <div className="relative w-full sm:max-w-sm bg-zinc-900 border border-zinc-700/80 rounded-t-3xl sm:rounded-2xl p-6 pb-8 sm:pb-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 p-1.5 rounded-xl text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex justify-center mb-4 pt-2">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border ${
            isTie
              ? "bg-zinc-800 border-zinc-700"
              : yesWins
              ? "bg-emerald-500/15 border-emerald-500/30"
              : "bg-rose-500/15 border-rose-500/30"
          }`}>
            {isTie ? (
              <span className="text-3xl">🤝</span>
            ) : (
              <Trophy className={`w-8 h-8 ${yesWins ? "text-emerald-400" : "text-rose-400"}`} />
            )}
          </div>
        </div>
        <div className="text-center mb-3">
          <h2 className="text-lg font-bold text-white mb-1">
            {isTie ? "It's a Tie — Full Refund" : yesWins ? "YES Side Won!" : "NO Side Won!"}
          </h2>
          <p className="text-xs text-zinc-400 leading-relaxed px-2">
            {isTie
              ? "Confidence ratio is exactly 50%. Your original stake is ready for refund."
              : "Market has settled. Your side prediction was correct — claim your payout now."}
          </p>
        </div>
        <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-4 my-4 text-center">
          <p className="text-xs text-zinc-500 mb-1">
            {isTie ? "Refundable Amount" : "Claimable Payout"}
          </p>
          <p className="text-2xl font-bold text-emerald-400">{amount} <span className="text-sm text-zinc-400">USDT</span></p>
        </div>
        <button
          onClick={onClaim}
          disabled={isLoading}
          className="w-full bg-emerald-500 hover:bg-emerald-400 text-black py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-lg active:scale-[0.98] disabled:opacity-50"
        >
          {isLoading ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Confirm in wallet...</>
          ) : (
            <><Sparkles className="w-4 h-4" />{isTie ? "Claim Refund" : "Claim Rewards"}</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── 主页面组件 ──────────────────────────────────────────────────────────────────
export default function MarketDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const marketAddress = params.id as Address;
  const { address: userAddress, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();
  const isWrongChain = isConnected && chainId !== sepolia.id;

  const queryClient = useQueryClient();

  // ── 新建市场成功欢迎提示 ──
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(
    () => searchParams.get("new") === "true"
  );
  useEffect(() => {
    if (!showWelcomeBanner) return;
    const timer = setTimeout(() => setShowWelcomeBanner(false), 6_000);
    return () => clearTimeout(timer);
  }, [showWelcomeBanner]);

  // ── 交易交互 State ──
  const [tab, setTab] = useState<TradeTab>("buy");
  const [side, setSide] = useState<Side>("yes");
  const [amount, setAmount] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimModalDismissed, setClaimModalDismissed] = useState(false);
  const [claimJustSucceeded, setClaimJustSucceeded] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  // ── 使用 Ref 解决 useEffect 闭包与依赖数组变更陷阱 ──
  const isApprovingRef = useRef(isApproving);
  const isClaimingRef = useRef(isClaiming);
  useEffect(() => { isApprovingRef.current = isApproving; }, [isApproving]);
  useEffect(() => { isClaimingRef.current = isClaiming; }, [isClaiming]);

  // ── 读取市场合约多项数据 ──
  const { data: marketReads, isLoading: isMarketLoading, refetch: refetchMarket } = useReadContracts({
    contracts: [
      { address: marketAddress, abi: MARKET_ABI, functionName: "question" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "description" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "getConfidence" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "getTVL" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "status" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "createdAt" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "creator" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "timeUntilSettlement" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "settledYesWins" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "isTie" },
    ],
    query: { refetchInterval: 8_000 },
  });

  const question        = marketReads?.[0]?.result as string | undefined;
  const description     = marketReads?.[1]?.result as string | undefined;
  const confidence      = marketReads?.[2]?.result as bigint | undefined;
  const tvl             = marketReads?.[3]?.result as bigint | undefined;
  const status          = marketReads?.[4]?.result as number | undefined;
  const createdAt       = marketReads?.[5]?.result as bigint | undefined;
  const creator         = marketReads?.[6]?.result as Address | undefined;
  const timeUntilSettle = marketReads?.[7]?.result as bigint | undefined;
  const settledYesWins  = marketReads?.[8]?.result as boolean | undefined;
  const isTie           = marketReads?.[9]?.result as boolean | undefined;

  // ── 数值解析与精度修正 ──
  const confidencePercent = useMemo(() => {
    if (confidence === undefined) return 50;
    const rawNum = Number(confidence);
    const val = rawNum > 100 ? rawNum / 100 : rawNum;
    return Math.min(100, Math.max(0, val));
  }, [confidence]);

  // TVL 使用 6 位小数解析
  const tvlFormatted = useMemo(() => {
    if (tvl === undefined) return "0.00";
    try {
      return parseFloat(formatUnits(tvl, 6)).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      return "0.00";
    }
  }, [tvl]);

  const daysLeft = useMemo(() => {
    if (timeUntilSettle === undefined || timeUntilSettle <= 0n) return 0;
    return Math.ceil(Number(timeUntilSettle) / 86400);
  }, [timeUntilSettle]);

  // ── 读取用户持仓与可领取金额 ──
  const { data: userPosition, refetch: refetchPosition } = useReadContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "getUserPosition",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress, refetchInterval: 8_000 },
  });

  const [yesBal, noBal, yesValue, noValue] = useMemo(() => {
    if (!userPosition || !Array.isArray(userPosition) || userPosition.length < 4) {
      return [0n, 0n, 0n, 0n];
    }
    return userPosition as [bigint, bigint, bigint, bigint];
  }, [userPosition]);

  const yesValueFormatted = useMemo(() => parseFloat(formatUnits(yesValue, 6)).toFixed(2), [yesValue]);
  const noValueFormatted  = useMemo(() => parseFloat(formatUnits(noValue, 6)).toFixed(2),  [noValue]);

  const { data: claimAmount, refetch: refetchClaimAmount } = useReadContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "getClaimAmount",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress && status === STATUS_SETTLED, refetchInterval: 8_000 },
  });

  const { data: hasClaimed, refetch: refetchHasClaimed } = useReadContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "claimed",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress && status === STATUS_SETTLED },
  });

  const claimAmountFormatted = useMemo(() => {
    if (!claimAmount) return "0.00";
    try {
      return parseFloat(formatUnits(claimAmount as bigint, 6)).toFixed(2);
    } catch {
      return "0.00";
    }
  }, [claimAmount]);
  // ── 自动触发结算后 Claim 弹窗 ──
  useEffect(() => {
    if (
      status === STATUS_SETTLED &&
      isConnected &&
      !hasClaimed &&
      !claimModalDismissed &&
      claimAmount !== undefined &&
      (claimAmount as bigint) > 0n
    ) {
      const timer = setTimeout(() => setShowClaimModal(true), 600);
      return () => clearTimeout(timer);
    }
  }, [status, isConnected, hasClaimed, claimModalDismissed, claimAmount]);

  // ── 读取 USDT 余额与授权额度 ──
  const { data: usdtBalance, refetch: refetchUsdtBalance } = useReadContract({
    address: USDT_ADDRESS,
    abi: USDT_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress, refetchInterval: 8_000 },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDT_ADDRESS,
    abi: USDT_ABI,
    functionName: "allowance",
    args: userAddress ? [userAddress, marketAddress] : undefined,
    query: { enabled: !!userAddress, refetchInterval: 5_000 },
  });

  const usdtBalanceFormatted = useMemo(() => {
    if (!usdtBalance) return "0.00";
    return parseFloat(formatUnits(usdtBalance as bigint, 6)).toFixed(2);
  }, [usdtBalance]);

  const amountBigInt = useMemo(() => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return 0n;
    try {
      return parseUnits(amount, 6);
    } catch {
      return 0n;
    }
  }, [amount]);

  const needsApproval = useMemo(() => {
    if (tab !== "buy" || amountBigInt === 0n) return false;
    const currentAllowance = (allowance as bigint) || 0n;
    return currentAllowance < amountBigInt;
  }, [tab, allowance, amountBigInt]);

  const isInsufficientBalance = useMemo(() => {
    if (!amountBigInt || amountBigInt === 0n) return false;
    if (tab === "buy") {
      const userUsdt = (usdtBalance as bigint) || 0n;
      return amountBigInt > userUsdt;
    } else {
      const userPos = side === "yes" ? yesBal : noBal;
      return amountBigInt > userPos;
    }
  }, [amountBigInt, tab, usdtBalance, side, yesBal, noBal]);

  // ── 写合约与交易回执监听 ──
  const { writeContractAsync, isPending, data: txHash, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const isProcessing = isPending || isConfirming;

  useEffect(() => {
    if (!isConfirmed) return;

    const wasApproving = isApprovingRef.current;
    const wasClaiming  = isClaimingRef.current;

    if (wasApproving) {
      toast.success("USDT Approval confirmed!");
      setIsApproving(false);
      refetchAllowance();
    } else if (wasClaiming) {
      setClaimJustSucceeded(true);
      setIsClaiming(false);
      toast.success("Reward successfully claimed!");
      refetchClaimAmount();
      refetchHasClaimed();
    } else {
      toast.success("Transaction successfully executed!");
      setAmount("");
    }

    refetchMarket();
    refetchPosition();
    refetchUsdtBalance();
    queryClient.invalidateQueries();

    const timer = setTimeout(() => reset(), 300);
    return () => clearTimeout(timer);
  }, [isConfirmed]);

  const handleApprove = async () => {
    if (!amountBigInt || amountBigInt === 0n) return;
    setIsApproving(true);
    try {
      await writeContractAsync({
        address: USDT_ADDRESS,
        abi: USDT_ABI,
        functionName: "approve",
        args: [marketAddress, amountBigInt * 10n],
      });
      toast.info("USDT Approval transaction submitted...");
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      toast.error(e.shortMessage || e.message || "Approval failed");
      setIsApproving(false);
    }
  };

  const handleTrade = async () => {
    if (!amountBigInt || amountBigInt === 0n) {
      toast.error("Please enter a valid amount");
      return;
    }
    if (isInsufficientBalance) {
      toast.error(tab === "buy" ? "Insufficient USDT balance" : "Insufficient share position");
      return;
    }

    const sideValue = BigInt(side === "yes" ? YES : NO);
    try {
      if (tab === "buy") {
        await writeContractAsync({
          address: marketAddress,
          abi: MARKET_ABI,
          functionName: "buy",
          args: [sideValue, amountBigInt],
        });
        toast.info("Buy transaction submitted...");
      } else {
        await writeContractAsync({
          address: marketAddress,
          abi: MARKET_ABI,
          functionName: "sell",
          args: [sideValue, amountBigInt],
        });
        toast.info("Sell transaction submitted...");
      }
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      toast.error(e.shortMessage || e.message || "Transaction failed");
    }
  };

  const handleRequestClose = async () => {
    setShowCloseConfirm(false);
    try {
      await writeContractAsync({
        address: marketAddress,
        abi: MARKET_ABI,
        functionName: "initiateClose",
      });
      toast.info("Close request submitted. 21-day window initiated...");
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      toast.error(e.shortMessage || e.message || "Initiate close failed");
    }
  };

  const handleSettle = async () => {
    try {
      await writeContractAsync({
        address: marketAddress,
        abi: MARKET_ABI,
        functionName: "settle",
      });
      toast.info("Settlement transaction submitted...");
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      toast.error(e.shortMessage || e.message || "Settlement failed");
    }
  };

  const handleClaim = async () => {
    setIsClaiming(true);
    try {
      await writeContractAsync({
        address: marketAddress,
        abi: MARKET_ABI,
        functionName: "claim",
      });
      toast.info("Claim transaction submitted...");
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      toast.error(e.shortMessage || e.message || "Claim failed");
      setIsClaiming(false);
    }
  };

  const handleShare = () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: question || "Pulse Market View", url }).catch(() => {
        navigator.clipboard.writeText(url).then(() => toast.success("Link copied to clipboard"));
      });
    } else {
      navigator.clipboard.writeText(url).then(() => toast.success("Link copied to clipboard"));
    }
  };

  const isCreator = userAddress && creator && userAddress.toLowerCase() === creator.toLowerCase();

  const handleSetPercentage = (pct: number) => {
    let maxRaw = 0;
    if (tab === "buy") {
      maxRaw = usdtBalance ? parseFloat(formatUnits(usdtBalance as bigint, 6)) : 0;
    } else {
      const rawPos = side === "yes" ? yesBal : noBal;
      maxRaw = rawPos ? parseFloat(formatUnits(rawPos, 6)) : 0;
    }
    if (maxRaw <= 0) return;
    const calculated = (maxRaw * (pct / 100)).toFixed(4).replace(/\.?0+$/, "");
    setAmount(calculated || "0");
  };

  if (isMarketLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
        <Header />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-24">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          <p className="text-xs text-zinc-500 font-medium">Loading Market Data...</p>
        </div>
      </div>
    );
  }

  const StatusBadge = () => {
    if (status === STATUS_SETTLED) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400 bg-zinc-800/80 border border-zinc-700/50 px-2.5 py-1 rounded-full font-medium">
          <Lock className="w-3 h-3 text-zinc-400" />Settled
        </span>
      );
    }
    if (status === STATUS_CLOSING) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full font-medium">
          <Clock className="w-3 h-3" />
          {daysLeft > 0 ? `Closing in ${daysLeft}d` : "Pending Settlement"}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full font-medium">
        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />Active Trading
      </span>
    );
  };

  const SettlementBanner = () => {
    if (status !== STATUS_SETTLED) return null;

    if (isTie) {
      return (
        <div className="bg-zinc-900 border border-zinc-700/80 rounded-xl p-4 mb-4 flex items-start gap-3">
          <span className="text-2xl">🤝</span>
          <div>
            <p className="text-sm font-bold text-white">Settled: Tie (1:1 Refund)</p>
            <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
              Confidence index remained exactly at 50%. All participants are eligible for a 100% USDT stake refund.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className={`border rounded-xl p-4 mb-4 flex items-start gap-3 ${
        settledYesWins
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
          : "bg-rose-500/10 border-rose-500/30 text-rose-300"
      }`}>
        <Trophy className={`w-5 h-5 flex-shrink-0 mt-0.5 ${settledYesWins ? "text-emerald-400" : "text-rose-400"}`} />
        <div>
          <p className="text-sm font-bold text-white">
            Settled: Outcome <span className={settledYesWins ? "text-emerald-400" : "text-rose-400"}>{settledYesWins ? "YES" : "NO"}</span> Won
          </p>
          <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
            {settledYesWins
              ? "Final confidence > 50%. Winning YES holders receive proportional rewards from the NO pool."
              : "Final confidence < 50%. Winning NO holders receive proportional rewards from the YES pool."}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500 selection:text-white">
      <TxProgressBar isPending={isPending} isConfirming={isConfirming} />
      <Header />

      {showCloseConfirm && (
        <ConfirmCloseModal
          onConfirm={handleRequestClose}
          onCancel={() => setShowCloseConfirm(false)}
          isLoading={isProcessing}
        />
      )}

      {showClaimModal && !hasClaimed && (
        <ClaimRewardModal
          amount={claimAmountFormatted}
          yesWins={settledYesWins ?? false}
          isTie={isTie ?? false}
          onClaim={handleClaim}
          onDismiss={() => {
            if (claimJustSucceeded) setClaimJustSucceeded(false);
            setShowClaimModal(false);
            setClaimModalDismissed(true);
          }}
          isLoading={isProcessing}
          isSuccess={claimJustSucceeded}
          question={question}
        />
      )}

      <main className="max-w-2xl mx-auto px-4 pb-24">
        <div className="pt-6 mb-5">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-white transition-colors group"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            Back to All Views
          </Link>
        </div>

        {showWelcomeBanner && (
          <div className="mb-5 flex items-center justify-between gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-xs font-bold text-emerald-300">Market View Live on-chain!</p>
                <p className="text-xs text-emerald-400/80">Share this page to invite traders to back your market.</p>
              </div>
            </div>
            <button
              onClick={() => setShowWelcomeBanner(false)}
              className="text-emerald-500/60 hover:text-emerald-300 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 sm:p-6 mb-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 mb-4">
            <StatusBadge />
            <div className="flex items-center gap-2">
              {isCreator && status === STATUS_OPEN && (
                <button
                  onClick={() => setShowCloseConfirm(true)}
                  disabled={isProcessing || isWrongChain}
                  className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-amber-400 hover:bg-amber-500/10 px-2.5 py-1 rounded-lg border border-transparent hover:border-amber-500/20 transition-all disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />Initiate Close
                </button>
              )}
              {status === STATUS_CLOSING && daysLeft === 0 && (
                <button
                  onClick={handleSettle}
                  disabled={isProcessing || isWrongChain}
                  className="flex items-center gap-1.5 text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 px-3 py-1 rounded-lg transition-all disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
                  Trigger Settlement
                </button>
              )}
              <button
                onClick={handleShare}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
                title="Share View"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <h1 className="text-xl font-bold text-white leading-snug mb-2">{question || "Market View"}</h1>
          {description && <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed mb-4">{description}</p>}

          <SettlementBanner />

          <div className="mb-5 bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-4">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-emerald-400">YES {confidencePercent.toFixed(1)}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-rose-400">NO {(100 - confidencePercent).toFixed(1)}%</span>
                <TrendingDown className="w-4 h-4 text-rose-400" />
              </div>
            </div>
            <div className="h-3 bg-zinc-800 rounded-full overflow-hidden p-0.5">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-700 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                style={{ width: `${confidencePercent}%` }}
              />
            </div>
            <div className="flex justify-between items-center text-[10px] text-zinc-500 mt-2">
              <span>Market Sentiment Ratio</span>
              <span>Target: 50% Threshold</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-950/80 border border-zinc-800/60 rounded-xl p-3.5">
              <p className="text-[11px] font-medium text-zinc-500 mb-0.5">Total Value Locked (TVL)</p>
              <p className="text-base font-bold text-white">{tvlFormatted} <span className="text-xs font-normal text-zinc-400">USDT</span></p>
            </div>
            <div className="bg-zinc-950/80 border border-zinc-800/60 rounded-xl p-3.5">
              <p className="text-[11px] font-medium text-zinc-500 mb-0.5">Created Date</p>
              <p className="text-base font-bold text-white">
                {createdAt ? new Date(Number(createdAt) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-"}
              </p>
            </div>
          </div>
        </div>

        {isConnected && (yesBal > 0n || noBal > 0n) && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 mb-4 shadow-md">
            <p className="text-xs font-semibold text-zinc-400 mb-3 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-indigo-400" />
              My Current Position
            </p>
            <div className="grid grid-cols-2 gap-3">
              {yesBal > 0n && (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                  <p className="text-[11px] font-medium text-emerald-400 mb-0.5">YES Share Value</p>
                  <p className="text-base font-bold text-emerald-300">{yesValueFormatted} USDT</p>
                  <p className="text-[10px] text-zinc-500 mt-1">Shares: {parseFloat(formatUnits(yesBal, 6)).toFixed(2)}</p>
                </div>
              )}
              {noBal > 0n && (
                <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-3">
                  <p className="text-[11px] font-medium text-rose-400 mb-0.5">NO Share Value</p>
                  <p className="text-base font-bold text-rose-300">{noValueFormatted} USDT</p>
                  <p className="text-[10px] text-zinc-500 mt-1">Shares: {parseFloat(formatUnits(noBal, 6)).toFixed(2)}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {status === STATUS_SETTLED && isConnected && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 mb-4 shadow-md">
            {hasClaimed ? (
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-white">Payout Already Claimed</p>
                  <p className="text-xs text-zinc-400">You have claimed your earnings or refund for this market.</p>
                </div>
              </div>
            ) : parseFloat(claimAmountFormatted) > 0 ? (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-zinc-400">
                    {isTie ? "Refundable Amount" : "Available Reward"}
                  </span>
                  <span className="text-lg font-bold text-emerald-400">+{claimAmountFormatted} USDT</span>
                </div>
                <button
                  onClick={() => setShowClaimModal(true)}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-black py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98]"
                >
                  <Sparkles className="w-4 h-4" />
                  {isTie ? "Claim Refund" : "Claim Settlement Reward"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-zinc-400">
                <AlertCircle className="w-5 h-5 text-zinc-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-zinc-300">No Claimable Payout</p>
                  <p className="text-xs text-zinc-500">You did not hold winning shares on this market.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {isWrongChain && (
          <div className="mb-4 flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-amber-300">Network Switch Required</p>
              <p className="text-[11px] text-amber-400/80 mt-0.5">Please switch your wallet to Sepolia Testnet to trade.</p>
            </div>
            <button
              onClick={() => switchChain({ chainId: sepolia.id })}
              disabled={isSwitchingChain}
              className="flex-shrink-0 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {isSwitchingChain ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Switch Network"}
            </button>
          </div>
        )}

        {status !== STATUS_SETTLED && (
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 shadow-xl backdrop-blur-md">
            <div className="flex bg-zinc-950 p-1 rounded-xl mb-4 border border-zinc-800/80">
              <button
                onClick={() => setTab("buy")}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                  tab === "buy" ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Buy Position
              </button>
              <button
                onClick={() => setTab("sell")}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                  tab === "sell" ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Sell Position
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mb-4">
              <button
                onClick={() => setSide("yes")}
                className={`py-3 rounded-xl text-xs font-bold border transition-all ${
                  side === "yes"
                    ? "bg-emerald-500 text-black border-emerald-400 shadow-lg shadow-emerald-500/10"
                    : "bg-zinc-950 text-zinc-400 border-zinc-800 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                YES {confidencePercent.toFixed(1)}%
              </button>
              <button
                onClick={() => setSide("no")}
                className={`py-3 rounded-xl text-xs font-bold border transition-all ${
                  side === "no"
                    ? "bg-rose-500 text-white border-rose-400 shadow-lg shadow-rose-500/10"
                    : "bg-zinc-950 text-zinc-400 border-zinc-800 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                NO {(100 - confidencePercent).toFixed(1)}%
              </button>
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-medium text-zinc-400">
                  {tab === "buy" ? "Amount to Invest (USDT)" : `Amount to Sell (${side.toUpperCase()} Shares)`}
                </label>
                {isConnected && (
                  <span className="text-[11px] text-zinc-500">
                    {tab === "buy"
                      ? `Balance: ${usdtBalanceFormatted} USDT`
                      : `Shares: ${parseFloat(formatUnits(side === "yes" ? yesBal : noBal, 6)).toFixed(2)}`
                    }
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  disabled={isProcessing}
                  className={`w-full bg-zinc-950 border ${
                    isInsufficientBalance
                      ? "border-rose-500/80 focus:border-rose-500"
                      : "border-zinc-800 focus:border-zinc-600"
                  } rounded-xl px-4 py-3 text-sm outline-none text-white placeholder:text-zinc-600 transition-colors pr-16 disabled:opacity-50`}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-500">
                  {tab === "buy" ? "USDT" : "Shares"}
                </span>
              </div>

              {isConnected && (
                <div className="flex gap-1.5 mt-2.5">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleSetPercentage(pct)}
                      className="flex-1 py-1 rounded-lg text-[11px] font-semibold bg-zinc-950 border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-40"
                    >
                      {pct === 100 ? "MAX" : `${pct}%`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {amountBigInt > 0n && (
              <div className="bg-zinc-950 border border-zinc-800/80 rounded-xl px-4 py-3 mb-4 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Platform Protocol Fee (1%)</span>
                  <span className="text-zinc-400">-{(parseFloat(amount) * 0.01).toFixed(4)} USDT</span>
                </div>
                <div className="flex justify-between text-xs font-semibold border-t border-zinc-800 pt-1.5">
                  <span className="text-zinc-300">Estimated Net Position</span>
                  <span className="text-emerald-400">{(parseFloat(amount) * 0.99).toFixed(4)} USDT</span>
                </div>
              </div>
            )}

            {!isConnected ? (
              <div className="text-center py-3 bg-zinc-950/50 border border-zinc-800/60 rounded-xl">
                <p className="text-xs text-zinc-400 mb-0.5">Wallet Not Connected</p>
                <p className="text-[11px] text-zinc-500">Connect wallet via header to start trading.</p>
              </div>
            ) : isWrongChain ? (
              <button
                disabled
                className="w-full bg-zinc-800 text-zinc-500 py-3.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-not-allowed border border-zinc-700/50"
              >
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Switch to Sepolia Network to Trade
              </button>
            ) : isInsufficientBalance ? (
              <button
                disabled
                className="w-full bg-rose-500/10 border border-rose-500/30 text-rose-400 py-3.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-not-allowed"
              >
                <AlertCircle className="w-4 h-4" />
                {tab === "buy" ? "Insufficient USDT Balance" : "Insufficient Share Position"}
              </button>
            ) : tab === "buy" && needsApproval && amountBigInt > 0n ? (
              <button
                onClick={handleApprove}
                disabled={isProcessing}
                className="w-full bg-amber-500 hover:bg-amber-400 text-black py-3.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98] disabled:opacity-50"
              >
                {isProcessing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />{isPending ? "Waiting for Wallet Approval..." : "Confirming Approval on-chain..."}</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4" />Approve USDT Allowance</>
                )}
              </button>
            ) : (
              <button
                onClick={handleTrade}
                disabled={isProcessing || !amount || parseFloat(amount) <= 0}
                className={`w-full py-3.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${
                  side === "yes"
                    ? "bg-emerald-500 hover:bg-emerald-400 text-black"
                    : "bg-rose-500 hover:bg-rose-400 text-white"
                }`}
              >
                {isProcessing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />{isPending ? "Waiting for Wallet Confirmation..." : "Executing on-chain Transaction..."}</>
                ) : (
                  `${tab === "buy" ? "Buy" : "Sell"} ${side.toUpperCase()} Position`
                )}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
