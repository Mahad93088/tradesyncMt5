import React, { useState } from 'react';
import {
  Globe,
  Sliders,
  CreditCard,
  Bell,
  ShieldCheck,
  Server,
  Save,
  Download,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  AdminPageHeader,
  AdminFeedbackBanner,
} from './adminUi';

const PLATFORM_SETTINGS_KEY = 'tradesync_admin_platform_settings_v1';

interface PlatformSettingsState {
  platformName: string;
  supportEmail: string;
  defaultTimezone: string;
  maxChildAccountsPerMentor: number;
  maxMT5AccountsPerUser: number;
  defaultTrialDays: number;
  defaultBillingCycle: 'monthly' | 'yearly';
  alertOnStaleHeartbeat: boolean;
  alertOnFailedCopy: boolean;
  alertOnPendingSignup: boolean;
  requireMentorApproval: boolean;
  staleHeartbeatSeconds: number;
}

const DEFAULT_SETTINGS: PlatformSettingsState = {
  platformName: 'TradeSync MT5',
  supportEmail: 'support@tradesync-mt5.io',
  defaultTimezone: 'UTC+0',
  maxChildAccountsPerMentor: 25,
  maxMT5AccountsPerUser: 5,
  defaultTrialDays: 14,
  defaultBillingCycle: 'monthly',
  alertOnStaleHeartbeat: true,
  alertOnFailedCopy: true,
  alertOnPendingSignup: true,
  requireMentorApproval: true,
  staleHeartbeatSeconds: 90,
};

