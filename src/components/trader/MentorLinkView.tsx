import React, { useState } from 'react';
import {
  Ticket,
  CheckCircle2,
  AlertTriangle,
  Server
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { StatusBadge } from '../common/StatusBadge';
import { ConfirmationModal } from '../common/ConfirmationModal';
import {
  formatLotRuleLabel,
  formatLinkProfitDisplay,
  formatHeartbeatAge
} from '../common/dashboardHelpers';

export const MentorLinkView: React.FC<{ onOpenLotSettings: () => void }> = ({ onOpenLotSettings }) => {
  const { isCloudMode } = useAuth();
  const {
    currentUser,
    mentorProfiles,
    mentorDirectory,
    parentChildLinks,
    mt5Accounts,
    linkToMentorByCode,
    unlinkTrader
  } = useApp();

  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string>('');

  const childAccounts = mt5Accounts.filter(
    (a) => a.userId === currentUser.id && a.accountRole === 'child'
  );
  const childAccount =
    childAccounts.find((a) => a.id === selectedChildId) || childAccounts[0] || undefined;

  const activeLink = childAccount
    ? parentChildLinks.find((l) => l.childAccountId === childAccount.id) ||
      parentChildLinks.find((l) => l.traderId === currentUser.id && !l.childAccountId)
    : parentChildLinks.find((l) => l.traderId === currentUser.id);
  const activeLinkProfit = activeLink
    ? formatLinkProfitDisplay(activeLink, isCloudMode)
    : { text: '$0.00', available: true, isPositive: true };

  const sampleInvitePlaceholder = isCloudMode
    ? mentorDirectory[0]?.inviteCode || 'TS-XXXXXXXX'
    : mentorProfiles[0]?.inviteCode || 'TS-DEMO-01';

  const handleConnectByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCodeInput.trim() || submitting) return;

    if (!childAccount) {
      setFeedback({
        message: 'Please connect your Child MT5 Demo terminal first before linking to a mentor.',
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

    setSubmitting(true);
    setFeedback(null);
    const res = await linkToMentorByCode(
      currentUser.id,
      childAccount.id,
      inviteCodeInput.trim(),
      defaultLotSettings
    );
    setSubmitting(false);

    if (res.success) {
      setFeedback({ message: res.message, isError: false });
      setInviteCodeInput('');
    } else {
      setFeedback({ message: res.message, isError: true });
    }
  };

  const handleConfirmUnlink = async () => {
    if (!activeLink) return;
    setSubmitting(true);
    setFeedback(null);
    const res = await unlinkTrader(activeLink.id);
    setSubmitting(false);
    if (res && !res.success) {
      setFeedback({ message: res.message || 'Failed to disconnect mentor.', isError: true });
    } else {
      setFeedback({ message: 'Disconnected from mentor. Trade copying halted.', isError: false });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            Mentor Link & Copy Network
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Connect your Child MT5 Demo terminal to a verified active mentor using their referral invite code.
          </p>
        </div>
        {childAccounts.length > 1 && childAccount && (
          <select
            value={childAccount.id}
            onChange={(e) => setSelectedChildId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            {childAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                Child #{acc.accountNumber} ({acc.broker})
              </option>
            ))}
          </select>
        )}
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
                onClick={() => setUnlinkConfirmOpen(true)}
                disabled={submitting}
                className="rounded-lg border border-rose-900/60 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
            <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
              <span className="text-slate-400 text-[10px] uppercase font-mono">Lot Mode</span>
              <p className="font-bold text-slate-100 mt-1">
                {formatLotRuleLabel(activeLink.lotSettings)}
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
              <span
                className={`text-[10px] font-mono ${
                  !activeLinkProfit.available
                    ? 'text-slate-400'
                    : activeLinkProfit.isPositive
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {activeLinkProfit.text}
              </span>
            </div>

            <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
              <span className="text-slate-400 text-[10px] uppercase font-mono">Slippage Guard</span>
              <p className="font-mono text-sm font-bold text-slate-100 mt-1">
                {activeLink.lotSettings.slippageMaxPips} Pips Max
              </p>
              <span className="text-[10px] text-slate-400 font-mono">
                {activeLink.lotSettings.syncSlTp ? 'SL/TP Sync Enabled' : 'SL/TP Sync Disabled'}
              </span>
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
            Paste the referral code provided by your mentor (for example:{' '}
            <code className="text-sky-300 bg-slate-950 px-1.5 py-0.5 rounded font-mono">
              {sampleInvitePlaceholder}
            </code>
            ) or pick a verified mentor from the directory below.
          </p>

          <form onSubmit={handleConnectByCode} className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={`e.g. ${sampleInvitePlaceholder}`}
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 font-mono tracking-wider focus:border-sky-500 focus:outline-none uppercase"
              />
              <button
                type="submit"
                disabled={submitting || !inviteCodeInput.trim()}
                className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white transition-colors shrink-0"
              >
                {submitting ? 'Linking...' : 'Connect to Mentor'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Directory of Verified Mentors on Platform */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
          {isCloudMode ? 'Verified Active Cloud Mentors Directory' : 'Available Platform Mentors Directory'}
        </h3>

        {isCloudMode ? (
          mentorDirectory.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mentorDirectory.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 space-y-3 hover:border-slate-700 transition-colors shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-semibold text-slate-100 text-sm">{m.fullName}</h4>
                      <p className="text-sky-400 text-xs font-mono">
                        {m.parentAccountNumber
                          ? `Master #${m.parentAccountNumber} (${m.brokerName})`
                          : 'Master MT5 Pending'}
                      </p>
                      {m.brokerServer && (
                        <p className="text-[11px] text-slate-500 font-mono">{m.brokerServer}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusBadge status={m.connectionStatus} size="sm" />
                      {m.isStale && (
                        <span className="text-[10px] font-mono text-amber-400">Stale Heartbeat</span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-950/70 border border-slate-800/80 p-2.5 text-center text-xs font-mono">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-sans">Mode</span>
                      <p className="font-semibold text-emerald-400 mt-0.5 uppercase">
                        {m.accountType || 'DEMO'}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-sans">Last Sync</span>
                      <p className="font-semibold text-slate-200 mt-0.5">
                        {formatHeartbeatAge(m.lastSync)}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-sans">Followers</span>
                      <p className="font-semibold text-slate-200 mt-0.5">{m.activeFollowersCount}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="font-mono text-xs text-slate-400">
                      Code: <strong className="text-slate-200 font-mono">{m.inviteCode}</strong>
                    </span>
                    <button
                      onClick={() => setInviteCodeInput(m.inviteCode)}
                      disabled={Boolean(activeLink)}
                      className="text-xs text-sky-400 hover:text-sky-300 disabled:opacity-40 font-medium"
                    >
                      Apply Code →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center space-y-2">
              <Server className="h-7 w-7 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">
                No verified active mentors with registered Parent MT5 Demo terminals are currently listed.
              </p>
            </div>
          )
        ) : (
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
                    disabled={Boolean(activeLink)}
                    className="text-xs text-sky-400 hover:text-sky-300 disabled:opacity-40 font-medium"
                  >
                    Apply Code →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={unlinkConfirmOpen}
        onClose={() => setUnlinkConfirmOpen(false)}
        onConfirm={() => {
          void handleConfirmUnlink();
        }}
        title="Disconnect From Mentor?"
        description={`Disconnecting from ${activeLink?.mentorName || 'this mentor'} immediately stops new trades from being copied to your Child MT5 account.`}
        confirmLabel="Disconnect"
        variant="danger"
        isLoading={submitting}
      />
    </div>
  );
};

