"use client";

import React, { useState, useCallback } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { FACTORY_ADDRESS, FACTORY_ABI, MARKET_ABI } from "@/constants";
import { type Address } from "viem";
import Header from "@/components/Header";
import MarketCard, { MarketData } from "@/components/MarketCard";
import CreateModal from "@/components/CreateMarketModal";
import { Search, Plus, Loader2, Flame, Clock, Timer } from "lucide-react";
import Image from "next/image";

const MARKET_FETCH_LIMIT = 50n;
const STATUS_CLOSING = 1;

export default function HomePage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"newest" | "hot" | "closing">("newest");

  // TanStack Query client for silent background refresh after transactions
  const queryClient = useQueryClient();

  const { data: marketCount, isLoading: isCountLoading } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "getMarketCount",
    query: { refetchInterval: 15_000 },
  });

  const { data: marketAddresses, isLoading: isMarketsLoading } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "getMarkets",
    args: [0n, MARKET_FETCH_LIMIT],
    query: {
      enabled: marketCount !== undefined && (marketCount as bigint) > 0n,
      refetchInterval: 15_000,
    },
  });

  const addresses = (marketAddresses as Address[] | undefined) ?? [];

  // Batch-read all market data in one call to avoid N+1 queries
  const { data: marketsRawData, isLoading: isDataLoading } = useReadContracts({
    contracts: addresses.flatMap((addr) => [
      { address: addr, abi: MARKET_ABI, functionName: "question" as const },
      { address: addr, abi: MARKET_ABI, functionName: "getConfidence" as const },
      { address: addr, abi: MARKET_ABI, functionName: "getTVL" as const },
      { address: addr, abi: MARKET_ABI, functionName: "status" as const },
      { address: addr, abi: MARKET_ABI, functionName: "createdAt" as const },
      { address: addr, abi: MARKET_ABI, functionName: "timeUntilSettlement" as const },
      { address: addr, abi: MARKET_ABI, functionName: "totalVolume" as const },
      { address: addr, abi: MARKET_ABI, functionName: "participantCount" as const },
    ]),
    query: {
      enabled: addresses.length > 0,
      refetchInterval: 15_000,
    },
  });

  const isLoading = isCountLoading || isMarketsLoading || (addresses.length > 0 && isDataLoading);

  // Build structured market data
  const allMarkets = addresses.map((addr, i) => {
    const baseIdx = i * 8;
    const question = (marketsRawData?.[baseIdx]?.result as string) || "";
    const confidence = (marketsRawData?.[baseIdx + 1]?.result as bigint) || 5000n;
    const tvl = (marketsRawData?.[baseIdx + 2]?.result as bigint) || 0n;
    const status = (marketsRawData?.[baseIdx + 3]?.result as number) ?? 0;
    const createdAt = (marketsRawData?.[baseIdx + 4]?.result as bigint) || 0n;
    const timeUntilSettle = (marketsRawData?.[baseIdx + 5]?.result as bigint) || 0n;
    const totalVolume = (marketsRawData?.[baseIdx + 6]?.result as bigint) || 0n;
    const participantCount = (marketsRawData?.[baseIdx + 7]?.result as bigint) || 0n;

    return {
      address: addr,
      question,
      confidencePercent: Number(confidence) / 100,
      tvlFormatted: (Number(tvl) / 1_000_000).toFixed(2),
      status,
      createdAt: Number(createdAt),
      daysLeft: timeUntilSettle > 0n ? Math.ceil(Number(timeUntilSettle) / 86400) : 0,

      // Raw data for sorting
      _timeUntilSettle: Number(timeUntilSettle),
      _totalVolume: Number(totalVolume),
      _tvl: Number(tvl),
      _participantCount: Number(participantCount),
    };
  });

  // Filter by search query
  const searchFilteredMarkets = searchQuery
    ? allMarkets.filter((m) => m.question.toLowerCase().includes(searchQuery.toLowerCase()))
    : allMarkets;

  // Sort by active tab
  let displayMarkets = [...searchFilteredMarkets];

  if (activeTab === "newest") {
    displayMarkets.reverse();
  } else if (activeTab === "hot") {
    displayMarkets.forEach(m => {
      const participantWeight = m._participantCount * 100_000_000;
      (m as any)._score = (m._totalVolume * 0.5) + (m._tvl * 0.3) + (participantWeight * 0.2);
    });
    displayMarkets.sort((a: any, b: any) => b._score - a._score);
  } else if (activeTab === "closing") {
    displayMarkets = displayMarkets
      .filter((m) => m.status === STATUS_CLOSING)
      .sort((a, b) => a._timeUntilSettle - b._timeUntilSettle);
  }

  // On create success: silent refetch only; redirect is handled inside CreateModal
  const handleCreateSuccess = useCallback(() => {
    queryClient.invalidateQueries();
  }, [queryClient]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 pb-20">
      <Header />

      {/* Mobile wallet tip banner */}
      <div className="md:hidden bg-indigo-500/10 border-b border-indigo-500/20 px-4 py-3 flex items-start gap-3">
        <span className="text-xl">💡</span>
        <p className="text-sm text-indigo-200">
          For the best experience, open Pulse inside{" "}
          <span className="font-semibold text-indigo-400">OKX Wallet</span> or
          MetaMask&apos;s built-in browser.
        </p>
      </div>

<main className="max-w-3xl mx-auto px-4 pt-6">
  <div className="mb-8 overflow-hidden">
    <p className="text-zinc-500 text-xs sm:text-sm tracking-[0.25em] font-medium whitespace-nowrap">
      V I E W . A N A L Y Z E . S T A K E . T O G E T H E R
    </p>
  </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-10">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search views..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3.5 pl-12 pr-4 text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
            />
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 transition-colors active:scale-[0.98] shadow-lg shadow-indigo-500/20"
          >
            <Plus className="w-5 h-5" />
            <span>Viewstake</span>
          </button>
        </div>

        <div className="space-y-6">
          {/* Sort tabs */}
          <div className="flex items-center gap-6 border-b border-zinc-800/80 pb-3">
            <button
              onClick={() => setActiveTab("newest")}
              className={`flex items-center gap-2 font-medium transition-colors ${
                activeTab === "newest"
                  ? "text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Clock className="w-4 h-4" />
              Latest
            </button>
            <button
              onClick={() => setActiveTab("hot")}
              className={`flex items-center gap-2 font-medium transition-colors ${
                activeTab === "hot"
                  ? "text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Flame className="w-4 h-4" />
              Trending
            </button>
            <button
              onClick={() => setActiveTab("closing")}
              className={`flex items-center gap-2 font-medium transition-colors ${
                activeTab === "closing"
                  ? "text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Timer className="w-4 h-4" />
              Closing Soon
            </button>
          </div>

          {/* Views list */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
              <Loader2 className="w-8 h-8 animate-spin mb-4" />
              <p>Loading views...</p>
            </div>
          ) : displayMarkets.length === 0 ? (
            <div className="text-center py-20 text-zinc-500 bg-zinc-900/30 rounded-3xl border border-zinc-800/50 border-dashed">
              {activeTab === "closing" ? (
                <p className="text-lg">No views closing soon</p>
              ) : (
                <>
                  <p className="mb-4 text-lg">No views yet</p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="text-indigo-400 hover:text-indigo-300 font-medium"
                  >
                    Be the first to create one →
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="grid gap-4">
              {displayMarkets.map((market) => (
                <MarketCard key={market.address} market={market} />
              ))}
            </div>
          )}
        </div>
      </main>

      <CreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
