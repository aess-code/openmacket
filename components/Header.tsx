"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { TrendingUp, Copy, Check, ExternalLink, User, LogOut, ChevronDown } from "lucide-react";
import { useAccount, useDisconnect } from "wagmi";
import { toast } from "sonner";

export default function Header() {
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部自动关闭下拉菜单
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const shortAddr = address
    ? address.slice(0, 6) + "..." + address.slice(-4)
    : "";

  const copyAddr = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    toast.success("地址已复制");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="sticky top-0 z-50 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/50">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-zinc-950" />
          </div>
          <span className="font-bold text-base tracking-tight text-white">Macket</span>
        </Link>

        {/* 右侧：自定义钉包按鈕 */}
        <ConnectButton.Custom>
          {({ account, chain, openConnectModal, openChainModal, mounted }) => {
            if (!mounted) return null;

            // 未连接：显示连接钉包按鈕
            if (!account || !chain) {
              return (
                <button
                  onClick={openConnectModal}
                  className="bg-white text-zinc-950 text-sm font-semibold px-4 py-1.5 rounded-xl hover:bg-zinc-100 transition-colors"
                >
                  连接钉包
                </button>
              );
            }

            // 已连接：显示自定义下拉菜单
            return (
              <div className="relative" ref={ref}>

                {/* 触发按鈕 */}
                <button
                  onClick={() => setOpen((v) => !v)}
                  className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-xl transition-colors"
                >
                  {chain.hasIcon && chain.iconUrl ? (
                    <img
                      src={chain.iconUrl}
                      alt={chain.name ?? "network"}
                      className="w-4 h-4 rounded-full"
                    />
                  ) : (
                    <div className="w-4 h-4 rounded-full bg-indigo-500" />
                  )}
                  <span className="text-sm text-zinc-200 font-medium">
                    {account.displayName}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-200 ${
                      open ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {/* 下拉菜单 */}
                {open && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden z-50">

                    {/* 地址行 */}
                    <div className="px-4 py-3 border-b border-zinc-800">
                      <p className="text-xs text-zinc-500 mb-1.5">钉包地址</p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-zinc-200 font-mono tracking-wide">
                          {shortAddr}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={copyAddr}
                            className="text-zinc-500 hover:text-zinc-300 transition-colors"
                            title="复制完整地址"
                          >
                            {copied ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <a
                            href={`https://sepolia.etherscan.io/address/${address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-500 hover:text-zinc-300 transition-colors"
                            title="在 Etherscan 查看"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    </div>

                    {/* 切换网络 */}
                    <button
                      onClick={() => {
                        openChainModal();
                        setOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800 transition-colors border-b border-zinc-800 group"
                    >
                      <div className="flex items-center gap-2.5">
                        {chain.hasIcon && chain.iconUrl ? (
                          <img
                            src={chain.iconUrl}
                            alt={chain.name ?? "network"}
                            className="w-4 h-4 rounded-full"
                          />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-indigo-500" />
                        )}
                        <span className="text-sm text-zinc-300">{chain.name}</span>
                      </div>
                      <span className="text-xs text-zinc-500 group-hover:text-zinc-400 transition-colors">
                        切换网络 ›
                      </span>
                    </button>

                    {/* 个人中心 */}
                    <Link
                      href="/profile"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors border-b border-zinc-800"
                    >
                      <User className="w-4 h-4 text-zinc-400" />
                      <span className="text-sm text-zinc-300">个人中心</span>
                    </Link>

                    {/* 退出登录 */}
                    <button
                      onClick={() => {
                        disconnect();
                        setOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-rose-500/10 transition-colors"
                    >
                      <LogOut className="w-4 h-4 text-rose-400" />
                      <span className="text-sm text-rose-400">退出登录</span>
                    </button>

                  </div>
                )}
              </div>
            );
          }}
        </ConnectButton.Custom>

      </div>
    </header>
  );
}
