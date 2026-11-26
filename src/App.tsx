import React, { useState, useEffect } from 'react';
import { ShieldCheck, RefreshCw, LogOut, AlertTriangle } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/common/Navbar';
import { Sidebar } from './components/common/Sidebar';
import { SimulationToolbar } from './components/common/SimulationToolbar';
import { ArchitectureModal } from './components/common/ArchitectureModal';
import { AuthModal } from './components/common/AuthModal';
import { LoginPage } from './components/common/LoginPage';

// Admin Views
import { AdminDashboard } from './components/admin/AdminDashboard';
import { MentorsManagement } from './components/admin/MentorsManagement';
import { ProvisionMentorModal } from './components/admin/ProvisionMentorModal';
import { TradersManagement } from './components/admin/TradersManagement';
import { AddTraderModal } from './components/admin/AddTraderModal';
import { MT5AccountsManagementView } from './components/admin/MT5AccountsManagementView';
import { SubscriptionPlansView } from './components/admin/SubscriptionPlansView';
import { SubscriptionsView } from './components/admin/SubscriptionsView';
import { PaymentsRevenueView } from './components/admin/PaymentsRevenueView';
import { SystemHealthView } from './components/admin/SystemHealthView';
import { TradeCopierMonitoringView } from './components/admin/TradeCopierMonitoringView';
import { GlobalLogsView } from './components/admin/GlobalLogsView';
import { AdminNotificationsView } from './components/admin/AdminNotificationsView';
import { PlatformSettingsView } from './components/admin/PlatformSettingsView';
import { AdminProfileView } from './components/admin/AdminProfileView';
import { BrokerDirectoryView } from './components/admin/BrokerDirectoryView';

// Mentor Views
import { MentorDashboard } from './components/mentor/MentorDashboard';
import { ChildAccountsList } from './components/mentor/ChildAccountsList';
import { MentorSubscriptionCard } from './components/mentor/MentorSubscriptionCard';
import { MentorActivityView } from './components/mentor/MentorActivityView';
import { ConnectParentAccountModal } from './components/mentor/ConnectParentAccountModal';
import { InviteTraderModal } from './components/mentor/InviteTraderModal';

// Trader Views
import { TraderDashboard } from './components/trader/TraderDashboard';
import { CopiedTradesTable } from './components/trader/CopiedTradesTable';
import { FailedTradesTable } from './components/trader/FailedTradesTable';
import { MentorLinkView } from './components/trader/MentorLinkView';
import { TraderSubscriptionView } from './components/trader/TraderSubscriptionView';
import { ConnectChildAccountModal } from './components/trader/ConnectChildAccountModal';
import { LotSettingsModal } from './components/trader/LotSettingsModal';

// Common Views
import { AccountSettingsView } from './components/common/AccountSettingsView';
import { NotificationsView } from './components/common/NotificationsView';

const ADMIN_ONLY_TABS = new Set([
  'mentors',
  'traders',
  'mt5-accounts',
  'parent-accounts',
  'child-accounts',
  'admin-parent-accounts',
  'admin-child-accounts',
  'plans',
  'subscriptions',
  'payments-revenue',
  'system-health',
  'connections',
  'copier-monitoring',
  'relationships',
  'audit-logs',
  'global-logs',
  'trade-stream',
  'platform-settings',
  'admin-profile',
  'brokers'
]);

