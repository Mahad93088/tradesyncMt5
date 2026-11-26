import React, { useMemo, useState } from 'react';
import {
  Users,
  UserCheck,
  CreditCard,
  Server,
  Activity,
  AlertTriangle,
  Clock,
  Plus,
  Bell,
  Key,
  ArrowUpRight,
  ShieldCheck,
  Wifi,
  CheckCircle2,
  UserPlus,
  UserX,
  Layers,
  Eye,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { RegisterMT5AccountModal } from './RegisterMT5AccountModal';
import { countDistinctTraders, formatHeartbeatAge } from '../common/dashboardHelpers';
import { User } from '../../types';
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
    mentorProfiles,
    mt5Accounts,
    subscriptionPlans,
    subscriptions,
    payments,
    parentChildLinks,
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
  const [selectedMentor, setSelectedMentor] = useState<User | null>(null);
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementMsg, setAnnouncementMsg] = useState('');
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);

  // Mentor-Centric KPI Metrics
  const mentors = users.filter((u) => u.role === 'mentor');
  const traders = users.filter((u) => u.role === 'trader');

  const activeMentors = mentors.filter((m) => m.status === 'active').length;
  const suspendedInactiveMentors = mentors.filter((m) => m.status === 'suspended').length;
  const pendingMentors = mentors.filter((m) => m.status === 'pending').length;

  const activeTraders = traders.filter((t) => t.status === 'active').length;
  const pendingTraders = traders.filter((t) => t.status === 'pending').length;
  const totalPendingApprovals = pendingMentors + pendingTraders;

  const activePlansCount = subscriptionPlans.filter(
    (p) => p.isActive !== false && !p.isArchived
  ).length;
  const activeSubscriptions = subscriptions.filter(
    (s) => s.status === 'active' || s.status === 'trial'
  );
  const expiredSubscriptions = subscriptions.filter(
    (s) => s.status === 'expired' || s.status === 'cancelled'
  );

  const connectedTerminals = mt5Accounts.filter((a) => a.connectionStatus === 'connected').length;
  const staleTerminals = isCloudMode
    ? cloudBridgeTelemetry.staleTerminalsCount || mt5Accounts.filter((a) => a.isStale).length
    : mt5Accounts.filter((a) => a.isStale).length;
  const disconnectedTerminals = mt5Accounts.filter((a) => a.connectionStatus === 'disconnected').length;
  const errorTerminals = mt5Accounts.filter((a) => a.connectionStatus === 'error').length;

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

  // Derived Growth Series (grouped by month from actual user records)
  const userGrowthPoints = useMemo(() => {
    const buckets = new Map<string, { label: string; primary: number; secondary: number; sortKey: number }>();
    users.forEach((u) => {
      const ts = Date.parse(u.createdAt);
      if (!Number.isFinite(ts)) return;
      const d = new Date(ts);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
      const existing = buckets.get(key) || {
        label,
        primary: 0,
        secondary: 0,
        sortKey: d.getUTCFullYear() * 100 + d.getUTCMonth(),
      };
      if (u.role === 'mentor') existing.primary += 1;
      if (u.role === 'trader') existing.secondary += 1;
      buckets.set(key, existing);
    });
    return Array.from(buckets.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(-6)
      .map(({ label, primary, secondary }) => ({ label, primary, secondary }));
  }, [users]);

  const subscriptionGrowthPoints = useMemo(() => {
    const buckets = new Map<string, { label: string; primary: number; secondary: number; sortKey: number }>();
    subscriptions.forEach((s) => {
      const ts = Date.parse(s.startedAt);
      if (!Number.isFinite(ts)) return;
      const d = new Date(ts);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
      const existing = buckets.get(key) || {
        label,
        primary: 0,
        secondary: 0,
        sortKey: d.getUTCFullYear() * 100 + d.getUTCMonth(),
      };
      if (s.status === 'active' || s.status === 'trial') existing.primary += 1;
      else existing.secondary += 1;
      buckets.set(key, existing);
    });
    return Array.from(buckets.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(-6)
      .map(({ label, primary, secondary }) => ({ label, primary, secondary }));
  }, [subscriptions]);

  const monthlyRevenuePoints = useMemo(() => {
    const buckets = new Map<string, { label: string; primary: number; sortKey: number }>();
    const settled = payments.filter((p) => p.status === 'succeeded');
    if (settled.length > 0) {
      settled.forEach((p) => {
        const ts = Date.parse(p.paidAt || p.createdAt);
        if (!Number.isFinite(ts)) return;
        const d = new Date(ts);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
        const existing = buckets.get(key) || {
          label,
          primary: 0,
          sortKey: d.getUTCFullYear() * 100 + d.getUTCMonth(),
        };
        existing.primary += Math.round(p.amountUsd);
        buckets.set(key, existing);
      });
    } else {
      subscriptions
        .filter((s) => s.status === 'active' || s.status === 'expired')
        .forEach((s) => {
          const ts = Date.parse(s.startedAt);
          if (!Number.isFinite(ts)) return;
          const d = new Date(ts);
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
          const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
          const normalized = Math.round(s.billingCycle === 'yearly' ? s.price / 12 : s.price);
          const existing = buckets.get(key) || {
            label,
            primary: 0,
            sortKey: d.getUTCFullYear() * 100 + d.getUTCMonth(),
          };
          existing.primary += normalized;
          buckets.set(key, existing);
        });
    }
    return Array.from(buckets.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(-6)
      .map(({ label, primary }) => ({ label, primary }));
  }, [payments, subscriptions]);

  const mentorRows = useMemo(() => {
    return [...mentors]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((mentor) => {
        const links = parentChildLinks.filter((l) => l.mentorId === mentor.id);
        const sub = subscriptions.find((s) => s.mentorId === mentor.id || s.userId === mentor.id);
        const profile = mentorProfiles.find((p) => p.userId === mentor.id);
        return {
          mentor,
          profile,
          assignedCount: countDistinctTraders(links, []),
          activeCount: countDistinctTraders(links, ['active']),
          sub,
        };
      });
  }, [mentors, parentChildLinks, subscriptions, mentorProfiles]);

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
        meta={isCloudMode ? 'Cloud Demo Bridge · Mentor-Centric Administration' : 'Demo Sandbox Mode'}
        subtitle="Super Admin command center for mentor approvals, trader allocations, subscription plans, and MT5 demo bridge health."
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
              <span>Add Mentor</span>
            </button>
            {onOpenAddTrader && (
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
                <strong>Cloud Demo Bridge Active:</strong> Displaying live Supabase mentor cohorts, assigned traders, subscriptions, and MT5 terminal telemetry. Live real-money accounts remain blocked.
              </>
            ) : (
              <>
                <strong>Demo Sandbox Mode:</strong> Displaying interactive simulated mentors, traders, subscriptions, and MT5 terminals. Switch to Cloud Auth for live Supabase telemetry.
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
              <strong>{totalPendingApprovals} registration(s) awaiting Super Admin approval</strong> ({pendingMentors} mentor, {pendingTraders} trader).
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

      {/* Mentor-Centric Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <AdminStatCard
          title="Total Mentors"
          value={mentors.length}
          subtitle={`${activeMentors} active · ${pendingMentors} pending`}
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
          title="Suspended / Inactive Mentors"
          value={suspendedInactiveMentors}
          subtitle="Paused from trade broadcasting"
          icon={UserX}
          tone={suspendedInactiveMentors > 0 ? 'amber' : 'neutral'}
          onClick={() => onNavigateTab('mentors')}
        />
        <AdminStatCard
          title="Pending Mentor Approvals"
          value={pendingMentors}
          subtitle={`${pendingTraders} pending trader approvals`}
          icon={Clock}
          tone={pendingMentors > 0 ? 'amber' : 'neutral'}
          onClick={() => onNavigateTab('mentors')}
        />
        <AdminStatCard
          title="Total Traders (All Mentors)"
          value={traders.length}
          subtitle={`${countDistinctTraders(parentChildLinks, [])} assigned · ${parentChildLinks.length} link(s)`}
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
          title="Active Subscription Plans"
          value={activePlansCount}
          subtitle={`${subscriptionPlans.length} total catalog plans`}
          icon={Layers}
          tone="blue"
          onClick={() => onNavigateTab('plans')}
        />
        <AdminStatCard
          title="Active & Expired Subscriptions"
          value={`${activeSubscriptions.length} / ${expiredSubscriptions.length}`}
          subtitle={`${activeSubscriptions.length} active · ${expiredSubscriptions.length} expired`}
          icon={CreditCard}
          tone={expiredSubscriptions.length > 0 ? 'amber' : 'emerald'}
          onClick={() => onNavigateTab('subscriptions')}
        />
      </div>

      {/* Primary Centerpiece: Mentor Overview Table (click any row to inspect mentor's assigned traders) */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3.5 border-b border-slate-200 bg-slate-50/70">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Mentor Overview &amp; Trader Allocations</h2>
            <p className="text-[11px] text-slate-500">
              Select a mentor row to inspect their assigned traders, subscription plan status, and parent terminal telemetry.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('mentors')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 whitespace-nowrap shrink-0"
          >
            <span>Open Mentor Management</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {mentorRows.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-xs text-slate-500">No mentors have been provisioned or approved yet.</p>
            <button
              type="button"
              onClick={onOpenCreateMentor}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add First Mentor</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Mentor Name &amp; Email</th>
                  <th className="px-4 py-3">Account Status</th>
                  <th className="px-4 py-3 text-right">Assigned Traders</th>
                  <th className="px-4 py-3 text-right">Active Traders</th>
                  <th className="px-4 py-3">Subscription Plan</th>
                  <th className="px-4 py-3">Plan Status</th>
                  <th className="px-4 py-3">Registered</th>
                  <th className="px-4 py-3 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mentorRows.map(({ mentor, assignedCount, activeCount, sub }) => (
                  <tr
                    key={mentor.id}
                    onClick={() => setSelectedMentor(mentor)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{mentor.fullName}</div>
                      <div className="font-mono text-[11px] text-slate-500">{mentor.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <AdminStatusText status={mentor.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {assignedCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700 tabular-nums">
                      {activeCount}
                    </td>
                    <td className="px-4 py-3 text-slate-800 font-medium">
                      {sub ? sub.planName : 'Unassigned'}
                    </td>
                    <td className="px-4 py-3">
                      {sub ? (
                        <AdminStatusText status={sub.status} />
                      ) : (
                        <span className="text-[11px] text-slate-400">No subscription</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600 tabular-nums">
                      {new Date(mentor.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedMentor(mentor);
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <Eye className="h-3 w-3" />
                        <span>Traders</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Platform Cohort & Billing Growth Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <AdminSparkBarChart
          title="Mentor & Trader Onboarding"
          subtitle="Registrations grouped by month"
          points={userGrowthPoints}
          primaryLabel="Mentors"
          secondaryLabel="Traders"
        />
        <AdminSparkBarChart
          title="Subscription Records"
          subtitle="Active vs non-active subscriptions"
          points={subscriptionGrowthPoints}
          primaryLabel="Active"
          secondaryLabel="Other"
        />
        <AdminSparkBarChart
          title="Platform Billing"
          subtitle={payments.some((p) => p.status === 'succeeded') ? 'Verified settled payments' : 'Normalized recurring billing'}
          points={monthlyRevenuePoints}
          primaryLabel="Revenue ($)"
          valuePrefix="$"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AdminDistributionChart
          title="MT5 Terminal Connectivity"
          subtitle={`${mt5Accounts.length} total demo accounts (${connectedTerminals} active)`}
          items={[
            { label: 'Connected (EA Active)', value: connectedTerminals, colorClass: 'bg-emerald-600' },
            { label: 'Stale Heartbeat', value: staleTerminals, colorClass: 'bg-amber-500' },
            { label: 'Disconnected / Awaiting EA', value: disconnectedTerminals, colorClass: 'bg-slate-400' },
            { label: 'Connection / Auth Errors', value: errorTerminals, colorClass: 'bg-rose-600' },
          ]}
        />
        <AdminDistributionChart
          title="Copier Instruction Health"
          subtitle={`${tradeMappings.length} total mapped instructions`}
          items={[
            { label: 'Executed & Closed Copies', value: executedInstructions, colorClass: 'bg-emerald-600' },
            { label: 'Pending Queue Instructions', value: pendingInstructions, colorClass: 'bg-sky-600' },
            { label: 'Failed / Risk Rejected', value: failedInstructions, colorClass: 'bg-rose-600' },
          ]}
        />
      </div>

      {/* Recent Platform Activity Tabs */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50/70">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Operational Activity Feeds</h2>
            <p className="text-[11px] text-slate-500">Live operational records across traders, MT5 terminals, admin actions, and system alerts.</p>
          </div>
          <div className="flex items-center flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {([
              { id: 'mentors', label: 'Mentors' },
              { id: 'traders', label: 'Traders' },
              { id: 'connections', label: 'Terminals' },
              { id: 'admin-actions', label: 'Admin Audit' },
              { id: 'alerts', label: 'Alerts' },
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
            mentorRows.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">No mentor profiles registered yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="pb-2.5 pr-4">Mentor</th>
                      <th className="pb-2.5 pr-4">Email</th>
                      <th className="pb-2.5 pr-4">Status</th>
                      <th className="pb-2.5 pr-4">Assigned Traders</th>
                      <th className="pb-2.5 text-right">View</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mentorRows.slice(0, 6).map(({ mentor, assignedCount, activeCount }) => (
                      <tr key={mentor.id} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-4 font-semibold text-slate-900">{mentor.fullName}</td>
                        <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-600">{mentor.email}</td>
                        <td className="py-2.5 pr-4"><AdminStatusText status={mentor.status} /></td>
                        <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-700 tabular-nums">
                          {activeCount} active / {assignedCount} assigned
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedMentor(mentor)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900"
                          >
                            Details <ArrowUpRight className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {activityTab === 'traders' && (
            recentTraders.length === 0 ? (
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
            )
          )}

          {activityTab === 'connections' && (
            recentConnections.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">No MT5 terminals registered yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="pb-2.5 pr-4">Account #</th>
                      <th className="pb-2.5 pr-4">Role</th>
                      <th className="pb-2.5 pr-4">Broker &amp; Symbol</th>
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
                        <td className="py-2.5 pr-4 text-slate-700">
                          {acc.broker} · <span className="font-mono text-[11px] text-slate-600">{acc.tradingSymbol || 'Default Gold'}</span>
                        </td>
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
            )
          )}

          {activityTab === 'admin-actions' && (
            recentAdminActions.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                {syncLogs.length > 0
                  ? `${syncLogs.length} bridge synchronization event(s) available in System Audit Logs.`
                  : 'No admin audit events recorded yet.'}
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
            )
          )}

          {activityTab === 'alerts' && (
            systemAlerts.length === 0 ? (
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
            )
          )}
        </div>
      </div>

      {/* Mentor Details Modal (shows ONLY this mentor's assigned traders) */}
      {selectedMentor && (() => {
        const mentorLinks = parentChildLinks.filter((l) => l.mentorId === selectedMentor.id);
        const mentorSub = subscriptions.find((s) => s.mentorId === selectedMentor.id || s.userId === selectedMentor.id);
        const parentAccount = mt5Accounts.find((a) => a.userId === selectedMentor.id && a.accountRole === 'parent');
        const profile = mentorProfiles.find((p) => p.userId === selectedMentor.id);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5 my-auto">
              <div className="flex items-start justify-between border-b border-slate-200 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">{selectedMentor.fullName}</h3>
                  <p className="text-xs text-slate-500 font-mono">{selectedMentor.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedMentor(null)}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                  <span className="text-[10px] uppercase font-mono text-slate-500 block">Status</span>
                  <div className="mt-1"><AdminStatusText status={selectedMentor.status} /></div>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                  <span className="text-[10px] uppercase font-mono text-slate-500 block">Plan</span>
                  <span className="font-semibold text-slate-900 mt-1 block">{mentorSub ? mentorSub.planName : 'None'}</span>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                  <span className="text-[10px] uppercase font-mono text-slate-500 block">Strategy</span>
                  <span className="font-semibold text-slate-900 mt-1 block truncate">{profile?.strategyName || 'Standard'}</span>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                  <span className="text-[10px] uppercase font-mono text-slate-500 block">Parent MT5</span>
                  <span className="font-mono font-semibold text-slate-900 mt-1 block">
                    {parentAccount ? `#${parentAccount.accountNumber}` : 'Unbound'}
                  </span>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900">
                    Assigned Traders for {selectedMentor.fullName} ({countDistinctTraders(mentorLinks, [])} traders · {mentorLinks.length} links)
                  </h4>
                  <span className="text-[11px] font-mono text-slate-500">
                    {countDistinctTraders(mentorLinks, ['active'])} active
                  </span>
                </div>

                {mentorLinks.length === 0 ? (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-slate-500">
                    No traders assigned to this mentor yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-semibold text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Trader</th>
                          <th className="px-3 py-2">Child MT5</th>
                          <th className="px-3 py-2">Link Status</th>
                          <th className="px-3 py-2">Membership</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {mentorLinks.map((link) => {
                          const traderUser = users.find((u) => u.id === link.traderId);
                          const childAcc = mt5Accounts.find((a) => a.id === link.childAccountId);
                          return (
                            <tr key={link.id}>
                              <td className="px-3 py-2">
                                <div className="font-semibold text-slate-900">{link.traderName}</div>
                                <div className="text-[11px] font-mono text-slate-500">{traderUser?.email || link.traderId}</div>
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-700">
                                {childAcc ? `#${childAcc.accountNumber} (${childAcc.broker})` : 'No MT5 bound'}
                              </td>
                              <td className="px-3 py-2 space-y-1">
                                <div className="flex items-center gap-1 flex-wrap">
                                  <AdminStatusText status={link.status} />
                                  {link.balancePauseActive && <AdminStatusText status="balance_paused" />}
                                </div>
                                {(link.suspensionReason || link.pauseReason) && (
                                  <p className="text-[10px] text-slate-500 max-w-[200px] truncate" title={link.suspensionReason || link.pauseReason || ''}>
                                    {link.suspensionReason || link.pauseReason}
                                  </p>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                                {link.membershipStatus || 'active'}
                                {link.membershipPriceUsd ? ` · $${link.membershipPriceUsd}` : ''}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMentor(null);
                    onNavigateTab('mentors');
                  }}
                  className="text-xs font-semibold text-sky-700 hover:text-sky-900"
                >
                  Open in Mentor Management &rarr;
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMentor(null)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
