import React, { useState } from 'react';
import {
  Activity,
  Server,
  Database,
  Zap,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Download,
  Key,
  Copy,
  Check,
  X,
  ShieldCheck,
  WifiOff,
  Users,
  Link2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { ensureValidSession } from '../../lib/sessionManager';
import { formatHeartbeatAge } from '../common/dashboardHelpers';
import { MT5Account } from '../../types';
import {
  AdminPageHeader,
  AdminStatCard,
  AdminStatusText,
  AdminFeedbackBanner,
} from './adminUi';

export const SystemHealthView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const {
    users,
    mt5Accounts,
    parentChildLinks,
    systemHealth,
    cloudBridgeTelemetry,
    tradeMappings,
    syncLogs,
    notifications,
    refreshCloudData,
  } = useApp();

  const [healthPingResult, setHealthPingResult] = useState<{
    ok: boolean;
    statusText: string;
    latencyMs: number;
    checkedAt: string;
  } | null>(null);
  const [isPinging, setIsPinging] = useState(false);

  const [isGeneratingToken, setIsGeneratingToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenModalData, setTokenModalData] = useState<{
    account: MT5Account;
    terminalToken: string;
  } | null>(null);
  const [copiedModalToken, setCopiedModalToken] = useState(false);
  const [copiedModalUrl, setCopiedModalUrl] = useState(false);

  const serverOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://tradesync-mt5.vercel.app';

  const activeMentorsCount = users.filter((u) => u.role === 'mentor' && u.status === 'active').length;
  const activeCopyAssignmentsCount = parentChildLinks.filter((l) => l.status === 'active').length;
  const failedTasks = tradeMappings.filter(
    (m) => m.status !== 'EXECUTED' && m.status !== 'CLOSED' && m.status !== 'PENDING'
  );
  const offlineOrStaleAccounts = mt5Accounts.filter(
    (a) => a.connectionStatus !== 'connected' || a.isStale
  );
  const recentSystemEvents = [
    ...notifications.filter((n) => n.type === 'error' || n.type === 'warning').slice(0, 6).map((n) => ({
      id: n.id,
      title: n.title,
      detail: n.message,
      level: n.type,
      timestamp: n.timestamp,
    })),
    ...syncLogs.slice(0, 6).map((s) => ({
      id: s.id,
      title: s.eventType,
      detail: s.details,
      level: s.level === 'error' ? 'error' : s.level === 'warn' ? 'warning' : 'info',
      timestamp: s.timestamp,
    })),
  ].slice(0, 8);

  const handleRunHealthCheck = async () => {
    setIsPinging(true);
    const start = performance.now();
    try {
      const res = await fetch('/api/health');
      const latencyMs = Math.round(performance.now() - start);
      const data = await res.json().catch(() => ({}));
      setHealthPingResult({
        ok: res.ok && Boolean(data?.status === 'ok' || data?.ok !== false),
        statusText: res.ok ? `HTTP ${res.status} · API Healthy` : `HTTP ${res.status} · Degraded`,
        latencyMs,
        checkedAt: new Date().toLocaleTimeString(),
      });
      if (isCloudMode) {
        await refreshCloudData();
      }
    } catch (err: any) {
      setHealthPingResult({
        ok: false,
        statusText: err?.message || 'API Unreachable',
        latencyMs: Math.round(performance.now() - start),
        checkedAt: new Date().toLocaleTimeString(),
      });
    } finally {
      setIsPinging(false);
    }
  };

  const handleRotateToken = async (account: MT5Account) => {
    setIsGeneratingToken(account.id);
    setTokenError(null);
    try {
      const sessionCheck = await ensureValidSession();
      if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
        setTokenError('Cloud authentication required to rotate a terminal token.');
        return;
      }

      const res = await fetch('/api/v1/bridge/terminals/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionCheck.session.access_token}`,
        },
        body: JSON.stringify({
          accountId: account.id,
          accountNumber: account.accountNumber,
          brokerServer: account.server,
          brokerName: account.broker,
          accountRole: account.accountRole,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success || !data?.terminalToken) {
        setTokenError(data?.error || `Token rotation failed (HTTP ${res.status}).`);
        return;
      }
      setTokenModalData({
        account,
        terminalToken: data.terminalToken,
      });
    } catch (err: any) {
      setTokenError(err?.message || 'Failed to rotate terminal token.');
    } finally {
      setIsGeneratingToken(null);
    }
  };

  const schemaVerifiedCount = Object.values(cloudBridgeTelemetry.tablesVerified).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Platform Monitoring"
        meta={isCloudMode ? 'Live API + Supabase Diagnostics' : 'Demo Sandbox Diagnostics'}
        subtitle="Inspect /api/health responsiveness, Supabase bridge persistence, MT5 terminal heartbeats, stale terminals, and EA bridge provisioning."
        actions={
          <button
            type="button"
            onClick={() => void handleRunHealthCheck()}
            disabled={isPinging}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isPinging ? 'animate-spin' : ''}`} />
            <span>Run /api/health Check</span>
          </button>
        }
      />

      {healthPingResult && (
        <AdminFeedbackBanner
          type={healthPingResult.ok ? 'success' : 'error'}
          message={`${healthPingResult.statusText} (${healthPingResult.latencyMs}ms round-trip at ${healthPingResult.checkedAt})`}
          onDismiss={() => setHealthPingResult(null)}
        />
      )}

      {tokenError && (
        <AdminFeedbackBanner type="error" message={tokenError} onDismiss={() => setTokenError(null)} />
      )}

      {/* Supabase & Bridge Verification Banner */}
      <div
        className={`rounded-xl border p-4 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
          isCloudMode
            ? cloudBridgeTelemetry.bridgePersistenceReady
              ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
              : 'border-rose-200 bg-rose-50 text-rose-950'
            : 'border-slate-200 bg-white text-slate-700'
        }`}
      >
        <div className="flex items-center gap-2.5">
          {isCloudMode && !cloudBridgeTelemetry.bridgePersistenceReady ? (
            <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          )}
          <span>
            {isCloudMode ? (
              <>
                <strong>Supabase Bridge Service:</strong>{' '}
                {cloudBridgeTelemetry.bridgePersistenceReady
                  ? 'All 5 bridge tables and claim_pending_instructions RPC verified.'
                  : cloudBridgeTelemetry.databaseError || 'Bridge persistence check degraded.'}
              </>
            ) : (
              <>
                <strong>Demo Sandbox Monitoring:</strong> Monitoring simulated MT5 heartbeats and local queue latency. Connect Cloud Auth to verify live Supabase bridge tables.
              </>
            )}
          </span>
        </div>
        <span className="font-mono text-[11px] shrink-0 tabular-nums">
          {isCloudMode
            ? `Schema ${schemaVerifiedCount}/5 · DB ${cloudBridgeTelemetry.databaseLatencyMs ?? 'N/A'}ms`
            : 'Demo-Only EA Mode Active'}
        </span>
      </div>

      {/* Monitoring KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <AdminStatCard
          title="Bridge Service Status"
          value={
            isCloudMode
              ? cloudBridgeTelemetry.bridgePersistenceReady
                ? 'OPERATIONAL'
                : 'DEGRADED'
              : 'SANDBOX'
          }
          subtitle={
            isCloudMode
              ? `DB Latency: ${cloudBridgeTelemetry.databaseLatencyMs ?? 'N/A'}ms`
              : `Simulated latency: ${systemHealth.averageCopyLatencyMs}ms`
          }
          icon={Database}
          tone={isCloudMode && !cloudBridgeTelemetry.bridgePersistenceReady ? 'rose' : 'emerald'}
        />
        <AdminStatCard
          title="Connected Terminals"
          value={`${mt5Accounts.filter((a) => a.connectionStatus === 'connected').length} / ${mt5Accounts.length}`}
          subtitle={`${cloudBridgeTelemetry.staleTerminalsCount || mt5Accounts.filter((a) => a.isStale).length} stale · ${offlineOrStaleAccounts.length} offline/attention`}
          icon={Server}
          tone={offlineOrStaleAccounts.length > 0 ? 'amber' : 'emerald'}
        />
        <AdminStatCard
          title="Active Mentors & Links"
          value={`${activeMentorsCount} / ${activeCopyAssignmentsCount}`}
          subtitle="Active mentors / active copy assignments"
          icon={Users}
          tone="blue"
        />
        <AdminStatCard
          title="Execution Error Count"
          value={failedTasks.length}
          subtitle={`Pending queue: ${cloudBridgeTelemetry.pendingInstructionsCount || systemHealth.queueDepth}`}
          icon={Zap}
          tone={failedTasks.length > 0 ? 'rose' : 'neutral'}
        />
      </div>

      {/* Terminal Connectivity & Offline/Stale Monitor */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Terminal Connectivity &amp; Heartbeat Table</h3>
            <p className="text-[11px] text-slate-500">
              Parent and Child terminal heartbeats, stale detection, and one-time SHA-256 token rotation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/api/mql5/download/broadcaster"
              download="TradeSync_Broadcaster.mq5"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 text-amber-600" />
              <span>Broadcaster EA</span>
            </a>
            <a
              href="/api/mql5/download/receiver"
              download="TradeSync_Receiver.mq5"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 text-sky-600" />
              <span>Receiver EA</span>
            </a>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Role &amp; Owner</th>
                <th className="px-4 py-3">Broker &amp; Server</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Heartbeat</th>
                <th className="px-4 py-3">Ping</th>
                <th className="px-4 py-3 text-right">Terminal Token</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mt5Accounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No MT5 terminals registered yet.
                  </td>
                </tr>
              ) : (
                mt5Accounts.map((acc) => {
                  const owner = users.find((u) => u.id === acc.userId);
                  return (
                    <tr key={acc.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900 tabular-nums">
                        #{acc.accountNumber}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-900 block">{owner?.fullName || 'Verified User'}</span>
                        <span className="font-mono text-[10px] uppercase text-slate-500">{acc.accountRole}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-slate-800 block">{acc.broker}</span>
                        <span className="font-mono text-[11px] text-slate-500">{acc.server}</span>
                      </td>
                      <td className="px-4 py-3">
                        <AdminStatusText status={acc.isStale ? 'stale' : acc.connectionStatus} />
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-600 tabular-nums">
                        {formatHeartbeatAge(acc.lastHeartbeat)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-600 tabular-nums">
                        {acc.connectionStatus === 'connected' ? `${acc.pingMs}ms` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void handleRotateToken(acc)}
                          disabled={isGeneratingToken === acc.id}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 whitespace-nowrap disabled:opacity-50"
                        >
                          <Key className="h-3 w-3 text-amber-600" />
                          <span>{isGeneratingToken === acc.id ? 'Rotating...' : 'Rotate Token'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Offline/Stale Terminals + Recent System Events */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <WifiOff className="h-4 w-4 text-amber-600" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                Offline &amp; Stale Terminals ({offlineOrStaleAccounts.length})
              </h3>
            </div>
            <span className="font-mono text-[11px] text-slate-500">90s Heartbeat Guard</span>
          </div>

          {offlineOrStaleAccounts.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">All registered MT5 terminals report healthy heartbeats.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {offlineOrStaleAccounts.map((acc) => (
                <div key={acc.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs flex items-center justify-between gap-2">
                  <div>
                    <div className="font-mono font-semibold text-slate-900">#{acc.accountNumber} · {acc.accountRole.toUpperCase()}</div>
                    <p className="text-[11px] text-slate-600">{acc.errorMessage || 'Awaiting active EA WebRequest heartbeat'}</p>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <AdminStatusText status={acc.isStale ? 'stale' : acc.connectionStatus} />
                    <div className="font-mono text-[10px] text-slate-500 tabular-nums">{formatHeartbeatAge(acc.lastHeartbeat)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-sky-600" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                Recent System Events ({recentSystemEvents.length})
              </h3>
            </div>
            <span className="font-mono text-[11px] text-slate-500 flex items-center gap-1">
              <Link2 className="h-3 w-3" /> {failedTasks.length} Errors
            </span>
          </div>

          {recentSystemEvents.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">No recent warning or bridge synchronization events recorded.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {recentSystemEvents.map((ev) => (
                <div key={ev.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 truncate">{ev.title}</span>
                    <span className="font-mono text-[10px] text-slate-500 tabular-nums shrink-0">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">{ev.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* One-time Token Rotation Display Modal */}
      {tokenModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl p-5 space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700">
                  <Key className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Terminal Token Rotated</h3>
                  <p className="text-xs text-slate-500">
                    Account #{tokenModalData.account.accountNumber} ({tokenModalData.account.broker})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTokenModalData(null)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 space-y-1">
              <span className="font-semibold flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-amber-700" /> Save This Secret Token Now
              </span>
              <p className="text-[11px] text-amber-900 leading-relaxed">
                This secret is shown once and stored SHA-256 hashed server-side. Paste it into your EA&apos;s <code className="font-mono bg-white px-1 py-0.5 rounded border border-amber-200">InpTerminalToken</code> parameter.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">New Secret Terminal Token</label>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 select-all break-all">
                  {tokenModalData.terminalToken}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(tokenModalData.terminalToken);
                    setCopiedModalToken(true);
                    setTimeout(() => setCopiedModalToken(false), 2000);
                  }}
                  className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs shrink-0"
                >
                  {copiedModalToken ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">Allowed WebRequest URL</label>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg bg-slate-50 border border-slate-200 px-3 py-1.5 font-mono text-xs text-slate-700 truncate">
                  {serverOrigin}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(serverOrigin);
                    setCopiedModalUrl(true);
                    setTimeout(() => setCopiedModalUrl(false), 2000);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs shrink-0"
                >
                  {copiedModalUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setTokenModalData(null)}
                className="px-4 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
