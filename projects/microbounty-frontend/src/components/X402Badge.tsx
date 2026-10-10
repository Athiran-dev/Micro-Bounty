import React, { useState } from 'react';
import { Zap } from 'lucide-react';
import { getX402FlowDescription } from '../lib/mock-agent-server';
import type { X402FlowStep } from '../lib/x402-agent-client';

// ─── x402 Protocol Badge ──────────────────────────────────────────────────────

interface X402BadgeProps {
  /** Current step in the x402 payment flow (for animated state) */
  flowStep?: X402FlowStep;
  /** Show compact version (no text, icon only) */
  compact?: boolean;
  className?: string;
}

/**
 * Visual badge shown on AI agent cards/profile indicating x402 payment support.
 * Animates through payment flow steps when a task is running.
 */
export function X402Badge({ flowStep = 'idle', compact = false, className = '' }: X402BadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const isActive = flowStep !== 'idle' && flowStep !== 'error' && flowStep !== 'success';
  const isError = flowStep === 'error';
  const isSuccess = flowStep === 'success';

  const badgeColor = isError
    ? 'from-red-500/20 to-red-600/10 border-red-500/40 text-red-400'
    : isSuccess
    ? 'from-[#00FF9D]/20 to-[#00FF9D]/10 border-[#00FF9D]/40 text-[#00FF9D]'
    : isActive
    ? 'from-[#C4A1FF]/20 to-[#A37CF0]/10 border-[#C4A1FF]/50 text-[#C4A1FF]'
    : 'from-[#1E212B] to-[#1A1D24] border-[#2D3142] text-[#7B8CC7]';

  return (
    <div className={`relative inline-flex ${className}`}>
      <div
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`
          inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border
          bg-gradient-to-r ${badgeColor}
          cursor-help transition-all duration-300
          ${isActive ? 'shadow-[0_0_12px_rgba(196,161,255,0.25)]' : ''}
        `}
      >
        {/* Zap icon — animates when active */}
        <Zap
          className={`w-3 h-3 shrink-0 ${isActive ? 'animate-pulse' : ''}`}
          fill={isActive ? 'currentColor' : 'none'}
        />

        {!compact && (
          <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap">
            402 Escrow
          </span>
        )}

        {/* Pulsing dot when in active flow */}
        {isActive && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C4A1FF] opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#C4A1FF]" />
          </span>
        )}
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-56 pointer-events-none">
          <div className="bg-[#1A1D24] border border-[#2D3142] rounded-xl p-3 shadow-xl shadow-black/40">
            <p className="text-[11px] font-bold text-[#C4A1FF] mb-1">⚡ 402 payment handshake</p>
            <p className="text-[10px] text-[#64748B] leading-relaxed">
              Backed by on-chain escrow on Algorand. Your payment is locked
              in the contract before the agent runs; you approve it in your wallet.
            </p>
            {flowStep !== 'idle' && (
              <p className="text-[10px] text-[#94A3B8] mt-2 pt-2 border-t border-[#2D3142]">
                {getX402FlowDescription(flowStep)}
              </p>
            )}
          </div>
          {/* Arrow */}
          <div className="flex justify-center">
            <div className="w-2 h-2 bg-[#1A1D24] border-b border-r border-[#2D3142] rotate-45 -mt-1" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── x402 Flow Status Panel ───────────────────────────────────────────────────

interface X402FlowPanelProps {
  step: X402FlowStep;
  txId?: string;
}

/**
 * Step-by-step status panel shown inside the task modal while x402 is running.
 * Visually communicates the full protocol flow to the user.
 */
export function X402FlowPanel({ step, txId }: X402FlowPanelProps) {
  const steps: { id: X402FlowStep; label: string; sublabel: string }[] = [
    { id: 'requesting',   label: 'Requesting Agent',  sublabel: 'HTTP GET → agent endpoint' },
    { id: '402_received', label: '402 Received',       sublabel: 'Payment requirements decoded' },
    { id: 'signing',      label: 'Signing Payment',    sublabel: 'Lute/Pera signs Algo txn' },
    { id: 'retrying',     label: 'Sending Payment',    sublabel: 'Retry with X-PAYMENT header' },
    { id: 'success',      label: 'Agent Responded',    sublabel: 'Payment settled on Algorand' },
  ];

  const stepOrder: X402FlowStep[] = ['requesting', '402_received', 'signing', 'retrying', 'success'];
  const currentIndex = stepOrder.indexOf(step);

  return (
    <div className="bg-[#12141C] border border-[#2D3142] rounded-2xl p-5 my-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4 h-4 text-[#C4A1FF]" />
        <span className="text-xs font-bold text-[#C4A1FF] uppercase tracking-widest">
          Escrow Payment Flow
        </span>
      </div>

      {/* Steps */}
      <div className="space-y-2.5">
        {steps.map((s, idx) => {
          const isDone    = currentIndex > idx;
          const isCurrent = currentIndex === idx;
          const isPending = currentIndex < idx;

          return (
            <div key={s.id} className="flex items-center gap-3">
              {/* Step indicator */}
              <div className={`
                w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold
                transition-all duration-500
                ${isDone    ? 'bg-[#00FF9D] text-[#12141C]' : ''}
                ${isCurrent ? 'bg-[#C4A1FF]/20 border-2 border-[#C4A1FF] text-[#C4A1FF]' : ''}
                ${isPending ? 'bg-[#1A1D24] border border-[#2D3142] text-[#374151]' : ''}
              `}>
                {isDone ? '✓' : idx + 1}
              </div>

              {/* Step label */}
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-bold transition-colors duration-300 ${
                  isDone    ? 'text-[#00FF9D]' :
                  isCurrent ? 'text-white' :
                              'text-[#374151]'
                }`}>
                  {s.label}
                  {isCurrent && (
                    <span className="ml-2 inline-flex">
                      <span className="animate-[ellipsis_1.5s_infinite]">...</span>
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-[#4B5563] mt-0.5">{s.sublabel}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* TxID badge if settled */}
      {txId && step === 'success' && (
        <div className="mt-4 pt-3 border-t border-[#2D3142]">
          <p className="text-[10px] text-[#64748B] mb-1 uppercase tracking-wider">Algorand TxID</p>
          <p className="text-[10px] text-[#00FF9D] font-mono break-all">{txId}</p>
        </div>
      )}
    </div>
  );
}
