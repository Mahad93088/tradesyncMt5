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
  ShieldAlert,
  Cloud,
  LogIn,
  LogOut,
  Menu,
  Layers
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { UserRole } from '../../types';

interface NavbarProps {
  onToggleMobileNav?: () => void;
  currentTab?: string;
  onTabChange?: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onToggleMobileNav,
  currentTab,
  onTabChange
}) => {
  const {
    currentUser,
    users,
    notifications,
    systemHealth,
    switchRole,
    markNotificationRead,
    setIsArchitectureModalOpen,
    isAuthModalOpen,
    setIsAuthModalOpen,
    resetDemoData
  } = useApp();

  const {
    session,
    isAuthenticated,
    isCloudMode,
    isConfigured,
    signOut,
    switchToDemoMode
  } = useAuth();

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

  const adminSectionTitleMap: Record<string, string> = {
    overview: 'Overview',
    mentors: 'Mentor Management',
    traders: 'Trader Management',
    'mt5-accounts': 'MT5 Account Management',
    'parent-accounts': 'MT5 Account Management',
    'child-accounts': 'MT5 Account Management',
    'admin-parent-accounts': 'MT5 Account Management',
    'admin-child-accounts': 'MT5 Account Management',
    brokers: 'Brokers & Gold Symbols',
    plans: 'Subscription Plans',
    subscriptions: 'Subscriptions',
    'payments-revenue': 'Payments & Revenue',
    'system-health': 'Platform Monitoring',
    connections: 'Platform Monitoring',
    'copier-monitoring': 'Trade Copier Monitoring',
    relationships: 'Trade Copier Monitoring',
    'audit-logs': 'System Audit Logs',
    'global-logs': 'Global Logs',
    'trade-stream': 'System Audit Logs',
    notifications: 'Notifications & Alerts',
    'platform-settings': 'Platform Settings',
    settings: 'Platform Settings',
    'admin-profile': 'Admin Profile'
  };

  if (currentUser.role === 'admin') {
    const activeSectionLabel = adminSectionTitleMap[currentTab || 'overview'] || 'Overview';

    return (
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white text-slate-900">
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            {onToggleMobileNav && (
              <button
                onClick={onToggleMobileNav}
                className="md:hidden -ml-1 p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors shrink-0"
                aria-label="Toggle navigation menu"
                title="Navigation Menu"
              >
                <Menu className="h-4 w-4" />
              </button>
            )}

            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0B1220] text-sky-400 shrink-0">
                <Shield className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold tracking-tight text-slate-900 text-sm sm:text-base whitespace-nowrap truncate">
                    TradeSync MT5 — Super Admin
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 font-medium truncate">
                  {activeSectionLabel}
                </p>
              </div>
            </div>

            {isCloudMode ? (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="hidden lg:inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
                title="Connected to Supabase PostgreSQL Database with Row-Level Security"
              >
                <Cloud className="h-3.5 w-3.5 text-emerald-600" />
                <span className="font-semibold">Supabase Cloud</span>
                <span className="text-[10px] font-mono text-emerald-600">(ADMIN RLS)</span>
              </button>
            ) : (
              <div className="hidden lg:flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 whitespace-nowrap">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <span className="font-medium">Local Demo Mode</span>
                </div>
                <button
                  onClick={() => setIsAuthModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 hover:bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700 transition-colors whitespace-nowrap shrink-0"
                >
                  <Cloud className="h-3.5 w-3.5 text-sky-600" />
                  <span>Connect Cloud</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <div className="hidden xl:flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-mono text-slate-600 tabular-nums whitespace-nowrap">
              <Server className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-slate-800 font-medium">{timeStr}</span>
              <span className="text-slate-300">|</span>
              <span>
                {systemHealth.activeTerminalsCount} Terminals ({isCloudMode ? 'PostgreSQL' : 'Demo'})
              </span>
            </div>

            <button
              onClick={() => setIsAuthModalOpen(true)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                isCloudMode
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
              title="Supabase Cloud Connection & Role Security"
            >
              <Cloud className="h-3.5 w-3.5 text-sky-600" />
              <span className="hidden sm:inline">{isAuthenticated ? 'Cloud Account' : 'Cloud Auth'}</span>
            </button>

            <button
              onClick={() => setIsArchitectureModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              title="Inspect Supabase Schema & MT5 Bridge Architecture"
            >
              <Code2 className="h-3.5 w-3.5 text-sky-600" />
              <span className="hidden sm:inline">Architecture</span>
            </button>

            <div className="relative">
              <button
                onClick={() => {
                  setShowNotifMenu(!showNotifMenu);
                  setShowRoleMenu(false);
                }}
                className="relative rounded-md border border-slate-200 bg-white p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
                title="System Notifications"
                aria-label="System Notifications"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white font-mono tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotifMenu && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-50">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200 mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                      System Alerts ({notifications.length})
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {isCloudMode ? 'Live Audit Stream' : 'Demo Stream'}
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                    {notifications.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-500">
                        No active system alerts.
                      </div>
                    ) : (
                      notifications.slice(0, 8).map((notif) => (
                        <div
                          key={notif.id}
                          onClick={() => markNotificationRead(notif.id)}
                          className={`cursor-pointer rounded-lg border p-2.5 transition-colors ${
                            notif.read
                              ? 'border-slate-200 bg-slate-50/70 opacity-75'
                              : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {notif.type === 'error' ? (
                              <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                            ) : notif.type === 'warning' ? (
                              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                            ) : notif.type === 'success' ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                            ) : (
                              <Activity className="h-4 w-4 text-sky-600 shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-slate-900">{notif.title}</p>
                              <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">{notif.message}</p>
                              <span className="text-[10px] text-slate-500 font-mono tabular-nums mt-1 block">
                                {new Date(notif.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {onTabChange && (
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <button
                        onClick={() => {
                          onTabChange('notifications');
                          setShowNotifMenu(false);
                        }}
                        className="w-full rounded-lg bg-slate-100 hover:bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors"
                      >
                        Open Notifications Center
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => {
                  setShowRoleMenu(!showRoleMenu);
                  setShowNotifMenu(false);
                }}
                className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 hover:bg-slate-50 transition-colors shrink-0"
              >
                <div className="h-6 w-6 rounded-full overflow-hidden bg-[#0B1220] shrink-0 flex items-center justify-center font-bold text-[10px] text-white">
                  {currentUser.avatarUrl ? (
                    <img src={currentUser.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    currentUser.fullName[0]
                  )}
                </div>
                <div className="text-left hidden sm:block">
                  <p className="font-semibold text-xs leading-tight text-slate-900">{currentUser.fullName}</p>
                  <span className="text-[10px] font-mono text-sky-700 uppercase">Super Admin</span>
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400 ml-0.5" />
              </button>

              {showRoleMenu && (
                <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl z-50">
                  <div className="px-2 py-1.5 flex items-center justify-between border-b border-slate-200 mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {isCloudMode ? 'Active Cloud Account' : 'Switch Persona (Demo)'}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
                        isCloudMode
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700'
                      }`}
                    >
                      {isCloudMode ? 'Cloud Mode' : 'Demo Mode'}
                    </span>
                  </div>

                  {isCloudMode && (
                    <div className="p-2.5 mb-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                      <p className="text-[11px] text-slate-600 truncate">Email: {currentUser.email}</p>
                      <p className="text-[11px] text-slate-800 font-semibold mt-0.5">
                        Role: <span className="text-sky-700 uppercase font-mono">{currentUser.role}</span>
                      </p>
                      <p className="text-[10px] text-emerald-700 mt-1 flex items-center gap-1 font-mono">
                        <CheckCircle2 className="h-3 w-3" /> Database RLS Protected
                      </p>
                    </div>
                  )}

                  {onTabChange && (
                    <div className="space-y-1 mb-1.5 pb-1.5 border-b border-slate-200">
                      <button
                        onClick={() => {
                          onTabChange('admin-profile');
                          setShowRoleMenu(false);
                        }}
                        className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        <span>Admin Profile</span>
                        <span className="text-[10px] font-mono text-slate-400">Account</span>
                      </button>
                      <button
                        onClick={() => {
                          onTabChange('platform-settings');
                          setShowRoleMenu(false);
                        }}
                        className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                      >
                        <span>Platform Settings</span>
                        <span className="text-[10px] font-mono text-slate-400">System</span>
                      </button>
                    </div>
                  )}

                  {!isCloudMode && (
                    <div className="space-y-1 max-h-56 overflow-y-auto">
                      {users.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => {
                            switchRole(u.role, u.id);
                            setShowRoleMenu(false);
                          }}
                          className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                            currentUser.id === u.id
                              ? 'bg-sky-50 border border-sky-200 text-sky-900'
                              : 'hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          <div className="h-6 w-6 rounded-full overflow-hidden bg-slate-200 shrink-0 border border-slate-300 flex items-center justify-center font-bold text-[10px] text-slate-700">
                            {u.avatarUrl ? (
                              <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              u.fullName[0]
                            )}
                          </div>
                          <div className="flex-1 truncate">
                            <div className="font-medium text-slate-900 truncate">{u.fullName}</div>
                            <div className="text-[10px] text-slate-500 capitalize">
                              {u.role === 'admin' ? 'Super Admin' : u.role} • {u.status}
                            </div>
                          </div>
                          {currentUser.id === u.id && (
                            <CheckCircle2 className="h-4 w-4 text-sky-600 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 pt-2 border-t border-slate-200 space-y-1 px-1">
                    {isAuthenticated ? (
                      <button
                        onClick={async () => {
                          await signOut();
                          setShowRoleMenu(false);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 px-2 py-1.5 text-[11px] font-medium text-rose-700 transition-colors"
                      >
                        <LogOut className="h-3 w-3" />
                        Sign Out
                      </button>
                    ) : (
                      <>
                        {isConfigured && (
                          <button
                            onClick={async () => {
                              await signOut();
                              setShowRoleMenu(false);
                            }}
                            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2 py-1.5 text-[11px] font-medium text-slate-700 transition-colors"
                          >
                            <LogOut className="h-3 w-3" />
                            Exit Sandbox to Login
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setIsAuthModalOpen(true);
                            setShowRoleMenu(false);
                          }}
                          className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-[#0B1220] hover:bg-slate-800 px-2 py-1.5 text-[11px] font-semibold text-white transition-colors"
                        >
                          <LogIn className="h-3 w-3" />
                          Sign In / Connect Cloud
                        </button>
                      </>
                    )}

                    {!isCloudMode && (
                      <button
                        onClick={() => {
                          resetDemoData();
                          setShowRoleMenu(false);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-700 transition-colors"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Reset Demo State
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        {/* Left: Brand & Status */}
        <div className="flex items-center gap-2.5 sm:gap-4">
          {onToggleMobileNav && (
            <button
              onClick={onToggleMobileNav}
              className="md:hidden -ml-1 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 border border-slate-800 transition-colors"
              aria-label="Toggle navigation menu"
              title="Navigation Menu"
            >
              <Menu className="h-4 w-4" />
            </button>
          )}

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

          {/* Cloud vs Demo Status Badge */}
          {isCloudMode ? (
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="hidden lg:flex items-center gap-1.5 rounded-md border border-emerald-800/80 bg-emerald-950/60 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-900/60 transition-colors"
              title="Connected to Supabase PostgreSQL Database with Row-Level Security"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <Cloud className="h-3 w-3 text-emerald-400" />
              <span className="font-semibold text-emerald-200">Supabase Cloud</span>
              <span className="text-[10px] text-emerald-400/80 font-mono">({currentUser.role.toUpperCase()} RLS)</span>
            </button>
          ) : (
            <div className="hidden lg:flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border border-amber-800/60 bg-amber-950/40 px-2.5 py-1 text-xs text-amber-300">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span className="text-amber-400/80">Mode:</span>
                <span className="font-medium text-amber-200">Local Demo</span>
              </div>
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="flex items-center gap-1.5 rounded-md border border-sky-800 bg-sky-950/80 hover:bg-sky-900 px-2 py-0.5 text-xs font-semibold text-sky-300 transition-colors"
              >
                <Cloud className="h-3 w-3 text-sky-400" />
                <span>Connect Cloud</span>
              </button>
            </div>
          )}
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2.5">
          {/* Server Time Ticker */}
          <div className="hidden md:flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-mono text-slate-400">
            <Server className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-slate-300">{timeStr}</span>
            <span className="text-slate-700">|</span>
            <span>{systemHealth.activeTerminalsCount} Terminals ({isCloudMode ? 'PostgreSQL' : 'Demo'})</span>
          </div>

          {/* Cloud Auth / Account Modal Trigger */}
          <button
            onClick={() => setIsAuthModalOpen(true)}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              isCloudMode
                ? 'border-emerald-800/80 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50'
                : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-850 hover:text-white'
            }`}
            title="Supabase Cloud Connection & Role Security"
          >
            <Cloud className="h-3.5 w-3.5 text-sky-400" />
            <span className="hidden sm:inline">{isAuthenticated ? 'Cloud Account' : 'Cloud Auth'}</span>
          </button>

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
                  <span className="text-[10px] text-slate-500 font-mono">
                    {isCloudMode ? 'Live Audit Stream' : 'Demo Stream'}
                  </span>
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                  {notifications.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500">
                      No active system alerts.
                    </div>
                  ) : (
                    notifications.map((notif) => (
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
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick Role Switcher / User Profile Menu */}
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
                  {currentUser.role === 'mentor'
                    ? 'Mentor (Parent)'
                    : 'Trader (Child)'}
                </span>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-slate-500 ml-0.5" />
            </button>

            {showRoleMenu && (
              <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-800 bg-slate-900 p-2 shadow-2xl z-50">
                <div className="px-2 py-1.5 flex items-center justify-between border-b border-slate-800 mb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {isCloudMode ? 'Active Cloud Account' : 'Switch Persona (Demo)'}
                  </span>
                  <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded border ${
                    isCloudMode
                      ? 'border-emerald-800 bg-emerald-950 text-emerald-400'
                      : 'border-amber-800 bg-amber-950 text-amber-400'
                  }`}>
                    {isCloudMode ? 'Cloud Mode' : 'Demo Mode'}
                  </span>
                </div>

                {/* Cloud Mode Identity Summary */}
                {isCloudMode && (
                  <div className="p-2 mb-1.5 rounded-lg bg-slate-950 border border-slate-800/80 text-xs">
                    <p className="text-[11px] text-slate-400 truncate">Email: {currentUser.email}</p>
                    <p className="text-[11px] text-slate-300 font-semibold mt-0.5">
                      Role: <span className="text-sky-300 uppercase font-mono">{currentUser.role}</span>
                    </p>
                    <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1 font-mono">
                      <CheckCircle2 className="h-3 w-3" /> Database RLS Protected
                    </p>
                  </div>
                )}

                {/* Demo personas (strictly Local Demo Mode only) */}
                {!isCloudMode && (
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
                )}

                <div className="mt-2 pt-2 border-t border-slate-800 space-y-1 px-1">
                  {isAuthenticated ? (
                    <button
                      onClick={async () => {
                        await signOut();
                        setShowRoleMenu(false);
                      }}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-rose-900/60 bg-rose-950/30 hover:bg-rose-900/40 px-2 py-1.5 text-[11px] text-rose-300 transition-colors"
                    >
                      <LogOut className="h-3 w-3" />
                      Sign Out
                    </button>
                  ) : (
                    <>
                      {isConfigured && (
                        <button
                          onClick={async () => {
                            await signOut();
                            setShowRoleMenu(false);
                          }}
                          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 px-2 py-1.5 text-[11px] text-slate-300 transition-colors"
                        >
                          <LogOut className="h-3 w-3" />
                          Exit Sandbox to Login
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setIsAuthModalOpen(true);
                          setShowRoleMenu(false);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-2 py-1.5 text-[11px] font-semibold text-white transition-colors"
                      >
                        <LogIn className="h-3 w-3" />
                        Sign In / Connect Cloud
                      </button>
                    </>
                  )}

                  {!isCloudMode && (
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
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
