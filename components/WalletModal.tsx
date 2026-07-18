"use client";

import React, { useEffect, useState } from "react";
import { useConnect } from "wagmi";
import { Connector } from "wagmi";
import { X, Loader2, ExternalLink, QrCode } from "lucide-react";

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Wallet icons: prefer EIP-6963 provided icons, fall back to built-in emoji
const WALLET_ICONS: Record<string, string> = {
  metaMask: "🦊",
  okxwallet: "⭕",
  bitkeep: "💎",
  tokenpocket: "🔵",
  imtoken: "🔷",
  coinbaseWalletSDK: "🔵",
  walletConnect: "🔗",
  injected: "💼",
};

const WALLET_DESCRIPTIONS: Record<string, string> = {
  metaMask: "The most popular Ethereum wallet",
  okxwallet: "OKX Exchange wallet",
  bitkeep: "Bitget Web3 wallet",
  tokenpocket: "Multi-chain decentralized wallet",
  imtoken: "Battle-tested Ethereum wallet",
  coinbaseWalletSDK: "Official Coinbase wallet",
  walletConnect: "Scan QR to connect any wallet",
  injected: "Browser-injected wallet",
};

function WalletOption({
  connector,
  onClick,
}: {
  connector: Connector;
  onClick: () => void;
}) {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const provider = await connector.getProvider();
        if (mounted) {
          setReady(!!provider);
          setChecking(false);
        }
      } catch {
        if (mounted) {
          setReady(false);
          setChecking(false);
        }
      }
    })();
    return () => { mounted = false; };
  }, [connector]);

  // Skip connectors with no provider detected (except WalletConnect)
  const isWalletConnect = connector.id === "walletConnect";
  if (!checking && !ready && !isWalletConnect) return null;

  const icon = WALLET_ICONS[connector.id] || "💼";
  const desc = WALLET_DESCRIPTIONS[connector.id] || "Web3 wallet";

  return (
    <button
      onClick={onClick}
      disabled={checking}
      className={[
        "w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all text-left",
        "hover:bg-slate-800/80 active:scale-[0.98]",
        checking ? "opacity-50" : "opacity-100",
      ].join(" ")}
    >
      {/* Icon */}
      <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-xl flex-shrink-0 overflow-hidden">
        {(connector as any).icon ? (
          <img
            src={(connector as any).icon}
            alt={connector.name}
            className="w-7 h-7 rounded-lg object-contain"
          />
        ) : (
          <span>{icon}</span>
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-100 truncate">
            {connector.name}
          </span>
          {isWalletConnect && (
            <QrCode className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          )}
        </div>
        <p className="text-xs text-slate-500 truncate mt-0.5">{desc}</p>
      </div>

      {/* Status indicator */}
      {checking ? (
        <Loader2 className="w-4 h-4 text-slate-600 animate-spin flex-shrink-0" />
      ) : ready ? (
        <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
      ) : (
        <ExternalLink className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
      )}
    </button>
  );
}

export default function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { connect, connectors, isPending } = useConnect();

  // Deduplicate: EIP-6963 may overlap with manually configured connectors.
  // Prefer EIP-6963 discovered connectors (with rdns), drop duplicates.
  const deduped = React.useMemo(() => {
    const seen = new Set<string>();
    const result: Connector[] = [];

    // Process EIP-6963 discovered connectors first (have rdns)
    for (const c of connectors) {
      if ((c as any).rdns) {
        const key = (c as any).rdns;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(c);
        }
      }
    }

    // Then process manually configured connectors (no rdns)
    for (const c of connectors) {
      if (!(c as any).rdns) {
        const key = c.id;
        const alreadyCovered =
          (key === "okxwallet" && seen.has("com.okex.wallet")) ||
          (key === "bitkeep" && seen.has("com.bitget.web3")) ||
          (key === "tokenpocket" && seen.has("pro.tokenpocket")) ||
          (key === "imtoken" && seen.has("im.token.app")) ||
          (key === "metaMask" && seen.has("io.metamask")) ||
          (key === "injected" && result.length > 1);

        if (!alreadyCovered && !seen.has(key)) {
          seen.add(key);
          result.push(c);
        }
      }
    }

    return result;
  }, [connectors]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full sm:max-w-sm bg-slate-950 border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden">
        {/* Drag handle (mobile) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Connect Wallet</h2>
            <p className="text-xs text-slate-500 mt-0.5">Choose your Web3 wallet</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Wallet list */}
        <div className="px-3 pb-6 space-y-0.5 max-h-[60vh] overflow-y-auto">
          {isPending ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
              <span className="ml-2 text-sm text-slate-400">Connecting...</span>
            </div>
          ) : (
            deduped.map((connector) => (
              <WalletOption
                key={connector.uid}
                connector={connector}
                onClick={() => {
                  connect({ connector });
                  onClose();
                }}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800/60 bg-slate-900/40">
          <p className="text-xs text-slate-600 text-center">
            By connecting, you agree to the platform terms of use. Your assets are self-custodied in your wallet.
          </p>
        </div>
      </div>
    </div>
  );
}
