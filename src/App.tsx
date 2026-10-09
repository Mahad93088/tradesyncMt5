import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar } from './components/common/Navbar';
import { Sidebar } from './components/common/Sidebar';
import { SimulationToolbar } from './components/common/SimulationToolbar';
import { ArchitectureModal } from './components/common/ArchitectureModal';

// Admin Views
import { AdminDashboard } from './components/admin/AdminDashboard';
import { MentorsManagement } from './components/admin/MentorsManagement';
import { ProvisionMentorModal } from './components/admin/ProvisionMentorModal';
import { TradersManagement } from './components/admin/TradersManagement';
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
  const { currentUser, isArchitectureModalOpen, setIsArchitectureModalOpen, parentChildLinks } = useApp();

  const [currentTab, setCurrentTab] = useState<string>('overview');

  // Modal states
  const [isCreateMentorOpen, setIsCreateMentorOpen] = useState(false);
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
      <Navbar />

      {/* Interactive Simulation Harness Toolbar */}
      <SimulationToolbar />

      {/* Main Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Dynamic Sidebar */}
        <Sidebar currentTab={currentTab} onTabChange={(tab) => setCurrentTab(tab)} />

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
                  />
                )}
                {currentTab === 'mentors' && (
                  <MentorsManagement
                    isCreateOpen={isCreateMentorOpen}
                    setIsCreateOpen={setIsCreateMentorOpen}
                  />
                )}
                {currentTab === 'traders' && <TradersManagement />}
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

      <ArchitectureModal
        isOpen={isArchitectureModalOpen}
        onClose={() => setIsArchitectureModalOpen(false)}
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
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
