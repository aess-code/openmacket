"use client";

import React from "react";
import Link from "next/link";
import { useReadContracts } from "wagmi";
import { MARKET_ABI } from "../constants";
import { Share2, TrendingUp, TrendingDown, Users } from "lucide-react";
import { toast } from "sonner";
import { Address } from "viem";

interface MarketCardProps {
  address: Address;
}

export default function MarketCard({ address }: MarketCardProps) {
  const { data, isLoading } = useReadContracts({
    contracts: [
      { address, abi: MARKET_ABI, functionName: "question" },
      { address, abi: MARKET_ABI, functionName: "getConfidence" },
      { address, abi: MARKET_ABI, functionName: "getTVL" },
      { address, abi: MARKET_ABI, functionName: "status" },
      { address, abi: MARKET_ABI, functionName: "createdAt" },
    ],
  });

  const question = data?.[0]?.result as string | undefined;
  const confidence = data?.[1]?.result as bigint | undefined;
  const tvl = data?.[2]?.result as bigint | undefined;
  const status = data?.[3]?.result as number | undefined;
  const createdAt = data?.[4]?.result as bigint | undefined;

  const confidencePercent = confidence !== undefined ? Number(confidence) / 100 : 50;
  const tvlFormatted = tvl !== undefined ? (Number(tvl) / 1_000_000).toFixed(2) : "0.00";

  const share = (e: React.MouseEvent) => {
    e.preventDefault();
    const url = `${window.location.origin}/market/${address}`;
    if (navigator.share) {
      navigator.share({ title: question || "Macket Market", url }).catch(() => {
        navigator.clipboard.writeText(url).then(() => toast.success("链接已复制"));
      });
    } else {
      navigator.clipboard.writeText(url).then(() => toast.success("链接已复制"));
    }
  };

  if (isLoading) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 animate-pulse">
        <div className="h-4 bg-zinc-800 rounded w-3/4 mb-3" />
        <div className="h-3 bg-zinc-800 rounded w-1/2 mb-4" />
        <div className="h-2 bg-zinc-800 rounded w-full" />
      </div>
    );
  }

  return (
    <Link href={`/market/${address}`} className="block group">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 hover:border-zinc-700 transition-all hover:bg-zinc-900/80 active:scale-[0.99]">
        {/* Status + Share */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            {status === 2 ? (
              <span className="inline-flex items-center gap-1 text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
                已结算
              </span>
            ) : status === 1 ? (
              <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                等待期
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                进行中
              </span>
            )}
          </div>
          <button
            onClick={share}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all"
            aria-label="分享"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Question */}
        <h3 className="text-sm font-medium text-zinc-100 leading-snug mb-4 line-clamp-2">
          {question || "加载中..."}
        </h3>

        {/* Confidence Bar */}
        <div className="mb-3">
          <div className="flex justify-between items-center mb-1.5">
            <div className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-emerald-400" />
              <span className="text-xs text-emerald-400 font-medium">
                YES {confidencePercent.toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-rose-400 font-medium">
                NO {(100 - confidencePercent).toFixed(1)}%
              </span>
              <TrendingDown className="w-3 h-3 text-rose-400" />
            </div>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full confidence-bar transition-all duration-700"
              style={{ width: `${confidencePercent}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs text-zinc-500">
            <Users className="w-3 h-3" />
            <span>TVL: {tvlFormatted} USDT</span>
          </div>
          <span className="text-xs text-zinc-600">
            {createdAt ? new Date(Number(createdAt) * 1000).toLocaleDateString("zh-CN") : ""}
          </span>
        </div>
      </div>
    </Link>
  );
}
