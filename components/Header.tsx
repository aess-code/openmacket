"use client";

import React from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { TrendingUp, User } from "lucide-react";
import { useAccount } from "wagmi";

export default function Header() {
  const { isConnected } = useAccount();
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

        {/* Right: Profile + Wallet */}
        <div className="flex items-center gap-3">
          {isConnected && (
            <Link
              href="/profile"
              className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition-colors px-2 py-1.5 rounded-lg hover:bg-zinc-800"
              title="我的主页"
            >
              <User className="w-4 h-4" />
              <span className="text-sm hidden sm:inline">主页</span>
            </Link>
          )}
          <ConnectButton
            accountStatus="avatar"
            chainStatus="none"
            showBalance={false}
          />
        </div>
      </div>
    </header>
  );
}
