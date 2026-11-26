import React, { useState } from 'react';
import {
  Search,
  PauseCircle,
  PlayCircle,
  Unlink,
  AlertTriangle,
  CheckCircle2,
  Users,
  Layers,
  Plus,
  Trash2,
  UserCheck,
  XCircle,
  DollarSign,
  ShieldOff,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { ensureValidSession } from '../../lib/sessionManager';
import { StatusBadge } from '../common/StatusBadge';
import { ConfirmationModal } from '../common/ConfirmationModal';
import {
  formatLotRuleLabel,
  formatLinkProfitDisplay,
  formatHeartbeatAge,
  countDistinctTraders,
} from '../common/dashboardHelpers';

export const ChildAccountsList: React.FC = () => {
  const { isCloudMode } = useAuth();
  const {
    currentUser,
    parentChildLinks,
    mt5Accounts,
    followerAccounts,
    mentorGroups,
    mentorInvitations,
    refreshCloudData,
    toggleLinkStatus,
    unlinkTrader,
    createMentorGroup,
    deleteMentorGroup,
    assignFollowerGroup,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'paused' | 'suspended' | 'balance_paused' | 'error'
  >('all');
  const [groupFilter, setGroupFilter] = useState<'all' | 'ungrouped' | string>('all');
  const [pendingUnlink, setPendingUnlink] = useState<{ id: string; traderName: string } | null>(null);
  const [pendingSuspend, setPendingSuspend] = useState<{ id: string; traderName: string } | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<{ id: string; name: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [decidingInvId, setDecidingInvId] = useState<string | null>(null);

  const [editingMembershipId, setEditingMembershipId] = useState<string | null>(null);
  const [memStatus, setMemStatus] = useState<'trial' | 'active' | 'past_due' | 'paused' | 'cancelled'>('active');
  const [memPrice, setMemPrice] = useState('0');
  const [memPeriod, setMemPeriod] = useState<'monthly' | 'quarterly' | 'yearly' | 'free'>('monthly');
  const [savingMembership, setSavingMembership] = useState(false);

  // Filter links, invitations & groups strictly for this mentor
  const mentorLinks = parentChildLinks.filter((l) => l.mentorId === currentUser.id);
  const myGroups = mentorGroups.filter((g) => g.mentorId === currentUser.id);
  const myInvitations = mentorInvitations.filter((inv) => inv.mentorId === currentUser.id);
  const pendingInvitations = myInvitations.filter((inv) => inv.status === 'pending');

  const resolveChildAccount = (childAccountId: string) =>
    followerAccounts.find((a) => a.id === childAccountId) ||
    mt5Accounts.find((a) => a.id === childAccountId);

  const distinctTraderCount = countDistinctTraders(mentorLinks, []);

  const filteredLinks = mentorLinks.filter((link) => {
    const childAccount = resolveChildAccount(link.childAccountId);
    const text = `${link.traderName} ${childAccount?.accountNumber || ''} ${childAccount?.broker || ''}`.toLowerCase();
    const matchesSearch = text.includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'balance_paused'
        ? Boolean(link.balancePauseActive)
        : link.status === statusFilter;
    const matchesGroup =
      groupFilter === 'all'
        ? true
        : groupFilter === 'ungrouped'
        ? !link.groupId
        : link.groupId === groupFilter;
    return matchesSearch && matchesStatus && matchesGroup;
  });

  const handleToggleStatus = async (linkId: string) => {
    setActionFeedback(null);
    const res = await toggleLinkStatus(linkId);
    if (!res.success) {
      setActionFeedback({ message: res.message || 'Failed to update copy link status.', isError: true });
    }
  };

  const handleConfirmSuspend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingSuspend) return;
    setIsProcessing(true);
    setActionFeedback(null);
    const res = await toggleLinkStatus(
      pendingSuspend.id,
      'suspended',
      suspendReason.trim() || undefined
    );
    setIsProcessing(false);
    if (!res.success) {
      setActionFeedback({ message: res.message || 'Failed to suspend student.', isError: true });
    } else {
      setActionFeedback({
        message: `Suspended student ${pendingSuspend.traderName}. Existing positions remain untouched.`,
        isError: false,
      });
    }
    setPendingSuspend(null);
    setSuspendReason('');
  };

  const handleReactivate = async (linkId: string, traderName: string) => {
    setIsProcessing(true);
    setActionFeedback(null);
    const res = await toggleLinkStatus(linkId, 'active');
    setIsProcessing(false);
    if (!res.success) {
      setActionFeedback({ message: res.message || 'Failed to reactivate student.', isError: true });
    } else {
      setActionFeedback({
        message: `Reactivated student ${traderName} for new trades from now onward.`,
        isError: false,
      });
    }
  };

  const handleConfirmUnlink = async () => {
    if (!pendingUnlink) return;
    setIsProcessing(true);
    setActionFeedback(null);
    const res = await unlinkTrader(pendingUnlink.id);
    setIsProcessing(false);
    if (!res.success) {
      setActionFeedback({ message: res.message || 'Failed to remove follower link.', isError: true });
    } else {
      setActionFeedback({ message: `Disconnected follower ${pendingUnlink.traderName}.`, isError: false });
    }
    setPendingUnlink(null);
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setCreatingGroup(true);
    setActionFeedback(null);
    const res = await createMentorGroup(newGroupName.trim(), newGroupDescription.trim());
    setCreatingGroup(false);
    if (!res.success) {
      setActionFeedback({ message: res.message || 'Failed to create group.', isError: true });
    } else {
      setActionFeedback({ message: res.message || 'Follower group created.', isError: false });
      setNewGroupName('');
      setNewGroupDescription('');
    }
  };

  const handleConfirmDeleteGroup = async () => {
    if (!pendingDeleteGroup) return;
    setIsProcessing(true);
    setActionFeedback(null);
    const res = await deleteMentorGroup(pendingDeleteGroup.id);
    setIsProcessing(false);
    if (!res.success) {
      setActionFeedback({ message: res.message || 'Failed to delete group.', isError: true });
    } else {
      if (groupFilter === pendingDeleteGroup.id) setGroupFilter('all');
      setActionFeedback({ message: `Deleted group "${pendingDeleteGroup.name}".`, isError: false });
    }
    setPendingDeleteGroup(null);
  };

  const handleAssignGroup = async (assignmentId: string, nextGroupId: string) => {
    setActionFeedback(null);
    const res = await assignFollowerGroup(assignmentId, nextGroupId ? nextGroupId : null);
    if (!res.success) {
      setActionFeedback({ message: res.message || 'Failed to assign follower group.', isError: true });
    }
  };

  const handleDecideInvitation = async (invitationId: string, decision: 'approve' | 'reject' | 'cancel') => {
    if (!isCloudMode) return;
    setDecidingInvId(invitationId);
    setActionFeedback(null);
    try {
      const sessionCheck = await ensureValidSession();
      const token = sessionCheck.session?.access_token;
      if (!sessionCheck.valid || !token) {
        setActionFeedback({ message: 'Session expired. Please sign in again.', isError: true });
        return;
      }
      const res = await fetch(`/api/v1/bridge/mentor/requests/${encodeURIComponent(invitationId)}/decide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ decision }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setActionFeedback({
          message: json?.error || `HTTP ${res.status}: Failed to ${decision} request.`,
          isError: true,
        });
        return;
      }
      await refreshCloudData();
      setActionFeedback({
        message:
          decision === 'approve'
            ? 'Student join request approved and copy assignment activated.'
            : decision === 'cancel'
            ? 'Pending invitation cancelled.'
            : 'Student join request rejected.',
        isError: false,
      });
    } catch (err: any) {
      setActionFeedback({ message: err.message || 'Network error processing request.', isError: true });
    } finally {
      setDecidingInvId(null);
    }
  };

  const openMembershipEditor = (link: (typeof mentorLinks)[number]) => {
    if (editingMembershipId === link.id) {
      setEditingMembershipId(null);
      return;
    }
    setEditingMembershipId(link.id);
    setMemStatus(link.membershipStatus || 'active');
    setMemPrice(String(link.membershipPriceUsd ?? 0));
    setMemPeriod(link.billingPeriod || 'monthly');
  };

  const handleSaveMembership = async (assignmentId: string) => {
    if (!isCloudMode) {
      setActionFeedback({
        message: 'Membership billing updated for local preview. Connect Supabase Cloud for persistent billing.',
        isError: false,
      });
      setEditingMembershipId(null);
      return;
    }
    setSavingMembership(true);
    setActionFeedback(null);
    try {
      const sessionCheck = await ensureValidSession();
      const token = sessionCheck.session?.access_token;
      if (!sessionCheck.valid || !token) {
        setActionFeedback({ message: 'Session expired. Please sign in again.', isError: true });
        return;
      }
      const res = await fetch(`/api/v1/bridge/assignments/${encodeURIComponent(assignmentId)}/membership`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          membershipStatus: memStatus,
          membershipPriceUsd: Math.max(0, Number(memPrice) || 0),
          billingPeriod: memPeriod,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setActionFeedback({
          message: json?.error || `HTTP ${res.status}: Failed to update membership billing.`,
          isError: true,
        });
        return;
      }
      await refreshCloudData();
      setEditingMembershipId(null);
      setActionFeedback({ message: 'Student membership billing updated.', isError: false });
    } catch (err: any) {
      setActionFeedback({ message: err.message || 'Network error updating membership.', isError: true });
    } finally {
      setSavingMembership(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2 flex-wrap">
            Connected Students &amp; Child Terminals
            <span className="rounded bg-cyan-950 border border-cyan-800 px-2 py-0.5 text-xs text-cyan-400 font-mono">
              {distinctTraderCount} Distinct Trader{distinctTraderCount === 1 ? '' : 's'} ({mentorLinks.length} Assignment{mentorLinks.length === 1 ? '' : 's'})
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Approve join requests, organize followers into strategy cohorts, manage student billing, and monitor terminal health.
          </p>
        </div>
      </div>

      {actionFeedback && (
        <div
          className={`rounded-xl border p-3 text-xs flex items-center justify-between gap-2 ${
            actionFeedback.isError
              ? 'border-rose-800 bg-rose-950/40 text-rose-300'
              : 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionFeedback.isError ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            )}
            <span>{actionFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionFeedback(null)}
            className="text-[11px] text-slate-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Pending Join Requests & Sent Invitations */}
      {isCloudMode && pendingInvitations.length > 0 && (
        <div className="rounded-2xl border border-amber-800/60 bg-amber-950/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-2">
              <UserCheck className="h-4 w-4" />
              Pending Student Requests &amp; Invitations ({pendingInvitations.length})
            </h3>
          </div>
          <div className="space-y-2">
            {pendingInvitations.map((inv) => {
              const isJoinRequest = inv.direction === 'student_request';
              const busy = decidingInvId === inv.id;
              return (
                <div
                  key={inv.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-white">
                        {inv.traderName || inv.invitedEmail}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold border ${
                          isJoinRequest
                            ? 'bg-amber-950/70 border-amber-800 text-amber-300'
                            : 'bg-cyan-950/70 border-cyan-800 text-cyan-300'
                        }`}
                      >
                        {isJoinRequest ? 'Join Approval Request' : 'Mentor Invite Sent'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {inv.invitedEmail} • {new Date(inv.createdAt).toLocaleString()}
                      {inv.message ? ` — "${inv.message}"` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isJoinRequest ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDecideInvitation(inv.id, 'approve')}
                          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors"
                        >
                          {busy ? 'Working...' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDecideInvitation(inv.id, 'reject')}
                          className="rounded-lg border border-rose-800 bg-rose-950/50 hover:bg-rose-900/50 disabled:opacity-50 px-3 py-1.5 text-[11px] font-semibold text-rose-300 transition-colors"
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDecideInvitation(inv.id, 'cancel')}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition-colors"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>{busy ? 'Cancelling...' : 'Cancel Invite'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mentor Follower Groups Manager */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-cyan-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Follower Strategy Groups ({myGroups.length})
            </h3>
          </div>

          <form onSubmit={handleCreateGroup} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="New group name (e.g. Conservative 0.5x)"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none w-56"
            />
            <input
              type="text"
              placeholder="Optional description"
              value={newGroupDescription}
              onChange={(e) => setNewGroupDescription(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none w-48"
            />
            <button
              type="submit"
              disabled={creatingGroup || !newGroupName.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{creatingGroup ? 'Adding...' : 'Add Group'}</span>
            </button>
          </form>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setGroupFilter('all')}
            className={`rounded-lg border px-2.5 py-1 font-medium transition-colors ${
              groupFilter === 'all'
                ? 'border-cyan-600 bg-cyan-950/60 text-cyan-300'
                : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            All ({mentorLinks.length})
          </button>
          <button
            type="button"
            onClick={() => setGroupFilter('ungrouped')}
            className={`rounded-lg border px-2.5 py-1 font-medium transition-colors ${
              groupFilter === 'ungrouped'
                ? 'border-cyan-600 bg-cyan-950/60 text-cyan-300'
                : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            Ungrouped ({mentorLinks.filter((l) => !l.groupId).length})
          </button>

          {myGroups.map((grp) => {
            const count = mentorLinks.filter((l) => l.groupId === grp.id).length;
            return (
              <div
                key={grp.id}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 ${
                  groupFilter === grp.id
                    ? 'border-cyan-600 bg-cyan-950/60 text-cyan-300'
                    : 'border-slate-800 bg-slate-950 text-slate-300'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setGroupFilter(grp.id)}
                  className="font-medium hover:text-white"
                  title={grp.description || grp.name}
                >
                  {grp.name} ({count})
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDeleteGroup({ id: grp.id, name: grp.name })}
                  className="text-slate-500 hover:text-rose-400 transition-colors"
                  title={`Delete ${grp.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by student name or account #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-400 font-medium">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Followers</option>
            <option value="active">Active Only</option>
            <option value="paused">Paused Only</option>
            <option value="suspended">Suspended Only</option>
            <option value="balance_paused">Balance Paused (&lt;$50 / &lt;$100)</option>
            <option value="error">Error Only</option>
          </select>
        </div>
      </div>

      {/* Follower Cards Grid */}
      {filteredLinks.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredLinks.map((link) => {
            const childAccount = resolveChildAccount(link.childAccountId);
            const profitInfo = formatLinkProfitDisplay(link, isCloudMode);

            return (
              <div
                key={link.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg backdrop-blur-sm space-y-4 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-white text-sm">{link.traderName}</h4>
                      <StatusBadge status={link.status} size="sm" />
                      {link.balancePauseActive && (
                        <StatusBadge status="balance_paused" size="sm" />
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Linked since {new Date(link.linkedAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {link.status === 'suspended' ? (
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => void handleReactivate(link.id, link.traderName)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-800 bg-emerald-950/60 hover:bg-emerald-900/60 disabled:opacity-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 transition-colors"
                        title="Reactivate student copying from now forward"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>Reactivate</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(link.id)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                          title={link.status === 'active' ? 'Pause trade copying' : 'Resume trade copying'}
                        >
                          {link.status === 'active' ? (
                            <PauseCircle className="h-5 w-5 text-amber-400" />
                          ) : (
                            <PlayCircle className="h-5 w-5 text-emerald-400" />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isProcessing}
                          onClick={() => {
                            setPendingSuspend({ id: link.id, traderName: link.traderName });
                            setSuspendReason('');
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-800/80 bg-rose-950/50 hover:bg-rose-900/50 disabled:opacity-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 transition-colors"
                          title="Suspend student copying (preserves open positions)"
                        >
                          <ShieldOff className="h-3.5 w-3.5" />
                          <span>Suspend</span>
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setPendingUnlink({ id: link.id, traderName: link.traderName })}
                      className="rounded-lg p-2 text-slate-400 hover:bg-rose-950/60 hover:text-rose-400 transition-colors"
                      title="Remove follower assignment"
                    >
                      <Unlink className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* Separate Suspension & Balance-Pause Notices */}
                {link.status === 'suspended' && (
                  <div className="rounded-xl border border-rose-800/80 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-200 space-y-0.5">
                    <div className="font-semibold text-rose-300 flex items-center gap-1.5">
                      <ShieldOff className="h-3.5 w-3.5 shrink-0" />
                      <span>Manual Suspension Active</span>
                    </div>
                    <p className="text-rose-200/90">
                      {link.suspensionReason || 'Suspended by mentor or administrator. Only mentor or admin can reactivate.'}
                    </p>
                  </div>
                )}

                {link.balancePauseActive && (
                  <div className="rounded-xl border border-amber-800/80 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200 space-y-0.5">
                    <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>Balance Pause Active ($50 / $100 Rule)</span>
                    </div>
                    <p className="text-amber-200/90">
                      {link.pauseReason || 'Verified balance dropped below $50. Copying resumes automatically once verified balance reaches $100 (unless manually suspended).'}
                    </p>
                  </div>
                )}

                {/* Child MT5 Terminal Specs */}
                {childAccount ? (
                  <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-mono">Terminal Node</span>
                      <p className="font-mono font-bold text-white">#{childAccount.accountNumber}</p>
                      <span className="text-[10px] text-slate-400">
                        {childAccount.broker} • {childAccount.server}
                        {childAccount.tradingSymbol ? ` • ${childAccount.tradingSymbol}` : ''}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-mono">Connection</span>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <StatusBadge status={childAccount.isStale ? 'error' : childAccount.connectionStatus} size="sm" />
                        <span className={`font-mono text-[10px] ${childAccount.isStale ? 'text-amber-400' : 'text-slate-400'}`}>
                          {childAccount.isStale
                            ? 'Stale Heartbeat'
                            : childAccount.connectionStatus === 'connected'
                            ? formatHeartbeatAge(childAccount.lastHeartbeat)
                            : 'Off'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-mono">
                        {childAccount.verifiedBalance !== undefined ? 'Verified Bal / Eq' : 'Balance / Equity'}
                      </span>
                      <p className="font-mono font-semibold text-emerald-400">
                        ${(childAccount.verifiedBalance ?? childAccount.balance).toLocaleString()} / ${(childAccount.verifiedEquity ?? childAccount.equity).toLocaleString()} {childAccount.currency}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-mono">Free Margin</span>
                      <p className="font-mono font-semibold text-slate-200">
                        ${childAccount.freeMargin.toLocaleString()}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-slate-950/40 border border-slate-800/60 p-3 text-slate-500 italic text-xs">
                    Student has not bound a Child MT5 terminal yet.
                  </div>
                )}

                {/* Lot Settings Rule, Group Cohort Selector & Performance */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-2 border-t border-slate-800/80">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-mono">Lot Mode</span>
                    <p className="font-semibold text-white">{formatLotRuleLabel(link.lotSettings)}</p>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase font-mono mb-0.5">
                      Strategy Group
                    </label>
                    <select
                      value={link.groupId || ''}
                      onChange={(e) => handleAssignGroup(link.id, e.target.value)}
                      className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="">Ungrouped</option>
                      {myGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 uppercase font-mono">Deals Copied &amp; P&amp;L</span>
                    <p className="font-mono font-bold text-cyan-300">
                      {link.totalTradesCopied} deals
                    </p>
                    <span
                      className={`text-[10px] font-mono ${
                        profitInfo.available
                          ? profitInfo.isPositive
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                          : 'text-slate-400 italic'
                      }`}
                    >
                      {profitInfo.text}
                    </span>
                  </div>
                </div>

                {/* Per-Student Membership Billing Row */}
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3 text-[11px] space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-mono">
                      <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-slate-300">
                        Student Fee:{' '}
                        <strong className="text-white">
                          ${Number(link.membershipPriceUsd ?? 0).toFixed(2)}
                        </strong>
                        /{link.billingPeriod || 'monthly'}
                      </span>
                      <span className="rounded bg-slate-900 border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                        {link.membershipStatus || 'active'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openMembershipEditor(link)}
                      className="text-cyan-400 hover:text-cyan-300 font-semibold"
                    >
                      {editingMembershipId === link.id ? 'Close' : 'Edit Billing'}
                    </button>
                  </div>

                  {editingMembershipId === link.id && (
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Status</label>
                        <select
                          value={memStatus}
                          onChange={(e) => setMemStatus(e.target.value as any)}
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-white focus:border-cyan-500 focus:outline-none"
                        >
                          <option value="active">Active</option>
                          <option value="trial">Trial</option>
                          <option value="past_due">Past Due</option>
                          <option value="paused">Paused</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Fee ($ USD)</label>
                        <input
                          type="number"
                          min={0}
                          step="1"
                          value={memPrice}
                          onChange={(e) => setMemPrice(e.target.value)}
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-mono text-white focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Period</label>
                        <select
                          value={memPeriod}
                          onChange={(e) => setMemPeriod(e.target.value as any)}
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-white focus:border-cyan-500 focus:outline-none"
                        >
                          <option value="monthly">Monthly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="yearly">Yearly</option>
                          <option value="free">Free</option>
                        </select>
                      </div>
                      <div className="col-span-3 flex justify-end pt-1">
                        <button
                          type="button"
                          disabled={savingMembership}
                          onClick={() => void handleSaveMembership(link.id)}
                          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1 text-[11px] font-semibold text-white"
                        >
                          {savingMembership ? 'Saving...' : 'Save Billing'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center space-y-2">
          <Users className="h-8 w-8 text-slate-600 mx-auto" />
          <p className="text-sm font-semibold text-slate-300">No linked students match the current filter</p>
          <p className="text-xs text-slate-500">
            Share your Invite Code so students can connect their Child MT5 demo accounts.
          </p>
        </div>
      )}

      <ConfirmationModal
        isOpen={Boolean(pendingUnlink)}
        onClose={() => setPendingUnlink(null)}
        onConfirm={handleConfirmUnlink}
        isLoading={isProcessing}
        variant="danger"
        title="Remove Student Follower"
        description={`Sever copy link for ${pendingUnlink?.traderName || 'this student'}? Future parent deals will no longer be dispatched to their child terminal.`}
        confirmLabel="Remove Follower"
      />

      <ConfirmationModal
        isOpen={Boolean(pendingDeleteGroup)}
        onClose={() => setPendingDeleteGroup(null)}
        onConfirm={handleConfirmDeleteGroup}
        isLoading={isProcessing}
        variant="danger"
        title="Delete Strategy Group"
        description={`Delete group "${pendingDeleteGroup?.name || ''}"? Assigned followers remain active and will move to Ungrouped.`}
        confirmLabel="Delete Group"
      />

      {pendingSuspend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <form
            onSubmit={handleConfirmSuspend}
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center gap-2 text-rose-300">
              <ShieldOff className="h-5 w-5 text-rose-400 shrink-0" />
              <h3 className="text-base font-bold text-white">Suspend Student Copying</h3>
            </div>
            <p className="text-slate-300 leading-relaxed">
              Suspend <strong>{pendingSuspend.traderName}</strong>? Future open trade instructions will be blocked while existing open positions remain untouched. Students cannot unsuspend themselves.
            </p>
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                Suspension Reason (Optional)
              </label>
              <input
                type="text"
                maxLength={200}
                placeholder="e.g. Membership overdue or manual risk pause"
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  setPendingSuspend(null);
                  setSuspendReason('');
                }}
                className="rounded-lg px-4 py-2 font-medium text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isProcessing}
                className="rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 px-4 py-2 font-semibold text-white transition-colors"
              >
                {isProcessing ? 'Suspending...' : 'Confirm Suspend'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
