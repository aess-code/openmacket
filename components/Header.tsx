"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
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

// Supported chains for the switch menu
const SUPPORTED_CHAINS = [
  {
    id: sepolia.id,
    name: "Sepolia",
    label: "Testnet",
    color: "text-amber-400",
    dot: "bg-amber-400",
  },
  {
    id: mainnet.id,
    name: "Ethereum",
    label: "Mainnet",
    color: "text-blue-400",
    dot: "bg-blue-400",
  },
];

export default function Header() {
  // chain from useAccount — updates reactively on wallet network switch
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

  // Look up chain style config for color/badge
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
          <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity group">
            <Image
              src="/icon.png"
              alt="Pulse"
              width={32}
              height={32}
              className="h-8 w-8 object-contain drop-shadow-[0_0_6px_rgba(99,102,241,0.6)]"
              priority
            />
            <span className="font-bold text-lg tracking-tight text-zinc-100 group-hover:text-white transition-colors">
              Pulse
            </span>
          </Link>

          {/* Right side: disconnected / connected */}
          <div className="relative">
            {!isConnected ? (
              <button
                onClick={() => setShowWalletModal(true)}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
              >
                Connect Wallet
              </button>
            ) : (
              <>
                {/* Connected button */}
                <button
                  onClick={() => {
                    setShowMenu(!showMenu);
                    setShowChainList(false);
                  }}
                  className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm px-3 py-2 rounded-xl transition-colors"
                >
                  {/* Chain status dot */}
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

                {/* Dropdown menu */}
                {showMenu && (
                  <>
                    {/* Click outside to close */}
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => {
                        setShowMenu(false);
                        setShowChainList(false);
                      }}
                    />

                    <div className="absolute right-0 top-12 w-64 bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden z-40">

                      {/* Block 1: Account info */}
                      <div className="px-4 py-3.5 border-b border-zinc-800">
                        <div className="flex items-center gap-3">
                          {/* Avatar */}
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                            <User className="w-4 h-4 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            {/* Address + copy */}
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-sm text-zinc-200 truncate">
                                {shortAddress}
                              </span>
                              <button
                                onClick={copyAddress}
                                className="flex-shrink-0 p-0.5 rounded hover:bg-zinc-700 transition-colors"
                                title="Copy address"
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
                                  title={`View on ${chain.blockExplorers.default.name}`}
                                >
                                  <ExternalLink className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />
                                </a>
                              )}
                            </div>
                            {/* USDT balance */}
                            <p className="text-xs text-zinc-400 mt-0.5">
                              {usdtBalance
                                ? `${parseFloat(usdtBalance.formatted).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
                                : "— USDT"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Block 2: Current chain + switch */}
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
                            {/* Use chain?.name directly — updates on network switch */}
                            <span className="text-sm text-zinc-200">
                              {chain?.name ?? "Unknown Network"}
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

                        {/* Chain list (expanded) */}
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

                      {/* Block 3: Navigation links */}
                      <Link
                        href="/profile"
                        onClick={() => setShowMenu(false)}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/60 transition-colors"
                      >
                        <User className="w-4 h-4 text-zinc-400" />
                        <span className="text-sm text-zinc-200">My Profile</span>
                      </Link>

                      <button
                        onClick={() => {
                          disconnect();
                          setShowMenu(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/60 transition-colors border-t border-zinc-800"
                      >
                        <LogOut className="w-4 h-4 text-red-400" />
                        <span className="text-sm text-red-400">Disconnect</span>
                      </button>

                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {/* Wallet selection modal */}
      <WalletModal
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
      />
    </>
  );
}
