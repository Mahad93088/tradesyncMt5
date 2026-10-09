import React from 'react';
import {
  Server,
  Cpu,
  Activity,
  Zap,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Power,
  PowerOff,
  Clock,
  ShieldAlert,
  HardDrive,
  Database,
  Info
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from '../common/StatusBadge';

export const SystemHealthView: React.FC = () => {
  const { systemHealth, mt5Accounts, notifications, tradeMappings } = useApp();

  const failedTasks = tradeMappings.filter((m) => m.status !== 'EXECUTED');
  const recentErrorNotifs = notifications.filter((n) => n.type === 'error' || n.type === 'warning');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            System Health & Diagnostics
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono">
              Demo Environment
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Operational status of application daemons, hardware consumption, and background task queues.
          </p>
        </div>
      </div>

      {/* Backend Status Verification Note */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs flex items-center justify-between text-slate-400">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-sky-400 shrink-0" />
          <span>
            <strong>Verified Component Status:</strong> Client UI state and simulated demo thread pool are operational. Live external database connections require user-configured Supabase credentials.
          </span>
        </div>
        <span className="font-mono text-[10px] text-slate-500">Supabase Auth: Client Mock</span>
      </div>

      {/* Cluster Hardware Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Daemon Status */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">FastAPI Engine</span>
            <Activity className="h-4 w-4 text-sky-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-xl font-bold text-slate-100">SIMULATED</span>
          </div>
          <p className="text-[11px] text-slate-500 font-mono">
            Uptime: {(systemHealth.uptimeSeconds / 3600).toFixed(1)} hrs
          </p>
        </div>

        {/* Copy Latency */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Avg Copy Latency</span>
            <Zap className="h-4 w-4 text-sky-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-xl font-bold text-slate-100">{systemHealth.averageCopyLatencyMs}ms</span>
            <span className="text-xs text-slate-500 font-mono">Simulated</span>
          </div>
          <p className="text-[11px] text-slate-500">
            Queue depth: <strong className="text-slate-300 font-mono">{systemHealth.queueDepth}</strong>
          </p>
        </div>

        {/* CPU Load */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Host CPU Load</span>
            <Cpu className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-xl font-bold text-slate-100">{systemHealth.cpuUsagePercent}%</span>
            <span className="text-xs text-slate-500">8 vCPUs</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden mt-1">
            <div className="h-full bg-slate-600 rounded-full" style={{ width: `${systemHealth.cpuUsagePercent}%` }} />
          </div>
        </div>

        {/* Memory Load */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">RAM Consumption</span>
            <HardDrive className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-xl font-bold text-slate-100">{systemHealth.ramUsagePercent}%</span>
            <span className="text-xs text-slate-500">16 GB ECC</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden mt-1">
            <div className="h-full bg-slate-600 rounded-full" style={{ width: `${systemHealth.ramUsagePercent}%` }} />
          </div>
        </div>
      </div>

      {/* Grid: Recent Errors & Failed Operations Review */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Failed Background Tasks / Rejects */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Failed Background Tasks & Copy Operations ({failedTasks.length})
              </h3>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Safety Guards Active</span>
          </div>

          {failedTasks.length > 0 ? (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {failedTasks.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="font-semibold text-slate-200">Parent Ticket #{t.parentTradeTicket}</span>
                    <StatusBadge status={t.status} size="sm" />
                  </div>
                  <p className="text-rose-400 text-[11px] leading-normal font-medium">
                    {t.errorMessage || 'Execution aborted by broker risk guard'}
                  </p>
                  <div className="text-[10px] text-slate-500 font-mono">
                    Retries: {t.retryCount} • Symbol: {t.symbol} • {new Date(t.openTime).toLocaleTimeString()} UTC
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 text-xs">
              No failed background tasks detected in current session.
            </div>
          )}
        </div>

        {/* System Error Notifications */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Recent Alerts & Warnings ({recentErrorNotifs.length})
              </h3>
            </div>
          </div>

          {recentErrorNotifs.length > 0 ? (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {recentErrorNotifs.map((n) => (
                <div
                  key={n.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">{n.title}</span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(n.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-slate-300 text-[11px] leading-normal">{n.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 text-xs">
              Zero error notifications flagged.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
