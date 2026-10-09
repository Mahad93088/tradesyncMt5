import React, { useState } from 'react';
import {
  Link,
  Search,
  Ticket,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  TrendingUp,
  ShieldCheck,
  DollarSign,
  ArrowRight
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from '../common/StatusBadge';

export const MentorLinkView: React.FC<{ onOpenLotSettings: () => void }> = ({ onOpenLotSettings }) => {
  const {
    currentUser,
    mentorProfiles,
    parentChildLinks,
    mt5Accounts,
    linkToMentorByCode,
    unlinkTrader
  } = useApp();

  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  const childAccount = mt5Accounts.find(
    (a) => a.userId === currentUser.id && a.accountRole === 'child'
  );

  const activeLink = parentChildLinks.find((l) => l.traderId === currentUser.id);

  const handleConnectByCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCodeInput.trim()) return;

    if (!childAccount) {
      setFeedback({
        message: 'Please connect your Child MT5 terminal first before linking to a mentor.',
        isError: true
      });
      return;
    }

    const defaultLotSettings = {
      mode: 'custom_lot' as const,
      customType: 'multiplier' as const,
      fixedLot: 0.1,
      multiplier: 0.5,
      riskPercent: 1.5,
      maxLotCap: 0.5,
      minLotClamp: 0.01,
      maxDrawdownProtectionPercent: 10.0,
      copyPendingOrders: true,
      syncSlTp: true,
      slippageMaxPips: 3.0
    };

    const res = linkToMentorByCode(
      currentUser.id,
      childAccount.id,
      inviteCodeInput.trim(),
      defaultLotSettings
    );

    if (res.success) {
      setFeedback({ message: res.message, isError: false });
      setInviteCodeInput('');
    } else {
      setFeedback({ message: res.message, isError: true });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          Mentor Link & Copy Network
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Connect your Child MT5 terminal to a verified strategy mentor using an invitation referral code.
        </p>
      </div>

      {/* Currently Linked Mentor Card */}
      {activeLink ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <span className="text-[10px] uppercase font-bold text-sky-400 font-mono tracking-wider">
                Active Mentor Connection
              </span>
              <h3 className="text-xl font-bold text-slate-100 mt-1">{activeLink.mentorName}</h3>
              <p className="text-xs text-slate-400">
                Connected since {new Date(activeLink.linkedAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={activeLink.status} size="md" />
              <button
                onClick={() => unlinkTrader(activeLink.id)}
                className="rounded-lg border border-rose-900/60 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 px-3 py-1.5 text-xs font-semibold transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
            <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
              <span className="text-slate-400 text-[10px] uppercase font-mono">Lot Mode</span>
              <p className="font-bold text-slate-100 mt-1">
                {activeLink.lotSettings.mode === 'parent_lot'
                  ? 'Mode A: 1:1 Copy'
                  : `Mode B: ${activeLink.lotSettings.customType.toUpperCase()}`}
              </p>
              <button
                onClick={onOpenLotSettings}
                className="text-[11px] text-sky-400 hover:text-sky-300 font-medium mt-1 inline-block"
              >
                Adjust Settings →
              </button>
            </div>

            <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
              <span className="text-slate-400 text-[10px] uppercase font-mono">Deals Copied</span>
              <p className="font-mono text-xl font-bold text-slate-100 mt-1">
                {activeLink.totalTradesCopied}
              </p>
              <span className="text-[10px] text-emerald-400 font-mono">
                {activeLink.totalProfitUSD >= 0 ? '+' : ''}${activeLink.totalProfitUSD.toLocaleString()}
              </span>
            </div>

            <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
              <span className="text-slate-400 text-[10px] uppercase font-mono">Slippage Guard</span>
              <p className="font-mono text-sm font-bold text-slate-100 mt-1">
                {activeLink.lotSettings.slippageMaxPips} Pips Max
              </p>
              <span className="text-[10px] text-slate-400 font-mono">SL/TP Sync Active</span>
            </div>
          </div>
        </div>
      ) : (
        /* Connect By Invite Code Card */
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4 max-w-xl">
          <div className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-sky-400" />
            <h3 className="text-base font-bold text-slate-100">Enter Mentor Invite Code</h3>
          </div>
          <p className="text-xs text-slate-400">
            Paste the code provided by your mentor (for example: <code className="text-sky-300 bg-slate-950 px-1 py-0.5 rounded font-mono">ALPHA-XAU-2026</code> or <code className="text-sky-300 bg-slate-950 px-1 py-0.5 rounded font-mono">SCALP-QUEEN-77</code>).
          </p>

          <form onSubmit={handleConnectByCode} className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. ALPHA-XAU-2026"
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 font-mono tracking-wider focus:border-sky-500 focus:outline-none uppercase"
              />
              <button
                type="submit"
                className="rounded-lg bg-sky-600 hover:bg-sky-500 px-4 py-2 text-xs font-semibold text-white transition-colors shrink-0"
              >
                Connect to Mentor
              </button>
            </div>

            {feedback && (
              <div
                className={`rounded-lg p-3 text-xs flex items-start gap-2 ${
                  feedback.isError
                    ? 'border border-rose-900/60 bg-rose-950/50 text-rose-300'
                    : 'border border-emerald-900/60 bg-emerald-950/50 text-emerald-300'
                }`}
              >
                {feedback.isError ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400" />
                )}
                <span>{feedback.message}</span>
              </div>
            )}
          </form>
        </div>
      )}

      {/* Directory of Verified Mentors on Platform */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
          Available Platform Mentors Directory
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mentorProfiles.map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 space-y-3 hover:border-slate-750 transition-colors shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-semibold text-slate-100 text-sm">{m.displayName}</h4>
                  <p className="text-sky-400 text-xs font-medium">{m.strategyName}</p>
                </div>
                <span className="font-mono text-xs font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded">
                  ${m.monthlyFee}/mo
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">
                {m.description}
              </p>

              <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-950/70 border border-slate-800/80 p-2.5 text-center text-xs font-mono">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-sans">Win Rate</span>
                  <p className="font-semibold text-emerald-400 mt-0.5">{m.winRate}%</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-sans">Profit Factor</span>
                  <p className="font-semibold text-slate-200 mt-0.5">{m.profitFactor}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-sans">Followers</span>
                  <p className="font-semibold text-slate-200 mt-0.5">{m.totalFollowers}/{m.maxFollowers}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="font-mono text-xs text-slate-400">
                  Code: <strong className="text-slate-200 font-mono">{m.inviteCode}</strong>
                </span>
                <button
                  onClick={() => setInviteCodeInput(m.inviteCode)}
                  className="text-xs text-sky-400 hover:text-sky-300 font-medium"
                >
                  Apply Code →
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
