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
} from "lucide-react";
import Header from "../../../components/Header";

type TradeTab = "buy" | "sell";
type Side = "yes" | "no";

const STATUS_OPEN = 0;
const STATUS_CLOSING = 1;
const STATUS_SETTLED = 2;

// ==================== 组件定义（必须保留） ====================
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
      <div className="h-full bg-indigo-500 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
    </div>
  );
}

function ConfirmCloseModal({ onConfirm, onCancel, isLoading }: { onConfirm: () => void; onCancel: () => void; isLoading: boolean; }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm mx-4 bg-zinc-900 border border-zinc-700 rounded-2xl p-5 shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white mb-1">Request to Close View</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              This action is <span className="text-amber-400 font-semibold">irreversible</span>. After requesting, a <span className="text-white font-semibold">21-day</span> waiting period begins.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={isLoading} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={isLoading} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-amber-500 text-black hover:bg-amber-400 transition-colors">Confirm Close</button>
        </div>
      </div>
    </div>
  );
}

function ClaimRewardModal({ amount, yesWins, isTie, onClaim, onDismiss, isLoading, isSuccess, question }: {
  amount: string; yesWins: boolean; isTie: boolean; onClaim: () => void; onDismiss: () => void; isLoading: boolean; isSuccess: boolean; question?: string;
}) {
  // ... 你原来的 ClaimRewardModal 代码 ...
  // 如果太长，先用这个简化版，后面再补
  return <div>Claim Modal Placeholder</div>;
}

// ==================== 主页面 ====================
export default function MarketDetailPage() {
  // ... 你的所有 state 和读取代码（复制你原来的） ...

  const calculateFees = (usdtAmount: number, isBuy: boolean, currentStatus: number) => {
    if (usdtAmount <= 0) return { fee: 0, net: 0 };
    const creatorFeeRate = currentStatus === STATUS_OPEN ? 0.005 : 0;
    const treasuryAFeeRate = 0.003;
    const treasuryBFeeRate = 0.002;
    const totalFeeRate = creatorFeeRate + treasuryAFeeRate + treasuryBFeeRate;
    const fee = usdtAmount * totalFeeRate;
    const net = usdtAmount - fee;
    return { fee: Number(fee.toFixed(6)), net: Number(net.toFixed(6)) };
  };

  const handleTrade = async () => {
    if (!amountBigInt || amountBigInt === 0n) {
      toast.error("Please enter an amount");
      return;
    }
    const sideValue = BigInt(side === "yes" ? YES : NO);
    try {
      if (tab === "buy") {
        await writeContractAsync({ address: marketAddress, abi: MARKET_ABI, functionName: "buy", args: [sideValue, amountBigInt] });
      } else {
        const currentBal = side === "yes" ? yesBal : noBal;
        const positionUSDT = Number(formatUnits(currentBal, 6));
        const inputUSDT = parseFloat(amount);
        if (positionUSDT === 0) {
          toast.error("No position to sell");
          return;
        }
        const sharesToSell = (currentBal * BigInt(Math.floor((inputUSDT / positionUSDT) * 1000000))) / BigInt(1000000);
        await writeContractAsync({ address: marketAddress, abi: MARKET_ABI, functionName: "sell", args: [sideValue, sharesToSell] });
      }
      toast.info(`${tab.toUpperCase()} order submitted...`);
    } catch (err: any) {
      toast.error(err.shortMessage || err.message || "Transaction failed");
    }
  };

  // ... 其他 handle 函数保持原样 ...

  return (
    <div className="min-h-screen bg-zinc-950">
      <TxProgressBar isPending={isPending} isConfirming={isConfirming} />
      <Header />
      {/* 弹窗和页面内容保持你原来的 */}
    </div>
  );
}