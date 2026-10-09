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
  Zap,
  Ticket,
  SlidersHorizontal,
  Settings,
  ShieldCheck,
  Radio,
  Bell
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface SidebarProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onTabChange }) => {
  const { currentUser, parentChildLinks } = useApp();

  const role = currentUser.role;

  const activeFollowers = parentChildLinks.filter(
    (l) => l.mentorId === currentUser.id && l.status === 'active'
  ).length;

  const navItemClass = (isActive: boolean) =>
    `w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
      isActive
        ? 'bg-slate-850 text-sky-300 border border-slate-750 font-semibold'
        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
    }`;

  return (
    <aside className="w-60 shrink-0 border-r border-slate-800 bg-slate-950 p-3.5 flex flex-col justify-between hidden md:flex">
      <div className="space-y-5">
        {/* User Identity Card */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-3">
          <div className="flex items-center gap-2.5">
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
                {role === 'admin' ? 'Super Admin' : role === 'mentor' ? 'Mentor (Parent)' : 'Trader (Child)'}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Section */}
        <div>
          <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">
            {role === 'admin'
              ? 'Administration'
              : role === 'mentor'
              ? 'Mentor Workspace'
              : 'Trader Workspace'}
          </div>

          <nav className="space-y-1">
            {role === 'admin' && (
              <>
                <button
                  onClick={() => onTabChange('overview')}
                  className={navItemClass(currentTab === 'overview')}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Overview</span>
                </button>

                <button
                  onClick={() => onTabChange('mentors')}
                  className={navItemClass(currentTab === 'mentors')}
                >
                  <Users className="h-4 w-4" />
                  <span>Mentor Management</span>
                </button>

                <button
                  onClick={() => onTabChange('traders')}
                  className={navItemClass(currentTab === 'traders')}
                >
                  <UserCheck className="h-4 w-4" />
                  <span>Trader Management</span>
                </button>

                <button
                  onClick={() => onTabChange('plans')}
                  className={navItemClass(currentTab === 'plans')}
                >
                  <CreditCard className="h-4 w-4" />
                  <span>Subscriptions</span>
                </button>

                <button
                  onClick={() => onTabChange('relationships')}
                  className={navItemClass(currentTab === 'relationships')}
                >
                  <Network className="h-4 w-4" />
                  <span>Relationships</span>
                </button>

                <button
                  onClick={() => onTabChange('connections')}
                  className={navItemClass(currentTab === 'connections')}
                >
                  <Server className="h-4 w-4" />
                  <span>Connections (Demo)</span>
                </button>

                <button
                  onClick={() => onTabChange('audit-logs')}
                  className={navItemClass(currentTab === 'audit-logs')}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>Activity & Audit Logs</span>
                </button>

                <button
                  onClick={() => onTabChange('system-health')}
                  className={navItemClass(currentTab === 'system-health')}
                >
                  <Activity className="h-4 w-4" />
                  <span>System Health</span>
                </button>
              </>
            )}

            {role === 'mentor' && (
              <>
                <button
                  onClick={() => onTabChange('overview')}
                  className={navItemClass(currentTab === 'overview')}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Overview</span>
                </button>

                <button
                  onClick={() => onTabChange('child-accounts')}
                  className={navItemClass(currentTab === 'child-accounts')}
                >
                  <Users className="h-4 w-4" />
                  <span className="flex-1 text-left">Linked Traders</span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[10px] font-mono text-slate-300">
                    {activeFollowers}
                  </span>
                </button>

                <button
                  onClick={() => onTabChange('invitations')}
                  className={navItemClass(currentTab === 'invitations')}
                >
                  <Ticket className="h-4 w-4" />
                  <span>Trader Invitations</span>
                </button>

                <button
                  onClick={() => onTabChange('trade-activity')}
                  className={navItemClass(currentTab === 'trade-activity')}
                >
                  <ListOrdered className="h-4 w-4" />
                  <span>Recent Activity</span>
                </button>

                <button
                  onClick={() => onTabChange('subscription')}
                  className={navItemClass(currentTab === 'subscription')}
                >
                  <CreditCard className="h-4 w-4" />
                  <span>Subscription</span>
                </button>

                <button
                  onClick={() => onTabChange('notifications')}
                  className={navItemClass(currentTab === 'notifications')}
                >
                  <Bell className="h-4 w-4" />
                  <span>Notifications</span>
                </button>

                <button
                  onClick={() => onTabChange('settings')}
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
                  onClick={() => onTabChange('overview')}
                  className={navItemClass(currentTab === 'overview')}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Overview</span>
                </button>

                <button
                  onClick={() => onTabChange('mentor-link')}
                  className={navItemClass(currentTab === 'mentor-link')}
                >
                  <UserCheck className="h-4 w-4" />
                  <span>Linked Mentor</span>
                </button>

                <button
                  onClick={() => onTabChange('lot-settings')}
                  className={navItemClass(currentTab === 'lot-settings')}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  <span>Copy Preferences</span>
                </button>

                <button
                  onClick={() => onTabChange('copied-trades')}
                  className={navItemClass(currentTab === 'copied-trades')}
                >
                  <ListOrdered className="h-4 w-4" />
                  <span>Activity History</span>
                </button>

                <button
                  onClick={() => onTabChange('failed-trades')}
                  className={navItemClass(currentTab === 'failed-trades')}
                >
                  <AlertOctagon className="h-4 w-4" />
                  <span>Connection Errors</span>
                </button>

                <button
                  onClick={() => onTabChange('subscription')}
                  className={navItemClass(currentTab === 'subscription')}
                >
                  <CreditCard className="h-4 w-4" />
                  <span>Subscription</span>
                </button>

                <button
                  onClick={() => onTabChange('notifications')}
                  className={navItemClass(currentTab === 'notifications')}
                >
                  <Bell className="h-4 w-4" />
                  <span>Notifications</span>
                </button>

                <button
                  onClick={() => onTabChange('settings')}
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
          <span className="text-[10px] text-amber-400 font-mono font-semibold">
            DEMO SANDBOX
          </span>
        </div>
        <p className="text-[10px] text-slate-500 leading-tight">
          Simulated accounts and trade mirroring events. No real funds deployed.
        </p>
      </div>
    </aside>
  );
};
