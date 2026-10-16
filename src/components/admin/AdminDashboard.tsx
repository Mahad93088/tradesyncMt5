import React, { useState } from 'react';
import {
  Users,
  UserCheck,
  CreditCard,
  Server,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  ArrowUpRight,
  Plus,
  Radio,
  Zap,
  TrendingUp,
  ShieldCheck,
  Bell,
  Clock,
  Info,
  Layers
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatsCard } from '../common/StatsCard';
import { StatusBadge } from '../common/StatusBadge';

interface AdminDashboardProps {
  onNavigateTab: (tab: string) => void;
  onOpenCreateMentor: () => void;
  onOpenAddTrader?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onNavigateTab,
  onOpenCreateMentor,
  onOpenAddTrader
}) => {
  const {
    users,
    mentorProfiles,
    mt5Accounts,
    subscriptions,
    parentChildLinks,
    trades,
    tradeMappings,
    syncLogs,
    auditLogs,
    systemHealth,
    notifications,
    broadcastAnnouncement
  } = useApp();

  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementMsg, setAnnouncementMsg] = useState('');
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);

  // Compute metrics
  const mentors = users.filter((u) => u.role === 'mentor');
  const traders = users.filter((u) => u.role === 'trader');
  const activeMentors = mentors.filter((m) => m.status === 'active').length;
  const suspendedMentors = mentors.filter((m) => m.status === 'suspended').length;
  const activeTraders = traders.filter((t) => t.status === 'active').length;
  const suspendedTraders = traders.filter((t) => t.status === 'suspended').length;
  const totalActiveUsers = activeMentors + activeTraders;
  const totalSuspendedUsers = suspendedMentors + suspendedTraders;

  const activeSubs = subscriptions.filter((s) => s.status === 'active').length;
  const expiredSubs = subscriptions.filter((s) => s.status === 'expired').length;
  const cancelledSubs = subscriptions.filter((s) => s.status === 'cancelled').length;
  const pendingSubs = subscriptions.filter((s) => s.status === 'pending').length;

  const connectedMT5 = mt5Accounts.filter((a) => a.connectionStatus === 'connected').length;
  const disconnectedMT5 = mt5Accounts.filter((a) => a.connectionStatus === 'disconnected').length;
  const errorMT5 = mt5Accounts.filter((a) => a.connectionStatus === 'error').length;

  const totalExecuted = tradeMappings.filter((m) => m.status === 'EXECUTED').length;
  const failedTrades = tradeMappings.filter((m) => m.status !== 'EXECUTED').length;
  const openSignals = trades.filter((t) => t.status === 'OPEN').length;

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!announcementTitle || !announcementMsg) return;
    broadcastAnnouncement(announcementTitle, announcementMsg, 'all');
    setAnnouncementTitle('');
    setAnnouncementMsg('');
    setShowBroadcastModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Quick Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              System Administration
            </h1>
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-mono text-slate-300">
              Demo Environment
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Account management, subscriber subscriptions, connection records, and audit monitoring.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBroadcastModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-750 hover:text-white transition-colors"
          >
            <Bell className="h-3.5 w-3.5 text-slate-400" />
            <span>Broadcast Alert</span>
          </button>
          <button
            onClick={onOpenCreateMentor}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Provision Mentor</span>
          </button>
          {onOpenAddTrader && (
            <button
              onClick={onOpenAddTrader}
              className="flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Trader</span>
            </button>
          )}
        </div>
      </div>

      {/* Notice on Demo Data */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs flex items-center justify-between gap-3 text-slate-400">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-sky-400 shrink-0" />
          <span>
            <strong>Demo Data Notice:</strong> All metrics, account balances, and copy mappings displayed below represent simulated testnet data.
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-500 hidden sm:inline">
          Live MT5 binary bridge disarmed
        </span>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatsCard
          title="Total Mentors"
          value={mentors.length}
          subtitle={`${activeMentors} Active • ${suspendedMentors} Suspended`}
          icon={Users}
          accentColor="blue"
          isDemo={true}
          onClick={() => onNavigateTab('mentors')}
        />
        <StatsCard
          title="Total Traders"
          value={traders.length}
          subtitle={`${activeTraders} Active • ${suspendedTraders} Suspended`}
          icon={UserCheck}
          accentColor="teal"
          isDemo={true}
          onClick={() => onNavigateTab('traders')}
        />
        <StatsCard
          title="Subscriptions"
          value={activeSubs}
          subtitle={`${activeSubs} Active • ${expiredSubs} Exp • ${cancelledSubs} Canc`}
          icon={CreditCard}
          accentColor="slate"
          isDemo={true}
          onClick={() => onNavigateTab('plans')}
        />
        <StatsCard
          title="Demo MT5 Terminals"
          value={connectedMT5}
          subtitle={`${connectedMT5} Connected • ${disconnectedMT5 + errorMT5} Offline`}
          icon={Server}
          accentColor={errorMT5 > 0 ? 'amber' : 'emerald'}
          isDemo={true}
          onClick={() => onNavigateTab('connections')}
        />
      </div>

      {/* MT5 Account Management Quick Navigation Hub */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div
          onClick={() => onNavigateTab('parent-accounts')}
          className="group rounded-xl border border-slate-800 bg-slate-900/80 hover:border-cyan-700/80 p-4 transition-all cursor-pointer flex items-center justify-between"
        >
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400 group-hover:scale-105 transition-transform">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                  Parent MT5 Accounts
                </h4>
                <span className="rounded bg-cyan-950 border border-cyan-800 px-1.5 py-0.2 text-[10px] font-mono text-cyan-400">
                  {mt5Accounts.filter((a) => a.accountRole === 'parent').length} Masters
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Manage mentor terminals, inspect connected children, and reassign streams.
              </p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-slate-500 group-hover:text-cyan-400 transition-colors shrink-0" />
        </div>

        <div
          onClick={() => onNavigateTab('child-accounts')}
          className="group rounded-xl border border-slate-800 bg-slate-900/80 hover:border-emerald-700/80 p-4 transition-all cursor-pointer flex items-center justify-between"
        >
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 rounded-lg bg-emerald-950 border border-emerald-800 text-emerald-400 group-hover:scale-105 transition-transform">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-white group-hover:text-emerald-300 transition-colors">
                  Child MT5 Accounts
                </h4>
                <span className="rounded bg-emerald-950 border border-emerald-800 px-1.5 py-0.2 text-[10px] font-mono text-emerald-400">
                  {mt5Accounts.filter((a) => a.accountRole === 'child').length} Followers
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Audit follower accounts, assign mentor parents, and toggle trading status.
              </p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-slate-500 group-hover:text-emerald-400 transition-colors shrink-0" />
        </div>
      </div>

      {/* User, Subscription, Connection, and Signal Status Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            User Accounts Status
          </span>
          <div className="flex items-baseline gap-2 pt-1">
            <span className="font-mono text-2xl font-bold text-slate-100">{users.length}</span>
            <span className="text-xs text-slate-400">Total Users</span>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1 text-xs border-t border-slate-800 text-slate-400 font-mono">
            <div>Active: <strong className="text-emerald-400">{totalActiveUsers}</strong></div>
            <div>Suspended: <strong className="text-rose-400">{totalSuspendedUsers}</strong></div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Subscription Lifecycle
          </span>
          <div className="flex items-baseline gap-2 pt-1">
            <span className="font-mono text-2xl font-bold text-slate-100">{subscriptions.length}</span>
            <span className="text-xs text-slate-400">Subscriptions</span>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1 text-xs border-t border-slate-800 text-slate-400 font-mono">
            <div>Active: <strong className="text-emerald-400">{activeSubs}</strong></div>
            <div>Expired: <strong className="text-amber-400">{expiredSubs}</strong></div>
            <div>Cancelled: <strong className="text-slate-400">{cancelledSubs}</strong></div>
            <div>Pending: <strong className="text-sky-400">{pendingSubs}</strong></div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Connection Status Overview
          </span>
          <div className="flex items-baseline gap-2 pt-1">
            <span className="font-mono text-2xl font-bold text-slate-100">{mt5Accounts.length}</span>
            <span className="text-xs text-slate-400">Registered Accounts</span>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1 text-xs border-t border-slate-800 text-slate-400 font-mono">
            <div>Conn: <strong className="text-emerald-400">{connectedMT5}</strong></div>
            <div>Off: <strong className="text-slate-400">{disconnectedMT5}</strong></div>
            <div>Err: <strong className="text-rose-400">{errorMT5}</strong></div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Copy Signals & Latency
          </span>
          <div className="flex items-baseline gap-2 pt-1">
            <span className="font-mono text-2xl font-bold text-slate-100">{trades.length}</span>
            <span className="text-xs text-slate-400">Total Deals</span>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1 text-xs border-t border-slate-800 text-slate-400 font-mono">
            <div>Open Signals: <strong className="text-emerald-400">{openSignals}</strong></div>
            <div>Executed: <strong className="text-sky-400">{totalExecuted}</strong></div>
            <div>Failed: <strong className="text-rose-400">{failedTrades}</strong></div>
            <div>Latency: <strong className="text-slate-200">{systemHealth.averageCopyLatencyMs}ms</strong></div>
          </div>
        </div>
      </div>

      {/* Grid: Demo Account Connection Records + Recent Platform Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Connection Records Card */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-sky-400" />
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Connection Records (Demo Accounts)
              </h3>
            </div>
            <button
              onClick={() => onNavigateTab('connections')}
              className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1"
            >
              All Records <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {mt5Accounts.map((acc) => {
              const user = users.find((u) => u.id === acc.userId);
              return (
                <div
                  key={acc.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 p-2.5 text-xs hover:border-slate-700 transition-colors"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-slate-200">
                        #{acc.accountNumber}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        ({acc.accountRole === 'parent' ? 'Parent Mentor' : 'Child Trader'})
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {user?.fullName} • {acc.broker} ({acc.server})
                    </p>
                    {acc.errorMessage && (
                      <p className="text-[10px] text-rose-400 truncate max-w-xs" title={acc.errorMessage}>
                        {acc.errorMessage}
                      </p>
                    )}
                  </div>

                  <div className="text-right flex flex-col items-end gap-1">
                    <StatusBadge status={acc.connectionStatus} size="sm" />
                    <span className="font-mono text-[10px] text-slate-500">
                      {acc.connectionStatus === 'connected' ? `${acc.pingMs}ms` : 'Off'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Platform Activity & Audit Logs Card */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-teal-400" />
              <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                Recent Platform Activity & Audit
              </h3>
            </div>
            <button
              onClick={() => onNavigateTab('audit-logs')}
              className="text-xs text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1"
            >
              Full Audit Log <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {auditLogs.slice(0, 5).map((log) => (
              <div
                key={log.id}
                className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5 text-xs space-y-1 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-mono text-[10px]">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        log.result === 'success'
                          ? 'bg-emerald-400'
                          : log.result === 'failure'
                          ? 'bg-rose-400'
                          : 'bg-amber-400'
                      }`}
                    />
                    <strong className="text-slate-300">{log.action}</strong>
                    <span className="text-slate-500">by {log.actorName}</span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-500">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-normal">{log.details}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Broadcast Announcement Modal */}
      {showBroadcastModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-xl space-y-4">
            <h3 className="text-sm font-semibold text-slate-100">Broadcast System Alert</h3>
            <p className="text-xs text-slate-400">
              Send an alert to all active mentors and traders within the dashboard.
            </p>
            <form onSubmit={handleBroadcast} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-medium">Alert Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Scheduled Maintenance Notice"
                  value={announcementTitle}
                  onChange={(e) => setAnnouncementTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1 font-medium">Message Body</label>
                <textarea
                  required
                  rows={3}
                  placeholder="e.g. Scheduled demo environment update tonight at 23:00 UTC."
                  value={announcementMsg}
                  onChange={(e) => setAnnouncementMsg(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowBroadcastModal(false)}
                  className="rounded-lg px-3 py-1.5 font-medium text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 font-semibold text-white transition-colors"
                >
                  Send Alert
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
