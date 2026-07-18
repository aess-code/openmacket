"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { sepolia } from "wagmi/chains";
import { decodeEventLog, type Address } from "viem";
import { FACTORY_ADDRESS, FACTORY_ABI } from "@/constants";
import { toast } from "sonner";
import { Loader2, X, AlertTriangle } from "lucide-react";

// Parse the MarketCreated event from receipt logs to get the new market address
function parseNewMarketAddress(
  logs: readonly { topics: readonly `0x${string}`[]; data: `0x${string}`; address: Address }[]
): Address | null {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: FACTORY_ABI,
        eventName: "MarketCreated",
        topics: log.topics as any,
        data: log.data,
      });
      return (decoded.args as { market: Address }).market;
    } catch {
      // skip non-target logs
    }
  }
  return null;
}

interface CreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Callback after successful transaction — triggers silent data refresh in parent */
  onSuccess?: () => void;
}

export default function CreateModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateModalProps) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");

  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();

  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash });

  // On confirmed: parse new market address → redirect
  useEffect(() => {
    if (!isConfirmed || !receipt) return;

    const newMarketAddress = parseNewMarketAddress(receipt.logs);

    setQuestion("");
    setDescription("");

    onSuccess?.();

    if (newMarketAddress) {
      onClose();
      router.push(`/market/${newMarketAddress}?new=true`);
    } else {
      toast.success("View created successfully!");
      onClose();
    }
  }, [isConfirmed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show toast on write error
  useEffect(() => {
    if (!writeError) return;
    const msg = writeError.message ?? "";
    if (msg.includes("User rejected") || msg.includes("user rejected")) {
      toast.error("Cancelled: you rejected the signature in your wallet.");
    } else if (msg.includes("insufficient funds")) {
      toast.error("Insufficient funds: make sure you have enough ETH for gas.");
    } else {
      toast.error(`Transaction failed: ${msg.slice(0, 80)}`);
    }
  }, [writeError]);

  if (!isOpen) return null;

  const isProcessing = isPending || isConfirming || isSwitchingChain;
  const questionLength = question.length;
  const descriptionLength = description.length;
  const isValid = questionLength > 5 && questionLength <= 100;
  const isWrongChain = isConnected && chainId !== sepolia.id;
  const isContractMissing =
    !FACTORY_ADDRESS ||
    FACTORY_ADDRESS === "0x0000000000000000000000000000000000000000";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || !isConnected || isProcessing) return;
    if (isContractMissing) {
      toast.error("Contract address not configured. Please contact the admin.");
      return;
    }
    if (isWrongChain) {
      toast.error("Please switch to Sepolia testnet first.");
      return;
    }
    resetWrite();
    writeContract({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "createMarket",
      args: [question, description],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => !isProcessing && onClose()}
      />

      <div className="relative w-full sm:max-w-md bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-2xl p-5 pb-8 sm:pb-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-white">New Viewstake</h2>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 rounded-xl text-zinc-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Wrong chain banner */}
        {isWrongChain && (
          <div className="mb-4 flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3.5 py-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-amber-300 font-medium">
                Wrong network
              </p>
              <p className="text-xs text-amber-400/70 mt-0.5">
                Contracts are on Sepolia. Switch to create a view.
              </p>
            </div>
            <button
              onClick={() => switchChain({ chainId: sepolia.id })}
              disabled={isSwitchingChain}
              className="flex-shrink-0 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
            >
              {isSwitchingChain ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Switch"
              )}
            </button>
          </div>
        )}

        {/* Contract not configured banner */}
        {isContractMissing && (
          <div className="mb-4 flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-3.5 py-3">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-300">
              Contract address not configured. Set{" "}
              <code className="font-mono">NEXT_PUBLIC_FACTORY_ADDRESS</code>{" "}
              in Vercel environment variables.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Your View input */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Your View *
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Will Ethereum break $5,000 in 2025?"
              rows={3}
              maxLength={100}
              disabled={isProcessing}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-3 text-sm text-white outline-none focus:border-zinc-600 resize-none placeholder:text-zinc-600 transition-colors"
            />
            <div className="flex justify-between items-center mt-1 text-xs">
              <span
                className={
                  isValid
                    ? "text-emerald-400"
                    : questionLength > 0
                    ? "text-amber-400"
                    : "text-transparent"
                }
              >
                {isValid ? "Valid ✓" : questionLength > 0 ? "At least 6 characters" : "."}
              </span>
              <span className={questionLength > 90 ? "text-amber-400" : "text-zinc-600"}>{questionLength}/100</span>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Description{" "}
              <span className="text-zinc-600 font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add context to help participants understand your view..."
              rows={3}
              maxLength={500}
              disabled={isProcessing}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-3 text-sm text-white outline-none focus:border-zinc-600 resize-y min-h-[80px] max-h-[200px] placeholder:text-zinc-600 transition-colors"
            />
            <div className="flex justify-end mt-1">
              <span className={descriptionLength > 450 ? "text-xs text-amber-400" : "text-xs text-zinc-600"}>{descriptionLength}/500</span>
            </div>
          </div>

          {/* Creator fee incentive */}
          <div className="flex items-start gap-2.5 bg-indigo-500/8 border border-indigo-500/20 rounded-xl px-3.5 py-3">
            <span className="text-indigo-400 text-base leading-none mt-0.5">💰</span>
            <p className="text-xs text-indigo-300/80 leading-relaxed">
              Once live, every trade on your view earns you a{" "}
              <span className="text-indigo-300 font-semibold">0.5% creator fee</span>
              {" "}sent directly to your wallet.
            </p>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={
              !isValid ||
              isProcessing ||
              !isConnected ||
              isWrongChain ||
              isContractMissing
            }
            className="w-full bg-white text-black py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {isSwitchingChain
                  ? "Switching network..."
                  : isPending
                  ? "Confirm in wallet..."
                  : "Confirming on-chain..."}
              </>
            ) : !isConnected ? (
              "Connect wallet first"
            ) : isWrongChain ? (
              "Switch to Sepolia"
            ) : (
              "Create View"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
