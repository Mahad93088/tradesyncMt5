import React, { useState } from 'react';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Info,
  Check,
  Trash2,
  Filter,
  Search,
  Clock
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const NotificationsView: React.FC = () => {
  const { currentUser, notifications, markNotificationRead } = useApp();

  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Role-scoped notifications
  const userNotifs = notifications.filter((n) => {
    if (currentUser.role === 'admin') return true;
    if (n.targetRole === 'all') return true;
    return n.targetRole === currentUser.role;
  });

  const filteredNotifs = userNotifs.filter((n) => {
    const matchesType = filterType === 'all' || n.type === filterType;
    const matchesSearch =
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.message.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesType && matchesSearch;
  });

  const unreadCount = userNotifs.filter((n) => !n.read).length;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            Platform Notifications & Alerts
            {unreadCount > 0 && (
              <span className="rounded bg-sky-950 border border-sky-800 px-2 py-0.5 text-xs text-sky-400 font-mono">
                {unreadCount} Unread
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Operational alerts, trade execution notices, terminal connection health events, and system announcements.
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={() => {
              userNotifs.forEach((n) => markNotificationRead(n.id));
            }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors"
          >
            <Check className="h-3.5 w-3.5 text-sky-400" />
            <span>Mark All as Read</span>
          </button>
        )}
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search alerts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-slate-400">Severity:</span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-lg border border-slate-750 bg-slate-950 px-2.5 py-1 text-slate-200 focus:outline-none focus:border-sky-500"
          >
            <option value="all">All Severities</option>
            <option value="error">Errors & Rejects</option>
            <option value="warning">Warnings</option>
            <option value="success">Success</option>
            <option value="info">Info</option>
          </select>
        </div>
      </div>

      {/* Notifications List */}
      <div className="space-y-2.5">
        {filteredNotifs.length > 0 ? (
          filteredNotifs.map((notif) => (
            <div
              key={notif.id}
              onClick={() => markNotificationRead(notif.id)}
              className={`rounded-xl border p-4 transition-colors cursor-pointer ${
                notif.read
                  ? 'border-slate-800 bg-slate-900/60 opacity-80'
                  : 'border-slate-700 bg-slate-900 shadow-sm'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {notif.type === 'error' ? (
                    <div className="rounded-lg p-2 bg-rose-950/60 border border-rose-800/60 text-rose-400">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                  ) : notif.type === 'warning' ? (
                    <div className="rounded-lg p-2 bg-amber-950/60 border border-amber-800/60 text-amber-400">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                  ) : notif.type === 'success' ? (
                    <div className="rounded-lg p-2 bg-emerald-950/60 border border-emerald-800/60 text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  ) : (
                    <div className="rounded-lg p-2 bg-sky-950/60 border border-sky-800/60 text-sky-400">
                      <Info className="h-4 w-4" />
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-100">{notif.title}</h4>
                      {!notif.read && (
                        <span className="h-2 w-2 rounded-full bg-sky-400" />
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-slate-400">
                      {new Date(notif.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{notif.message}</p>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center text-slate-500 text-xs">
            No notifications matching the selected filter.
          </div>
        )}
      </div>
    </div>
  );
};
