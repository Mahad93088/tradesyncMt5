import React, { useState, useEffect } from 'react';
import {
  X,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Shield,
  CreditCard,
  AtSign,
  Mail,
  User as UserIcon,
  Phone,
  Link
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { AccountStatus, User } from '../../types';

interface EditTraderModalProps {
  isOpen: boolean;
  onClose: () => void;
  trader: User | null;
  onSuccess?: () => void;
}

export const EditTraderModal: React.FC<EditTraderModalProps> = ({
  isOpen,
  onClose,
  trader,
  onSuccess
}) => {
  const { users, parentChildLinks, editTrader } = useApp();

  const mentors = users.filter((u) => u.role === 'mentor');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [assignedMentorId, setAssignedMentorId] = useState<string>('');
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('active');
  const [phone, setPhone] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  useEffect(() => {
    if (isOpen && trader) {
      const link = parentChildLinks.find((l) => l.traderId === trader.id);
      setFullName(trader.fullName);
      setEmail(trader.email);
      setUsername(trader.username || trader.fullName.toLowerCase().replace(/[^a-z0-9]/g, '_'));
      setAssignedMentorId(link ? link.mentorId : '');
      setAccountStatus(trader.status);
      setPhone(trader.phone || '');
      setErrors({});
      setIsSubmitting(false);
      setShowSuccessToast(false);
    }
  }, [isOpen, trader, parentChildLinks]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen || !trader) return null;

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
      newErrors.email = 'Please provide a valid email address.';
    }

    if (!username.trim()) {
      newErrors.username = 'Username is required.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    setIsSubmitting(true);

    try {
      editTrader(trader.id, {
        fullName: fullName.trim(),
        email: email.trim(),
        username: username.trim().replace(/^@/, ''),
        phone: phone.trim() || undefined,
        mentorId: assignedMentorId,
        status: accountStatus
      });

      setShowSuccessToast(true);

      setTimeout(() => {
        setIsSubmitting(false);
        onClose();
        if (onSuccess) onSuccess();
      }, 500);
    } catch (err: any) {
      console.error('Failed to update trader account:', err);
      setErrors({ form: err.message || 'Failed to update trader account.' });
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden my-8">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <Edit2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Edit Trader Account
              </h2>
              <p className="text-xs text-slate-400">
                Update account profile, assigned mentor, and status.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

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
              <span>Trader account updated successfully!</span>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <UserIcon className="h-3.5 w-3.5 text-slate-400" />
                Full Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
              />
              {errors.fullName && (
                <p className="mt-1 text-[11px] text-rose-400">{errors.fullName}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  Email Address <span className="text-rose-400">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
                />
                {errors.email && (
                  <p className="mt-1 text-[11px] text-rose-400">{errors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <AtSign className="h-3.5 w-3.5 text-slate-400" />
                  Username
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-2 text-xs text-slate-500">@</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-7 pr-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Link className="h-3.5 w-3.5 text-slate-400" />
                  Assigned Mentor
                </label>
                <select
                  value={assignedMentorId}
                  onChange={(e) => setAssignedMentorId(e.target.value)}
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
                >
                  <option value="">Unassigned (None)</option>
                  {mentors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName} (@{m.username || 'mentor'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-slate-400" />
                  Account Status
                </label>
                <select
                  value={accountStatus}
                  onChange={(e) => setAccountStatus(e.target.value as AccountStatus)}
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-slate-400" />
                Phone Number
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="w-full rounded-lg border border-slate-750 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-750 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
