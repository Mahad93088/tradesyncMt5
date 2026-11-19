import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users,
  Plus,
  Search,
  AlertTriangle,
  UserCheck,
  Edit2,
  Eye,
  X,
  RefreshCw,
  Archive,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { User, MentorProfile } from '../../types';
import {
  AdminPageHeader,
  AdminStatusText,
  AdminFeedbackBanner,
  AdminEmptyState,
} from './adminUi';

interface MentorsManagementProps {
  isCreateOpen: boolean;
  setIsCreateOpen: (open: boolean) => void;
}

export const MentorsManagement: React.FC<MentorsManagementProps> = ({
  isCreateOpen,
  setIsCreateOpen,
}) => {
  const {
    users,
    mentorProfiles,
    mt5Accounts,
    subscriptions,
    subscriptionPlans,
    parentChildLinks,
    auditLogs,
    toggleUserStatus,
    archiveUser,
    editMentorProfile,
    renewOrChangeSubscription,
    refreshCloudData,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'pending' | 'suspended'>('all');

  const [confirmModalData, setConfirmModalData] = useState<{
    isOpen: boolean;
    mentor: User | null;
    action: 'approve' | 'suspend' | 'reactivate' | 'archive';
  }>({
    isOpen: false,
    mentor: null,
    action: 'suspend',
  });

  const [detailsMentor, setDetailsMentor] = useState<User | null>(null);

  const [editingMentor, setEditingMentor] = useState<{
    user: User;
    profile: MentorProfile;
  } | null>(null);

  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editStrategyName, setEditStrategyName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMonthlyFee, setEditMonthlyFee] = useState(149);
  const [editMaxFollowers, setEditMaxFollowers] = useState(25);

  const [editingSubMentorId, setEditingSubMentorId] = useState<string | null>(null);
  const [editPlanId, setEditPlanId] = useState<string>('');
  const [editBillingCycle, setEditBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const { isCloudMode } = useAuth();
  const [isLoadingCloud, setIsLoadingCloud] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const loadMentors = useCallback(async () => {
    if (!isCloudMode) return;
    setIsLoadingCloud(true);
    setCloudError(null);
    try {
      await refreshCloudData();
    } catch (err: any) {
      setCloudError(err?.message || 'Failed to refresh mentors from backend.');
    } finally {
      setIsLoadingCloud(false);
    }
  }, [isCloudMode, refreshCloudData]);

  useEffect(() => {
    const handlePromoted = () => {
      void loadMentors();
    };
    window.addEventListener('tradesync:mentor-promoted', handlePromoted);
    window.removeEventListener('tradesync:user-approved', handlePromoted);
    window.addEventListener('tradesync:user-approved', handlePromoted);
    return () => {
      window.removeEventListener('tradesync:mentor-promoted', handlePromoted);
      window.removeEventListener('tradesync:user-approved', handlePromoted);
    };
  }, [loadMentors]);

  const prevCreateOpenRef = useRef(isCreateOpen);
  useEffect(() => {
    if (prevCreateOpenRef.current && !isCreateOpen && isCloudMode) {
      void loadMentors();
    }
    prevCreateOpenRef.current = isCreateOpen;
  }, [isCreateOpen, isCloudMode, loadMentors]);

  const effectiveMentors = users.filter((u) => u.role === 'mentor');

  const filteredMentors = effectiveMentors.filter((m) => {
    const matchesSearch =
      m.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.username && m.username.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = filterStatus === 'all' || m.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const handleConfirmStatusChange = async () => {
    if (!confirmModalData.mentor) return;
    const target = confirmModalData.mentor;
    const actionLabel = confirmModalData.action;
    setCloudError(null);
    setActionSuccess(null);
    const res =
      actionLabel === 'archive'
        ? await archiveUser(target.id)
        : await toggleUserStatus(target.id);
    if (!res.success) {
      setCloudError(res.message || `Failed to ${actionLabel} mentor account.`);
    } else {
      setActionSuccess(
        res.message ||
          (actionLabel === 'archive'
            ? `${target.fullName} archived and billing history preserved.`
            : `${target.fullName} status updated (${actionLabel === 'suspend' ? 'suspended' : 'active'}).`)
      );
    }
  };

  const handleOpenEdit = (mentorUser: User) => {
    const profile: MentorProfile = mentorProfiles.find((p) => p.userId === mentorUser.id) || {
      id: `mp_${mentorUser.id}`,
      userId: mentorUser.id,
      displayName: mentorUser.fullName,
      strategyName: 'Verified Strategy Alpha',
      description: 'Active verified trading strategy.',
      winRate: 72.4,
      profitFactor: 2.15,
      monthlyFee: 149,
      maxFollowers: 25,
      totalFollowers: 0,
      totalTrades: 128,
      inviteCode: `TS-${mentorUser.id.slice(0, 6).toUpperCase()}`,
      inviteLink: `https://tradesync.io/invite/TS-${mentorUser.id.slice(0, 6).toUpperCase()}`,
      subscriptionPlanId: 'plan_pro',
      subscriptionStatus: 'active',
      subscriptionExpiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      riskScore: 'Low',
    };
    setEditingMentor({ user: mentorUser, profile });
    setEditFullName(mentorUser.fullName);
    setEditEmail(mentorUser.email);
    setEditPhone(mentorUser.phone || '');
    setEditStrategyName(profile.strategyName);
    setEditDescription(profile.description);
    setEditMonthlyFee(profile.monthlyFee);
    setEditMaxFollowers(profile.maxFollowers);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMentor) return;

    editMentorProfile(editingMentor.user.id, {
      fullName: editFullName,
      email: editEmail,
      phone: editPhone,
      strategyName: editStrategyName,
      description: editDescription,
      monthlyFee: editMonthlyFee,
      maxFollowers: editMaxFollowers,
    });

    setEditingMentor(null);
  };

  const handleSaveSubscription = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSubMentorId || !editPlanId) return;
    renewOrChangeSubscription(editingSubMentorId, editPlanId, editBillingCycle);
    setEditingSubMentorId(null);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Mentor Management"
        meta={`${effectiveMentors.length} Registered · ${effectiveMentors.filter((m) => m.status === 'active').length} Active`}
        subtitle={
          isCloudMode
            ? 'Manage verified mentor profiles in public.profiles. Only verified active mentors can be assigned Parent MT5 terminals.'
            : 'Approve, activate, suspend, and configure mentor profiles, parent terminals, and follower quotas.'
        }
        actions={
          <>
            {isCloudMode && (
              <button
                type="button"
                onClick={() => void loadMentors()}
                disabled={isLoadingCloud}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoadingCloud ? 'animate-spin text-sky-600' : 'text-slate-500'}`} />
                <span>Refresh</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{isCloudMode ? 'Approve / Provision Mentor' : 'Provision Mentor'}</span>
            </button>
          </>
        }
      />

      {isCloudMode && !isLoadingCloud && effectiveMentors.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1">
              <h3 className="text-sm font-semibold text-amber-950">
                0 active mentors in database. No verified active mentors found in public.profiles.
              </h3>
              <p className="text-xs text-amber-900 leading-relaxed">
                Parent MT5 accounts cannot be assigned until a profile exists with <code className="font-mono bg-white px-1 py-0.5 rounded border border-amber-200">role = &apos;mentor&apos;</code> and <code className="font-mono bg-white px-1 py-0.5 rounded border border-amber-200">status = &apos;active&apos;</code>.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  <UserCheck className="h-4 w-4" />
                  <span>Approve Registered User as Mentor</span>
                </button>
                <button
                  type="button"
                  onClick={() => void loadMentors()}
                  className="text-xs text-amber-900 hover:text-slate-900 underline font-medium"
                >
                  Re-query public.profiles
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {cloudError && (
        <AdminFeedbackBanner type="error" message={cloudError} onDismiss={() => setCloudError(null)} />
      )}

      {actionSuccess && (
        <AdminFeedbackBanner type="success" message={actionSuccess} onDismiss={() => setActionSuccess(null)} />
      )}

      {/* Search & Status Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search mentor name, username, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto text-xs">
          <span className="text-slate-600 font-medium">Status:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-500"
          >
            <option value="all">All Mentors</option>
            <option value="active">Active Only</option>
            <option value="pending">Pending Approval</option>
            <option value="suspended">Suspended Only</option>
          </select>
        </div>
      </div>

      {/* Mentors Table */}
      {filteredMentors.length === 0 ? (
        <AdminEmptyState
          icon={Users}
          title="No mentors match your filter criteria"
          description={
            isCloudMode && effectiveMentors.length === 0
              ? 'Approve a registered user as an active mentor to unlock Parent MT5 terminal assignment.'
              : 'Adjust your search query or status filter, or provision a new mentor profile.'
          }
          action={
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{isCloudMode ? 'Approve / Provision Mentor' : 'Provision Mentor'}</span>
            </button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Mentor &amp; Invite Code</th>
                  <th className="px-4 py-3">Parent Terminal</th>
                  <th className="px-4 py-3">Followers</th>
                  <th className="px-4 py-3">{isCloudMode ? 'Billing / Plan' : 'Subscription'}</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMentors.map((mentor) => {
                  const profile = mentorProfiles.find((p) => p.userId === mentor.id);
                  const parentAccount = mt5Accounts.find(
                    (a) => a.userId === mentor.id && a.accountRole === 'parent'
                  );
                  const sub = subscriptions.find((s) => s.mentorId === mentor.id || s.userId === mentor.id);
                  const followersCount = parentChildLinks.filter(
                    (l) => l.mentorId === mentor.id && l.status === 'active'
                  ).length;
                  const maxFollowersQuota = sub?.maxFollowers ?? profile?.maxFollowers ?? 25;
                  const deterministicInvite = `TS-${mentor.id.slice(0, 8).toUpperCase()}`;

                  return (
                    <tr key={mentor.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full overflow-hidden border border-slate-200 bg-slate-100 shrink-0 flex items-center justify-center font-bold text-xs text-slate-700">
                            {mentor.avatarUrl ? (
                              <img src={mentor.avatarUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              mentor.fullName[0]
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-900">{mentor.fullName}</span>
                              {mentor.username && (
                                <span className="text-[11px] font-mono text-slate-500">@{mentor.username}</span>
                              )}
                            </div>
                            <p className="text-[11px] text-sky-700 font-mono">
                              {profile?.strategyName || (isCloudMode ? `Invite: ${deterministicInvite}` : 'Strategy Alpha')}
                            </p>
                            <span className="text-[11px] text-slate-500">{mentor.email}</span>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        {parentAccount ? (
                          <div className="space-y-1 font-mono">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-900 tabular-nums">
                                #{parentAccount.accountNumber}
                              </span>
                              <AdminStatusText status={parentAccount.isStale ? 'stale' : parentAccount.connectionStatus} />
                            </div>
                            <p className="text-[11px] text-slate-500 font-sans">
                              {parentAccount.broker}
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">No terminal bound</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 font-mono tabular-nums">
                        <span className="font-semibold text-slate-900">{followersCount}</span>
                        <span className="text-slate-500 text-[11px]"> / {maxFollowersQuota}</span>
                      </td>

                      <td className="px-4 py-3.5">
                        {sub ? (
                          <div className="space-y-1">
                            <span className="text-slate-800 font-medium text-[11px] block">
                              {sub.planName}
                            </span>
                            <AdminStatusText status={sub.status} />
                          </div>
                        ) : (
                          <span className="text-[11px] font-mono text-slate-500">
                            {isCloudMode ? 'No active plan' : 'Standard Tier'}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600 tabular-nums">
                        {new Date(mentor.createdAt).toLocaleDateString()}
                      </td>

                      <td className="px-4 py-3.5">
                        <AdminStatusText status={mentor.status} />
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetailsMentor(mentor)}
                            className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                            title="View mentor details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          {!isCloudMode && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(mentor)}
                                className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                                title="Edit mentor profile (Demo)"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSubMentorId(mentor.id);
                                  setEditPlanId(sub?.planId || subscriptionPlans[0]?.id || '');
                                  setEditBillingCycle(sub?.billingCycle || 'monthly');
                                }}
                                className="rounded-md px-2.5 py-1 text-[11px] font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 whitespace-nowrap transition-colors"
                              >
                                Plan
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              const action: 'approve' | 'suspend' | 'reactivate' =
                                mentor.status === 'active'
                                  ? 'suspend'
                                  : mentor.status === 'pending'
                                  ? 'approve'
                                  : 'reactivate';
                              setConfirmModalData({
                                isOpen: true,
                                mentor,
                                action,
                              });
                            }}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold border whitespace-nowrap transition-colors ${
                              mentor.status === 'active'
                                ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {mentor.status === 'active'
                              ? 'Suspend'
                              : mentor.status === 'pending'
                              ? 'Approve'
                              : 'Reactivate'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setConfirmModalData({
                                isOpen: true,
                                mentor,
                                action: 'archive',
                              });
                            }}
                            title="Archive user & preserve billing history"
                            className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mentor Details Modal */}
      {detailsMentor && (() => {
        const profile = mentorProfiles.find((p) => p.userId === detailsMentor.id);
        const parentAccount = mt5Accounts.find((a) => a.userId === detailsMentor.id && a.accountRole === 'parent');
        const followers = parentChildLinks.filter((l) => l.mentorId === detailsMentor.id);
        const sub = subscriptions.find((s) => s.mentorId === detailsMentor.id);
        const mentorAuditHistory = auditLogs.filter(
          (log) => log.actorId === detailsMentor.id || log.targetId === detailsMentor.id
        ).slice(0, 5);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5 my-auto">
              <div className="flex items-start justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-sm text-slate-800">
                    {detailsMentor.fullName[0]}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      {detailsMentor.fullName}
                      {detailsMentor.username && (
                        <span className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-700">
                          @{detailsMentor.username}
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-sky-700 font-medium">{profile?.strategyName || 'Verified Mentor'}</p>
                    <span className="text-[11px] text-slate-500 font-mono">{detailsMentor.email}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailsMentor(null)}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                  <span className="text-slate-500 text-[10px] uppercase font-mono">Invite Code</span>
                  <p className="font-mono font-bold text-sky-700 text-sm mt-0.5">
                    {isCloudMode
                      ? `TS-${detailsMentor.id.slice(0, 8).toUpperCase()}`
                      : profile?.inviteCode || `TS-${detailsMentor.id.slice(0, 8).toUpperCase()}`}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                  <span className="text-slate-500 text-[10px] uppercase font-mono">Subscription</span>
                  <p className="font-mono font-bold text-slate-900 text-xs mt-1">
                    {sub ? `${sub.planName} (${sub.status})` : isCloudMode ? 'No Active Plan' : 'Standard (active)'}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                  <span className="text-slate-500 text-[10px] uppercase font-mono">Plan Limit</span>
                  <p className="font-mono font-bold text-slate-900 text-sm mt-0.5 tabular-nums">
                    {followers.length} / {sub?.maxFollowers ?? profile?.maxFollowers ?? 25}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                  <span className="text-slate-500 text-[10px] uppercase font-mono">Account Status</span>
                  <div className="mt-1"><AdminStatusText status={detailsMentor.status} /></div>
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-1.5">
                <span className="font-semibold text-slate-800 block">Parent MT5 Account (Demo)</span>
                {parentAccount ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] text-slate-600">
                    <div>Account: <strong className="text-slate-900">#{parentAccount.accountNumber}</strong></div>
                    <div>Broker: <strong className="text-slate-900">{parentAccount.broker}</strong></div>
                    <div>Equity: <strong className="text-emerald-700">${parentAccount.equity.toLocaleString()}</strong></div>
                    <div>Status: <AdminStatusText status={parentAccount.isStale ? 'stale' : parentAccount.connectionStatus} /></div>
                  </div>
                ) : (
                  <p className="text-slate-500 italic">No parent MT5 terminal bound.</p>
                )}
              </div>

              <div className="space-y-2 text-xs">
                <span className="font-semibold text-slate-800 block">Assigned Follower Traders ({followers.length})</span>
                {followers.length > 0 ? (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {followers.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px]"
                      >
                        <span className="text-slate-900 font-sans font-medium">{f.traderName}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500">Mode: {f.lotSettings.mode === 'parent_lot' ? '1:1' : f.lotSettings.customType}</span>
                          <AdminStatusText status={f.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 italic">No followers currently linked.</p>
                )}
              </div>

              <div className="space-y-2 text-xs">
                <span className="font-semibold text-slate-800 block">Activity History</span>
                {mentorAuditHistory.length > 0 ? (
                  <div className="space-y-1.5 max-h-28 overflow-y-auto">
                    {mentorAuditHistory.map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px]">
                        <span className="text-slate-700 truncate pr-3"><strong className="font-mono">{item.action}</strong> · {item.details}</span>
                        <span className="font-mono text-slate-400 shrink-0 tabular-nums">{new Date(item.timestamp).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 italic">No recent admin audit events recorded for this mentor.</p>
                )}
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setDetailsMentor(null)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Mentor Profile Modal (Demo Mode Only) */}
      {editingMentor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Edit2 className="h-4 w-4 text-sky-600" />
                Edit Mentor Profile: {editingMentor.user.fullName}
              </h3>
              <button type="button" onClick={() => setEditingMentor(null)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Strategy Name</label>
                  <input
                    type="text"
                    required
                    value={editStrategyName}
                    onChange={(e) => setEditStrategyName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Monthly Fee ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={editMonthlyFee}
                    onChange={(e) => setEditMonthlyFee(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Strategy Description</label>
                <textarea
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Max Followers Quota</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={editMaxFollowers}
                  onChange={(e) => setEditMaxFollowers(parseInt(e.target.value, 10) || 10)}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingMentor(null)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 font-semibold text-white transition-colors"
                >
                  Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Subscription Plan Config Modal (Demo Mode Only) */}
      {editingSubMentorId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Configure Mentor Subscription</h3>
            <form onSubmit={handleSaveSubscription} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Select Plan</label>
                <select
                  value={editPlanId}
                  onChange={(e) => setEditPlanId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                >
                  {subscriptionPlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} - ${p.price} ({p.billingCycle})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Billing Interval</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditBillingCycle('monthly')}
                    className={`rounded-lg border p-2 text-center font-medium transition-colors ${
                      editBillingCycle === 'monthly'
                        ? 'border-sky-600 bg-sky-50 text-sky-800'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditBillingCycle('yearly')}
                    className={`rounded-lg border p-2 text-center font-medium transition-colors ${
                      editBillingCycle === 'yearly'
                        ? 'border-sky-600 bg-sky-50 text-sky-800'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    Yearly
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingSubMentorId(null)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 font-semibold text-white transition-colors"
                >
                  Update Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={confirmModalData.isOpen}
        onClose={() => setConfirmModalData({ isOpen: false, mentor: null, action: 'suspend' })}
        onConfirm={() => {
          void handleConfirmStatusChange();
        }}
        title={
          confirmModalData.action === 'archive'
            ? 'Archive Mentor Account'
            : confirmModalData.action === 'suspend'
            ? 'Suspend Mentor Account'
            : confirmModalData.action === 'approve'
            ? 'Approve Mentor Account'
            : 'Reactivate Mentor Account'
        }
        description={
          confirmModalData.action === 'archive'
            ? `Archive ${confirmModalData.mentor?.fullName}? Active copy assignments will pause, terminals will disconnect, and all subscriptions, payments, and invoices remain preserved cleanly for audit compliance.`
            : confirmModalData.action === 'suspend'
            ? `Are you sure you want to suspend ${confirmModalData.mentor?.fullName}? Active follower copy links will be paused immediately to prevent unsanctioned trade execution.`
            : confirmModalData.action === 'approve'
            ? `Approve ${confirmModalData.mentor?.fullName} as an active mentor? They will gain access to Parent MT5 registration and follower linking.`
            : `Are you sure you want to reactivate ${confirmModalData.mentor?.fullName}? Their follower copy streams can resume operation.`
        }
        confirmLabel={
          confirmModalData.action === 'archive'
            ? 'Archive & Preserve History'
            : confirmModalData.action === 'suspend'
            ? 'Suspend Account'
            : confirmModalData.action === 'approve'
            ? 'Approve Mentor'
            : 'Reactivate Account'
        }
        variant={confirmModalData.action === 'suspend' || confirmModalData.action === 'archive' ? 'danger' : 'primary'}
      />
    </div>
  );
};
