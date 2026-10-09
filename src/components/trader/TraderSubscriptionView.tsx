import React, { useState } from 'react';
import {
  CreditCard,
  Shield,
  Check,
  AlertCircle,
  Calendar,
  DollarSign,
  UserCheck,
  Clock,
  ArrowRight,
  ExternalLink
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from '../common/StatusBadge';

export const TraderSubscriptionView: React.FC = () => {
  const { currentUser, parentChildLinks, mentorProfiles } = useApp();

  const link = parentChildLinks.find((l) => l.traderId === currentUser.id);
  const mentorProfile = link ? mentorProfiles.find((m) => m.userId === link.mentorId) : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          Trader Subscription & Strategy Access
          <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono">
            Follower License
          </span>
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Overview of your active follower tier, linked strategy subscription fees, and renewal billing cycle.
        </p>
      </div>

      {/* Simulated Billing Disclaimer */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs flex items-center justify-between text-slate-400">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-sky-400 shrink-0" />
          <span>
            <strong>Sandbox Mode:</strong> Payment provider connection is simulated. No real credit card or banking charges are incurred in demo sandbox mode.
          </span>
        </div>
        <span className="font-mono text-[10px] text-slate-500">FastAPI Billing Simulator</span>
      </div>

      {/* Subscription Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Platform Follower License */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between border-b border-slate-800 pb-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                Platform License
              </span>
              <h3 className="text-base font-bold text-slate-100 mt-0.5">
                TradeSync Follower Basic
              </h3>
            </div>
            <StatusBadge status="active" size="sm" />
          </div>

          <div className="flex items-baseline gap-1 font-mono">
            <span className="text-2xl font-bold text-slate-100">$0.00</span>
            <span className="text-xs text-slate-400">/month (Complimentary Demo)</span>
          </div>

          <div className="space-y-2 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <Check className="h-3.5 w-3.5 text-sky-400" />
              <span>1 Child MT5 terminal connection</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-3.5 w-3.5 text-sky-400" />
              <span>Real-time sub-millisecond trade mirroring</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-3.5 w-3.5 text-sky-400" />
              <span>Slippage guard & equity protection limits</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-3.5 w-3.5 text-sky-400" />
              <span>Full ticket mapping & sync audit trail</span>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>Next Renewal:</span>
            <span className="font-mono text-slate-200">Nov 1, 2026 (Auto-renew)</span>
          </div>
        </div>

        {/* Card 2: Linked Mentor Strategy Subscription */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between border-b border-slate-800 pb-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                Strategy Subscription
              </span>
              <h3 className="text-base font-bold text-slate-100 mt-0.5">
                {link ? link.mentorName : 'No Active Mentor'}
              </h3>
            </div>
            {link ? (
              <StatusBadge status={link.status} size="sm" />
            ) : (
              <span className="text-xs text-slate-500 font-mono">Unlinked</span>
            )}
          </div>

          {link ? (
            <>
              <div className="flex items-baseline gap-1 font-mono">
                <span className="text-2xl font-bold text-slate-100">
                  ${mentorProfile?.monthlyFee || 149}.00
                </span>
                <span className="text-xs text-slate-400">/month strategy fee</span>
              </div>

              <div className="space-y-1.5 text-xs text-slate-300">
                <p className="text-sky-300 font-medium">
                  {mentorProfile?.strategyName || 'Quantitative Scalping'}
                </p>
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] border border-slate-800">
                  <div>
                    <span className="text-slate-500 text-[10px]">Win Rate:</span>
                    <p className="text-emerald-400 font-bold">{mentorProfile?.winRate || 68.4}%</p>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px]">Profit Factor:</span>
                    <p className="text-slate-200 font-bold">{mentorProfile?.profitFactor || 2.31}</p>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                <span>Billing Status:</span>
                <span className="text-emerald-400 font-medium">Simulated Active</span>
              </div>
            </>
          ) : (
            <div className="space-y-3 py-4 text-center">
              <p className="text-xs text-slate-400">
                You are not currently subscribed to any mentor strategy. Connect using a mentor invite code to copy trades.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
