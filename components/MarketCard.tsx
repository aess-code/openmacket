"use client";

import React from "react";
import Link from "next/link";
import { Share2, TrendingUp, TrendingDown, Clock, Lock } from "lucide-react";
import { toast } from "sonner";
import { Address } from "viem";

export interface MarketData {
  address: Address;
  question: string;
  confidencePercent: number;
  tvlFormatted: string;
  status: number;
  createdAt: number;
  daysLeft: number;
}

interface MarketCardProps {
  market: MarketData;
}

const STATUS_OPEN    = 0;
const STATUS_CLOSING = 1;
const STATUS_SETTLED = 2;

export default function MarketCard({ market }: MarketCardProps) {
  const {
    address,
    question,
    confidencePercent,
    tvlFormatted,
    status,
    createdAt,
    daysLeft,
  } = market;

  const share = (e: React.MouseEvent) => {
    e.preventDefault();
    const url = `${window.location.origin}/market/${address}`;
    if (navigator.share) {
      navigator.share({ title: question || "Pulse View", url }).catch(() => {
        navigator.clipboard.writeText(url).then(() => toast.success("Link copied"));
      });
    } else {
      navigator.clipboard.writeText(url).then(() => toast.success("Link copied"));
    }
  };

  return (
    <Link href={`/market/${address}`} className="block group">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all duration-300">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-bold text-zinc-100 group-hover:text-white transition-colors leading-snug mb-2 line-clamp-2">
              {question || "Loading..."}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {status === STATUS_SETTLED ? (
                <span className="inline-flex items-center gap-1 text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
                  <Lock className="w-3 h-3" />Settled
                </span>
              ) : status === STATUS_CLOSING ? (
                <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                  <Clock className="w-3 h-3" />
                  {daysLeft > 0 ? `${daysLeft}d left` : "Closing soon"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />Active
                </span>
              )}
              {createdAt > 0 && (
                <span className="text-xs text-zinc-600">
                  {new Date(createdAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={share}
            className="p-2 -m-2 rounded-xl text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors"
          >
            <Share2 className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                YES <TrendingUp className="w-3 h-3" />
              </span>
              <span className="text-xs font-bold text-rose-400 flex items-center gap-1">
                <TrendingDown className="w-3 h-3" /> NO
              </span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${confidencePercent}%` }}
              />
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-zinc-500 mb-0.5">Confidence</p>
            <p className="text-sm font-bold text-zinc-300">
              {confidencePercent.toFixed(1)}%
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-zinc-800/80">
          <div>
            <p className="text-[10px] text-zinc-500 mb-0.5">TVL</p>
            <p className="text-sm font-bold text-zinc-300">${tvlFormatted}</p>
          </div>
          <div className="text-right">
            <span className="inline-block px-3 py-1 rounded-lg bg-zinc-800 text-xs font-medium text-zinc-400 group-hover:bg-indigo-500 group-hover:text-white transition-colors">
              Trade →
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
