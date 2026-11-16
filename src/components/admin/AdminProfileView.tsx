import React, { useState } from 'react';
import { User, ShieldCheck, Cloud, Save, CheckCircle2, KeyRound } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  AdminPageHeader,
  AdminStatusText,
  AdminFeedbackBanner,
} from './adminUi';

export const AdminProfileView: React.FC = () => {
  const { currentUser, updateCurrentUserProfile, setIsAuthModalOpen } = useApp();
  const { isCloudMode, isAuthenticated } = useAuth();

  const [fullName, setFullName] = useState(currentUser.fullName);
  const [phone, setPhone] = useState(currentUser.phone || '');
  const [timezone, setTimezone] = useState('UTC+0 (London / GMT)');
  const [savedBanner, setSavedBanner] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateCurrentUserProfile({
      fullName: fullName.trim() || currentUser.fullName,
      phone: phone.trim(),
    });
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 3500);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <AdminPageHeader
        title="Admin Profile"
        meta={isCloudMode ? 'Supabase Authenticated Session' : 'Demo Admin Session'}
        subtitle="Manage your Super Administrator identity, contact details, and session security posture."
      />

      {savedBanner && (
        <AdminFeedbackBanner
          type="success"
          message="Administrator profile details updated."
          onDismiss={() => setSavedBanner(false)}
        />
      )}

      {/* Identity & Security Summary */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3.5">
            <div className="h-12 w-12 rounded-full border border-slate-200 bg-slate-900 text-white flex items-center justify-center font-bold text-base overflow-hidden shrink-0">
              {currentUser.avatarUrl ? (
                <img src={currentUser.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                currentUser.fullName[0]
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900">{currentUser.fullName}</h2>
                <AdminStatusText status={currentUser.status} />
              </div>
              <p className="text-xs font-mono text-slate-500 mt-0.5">{currentUser.email}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsAuthModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0"
          >
            <Cloud className="h-3.5 w-3.5 text-sky-600" />
            <span>{isAuthenticated ? 'Manage Cloud Auth' : 'Connect Cloud Auth'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="text-[11px] text-slate-500 block">Assigned Role</span>
            <span className="font-mono font-bold text-slate-900 uppercase mt-0.5 block">Super Admin</span>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="text-[11px] text-slate-500 block">Authorization Engine</span>
            <span className="font-semibold text-emerald-700 mt-0.5 flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              {isCloudMode ? 'Supabase RLS + JWT' : 'Local Demo Sandbox'}
            </span>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="text-[11px] text-slate-500 block">Credential Hygiene</span>
            <span className="font-semibold text-slate-800 mt-0.5 flex items-center gap-1">
              <KeyRound className="h-3.5 w-3.5 text-sky-600" /> Zero Secrets Exposed
            </span>
          </div>
        </div>
      </div>

      {/* Editable Profile Form */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <User className="h-4 w-4 text-sky-600" />
          <h3 className="text-sm font-bold text-slate-900">Administrator Details</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Full Name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Email Address</label>
              <input
                type="email"
                disabled
                value={currentUser.email}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-500 font-mono cursor-not-allowed"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Phone Number</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Preferred Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
              >
                <option value="UTC+0 (London / GMT)">UTC+0 (London / GMT)</option>
                <option value="UTC+1 (Frankfurt / CET)">UTC+1 (Frankfurt / CET)</option>
                <option value="UTC+3 (Broker MT5 Server)">UTC+3 (Broker MT5 Server)</option>
                <option value="UTC-5 (New York / EST)">UTC-5 (New York / EST)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
            <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              Role upgrades and password resets remain managed by Supabase Auth.
            </span>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-4 py-2 font-semibold text-white whitespace-nowrap transition-colors"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Save Profile</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
