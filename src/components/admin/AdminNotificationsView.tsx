import React, { useMemo, useState } from 'react';
import { Bell, Check, Search, Send, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatHeartbeatAge } from '../common/dashboardHelpers';
import {
  AdminPageHeader,
  AdminStatusText,
  AdminEmptyState,
  AdminFeedbackBanner,
} from './adminUi';

interface AdminNotificationsViewProps {
  onNavigateTab?: (tab: string) => void;
}

export const AdminNotificationsView: React.FC<AdminNotificationsViewProps> = ({
  onNavigateTab,
}) => {
  const {
    notifications,
    mt5Accounts,
    users,
    tradeMappings,
    markNotificationRead,
    broadcastAnnouncement,
  } = useApp();

  const [filterType, setFilterType] = useState<'all' | 'error' | 'warning' | 'info' | 'success'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastTargetRole, setBroadcastTargetRole] = useState<'all' | 'mentor' | 'trader' | 'admin'>('all');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  // Live operational alerts derived from real platform state (no fabricated entries)
  const derivedAlerts = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      message: string;
      type: 'error' | 'warning' | 'info';
      timestamp: string;
      source: string;
      targetTab: string;
    }> = [];

    const pendingMentors = users.filter((u) => u.role === 'mentor' && u.status === 'pending');
    const pendingTraders = users.filter((u) => u.role === 'trader' && u.status === 'pending');
    const suspendedUsers = users.filter((u) => u.status === 'suspended');

    if (pendingMentors.length > 0) {
      items.push({
        id: 'derived_pending_mentors',
        title: `${pendingMentors.length} Mentor Approval(s) Pending`,
        message: `${pendingMentors.map((m) => m.fullName).slice(0, 3).join(', ')} awaiting Super Admin activation.`,
        type: 'warning',
        timestamp: pendingMentors[0].createdAt,
        source: 'User Approvals',
        targetTab: 'mentors',
      });
    }

    if (pendingTraders.length > 0) {
      items.push({
        id: 'derived_pending_traders',
        title: `${pendingTraders.length} Trader Approval(s) Pending`,
        message: `${pendingTraders.map((t) => t.fullName).slice(0, 3).join(', ')} awaiting follower access review.`,
        type: 'warning',
        timestamp: pendingTraders[0].createdAt,
        source: 'User Approvals',
        targetTab: 'traders',
      });
    }

    if (suspendedUsers.length > 0) {
      items.push({
        id: 'derived_suspended_users',
        title: `${suspendedUsers.length} Suspended Account(s)`,
        message: `Suspended profiles have automated trade copying paused.`,
        type: 'info',
        timestamp: new Date().toISOString(),
        source: 'Account Governance',
        targetTab: 'mentors',
      });
    }

    mt5Accounts.forEach((acc) => {
      if (acc.connectionStatus === 'error') {
        items.push({
          id: `derived_acc_err_${acc.id}`,
          title: `Terminal #${acc.accountNumber} Error`,
          message: acc.errorMessage || 'Authentication or bridge error reported.',
          type: 'error',
          timestamp: acc.lastHeartbeat || new Date().toISOString(),
          source: 'MT5 Terminal',
          targetTab: 'system-health',
        });
      } else if (acc.isStale) {
        items.push({
          id: `derived_acc_stale_${acc.id}`,
          title: `Stale Heartbeat on #${acc.accountNumber}`,
          message: `Last heartbeat ${formatHeartbeatAge(acc.lastHeartbeat)}. Check MT5 terminal connectivity.`,
          type: 'warning',
          timestamp: acc.lastHeartbeat || new Date().toISOString(),
          source: 'Heartbeat Guard',
          targetTab: 'system-health',
        });
      }
    });

    const failedMappings = tradeMappings.filter(
      (m) => m.status !== 'EXECUTED' && m.status !== 'CLOSED' && m.status !== 'PENDING'
    );
    if (failedMappings.length > 0) {
      const latest = failedMappings[0];
      items.push({
        id: 'derived_failed_copies',
        title: `${failedMappings.length} Failed Bridge Instruction(s)`,
        message: `Latest failure on ${latest.symbol} (Parent #${latest.parentTradeTicket}): ${latest.errorMessage || latest.status}`,
        type: 'error',
        timestamp: latest.openTime,
        source: 'Trade Copier',
        targetTab: 'copier-monitoring',
      });
    }

    return items;
  }, [users, mt5Accounts, tradeMappings]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filteredDerived = derivedAlerts.filter((a) => {
    const matchesType = filterType === 'all' || a.type === filterType;
    const matchesSearch =
      a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.message.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesType && matchesSearch;
  });

  const filteredNotifs = notifications.filter((n) => {
    const matchesType = filterType === 'all' || n.type === filterType;
    const matchesSearch =
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.message.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesType && matchesSearch;
  });

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastMsg.trim()) return;
    const titleText = broadcastTitle.trim();
    const res = await broadcastAnnouncement(titleText, broadcastMsg.trim(), broadcastTargetRole);
    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.message || `Failed to publish broadcast "${titleText}".`,
      });
      return;
    }
    setFeedback({
      type: 'success',
      message: res.message || `Broadcast "${titleText}" published to ${broadcastTargetRole}.`,
    });
    setBroadcastTitle('');
    setBroadcastMsg('');
    setShowComposer(false);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Notifications & Alerts"
        meta={`${derivedAlerts.length} Live Signals · ${unreadCount} Unread`}
        subtitle="Real-time operational alerts for offline/stale terminals, pending mentor & trader approvals, failed bridge instructions, and broadcast announcements."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowComposer((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Broadcast Notice</span>
            </button>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => notifications.forEach((n) => markNotificationRead(n.id))}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0 transition-colors"
              >
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span>Mark All as Read</span>
              </button>
            )}
          </div>
        }
      />

      {feedback && (
        <AdminFeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {showComposer && (
        <form onSubmit={handleSendBroadcast} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="font-bold text-slate-900">Publish Platform Notification</h3>
            <button type="button" onClick={() => setShowComposer(false)} className="text-slate-400 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-slate-700 font-semibold mb-1">Notification Title</label>
              <input
                type="text"
                required
                placeholder="e.g. Scheduled Bridge Maintenance"
                value={broadcastTitle}
                onChange={(e) => setBroadcastTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Target Audience</label>
              <select
                value={broadcastTargetRole}
                onChange={(e) => setBroadcastTargetRole(e.target.value as any)}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
              >
                <option value="all">All Platform Users</option>
                <option value="mentor">Mentors Only</option>
                <option value="trader">Traders Only</option>
                <option value="admin">Admins Only</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-slate-700 font-semibold mb-1">Message</label>
            <textarea
              rows={2}
              required
              placeholder="Enter operational notice..."
              value={broadcastMsg}
              onChange={(e) => setBroadcastMsg(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowComposer(false)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 font-semibold text-white"
            >
              Send Broadcast
            </button>
          </div>
        </form>
      )}

      {/* Search & Severity Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search operational alerts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-slate-600 font-medium">Severity:</span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-sky-500"
          >
            <option value="all">All Severities</option>
            <option value="error">Errors</option>
            <option value="warning">Warnings</option>
            <option value="info">Info</option>
            <option value="success">Success</option>
          </select>
        </div>
      </div>

      {/* Live Derived Operational Signals */}
      {filteredDerived.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Active Platform Conditions ({filteredDerived.length})
            </h3>
            <span className="font-mono text-[11px] text-slate-500">Derived from live state</span>
          </div>
          <div className="divide-y divide-slate-100">
            {filteredDerived.map((item) => (
              <div key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <AdminStatusText status={item.type} />
                    <span className="font-semibold text-slate-900">{item.title}</span>
                    <span className="font-mono text-[10px] text-slate-500">{item.source}</span>
                  </div>
                  <p className="text-slate-600">{item.message}</p>
                </div>
                {onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateTab(item.targetTab)}
                    className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0"
                  >
                    Inspect
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recorded Platform Notifications */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            System Notification Stream ({filteredNotifs.length})
          </h3>
        </div>
        {filteredNotifs.length === 0 ? (
          <div className="p-6">
            <AdminEmptyState
              icon={Bell}
              title="No recorded notifications match your filter"
              description="System broadcasts and real-time terminal notices will appear here."
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredNotifs.map((notif) => (
              <div
                key={notif.id}
                onClick={() => markNotificationRead(notif.id)}
                className={`p-4 cursor-pointer transition-colors hover:bg-slate-50 flex items-start justify-between gap-3 text-xs ${
                  notif.read ? 'opacity-70' : 'bg-sky-50/20'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <AdminStatusText status={notif.type} />
                    <span className="font-semibold text-slate-900">{notif.title}</span>
                    {!notif.read && (
                      <span className="h-2 w-2 rounded-full bg-sky-600" title="Unread" />
                    )}
                  </div>
                  <p className="text-slate-600 leading-relaxed">{notif.message}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                  {new Date(notif.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
