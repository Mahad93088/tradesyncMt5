import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users,
  Plus,
  Search,
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  Edit2,
  Eye,
  X,
  Phone,
  Mail,
  Calendar,
  DollarSign,
  TrendingUp,
  Server,
  RefreshCw,
  Database,
  AlertCircle
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { mt5AdminService } from '../../services/mt5AdminService';
import { StatusBadge } from '../common/StatusBadge';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { User, MentorProfile } from '../../types';

interface MentorsManagementProps {
  isCreateOpen: boolean;
  setIsCreateOpen: (open: boolean) => void;
}

export const MentorsManagement: React.FC<MentorsManagementProps> = ({
  isCreateOpen,
  setIsCreateOpen
}) => {
  const {
    users,
    mentorProfiles,
    mt5Accounts,
    subscriptions,
    subscriptionPlans,
    parentChildLinks,
    toggleUserStatus,
    editMentorProfile,
    renewOrChangeSubscription
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'suspended'>('all');

  // Confirmation Modal state for suspend / reactivate
  const [confirmModalData, setConfirmModalData] = useState<{
    isOpen: boolean;
    mentor: User | null;
    action: 'suspend' | 'reactivate';
  }>({
    isOpen: false,
    mentor: null,
    action: 'suspend'
  });

  // Details Modal state
  const [detailsMentor, setDetailsMentor] = useState<User | null>(null);

  // Edit Mentor Modal state
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

  // Edit Subscription Modal State
  const [editingSubMentorId, setEditingSubMentorId] = useState<string | null>(null);
  const [editPlanId, setEditPlanId] = useState<string>('');
  const [editBillingCycle, setEditBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const { isCloudMode } = useAuth();
  const [cloudMentors, setCloudMentors] = useState<User[]>([]);
  const [isLoadingCloud, setIsLoadingCloud] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string | null>(null);

  const loadMentors = useCallback(async () => {
    if (!isCloudMode) return;
    setIsLoadingCloud(true);
    setCloudError(null);
    try {
      const verified = await mt5AdminService.getVerifiedMentors(true, users);
      const mapped: User[] = verified.map((v) => ({
        id: v.id,
        fullName: v.fullName,
        email: v.email,
        role: 'mentor',
        status: v.status,
        avatarUrl: v.avatarUrl,
        createdAt: new Date().toISOString(),
      }));
      setCloudMentors(mapped);
    } catch (err: any) {
      console.error('[MentorsManagement] Error querying verified mentors:', err);
      setCloudError(err?.message || 'Failed to query active mentors from database.');
    } finally {
      setIsLoadingCloud(false);
    }
  }, [isCloudMode, users]);

  // Initial load
  useEffect(() => {
    if (isCloudMode) {
      loadMentors();
    }
  }, [isCloudMode, loadMentors]);

  // Global listener for mentor promotions and user approvals across modal workflows
  useEffect(() => {
    const handlePromoted = () => {
      loadMentors();
    };
    window.addEventListener('tradesync:mentor-promoted', handlePromoted);
    window.addEventListener('tradesync:user-approved', handlePromoted);
    return () => {
      window.removeEventListener('tradesync:mentor-promoted', handlePromoted);
      window.removeEventListener('tradesync:user-approved', handlePromoted);
    };
  }, [loadMentors]);

  // Auto-refresh when Provision / Approve modal closes
  const prevCreateOpenRef = useRef(isCreateOpen);
  useEffect(() => {
    if (prevCreateOpenRef.current && !isCreateOpen && isCloudMode) {
      loadMentors();
    }
    prevCreateOpenRef.current = isCreateOpen;
  }, [isCreateOpen, isCloudMode, loadMentors]);

  const effectiveMentors = isCloudMode
    ? cloudMentors
    : users.filter((u) => u.role === 'mentor');

  const filteredMentors = effectiveMentors.filter((m) => {
    const matchesSearch =
      m.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || m.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

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
      maxFollowers: editMaxFollowers
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
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            Mentor Management
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono">
              {effectiveMentors.length} Registered
            </span>
            {isCloudMode && (
              <span className="rounded bg-cyan-950/80 border border-cyan-800/60 px-2 py-0.5 text-[10px] font-mono text-cyan-300 flex items-center gap-1">
                <Database className="h-3 w-3" />
                <span>Cloud PostgreSQL</span>
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {isCloudMode
              ? 'Manage verified mentor profiles in public.profiles. Only verified active mentors can be assigned Parent MT5 terminals.'
              : 'Manage mentor profiles, verify demo parent terminals, adjust subscriber quotas, and handle account status.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isCloudMode && (
            <button
              type="button"
              onClick={() => loadMentors()}
              disabled={isLoadingCloud}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors disabled:opacity-50"
              title="Refresh verified mentors from database"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingCloud ? 'animate-spin text-sky-400' : 'text-slate-400'}`} />
              <span>Refresh</span>
            </button>
          )}
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>{isCloudMode ? 'Approve / Provision Mentor' : 'Provision Mentor'}</span>
          </button>
        </div>
      </div>

      {/* Prominent Database Notice when 0 active mentors found in Cloud Mode */}
      {isCloudMode && !isLoadingCloud && effectiveMentors.length === 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 animate-in fade-in">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <h3 className="text-sm font-semibold text-amber-200">
                  0 active mentors in database. No verified active mentors found in public.profiles.
                </h3>
                <span className="rounded bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] font-mono text-amber-300 w-fit">
                  PostgreSQL Trigger Active
                </span>
              </div>
              <p className="text-xs text-amber-300/80 leading-relaxed">
                Parent MT5 accounts (such as #8829410) cannot be assigned because PostgreSQL database trigger <code className="font-mono bg-black/40 px-1 py-0.5 rounded text-amber-200">validate_mentor_assignment()</code> requires a real mentor profile with <code className="font-mono bg-black/40 px-1 py-0.5 rounded text-amber-200">role = 'mentor'</code> and <code className="font-mono bg-black/40 px-1 py-0.5 rounded text-amber-200">status = 'active'</code>.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 px-3.5 py-1.5 text-xs font-bold text-slate-950 transition-colors shadow-sm"
                >
                  <UserCheck className="h-4 w-4" />
                  <span>Approve Registered User as Mentor</span>
                </button>
                <button
                  type="button"
                  onClick={() => loadMentors()}
                  className="text-xs text-amber-300 hover:text-white underline font-medium"
                >
                  Re-query public.profiles
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {cloudError && (
        <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 p-3 text-xs text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span>{cloudError}</span>
          </div>
          <button
            onClick={() => loadMentors()}
            className="text-xs font-semibold underline hover:text-white"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search mentor name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-400">Status:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="rounded-lg border border-slate-750 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
          >
            <option value="all">All Mentors</option>
            <option value="active">Active Only</option>
            <option value="suspended">Suspended Only</option>
          </select>
        </div>
      </div>

      {/* Mentors Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-slate-950/90 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Mentor & Strategy</th>
                <th className="px-4 py-3">Parent Terminal</th>
                <th className="px-4 py-3">Followers</th>
                <th className="px-4 py-3">Subscription</th>
                <th className="px-4 py-3">Created Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredMentors.map((mentor) => {
                const profile = mentorProfiles.find((p) => p.userId === mentor.id);
                const parentAccount = mt5Accounts.find(
                  (a) => a.userId === mentor.id && a.accountRole === 'parent'
                );
                const sub = subscriptions.find((s) => s.mentorId === mentor.id);
                const followersCount = parentChildLinks.filter(
                  (l) => l.mentorId === mentor.id && l.status === 'active'
                ).length;

                return (
                  <tr key={mentor.id} className="hover:bg-slate-850/40 transition-colors">
                    {/* Mentor & Strategy */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full overflow-hidden border border-slate-700 bg-slate-800 shrink-0 flex items-center justify-center font-bold text-xs text-slate-300">
                          {mentor.avatarUrl ? (
                            <img src={mentor.avatarUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            mentor.fullName[0]
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-100">{mentor.fullName}</span>
                            {mentor.username && (
                              <span className="text-[10px] font-mono text-slate-400">@{mentor.username}</span>
                            )}
                          </div>
                          <p className="text-[11px] text-sky-400 font-medium">
                            {profile?.strategyName || 'Strategy Alpha'}
                          </p>
                          <span className="text-[10px] text-slate-500">{mentor.email}</span>
                        </div>
                      </div>
                    </td>

                    {/* Parent Terminal */}
                    <td className="px-4 py-3.5">
                      {parentAccount ? (
                        <div className="space-y-0.5 font-mono">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-200">
                              #{parentAccount.accountNumber}
                            </span>
                            <StatusBadge status={parentAccount.connectionStatus} size="sm" />
                          </div>
                          <p className="text-[10px] text-slate-400 font-sans">
                            {parentAccount.broker}
                          </p>
                        </div>
                      ) : (
                        <span className="text-slate-500 italic text-[11px]">No terminal bound</span>
                      )}
                    </td>

                    {/* Followers Count */}
                    <td className="px-4 py-3.5 font-mono">
                      <span className="font-semibold text-slate-200">{followersCount}</span>
                      <span className="text-slate-500 text-[10px]"> / {profile?.maxFollowers || 25}</span>
                    </td>

                    {/* Subscription */}
                    <td className="px-4 py-3.5">
                      <div className="space-y-0.5">
                        <span className="text-slate-300 font-medium text-[11px]">
                          {sub?.planName || 'Standard Tier'}
                        </span>
                        <div>
                          <StatusBadge status={sub?.status || 'active'} size="sm" />
                        </div>
                      </div>
                    </td>

                    {/* Creation Date */}
                    <td className="px-4 py-3.5 font-mono text-[11px] text-slate-400">
                      {new Date(mentor.createdAt).toLocaleDateString()}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5">
                      <StatusBadge status={mentor.status} size="sm" />
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* View Details */}
                        <button
                          onClick={() => setDetailsMentor(mentor)}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
                          title="View mentor details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>

                        {/* Edit Profile */}
                        <button
                          onClick={() => handleOpenEdit(mentor)}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
                          title="Edit mentor profile"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>

                        {/* Subscription */}
                        <button
                          onClick={() => {
                            setEditingSubMentorId(mentor.id);
                            setEditPlanId(sub?.planId || subscriptionPlans[0].id);
                            setEditBillingCycle(sub?.billingCycle || 'monthly');
                          }}
                          className="rounded px-2 py-1 text-[11px] font-medium border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-750 transition-colors"
                        >
                          Plan
                        </button>

                        {/* Suspend / Reactivate with Confirmation */}
                        <button
                          onClick={() => {
                            setConfirmModalData({
                              isOpen: true,
                              mentor,
                              action: mentor.status === 'active' ? 'suspend' : 'reactivate'
                            });
                          }}
                          className={`rounded px-2 py-1 text-[11px] font-medium border transition-colors ${
                            mentor.status === 'active'
                              ? 'border-rose-900/60 bg-rose-950/40 text-rose-300 hover:bg-rose-900/50'
                              : 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50'
                          }`}
                        >
                          {mentor.status === 'active' ? 'Suspend' : 'Reactivate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredMentors.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    <Users className={`h-9 w-9 mx-auto mb-2.5 ${isCloudMode && effectiveMentors.length === 0 ? 'text-amber-400 opacity-80' : 'text-slate-600 opacity-60'}`} />
                    {isCloudMode && effectiveMentors.length === 0 ? (
                      <div className="space-y-2 max-w-md mx-auto">
                        <p className="text-xs font-semibold text-amber-300">
                          0 active mentors in database. No verified active mentors found in public.profiles.
                        </p>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Supabase requires a verified mentor record (<code className="font-mono text-amber-200">role = 'mentor'</code>, <code className="font-mono text-amber-200">status = 'active'</code>) before Parent MT5 accounts can be assigned.
                        </p>
                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={() => setIsCreateOpen(true)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 px-3.5 py-1.5 text-xs font-bold text-slate-950 transition-colors shadow-sm"
                          >
                            <UserCheck className="h-4 w-4" />
                            <span>Approve Registered User as Mentor</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs font-medium text-slate-400">No mentors match your filter criteria.</p>
                        <button
                          onClick={() => setIsCreateOpen(true)}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Provision Mentor</span>
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mentor Details Modal */}
      {detailsMentor && (() => {
        const profile = mentorProfiles.find((p) => p.userId === detailsMentor.id);
        const parentAccount = mt5Accounts.find((a) => a.userId === detailsMentor.id && a.accountRole === 'parent');
        const followers = parentChildLinks.filter((l) => l.mentorId === detailsMentor.id);
        const sub = subscriptions.find((s) => s.mentorId === detailsMentor.id);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-5">
              <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-sm text-slate-200">
                    {detailsMentor.fullName[0]}
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                      {detailsMentor.fullName}
                      {detailsMentor.username && (
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-sky-400">
                          @{detailsMentor.username}
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-sky-400 font-medium">{profile?.strategyName}</p>
                    <span className="text-[11px] text-slate-500 font-mono">{detailsMentor.email}</span>
                  </div>
                </div>
                <button
                  onClick={() => setDetailsMentor(null)}
                  className="text-slate-500 hover:text-slate-300"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Grid info */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2.5">
                  <span className="text-slate-500 text-[10px] uppercase font-mono">Win Rate</span>
                  <p className="font-mono font-bold text-emerald-400 text-sm mt-0.5">{profile?.winRate}%</p>
                </div>
                <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2.5">
                  <span className="text-slate-500 text-[10px] uppercase font-mono">Profit Factor</span>
                  <p className="font-mono font-bold text-slate-200 text-sm mt-0.5">{profile?.profitFactor}</p>
                </div>
                <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2.5">
                  <span className="text-slate-500 text-[10px] uppercase font-mono">Trader Fee</span>
                  <p className="font-mono font-bold text-slate-200 text-sm mt-0.5">${profile?.monthlyFee}/mo</p>
                </div>
                <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2.5">
                  <span className="text-slate-500 text-[10px] uppercase font-mono">Followers</span>
                  <p className="font-mono font-bold text-slate-200 text-sm mt-0.5">{followers.length} / {profile?.maxFollowers}</p>
                </div>
              </div>

              {/* Description */}
              <div className="text-xs space-y-1">
                <span className="text-slate-400 font-medium">Strategy Methodology</span>
                <p className="rounded-lg bg-slate-950/60 border border-slate-800 p-3 text-slate-300 leading-relaxed">
                  {profile?.description || 'No detailed methodology specified.'}
                </p>
              </div>

              {/* Demo Account Info */}
              <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-3 text-xs space-y-1.5">
                <span className="font-semibold text-slate-300">Bound Master Terminal (Demo)</span>
                {parentAccount ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px] text-slate-400">
                    <div>Account: <strong className="text-slate-200">#{parentAccount.accountNumber}</strong></div>
                    <div>Broker: <strong className="text-slate-200">{parentAccount.broker}</strong></div>
                    <div>Status: <StatusBadge status={parentAccount.connectionStatus} size="sm" /></div>
                  </div>
                ) : (
                  <p className="text-slate-500 italic">No demo terminal connected.</p>
                )}
              </div>

              {/* Linked Followers List */}
              <div className="space-y-2 text-xs">
                <span className="font-semibold text-slate-300">Linked Followers ({followers.length})</span>
                {followers.length > 0 ? (
                  <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                    {followers.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/60 p-2 font-mono text-[11px]"
                      >
                        <span className="text-slate-200 font-sans">{f.traderName}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">Mode: {f.lotSettings.mode}</span>
                          <StatusBadge status={f.status} size="sm" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 italic">No followers currently linked.</p>
                )}
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-800">
                <button
                  onClick={() => setDetailsMentor(null)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Mentor Profile Modal */}
      {editingMentor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Edit2 className="h-4 w-4 text-sky-400" />
                Edit Mentor Profile: {editingMentor.user.fullName}
              </h3>
              <button
                onClick={() => setEditingMentor(null)}
                className="text-slate-500 hover:text-slate-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Strategy Name</label>
                  <input
                    type="text"
                    required
                    value={editStrategyName}
                    onChange={(e) => setEditStrategyName(e.target.value)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Monthly Trader Fee ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={editMonthlyFee}
                    onChange={(e) => setEditMonthlyFee(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Strategy Description</label>
                <textarea
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Max Followers Quota</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={editMaxFollowers}
                  onChange={(e) => setEditMaxFollowers(parseInt(e.target.value) || 10)}
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingMentor(null)}
                  className="rounded-lg px-3 py-1.5 font-medium text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 font-semibold text-white transition-colors"
                >
                  Save Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Subscription Plan Config Modal */}
      {editingSubMentorId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-slate-100">Configure Mentor Subscription</h3>
            <p className="text-xs text-slate-400">
              Update the subscription tier and billing cycle for this mentor account.
            </p>

            <form onSubmit={handleSaveSubscription} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-400 font-medium mb-1">Select Plan</label>
                <select
                  value={editPlanId}
                  onChange={(e) => setEditPlanId(e.target.value)}
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                >
                  {subscriptionPlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} - ${p.price} ({p.billingCycle})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Billing Interval</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditBillingCycle('monthly')}
                    className={`rounded-lg border p-2 text-center font-medium transition-colors ${
                      editBillingCycle === 'monthly'
                        ? 'border-sky-500 bg-sky-950/50 text-sky-300'
                        : 'border-slate-800 bg-slate-950 text-slate-400'
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditBillingCycle('yearly')}
                    className={`rounded-lg border p-2 text-center font-medium transition-colors ${
                      editBillingCycle === 'yearly'
                        ? 'border-sky-500 bg-sky-950/50 text-sky-300'
                        : 'border-slate-800 bg-slate-950 text-slate-400'
                    }`}
                  >
                    Yearly (Discounted)
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingSubMentorId(null)}
                  className="rounded-lg px-3 py-1.5 font-medium text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 font-semibold text-white transition-colors"
                >
                  Update Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Dialog for Suspend / Reactivate */}
      <ConfirmationModal
        isOpen={confirmModalData.isOpen}
        onClose={() => setConfirmModalData({ isOpen: false, mentor: null, action: 'suspend' })}
        onConfirm={() => {
          if (confirmModalData.mentor) {
            toggleUserStatus(confirmModalData.mentor.id);
          }
        }}
        title={confirmModalData.action === 'suspend' ? 'Suspend Mentor Account' : 'Reactivate Mentor Account'}
        description={
          confirmModalData.action === 'suspend'
            ? `Are you sure you want to suspend ${confirmModalData.mentor?.fullName}? Active follower copy links will be paused immediately to prevent unsanctioned trade execution.`
            : `Are you sure you want to reactivate ${confirmModalData.mentor?.fullName}? Their follower copy streams can resume operation.`
        }
        confirmLabel={confirmModalData.action === 'suspend' ? 'Suspend Account' : 'Reactivate Account'}
        variant={confirmModalData.action === 'suspend' ? 'danger' : 'primary'}
      />
    </div>
  );
};
