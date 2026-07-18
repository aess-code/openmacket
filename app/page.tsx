"use client";

import React, { useState, useCallback } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { FACTORY_ADDRESS, FACTORY_ABI, MARKET_ABI } from "@/constants";
import { type Address } from "viem";
import Header from "@/components/Header";
import MarketCard from "@/components/MarketCard";
import CreateModal from "@/components/CreateMarketModal";
import { Search, Plus, Loader2, Flame, Clock, Timer } from "lucide-react";

const MARKET_FETCH_LIMIT = 50n;
const STATUS_CLOSING = 1;

export default function HomePage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"newest" | "hot" | "closing">("newest");

  // TanStack Query 客户端，用于交易成功后的静默后台刷新
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

  // 批量读取所有市场的 status，仅在"即将结算" Tab 激活时启用
  const { data: statusResults, isLoading: isStatusLoading } = useReadContracts({
    contracts: addresses.map((addr) => ({
      address: addr,
      abi: MARKET_ABI,
      functionName: "status" as const,
    })),
    query: {
      enabled: activeTab === "closing" && addresses.length > 0,
      refetchInterval: 15_000,
    },
  });

  const isLoading = isCountLoading || isMarketsLoading || (activeTab === "closing" && isStatusLoading);

  // 根据 Tab 计算展示地址列表
  let displayAddresses: Address[];
  if (activeTab === "newest") {
    displayAddresses = [...addresses].reverse();
  } else if (activeTab === "hot") {
    // 热门排序：沿用原始顺序（后续可按 TVL 权重排序）
    displayAddresses = [...addresses];
  } else {
    // 即将结算：过滤 status === CLOSING，保持原始顺序（timeUntilSettlement 由 MarketCard 展示）
    displayAddresses = addresses.filter((_, i) => {
      const result = statusResults?.[i]?.result;
      return Number(result) === STATUS_CLOSING;
    });
  }

  const filteredAddresses = searchQuery
    ? displayAddresses.filter((addr) =>
        addr.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : displayAddresses;

  // 创建成功回调：只做静默刷新，跳转逻辑由 CreateModal 内部处理
  const handleCreateSuccess = useCallback(() => {
    queryClient.invalidateQueries();
  }, [queryClient]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 pb-20">
      <Header />

      {/* 移动端钱包提示横幅 */}
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
          {/* 排序 Tab */}
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
              最新市场
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
              最热市场
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
              即将结算
            </button>
          </div>

          {/* 市场列表 */}
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
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="text-indigo-400 hover:text-indigo-300 font-medium"
                  >
                    成为第一个创建者 →
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredAddresses.map((address) => (
                // key 只用合约地址，永远不变，DOM 不重建，不触发 wagmi hooks 雪崩
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
