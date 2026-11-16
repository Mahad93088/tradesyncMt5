import React, { useMemo, useState } from 'react';
import {
  Users,
  UserCheck,
  CreditCard,
  Server,
  Activity,
  AlertTriangle,
  Link2,
  DollarSign,
  Clock,
  Plus,
  Bell,
  Key,
  ArrowUpRight,
  ShieldCheck,
  Wifi,
  CheckCircle2,
  UserPlus,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { RegisterMT5AccountModal } from './RegisterMT5AccountModal';
import { formatHeartbeatAge } from '../common/dashboardHelpers';
import {
  AdminPageHeader,
  AdminStatCard,
  AdminStatusText,
  AdminSparkBarChart,
  AdminDistributionChart,
} from './adminUi';

interface AdminDashboardProps {
  onNavigateTab: (tab: string) => void;
  onOpenCreateMentor: () => void;
  onOpenAddTrader?: () => void;
  onOpenRegisterAccount?: () => void;
}

type ActivityFeedTab = 'mentors' | 'traders' | 'connections' | 'admin-actions' | 'alerts';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onNavigateTab,
  onOpenCreateMentor,
  onOpenAddTrader,
  onOpenRegisterAccount,
}) => {
  const { isCloudMode } = useAuth();
  const {
    users,
    mt5Accounts,
    subscriptions,
    parentChildLinks,
    trades,
    tradeMappings,
    syncLogs,
    auditLogs,
    notifications,
    systemHealth,
    cloudBridgeTelemetry,
    broadcastAnnouncement,
    refreshCloudData,
  } = useApp();

  const [activityTab, setActivityTab] = useState<ActivityFeedTab>('mentors');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementMsg, setAnnouncementMsg] = useState('');
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);

  // Core metrics
  const mentors = users.filter((u) => u.role === 'mentor');
  const traders = users.filter((u) => u.role === 'trader');
  const activeMentors = mentors.filter((m) => m.status === 'active').length;
  const pendingMentors = mentors.filter((m) => m.status === 'pending').length;
  const activeTraders = traders.filter((t) => t.status === 'active').length;
  const pendingTraders = traders.filter((t) => t.status === 'pending').length;
  const totalPendingApprovals = pendingMentors + pendingTraders;

  const connectedTerminals = mt5Accounts.filter((a) => a.connectionStatus === 'connected').length;
  const staleTerminals = isCloudMode
    ? cloudBridgeTelemetry.staleTerminalsCount || mt5Accounts.filter((a) => a.isStale).length
    : mt5Accounts.filter((a) => a.isStale).length;
  const disconnectedTerminals = mt5Accounts.filter((a) => a.connectionStatus === 'disconnected').length;
  const errorTerminals = mt5Accounts.filter((a) => a.connectionStatus === 'error').length;

  const activeCopyAssignments = parentChildLinks.filter((l) => l.status === 'active').length;

  const activeSubscriptions = subscriptions.filter((s) => s.status === 'active');
  const trialSubscriptions = subscriptions.filter((s) => s.status === 'trial');
  const demoMrr = activeSubscriptions.reduce((sum, sub) => {
    return sum + (sub.billingCycle === 'yearly' ? sub.price / 12 : sub.price);
  }, 0);

  const executedInstructions = tradeMappings.filter(
    (m) => m.status === 'EXECUTED' || m.status === 'CLOSED'
  ).length;
  const pendingInstructions = tradeMappings.filter((m) => m.status === 'PENDING').length;
  const failedInstructions = tradeMappings.filter(
    (m) => m.status !== 'EXECUTED' && m.status !== 'CLOSED' && m.status !== 'PENDING'
  ).length;

  const effectiveLatencyMs = isCloudMode
    ? cloudBridgeTelemetry.averageCopyLatencyMs || systemHealth.averageCopyLatencyMs
    : systemHealth.averageCopyLatencyMs;

  // Derived Growth Series (grouped by month from actual user records, never fabricated)
  const userGrowthPoints = useMemo(() => {
    const buckets = new Map<string, { label: string; primary: number; secondary: number; sortKey: number }>();
    const addUser = (u: typeof users[number]) => {
      const ts = Date.parse(u.createdAt);
      if (!Number.isFinite(ts)) return;
      const d = new Date(ts);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
      const existing = buckets.get(key) || { label, primary: 0, secondary: 0, sortKey: d.getUTCFullYear() * 100 + d.getUTCMonth() };
      if (u.role === 'mentor') existing.primary += 1;
      if (u.role === 'trader') existing.secondary += 1;
      buckets.set(key, existing);
    };
    users.forEach(addUser);
    return Array.from(buckets.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(-6)
      .map(({ label, primary, secondary }) => ({ label, primary, secondary }));
  }, [users]);

  // Derived Subscription & Revenue Series (Demo Mode only; Cloud Mode explicitly Not Configured)
  const subscriptionGrowthPoints = useMemo(() => {
    if (isCloudMode) return [];
    const buckets = new Map<string, { label: string; primary: number; secondary: number; sortKey: number }>();
    subscriptions.forEach((s) => {
      const ts = Date.parse(s.startedAt);
      if (!Number.isFinite(ts)) return;
      const d = new Date(ts);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
      const existing = buckets.get(key) || { label, primary: 0, secondary: 0, sortKey: d.getUTCFullYear() * 100 + d.getUTCMonth() };
      if (s.status === 'active') existing.primary += 1;
      else existing.secondary += 1;
      buckets.set(key, existing);
    });
    return Array.from(buckets.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(-6)
      .map(({ label, primary, secondary }) => ({ label, primary, secondary }));
  }, [isCloudMode, subscriptions]);

  const monthlyRevenuePoints = useMemo(() => {
    if (isCloudMode) return [];
    const buckets = new Map<string, { label: string; primary: number; sortKey: number }>();
    subscriptions
      .filter((s) => s.status === 'active' || s.status === 'expired')
      .forEach((s) => {
        const ts = Date.parse(s.startedAt);
        if (!Number.isFinite(ts)) return;
        const d = new Date(ts);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
        const normalized = Math.round(s.billingCycle === 'yearly' ? s.price / 12 : s.price);
        const existing = buckets.get(key) || { label, primary: 0, sortKey: d.getUTCFullYear() * 100 + d.getUTCMonth() };
        existing.primary += normalized;
        buckets.set(key, existing);
      });
    return Array.from(buckets.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(-6)
      .map(({ label, primary }) => ({ label, primary }));
  }, [isCloudMode, subscriptions]);

  const recentMentors = [...mentors]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 6);
  const recentTraders = [...traders]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 6);
  const recentConnections = [...mt5Accounts]
    .sort((a, b) => Date.parse(b.lastHeartbeat || '') - Date.parse(a.lastHeartbeat || ''))
    .slice(0, 6);
  const recentAdminActions = auditLogs.slice(0, 6);
  const systemAlerts = notifications.filter((n) => n.type === 'error' || n.type === 'warning').slice(0, 6);

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!announcementTitle.trim() || !announcementMsg.trim()) return;
    broadcastAnnouncement(announcementTitle.trim(), announcementMsg.trim(), 'all');
    setAnnouncementTitle('');
    setAnnouncementMsg('');
    setShowBroadcastModal(false);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Platform Overview"
        meta={isCloudMode ? 'Cloud Demo Bridge · Live Telemetry' : 'Demo Sandbox Mode'}
        subtitle="Executive command center for TradeSync MT5 mentor approvals, follower terminals, copier execution health, and billing readiness."
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                if (onOpenRegisterAccount) onOpenRegisterAccount();
                else setShowRegisterModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0 transition-colors"
            >
              <Key className="h-3.5 w-3.5 text-slate-500" />
              <span>Register MT5</span>
            </button>
            <button
              type="button"
              onClick={() => setShowBroadcastModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0 transition-colors"
            >
              <Bell className="h-3.5 w-3.5 text-slate-500" />
              <span>Broadcast Alert</span>
            </button>
            <button
              type="button"
              onClick={onOpenCreateMentor}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{isCloudMode ? 'Approve / Provision Mentor' : 'Provision Mentor'}</span>
            </button>
            {!isCloudMode && onOpenAddTrader && (
              <button
                type="button"
                onClick={onOpenAddTrader}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Add Trader</span>
              </button>
            )}
          </>
        }
      />

      {/* Environment & Demo Safety Notice */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-slate-700">
          <ShieldCheck className={`h-4 w-4 shrink-0 ${isCloudMode ? 'text-emerald-600' : 'text-sky-600'}`} />
          <span>
            {isCloudMode ? (
              <>
                <strong>Cloud Demo Bridge Active:</strong> Displaying live Supabase profiles, MT5 terminals, copy assignments, and bridge audit telemetry. Real-money accounts remain blocked by EA Demo safeguards.
              </>
            ) : (
              <>
                <strong>Demo Sandbox Mode:</strong> Displaying interactive simulated mentors, traders, MT5 accounts, and sandbox billing metrics. Switch to Cloud Auth for live Supabase telemetry.
              </>
            )}
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap shrink-0 tabular-nums">
          {isCloudMode
            ? cloudBridgeTelemetry.bridgePersistenceReady
              ? `Bridge Verified · ${effectiveLatencyMs}ms avg`
              : 'Bridge Verification Pending'
            : `Simulated Engine · ${effectiveLatencyMs}ms`}
        </span>
      </div>

      {/* Pending Approvals Callout */}
      {totalPendingApprovals > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-950">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              <strong>{totalPendingApprovals} registration(s) awaiting Super Admin approval</strong> ({pendingMentors} mentor, {pendingTraders} trader). Review pending profiles to grant platform access.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {pendingMentors > 0 && (
              <button
                type="button"
                onClick={() => onNavigateTab('mentors')}
                className="rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold px-3 py-1.5 text-xs whitespace-nowrap transition-colors"
              >
                Review Mentors
              </button>
            )}
            {pendingTraders > 0 && (
              <button
                type="button"
                onClick={() => onNavigateTab('traders')}
                className="rounded-lg border border-amber-300 bg-white hover:bg-amber-100 text-amber-900 font-semibold px-3 py-1.5 text-xs whitespace-nowrap transition-colors"
              >
                Review Traders
              </button>
            )}
          </div>
        </div>
      )}

      {/* 10 Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <AdminStatCard
          title="Total Mentors"
          value={mentors.length}
          subtitle={`${pendingMentors} pending review`}
          icon={Users}
          tone="blue"
          onClick={() => onNavigateTab('mentors')}
        />
        <AdminStatCard
          title="Active Mentors"
          value={activeMentors}
          subtitle={mentors.length > 0 ? `${Math.round((activeMentors / mentors.length) * 100)}% verified` : '0 registered'}
          icon={CheckCircle2}
          tone="emerald"
          onClick={() => onNavigateTab('mentors')}
        />
        <AdminStatCard
          title="Total Traders"
          value={traders.length}
          subtitle={`${pendingTraders} pending review`}
          icon={UserCheck}
          tone="blue"
          onClick={() => onNavigateTab('traders')}
        />
        <AdminStatCard
          title="Active Traders"
          value={activeTraders}
          subtitle={traders.length > 0 ? `${Math.round((activeTraders / traders.length) * 100)}% active` : '0 registered'}
          icon={Activity}
          tone="emerald"
          onClick={() => onNavigateTab('traders')}
        />
        <AdminStatCard
          title="Total MT5 Accounts"
          value={mt5Accounts.length}
          subtitle={`${mt5Accounts.filter((a) => a.accountRole === 'parent').length} parent · ${mt5Accounts.filter((a) => a.accountRole === 'child').length} child`}
          icon={Server}
          tone="neutral"
          onClick={() => onNavigateTab('mt5-accounts')}
        />
        <AdminStatCard
          title="Connected Terminals"
          value={connectedTerminals}
          subtitle={staleTerminals > 0 ? `${staleTerminals} stale · ${disconnectedTerminals + errorTerminals} offline` : `${disconnectedTerminals + errorTerminals} offline`}
          icon={Wifi}
          tone={errorTerminals > 0 || staleTerminals > 0 ? 'amber' : 'emerald'}
          onClick={() => onNavigateTab('system-health')}
        />
        <AdminStatCard
          title="Active Copy Assignments"
          value={activeCopyAssignments}
          subtitle={`${parentChildLinks.length} total mappings`}
          icon={Link2}
          tone="blue"
          onClick={() => onNavigateTab('copier-monitoring')}
        />
        <AdminStatCard
          title="Active Subscriptions"
          value={isCloudMode ? 'Not Configured' : activeSubscriptions.length}
          subtitle={isCloudMode ? 'Billing tables pending' : `${trialSubscriptions.length} trial · ${subscriptions.length} total`}
          icon={CreditCard}
          tone={isCloudMode ? 'amber' : 'emerald'}
          onClick={() => onNavigateTab('subscriptions')}
        />
        <AdminStatCard
          title="Monthly Recurring Rev"
          value={isCloudMode ? 'Not Configured' : `$${Math.round(demoMrr).toLocaleString()}`}
          subtitle={isCloudMode ? 'Payments schema pending' : 'Demo sandbox MRR'}
          icon={DollarSign}
          tone={isCloudMode ? 'amber' : 'emerald'}
          onClick={() => onNavigateTab('payments-revenue')}
        />
        <AdminStatCard
          title="Pending Approvals"
          value={totalPendingApprovals}
          subtitle={`${pendingMentors} mentors · ${pendingTraders} traders`}
          icon={Clock}
          tone={totalPendingApprovals > 0 ? 'amber' : 'neutral'}
          onClick={() => onNavigateTab(pendingMentors > 0 ? 'mentors' : 'traders')}
        />
      </div>

      {/* 5 Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <AdminSparkBarChart
          title="Mentor & Trader Growth"
          subtitle="Registrations grouped by onboarding month"
          points={userGrowthPoints}
          primaryLabel="Mentors"
          secondaryLabel="Traders"
        />
        <AdminSparkBarChart
          title="Subscription Growth"
          subtitle="Active vs non-active subscription records"
          points={subscriptionGrowthPoints}
          primaryLabel="Active"
          secondaryLabel="Other"
          notConfiguredText={
            isCloudMode
              ? 'Subscription growth chart requires subscription_plans and subscriptions tables in Supabase.'
              : undefined
          }
        />
        <AdminSparkBarChart
          title="Monthly Revenue"
          subtitle="Normalized monthly recurring billing"
          points={monthlyRevenuePoints}
          primaryLabel="MRR ($)"
          valuePrefix="$"
          notConfiguredText={
            isCloudMode
              ? 'Revenue analytics require live payments and invoices tables. No synthetic MRR is shown in Cloud Mode.'
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AdminDistributionChart
          title="Account Connection Statistics"
          subtitle="Live MT5 terminal telemetry & heartbeat state"
          items={[
            { label: 'Connected (EA Active)', value: connectedTerminals, colorClass: 'bg-emerald-600' },
            { label: 'Stale Heartbeat', value: staleTerminals, colorClass: 'bg-amber-500' },
            { label: 'Disconnected / Awaiting EA', value: disconnectedTerminals, colorClass: 'bg-slate-400' },
            { label: 'Connection / Auth Errors', value: errorTerminals, colorClass: 'bg-rose-600' },
          ]}
        />
        <AdminDistributionChart
          title="Copier Activity Overview"
          subtitle={`${isCloudMode ? tradeMappings.length : trades.length} total tracked instructions`}
          items={[
            { label: 'Executed & Closed Copies', value: executedInstructions, colorClass: 'bg-emerald-600' },
            { label: 'Pending Queue Instructions', value: pendingInstructions, colorClass: 'bg-sky-600' },
            { label: 'Failed / Risk Rejected', value: failedInstructions, colorClass: 'bg-rose-600' },
          ]}
        />
      </div>

      {/* Recent Activity Feeds */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50/70">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Recent Platform Activity</h2>
            <p className="text-[11px] text-slate-500">Real-time operational feeds across users, terminals, admin events, and alerts.</p>
          </div>
          <div className="flex items-center flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {([
              { id: 'mentors', label: 'Recent Mentors' },
              { id: 'traders', label: 'Recent Traders' },
              { id: 'connections', label: 'Terminal Connections' },
              { id: 'admin-actions', label: 'Admin Actions' },
              { id: 'alerts', label: 'System Alerts' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActivityTab(tab.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                  activityTab === tab.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4">
          {activityTab === 'mentors' && (
            <div className="space-y-2">
              {recentMentors.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">No mentor profiles registered yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="pb-2.5 pr-4">Mentor</th>
                        <th className="pb-2.5 pr-4">Email</th>
                        <th className="pb-2.5 pr-4">Status</th>
                        <th className="pb-2.5 pr-4">Joined</th>
                        <th className="pb-2.5 text-right">View</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {recentMentors.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="py-2.5 pr-4 font-semibold text-slate-900">{m.fullName}</td>
                          <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-600">{m.email}</td>
                          <td className="py-2.5 pr-4"><AdminStatusText status={m.status} /></td>
                          <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500 tabular-nums">
                            {new Date(m.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => onNavigateTab('mentors')}
                              className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900"
                            >
                              Manage <ArrowUpRight className="h-3 w-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activityTab === 'traders' && (
            <div className="space-y-2">
              {recentTraders.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">No follower traders registered yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="pb-2.5 pr-4">Trader</th>
                        <th className="pb-2.5 pr-4">Email</th>
                        <th className="pb-2.5 pr-4">Status</th>
                        <th className="pb-2.5 pr-4">Joined</th>
                        <th className="pb-2.5 text-right">View</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {recentTraders.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50">
                          <td className="py-2.5 pr-4 font-semibold text-slate-900">{t.fullName}</td>
                          <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-600">{t.email}</td>
                          <td className="py-2.5 pr-4"><AdminStatusText status={t.status} /></td>
                          <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500 tabular-nums">
                            {new Date(t.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => onNavigateTab('traders')}
                              className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900"
                            >
                              Manage <ArrowUpRight className="h-3 w-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activityTab === 'connections' && (
            <div className="space-y-2">
              {recentConnections.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">No MT5 terminals registered yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="pb-2.5 pr-4">Account #</th>
                        <th className="pb-2.5 pr-4">Role</th>
                        <th className="pb-2.5 pr-4">Broker & Server</th>
                        <th className="pb-2.5 pr-4">Status</th>
                        <th className="pb-2.5 pr-4">Last Heartbeat</th>
                        <th className="pb-2.5 text-right">Inspect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {recentConnections.map((acc) => (
                        <tr key={acc.id} className="hover:bg-slate-50">
                          <td className="py-2.5 pr-4 font-mono font-semibold text-slate-900 tabular-nums">#{acc.accountNumber}</td>
                          <td className="py-2.5 pr-4 font-mono text-[11px] uppercase text-slate-600">{acc.accountRole}</td>
                          <td className="py-2.5 pr-4 text-slate-700">{acc.broker} · <span className="font-mono text-[11px] text-slate-500">{acc.server}</span></td>
                          <td className="py-2.5 pr-4"><AdminStatusText status={acc.isStale ? 'stale' : acc.connectionStatus} /></td>
                          <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-600 tabular-nums">{formatHeartbeatAge(acc.lastHeartbeat)}</td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => onNavigateTab('mt5-accounts')}
                              className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900"
                            >
                              Open <ArrowUpRight className="h-3 w-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activityTab === 'admin-actions' && (
            <div className="space-y-2">
              {recentAdminActions.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500">
                  {syncLogs.length > 0
                    ? `${syncLogs.length} bridge synchronization event(s) available in System Audit Logs.`
                    : 'No admin audit events recorded in this session.'}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {recentAdminActions.map((log) => (
                    <div key={log.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold text-slate-900">{log.action}</span>
                          <AdminStatusText status={log.result} />
                          <span className="text-[11px] text-slate-500">by {log.actorName}</span>
                        </div>
                        <p className="text-slate-600 truncate">{log.details}</p>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activityTab === 'alerts' && (
            <div className="space-y-2">
              {systemAlerts.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">No active error or warning alerts flagged.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {systemAlerts.map((n) => (
                    <div key={n.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <AdminStatusText status={n.type} />
                          <span className="font-semibold text-slate-900">{n.title}</span>
                        </div>
                        <p className="text-slate-600">{n.message}</p>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                        {new Date(n.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Broadcast Announcement Modal */}
      {showBroadcastModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Broadcast System Alert</h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Send an operational notification to all active mentors and traders.
              </p>
            </div>
            <form onSubmit={handleBroadcast} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 mb-1 font-semibold">Alert Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Scheduled Maintenance Notice"
                  value={announcementTitle}
                  onChange={(e) => setAnnouncementTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-700 mb-1 font-semibold">Message Body</label>
                <textarea
                  required
                  rows={3}
                  placeholder="e.g. Scheduled demo bridge check tonight at 23:00 UTC."
                  value={announcementMsg}
                  onChange={(e) => setAnnouncementMsg(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowBroadcastModal(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 font-semibold text-white transition-colors"
                >
                  Send Alert
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Authoritative MT5 Account Registration Modal */}
      <RegisterMT5AccountModal
        isOpen={showRegisterModal}
        onClose={() => setShowRegisterModal(false)}
        defaultRole="parent"
        onSuccess={() => {
          void refreshCloudData();
        }}
      />
    </div>
  );
};