const AppContent: React.FC = () => {
  const {
    currentUser,
    isCloudMode,
    isArchitectureModalOpen,
    setIsArchitectureModalOpen,
    isAuthModalOpen,
    setIsAuthModalOpen,
    parentChildLinks
  } = useApp();

  const [currentTab, setCurrentTab] = useState<string>('overview');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // Modal states
  const [isCreateMentorOpen, setIsCreateMentorOpen] = useState(false);
  const [isAddTraderOpen, setIsAddTraderOpen] = useState(false);
  const [isConnectParentOpen, setIsConnectParentOpen] = useState(false);
  const [isConnectChildOpen, setIsConnectChildOpen] = useState(false);
  const [isInviteTraderOpen, setIsInviteTraderOpen] = useState(false);
  const [isLotSettingsOpen, setIsLotSettingsOpen] = useState(false);

  const {
    isLoading,
    isAuthenticated,
    isConfigured,
    isRecoveryMode,
    demoSandboxActive,
    signOut,
  } = useAuth();

  // Active link for lot settings modal
  const traderLink = parentChildLinks.find((l) => l.traderId === currentUser.id);

  // When role or Cloud/Demo mode changes, reset tab safely to overview
  const role = currentUser.role;
  const isAdminWorkspace = role === 'admin';

  useEffect(() => {
    setCurrentTab('overview');
  }, [role, isCloudMode]);

  useEffect(() => {
    document.title =
      role === 'admin'
        ? 'TradeSync MT5 — Super Admin'
        : 'TradeSync MT5 - Automated Copy Trading Platform';
  }, [role]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0B1220] text-slate-200 flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-sm font-medium">
          <RefreshCw className="h-4 w-4 animate-spin text-sky-400" />
          <span>Verifying session...</span>
        </div>
      </div>
    );
  }

  // Dedicated Auth Gate: unauthenticated Cloud users & Password Recovery land on LoginPage
  if (isRecoveryMode || (isConfigured && !isAuthenticated && !demoSandboxActive)) {
    return <LoginPage />;
  }

  // Pending / Suspended Account Access Gate
  if (isAuthenticated && currentUser.status !== 'active') {
    return (
      <div className="min-h-screen bg-[#0B1220] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4 text-center">
          <div className="h-11 w-11 rounded-lg bg-amber-950/60 border border-amber-800 text-amber-400 mx-auto flex items-center justify-center">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-white">
              {currentUser.status === 'pending' ? 'Account Pending Approval' : 'Account Access Suspended'}
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              {currentUser.status === 'pending'
                ? 'Your TradeSync MT5 account is awaiting Super Administrator approval before workspace access is enabled.'
                : 'Your account has been suspended by an administrator. Automated copy trading is paused.'}
            </p>
            <p className="text-[11px] font-mono text-slate-500 pt-1">{currentUser.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2 text-xs font-semibold text-white transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    );
  }

  const isRestrictedAdminRoute =
    role !== 'admin' &&
    ADMIN_ONLY_TABS.has(currentTab) &&
    !(role === 'mentor' && currentTab === 'child-accounts');

  return (
    <div
      className={
        isAdminWorkspace
          ? 'min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col font-sans selection:bg-sky-500/20 selection:text-sky-900'
          : 'min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/20 selection:text-cyan-200'
      }
    >
      {/* Top Navbar */}
      <Navbar
        onToggleMobileNav={() => setIsMobileNavOpen(!isMobileNavOpen)}
        currentTab={currentTab}
        onTabChange={(tab) => setCurrentTab(tab)}
      />

      {/* Interactive Simulation Harness Toolbar (Strictly Local Demo Mode, Disabled for Mentors) */}
      {!isCloudMode && role !== 'mentor' && <SimulationToolbar />}

      {/* Main Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Dynamic Sidebar with mobile drawer support */}
        <Sidebar
          currentTab={currentTab}
          onTabChange={(tab) => setCurrentTab(tab)}
          isMobileOpen={isMobileNavOpen}
          onCloseMobile={() => setIsMobileNavOpen(false)}
        />

        {/* Content View Area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* SUPER ADMIN PORTAL VIEWS */}
            {role === 'admin' && (
              <>
                {currentTab === 'overview' && (
                  <AdminDashboard
                    onNavigateTab={(tab) => setCurrentTab(tab)}
                    onOpenCreateMentor={() => setIsCreateMentorOpen(true)}
                    onOpenAddTrader={() => setIsAddTraderOpen(true)}
                  />
                )}
                {currentTab === 'mentors' && (
                  <MentorsManagement
                    isCreateOpen={isCreateMentorOpen}
                    setIsCreateOpen={setIsCreateMentorOpen}
                  />
                )}
                {currentTab === 'traders' && (
                  <TradersManagement
                    isAddOpen={isAddTraderOpen}
                    setIsAddOpen={setIsAddTraderOpen}
                  />
                )}
                {currentTab === 'mt5-accounts' && (
                  <MT5AccountsManagementView key="all" initialTab="all" />
                )}
                {(currentTab === 'parent-accounts' || currentTab === 'admin-parent-accounts') && (
                  <MT5AccountsManagementView key="parent" initialTab="parent" />
                )}
                {(currentTab === 'child-accounts' || currentTab === 'admin-child-accounts') && (
                  <MT5AccountsManagementView key="child" initialTab="child" />
                )}
                {currentTab === 'brokers' && <BrokerDirectoryView />}
                {currentTab === 'plans' && <SubscriptionPlansView />}
                {currentTab === 'subscriptions' && <SubscriptionsView />}
                {currentTab === 'payments-revenue' && <PaymentsRevenueView />}
                {(currentTab === 'system-health' || currentTab === 'connections') && (
                  <SystemHealthView />
                )}
                {(currentTab === 'copier-monitoring' || currentTab === 'relationships') && (
                  <TradeCopierMonitoringView />
                )}
                {(currentTab === 'audit-logs' || currentTab === 'trade-stream') && (
                  <GlobalLogsView key="audit-logs" initialSubTab="audit" title="System Audit Logs" />
                )}
                {currentTab === 'global-logs' && (
                  <GlobalLogsView key="global-logs" initialSubTab="engine" title="Global Logs" />
                )}
                {currentTab === 'notifications' && (
                  <AdminNotificationsView onNavigateTab={(tab) => setCurrentTab(tab)} />
                )}
                {(currentTab === 'platform-settings' || currentTab === 'settings') && (
                  <PlatformSettingsView />
                )}
                {currentTab === 'admin-profile' && <AdminProfileView />}
              </>
            )}

            {/* MENTOR PORTAL VIEWS */}
            {role === 'mentor' && (
              <>
                {currentTab === 'overview' && (
                  <MentorDashboard
                    onNavigateTab={(tab) => setCurrentTab(tab)}
                    onOpenConnectModal={() => setIsConnectParentOpen(true)}
                    onOpenInviteModal={() => setIsInviteTraderOpen(true)}
                  />
                )}
                {currentTab === 'child-accounts' && <ChildAccountsList />}
                {currentTab === 'invitations' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-bold text-slate-100">Trader Referral &amp; Invitations</h2>
                      <button
                        onClick={() => setIsInviteTraderOpen(true)}
                        className="rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors"
                      >
                        Open Invitation Hub
                      </button>
                    </div>
                    <ChildAccountsList />
                  </div>
                )}
                {currentTab === 'trade-activity' && <MentorActivityView />}
                {currentTab === 'subscription' && <MentorSubscriptionCard />}
                {currentTab === 'notifications' && <NotificationsView />}
                {currentTab === 'settings' && <AccountSettingsView />}
              </>
            )}

            {/* TRADER PORTAL VIEWS */}
            {role === 'trader' && (
              <>
                {currentTab === 'overview' && (
                  <TraderDashboard
                    onNavigateTab={(tab) => setCurrentTab(tab)}
                    onOpenConnectModal={() => setIsConnectChildOpen(true)}
                    onOpenLotModal={() => setIsLotSettingsOpen(true)}
                  />
                )}
                {currentTab === 'mentor-link' && (
                  <MentorLinkView onOpenLotSettings={() => setIsLotSettingsOpen(true)} />
                )}
                {currentTab === 'lot-settings' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-bold text-slate-100">Lot Size Preferences</h2>
                      {traderLink && (
                        <button
                          onClick={() => setIsLotSettingsOpen(true)}
                          className="rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors"
                        >
                          Change Lot Size
                        </button>
                      )}
                    </div>
                    <MentorLinkView onOpenLotSettings={() => setIsLotSettingsOpen(true)} />
                  </div>
                )}
                {currentTab === 'copied-trades' && <CopiedTradesTable />}
                {currentTab === 'failed-trades' && <FailedTradesTable />}
                {currentTab === 'subscription' && <TraderSubscriptionView />}
                {currentTab === 'notifications' && <NotificationsView />}
                {currentTab === 'settings' && <AccountSettingsView />}
              </>
            )}

            {/* Super Admin Restricted Route Guard */}
            {isRestrictedAdminRoute && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-8 text-center space-y-4 shadow-xl">
                <div className="h-12 w-12 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 mx-auto flex items-center justify-center">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Restricted Route</h3>
                  <p className="text-xs text-slate-300 max-w-md mx-auto mt-1 leading-relaxed">
                    Platform-wide administration routes are restricted to verified Super Administrators.
                  </p>
                </div>
                <button
                  onClick={() => setCurrentTab('overview')}
                  className="rounded-lg bg-sky-600 hover:bg-sky-500 px-5 py-2.5 text-xs font-semibold text-white shadow-md transition-colors"
                >
                  Return to Overview
                </button>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Global Modals */}
      <ProvisionMentorModal
        isOpen={isCreateMentorOpen}
        onClose={() => setIsCreateMentorOpen(false)}
        onSuccess={() => {
          setCurrentTab('mentors');
        }}
      />

      <AddTraderModal
        isOpen={isAddTraderOpen}
        onClose={() => setIsAddTraderOpen(false)}
        onSuccess={() => {
          setCurrentTab('traders');
        }}
      />

      <ArchitectureModal
        isOpen={isArchitectureModalOpen}
        onClose={() => setIsArchitectureModalOpen(false)}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      <ConnectParentAccountModal
        isOpen={isConnectParentOpen}
        onClose={() => setIsConnectParentOpen(false)}
      />

      <ConnectChildAccountModal
        isOpen={isConnectChildOpen}
        onClose={() => setIsConnectChildOpen(false)}
      />

      <InviteTraderModal
        isOpen={isInviteTraderOpen}
        onClose={() => setIsInviteTraderOpen(false)}
      />

      {traderLink && (
        <LotSettingsModal
          isOpen={isLotSettingsOpen}
          onClose={() => setIsLotSettingsOpen(false)}
          linkId={traderLink.id}
        />
      )}
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </AuthProvider>
  );
}
