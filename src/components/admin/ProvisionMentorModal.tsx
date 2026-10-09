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
  Layers
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { AccountStatus, User } from '../../types';

interface ProvisionMentorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (createdUser: User) => void;
}

export const ProvisionMentorModal: React.FC<ProvisionMentorModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const { subscriptionPlans, createMentor } = useApp();

  // Form Fields required by prompt
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('active');

  // Optional strategy fields for complete profile
  const [strategyName, setStrategyName] = useState('');
  const [monthlyFee, setMonthlyFee] = useState<number>(149);

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
      setSelectedPlanId(subscriptionPlans[0]?.id || 'plan_starter');
      setAccountStatus('active');
      setStrategyName('');
      setMonthlyFee(149);
      setErrors({});
      setIsSubmitting(false);
      setShowSuccessToast(false);
    }
  }, [isOpen, subscriptionPlans]);

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

  // Auto-fill username recommendation when full name changes if username is empty or unmodified
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

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!fullName.trim()) {
      newErrors.fullName = 'Full Name is required.';
    } else if (fullName.trim().length < 2) {
      newErrors.fullName = 'Full Name must be at least 2 characters.';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim()) {
      newErrors.email = 'Email address is required.';
    } else if (!emailRegex.test(email.trim())) {
      newErrors.email = 'Please provide a valid email address.';
    }

    const cleanUsername = username.trim().replace(/^@/, '');
    if (!cleanUsername) {
      newErrors.username = 'Username is required.';
    } else if (cleanUsername.length < 3) {
      newErrors.username = 'Username must be at least 3 characters.';
    } else if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
      newErrors.username = 'Username can only contain alphanumeric characters and underscores.';
    }

    if (!selectedPlanId) {
      newErrors.plan = 'Please select a subscription plan.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const cleanUsername = username.trim().replace(/^@/, '');
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

      // Brief delay to give visual confirmation before closing
      setTimeout(() => {
        setIsSubmitting(false);
        if (onSuccess) {
          onSuccess(created);
        }
        onClose();
      }, 350);
    } catch (err) {
      console.error('Failed to provision mentor:', err);
      setErrors({ form: 'An unexpected error occurred while provisioning mentor. Please try again.' });
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setErrors({});
    setIsSubmitting(false);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="provision-mentor-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150"
    >
      <div
        className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-5 my-8 text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <UserPlus className="h-4 w-4" />
            </div>
            <div>
              <h2 id="provision-mentor-title" className="text-sm font-semibold text-slate-100">
                Provision Mentor
              </h2>
              <p className="text-[11px] text-slate-400">
                Create and configure a new master trader profile and MT5 parent terminal
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Error Alert if any */}
        {errors.form && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{errors.form}</span>
          </div>
        )}

        {/* Success Notice if submitted */}
        {showSuccessToast && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>Mentor account created successfully! Updating directory...</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Field 1: Full Name */}
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
                  errors.fullName
                    ? 'border-rose-500 focus:border-rose-400'
                    : 'border-slate-750 focus:border-sky-500'
                }`}
              />
            </div>
            {errors.fullName && (
              <p className="mt-1 text-[11px] text-rose-400 flex items-center gap-1">
                <AlertCircle className="h-3 w-3 inline" /> {errors.fullName}
              </p>
            )}
          </div>

          {/* Field 2 & 3: Email and Username */}
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
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email) {
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.email;
                        return next;
                      });
                    }
                  }}
                  className={`w-full rounded-lg border bg-slate-950 pl-9 pr-3 py-2 text-slate-200 placeholder-slate-500 transition-colors focus:outline-none ${
                    errors.email
                      ? 'border-rose-500 focus:border-rose-400'
                      : 'border-slate-750 focus:border-sky-500'
                  }`}
                />
              </div>
              {errors.email && (
                <p className="mt-1 text-[11px] text-rose-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 inline" /> {errors.email}
                </p>
              )}
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Username <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <AtSign className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  required
                  placeholder="liam_sterling"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (errors.username) {
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.username;
                        return next;
                      });
                    }
                  }}
                  className={`w-full rounded-lg border bg-slate-950 pl-9 pr-3 py-2 text-slate-200 placeholder-slate-500 font-mono text-xs transition-colors focus:outline-none ${
                    errors.username
                      ? 'border-rose-500 focus:border-rose-400'
                      : 'border-slate-750 focus:border-sky-500'
                  }`}
                />
              </div>
              {errors.username && (
                <p className="mt-1 text-[11px] text-rose-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 inline" /> {errors.username}
                </p>
              )}
            </div>
          </div>

          {/* Field 4 & 5: Subscription Plan and Account Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Subscription Plan <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <CreditCard className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-2 text-slate-200 focus:border-sky-500 focus:outline-none transition-colors"
                >
                  {subscriptionPlans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} (${plan.price}/{plan.billingCycle})
                    </option>
                  ))}
                </select>
              </div>
              {errors.plan && (
                <p className="mt-1 text-[11px] text-rose-400">{errors.plan}</p>
              )}
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Account Status <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <Shield className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
                <select
                  value={accountStatus}
                  onChange={(e) => setAccountStatus(e.target.value as AccountStatus)}
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-2 text-slate-200 focus:border-sky-500 focus:outline-none transition-colors"
                >
                  <option value="active">Active (Full Access)</option>
                  <option value="suspended">Suspended (Trading Halted)</option>
                  <option value="pending">Pending (Review Mode)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Strategy Details (collapsible or streamlined) */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-3">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-sky-400" />
                Trading Strategy Profile (Auto-Configured)
              </span>
              <span className="text-slate-500">Optional Customization</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Strategy Name</label>
                <input
                  type="text"
                  placeholder={fullName ? `${fullName}'s Alpha Flow` : 'e.g. Gold Institutional Flow'}
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                  className="w-full rounded-md border border-slate-750 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Monthly Trader Fee ($)</label>
                <div className="relative">
                  <DollarSign className="absolute left-2.5 top-2 h-3 w-3 text-slate-500" />
                  <input
                    type="number"
                    min="0"
                    placeholder="149"
                    value={monthlyFee}
                    onChange={(e) => setMonthlyFee(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-md border border-slate-750 bg-slate-900 pl-7 pr-2.5 py-1.5 text-xs text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSubmitting}
              className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-50"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>{isSubmitting ? 'Creating Mentor...' : 'Create Mentor'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
