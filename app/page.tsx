"use client";

import React, { useState, useCallback } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { FACTORY_ADDRESS, FACTORY_ABI, MARKET_ABI } from "@/constants";
import { type Address } from "viem";
import Header from "@/components/Header";
import MarketCard from "@/components/MarketCard";
import CreateModal from "@/components/CreateModal";
import { Search, Plus, Loader2, Flame, Clock, Timer } from "lucide-react";

const MARKET_FETCH_LIMIT = 50n;
const STATUS_CLOSING = 1;
type TabKey = "newest" | "hot" | "closing";

export default function HomePage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("newest");
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

  // 「即将结算」Tab
  const { data: closingData, isLoading: isClosingLoading } = useReadContracts({
    contracts: addresses.flatMap((addr) => [
      { address: addr, abi: MARKET_ABI, functionName: "status" },
      { address: addr, abi: MARKET_ABI, functionName: "timeUntilSettlement" },
    ]),
    query: {
      enabled: activeTab === "closing" && addresses.length > 0,
      refetchInterval: 30_000,
    },
  });

  // 「最热市场」Tab：totalVolume 50% + getTVL 30% + participantCount 20%
  const { data: hotData, isLoading: isHotLoading } = useReadContracts({
    contracts: addresses.flatMap((addr) => [
      { address: addr, abi: MARKET_ABI, functionName: "totalVolume" },
      { address: addr, abi: MARKET_ABI, functionName: "getTVL" },
      { address: addr, abi: MARKET_ABI, functionName: "participantCount" },
    ]),
    query: {
      enabled: activeTab === "hot" && addresses.length > 0,
      refetchInterval: 30_000,
    },
  });

  const closingAddresses: Address[] = (() => {
    if (!closingData || addresses.length === 0) return [];
    return addresses
      .map((addr, i) => {
        const status   = closingData[i * 2]?.result as number | undefined;
        const timeLeft = closingData[i * 2 + 1]?.result as bigint | undefined;
        return { addr, status, timeLeft: timeLeft ?? BigInt(Number.MAX_SAFE_INTEGER) };
      })
      .filter(({ status }) => status === STATUS_CLOSING)
      .sort((a, b) => (a.timeLeft < b.timeLeft ? -1 : a.timeLeft > b.timeLeft ? 1 : 0))
      .map(({ addr }) => addr);
  })();

  const hotAddresses: Address[] = (() => {
    if (!hotData || addresses.length === 0) return [...addresses].reverse();
    let maxVol = 1n, maxTVL = 1n, maxPct = 1n;
    addresses.forEach((_, i) => {
      const v = (hotData[i * 3]?.result as bigint | undefined) ?? 0n;
      const t = (hotData[i * 3 + 1]?.result as bigint | undefined) ?? 0n;
      const p = (hotData[i * 3 + 2]?.result as bigint | undefined) ?? 0n;
      if (v > maxVol) maxVol = v;
      if (t > maxTVL) maxTVL = t;
      if (p > maxPct) maxPct = p;
    });
    return addresses
      .map((addr, i) => {
        const v = Number((hotData[i * 3]?.result as bigint | undefined) ?? 0n);
        const t = Number((hotData[i * 3 + 1]?.result as bigint | undefined) ?? 0n);
        const p = Number((hotData[i * 3 + 2]?.result as bigint | undefined) ?? 0n);
        const score =
          (v / Number(maxVol)) * 500 +
          (t / Number(maxTVL)) * 300 +
          (p / Number(maxPct)) * 200;
        return { addr, score };
      })
      .sort((a, b) => b.score - a.score)
      .map(({ addr }) => addr);
  })();

  const isLoading =
    isCountLoading ||
    isMarketsLoading ||
    (activeTab === "closing" && isClosingLoading) ||
    (activeTab === "hot" && isHotLoading);

  const displayAddresses: Address[] = (() => {
    if (activeTab === "newest") return [...addresses].reverse();
    if (activeTab === "hot")    return hotAddresses;
    return closingAddresses;
  })();

  const filteredAddresses = searchQuery
    ? displayAddresses.filter((addr) =>
        addr.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : displayAddresses;

  const handleCreateSuccess = useCallback(() => {
    queryClient.invalidateQueries();
  }, [queryClient]);

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: "newest",  label: "最新市场", icon: <Clock  className="w-4 h-4" /> },
    { key: "hot",     label: "最热市场", icon: <Flame  className="w-4 h-4" /> },
    { key: "closing", label: "即将结算", icon: <Timer  className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 pb-20">
      <Header />
      <div className="md:hidden bg-indigo-500/10 border-b border-indigo-500/20 px-4 py-3 flex items-start gap-3">
        <span className="text-xl">💡</span>
        <p className="text-sm text-indigo-200">
          建议在{" "}
          <span className="font-semibold text-indigo-400">OKX 钱包</span> 或
          MetaMask 内置浏览器打开本站，体验最佳
        </p>
      </div>
      <main className="max-w-3xl mx-auto px-4 pt-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 tracking-tight">Macket</h1>
          <p className="text-zinc-400">用钱表达你的观点</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 mb-10">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input
              type="text"
              placeholder="搜索市场..."
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
            <span>创建市场</span>
          </button>
        </div>
        <div className="space-y-6">
          <div className="flex items-center gap-6 border-b border-zinc-800/80 pb-3">
            {tabs.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-2 font-medium transition-colors ${
                  activeTab === key ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
              <Loader2 className="w-8 h-8 animate-spin mb-4" />
              <p>加载市场数据中...</p>
            </div>
          ) : filteredAddresses.length === 0 ? (
            <div className="text-center py-20 text-zinc-500 bg-zinc-900/30 rounded-3xl border border-zinc-800/50 border-dashed">
              {activeTab === "closing" ? (
                <p className="text-lg">暂无即将结算的市场</p>
              ) : (
                <>
                  <p className="mb-4 text-lg">还没有任何市场</p>
                  <button onClick={() => setShowCreateModal(true)} className="text-indigo-400 hover:text-indigo-300 font-medium">
                    成为第一个创建者 →
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredAddresses.map((address) => (
                <MarketCard key={address} address={address} />
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
