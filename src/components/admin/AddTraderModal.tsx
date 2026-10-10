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
  Phone,
  Link,
  Layers
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { AccountStatus, User } from '../../types';

interface AddTraderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (createdUser: User) => void;
}

export const AddTraderModal: React.FC<AddTraderModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const { users, subscriptionPlans, createTrader } = useApp();

  // Active mentors list
  const mentors = users.filter((u) => u.role === 'mentor');

  // Form Fields required by prompt:
  // Full Name, Email, Username, Assigned Mentor, Subscription Plan, Account Status
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [assignedMentorId, setAssignedMentorId] = useState<string>('');
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('active');
  const [phone, setPhone] = useState('');

  // Validation & Submission States
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  // Initialize or reset defaults when modal opens
  useEffect(() => {
    if (isOpen) {
      setFullName('');
      setEmail('');
      setUsername('');
      setAssignedMentorId(mentors[0]?.id || '');
      setSelectedPlanId(subscriptionPlans[0]?.id || 'plan_starter');
      setAccountStatus('active');
      setPhone('+1 (555) 349-2180');
      setErrors({});
      setIsSubmitting(false);
      setShowSuccessToast(false);
    }
  }, [isOpen]);

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

  if (!isOpen) return null;

  // Auto-suggest username when fullName changes
  const handleFullNameChange = (val: string) => {
    setFullName(val);
    if (!username || username === fullName.toLowerCase().replace(/[^a-z0-9]/g, '_')) {
      const generated = val.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
      setUsername(generated);
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!fullName.trim()) {
      newErrors.fullName = 'Full Name is required.';
    } else if (fullName.trim().length < 2) {
      newErrors.fullName = 'Full Name must be at least 2 characters.';
    }

    if (!email.trim()) {
      newErrors.email = 'Email address is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors.email = 'Please provide a valid email format (e.g., trader@domain.com).';
    }

    if (!username.trim()) {
      newErrors.username = 'Username is required.';
    } else if (!/^[a-zA-Z0-9_]{3,24}$/.test(username.trim().replace(/^@/, ''))) {
      newErrors.username = 'Username must be 3-24 alphanumeric characters or underscores.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCancel = () => {
    setErrors({});
    setIsSubmitting(false);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const cleanUsername = username.trim().replace(/^@/, '');

      const createdTrader = createTrader(
        {
          fullName: fullName.trim(),
          email: email.trim(),
          username: cleanUsername,
          phone: phone.trim() || undefined,
          status: accountStatus
        },
        assignedMentorId || undefined,
        selectedPlanId || undefined
      );

      setShowSuccessToast(true);

      setTimeout(() => {
        setIsSubmitting(false);
        onClose();
        if (onSuccess) {
          onSuccess(createdTrader);
        }
      }, 500);
    } catch (err: any) {
      console.error('Failed to create trader account:', err);
      setErrors({ form: err.message || 'Failed to create trader account.' });
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-trader-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-400">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h2 id="add-trader-title" className="text-base font-semibold text-slate-100">
                Add New Follower Trader
              </h2>
              <p className="text-xs text-slate-400">
                Register a trader account, configure demo terminal, and assign a mentor.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Close modal"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Demo Environment Banner */}
        <div className="bg-slate-950/70 border-b border-slate-800/80 px-6 py-2 text-xs text-slate-400 flex items-center justify-between font-mono">
          <span className="flex items-center gap-1.5 text-teal-400">
            <Shield className="h-3.5 w-3.5" />
            Super Admin Authority
          </span>
          <span className="text-[11px] text-slate-500">Auto-Generates Demo Child MT5</span>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errors.form && (
            <div className="rounded-lg border border-rose-900/50 bg-rose-950/40 p-3 text-xs text-rose-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errors.form}</span>
            </div>
          )}

          {showSuccessToast && (
            <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/40 p-3 text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Trader account registered and saved to demo database successfully!</span>
            </div>
          )}

          <div className="space-y-4">
            {/* Full Name */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <UserIcon className="h-3.5 w-3.5 text-slate-400" />
                Full Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Rachel Adams"
                value={fullName}
                onChange={(e) => handleFullNameChange(e.target.value)}
                className={`w-full rounded-lg border bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none transition-colors ${
                  errors.fullName
                    ? 'border-rose-500 focus:border-rose-500 ring-1 ring-rose-500/20'
                    : 'border-slate-750 focus:border-teal-500'
                }`}
              />
              {errors.fullName && (
                <p className="mt-1 text-[11px] text-rose-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {errors.fullName}
                </p>
              )}
            </div>

            {/* Email & Username */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  Email Address <span className="text-rose-400">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="rachel@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`w-full rounded-lg border bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none transition-colors ${
                    errors.email
                      ? 'border-rose-500 focus:border-rose-500 ring-1 ring-rose-500/20'
                      : 'border-slate-750 focus:border-teal-500'
                  }`}
                />
                {errors.email && (
                  <p className="mt-1 text-[11px] text-rose-400 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {errors.email}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <AtSign className="h-3.5 w-3.5 text-slate-400" />
                  Username <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-2 text-xs text-slate-500 select-none">@</span>
                  <input
                    type="text"
                    required
                    placeholder="rachel_trader"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    className={`w-full rounded-lg border bg-slate-950 pl-7 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none transition-colors font-mono ${
                      errors.username
                        ? 'border-rose-500 focus:border-rose-500 ring-1 ring-rose-500/20'
                        : 'border-slate-750 focus:border-teal-500'
                    }`}
                  />
                </div>
                {errors.username && (
                  <p className="mt-1 text-[11px] text-rose-400 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {errors.username}
                  </p>
                )}
              </div>
            </div>

            {/* Assigned Mentor & Subscription Plan */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Link className="h-3.5 w-3.5 text-slate-400" />
                  Assigned Mentor
                </label>
                <select
                  value={assignedMentorId}
                  onChange={(e) => setAssignedMentorId(e.target.value)}
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-teal-500 focus:outline-none"
                >
                  <option value="">Unassigned (Independent Demo)</option>
                  {mentors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName} (@{m.username || 'mentor'})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-slate-500">
                  Links trade copying from mentor's demo parent terminal.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5 text-slate-400" />
                  Subscription Plan
                </label>
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-teal-500 focus:outline-none"
                >
                  {subscriptionPlans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} (${plan.price}/{plan.billingCycle === 'yearly' ? 'yr' : 'mo'})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-slate-500">
                  Demo follower plan assignment.
                </p>
              </div>
            </div>

            {/* Account Status & Phone Number */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-slate-400" />
                  Account Status <span className="text-rose-400">*</span>
                </label>
                <select
                  value={accountStatus}
                  onChange={(e) => setAccountStatus(e.target.value as AccountStatus)}
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-teal-500 focus:outline-none"
                >
                  <option value="active">Active (Mirroring Enabled)</option>
                  <option value="suspended">Suspended (Immediate Pause)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  Phone (Optional)
                </label>
                <input
                  type="text"
                  placeholder="+1 (555) 000-0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-teal-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Simulated Demo Provisioning Details */}
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
                <Layers className="h-3.5 w-3.5 text-teal-400" />
                Automated Demo Child MT5 Provisioning
              </div>
              <p className="text-[11px] text-slate-400">
                Saving this trader will automatically generate a simulated child account with $10,000 demo equity on <code className="text-slate-300 font-mono">MetaQuotes-Demo</code>, immediately reflected in metrics and table views.
              </p>
            </div>
          </div>

          {/* Modal Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSubmitting}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-750 hover:text-white transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <span>Creating Trader...</span>
              ) : (
                <>
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>Create Trader</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
