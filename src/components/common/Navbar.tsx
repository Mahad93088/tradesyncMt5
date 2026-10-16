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

                {/* Demo personas (or admin testing personas) */}
                {(!isCloudMode || currentUser.role === 'admin') && (
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
                      Sign Out of Cloud
                    </button>
                  ) : (
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
                  )}

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

      {/* Quick Tab Bar for Super Admin (Visible on all devices for fast access to Parent & Child MT5 Accounts) */}
      {currentUser.role === 'admin' && onTabChange && currentTab && (
        <div className="border-t border-slate-800/80 bg-slate-950/95 px-3 sm:px-6 py-1.5 overflow-x-auto flex items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold shrink-0 mr-1 hidden sm:inline">
            Admin Hub:
          </span>
          <button
            onClick={() => onTabChange('overview')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              currentTab === 'overview'
                ? 'bg-slate-800 text-sky-300 font-semibold border border-slate-700'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => onTabChange('parent-accounts')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              currentTab === 'parent-accounts'
                ? 'bg-cyan-950 border border-cyan-800 text-cyan-300 font-semibold shadow-sm'
                : 'text-cyan-400/90 hover:text-cyan-200 hover:bg-slate-900'
            }`}
          >
            <Server className="h-3.5 w-3.5" />
            <span>Parent MT5 Accounts</span>
          </button>
          <button
            onClick={() => onTabChange('child-accounts')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              currentTab === 'child-accounts'
                ? 'bg-emerald-950 border border-emerald-800 text-emerald-300 font-semibold shadow-sm'
                : 'text-emerald-400/90 hover:text-emerald-200 hover:bg-slate-900'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Child MT5 Accounts</span>
          </button>
          <button
            onClick={() => onTabChange('mentors')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              currentTab === 'mentors'
                ? 'bg-slate-800 text-sky-300 font-semibold border border-slate-700'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            Mentors
          </button>
          <button
            onClick={() => onTabChange('traders')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              currentTab === 'traders'
                ? 'bg-slate-800 text-sky-300 font-semibold border border-slate-700'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            Traders
          </button>
          <button
            onClick={() => onTabChange('plans')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              currentTab === 'plans'
                ? 'bg-slate-800 text-sky-300 font-semibold border border-slate-700'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            Subscriptions
          </button>
          <button
            onClick={() => onTabChange('relationships')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              currentTab === 'relationships'
                ? 'bg-slate-800 text-sky-300 font-semibold border border-slate-700'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            Relationships
          </button>
        </div>
      )}
    </header>
  );
};
