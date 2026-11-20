import React from 'react';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  CreditCard,
  Network,
  ListOrdered,
  Activity,
  FileSpreadsheet,
  AlertOctagon,
  Server,
  Layers,
  DollarSign,
  Ticket,
  SlidersHorizontal,
  Settings,
  ShieldCheck,
  Bell,
  Globe,
  X
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';

interface SidebarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  isMobileOpen = false,
  onCloseMobile
}) => {
  const { isCloudMode } = useAuth();
  const { currentUser, parentChildLinks, notifications } = useApp();

  const role = currentUser.role;

  const activeFollowers = parentChildLinks.filter(
    (l) => l.mentorId === currentUser.id && l.status === 'active'
  ).length;

  const unreadNotifications = notifications.filter((n) => !n.read).length;

  const handleNavClick = (tab: string) => {
    onTabChange(tab);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  if (role === 'admin') {
    const adminNavClass = (isActive: boolean) =>
      `w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-colors whitespace-nowrap ${
        isActive
          ? 'bg-sky-500/15 text-white border border-sky-400/30 font-semibold'
          : 'text-slate-300 hover:bg-slate-800/70 hover:text-white border border-transparent font-medium'
      }`;

    const isMt5AccountsActive =
      currentTab === 'mt5-accounts' ||
      currentTab === 'parent-accounts' ||
      currentTab === 'child-accounts' ||
      currentTab === 'admin-parent-accounts' ||
      currentTab === 'admin-child-accounts';

    return (
      <>
        {isMobileOpen && (
          <div
            onClick={onCloseMobile}
            className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm md:hidden transition-opacity"
          />
        )}

        <aside
          className={`w-64 shrink-0 border-r border-slate-800/80 bg-[#0B1220] text-slate-300 p-3.5 flex flex-col justify-between z-50 transition-transform duration-200 ${
            isMobileOpen
              ? 'fixed inset-y-0 left-0 shadow-2xl flex translate-x-0'
              : 'hidden md:flex'
          }`}
        >
          <div className="flex-1 min-h-0 flex flex-col gap-4">
            <div className="rounded-lg border border-slate-800/90 bg-slate-900/70 p-3 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="relative shrink-0">
                    <div className="h-8 w-8 rounded-full overflow-hidden border border-slate-700 bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-200">
                      {currentUser.avatarUrl ? (
                        <img src={currentUser.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        currentUser.fullName[0]
                      )}
                    </div>
                    <span
                      className={`absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 border-[#0B1220] ${
                        currentUser.status === 'active' ? 'bg-emerald-400' : 'bg-rose-400'
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-semibold text-white truncate">{currentUser.fullName}</h4>
                    <p className="text-[10px] font-mono text-sky-400 uppercase tracking-wide">Super Admin</p>
                  </div>
                </div>

                {onCloseMobile && (
                  <button
                    onClick={onCloseMobile}
                    className="md:hidden p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                    aria-label="Close sidebar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <nav className="flex-1 overflow-y-auto space-y-5 pr-0.5" aria-label="Super Admin Navigation">
              <div>
                <div className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                  Overview
                </div>
                <div className="space-y-1">
                  <button
                    onClick={() => handleNavClick('overview')}
                    className={adminNavClass(currentTab === 'overview')}
                  >
                    <LayoutDashboard className="h-4 w-4 shrink-0" />
                    <span className="truncate">Overview</span>
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                  Users &amp; Accounts
                </div>
                <div className="space-y-1">
                  <button
                    onClick={() => handleNavClick('mentors')}
                    className={adminNavClass(currentTab === 'mentors')}
                  >
                    <Users className="h-4 w-4 shrink-0" />
                    <span className="truncate">Mentor Management</span>
                  </button>
                  <button
                    onClick={() => handleNavClick('traders')}
                    className={adminNavClass(currentTab === 'traders')}
                  >
                    <UserCheck className="h-4 w-4 shrink-0" />
                    <span className="truncate">Trader Management</span>
                  </button>
                  <button
                    onClick={() => handleNavClick('mt5-accounts')}
                    className={adminNavClass(isMt5AccountsActive)}
                  >
                    <Server className="h-4 w-4 shrink-0" />
                    <span className="truncate">MT5 Account Management</span>
                  </button>
                  <button
                    onClick={() => handleNavClick('brokers')}
                    className={adminNavClass(currentTab === 'brokers')}
                  >
                    <Globe className="h-4 w-4 shrink-0" />
                    <span className="truncate">Brokers &amp; Gold Symbols</span>
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                  Billing &amp; Revenue
                </div>
                <div className="space-y-1">
                  <button
                    onClick={() => handleNavClick('plans')}
                    className={adminNavClass(currentTab === 'plans')}
                  >
                    <Layers className="h-4 w-4 shrink-0" />
                    <span className="truncate">Subscription Plans</span>
                  </button>
                  <button
                    onClick={() => handleNavClick('subscriptions')}
                    className={adminNavClass(currentTab === 'subscriptions')}
                  >
                    <CreditCard className="h-4 w-4 shrink-0" />
                    <span className="truncate">Subscriptions</span>
                  </button>
                  <button
                    onClick={() => handleNavClick('payments-revenue')}
                    className={adminNavClass(currentTab === 'payments-revenue')}
                  >
                    <DollarSign className="h-4 w-4 shrink-0" />
                    <span className="truncate">Payments &amp; Revenue</span>
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                  Monitoring &amp; Logs
                </div>
                <div className="space-y-1">
                  <button
                    onClick={() => handleNavClick('system-health')}
                    className={adminNavClass(currentTab === 'system-health' || currentTab === 'connections')}
                  >
                    <Activity className="h-4 w-4 shrink-0" />
                    <span className="truncate">Platform Monitoring</span>
                  </button>
                  <button
                    onClick={() => handleNavClick('copier-monitoring')}
                    className={adminNavClass(currentTab === 'copier-monitoring' || currentTab === 'relationships')}
                  >
                    <Network className="h-4 w-4 shrink-0" />
                    <span className="truncate">Trade Copier Monitoring</span>
                  </button>
                  <button
                    onClick={() => handleNavClick('audit-logs')}
                    className={adminNavClass(currentTab === 'audit-logs' || currentTab === 'trade-stream')}
                  >
                    <FileSpreadsheet className="h-4 w-4 shrink-0" />
                    <span className="truncate">System Audit Logs</span>
                  </button>
                  <button
                    onClick={() => handleNavClick('global-logs')}
                    className={adminNavClass(currentTab === 'global-logs')}
                  >
                    <ListOrdered className="h-4 w-4 shrink-0" />
                    <span className="truncate">Global Logs</span>
                  </button>
                  <button
                    onClick={() => handleNavClick('notifications')}
                    className={adminNavClass(currentTab === 'notifications')}
                  >
                    <Bell className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-left truncate">Notifications &amp; Alerts</span>
                    {unreadNotifications > 0 && (
                      <span className="rounded bg-rose-500/20 border border-rose-400/30 px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-rose-200 shrink-0">
                        {unreadNotifications}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                  System
                </div>
                <div className="space-y-1">
                  <button
                    onClick={() => handleNavClick('platform-settings')}
                    className={adminNavClass(currentTab === 'platform-settings' || currentTab === 'settings')}
                  >
                    <Settings className="h-4 w-4 shrink-0" />
                    <span className="truncate">Platform Settings</span>
                  </button>
                  <button
                    onClick={() => handleNavClick('admin-profile')}
                    className={adminNavClass(currentTab === 'admin-profile')}
                  >
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    <span className="truncate">Admin Profile</span>
                  </button>
                </div>
              </div>
            </nav>
          </div>

          <div className="mt-4 rounded-lg border border-slate-800/90 bg-slate-900/60 p-3 text-xs space-y-1 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-400">Environment</span>
              <span
                className={`text-[10px] font-mono font-semibold ${
                  isCloudMode ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {isCloudMode ? 'CLOUD DEMO BRIDGE' : 'DEMO SANDBOX'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 leading-tight">
              {isCloudMode
                ? 'Demo-only EA bridge active via Supabase. Live real-money accounts blocked.'
                : 'Simulated accounts and trade mirroring events. No real funds deployed.'}
            </p>
          </div>
        </aside>
      </>
    );
  }

  const navItemClass = (isActive: boolean) =>
    `w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
      isActive
        ? 'bg-slate-850 text-sky-300 border border-slate-750 font-semibold'
        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
    }`;

  return (
    <>
      {/* Mobile Drawer Backdrop */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm md:hidden transition-opacity"
        />
      )}

      <aside
        className={`w-64 shrink-0 border-r border-slate-800 bg-slate-950 p-3.5 flex flex-col justify-between z-50 transition-transform duration-200 ${
          isMobileOpen
            ? 'fixed inset-y-0 left-0 shadow-2xl flex translate-x-0'
            : 'hidden md:flex'
        }`}
      >
        <div className="space-y-5">
          {/* User Identity Card */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="relative">
                  <div className="h-8 w-8 rounded-full overflow-hidden border border-slate-700 bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300">
                    {currentUser.avatarUrl ? (
                      <img src={currentUser.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      currentUser.fullName[0]
                    )}
                  </div>
                  <span
                    className={`absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 border-slate-900 ${
                      currentUser.status === 'active' ? 'bg-emerald-400' : 'bg-rose-400'
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-semibold text-slate-100 truncate">{currentUser.fullName}</h4>
                  <p className="text-[10px] font-mono text-sky-400 uppercase">
                    {role === 'mentor' ? 'Mentor (Parent)' : 'Trader (Child)'}
                  </p>
                </div>
              </div>

              {onCloseMobile && (
                <button
                  onClick={onCloseMobile}
                  className="md:hidden p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                  aria-label="Close sidebar"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

        {/* Navigation Section */}
        <div>
          <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">
            {role === 'mentor' ? 'Mentor Workspace' : 'Trader Workspace'}
          </div>

          <nav className="space-y-1">
            {role === 'mentor' && (
              <>
                <button
                  onClick={() => handleNavClick('overview')}
                  className={navItemClass(currentTab === 'overview')}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Overview</span>
                </button>

                <button
                  onClick={() => handleNavClick('child-accounts')}
                  className={navItemClass(currentTab === 'child-accounts')}
                >
                  <Users className="h-4 w-4" />
                  <span className="flex-1 text-left">Linked Traders</span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[10px] font-mono text-slate-300">
                    {activeFollowers}
                  </span>
                </button>

                <button
                  onClick={() => handleNavClick('invitations')}
                  className={navItemClass(currentTab === 'invitations')}
                >
                  <Ticket className="h-4 w-4" />
                  <span>Trader Invitations</span>
                </button>

                <button
                  onClick={() => handleNavClick('trade-activity')}
                  className={navItemClass(currentTab === 'trade-activity')}
                >
                  <ListOrdered className="h-4 w-4" />
                  <span>Recent Activity</span>
                </button>

                <button
                  onClick={() => handleNavClick('subscription')}
                  className={navItemClass(currentTab === 'subscription')}
                >
                  <CreditCard className="h-4 w-4" />
                  <span>Subscription</span>
                </button>

                <button
                  onClick={() => handleNavClick('notifications')}
                  className={navItemClass(currentTab === 'notifications')}
                >
                  <Bell className="h-4 w-4" />
                  <span>Notifications</span>
                </button>

                <button
                  onClick={() => handleNavClick('settings')}
                  className={navItemClass(currentTab === 'settings')}
                >
                  <Settings className="h-4 w-4" />
                  <span>Account Settings</span>
                </button>
              </>
            )}

            {role === 'trader' && (
              <>
                <button
                  onClick={() => handleNavClick('overview')}
                  className={navItemClass(currentTab === 'overview')}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Overview</span>
                </button>

                <button
                  onClick={() => handleNavClick('mentor-link')}
                  className={navItemClass(currentTab === 'mentor-link')}
                >
                  <UserCheck className="h-4 w-4" />
                  <span>Linked Mentor</span>
                </button>

                <button
                  onClick={() => handleNavClick('lot-settings')}
                  className={navItemClass(currentTab === 'lot-settings')}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  <span>Copy Preferences</span>
                </button>

                <button
                  onClick={() => handleNavClick('copied-trades')}
                  className={navItemClass(currentTab === 'copied-trades')}
                >
                  <ListOrdered className="h-4 w-4" />
                  <span>Activity History</span>
                </button>

                <button
                  onClick={() => handleNavClick('failed-trades')}
                  className={navItemClass(currentTab === 'failed-trades')}
                >
                  <AlertOctagon className="h-4 w-4" />
                  <span>Connection Errors</span>
                </button>

                <button
                  onClick={() => handleNavClick('subscription')}
                  className={navItemClass(currentTab === 'subscription')}
                >
                  <CreditCard className="h-4 w-4" />
                  <span>Subscription</span>
                </button>

                <button
                  onClick={() => handleNavClick('notifications')}
                  className={navItemClass(currentTab === 'notifications')}
                >
                  <Bell className="h-4 w-4" />
                  <span>Notifications</span>
                </button>

                <button
                  onClick={() => handleNavClick('settings')}
                  className={navItemClass(currentTab === 'settings')}
                >
                  <Settings className="h-4 w-4" />
                  <span>Account Settings</span>
                </button>
              </>
            )}
          </nav>
        </div>
      </div>

      {/* Terminal Node Status Bottom Box */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-400">Environment</span>
          <span
            className={`text-[10px] font-mono font-semibold ${
              isCloudMode ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {isCloudMode ? 'CLOUD DEMO BRIDGE' : 'DEMO SANDBOX'}
          </span>
        </div>
        <p className="text-[10px] text-slate-500 leading-tight">
          {isCloudMode
            ? 'Demo-only EA bridge active via Supabase. Live real-money accounts blocked.'
            : 'Simulated accounts and trade mirroring events. No real funds deployed.'}
        </p>
      </div>
    </aside>
  </>
);
};
