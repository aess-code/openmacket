"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import {
  useAccount,
  useDisconnect,
  useBalance,
  useSwitchChain,
} from "wagmi";
import { sepolia, mainnet } from "wagmi/chains";
import { USDT_ADDRESS } from "@/constants";
import { User, LogOut, ChevronDown, Copy, Check, ExternalLink, ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";

const WalletModal = dynamic(() => import("./WalletModal"), { ssr: false });

// 支持的链列表（用于切换菜单展示）
const SUPPORTED_CHAINS = [
  {
    id: sepolia.id,
    name: "Sepolia",
    label: "测试网",
    color: "text-amber-400",
    dot: "bg-amber-400",
  },
  {
    id: mainnet.id,
    name: "Ethereum",
    label: "主网",
    color: "text-blue-400",
    dot: "bg-blue-400",
  },
];

export default function Header() {
  // chain 来自 useAccount，随钱包切换实时更新
  const { address, isConnected, chain } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showChainList, setShowChainList] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: usdtBalance } = useBalance({
    address,
    token: USDT_ADDRESS as `0x${string}`,
    query: { enabled: !!address },
  });

  const shortAddress = address
    ? address.substring(0, 6) + "..." + address.substring(address.length - 4)
    : "";

  // 从 SUPPORTED_CHAINS 查找当前链的样式配置（用于颜色/标签）
  // 网络名称直接使用 chain?.name（动态，随钱包切换更新）
  const currentChainStyle = SUPPORTED_CHAINS.find((c) => c.id === chain?.id);

  const copyAddress = useCallback(async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address]);

  const handleSwitchChain = useCallback(
    (id: number) => {
      switchChain({ chainId: id });
      setShowChainList(false);
      setShowMenu(false);
    },
    [switchChain]
  );

  return (
    <>
      <header className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/60">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="font-bold text-lg tracking-tight text-zinc-100 hover:text-white transition-colors"
          >
            Macket
          </Link>

          {/* 右侧：未连接 / 已连接 */}
          <div className="relative">
            {!isConnected ? (
              <button
                onClick={() => setShowWalletModal(true)}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
              >
                连接钱包
              </button>
            ) : (
              <>
                {/* 已连接按钮 */}
                <button
                  onClick={() => {
                    setShowMenu(!showMenu);
                    setShowChainList(false);
                  }}
                  className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm px-3 py-2 rounded-xl transition-colors"
                >
                  {/* 链状态小圆点 */}
                  <div
                    className={[
                      "w-2 h-2 rounded-full flex-shrink-0",
                      currentChainStyle ? currentChainStyle.dot : "bg-zinc-500",
                    ].join(" ")}
                  />
                  <span className="font-mono text-xs">{shortAddress}</span>
                  <ChevronDown
                    className={[
                      "w-3.5 h-3.5 text-zinc-400 transition-transform",
                      showMenu ? "rotate-180" : "",
                    ].join(" ")}
                  />
                </button>

                {/* 下拉菜单 */}
                {showMenu && (
                  <>
                    {/* 点击外部关闭 */}
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => {
                        setShowMenu(false);
                        setShowChainList(false);
                      }}
                    />

                    <div className="absolute right-0 top-12 w-64 bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden z-40">

                      {/* ── 区块 1：账户信息 ── */}
                      <div className="px-4 py-3.5 border-b border-zinc-800">
                        <div className="flex items-center gap-3">
                          {/* 头像 */}
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                            <User className="w-4 h-4 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            {/* 地址 + 复制 */}
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-sm text-zinc-200 truncate">
                                {shortAddress}
                              </span>
                              <button
                                onClick={copyAddress}
                                className="flex-shrink-0 p-0.5 rounded hover:bg-zinc-700 transition-colors"
                                title="复制地址"
                              >
                                {copied ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />
                                )}
                              </button>
                              {chain?.blockExplorers?.default && (
                                <a
                                  href={`${chain.blockExplorers.default.url}/address/${address}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex-shrink-0 p-0.5 rounded hover:bg-zinc-700 transition-colors"
                                  title={`在 ${chain.blockExplorers.default.name} 查看`}
                                >
                                  <ExternalLink className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />
                                </a>
                              )}
                            </div>
                            {/* USDT 余额 */}
                            <p className="text-xs text-zinc-400 mt-0.5">
                              {usdtBalance
                                ? `${parseFloat(usdtBalance.formatted).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
                                : "— USDT"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* ── 区块 2：当前链 + 切换 ── */}
                      <div className="border-b border-zinc-800">
                        <button
                          onClick={() => setShowChainList(!showChainList)}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/60 transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className={[
                                "w-2 h-2 rounded-full",
                                currentChainStyle ? currentChainStyle.dot : "bg-zinc-500",
                              ].join(" ")}
                            />
                            {/* 直接使用 chain?.name 动态显示，切换网络后自动更新 */}
                            <span className="text-sm text-zinc-200">
                              {chain?.name ?? "未知网络"}
                            </span>
                            {currentChainStyle && (
                              <span
                                className={[
                                  "text-xs px-1.5 py-0.5 rounded-md bg-zinc-800",
                                  currentChainStyle.color,
                                ].join(" ")}
                              >
                                {currentChainStyle.label}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {isSwitching && (
                              <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                            )}
                            <ChevronRight
                              className={[
                                "w-4 h-4 text-zinc-500 transition-transform",
                                showChainList ? "rotate-90" : "",
                              ].join(" ")}
                            />
                          </div>
                        </button>

                        {/* 链列表（展开） */}
                        {showChainList && (
                          <div className="border-t border-zinc-800/60 bg-zinc-950/60">
                            {SUPPORTED_CHAINS.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => handleSwitchChain(c.id)}
                                disabled={c.id === chain?.id || isSwitching}
                                className={[
                                  "w-full flex items-center gap-3 px-5 py-2.5 transition-colors text-left",
                                  c.id === chain?.id
                                    ? "opacity-50 cursor-default"
                                    : "hover:bg-zinc-800/60 cursor-pointer",
                                ].join(" ")}
                              >
                                <div
                                  className={[
                                    "w-2 h-2 rounded-full",
                                    c.dot,
                                  ].join(" ")}
                                />
                                <span className="text-sm text-zinc-300">
                                  {c.name}
                                </span>
                                <span
                                  className={[
                                    "text-xs ml-auto",
                                    c.color,
                                  ].join(" ")}
                                >
                                  {c.label}
                                </span>
                                {c.id === chain?.id && (
                                  <Check className="w-3.5 h-3.5 text-emerald-400 ml-1" />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* ── 区块 3：操作入口 ── */}
                      <Link
                        href="/profile"
                        onClick={() => setShowMenu(false)}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/60 transition-colors"
                      >
                        <User className="w-4 h-4 text-zinc-400" />
                        <span className="text-sm text-zinc-200">个人主页</span>
                      </Link>

                      <button
                        onClick={() => {
                          disconnect();
                          setShowMenu(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/60 transition-colors border-t border-zinc-800"
                      >
                        <LogOut className="w-4 h-4 text-red-400" />
                        <span className="text-sm text-red-400">退出登录</span>
                      </button>

                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {/* 钱包选择弹窗 */}
      <WalletModal
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
      />
    </>
  );
}
