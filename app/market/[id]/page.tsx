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

const STATUS_OPEN    = 0;
const STATUS_CLOSING = 1;
const STATUS_SETTLED = 2;

// ... TxProgressBar, ConfirmCloseModal, ClaimRewardModal 保持不变（省略以节省篇幅，你可以保留原代码中的这三个组件） ...

export default function MarketDetailPage() {
  // ... 前面的所有 state 和读取逻辑保持不变，直到 handleTrade 之前 ...

  // ── 统一费用计算函数（与合约完全一致） ─────────────────────────────────────
  const calculateFees = (usdtAmount: number, isBuy: boolean, currentStatus: number) => {
    if (usdtAmount <= 0) return { fee: 0, net: 0 };

    const creatorFeeRate = currentStatus === STATUS_OPEN ? 0.005 : 0; // 0.5% only when open
    const treasuryAFeeRate = 0.003; // 0.3%
    const treasuryBFeeRate = 0.002; // 0.2%

    const totalFeeRate = creatorFeeRate + treasuryAFeeRate + treasuryBFeeRate;
    const fee = usdtAmount * totalFeeRate;
    const net = usdtAmount - fee;

    return { fee: Number(fee.toFixed(6)), net: Number(net.toFixed(6)) };
  };

  // ── 交易处理 ───────────────────────────────────────────────────────────────
  const handleTrade = async () => {
    if (!amountBigInt || amountBigInt === BigInt(0)) {
      toast.error("Please enter an amount");
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
        toast.info("Buy order submitted...");
      } else {
        await writeContractAsync({
          address: marketAddress,
          abi: MARKET_ABI,
          functionName: "sell",
          args: [sideValue, amountBigInt],   // 注意：sell 用 shares，不是 USDT
        });
        toast.info("Sell order submitted...");
      }
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      toast.error(e.shortMessage || e.message || "Transaction failed");
    }
  };

  // ... 其他 handle 函数保持不变 ...

  // 在渲染交易区的地方替换预估显示部分
  {amount && parseFloat(amount) > 0 && (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-3 mb-4">
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-zinc-600">Input Amount</span>
          <span className="text-zinc-400">{parseFloat(amount).toFixed(4)} USDT</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-600">Total Fee</span>
          <span className="text-rose-400">
            -{calculateFees(parseFloat(amount), tab === "buy", status || 0).fee} USDT
          </span>
        </div>
        <div className="flex justify-between border-t border-zinc-800 pt-1.5 font-medium">
          <span className="text-zinc-500">{tab === "buy" ? "You will receive (shares value)" : "You will receive"}</span>
          <span className="text-emerald-400">
            {calculateFees(parseFloat(amount), tab === "buy", status || 0).net} USDT
          </span>
        </div>
      </div>
    </div>
  )}

  // ... 其余代码（按钮等）保持不变 ...