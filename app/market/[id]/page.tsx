"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  useReadContracts,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { MARKET_ABI, USDT_ABI, USDT_ADDRESS } from "../../../constants";
import { parseUnits, formatUnits, Address, maxUint256 } from "viem";
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
} from "lucide-react";
import Header from "../../../components/Header";

type TradeTab = "buy" | "sell";
type Side = "yes" | "no";

const STATUS_OPEN    = 0;
const STATUS_CLOSING = 1;
const STATUS_SETTLED = 2;

// ── 链上确认进度条 ────────────────────────────────────────────────────────────
function TxProgressBar({ isPending, isConfirming }: { isPending: boolean; isConfirming: boolean }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isPending && !isConfirming) {
      setProgress(0);
      return;
    }
    if (isPending) setProgress(20);
    if (isConfirming) setProgress(65);

    const interval = setInterval(() => {
      setProgress((p) => {
        if (isPending && p < 28) return p + 2;
        if (isConfirming && p < 83) return p + 1.5;
        return p;
      });
    }, 400);
    return () => clearInterval(interval);
  }, [isPending, isConfirming]);

  if (!isPending && !isConfirming) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-0.5 bg-zinc-800">
      <div
        className="h-full bg-indigo-500 transition-all duration-500 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

// ── 不可逆操作二次确认弹窗 ────────────────────────────────────────────────────
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm mx-4 bg-zinc-900 border border-zinc-700 rounded-2xl p-5 shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white mb-1">申请关闭市场</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              此操作<span className="text-amber-400 font-semibold">不可撤销</span>。申请后将进入
              <span className="text-white font-semibold"> 21 天</span>等待期，期间任何人仍可买入卖出。
              21 天结束后按信心指数自动结算，
              <span className="text-amber-400 font-semibold">你将不再获得创建者手续费</span>。
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-amber-500 text-black hover:bg-amber-400 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            {isLoading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />提交中...</>
            ) : "确认申请关闭"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 领取奖励浮层 ──────────────────────────────────────────────────────────────
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
      ? `我在 Macket 参与了「${question || "信心指数市场"}」，平局退款到账！`
      : `我在 Macket 参与了「${question || "信心指数市场"}」，押对了！赚了 +${amount} USDT 🎉`;
    const shareUrl = typeof window !== "undefined" ? window.location.href : "";
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;

    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onDismiss} />
        <div className="relative w-full sm:max-w-sm mx-0 sm:mx-4 bg-zinc-900 border border-zinc-700 rounded-t-3xl sm:rounded-2xl p-6 pb-10 sm:pb-6 shadow-2xl">
          <button onClick={onDismiss} className="absolute top-4 right-4 p-1.5 rounded-xl text-zinc-600 hover:text-zinc-400">
            <X className="w-4 h-4" />
          </button>
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center animate-bounce">
              <CheckCircle2 className="w-9 h-9 text-emerald-400" />
            </div>
          </div>
          <div className="text-center mb-5">
            <h2 className="text-lg font-bold text-white mb-1">奖励已到账！</h2>
            <p className="text-2xl font-bold text-emerald-400 mb-1">+{amount} USDT</p>
            <p className="text-xs text-zinc-500">已转入你的钱包</p>
          </div>
          <div className="space-y-2">
            <a
              href={twitterUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 bg-[#1d9bf0] hover:bg-[#1a8cd8] text-white py-3 rounded-xl text-sm font-bold transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              分享到 X（Twitter）
            </a>
            <button
              onClick={onDismiss}
              className="w-full py-3 rounded-xl text-sm font-medium text-zinc-400 hover:text-zinc-300 transition-colors"
            >
              稍后再说
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onDismiss} />
      <div className="relative w-full sm:max-w-sm mx-0 sm:mx-4 bg-zinc-900 border border-zinc-700 rounded-t-3xl sm:rounded-2xl p-6 pb-10 sm:pb-6 shadow-2xl">
        <button onClick={onDismiss} className="absolute top-4 right-4 p-1.5 rounded-xl text-zinc-600 hover:text-zinc-400">
          <X className="w-4 h-4" />
        </button>
        <div className="flex justify-center mb-4">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
            isTie ? "bg-zinc-700/60" : yesWins ? "bg-emerald-500/20" : "bg-rose-500/20"
          }`}>
            {isTie ? <span className="text-3xl">🤝</span> : (
              <Trophy className={`w-8 h-8 ${yesWins ? "text-emerald-400" : "text-rose-400"}`} />
            )}
          </div>
        </div>
        <div className="text-center mb-2">
          <h2 className="text-lg font-bold text-white mb-1">
            {isTie ? "平局，退款到账" : yesWins ? "YES 方获胜！" : "NO 方获胜！"}
          </h2>
          <p className="text-xs text-zinc-500 leading-relaxed">
            {isTie
              ? "信心指数恰好 50%，你投入的资金将全额退回钱包"
              : "市场已结算，你押对了方向，奖励已准备好"}
          </p>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl px-5 py-4 my-4 text-center">
          <p className="text-xs text-zinc-500 mb-1">
            {isTie ? "退款金额" : "可领取奖励"}
          </p>
          <p className="text-3xl font-bold text-emerald-400">+{amount}</p>
          <p className="text-sm text-zinc-500 mt-0.5">USDT</p>
        </div>
        <button
          onClick={onClaim}
          disabled={isLoading}
          className="w-full bg-emerald-500 hover:bg-emerald-400 text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60 active:scale-[0.98]"
        >
          {isLoading ? (
            <><Loader2 className="w-5 h-5 animate-spin" />请在钱包中确认...</>
          ) : (
            <><Sparkles className="w-5 h-5" />{isTie ? "确认退款" : "立即领取"}</>
          )}
        </button>
      </div>
    </div>
  );
}

export default function MarketDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const marketAddress = params.id as Address;
  const { address: userAddress, isConnected } = useAccount();

  // queryClient 用于静默刷新，不触发 DOM 重建
  const queryClient = useQueryClient();

  // ── 创建成功入场欢迎横幅 ───────────────────────────────────────────────────────
  // 仅在 URL 携带 ?new=true 时显示，5 秒后自动消失
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(
    () => searchParams.get("new") === "true"
  );
  useEffect(() => {
    if (!showWelcomeBanner) return;
    const timer = setTimeout(() => setShowWelcomeBanner(false), 5_000);
    return () => clearTimeout(timer);
  }, [showWelcomeBanner]);

  const [tab, setTab] = useState<TradeTab>("buy");
  const [side, setSide] = useState<Side>("yes");
  const [amount, setAmount] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimModalDismissed, setClaimModalDismissed] = useState(false);
  const [claimJustSucceeded, setClaimJustSucceeded] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  // ── 用 ref 记录 isApproving / isClaiming，避免 useEffect 依赖这两个 state ──
  // 这是工业标准做法：在 effect 内读取 ref.current，不把 state 放进依赖数组
  const isApprovingRef = useRef(isApproving);
  const isClaimingRef  = useRef(isClaiming);
  useEffect(() => { isApprovingRef.current = isApproving; }, [isApproving]);
  useEffect(() => { isClaimingRef.current  = isClaiming;  }, [isClaiming]);

  // ── 读取市场基本信息 ──────────────────────────────────────────────────────────
  const { data, isLoading } = useReadContracts({
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
    query: { refetchInterval: 10_000 },
  });

  const question        = data?.[0]?.result as string | undefined;
  const description     = data?.[1]?.result as string | undefined;
  const confidence      = data?.[2]?.result as bigint | undefined;
  const tvl             = data?.[3]?.result as bigint | undefined;
  const status          = data?.[4]?.result as number | undefined;
  const createdAt       = data?.[5]?.result as bigint | undefined;
  const creator         = data?.[6]?.result as Address | undefined;
  const timeUntilSettle = data?.[7]?.result as bigint | undefined;
  const settledYesWins  = data?.[8]?.result as boolean | undefined;
  const isTie           = data?.[9]?.result as boolean | undefined;

  const confidencePercent = confidence !== undefined ? Number(confidence) / 100 : 50;
  const tvlFormatted      = tvl !== undefined ? (Number(tvl) / 1_000_000).toFixed(2) : "0.00";
  const daysLeft          = timeUntilSettle !== undefined && timeUntilSettle > 0n
    ? Math.ceil(Number(timeUntilSettle) / 86400) : 0;

  // ── 读取用户持仓 ──────────────────────────────────────────────────────────────
  const { data: userPosition } = useReadContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "getUserPosition",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress, refetchInterval: 10_000 },
  });

  const [yesBal, noBal, yesValue, noValue] = (userPosition as [bigint, bigint, bigint, bigint]) || [0n, 0n, 0n, 0n];

  // ── 读取可领取奖励 ────────────────────────────────────────────────────────────
  const { data: claimAmount } = useReadContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "getClaimAmount",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress && status === STATUS_SETTLED, refetchInterval: 10_000 },
  });

  const { data: hasClaimed } = useReadContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "claimed",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress && status === STATUS_SETTLED },
  });

  const claimAmountFormatted = claimAmount
    ? (Number(claimAmount as bigint) / 1_000_000).toFixed(2) : "0.00";

  // ── 结算后自动弹出领取浮层 ────────────────────────────────────────────────────
  useEffect(() => {
    if (
      status === STATUS_SETTLED &&
      isConnected &&
      !hasClaimed &&
      !claimModalDismissed &&
      claimAmount !== undefined &&
      (claimAmount as bigint) > 0n
    ) {
      const timer = setTimeout(() => setShowClaimModal(true), 800);
      return () => clearTimeout(timer);
    }
  }, [status, isConnected, hasClaimed, claimModalDismissed, claimAmount]);

  // ── 读取 USDT 余额和授权 ──────────────────────────────────────────────────────
  const { data: usdtBalance } = useReadContract({
    address: USDT_ADDRESS,
    abi: USDT_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress, refetchInterval: 10_000 },
  });

  const { data: allowance } = useReadContract({
    address: USDT_ADDRESS,
    abi: USDT_ABI,
    functionName: "allowance",
    args: userAddress ? [userAddress, marketAddress] : undefined,
    query: { enabled: !!userAddress, refetchInterval: 5_000 },
  });

  const usdtBalanceFormatted = usdtBalance
    ? parseFloat(formatUnits(usdtBalance as bigint, 6)).toFixed(2) : "0.00";

  const amountBigInt  = amount ? parseUnits(amount, 6) : 0n;
  const needsApproval = tab === "buy" && (allowance as bigint || 0n) < amountBigInt;

  // ── 写合约 ────────────────────────────────────────────────────────────────────
  const { writeContractAsync, isPending, data: txHash, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const isProcessing = isPending || isConfirming;

  // ── 交易成功处理 ──────────────────────────────────────────────────────────────
  // 工业级写法：
  // 1. 依赖数组只放原始值 [isConfirmed]，不放任何函数引用
  // 2. 用 queryClient.invalidateQueries() 静默刷新，不触发 DOM 重建
  // 3. 用 ref 读取 isApproving/isClaiming，避免闭包陷阱
  // 4. reset() 用 setTimeout 延迟，让 wagmi 内部 receipt 订阅先完成清理
  useEffect(() => {
    if (!isConfirmed) return;

    // 读取 ref 而非 state，避免把 state 放进依赖数组
    const wasApproving = isApprovingRef.current;
    const wasClaiming  = isClaimingRef.current;

    if (wasApproving) {
      toast.success("授权成功！现在可以买入了");
      setIsApproving(false);
    } else if (wasClaiming) {
      setClaimJustSucceeded(true);
      setIsClaiming(false);
      toast.success("奖励已到账！");
    } else {
      toast.success("交易成功！");
    }

    setAmount("");

    // 用 queryClient 静默刷新本页所有链上数据，不重建任何 DOM
    queryClient.invalidateQueries();

    // 延迟 reset，让 wagmi 内部的 receipt 订阅完成清理后再重置状态
    // 避免 React 在 wagmi 还未完成内部清理时就卸载 hooks
    setTimeout(() => reset(), 200);

  }, [isConfirmed]); // eslint-disable-line react-hooks/exhaustive-deps
  // ^ 只依赖 isConfirmed（原始 boolean），不依赖任何函数引用
  // ^ queryClient 来自 useQueryClient()，其引用在整个 Provider 生命周期内稳定，但为安全起见仍不放入依赖

  // ── 各种操作 ──────────────────────────────────────────────────────────────────
  const handleApprove = async () => {
    if (!amountBigInt) return;
    setIsApproving(true);
    try {
      await writeContractAsync({
        address: USDT_ADDRESS, abi: USDT_ABI, functionName: "approve",
        args: [marketAddress, maxUint256],
      });
      toast.info("等待授权确认...");
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      toast.error(e.shortMessage || e.message || "授权失败");
      setIsApproving(false);
    }
  };

  const handleTrade = async () => {
    if (!amountBigInt || amountBigInt === 0n) { toast.error("请输入金额"); return; }
    const isYes = side === "yes";
    try {
      if (tab === "buy") {
        await writeContractAsync({ address: marketAddress, abi: MARKET_ABI, functionName: "buy", args: [isYes, amountBigInt] });
        toast.info("买入交易已提交...");
      } else {
        await writeContractAsync({ address: marketAddress, abi: MARKET_ABI, functionName: "sell", args: [isYes, amountBigInt] });
        toast.info("卖出交易已提交...");
      }
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      toast.error(e.shortMessage || e.message || "交易失败");
    }
  };

  const handleRequestClose = async () => {
    setShowCloseConfirm(false);
    try {
      await writeContractAsync({ address: marketAddress, abi: MARKET_ABI, functionName: "initiateClose" });
      toast.info("申请关闭已提交，21 天倒计时开始...");
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      toast.error(e.shortMessage || e.message || "操作失败");
    }
  };

  const handleSettle = async () => {
    try {
      await writeContractAsync({ address: marketAddress, abi: MARKET_ABI, functionName: "settle" });
      toast.info("结算交易已提交...");
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      toast.error(e.shortMessage || e.message || "结算失败");
    }
  };

  const handleClaim = async () => {
    setIsClaiming(true);
    try {
      await writeContractAsync({ address: marketAddress, abi: MARKET_ABI, functionName: "claim" });
      toast.info("领取交易已提交，请在钱包确认...");
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      toast.error(e.shortMessage || e.message || "领取失败");
      setIsClaiming(false);
    }
  };

  const handleShare = () => {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: question || "Macket Market", url }).catch(() => {
        navigator.clipboard.writeText(url).then(() => toast.success("链接已复制"));
      });
    } else {
      navigator.clipboard.writeText(url).then(() => toast.success("链接已复制"));
    }
  };

  const isCreator = userAddress && creator && userAddress.toLowerCase() === creator.toLowerCase();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950">
        <Header />
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 text-zinc-600 animate-spin" />
        </div>
      </div>
    );
  }

  const StatusBadge = () => {
    if (status === STATUS_SETTLED) return (
      <span className="inline-flex items-center gap-1 text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
        <Lock className="w-3 h-3" />已结算
      </span>
    );
    if (status === STATUS_CLOSING) return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
        <Clock className="w-3 h-3" />
        {daysLeft > 0 ? `${daysLeft} 天后结算` : "即将结算"}
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />进行中
      </span>
    );
  };

  const SettlementBanner = () => {
    if (status !== STATUS_SETTLED) return null;
    if (isTie) return (
      <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
        <span className="text-lg">🤝</span>
        <div>
          <p className="text-sm font-bold text-white">平局结算</p>
          <p className="text-xs text-zinc-400">
            信心指数恰好 50%，你投入的 USDT 将按原额退回钱包，点击下方按钮确认退款
          </p>
        </div>
      </div>
    );
    return (
      <div className={`border rounded-xl px-4 py-3 mb-4 flex items-center gap-3 ${
        settledYesWins ? "bg-emerald-500/10 border-emerald-500/30" : "bg-rose-500/10 border-rose-500/30"
      }`}>
        <Trophy className={`w-5 h-5 flex-shrink-0 ${settledYesWins ? "text-emerald-400" : "text-rose-400"}`} />
        <div>
          <p className={`text-sm font-bold ${settledYesWins ? "text-emerald-400" : "text-rose-400"}`}>
            {settledYesWins ? "YES 方获胜" : "NO 方获胜"}
          </p>
          <p className="text-xs text-zinc-400">
            {settledYesWins
              ? "信心指数 > 50%，YES 持仓者按比例瓜分 NO 方资金"
              : "信心指数 < 50%，NO 持仓者按比例瓜分 YES 方资金"}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* 顶部进度条 */}
      <TxProgressBar isPending={isPending} isConfirming={isConfirming} />

      <Header />

      {/* 弹窗层 */}
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
            if (claimJustSucceeded) {
              setClaimJustSucceeded(false);
            }
            setShowClaimModal(false);
            setClaimModalDismissed(true);
          }}
          isLoading={isProcessing}
          isSuccess={claimJustSucceeded}
          question={question}
        />
      )}

      <main className="max-w-2xl mx-auto px-4 pb-24">
        <div className="pt-5 mb-5">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
            <ArrowLeft className="w-4 h-4" />返回市场列表
          </Link>
        </div>

        {/* ── 创建成功欢迎横幅 ── */}
        {showWelcomeBanner && (
          <div className="mb-4 flex items-center justify-between gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-4 py-3.5 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3">
              <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <p className="text-sm text-emerald-300 font-medium">
                🎉 你的市场已上链！快分享给朋友来下注吧
              </p>
            </div>
            <button
              onClick={() => setShowWelcomeBanner(false)}
              className="text-emerald-500/60 hover:text-emerald-400 transition-colors flex-shrink-0"
              aria-label="关闭提示"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── 市场信息卡片 ── */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 mb-4">
          <div className="flex items-start justify-between gap-3 mb-4">
            <StatusBadge />
            <div className="flex items-center gap-2">
              {isCreator && status === STATUS_OPEN && (
                <button
                  onClick={() => setShowCloseConfirm(true)}
                  disabled={isProcessing}
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-amber-400 transition-colors px-2 py-1 rounded-lg hover:bg-zinc-800"
                >
                  <X className="w-3 h-3" />申请关闭
                </button>
              )}
              {status === STATUS_CLOSING && daysLeft === 0 && (
                <button
                  onClick={handleSettle}
                  disabled={isProcessing}
                  className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors px-2 py-1 rounded-lg hover:bg-zinc-800 border border-amber-400/30"
                >
                  {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                  触发结算
                </button>
              )}
              <button onClick={handleShare} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all">
                <Share2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <h1 className="text-lg font-bold text-white leading-snug mb-3">{question}</h1>
          {description && <p className="text-sm text-zinc-500 leading-relaxed mb-4">{description}</p>}

          <SettlementBanner />

          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-bold text-emerald-400">YES {confidencePercent.toFixed(1)}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-rose-400">NO {(100 - confidencePercent).toFixed(1)}%</span>
                <TrendingDown className="w-4 h-4 text-rose-400" />
              </div>
            </div>
            <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-700"
                style={{ width: `${confidencePercent}%` }}
              />
            </div>
            <p className="text-center text-xs text-zinc-600 mt-1.5">
              信心指数：{confidencePercent.toFixed(1)}% 倾向 YES
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-950 rounded-xl p-3">
              <p className="text-xs text-zinc-600 mb-1">总锁仓量 (TVL)</p>
              <p className="text-sm font-bold text-white">{tvlFormatted} USDT</p>
            </div>
            <div className="bg-zinc-950 rounded-xl p-3">
              <p className="text-xs text-zinc-600 mb-1">创建时间</p>
              <p className="text-sm font-bold text-white">
                {createdAt ? new Date(Number(createdAt) * 1000).toLocaleDateString("zh-CN") : "-"}
              </p>
            </div>
          </div>
        </div>

        {/* ── 我的持仓 ── */}
        {isConnected && (yesBal > 0n || noBal > 0n) && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-4">
            <p className="text-xs font-medium text-zinc-500 mb-3">我的持仓</p>
            <div className="grid grid-cols-2 gap-3">
              {yesBal > 0n && (
                <div className="bg-emerald-400/5 border border-emerald-400/20 rounded-xl p-3">
                  <p className="text-xs text-emerald-500 mb-1">YES 持仓</p>
                  <p className="text-sm font-bold text-emerald-400">{(Number(yesValue) / 1_000_000).toFixed(2)} USDT</p>
                </div>
              )}
              {noBal > 0n && (
                <div className="bg-rose-400/5 border border-rose-400/20 rounded-xl p-3">
                  <p className="text-xs text-rose-500 mb-1">NO 持仓</p>
                  <p className="text-sm font-bold text-rose-400">{(Number(noValue) / 1_000_000).toFixed(2)} USDT</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 已结算：领取区（浮层关闭后的兜底入口）── */}
        {status === STATUS_SETTLED && isConnected && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-4">
            {hasClaimed ? (
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-zinc-300">奖励已领取</p>
                  <p className="text-xs text-zinc-600">已成功领取本市场奖励</p>
                </div>
              </div>
            ) : parseFloat(claimAmountFormatted) > 0 ? (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-zinc-500">
                    {isTie ? "退款金额" : "可领取奖励"}
                  </p>
                  <span className="text-lg font-bold text-emerald-400">+{claimAmountFormatted} USDT</span>
                </div>
                <button
                  onClick={() => setShowClaimModal(true)}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-white py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  {isTie ? "确认退款" : "领取奖励"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-zinc-500">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-zinc-400">无可领取奖励</p>
                  <p className="text-xs text-zinc-600">
                    {isTie ? "平局退款已自动处理" : "你的持仓方向未获胜"}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 交易区（已结算时隐藏）── */}
        {status !== STATUS_SETTLED && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex bg-zinc-950 rounded-xl p-1 mb-4">
              <button
                onClick={() => setTab("buy")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${tab === "buy" ? "bg-white text-zinc-950" : "text-zinc-500 hover:text-zinc-300"}`}
              >买入</button>
              <button
                onClick={() => setTab("sell")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${tab === "sell" ? "bg-white text-zinc-950" : "text-zinc-500 hover:text-zinc-300"}`}
              >卖出</button>
            </div>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setSide("yes")}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${side === "yes" ? "bg-emerald-500 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
              >YES</button>
              <button
                onClick={() => setSide("no")}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${side === "no" ? "bg-rose-500 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
              >NO</button>
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs text-zinc-500">{tab === "buy" ? "买入金额 (USDT)" : "卖出份额 (USDT)"}</label>
                {isConnected && (
                  <span className="text-xs text-zinc-600">
                    {tab === "buy"
                      ? `余额: ${usdtBalanceFormatted} USDT`
                      : `持仓: ${parseFloat(formatUnits(side === "yes" ? yesBal : noBal, 6)).toFixed(2)} USDT`
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
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-zinc-600 rounded-xl px-3.5 py-3 text-sm outline-none text-white placeholder:text-zinc-600 transition-colors pr-16 disabled:opacity-50"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-zinc-600 font-medium">USDT</span>
              </div>
              {/* 百分比快捷按钮 */}
              {isConnected && (() => {
                const maxRaw = tab === "buy"
                  ? parseFloat(usdtBalanceFormatted)
                  : parseFloat(formatUnits(side === "yes" ? yesBal : noBal, 6));
                if (maxRaw <= 0) return null;
                return (
                  <div className="flex gap-1.5 mt-2">
                    {([25, 50, 75, 100] as const).map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        disabled={isProcessing}
                        onClick={() => setAmount((maxRaw * pct / 100).toFixed(6).replace(/\.?0+$/, "") || "0")}
                        className="flex-1 py-1 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors disabled:opacity-40"
                      >
                        {pct === 100 ? "MAX" : `${pct}%`}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>

            {amount && parseFloat(amount) > 0 && (
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-3 mb-4">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-600">手续费 (1%)</span>
                    <span className="text-zinc-400">-{(parseFloat(amount) * 0.01).toFixed(4)} USDT</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500 font-medium">{tab === "buy" ? "实际买入" : "实际到账"}</span>
                    <span className="text-white font-medium">{(parseFloat(amount) * 0.99).toFixed(4)} USDT</span>
                  </div>
                </div>
              </div>
            )}

            {!isConnected ? (
              <div className="text-center py-3">
                <p className="text-sm text-zinc-500 mb-1">请先连接钱包</p>
                <p className="text-xs text-zinc-600">点击右上角连接按钮</p>
              </div>
            ) : tab === "buy" && needsApproval && amountBigInt > 0n ? (
              <button
                onClick={handleApprove}
                disabled={isProcessing}
                className="w-full bg-amber-500 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-amber-400 transition-all disabled:opacity-50 active:scale-[0.98]"
              >
                {isProcessing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />{isPending ? "等待钱包确认..." : "授权确认中..."}</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4" />授权 USDT</>
                )}
              </button>
            ) : (
              <button
                onClick={handleTrade}
                disabled={isProcessing || !amount || parseFloat(amount) <= 0}
                className={`w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] ${
                  side === "yes" ? "bg-emerald-500 hover:bg-emerald-400 text-white" : "bg-rose-500 hover:bg-rose-400 text-white"
                }`}
              >
                {isProcessing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />{isPending ? "等待钱包确认..." : "链上确认中..."}</>
                ) : (
                  `${tab === "buy" ? "买入" : "卖出"} ${side.toUpperCase()}`
                )}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
