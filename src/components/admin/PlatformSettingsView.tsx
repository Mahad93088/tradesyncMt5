import React, { useEffect, useState } from 'react';
import {
  Globe,
  Sliders,
  ShieldCheck,
  Server,
  Save,
  Download,
  Lock,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  AdminPageHeader,
  AdminFeedbackBanner,
} from './adminUi';

export const PlatformSettingsView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const { platformSettings, savePlatformSettings } = useApp();

  const [defaultSlippageMaxPips, setDefaultSlippageMaxPips] = useState<number>(
    platformSettings.defaultSlippageMaxPips
  );
  const [defaultMaxLotCap, setDefaultMaxLotCap] = useState<number>(
    platformSettings.defaultMaxLotCap
  );
  const [heartbeatStaleSeconds, setHeartbeatStaleSeconds] = useState<number>(
    platformSettings.heartbeatStaleSeconds
  );
  const [maintenanceMode, setMaintenanceMode] = useState<boolean>(
    platformSettings.maintenanceMode
  );
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  useEffect(() => {
    setDefaultSlippageMaxPips(platformSettings.defaultSlippageMaxPips);
    setDefaultMaxLotCap(platformSettings.defaultMaxLotCap);
    setHeartbeatStaleSeconds(platformSettings.heartbeatStaleSeconds);
    setMaintenanceMode(platformSettings.maintenanceMode);
  }, [platformSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setFeedback(null);
    const res = await savePlatformSettings({
      demoOnlyEnforced: true,
      defaultSlippageMaxPips,
      defaultMaxLotCap,
      heartbeatStaleSeconds,
      maintenanceMode,
    });
    setIsSaving(false);
    setFeedback({
      type: res.success ? 'success' : 'error',
      message:
        res.message ||
        (res.success ? 'Platform settings saved.' : 'Failed to persist platform settings.'),
    });
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <AdminPageHeader
        title="Platform Settings"
        meta={isCloudMode ? 'PostgreSQL platform_settings · Demo Lock Enforced' : 'Demo Sandbox Configuration'}
        subtitle="Configure platform-wide execution slippage limits, max lot caps, stale heartbeat detection thresholds, and maintenance posture."
        actions={
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save Platform Settings'}</span>
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
        {/* 1. Risk & Copier Execution Caps */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Sliders className="h-4 w-4 text-sky-600" />
            <h3 className="text-sm font-bold text-slate-900">1. Global Copier Risk Defaults</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                Default Slippage Max (Pips)
              </label>
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                required
                value={defaultSlippageMaxPips}
                onChange={(e) => setDefaultSlippageMaxPips(parseFloat(e.target.value) || 0)}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                Default Max Lot Cap
              </label>
              <input
                type="number"
                step="0.5"
                min="0.01"
                max="100"
                required
                value={defaultMaxLotCap}
                onChange={(e) => setDefaultMaxLotCap(parseFloat(e.target.value) || 1)}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Persisted in <code className="font-mono">public.platform_settings</code> and recorded in <code className="font-mono">public.audit_logs</code> on update.
          </p>
        </section>

        {/* 2. Bridge Telemetry & Maintenance */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Server className="h-4 w-4 text-sky-600" />
            <h3 className="text-sm font-bold text-slate-900">2. MT5 Bridge Telemetry &amp; Maintenance</h3>
          </div>
          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                Stale Heartbeat Threshold (Seconds)
              </label>
              <input
                type="number"
                min="10"
                max="3600"
                required
                value={heartbeatStaleSeconds}
                onChange={(e) => setHeartbeatStaleSeconds(parseInt(e.target.value, 10) || 60)}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
              />
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer text-slate-700 pt-1">
              <input
                type="checkbox"
                checked={maintenanceMode}
                onChange={(e) => setMaintenanceMode(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Enable Platform Maintenance Mode Notice</span>
            </label>
          </div>
        </section>

        {/* 3. Immutable Demo-Only Security Lock */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">3. Security &amp; Compliance Locks</h3>
          </div>
          <div className="space-y-3 text-xs">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-950 space-y-1.5">
              <div className="font-semibold flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-emerald-700" />
                <span>Immutable Demo-Only Compliance Guardrail</span>
              </div>
              <ul className="text-[11px] space-y-0.5 text-emerald-900">
                <li>· Database constraint: <code className="font-mono">account_type = &apos;demo&apos;</code> enforced on every MT5 account</li>
                <li>· MQL5 EAs require <code className="font-mono">ACCOUNT_TRADE_MODE_DEMO</code> before sending/receiving instructions</li>
                <li>· API rejects attempts to set <code className="font-mono">demoOnlyEnforced: false</code> with HTTP 403</li>
              </ul>
            </div>
            <label className="flex items-center gap-2.5 text-slate-700 opacity-85 cursor-not-allowed">
              <input
                type="checkbox"
                checked={true}
                disabled
                readOnly
                className="rounded border-emerald-400 text-emerald-600"
              />
              <span className="font-medium">
                Demo-Only Enforced (Locked &amp; Immutable)
              </span>
            </label>
          </div>
        </section>

        {/* 4. MQL5 Expert Advisors */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Globe className="h-4 w-4 text-sky-600" />
            <h3 className="text-sm font-bold text-slate-900">4. Production MQL5 Demo Advisors</h3>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Download the compiled-ready MQL5 source files configured for HTTPS Bridge polling and SHA-256 terminal token authentication.
          </p>
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
        </section>
      </div>
    </form>
  );
};

