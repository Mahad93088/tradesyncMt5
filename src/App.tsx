import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { AuthProvider } from './contexts/AuthContext';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/common/Navbar';
import { Sidebar } from './components/common/Sidebar';
import { SimulationToolbar } from './components/common/SimulationToolbar';
import { ArchitectureModal } from './components/common/ArchitectureModal';
import { AuthModal } from './components/common/AuthModal';

// Admin Views
import { AdminDashboard } from './components/admin/AdminDashboard';
import { ParentAccountsView } from './components/admin/ParentAccountsView';
import { ChildAccountsView } from './components/admin/ChildAccountsView';
import { MentorsManagement } from './components/admin/MentorsManagement';
import { ProvisionMentorModal } from './components/admin/ProvisionMentorModal';
import { TradersManagement } from './components/admin/TradersManagement';
import { AddTraderModal } from './components/admin/AddTraderModal';
import { SubscriptionPlansView } from './components/admin/SubscriptionPlansView';
import { AccountRelationshipsView } from './components/admin/AccountRelationshipsView';
import { ConnectionsView } from './components/admin/ConnectionsView';
import { GlobalLogsView } from './components/admin/GlobalLogsView';
import { SystemHealthView } from './components/admin/SystemHealthView';

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

const AppContent: React.FC = () => {
  const {
    currentUser,
    isArchitectureModalOpen,
    setIsArchitectureModalOpen,
    isAuthModalOpen,
    setIsAuthModalOpen,
    parentChildLinks,
    switchRole
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

  // Active link for lot settings modal
  const traderLink = parentChildLinks.find((l) => l.traderId === currentUser.id);

  // When role changes, if the tab is not applicable, default to overview
  const role = currentUser.role;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/20 selection:text-cyan-200">
      {/* Top Navbar */}
      <Navbar
        onToggleMobileNav={() => setIsMobileNavOpen(!isMobileNavOpen)}
        currentTab={currentTab}
        onTabChange={(tab) => setCurrentTab(tab)}
      />

      {/* Interactive Simulation Harness Toolbar */}
      <SimulationToolbar />

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
                {(currentTab === 'parent-accounts' || currentTab === 'admin-parent-accounts') && (
                  <ParentAccountsView />
                )}
                {(currentTab === 'child-accounts' || currentTab === 'admin-child-accounts') && (
                  <ChildAccountsView />
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
                {currentTab === 'plans' && <SubscriptionPlansView />}
                {currentTab === 'relationships' && <AccountRelationshipsView />}
                {currentTab === 'connections' && <ConnectionsView />}
                {currentTab === 'trade-stream' && <GlobalLogsView />}
                {currentTab === 'system-health' && <SystemHealthView />}
                {currentTab === 'audit-logs' && <GlobalLogsView />}
                {currentTab === 'notifications' && <NotificationsView />}
                {currentTab === 'settings' && <AccountSettingsView />}
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
                      <h2 className="text-xl font-bold text-slate-100">Trader Referral & Invitations</h2>
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
                      <h2 className="text-xl font-bold text-slate-100">Lot Size & Risk Controls</h2>
                      {traderLink && (
                        <button
                          onClick={() => setIsLotSettingsOpen(true)}
                          className="rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors"
                        >
                          Modify Sizing Parameters
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

            {/* Super Admin MT5 Accounts Guard & Quick Jump */}
            {role !== 'admin' && (currentTab === 'parent-accounts' || currentTab === 'child-accounts') && (
              <div className="rounded-2xl border border-sky-800 bg-slate-900/90 p-8 text-center space-y-4 shadow-xl">
                <div className="h-12 w-12 rounded-xl bg-sky-950 border border-sky-800 text-sky-400 mx-auto flex items-center justify-center">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Super Admin Access Required</h3>
                  <p className="text-xs text-slate-300 max-w-md mx-auto mt-1 leading-relaxed">
                    {currentTab === 'parent-accounts' ? 'Parent MT5 Accounts' : 'Child MT5 Accounts'} management is part of the Super Admin Portal. Click below to switch to your Super Admin workspace.
                  </p>
                </div>
                <button
                  onClick={() => switchRole('admin')}
                  className="rounded-lg bg-sky-600 hover:bg-sky-500 px-5 py-2.5 text-xs font-semibold text-white shadow-md transition-colors"
                >
                  Switch to Super Admin View
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
