import React, { useState, useEffect } from 'react';
import {
  X,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  Shield,
  Mail,
  User as UserIcon,
  UserCheck,
  Database,
  RefreshCw,
  AlertTriangle,
  Copy,
  Check,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { mt5AdminService } from '../../services/mt5AdminService';
import { AccountStatus } from '../../types';

interface ProvisionMentorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (createdUser?: any) => void;
}

export const ProvisionMentorModal: React.FC<ProvisionMentorModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { isCloudMode, user: currentAuthUser } = useAuth();
  const { subscriptionPlans, createMentor, users, refreshCloudData } = useApp();

  const [activeTab, setActiveTab] = useState<'create' | 'approve'>('create');

  // Create Mentor Form Fields (Cloud + Local)
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('active');
  const [strategyName, setStrategyName] = useState('');
  const [description, setDescription] = useState('');
  const [monthlyFee, setMonthlyFee] = useState<number>(149);
  const [maxFollowers, setMaxFollowers] = useState<number>(25);

  // Approve Existing Registered User state
  const [candidates, setCandidates] = useState<Array<{
    id: string;
    fullName: string;
    email: string;
    avatarUrl?: string;
    role: string;
    status: string;
  }>>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('');
  const [isLoadingCandidates, setIsLoadingCandidates] = useState<boolean>(false);
  const [approvalMode, setApprovalMode] = useState<'status_only' | 'mentor'>('mentor');

  // Feedback & Credential Summary
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [warningMessage, setWarningMessage] = useState<string>('');
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password?: string; fullName: string } | null>(null);
  const [copiedCreds, setCopiedCreds] = useState(false);

  const loadCandidates = async () => {
    setIsLoadingCandidates(true);
    try {
      const list = await mt5AdminService.getCandidateUsersForMentor(isCloudMode, users);
      setCandidates(list);
      const eligible = list.find((c) => c.id !== currentAuthUser?.id) || list[0];
      setSelectedCandidateId(eligible?.id || '');
    } catch (err: any) {
      setCandidates([]);
      setSelectedCandidateId('');
      setErrors((prev) => ({ ...prev, candidate: err.message || 'Failed to load candidate users.' }));
    } finally {
      setIsLoadingCandidates(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab('create');
    setFullName('');
    setEmail('');
    setPassword('');
    setUsername('');
    setSelectedPlanId(subscriptionPlans.find((p) => !p.isArchived)?.id || '');
    setBillingCycle('monthly');
    setAccountStatus('active');
    setStrategyName('');
    setDescription('');
    setMonthlyFee(149);
    setMaxFollowers(25);
    setErrors({});
    setIsSubmitting(false);
    setSuccessMessage('');
    setWarningMessage('');
    setCreatedCredentials(null);
    setCopiedCreds(false);
    void loadCandidates();
  }, [isOpen, isCloudMode, currentAuthUser?.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const chosenCandidate = candidates.find((c) => c.id === selectedCandidateId);
  const isSelfPromotion = Boolean(
    chosenCandidate && currentAuthUser?.id && chosenCandidate.id === currentAuthUser.id
  );

  const handleFullNameChange = (val: string) => {
    setFullName(val);
    if (!username || username === fullName.toLowerCase().replace(/[^a-z0-9]/g, '_')) {
      setUsername(val.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
    }
  };

  const handleCreateMentorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setWarningMessage('');
    setSuccessMessage('');

    if (!fullName.trim() || fullName.trim().length < 2) {
      setErrors({ fullName: 'Full Name is required (min 2 characters).' });
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrors({ email: 'A valid email address is required.' });
      return;
    }
    if (isCloudMode && (!password || password.length < 6)) {
      setErrors({ password: 'Initial login password must be at least 6 characters.' });
      return;
    }

    setIsSubmitting(true);

    try {
      if (isCloudMode) {
        const res = await mt5AdminService.createAdminUser({
          fullName: fullName.trim(),
          email: email.trim(),
          password,
          role: 'mentor',
          status: accountStatus,
          strategyName: strategyName.trim() || `${fullName.trim()}'s Strategy`,
          description: description.trim() || undefined,
          monthlyFee: monthlyFee || 0,
          maxFollowers: maxFollowers || 25,
          planId: selectedPlanId || undefined,
          billingCycle,
        });

        if (!res.success || !res.profile) {
          throw new Error(res.error || 'Failed to create mentor in Supabase.');
        }

        if (res.warning) setWarningMessage(res.warning);
        await refreshCloudData();
        setCreatedCredentials({
          fullName: fullName.trim(),
          email: email.trim(),
          password,
        });
        setSuccessMessage(
          `Created Mentor "${fullName.trim()}" (${email.trim()}) in Supabase without altering your Admin session.`
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('tradesync:mentor-promoted', { detail: res.profile }));
        }
        if (onSuccess) onSuccess(res.profile);
      } else {
        const cleanUsername = username.trim().replace(/^@/, '') || email.split('@')[0];
        const created = createMentor(
          {
            fullName: fullName.trim(),
            email: email.trim(),
            username: cleanUsername,
            status: accountStatus,
          },
          {
            strategyName: strategyName.trim() || `${fullName.trim()}'s Alpha Flow`,
            description: description.trim() || `MetaTrader 5 copy-trading strategy managed by ${fullName.trim()}.`,
            monthlyFee: monthlyFee || 0,
          },
          selectedPlanId || undefined
        );
        setCreatedCredentials({
          fullName: fullName.trim(),
          email: email.trim(),
        });
        setSuccessMessage(`Created demo mentor "${fullName.trim()}"!`);
        if (onSuccess) onSuccess(created);
      }
    } catch (err: any) {
      setErrors({ form: err.message || 'Failed to create mentor.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setWarningMessage('');
    setSuccessMessage('');

    if (!selectedCandidateId) {
      setErrors({ candidate: 'Please select a registered user to approve.' });
      return;
    }
    if (isSelfPromotion) {
      setErrors({
        candidate: 'Administrators cannot approve or elevate their own account.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      if (approvalMode === 'status_only') {
        const res = await mt5AdminService.approveUserStatus({
          targetUserId: selectedCandidateId,
          isCloudMode,
        });
        if (!res.success || !res.profile) {
          throw new Error(res.error || 'Failed to approve user status.');
        }
        await refreshCloudData();
        setSuccessMessage(
          `Approved ${res.profile.full_name || chosenCandidate?.fullName || 'User'} as active (${res.profile.role || chosenCandidate?.role}).`
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('tradesync:user-approved', { detail: res.profile }));
        }
        if (onSuccess) onSuccess(res.profile);
        setTimeout(() => onClose(), 1000);
      } else {
        const res = await mt5AdminService.promoteUserToMentor({
          targetUserId: selectedCandidateId,
          isCloudMode,
          strategyName: strategyName.trim() || undefined,
          monthlyFee,
        });
        if (!res.success && isCloudMode) {
          throw new Error(res.error || 'Failed to elevate user to Mentor.');
        }
        if (res.warning) setWarningMessage(res.warning);
        await refreshCloudData();
        setSuccessMessage(
          `Elevated ${res.profile?.full_name || chosenCandidate?.fullName || 'User'} to active Mentor.`
        );
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('tradesync:mentor-promoted', {
              detail: res.profile || { id: selectedCandidateId },
            })
          );
        }
        if (onSuccess) onSuccess(res.profile);
        setTimeout(() => onClose(), 1000);
      }
    } catch (err: any) {
      setErrors({ form: err.message || 'Approval operation failed.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="provision-mentor-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-5 my-8 text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 id="provision-mentor-title" className="text-sm font-bold text-white flex items-center gap-2">
                <span>Add or Approve Mentor</span>
                {isCloudMode && (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 text-[10px] text-emerald-400 font-mono">
                    <Database className="h-2.5 w-2.5" /> Supabase
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-slate-400">
                Create a new mentor login or elevate a registered user without disrupting your admin session.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex rounded-xl border border-slate-800 bg-slate-950/60 p-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab('create');
              setErrors({});
              setCreatedCredentials(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'create'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Create New Mentor</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('approve');
              setErrors({});
              setCreatedCredentials(null);
            }}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'approve'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserCheck className="h-3.5 w-3.5" />
            <span>Approve Existing User</span>
          </button>
        </div>

        {errors.form && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
            <span>{errors.form}</span>
          </div>
        )}

        {successMessage && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-300 space-y-2">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              <span>{successMessage}</span>
            </div>
            {createdCredentials && (
              <div className="rounded-lg border border-emerald-800/60 bg-slate-950 p-2.5 font-mono text-[11px] text-slate-200 flex items-center justify-between gap-2">
                <div className="truncate">
                  <div>Email: {createdCredentials.email}</div>
                  {createdCredentials.password && <div>Password: {createdCredentials.password}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const txt = createdCredentials.password
                      ? `Mentor Login — Email: ${createdCredentials.email} | Password: ${createdCredentials.password}`
                      : `Mentor Email: ${createdCredentials.email}`;
                    navigator.clipboard.writeText(txt);
                    setCopiedCreds(true);
                    setTimeout(() => setCopiedCreds(false), 2000);
                  }}
                  className="inline-flex items-center gap-1 rounded bg-slate-800 hover:bg-slate-700 px-2 py-1 text-[10px] text-slate-200 shrink-0"
                >
                  {copiedCreds ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  <span>{copiedCreds ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {warningMessage && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
            <span>{warningMessage}</span>
          </div>
        )}

        {activeTab === 'create' ? (
          createdCredentials ? (
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setCreatedCredentials(null);
                  setSuccessMessage('');
                  setFullName('');
                  setEmail('');
                  setPassword('');
                  setStrategyName('');
                  setDescription('');
                }}
                className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2 text-xs font-medium text-slate-200"
              >
                Add Another Mentor
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-semibold text-white"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreateMentorSubmit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Full Name *</label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Marcus Vance"
                      value={fullName}
                      onChange={(e) => handleFullNameChange(e.target.value)}
                      className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-2 text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  {errors.fullName && <p className="mt-1 text-[11px] text-rose-400">{errors.fullName}</p>}
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Email Address *</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="email"
                      required
                      placeholder="mentor@firm.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-2 text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  {errors.email && <p className="mt-1 text-[11px] text-rose-400">{errors.email}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {isCloudMode ? (
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Initial Password *</label>
                    <input
                      type="password"
                      required
                      placeholder="Min 6 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                    />
                    {errors.password && <p className="mt-1 text-[11px] text-rose-400">{errors.password}</p>}
                  </div>
                ) : (
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Username</label>
                    <input
                      type="text"
                      placeholder="marcus_vance"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Account Status</label>
                  <select
                    value={accountStatus}
                    onChange={(e) => setAccountStatus(e.target.value as AccountStatus)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="active">Active (Immediate Access)</option>
                    <option value="pending">Pending Approval</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Strategy Name</label>
                  <input
                    type="text"
                    placeholder="e.g. XAUUSD London Breakout"
                    value={strategyName}
                    onChange={(e) => setStrategyName(e.target.value)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Follower Capacity</label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={maxFollowers}
                    onChange={(e) => setMaxFollowers(parseInt(e.target.value, 10) || 25)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-slate-300 font-medium mb-1">Subscription Plan</label>
                  <select
                    value={selectedPlanId}
                    onChange={(e) => setSelectedPlanId(e.target.value)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="">No Initial Plan</option>
                    {subscriptionPlans
                      .filter((p) => !p.isArchived)
                      .map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} (${plan.price}/{plan.billingCycle === 'yearly' ? 'yr' : 'mo'})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Billing</label>
                  <select
                    value={billingCycle}
                    onChange={(e) => setBillingCycle(e.target.value as 'monthly' | 'yearly')}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Annual</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Strategy Bio / Description (Optional)</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional Gold / FX strategy notes shown to students"
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-50"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>{isSubmitting ? 'Creating Mentor...' : 'Create Mentor Account'}</span>
                </button>
              </div>
            </form>
          )
        ) : (
          <form onSubmit={handleApproveSubmit} className="space-y-4 text-xs">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-slate-200 font-semibold flex items-center gap-1.5">
                  <UserIcon className="h-3.5 w-3.5 text-sky-400" />
                  Select Registered User
                </label>
                <button
                  type="button"
                  onClick={() => void loadCandidates()}
                  disabled={isLoadingCandidates}
                  className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1"
                >
                  <RefreshCw className={`h-3 w-3 ${isLoadingCandidates ? 'animate-spin' : ''}`} />
                  Refresh List
                </button>
              </div>

              {candidates.length > 0 ? (
                <select
                  value={selectedCandidateId}
                  onChange={(e) => setSelectedCandidateId(e.target.value)}
                  className="w-full rounded-xl border border-slate-750 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-sky-500 focus:outline-none"
                >
                  {candidates.map((cand) => (
                    <option key={cand.id} value={cand.id}>
                      {cand.fullName} — {cand.email} (Role: {cand.role}, Status: {cand.status})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-center text-slate-400">
                  {isLoadingCandidates ? 'Loading registered users...' : 'No unregistered candidate profiles found.'}
                </div>
              )}

              {errors.candidate && <p className="mt-1 text-[11px] text-rose-400">{errors.candidate}</p>}
            </div>

            {isSelfPromotion && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                <span>You cannot approve or modify your own administrator account here.</span>
              </div>
            )}

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5 text-[11px]">
                <Shield className="h-3.5 w-3.5 text-sky-400" />
                Approval Action
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setApprovalMode('mentor')}
                  className={`text-left rounded-lg p-2.5 border text-xs ${
                    approvalMode === 'mentor'
                      ? 'border-amber-500 bg-amber-950/40 text-white'
                      : 'border-slate-800 bg-slate-900/40 text-slate-400'
                  }`}
                >
                  <div className="font-semibold text-slate-200">Approve &amp; Elevate to Mentor</div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Sets role to mentor and status to active.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setApprovalMode('status_only')}
                  className={`text-left rounded-lg p-2.5 border text-xs ${
                    approvalMode === 'status_only'
                      ? 'border-sky-500 bg-sky-950/40 text-white'
                      : 'border-slate-800 bg-slate-900/40 text-slate-400'
                  }`}
                >
                  <div className="font-semibold text-slate-200">Approve Existing Role Only</div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Activates account while keeping current role ({chosenCandidate?.role || 'trader'}).
                  </p>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isSelfPromotion || !selectedCandidateId}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <UserCheck className="h-4 w-4" />
                <span>{isSubmitting ? 'Processing...' : 'Confirm Approval'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