export const PlatformSettingsView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const { currentUser, addAuditLog } = useApp();

  const [settings, setSettings] = useState<PlatformSettingsState>(() => {
    try {
      const raw = localStorage.getItem(PLATFORM_SETTINGS_KEY);
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [feedback, setFeedback] = useState<{ type: 'success' | 'info'; message: string } | null>(null);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem(PLATFORM_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage error
    }
    addAuditLog({
      actorId: currentUser.id,
      actorName: currentUser.fullName,
      actorRole: 'admin',
      action: 'UPDATE_PLATFORM_SETTINGS',
      targetResource: 'platform_settings',
      result: 'success',
      details: `Saved local admin workspace preferences (max child accounts/mentor: ${settings.maxChildAccountsPerMentor}, stale threshold: ${settings.staleHeartbeatSeconds}s).`,
    });
    setFeedback({
      type: isCloudMode ? 'info' : 'success',
      message: isCloudMode
        ? 'Preferences saved to browser workspace. Note: Security rules (RLS, SHA-256 terminal auth, and Demo-only EA safeguards) remain enforced server-side.'
        : 'Platform settings saved to Demo Sandbox.',
    });
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <AdminPageHeader
        title="Platform Settings"
        meta={isCloudMode ? 'Server Security Enforced' : 'Demo Sandbox Configuration'}
        subtitle="Configure platform identity, account limits, default subscription rules, notification triggers, security posture, and MT5 bridge parameters."
        actions={
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Save Preferences</span>
          </button>
        }
      />

      {feedback && (
        <AdminFeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 1. Platform Information */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Globe className="h-4 w-4 text-sky-600" />
            <h3 className="text-sm font-bold text-slate-900">1. Platform Information</h3>
          </div>
          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Platform Display Name</label>
              <input
                type="text"
                value={settings.platformName}
                onChange={(e) => setSettings({ ...settings, platformName: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Operations Contact Email</label>
                <input
                  type="email"
                  value={settings.supportEmail}
                  onChange={(e) => setSettings({ ...settings, supportEmail: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Audit Timestamp Standard</label>
                <select
                  value={settings.defaultTimezone}
                  onChange={(e) => setSettings({ ...settings, defaultTimezone: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                >
                  <option value="UTC+0">UTC+0 (Canonical Bridge Time)</option>
                  <option value="UTC+3">UTC+3 (MT5 Broker Server)</option>
                  <option value="UTC-5">UTC-5 (New York EST)</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* 2. Account Limits */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Sliders className="h-4 w-4 text-sky-600" />
            <h3 className="text-sm font-bold text-slate-900">2. Account Limits</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Default Max Child Accounts / Mentor</label>
              <input
                type="number"
                min="1"
                max="500"
                value={settings.maxChildAccountsPerMentor}
                onChange={(e) => setSettings({ ...settings, maxChildAccountsPerMentor: parseInt(e.target.value, 10) || 25 })}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Max MT5 Terminals / User</label>
              <input
                type="number"
                min="1"
                max="50"
                value={settings.maxMT5AccountsPerUser}
                onChange={(e) => setSettings({ ...settings, maxMT5AccountsPerUser: parseInt(e.target.value, 10) || 5 })}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Per-plan follower caps are managed in Subscription Plans (Demo Sandbox) or enforced via database constraints when billing schema is provisioned.
          </p>
        </section>

        {/* 3. Default Subscription Settings */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <CreditCard className="h-4 w-4 text-sky-600" />
            <h3 className="text-sm font-bold text-slate-900">3. Default Subscription Settings</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Default Trial Duration (Days)</label>
              <input
                type="number"
                min="0"
                max="90"
                value={settings.defaultTrialDays}
                onChange={(e) => setSettings({ ...settings, defaultTrialDays: parseInt(e.target.value, 10) || 0 })}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Default Billing Interval</label>
              <select
                value={settings.defaultBillingCycle}
                onChange={(e) => setSettings({ ...settings, defaultBillingCycle: e.target.value as 'monthly' | 'yearly' })}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Annual</option>
              </select>
            </div>
          </div>
        </section>

        {/* 4. Notification Preferences */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Bell className="h-4 w-4 text-sky-600" />
            <h3 className="text-sm font-bold text-slate-900">4. Notification Preferences</h3>
          </div>
          <div className="space-y-2.5 text-xs text-slate-700">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.alertOnStaleHeartbeat}
                onChange={(e) => setSettings({ ...settings, alertOnStaleHeartbeat: e.target.checked })}
                className="rounded border-slate-300"
              />
              <span>Flag offline or stale MT5 heartbeats in Notifications &amp; Alerts</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.alertOnFailedCopy}
                onChange={(e) => setSettings({ ...settings, alertOnFailedCopy: e.target.checked })}
                className="rounded border-slate-300"
              />
              <span>Surface failed bridge copy instructions immediately</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.alertOnPendingSignup}
                onChange={(e) => setSettings({ ...settings, alertOnPendingSignup: e.target.checked })}
                className="rounded border-slate-300"
              />
              <span>Highlight pending mentor and trader approvals</span>
            </label>
          </div>
        </section>

        {/* 5. Security Settings */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">5. Security Settings</h3>
          </div>
          <div className="space-y-3 text-xs">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-950 space-y-1">
              <div className="font-semibold">Immutable Security Controls Enforced</div>
              <ul className="text-[11px] space-y-0.5 text-emerald-900">
                <li>· Demo-only execution lock: <code className="font-mono">ACCOUNT_TRADE_MODE_DEMO</code> required on both EAs</li>
                <li>· Terminal authentication: SHA-256 hashed <code className="font-mono">X-Terminal-Token</code> per account</li>
                <li>· PostgreSQL Row-Level Security (RLS) isolates Mentor and Trader tenants</li>
              </ul>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer text-slate-700">
              <input
                type="checkbox"
                checked={settings.requireMentorApproval}
                onChange={(e) => setSettings({ ...settings, requireMentorApproval: e.target.checked })}
                className="rounded border-slate-300"
              />
              <span>Require Super Admin approval before mentor onboarding</span>
            </label>
          </div>
        </section>

        {/* 6. System Configuration */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Server className="h-4 w-4 text-sky-600" />
            <h3 className="text-sm font-bold text-slate-900">6. System Configuration</h3>
          </div>
          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Stale Heartbeat Threshold (Seconds)</label>
              <input
                type="number"
                min="30"
                max="600"
                value={settings.staleHeartbeatSeconds}
                onChange={(e) => setSettings({ ...settings, staleHeartbeatSeconds: parseInt(e.target.value, 10) || 90 })}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <a
                href="/api/mql5/download/broadcaster"
                download="TradeSync_Broadcaster.mq5"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                <Download className="h-3.5 w-3.5 text-amber-600" />
                <span>Download Broadcaster EA</span>
              </a>
              <a
                href="/api/mql5/download/receiver"
                download="TradeSync_Receiver.mq5"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                <Download className="h-3.5 w-3.5 text-sky-600" />
                <span>Download Receiver EA</span>
              </a>
            </div>
          </div>
        </section>
      </div>
    </form>
  );
};
