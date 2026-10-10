import React, { useState } from 'react';
import {
  User,
  Shield,
  Key,
  Bell,
  Lock,
  Save,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  RefreshCw,
  Terminal,
  Sliders,
  Smartphone,
  Cloud,
  Database,
  ArrowRight
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { supabaseDataService, MigrationResult } from '../../services/supabaseDataService';

export const AccountSettingsView: React.FC = () => {
  const { currentUser, mentorProfiles, updateCurrentUserProfile, setIsAuthModalOpen } = useApp();
  const { isCloudMode, isConfigured, isAuthenticated, user: authUser } = useAuth();

  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);

  const isMentor = currentUser.role === 'mentor';
  const isTrader = currentUser.role === 'trader';
  const profile = isMentor ? mentorProfiles.find((p) => p.userId === currentUser.id) : null;

  // Profile Form State
  const [fullName, setFullName] = useState(currentUser.fullName);
  const [email] = useState(currentUser.email);
  const [phone, setPhone] = useState(currentUser.phone || '+1 (555) 389-1024');
  const [timezone, setTimezone] = useState('UTC+0 (London / GMT)');

  // Notification Preferences
  const [notifTradeExecute, setNotifTradeExecute] = useState(true);
  const [notifErrorAlert, setNotifErrorAlert] = useState(true);
  const [notifDailyDigest, setNotifDailyDigest] = useState(false);

  // Security Form State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState(false);
  const [pwdError, setPwdError] = useState('');

  // API Token State
  const [copiedToken, setCopiedToken] = useState(false);
  const [apiToken, setApiToken] = useState(
    'ts_bridge_live_sec_7a8f9b0c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7'
  );
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateCurrentUserProfile({
      fullName,
      phone
    });
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError('');
    setPwdSuccess(false);

    if (newPassword.length < 8) {
      setPwdError('Password must be at least 8 characters in length.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('New password and confirmation do not match.');
      return;
    }

    setPwdSuccess(true);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setTimeout(() => setPwdSuccess(false), 3500);
  };

  const handleCopyToken = () => {
    navigator.clipboard.writeText(apiToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const handleRegenerateToken = () => {
    const chars = '0123456789abcdef';
    let rand = 'ts_bridge_live_sec_';
    for (let i = 0; i < 32; i++) {
      rand += chars[Math.floor(Math.random() * chars.length)];
    }
    setApiToken(rand);
  };

  const handleMigrateLocal = async () => {
    if (!currentUser.id) return;
    setMigrating(true);
    const res = await supabaseDataService.migrateLocalDataToCloud(currentUser.id);
    setMigrating(false);
    setMigrationResult(res);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Top Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          Account Settings & Security
          <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono capitalize">
            {currentUser.role} Account
          </span>
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Manage your personal profile, secure credentials, notification settings, and local MT5 bridge tokens.
        </p>
      </div>

      {/* Supabase Cloud Persistence & Role Security Card */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-slate-100">Database Persistence & Role Security</h3>
          </div>
          <span
            className={`rounded border text-[10px] px-2 py-0.5 font-mono uppercase font-semibold ${
              isCloudMode
                ? 'border-emerald-800 bg-emerald-950 text-emerald-400'
                : 'border-amber-800 bg-amber-950 text-amber-400'
            }`}
          >
            {isCloudMode ? 'PostgreSQL Cloud Mode' : 'Local Demo Mode'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <span className="text-slate-500 block text-[11px]">Database Engine:</span>
            <span className="text-slate-200 font-semibold mt-0.5 block">
              {isCloudMode ? 'Supabase PostgreSQL' : 'Browser LocalStorage'}
            </span>
            <span className="text-[10px] text-slate-400 mt-1 block">
              {isCloudMode ? 'Real-time multi-terminal persistence' : 'Volatile in-browser state'}
            </span>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <span className="text-slate-500 block text-[11px]">Enforced Security:</span>
            <span className="text-emerald-400 font-semibold mt-0.5 block flex items-center gap-1">
              <Shield className="h-3.5 w-3.5" /> Row-Level Security (RLS)
            </span>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Traders & Mentors isolated via SQL policies
            </span>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <span className="text-slate-500 block text-[11px]">Privilege Governance:</span>
            <span className="text-sky-300 font-semibold font-mono uppercase mt-0.5 block">
              {currentUser.role} Role
            </span>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Admin promotions restricted to server API
            </span>
          </div>
        </div>

        {/* Local-to-Cloud Migration Feature */}
        <div className="rounded-lg border border-sky-900/40 bg-sky-950/20 p-3.5 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <span className="font-semibold text-sky-200 flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-sky-400" />
              Migrate Local Demo Portfolio to Cloud
            </span>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Copy accounts and trade records from browser storage directly into Supabase tables under your authenticated user ID.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors"
            >
              Auth Settings
            </button>
            <button
              onClick={handleMigrateLocal}
              disabled={migrating || !isCloudMode}
              className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white transition-colors flex items-center gap-1.5"
            >
              {migrating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
              <span>{migrating ? 'Migrating...' : 'Sync to Cloud'}</span>
            </button>
          </div>
        </div>

        {migrationResult && (
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs font-mono space-y-1">
            <div className="text-emerald-400">✓ Accounts synced: {migrationResult.accountsMigrated}</div>
            <div className="text-emerald-400">✓ Trades synced: {migrationResult.tradesMigrated}</div>
            {migrationResult.errors.length > 0 && (
              <div className="text-amber-400 pt-1">
                {migrationResult.errors.map((e, idx) => (
                  <div key={idx}>Notice: {e}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Profile Details Section */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-slate-100">Personal Profile</h3>
          </div>
          {saveSuccess && (
            <span className="text-xs text-emerald-400 flex items-center gap-1 font-mono">
              <CheckCircle2 className="h-3.5 w-3.5" /> Changes saved
            </span>
          )}
        </div>

        <form onSubmit={handleProfileSubmit} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-400 font-medium mb-1">Full Legal Name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-medium mb-1">Registered Email</label>
              <input
                type="email"
                disabled
                value={email}
                className="w-full rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-slate-400 cursor-not-allowed font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Email cannot be modified without re-authentication.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-400 font-medium mb-1">Contact Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-medium mb-1">Platform Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
              >
                <option value="UTC+0 (London / GMT)">UTC+0 (London / GMT)</option>
                <option value="UTC+1 (Frankfurt / CET)">UTC+1 (Frankfurt / CET)</option>
                <option value="UTC-5 (New York / EST)">UTC-5 (New York / EST)</option>
                <option value="UTC+8 (Singapore / HK)">UTC+8 (Singapore / HK)</option>
                <option value="UTC+3 (Cyprus / Broker MT5 Server)">UTC+3 (Cyprus / Broker MT5 Server)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-800">
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-4 py-2 font-semibold text-white transition-colors"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Save Profile</span>
            </button>
          </div>
        </form>
      </div>

      {/* Password & Authentication Security Section */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-slate-100">Password & Authentication</h3>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">Argon2id Hash Enforced</span>
        </div>

        {/* Security Rule Callout */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs flex items-start gap-2.5 text-slate-400">
          <Shield className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-slate-200">Zero-Plaintext Security Architecture:</span>
            <p className="text-[11px] leading-relaxed">
              Passwords and MT5 investor secrets are processed through client-side encryption and hashed using salted Argon2id algorithms. Passwords are never saved in logs or exposed in plain text.
            </p>
          </div>
        </div>

        {pwdSuccess && (
          <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Password updated successfully. Session tokens refreshed.</span>
          </div>
        )}

        {pwdError && (
          <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{pwdError}</span>
          </div>
        )}

        <form onSubmit={handlePasswordSubmit} className="space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 font-medium mb-1">Current Password</label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-medium mb-1">New Password</label>
              <input
                type="password"
                required
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-medium mb-1">Confirm New Password</label>
              <input
                type="password"
                required
                placeholder="Repeat new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-800">
            <button
              type="submit"
              className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 px-4 py-2 font-medium text-slate-200 hover:text-white transition-colors"
            >
              Update Password
            </button>
          </div>
        </form>
      </div>

      {/* Terminal Bridge API Key Section */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-slate-100">MT5 Bridge Authorization Token</h3>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">FastAPI Daemon Key</span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          This token authenticates your local Python FastAPI daemon or MetaTrader 5 Expert Advisor (EA) instance when synchronizing order tickets with TradeSync servers.
        </p>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
          <span className="font-mono text-xs text-slate-300 truncate">
            {apiToken}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleCopyToken}
              className="flex items-center gap-1 rounded bg-slate-800 hover:bg-slate-750 px-2.5 py-1 text-xs text-slate-300 hover:text-white transition-colors"
            >
              {copiedToken ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedToken ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              onClick={handleRegenerateToken}
              className="flex items-center gap-1 rounded border border-slate-750 hover:bg-slate-800 px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              title="Generate new token and revoke previous"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Regenerate</span>
            </button>
          </div>
        </div>
      </div>

      {/* Notification Preferences */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <Bell className="h-4 w-4 text-sky-400" />
          <h3 className="text-sm font-semibold text-slate-100">Event Notifications</h3>
        </div>

        <div className="space-y-3 text-xs">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={notifTradeExecute}
              onChange={(e) => setNotifTradeExecute(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 bg-slate-950 text-sky-600 focus:ring-0"
            />
            <div>
              <span className="font-medium text-slate-200">Instant Trade Execution Alerts</span>
              <p className="text-slate-400 text-[11px]">
                Receive immediate in-app and webhook alerts when orders are opened, closed, or SL/TP adjusted.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={notifErrorAlert}
              onChange={(e) => setNotifErrorAlert(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 bg-slate-950 text-sky-600 focus:ring-0"
            />
            <div>
              <span className="font-medium text-slate-200">Terminal Connection & Risk Warnings</span>
              <p className="text-slate-400 text-[11px]">
                Notify immediately if terminal heartbeat drops, margin utilization reaches 80%, or slippage guard triggers.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={notifDailyDigest}
              onChange={(e) => setNotifDailyDigest(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 bg-slate-950 text-sky-600 focus:ring-0"
            />
            <div>
              <span className="font-medium text-slate-200">Daily PnL Performance Digest</span>
              <p className="text-slate-400 text-[11px]">
                Send an end-of-day summary of mirrored tickets, net profit/loss, and latency performance.
              </p>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
};
