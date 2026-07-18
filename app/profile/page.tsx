"use client";

import React, { useState } from "react";
import {
  useAccount,
  useBalance,
  useDisconnect,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { USDT_ADDRESS, MARKET_ABI, FACTORY_ABI, FACTORY_ADDRESS } from "../../constants";
import Link from "next/link";
import {
  ArrowLeft,
  Activity,
  PlusCircle,
  TrendingUp,
  SearchX,
  Sparkles,
  Loader2,
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
import { Address } from "viem";
import { toast } from "sonner";

// ── 单个持仓市场条目（带待领取红点）────────────────────────────────────────────
function PositionItem({
  marketAddress,
  userAddress,
}: {
  marketAddress: Address;
  userAddress: Address;
}) {
  const { data } = useReadContracts({
    contracts: [
      { address: marketAddress, abi: MARKET_ABI, functionName: "question" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "status" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "getUserPosition", args: [userAddress] },
      { address: marketAddress, abi: MARKET_ABI, functionName: "getClaimAmount", args: [userAddress] },
      { address: marketAddress, abi: MARKET_ABI, functionName: "claimed", args: [userAddress] },
      { address: marketAddress, abi: MARKET_ABI, functionName: "settledYesWins" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "isTie" },
    ],
  });

  const question    = data?.[0]?.result as string | undefined;
  const status      = data?.[1]?.result as number | undefined;
  const position    = data?.[2]?.result as [bigint, bigint, bigint, bigint] | undefined;
  const claimAmount = data?.[3]?.result as bigint | undefined;
  const hasClaimed  = data?.[4]?.result as boolean | undefined;
  const yesWins     = data?.[5]?.result as boolean | undefined;
  const isTie       = data?.[6]?.result as boolean | undefined;

  const [, , yesValue, noValue] = position || [BigInt(0), BigInt(0), BigInt(0), BigInt(0)];
  const totalValue = yesValue + noValue;
  const claimFormatted = claimAmount ? (Number(claimAmount) / 1_000_000).toFixed(2) : "0.00";
  const hasPendingClaim = status === 2 && !hasClaimed && claimAmount !== undefined && claimAmount > BigInt(0);

  const { writeContractAsync, isPending, data: txHash } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });
  const isProcessing = isPending || isConfirming;

  const handleClaim = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await writeContractAsync({ address: marketAddress, abi: MARKET_ABI, functionName: "claim" });
      toast.info("Claim submitted. Please confirm in your wallet...");
    } catch (err: unknown) {
      const error = err as { shortMessage?: string; message?: string };
      toast.error(error.shortMessage || error.message || "Claim failed");
    }
  };

  if (totalValue === BigInt(0) && status !== 2) return null;

  const statusLabel = status === 2
    ? (hasClaimed ? "Claimed" : hasPendingClaim ? "Claimable" : "Settled")
    : status === 1 ? "Closing" : "Active";

  const statusColor = status === 2
    ? (hasClaimed ? "text-zinc-500 bg-zinc-800" : hasPendingClaim ? "text-amber-400 bg-amber-400/10" : "text-zinc-500 bg-zinc-800")
    : status === 1 ? "text-amber-400 bg-amber-400/10" : "text-emerald-400 bg-emerald-400/10";

  return (
    <Link href={`/market/${marketAddress}`}>
      <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl p-4 transition-all relative">
        {hasPendingClaim && (
          <span className="absolute top-3 right-3 w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
        )}
        <div className="flex items-start justify-between gap-2 mb-3">
          <p className="text-sm font-medium text-zinc-200 leading-snug line-clamp-2 flex-1">{question || "Loading..."}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${statusColor}`}>{statusLabel}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex gap-3">
            {yesValue > BigInt(0) && (
              <div className="text-xs">
                <span className="text-zinc-600">YES </span>
                <span className="text-emerald-400 font-medium">{(Number(yesValue) / 1_000_000).toFixed(2)} U</span>
              </div>
            )}
            {noValue > BigInt(0) && (
              <div className="text-xs">
                <span className="text-zinc-600">NO </span>
                <span className="text-rose-400 font-medium">{(Number(noValue) / 1_000_000).toFixed(2)} U</span>
              </div>
            )}
          </div>
          {hasPendingClaim && (
            <button
              onClick={handleClaim}
              disabled={isProcessing}
              className="flex items-center gap-1 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
            >
              {isProcessing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <><Sparkles className="w-3 h-3" />+{claimFormatted} U</>
              )}
            </button>
          )}
          {status === 2 && hasClaimed && (
            <div className="flex items-center gap-1 text-xs text-zinc-600">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />Claimed
            </div>
          )}
          {status === 2 && !hasClaimed && !hasPendingClaim && (
            <div className="text-xs text-zinc-600">
              {isTie ? "Tie refund" : yesWins ? "NO side lost" : "YES side lost"}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

// ── 单个创建市场条目 ──────────────────────────────────────────────────────────
function CreatedItem({ marketAddress }: { marketAddress: Address }) {
  const { data } = useReadContracts({
    contracts: [
      { address: marketAddress, abi: MARKET_ABI, functionName: "question" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "status" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "getTVL" },
      { address: marketAddress, abi: MARKET_ABI, functionName: "getConfidence" },
    ],
  });

  const question   = data?.[0]?.result as string | undefined;
  const status     = data?.[1]?.result as number | undefined;
  const tvl        = data?.[2]?.result as bigint | undefined;
  const confidence = data?.[3]?.result as bigint | undefined;

  const tvlFormatted  = tvl ? (Number(tvl) / 1_000_000).toFixed(2) : "0.00";
  const confidencePct = confidence !== undefined ? Number(confidence) / 100 : 50;

  const statusLabel = status === 2 ? "Settled" : status === 1 ? "Closing" : "Active";
  const statusColor = status === 2
    ? "text-zinc-500 bg-zinc-800"
    : status === 1 ? "text-amber-400 bg-amber-400/10"
    : "text-emerald-400 bg-emerald-400/10";

  return (
    <Link href={`/market/${marketAddress}`}>
      <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl p-4 transition-all">
        <div className="flex items-start justify-between gap-2 mb-3">
          <p className="text-sm font-medium text-zinc-200 leading-snug line-clamp-2 flex-1">{question || "Loading..."}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${statusColor}`}>{statusLabel}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-zinc-600">
          <span>TVL {tvlFormatted} USDT</span>
          <span>Confidence {confidencePct.toFixed(1)}%</span>
        </div>
      </div>
    </Link>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { address, isConnected, chain } = useAccount();
  const [activeTab, setActiveTab] = useState<"created" | "positions">("created");
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const { data: usdtBalance } = useBalance({
    address,
    token: USDT_ADDRESS,
  });

  // 原生代币余额（SEP / ETH，随当前链自动变化）
  const { data: nativeBalance } = useBalance({ address });
  const nativeSymbol = chain?.nativeCurrency?.symbol ?? "ETH";
  const nativeFormatted = nativeBalance ? Number(nativeBalance.formatted).toFixed(4) : "0.0000";

  // 从工厂合约获取所有市场
  const { data: allMarkets } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "getMarkets",
    args: [BigInt(0), BigInt(100)],
    query: { refetchInterval: 30_000 },
  });

  const markets = (allMarkets as Address[] | undefined) || [];

  // 读取每个市场的创建者、用户持仓、totalVolume（用于过滤和收益计算）
  const { data: marketDetails } = useReadContracts({
    contracts: markets.flatMap((addr) => [
      { address: addr, abi: MARKET_ABI, functionName: "creator" },
      {
        address: addr,
        abi: MARKET_ABI,
        functionName: "getUserPosition",
        args: address ? [address] : ["0x0000000000000000000000000000000000000000"],
      },
      { address: addr, abi: MARKET_ABI, functionName: "totalVolume" },
    ]),
    query: { enabled: markets.length > 0 && !!address },
  });

  const createdMarkets: Address[]  = [];
  const positionMarkets: Address[] = [];
  let pendingClaimCount = 0;
  let creatorTotalVolume = BigInt(0);

  // FEE_CREATOR = 50, FEE_DENOM = 10000 → 0.5% 创建者手续费（与合约常量一致）
  const FEE_CREATOR = BigInt(50);
  const FEE_DENOM   = BigInt(10000);

  if (marketDetails && address) {
    markets.forEach((addr, i) => {
      const creator     = marketDetails[i * 3]?.result as Address | undefined;
      const position    = marketDetails[i * 3 + 1]?.result as [bigint, bigint, bigint, bigint] | undefined;
      const totalVolume = marketDetails[i * 3 + 2]?.result as bigint | undefined;
      if (creator?.toLowerCase() === address.toLowerCase()) {
        createdMarkets.push(addr);
        if (totalVolume) creatorTotalVolume += totalVolume;
      }
      if (position && (position[0] > BigInt(0) || position[1] > BigInt(0))) positionMarkets.push(addr);
    });
  }

  // 累计收益 = 创建市场总成交量 × 0.5%
  const creatorEarnings = creatorTotalVolume * FEE_CREATOR / FEE_DENOM;
  const creatorEarningsFormatted = (Number(creatorEarnings) / 1_000_000).toFixed(2);

  // ── 未连接钱包 ────────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🔒</span>
          </div>
          <h2 className="text-xl font-bold text-zinc-200 mb-2">Wallet not connected</h2>
          <p className="text-zinc-400 mb-6">Connect your wallet to view your positions and earnings.</p>
          <Link
            href="/"
            className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 px-6 rounded-xl transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const displayAddress  = address
    ? address.substring(0, 6) + "..." + address.substring(address.length - 4)
    : "";
  const formattedBalance = usdtBalance
    ? Number(usdtBalance.formatted).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 pb-20">
      {/* 顶部导航 */}
      <div className="sticky top-0 z-50 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800 px-4 py-4">
        <Link href="/" className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200 transition-colors w-fit">
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">Back</span>
        </Link>
      </div>

      <main className="max-w-3xl mx-auto px-4 pt-6 space-y-4">
        {/* 账户卡片 */}
        <div className="bg-gradient-to-br from-indigo-900/40 to-zinc-900 border border-indigo-500/20 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-indigo-500/20 rounded-full flex items-center justify-center border border-indigo-500/30">
              <span className="text-2xl">🦊</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-zinc-200 tracking-wide">{displayAddress}</h1>
                <button
                  onClick={handleCopyAddress}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors"
                  title="Copy address"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
                <a
                  href={chain?.blockExplorers?.default
                    ? `${chain.blockExplorers.default.url}/address/${address}`
                    : `https://sepolia.etherscan.io/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-500 hover:text-zinc-300 transition-colors"
                  title={chain?.blockExplorers?.default ? `View on ${chain.blockExplorers.default.name}` : "View on Etherscan"}
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              <p className="text-sm text-indigo-400/80">{chain?.name ?? "Unknown Network"}</p>
            </div>
          </div>
          <div>
            <p className="text-sm text-zinc-400 mb-1">Available Balance</p>
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-bold text-white">{nativeFormatted}</span>
                  <span className="text-zinc-400 text-sm font-medium">{nativeSymbol}</span>
                </div>
                <span className="text-zinc-700 text-sm">·</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-bold text-white">{formattedBalance}</span>
                  <span className="text-indigo-400 text-sm font-medium">USDT</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 text-zinc-400 mb-2">
              <Activity className="w-4 h-4" />
              <span className="text-sm">Views Joined</span>
            </div>
            <div className="text-2xl font-bold text-zinc-200">
              {positionMarkets.length}
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 text-zinc-400 mb-2">
              <PlusCircle className="w-4 h-4" />
              <span className="text-sm">Views Created</span>
            </div>
            <div className="text-2xl font-bold text-zinc-200">
              {createdMarkets.length}
            </div>
          </div>
        </div>

        {/* 创建者累计收益（链上 totalVolume × 0.5%）*/}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-zinc-400 mb-2">
            <TrendingUp className="w-4 h-4" />
              <span className="text-sm">Creator Earnings</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-2xl font-bold text-emerald-400">
              +{creatorEarningsFormatted} <span className="text-sm text-emerald-500/50 font-normal">USDT</span>
            </div>
            <div className="w-8 h-8 bg-emerald-500/10 rounded-full flex items-center justify-center">
              <span className="text-lg">💰</span>
            </div>
          </div>
          <p className="text-xs text-zinc-600 mt-2">Based on total volume across your views × 0.5% creator fee</p>
        </div>

        {/* 标签页 */}
        <div className="pt-2">
          <div className="flex border-b border-zinc-800 mb-4">
            <button
              onClick={() => setActiveTab("created")}
              className={"flex-1 pb-4 text-center font-medium transition-colors relative " + (activeTab === "created" ? "text-indigo-400" : "text-zinc-500 hover:text-zinc-300")}
            >
              My Views
              {activeTab === "created" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t-full" />
              )}
            </button>
            <button
              onClick={() => setActiveTab("positions")}
              className={"flex-1 pb-4 text-center font-medium transition-colors relative " + (activeTab === "positions" ? "text-indigo-400" : "text-zinc-500 hover:text-zinc-300")}
            >
              <span className="relative inline-block">
                My Positions
                {pendingClaimCount > 0 && (
                  <span className="absolute -top-1 -right-3 w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                )}
              </span>
              {activeTab === "positions" && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t-full" />
              )}
            </button>
          </div>

          {/* ── 我创建的 ── */}
          {activeTab === "created" && (
            createdMarkets.length === 0 ? (
              <div className="bg-zinc-900/50 border border-zinc-800/50 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center">
                <SearchX className="w-10 h-10 text-zinc-600 mb-4" />
                <p className="text-zinc-400 mb-4">You haven&apos;t created any views yet.</p>
                <Link
                  href="/"
                  className="bg-zinc-800 hover:bg-zinc-700 text-indigo-400 px-6 py-2 rounded-xl text-sm font-medium transition-colors"
                >
                  Create your first view
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {createdMarkets.map((addr) => (
                  <CreatedItem key={addr} marketAddress={addr} />
                ))}
              </div>
            )
          )}

          {/* ── 我的持仓 ── */}
          {activeTab === "positions" && (
            positionMarkets.length === 0 ? (
              <div className="bg-zinc-900/50 border border-zinc-800/50 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center text-center">
                <SearchX className="w-10 h-10 text-zinc-600 mb-4" />
                <p className="text-zinc-400">You have no open positions yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {positionMarkets.map((addr) => (
                  <PositionItem key={addr} marketAddress={addr} userAddress={address!} />
                ))}
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
}
