import React, { useState } from 'react';
import {
  Ticket,
  CheckCircle2,
  AlertTriangle,
  Server,
  Mail,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { ensureValidSession } from '../../lib/sessionManager';
import { StatusBadge } from '../common/StatusBadge';
import { ConfirmationModal } from '../common/ConfirmationModal';
import {
  formatLotRuleLabel,
  formatLinkProfitDisplay,
} from '../common/dashboardHelpers';

export const MentorLinkView: React.FC<{ onOpenLotSettings: () => void }> = ({ onOpenLotSettings }) => {
  const { isCloudMode } = useAuth();
  const {
    currentUser,
    mentorProfiles,
    mentorDirectory,
    parentChildLinks,
    mt5Accounts,
    mentorInvitations,
    refreshCloudData,
    linkToMentorByCode,
    unlinkTrader
  } = useApp();

  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const [joinMode, setJoinMode] = useState<'instant' | 'request'>('instant');
  const [submitting, setSubmitting] = useState(false);
  const [respondingInviteId, setRespondingInviteId] = useState<string | null>(null);
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
      maxLotCap: 50,
      minLotClamp: 0.01,
      maxDrawdownProtectionPercent: 20.0,
      copyPendingOrders: false,
      syncSlTp: true,
      slippageMaxPips: 30.0
    };

    setSubmitting(true);
    setFeedback(null);

    if (isCloudMode && joinMode === 'request') {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) {
          setFeedback({ message: 'Session expired. Please sign in again.', isError: true });
          setSubmitting(false);
          return;
        }
        const res = await fetch('/api/v1/bridge/assignments/join', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            inviteCodeOrMentorId: inviteCodeInput.trim(),
            childAccountId: childAccount.id,
            requestApproval: true,
            message: requestNote.trim() || undefined,
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          setFeedback({
            message: json?.error || `HTTP ${res.status}: Failed to submit join request.`,
            isError: true,
          });
          setSubmitting(false);
          return;
        }
        await refreshCloudData();
        setInviteCodeInput('');
        setRequestNote('');
        setFeedback({
          message: json.message || 'Join request sent to mentor for approval.',
          isError: false,
        });
      } catch (err: any) {
        setFeedback({ message: err.message || 'Network error submitting request.', isError: true });
      } finally {
        setSubmitting(false);
      }
      return;
    }

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

  const handleRespondToInvite = async (invitationId: string, decision: 'accept' | 'reject') => {
    if (!isCloudMode) return;
    setRespondingInviteId(invitationId);
    setFeedback(null);
    try {
      const sessionCheck = await ensureValidSession();
      const token = sessionCheck.session?.access_token;
      if (!sessionCheck.valid || !token) {
        setFeedback({ message: 'Session expired. Please sign in again.', isError: true });
        return;
      }
      const res = await fetch(`/api/v1/bridge/trader/invitations/${encodeURIComponent(invitationId)}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          decision,
          childAccountId: childAccount?.id,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setFeedback({
          message: json?.error || `HTTP ${res.status}: Failed to ${decision} invitation.`,
          isError: true,
        });
        return;
      }
      await refreshCloudData();
      setFeedback({
        message:
          decision === 'accept'
            ? 'Mentor invitation accepted and copy link activated.'
            : 'Mentor invitation declined.',
        isError: false,
      });
    } catch (err: any) {
      setFeedback({ message: err.message || 'Network error responding to invitation.', isError: true });
    } finally {
      setRespondingInviteId(null);
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

      {isCloudMode && mentorInvitations.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
            <Mail className="h-4 w-4" />
            <span>Mentor Invitations &amp; Join Requests ({mentorInvitations.length})</span>
          </div>
          <div className="space-y-2">
            {mentorInvitations.map((inv) => {
              const isIncomingPending = inv.direction === 'mentor_invite' && inv.status === 'pending';
              const busy = respondingInviteId === inv.id;
              return (
                <div
                  key={inv.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{inv.mentorName || 'Verified Mentor'}</span>
                      <span className="rounded bg-slate-900 border border-slate-700 px-1.5 py-0.5 text-[10px] font-mono uppercase text-slate-300">
                        {inv.direction === 'mentor_invite' ? 'Mentor Invite' : 'Your Join Request'}
                      </span>
                      <StatusBadge status={inv.status === 'accepted' ? 'active' : inv.status === 'rejected' || inv.status === 'cancelled' ? 'error' : 'pending'} size="sm" />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {new Date(inv.createdAt).toLocaleString()}
                      {inv.message ? ` — "${inv.message}"` : ''}
                    </p>
                  </div>

                  {isIncomingPending && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRespondToInvite(inv.id, 'accept')}
                        className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors"
                      >
                        {busy ? 'Working...' : 'Accept & Link'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRespondToInvite(inv.id, 'reject')}
                        className="rounded-lg border border-rose-800 bg-rose-950/50 hover:bg-rose-900/50 disabled:opacity-50 px-3 py-1.5 text-[11px] font-semibold text-rose-300 transition-colors"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
              {activeLink.balancePauseActive && (
                <StatusBadge status="balance_paused" size="md" />
              )}
              <button
                onClick={() => setUnlinkConfirmOpen(true)}
                disabled={submitting}
                className="rounded-lg border border-rose-900/60 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>

          {activeLink.status === 'suspended' && (
            <div className="rounded-xl border border-rose-800/80 bg-rose-950/40 p-3 text-xs text-rose-200">
              <strong className="text-rose-300">Suspended:</strong>{' '}
              {activeLink.suspensionReason || 'Suspended by mentor or administrator. Only mentor or admin can reactivate.'}
            </div>
          )}

          {activeLink.balancePauseActive && (
            <div className="rounded-xl border border-amber-800/80 bg-amber-950/40 p-3 text-xs text-amber-200">
              <strong className="text-amber-300">Balance Pause ($50 / $100 Protection):</strong>{' '}
              {activeLink.pauseReason || 'Copying paused because verified balance dropped below $50. Resumes automatically at $100 verified balance.'}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
            <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
              <span className="text-slate-400 text-[10px] uppercase font-mono">Lot Size Preference</span>
              <p className="font-bold text-slate-100 mt-1">
                {formatLotRuleLabel(activeLink.lotSettings)}
              </p>
              <button
                onClick={onOpenLotSettings}
                className="text-[11px] text-sky-400 hover:text-sky-300 font-medium mt-1 inline-block"
              >
                Change Lot Size →
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
              <span className="text-slate-400 text-[10px] uppercase font-mono">Your Verified Balance</span>
              <p className="font-mono text-sm font-bold text-slate-100 mt-1">
                ${(childAccount?.verifiedBalance ?? childAccount?.balance ?? 0).toLocaleString()}
              </p>
              <span className="text-[10px] text-slate-400 font-mono">
                Pause &lt; $50 • Resume &ge; $100
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* Connect By Invite Code / Approval Request Card */
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4 max-w-xl">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Ticket className="h-5 w-5 text-sky-400" />
              <h3 className="text-base font-bold text-slate-100">Enter Mentor Invite Code</h3>
            </div>
            {isCloudMode && (
              <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setJoinMode('instant')}
                  className={`rounded px-2.5 py-1 font-medium transition-colors ${
                    joinMode === 'instant' ? 'bg-slate-800 text-sky-300' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Link Immediately
                </button>
                <button
                  type="button"
                  onClick={() => setJoinMode('request')}
                  className={`rounded px-2.5 py-1 font-medium transition-colors ${
                    joinMode === 'request' ? 'bg-slate-800 text-amber-300' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Request Approval
                </button>
              </div>
            )}
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
                {submitting
                  ? 'Working...'
                  : isCloudMode && joinMode === 'request'
                  ? 'Send Join Request'
                  : 'Connect to Mentor'}
              </button>
            </div>
            {isCloudMode && joinMode === 'request' && (
              <input
                type="text"
                placeholder="Optional note to mentor (e.g. Demo account ready for Gold mirroring)"
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
              />
            )}
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
                        Verified Demo Mentor
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusBadge status={m.connectionStatus} size="sm" />
                      {m.isStale && (
                        <span className="text-[10px] font-mono text-amber-400">Bridge Offline</span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-950/70 border border-slate-800/80 p-2.5 text-center text-xs font-mono">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-sans">Environment</span>
                      <p className="font-semibold text-emerald-400 mt-0.5 uppercase">
                        DEMO ONLY
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-sans">Bridge Status</span>
                      <p className="font-semibold text-slate-200 mt-0.5">
                        {m.connectionStatus === 'connected' && !m.isStale ? 'Online' : 'Offline'}
                      </p>
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
                No verified active mentors are currently listed.
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
                    <p className="text-sky-400 text-xs font-mono">Verified Demo Mentor</p>
                  </div>
                  <span className="font-mono text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded uppercase">
                    DEMO ONLY
                  </span>
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

