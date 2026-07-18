"use client";

import React, { useState, useEffect } from "react";
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { FACTORY_ADDRESS, FACTORY_ABI } from "../constants";
import { toast } from "sonner";
import { Loader2, X, AlertCircle, CheckCircle2 } from "lucide-react";

interface CreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function CreateModal({ isOpen, onClose, onSuccess }: CreateModalProps) {
  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const { isConnected } = useAccount();

  const { writeContractAsync, isPending, data: txHash, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Close modal and reset on success
  useEffect(() => {
    if (isConfirmed) {
      toast.success("市场创建成功！");
      setQuestion("");
      setDescription("");
      reset();
      onSuccess?.();
      onClose();
    }
  }, [isConfirmed, onClose, onSuccess, reset]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isProcessing = isPending || isConfirming;
  const questionLength = question.length;
  const isValid = questionLength > 5 && questionLength <= 300;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      toast.error("问题长度需在 6 到 300 个字符之间");
      return;
    }
    if (!isConnected) {
      toast.error("请先连接钱包");
      return;
    }

    try {
      await writeContractAsync({
        address: FACTORY_ADDRESS,
        abi: FACTORY_ABI,
        functionName: "createMarket",
        args: [question, description],
      });
      toast.info("交易已提交，等待链上确认...");
    } catch (err: unknown) {
      const error = err as { shortMessage?: string; message?: string };
      const msg = error.shortMessage || error.message || "创建失败，请重试";
      toast.error(msg);
    }
  };

  const handleClose = () => {
    if (isProcessing) return;
    setQuestion("");
    setDescription("");
    reset();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={handleClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full sm:max-w-md bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-2xl p-5 pb-8 sm:pb-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar (mobile) */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-zinc-700 rounded-full sm:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between mb-5 mt-2 sm:mt-0">
          <div>
            <h2 className="text-base font-bold text-white">创建新市场</h2>
            <p className="text-xs text-zinc-500 mt-0.5">任何人都可以参与投票</p>
          </div>
          <button
            onClick={handleClose}
            disabled={isProcessing}
            className="p-1.5 rounded-xl text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Question Input */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              观点问题 <span className="text-rose-400">*</span>
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="例如：以太坊会在 2025 年突破 $5000 吗？"
              rows={3}
              maxLength={300}
              disabled={isProcessing}
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-zinc-600 rounded-xl px-3.5 py-3 text-sm outline-none text-white placeholder:text-zinc-600 transition-colors resize-none disabled:opacity-50"
            />
            <div className="flex justify-between items-center mt-1">
              {questionLength > 0 && !isValid && questionLength <= 5 && (
                <span className="text-xs text-amber-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  至少需要 6 个字符
                </span>
              )}
              {isValid && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  问题有效
                </span>
              )}
              {questionLength === 0 && <span />}
              <span className={`text-xs ml-auto ${questionLength > 280 ? "text-amber-400" : "text-zinc-600"}`}>
                {questionLength}/300
              </span>
            </div>
          </div>

          {/* Description Input */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              背景说明 <span className="text-zinc-600">(可选)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="补充背景信息、判断依据或数据来源..."
              rows={2}
              maxLength={1000}
              disabled={isProcessing}
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-zinc-600 rounded-xl px-3.5 py-3 text-sm outline-none text-white placeholder:text-zinc-600 transition-colors resize-none disabled:opacity-50"
            />
          </div>

          {/* Fee Info */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-3">
            <p className="text-xs text-zinc-500 font-medium mb-1.5">费率说明</p>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-600">创建者收益</span>
                <span className="text-zinc-400">0.5% / 笔交易</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-600">平台金库</span>
                <span className="text-zinc-400">0.5% / 笔交易</span>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!isValid || isProcessing || !isConnected}
            className="w-full bg-white text-zinc-950 py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-zinc-100 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {isPending ? "等待钱包确认..." : "链上确认中..."}
              </>
            ) : !isConnected ? (
              "请先连接钱包"
            ) : (
              "创建市场"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
