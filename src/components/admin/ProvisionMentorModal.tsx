import React, { useState, useEffect } from 'react';
import {
  X,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  Shield,
  CreditCard,
  AtSign,
  Mail,
  User as UserIcon,
  Activity,
  DollarSign,
  Layers,
  UserCheck,
  Database,
  Lock,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { mt5AdminService } from '../../services/mt5AdminService';
import { supabase } from '../../lib/supabase';
import { AccountStatus, User } from '../../types';

interface ProvisionMentorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (createdUser?: any) => void;
}

export const ProvisionMentorModal: React.FC<ProvisionMentorModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const { isCloudMode, user: currentAuthUser } = useAuth();
  const { subscriptionPlans, createMentor, users } = useApp();

  // Mode: 'approve' (approve existing registered user) vs 'provision' (create new user)
  const [activeTab, setActiveTab] = useState<'approve' | 'provision'>('approve');

  // Candidate Users for Super Admin approval
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

  // Quick Register & Approve fields (when database has no users)
  const [showQuickRegister, setShowQuickRegister] = useState<boolean>(false);
  const [regFullName, setRegFullName] = useState<string>('');
  const [regEmail, setRegEmail] = useState<string>('');
  const [regPassword, setRegPassword] = useState<string>('');

  // Sandbox Provision Form Fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('active');

  // Strategy fields
  const [strategyName, setStrategyName] = useState('');
  const [monthlyFee, setMonthlyFee] = useState<number>(149);

  // Validation & Submission States
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>('');

  // Load candidate users from Supabase or local state
  const loadCandidates = async () => {
    setIsLoadingCandidates(true);
    setErrors({});
    try {
      const list = await mt5AdminService.getCandidateUsersForMentor(isCloudMode, users);
      setCandidates(list);

      // Default selection to first eligible candidate who is not the current admin
      const eligible = list.find((c) => c.id !== currentAuthUser?.id) || list[0];
      if (eligible) {
        setSelectedCandidateId(eligible.id);
      } else {
        setSelectedCandidateId('');
      }
    } catch (err: any) {
      console.warn('Failed to load candidate users:', err);
    } finally {
      setIsLoadingCandidates(false);
    }
  };

  // Initialize or reset defaults when modal opens
  useEffect(() => {
    if (!isOpen) return;

    setActiveTab(isCloudMode ? 'approve' : 'provision');
    setFullName('');
    setEmail('');
    setUsername('');
    setSelectedPlanId(subscriptionPlans[0]?.id || 'plan_starter');
    setAccountStatus('active');
    setStrategyName('');
    setMonthlyFee(149);
    setRegFullName('');
    setRegEmail('');
    setRegPassword('');
    setShowQuickRegister(false);
    setErrors({});
    setIsSubmitting(false);
    setShowSuccessToast(false);
    setSuccessMessage('');

    loadCandidates();
  }, [isOpen, isCloudMode, subscriptionPlans, currentAuthUser?.id]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Candidate currently selected
  const chosenCandidate = candidates.find((c) => c.id === selectedCandidateId);
  const isSelfPromotion = Boolean(
    chosenCandidate && currentAuthUser?.id && chosenCandidate.id === currentAuthUser.id
  );

  // Auto-fill username recommendation
  const handleFullNameChange = (val: string) => {
    setFullName(val);
    if (!username || username === fullName.toLowerCase().replace(/[^a-z0-9]/g, '_')) {
      const suggested = val.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      setUsername(suggested);
    }
    if (errors.fullName) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.fullName;
        return next;
      });
    }
  };

  // Approval action mode: 'status_only' (updates ONLY status = 'active', preserving role per Requirement 8) or 'mentor'
  const [approvalMode, setApprovalMode] = useState<'status_only' | 'mentor'>('status_only');

  // Handler for Approving Registered User (Requirement 8)
  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!selectedCandidateId) {
      setErrors({ candidate: 'Please select a registered user to approve.' });
      return;
    }

    // Anti-self-promotion protection (Requirement 6)
    if (isSelfPromotion) {
      setErrors({
        candidate: 'Security protection violation: Administrators cannot approve or promote their own account.',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      if (approvalMode === 'status_only') {
        // REQUIREMENT 8: Approval updates ONLY status to 'active' without altering role or granting admin
        const res = await mt5AdminService.approveUserStatus({
          targetUserId: selectedCandidateId,
          isCloudMode,
        });

        if (res.success && res.profile) {
          const targetName = res.profile.full_name || chosenCandidate?.fullName || 'User';
          const targetEmail = res.profile.email || chosenCandidate?.email || '';
          const currentRole = res.profile.role || chosenCandidate?.role || 'trader';
          const msg = `Successfully approved ${targetName} (${targetEmail})! Account status is now ACTIVE with role "${currentRole}". Database confirmed update.`;
          setSuccessMessage(msg);
          setShowSuccessToast(true);

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('tradesync:user-approved', { detail: res.profile }));
          }

          setTimeout(() => {
            setIsSubmitting(false);
            if (onSuccess) {
              onSuccess(res.profile);
            }
            onClose();
          }, 1200);
        } else {
          setErrors({ form: res.error || 'Failed to approve user status.' });
          setIsSubmitting(false);
        }
      } else {
        // Promote to mentor workflow
        const res = await mt5AdminService.promoteUserToMentor({
          targetUserId: selectedCandidateId,
          isCloudMode,
        });

        if (res.success && res.profile) {
          const targetName = res.profile.full_name || chosenCandidate?.fullName || 'User';
          const targetEmail = res.profile.email || chosenCandidate?.email || '';
          const msg = `Successfully approved ${targetName} (${targetEmail}) as active Mentor in public.profiles! Database confirmed update.`;
          setSuccessMessage(msg);
          setShowSuccessToast(true);

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('tradesync:mentor-promoted', { detail: res.profile }));
          }

          setTimeout(() => {
            setIsSubmitting(false);
            if (onSuccess) {
              onSuccess(res.profile);
            }
            onClose();
          }, 1200);
        } else {
          setErrors({ form: res.error || 'Failed to promote user as mentor.' });
          setIsSubmitting(false);
        }
      }
    } catch (err: any) {
      setErrors({ form: err.message || 'Error occurred during user approval.' });
      setIsSubmitting(false);
    }
  };

  // Handler for Quick Register & Approve
  const handleQuickRegisterAndApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!regFullName.trim()) {
      setErrors({ regFullName: 'Full Name is required.' });
      return;
    }
    if (!regEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail.trim())) {
      setErrors({ regEmail: 'A valid email address is required.' });
      return;
    }
    if (!regPassword || regPassword.length < 6) {
      setErrors({ regPassword: 'Password must be at least 6 characters.' });
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Sign up new user in Supabase Auth (trigger creates row in public.profiles with role = 'trader')
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: regEmail.trim(),
        password: regPassword,
        options: {
          data: {
            full_name: regFullName.trim(),
          },
        },
      });

      if (signUpErr) {
        throw signUpErr;
      }

      if (!signUpData.user?.id) {
        throw new Error('User creation did not return a valid user identity.');
      }

      const newUserId = signUpData.user.id;

      // 2. Promote the new user profile to 'mentor' via backend endpoint
      const promoteRes = await mt5AdminService.promoteUserToMentor({
        targetUserId: newUserId,
        isCloudMode,
      });

      if (!promoteRes.success) {
        throw new Error(promoteRes.error || 'User registered, but failed to approve as mentor.');
      }

      setSuccessMessage(
        `Successfully registered and approved ${regFullName.trim()} (${regEmail.trim()}) as verified Mentor!`
      );
      setShowSuccessToast(true);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tradesync:mentor-promoted', { detail: promoteRes.profile }));
      }

      setTimeout(() => {
        setIsSubmitting(false);
        if (onSuccess) {
          onSuccess(promoteRes.profile);
        }
        onClose();
      }, 1200);
    } catch (err: any) {
      setErrors({ form: err.message || 'Failed to register and approve new mentor.' });
      setIsSubmitting(false);
    }
  };

  // Handler for Sandbox Demo Creation
  const handleProvisionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!fullName.trim()) {
      setErrors({ fullName: 'Full Name is required.' });
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrors({ email: 'A valid email address is required.' });
      return;
    }

    setIsSubmitting(true);

    try {
      const cleanUsername = username.trim().replace(/^@/, '') || email.split('@')[0];
      const finalStrategy = strategyName.trim() || `${fullName.trim()}'s Alpha Flow`;

      const created = createMentor(
        {
          fullName: fullName.trim(),
          email: email.trim(),
          username: cleanUsername,
          status: accountStatus
        },
        {
          strategyName: finalStrategy,
          description: `MetaTrader 5 institutional copy-trading strategy managed by ${fullName.trim()}.`,
          monthlyFee: monthlyFee || 0
        },
        selectedPlanId
      );

      setShowSuccessToast(true);
      setSuccessMessage(`Demo Mentor account created successfully for ${fullName.trim()}!`);

      setTimeout(() => {
        setIsSubmitting(false);
        if (onSuccess) {
          onSuccess(created);
        }
        onClose();
      }, 400);
    } catch (err) {
      setErrors({ form: 'An unexpected error occurred while creating mentor.' });
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setErrors({});
    setIsSubmitting(false);
    onClose();
  };

  // Early return situated immediately before JSX rendering (Rules of Hooks compliant)
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="provision-mentor-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-5 my-8 text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 id="provision-mentor-title" className="text-sm font-bold text-white flex items-center gap-2">
                <span>Authorize & Approve Mentor</span>
                {isCloudMode && (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 text-[10px] text-emerald-400 font-mono">
                    <Database className="h-2.5 w-2.5" /> Supabase
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-slate-400">
                Grant active Mentor privileges to enable Parent MT5 copy-trading terminal streams
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Workflow Tabs */}
        <div className="flex rounded-xl border border-slate-800 bg-slate-950/60 p-1">
          <button
            type="button"
            onClick={() => { setActiveTab('approve'); setErrors({}); }}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'approve'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserCheck className="h-3.5 w-3.5" />
            <span>Approve Registered User {isCloudMode && '(Supabase)'}</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('provision'); setErrors({}); }}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'provision'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Provision Demo User</span>
          </button>
        </div>

        {/* Error Alert */}
        {errors.form && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
            <span>{errors.form}</span>
          </div>
        )}

        {/* Success Notice */}
        {showSuccessToast && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-300 flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* TAB 1: APPROVE REGISTERED USER (PRIMARY CLOUD WORKFLOW) */}
        {activeTab === 'approve' && (
          <div className="space-y-4">
            {!showQuickRegister ? (
              <form onSubmit={handleApproveSubmit} className="space-y-4 text-xs">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-slate-200 font-semibold flex items-center gap-1.5">
                      <UserIcon className="h-3.5 w-3.5 text-sky-400" />
                      Select Registered User to Elevate:
                    </label>
                    <button
                      type="button"
                      onClick={loadCandidates}
                      disabled={isLoadingCandidates}
                      className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1"
                    >
                      <RefreshCw className={`h-3 w-3 ${isLoadingCandidates ? 'animate-spin' : ''}`} />
                      Refresh List
                    </button>
                  </div>

                  {candidates.length > 0 ? (
                    <div className="space-y-2">
                      <select
                        value={selectedCandidateId}
                        onChange={(e) => setSelectedCandidateId(e.target.value)}
                        className="w-full rounded-xl border border-slate-750 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-sky-500 focus:outline-none transition-colors"
                      >
                        {candidates.map((cand) => (
                          <option key={cand.id} value={cand.id}>
                            {cand.fullName} — {cand.email} (Role: {cand.role})
                          </option>
                        ))}
                      </select>

                      {/* Preview Card of Selected Candidate */}
                      {chosenCandidate && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-white">{chosenCandidate.fullName}</span>
                            <span className="rounded bg-sky-950 border border-sky-800 px-2 py-0.5 text-[10px] text-sky-300 font-mono">
                              Current: {chosenCandidate.role}
                            </span>
                          </div>
                          <div className="font-mono text-[11px] text-slate-400 space-y-0.5">
                            <div>Email: <span className="text-slate-200">{chosenCandidate.email}</span></div>
                            <div className="break-all">Profile UUID: <span className="text-cyan-400">{chosenCandidate.id}</span></div>
                          </div>

                          {/* Anti-Self-Promotion Protection Notice */}
                          {isSelfPromotion && (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-300 flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                              <span>
                                Anti-self-promotion protection: As Super Admin ({currentAuthUser?.email}), you cannot promote your own account to Mentor.
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-center space-y-3">
                      <p className="text-slate-400 text-xs">
                        {isLoadingCandidates
                          ? 'Loading registered profiles from Supabase...'
                          : 'No unregistered candidate profiles found in public.profiles.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowQuickRegister(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        <span>Register & Approve New User</span>
                      </button>
                    </div>
                  )}

                  {errors.candidate && (
                    <p className="mt-1 text-[11px] text-rose-400">{errors.candidate}</p>
                  )}
                </div>

                {/* Approval Mode Selector (Requirement 8) */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5 text-[11px]">
                    <Shield className="h-3.5 w-3.5 text-sky-400" />
                    Approval Type & Permission Policy (Requirement 8)
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setApprovalMode('status_only')}
                      className={`text-left rounded-lg p-2.5 border transition-all text-xs ${
                        approvalMode === 'status_only'
                          ? 'border-sky-500 bg-sky-950/40 text-white shadow-sm'
                          : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                        <CheckCircle2 className={`h-3.5 w-3.5 ${approvalMode === 'status_only' ? 'text-sky-400' : 'text-slate-500'}`} />
                        Approve Status Only (Active)
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                        Sets status to <strong className="text-emerald-400">active</strong>. Preserves existing role ({chosenCandidate?.role || 'trader'}). Never grants admin.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setApprovalMode('mentor')}
                      className={`text-left rounded-lg p-2.5 border transition-all text-xs ${
                        approvalMode === 'mentor'
                          ? 'border-amber-500 bg-amber-950/40 text-white shadow-sm'
                          : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                        <UserCheck className={`h-3.5 w-3.5 ${approvalMode === 'mentor' ? 'text-amber-400' : 'text-slate-500'}`} />
                        Approve & Elevate to Mentor
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                        Sets status to <strong className="text-emerald-400">active</strong> and elevates role to <strong className="text-amber-400">mentor</strong>.
                      </p>
                    </button>
                  </div>
                </div>

                {/* Strategy Defaults (Shown when elevating to Mentor) */}
                {approvalMode === 'mentor' && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-3">
                    <span className="font-semibold text-slate-300 flex items-center gap-1.5 text-[11px]">
                      <Activity className="h-3.5 w-3.5 text-sky-400" />
                      Strategy Profile & Subscription Settings
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-400 text-[11px] mb-1">Strategy Name</label>
                        <input
                          type="text"
                          placeholder={chosenCandidate ? `${chosenCandidate.fullName}'s Alpha Copy` : 'e.g. Institutional FX'}
                          value={strategyName}
                          onChange={(e) => setStrategyName(e.target.value)}
                          className="w-full rounded-lg border border-slate-750 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-sky-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 text-[11px] mb-1">Monthly Fee ($)</label>
                        <input
                          type="number"
                          min="0"
                          value={monthlyFee}
                          onChange={(e) => setMonthlyFee(parseFloat(e.target.value) || 0)}
                          className="w-full rounded-lg border border-slate-750 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Quick Register Switcher if users exist but admin wants to add a new one */}
                {candidates.length > 0 && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => setShowQuickRegister(true)}
                      className="text-[11px] text-slate-400 hover:text-sky-400 transition-colors"
                    >
                      Need to add an unlisted candidate? Register directly &rarr;
                    </button>
                  </div>
                )}

                {/* Submit Action */}
                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={isSubmitting}
                    className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || isSelfPromotion || !selectedCandidateId}
                    className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-50 ${
                      approvalMode === 'status_only' ? 'bg-sky-600 hover:bg-sky-500' : 'bg-amber-600 hover:bg-amber-500'
                    }`}
                  >
                    <UserCheck className="h-4 w-4" />
                    <span>
                      {isSubmitting
                        ? (approvalMode === 'status_only' ? 'Approving User...' : 'Elevating Mentor...')
                        : (approvalMode === 'status_only' ? 'Approve Registered User (Activate)' : 'Approve User as Mentor')}
                    </span>
                  </button>
                </div>
              </form>
            ) : (
              /* INLINE REGISTRATION & APPROVAL FORM */
              <form onSubmit={handleQuickRegisterAndApprove} className="space-y-4 text-xs">
                <div className="flex items-center justify-between pb-1">
                  <span className="font-semibold text-white text-xs flex items-center gap-1.5">
                    <UserPlus className="h-3.5 w-3.5 text-emerald-400" />
                    Register New User in Supabase & Approve as Mentor
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowQuickRegister(false)}
                    className="text-[11px] text-sky-400 hover:text-sky-300"
                  >
                    &larr; Back to Existing Users
                  </button>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Marcus Vance"
                    value={regFullName}
                    onChange={(e) => setRegFullName(e.target.value)}
                    className="w-full rounded-xl border border-slate-750 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                  />
                  {errors.regFullName && <p className="mt-1 text-[11px] text-rose-400">{errors.regFullName}</p>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Email Address *</label>
                    <input
                      type="email"
                      required
                      placeholder="mentor@firm.com"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-750 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                    />
                    {errors.regEmail && <p className="mt-1 text-[11px] text-rose-400">{errors.regEmail}</p>}
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Temporary Password *</label>
                    <input
                      type="password"
                      required
                      placeholder="Min 6 characters"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-750 bg-slate-950 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                    />
                    {errors.regPassword && <p className="mt-1 text-[11px] text-rose-400">{errors.regPassword}</p>}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowQuickRegister(false)}
                    className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{isSubmitting ? 'Registering...' : 'Register & Approve as Mentor'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* TAB 2: PROVISION DEMO USER (LOCAL SANDBOX FALLBACK) */}
        {activeTab === 'provision' && (
          <form onSubmit={handleProvisionSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Full Name <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Liam Sterling"
                  value={fullName}
                  onChange={(e) => handleFullNameChange(e.target.value)}
                  className={`w-full rounded-lg border bg-slate-950 pl-9 pr-3 py-2 text-slate-200 placeholder-slate-500 transition-colors focus:outline-none ${
                    errors.fullName ? 'border-rose-500 focus:border-rose-400' : 'border-slate-750 focus:border-sky-500'
                  }`}
                />
              </div>
              {errors.fullName && <p className="mt-1 text-[11px] text-rose-400">{errors.fullName}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Email Address <span className="text-rose-400">*</span>
                </label>
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
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Username</label>
                <div className="relative">
                  <AtSign className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="liam_sterling"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-2 text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Subscription Plan</label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
                  <select
                    value={selectedPlanId}
                    onChange={(e) => setSelectedPlanId(e.target.value)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    {subscriptionPlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} (${plan.price}/{plan.billingCycle})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Status</label>
                <div className="relative">
                  <Shield className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
                  <select
                    value={accountStatus}
                    onChange={(e) => setAccountStatus(e.target.value as AccountStatus)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={handleCancel}
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
                <span>{isSubmitting ? 'Creating...' : 'Create Demo Mentor'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
