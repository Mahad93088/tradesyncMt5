import React, { useState, useEffect } from 'react';
import {
  Activity,
  Bell,
  CheckCircle2,
  AlertTriangle,
  Server,
  Code2,
  ChevronDown,
  UserCheck,
  Shield,
  RefreshCw,
  Terminal,
  ShieldAlert
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { UserRole } from '../../types';

export const Navbar: React.FC = () => {
  const {
    currentUser,
    users,
    notifications,
    systemHealth,
    switchRole,
    markNotificationRead,
    setIsArchitectureModalOpen,
    resetDemoData
  } = useApp();

  const [timeStr, setTimeStr] = useState<string>('');
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [showNotifMenu, setShowNotifMenu] = useState(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toISOString().substring(11, 19) + ' UTC');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        {/* Left: Brand & Status */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 border border-slate-700 text-sky-400">
              <Terminal className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-slate-100 text-base">TradeSync</span>
                <span className="rounded bg-slate-800 border border-slate-700 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-sky-300">
                  MT5
                </span>
              </div>
            </div>
          </div>

          {/* Testnet / Simulation Warning Banner Badge */}
          <div className="hidden lg:flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/90 px-2.5 py-1 text-xs text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            <span className="text-slate-400">Environment:</span>
            <span className="font-medium text-slate-200">Demo / Simulation Mode</span>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2.5">
          {/* Server Time Ticker */}
          <div className="hidden md:flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-mono text-slate-400">
            <Server className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-slate-300">{timeStr}</span>
            <span className="text-slate-700">|</span>
            <span>{systemHealth.activeTerminalsCount} Terminals (Demo)</span>
          </div>

          {/* Backend Spec Modal Trigger */}
          <button
            onClick={() => setIsArchitectureModalOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-850 hover:text-white transition-colors"
            title="Inspect Supabase Schema, RLS & Python FastAPI MT5 Bridge code"
          >
            <Code2 className="h-3.5 w-3.5 text-sky-400" />
            <span className="hidden sm:inline">Backend Spec</span>
          </button>

          {/* Notifications Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowNotifMenu(!showNotifMenu)}
              className="relative rounded-md border border-slate-800 bg-slate-900 p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-850 transition-colors"
              title="System Notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[9px] font-bold text-white font-mono">
                  {unreadCount}
                </span>
              )}
            </button>

            {showNotifMenu && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-xl z-50">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    System Alerts ({notifications.length})
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Demo Stream</span>
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                  {notifications.map((notif) => (
                    <div
                      key={notif.id}
                      onClick={() => markNotificationRead(notif.id)}
                      className={`cursor-pointer rounded-lg border p-2.5 transition-colors ${
                        notif.read
                          ? 'border-slate-800/60 bg-slate-950/40 opacity-70'
                          : 'border-slate-700 bg-slate-800/80'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {notif.type === 'error' ? (
                          <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                        ) : notif.type === 'warning' ? (
                          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                        ) : notif.type === 'success' ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <Activity className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-white">{notif.title}</p>
                          <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">{notif.message}</p>
                          <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                            {new Date(notif.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Quick Role Switcher */}
          <div className="relative">
            <button
              onClick={() => setShowRoleMenu(!showRoleMenu)}
              className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs text-white hover:border-slate-700 transition-colors"
            >
              <div className="h-5 w-5 rounded-full overflow-hidden bg-slate-800 shrink-0 border border-slate-700 flex items-center justify-center font-bold text-[10px] text-slate-300">
                {currentUser.avatarUrl ? (
                  <img src={currentUser.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  currentUser.fullName[0]
                )}
              </div>
              <div className="text-left hidden sm:block">
                <p className="font-semibold text-xs leading-none text-slate-200">{currentUser.fullName}</p>
                <span className="text-[10px] font-mono text-sky-400 uppercase">
                  {currentUser.role === 'admin'
                    ? 'Super Admin'
                    : currentUser.role === 'mentor'
                    ? 'Mentor (Parent)'
                    : 'Trader (Child)'}
                </span>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-slate-500 ml-0.5" />
            </button>

            {showRoleMenu && (
              <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-800 bg-slate-900 p-2 shadow-2xl z-50">
                <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Switch Role / User Account
                </div>
                <div className="space-y-1">
                  {users.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => {
                        switchRole(u.role, u.id);
                        setShowRoleMenu(false);
                      }}
                      className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                        currentUser.id === u.id
                          ? 'bg-slate-800 border border-slate-700 text-sky-300'
                          : 'hover:bg-slate-850 text-slate-300'
                      }`}
                    >
                      <div className="h-6 w-6 rounded-full overflow-hidden bg-slate-800 shrink-0 border border-slate-700 flex items-center justify-center font-bold text-[10px] text-slate-300">
                        {u.avatarUrl ? (
                          <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          u.fullName[0]
                        )}
                      </div>
                      <div className="flex-1 truncate">
                        <div className="font-medium text-slate-100 truncate">{u.fullName}</div>
                        <div className="text-[10px] text-slate-400 capitalize">
                          {u.role === 'admin' ? 'Super Admin' : u.role} • {u.status}
                        </div>
                      </div>
                      {currentUser.id === u.id && (
                        <CheckCircle2 className="h-4 w-4 text-sky-400 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>

                <div className="mt-2 pt-2 border-t border-slate-800 px-1">
                  <button
                    onClick={() => {
                      resetDemoData();
                      setShowRoleMenu(false);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 px-2 py-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Reset Demo State
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
