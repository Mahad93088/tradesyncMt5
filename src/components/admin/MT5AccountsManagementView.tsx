import React, { useState, useEffect, useCallback } from 'react';
import {
  Server,
  Layers,
  Search,
  RefreshCw,
  Eye,
  Link2,
  Plus,
  Sparkles,
  Power,
  Unlink,
  ShieldCheck,
} from 'lucide-react';
import {
  ParentAccountItem,
  ChildAccountItem,
  mt5AdminService,
} from '../../services/mt5AdminService';
import { useAuth } from '../../contexts/AuthContext';
import { useApp } from '../../context/AppContext';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { AccountDetailsModal } from './AccountDetailsModal';
import { AssignParentModal } from './AssignParentModal';
import { RegisterMT5AccountModal } from './RegisterMT5AccountModal';
import { formatHeartbeatAge } from '../common/dashboardHelpers';
import {
  AdminPageHeader,
  AdminStatCard,
  AdminStatusText,
  AdminFeedbackBanner,
  AdminEmptyState,
} from './adminUi';

interface MT5AccountsManagementViewProps {
  initialTab?: 'all' | 'parent' | 'child';
}

export const MT5AccountsManagementView: React.FC<MT5AccountsManagementViewProps> = ({
  initialTab = 'all',
}) => {
  const { isCloudMode } = useAuth();
  const {
    mt5Accounts,
    users,
    parentChildLinks,
    currentUser,
    addAuditLog,
    refreshCloudData,
    disconnectMT5Account,
    reconnectMT5Account,
  } = useApp();

  const [roleTab, setRoleTab] = useState<'all' | 'parent' | 'child'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'connected' | 'disconnected' | 'error'>('all');

  const [parents, setParents] = useState<ParentAccountItem[]>([]);
  const [children, setChildren] = useState<ChildAccountItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const [detailsTarget, setDetailsTarget] = useState<{
    account: ParentAccountItem | ChildAccountItem;
    type: 'parent' | 'child';
  } | null>(null);

  const [assignModal, setAssignModal] = useState<{
    isOpen: boolean;
    targetAccount: ParentAccountItem | ChildAccountItem | null;
    type: 'parent' | 'child';
  }>({
    isOpen: false,
    targetAccount: null,
    type: 'child',
  });

  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [registerDefaultRole, setRegisterDefaultRole] = useState<'parent' | 'child'>('parent');

  const [confirmToggle, setConfirmToggle] = useState<{
    isOpen: boolean;
    id: string;
    accountNumber: string;
    currentStatus: string;
  }>({ isOpen: false, id: '', accountNumber: '', currentStatus: '' });

  const [confirmUnlink, setConfirmUnlink] = useState<{
    isOpen: boolean;
    childAccountId: string;
    traderId: string;
    assignmentId?: string;
    accountNumber?: string;
  }>({ isOpen: false, childAccountId: '', traderId: '' });

  useEffect(() => {
    setRoleTab(initialTab);
  }, [initialTab]);

  const loadAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const [parentRes, childRes] = await Promise.all([
        mt5AdminService.getParentAccounts({
          demoAccounts: mt5Accounts,
          demoUsers: users,
          demoLinks: parentChildLinks,
          isCloudMode,
        }),
        mt5AdminService.getChildAccounts({
          demoAccounts: mt5Accounts,
          demoUsers: users,
          demoLinks: parentChildLinks,
          isCloudMode,
        }),
      ]);
      setParents(parentRes.data);
      setChildren(childRes.data);
      if (parentRes.error || childRes.error) {
        setFeedback({ type: 'error', message: parentRes.error || childRes.error || 'Error loading MT5 accounts.' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to load MT5 accounts.' });
    } finally {
      setIsLoading(false);
    }
  }, [mt5Accounts, users, parentChildLinks, isCloudMode]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const handleSeedDemo = async () => {
    setIsSeeding(true);
    try {
      const res = await mt5AdminService.seedStandardDemoAccounts({
        isCloudMode,
        currentUserId: currentUser.id,
      });
      if (res.success) {
        setFeedback({ type: 'success', message: 'Standard demo parent and child MT5 accounts provisioned.' });
        await loadAccounts();
      } else {
        setFeedback({ type: 'error', message: res.error || 'Failed to seed demo accounts.' });
      }
    } finally {
      setIsSeeding(false);
    }
  };

  const handleToggleConnection = async () => {
    if (!confirmToggle.id) return;
    const isConnected = confirmToggle.currentStatus === 'connected';
    const nextStatus = isConnected ? 'disconnected' : 'connected';
    const res = await mt5AdminService.updateAccountConnection(confirmToggle.id, nextStatus, isCloudMode);
    if (res.success) {
      if (isConnected) disconnectMT5Account(confirmToggle.id);
      else reconnectMT5Account(confirmToggle.id);
      setFeedback({
        type: 'success',
        message: `Terminal #${confirmToggle.accountNumber} marked ${nextStatus}.`,
      });
      await loadAccounts();
    } else {
      setFeedback({ type: 'error', message: res.error || 'Failed to update terminal connection state.' });
    }
  };

  const handleUnlinkChild = async () => {
    if (!confirmUnlink.traderId) return;
    const res = await mt5AdminService.unassignChild({
      assignmentId: confirmUnlink.assignmentId,
      traderId: confirmUnlink.traderId,
      isCloudMode,
    });
    if (res.success) {
      addAuditLog({
        actorId: currentUser.id,
        actorName: currentUser.fullName,
        actorRole: 'admin',
        action: 'UNLINK_CHILD_ACCOUNT',
        targetResource: 'mentor_assignments',
        targetId: confirmUnlink.childAccountId,
        result: 'success',
        details: `Unlinked child MT5 account #${confirmUnlink.accountNumber || confirmUnlink.childAccountId} from parent mentor.`,
      });
      setFeedback({ type: 'success', message: 'Child account unlinked from parent stream.' });
      await loadAccounts();
      void refreshCloudData();
    } else {
      setFeedback({ type: 'error', message: res.error || 'Failed to unlink child account.' });
    }
  };

  type UnifiedRow =
    | { kind: 'parent'; item: ParentAccountItem }
    | { kind: 'child'; item: ChildAccountItem };

  const unifiedRows: UnifiedRow[] = [
    ...(roleTab !== 'child' ? parents.map((item) => ({ kind: 'parent' as const, item })) : []),
    ...(roleTab !== 'parent' ? children.map((item) => ({ kind: 'child' as const, item })) : []),
  ].filter(({ kind, item }) => {
    const ownerName = kind === 'parent' ? item.mentorName : item.traderName;
    const ownerEmail = kind === 'parent' ? item.mentorEmail : item.traderEmail;
    const text = `${item.accountNumber} ${item.brokerName} ${item.brokerServer} ${ownerName} ${ownerEmail}`.toLowerCase();
    const matchesSearch = text.includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || item.connectionStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalAccounts = parents.length + children.length;
  const connectedCount = [...parents, ...children].filter((a) => a.connectionStatus === 'connected').length;
  const assignedChildrenCount = children.filter((c) => c.isAssigned).length;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="MT5 Account Management"
        meta={`${parents.length} Parent · ${children.length} Child`}
        subtitle="Unified oversight for Parent (Mentor) and Child (Trader) MT5 accounts, broker servers, Demo safeguards, heartbeats, balances, and stream assignments."
        actions={
          <>
            <button
              type="button"
              onClick={() => void loadAccounts()}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-sky-600' : 'text-slate-500'}`} />
              <span>Refresh</span>
            </button>
            {!isCloudMode && (
              <button
                type="button"
                onClick={() => void handleSeedDemo()}
                disabled={isSeeding}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                <span>Seed Demo</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setRegisterDefaultRole(roleTab === 'child' ? 'child' : 'parent');
                setIsRegisterModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Register MT5 Account</span>
            </button>
          </>
        }
      />

      {/* Demo-only restriction & token hygiene notice */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-slate-700">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>
            <strong>Demo-Only Safety Active:</strong> All registered accounts operate under <code className="font-mono text-slate-900 bg-slate-100 px-1 py-0.5 rounded">ACCOUNT_TRADE_MODE_DEMO</code> enforcement. Secret terminal tokens are SHA-256 hashed server-side and never displayed here.
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-500 shrink-0">
          {isCloudMode ? 'Source: Supabase PostgreSQL' : 'Source: Demo Sandbox'}
        </span>
      </div>

      {feedback && (
        <AdminFeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <AdminStatCard
          title="Total MT5 Accounts"
          value={totalAccounts}
          subtitle={`${parents.length} parent · ${children.length} child`}
          icon={Server}
          tone="blue"
        />
        <AdminStatCard
          title="Connected Terminals"
          value={connectedCount}
          subtitle={`${totalAccounts - connectedCount} awaiting or offline`}
          icon={Power}
          tone="emerald"
        />
        <AdminStatCard
          title="Assigned Followers"
          value={assignedChildrenCount}
          subtitle={`${children.length - assignedChildrenCount} unassigned child accounts`}
          icon={Link2}
          tone="blue"
        />
        <AdminStatCard
          title="Demo Safeguard"
          value="DEMO ONLY"
          subtitle="Real-money execution blocked"
          icon={ShieldCheck}
          tone="emerald"
        />
      </div>

      {/* Role Tabs + Search & Status Filter */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {([
            { id: 'all', label: `All Accounts (${totalAccounts})` },
            { id: 'parent', label: `Parent Accounts (${parents.length})` },
            { id: 'child', label: `Child Accounts (${children.length})` },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setRoleTab(tab.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                roleTab === tab.id
                  ? 'bg-white text-slate-900 font-semibold border border-slate-200 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full md:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search account #, broker, owner..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="w-full sm:w-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-500"
          >
            <option value="all">All Connections</option>
            <option value="connected">Connected</option>
            <option value="disconnected">Disconnected</option>
            <option value="error">Error</option>
          </select>
        </div>
      </div>

      {/* Unified MT5 Accounts Table */}
      {unifiedRows.length === 0 ? (
        <AdminEmptyState
          icon={Layers}
          title="No MT5 accounts found"
          description="Register a Parent (Mentor) or Child (Trader) MT5 Demo account to begin bridge synchronization."
          action={
            <button
              type="button"
              onClick={() => setIsRegisterModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Register MT5 Account</span>
            </button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Account &amp; Role</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Broker &amp; Server</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Connection &amp; Heartbeat</th>
                  <th className="px-4 py-3">Balance / Equity</th>
                  <th className="px-4 py-3">Terminal / Mapping</th>
                  <th className="px-4 py-3">Registered</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unifiedRows.map(({ kind, item }) => {
                  const ownerName = kind === 'parent' ? item.mentorName : item.traderName;
                  const ownerEmail = kind === 'parent' ? item.mentorEmail : item.traderEmail;
                  const liveAcc = mt5Accounts.find((m) => m.id === item.id);
                  const isStale = Boolean(liveAcc?.isStale);

                  return (
                    <tr key={`${kind}_${item.id}`} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3.5 font-mono">
                        <div className="font-semibold text-slate-900 tabular-nums">#{item.accountNumber}</div>
                        <span
                          className={`inline-block mt-0.5 rounded border px-1.5 py-0.2 text-[10px] font-semibold uppercase ${
                            kind === 'parent'
                              ? 'border-sky-200 bg-sky-50 text-sky-800'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          }`}
                        >
                          {kind === 'parent' ? 'Parent' : 'Child'}
                        </span>
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900">{ownerName}</div>
                        <span className="text-[11px] text-slate-500">{ownerEmail || 'Verified profile'}</span>
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="text-slate-900 font-medium">{item.brokerName}</div>
                        <span className="font-mono text-[11px] text-slate-500">{item.brokerServer}</span>
                      </td>

                      <td className="px-4 py-3.5">
                        <AdminStatusText status={item.accountType === 'live' ? 'error' : 'verified'} />
                        <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                          {item.accountType === 'live' ? 'Live (Blocked)' : 'Demo Only'}
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <AdminStatusText status={isStale ? 'stale' : item.connectionStatus} />
                        <div
                          className="font-mono text-[11px] text-slate-500 mt-0.5 tabular-nums"
                          title={item.lastSync}
                        >
                          {formatHeartbeatAge(item.lastSync)}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 font-mono tabular-nums">
                        <div className="text-slate-900 font-semibold">${item.balance.toLocaleString()}</div>
                        <div className="text-[11px] text-emerald-700">Eq: ${item.equity.toLocaleString()}</div>
                      </td>

                      <td className="px-4 py-3.5 text-[11px]">
                        <div className="font-mono text-slate-700">
                          EA: {item.autoTradingEnabled ? 'Enabled' : 'Disabled'}
                        </div>
                        {kind === 'parent' ? (
                          <span className="text-slate-500 font-mono tabular-nums">
                            {item.assignedChildCount} follower(s)
                          </span>
                        ) : item.isAssigned ? (
                          <span className="text-sky-700 font-medium truncate block max-w-[140px]">
                            Parent: {item.assignedMentorName || `#${item.assignedParentAccountNumber || ''}`}
                          </span>
                        ) : (
                          <span className="text-amber-700 font-medium">Unassigned</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-500 tabular-nums">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetailsTarget({ account: item, type: kind })}
                            className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                            title="View account details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setAssignModal({
                                isOpen: true,
                                targetAccount: item,
                                type: kind,
                              })
                            }
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap transition-colors"
                          >
                            {kind === 'parent' ? 'Link Child' : item.isAssigned ? 'Reassign' : 'Assign'}
                          </button>

                          {kind === 'child' && item.isAssigned && (
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmUnlink({
                                  isOpen: true,
                                  childAccountId: item.id,
                                  traderId: item.userId,
                                  assignmentId: item.assignmentId,
                                  accountNumber: item.accountNumber,
                                })
                              }
                              className="rounded-md border border-slate-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50 transition-colors"
                              title="Unlink from mentor"
                            >
                              <Unlink className="h-3.5 w-3.5" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              setConfirmToggle({
                                isOpen: true,
                                id: item.id,
                                accountNumber: item.accountNumber,
                                currentStatus: item.connectionStatus,
                              })
                            }
                            className={`rounded-md px-2 py-1 text-[11px] font-semibold border whitespace-nowrap transition-colors ${
                              item.connectionStatus === 'connected'
                                ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {item.connectionStatus === 'connected' ? 'Suspend' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Account Details Modal */}
      <AccountDetailsModal
        isOpen={Boolean(detailsTarget)}
        onClose={() => setDetailsTarget(null)}
        account={detailsTarget?.account || null}
        type={detailsTarget?.type || 'parent'}
        onOpenAssignModal={(acc) => {
          setDetailsTarget(null);
          setAssignModal({
            isOpen: true,
            targetAccount: acc,
            type: acc.accountRole,
          });
        }}
        onUnlinkChild={(childAccountId, traderId, assignmentId) => {
          setDetailsTarget(null);
          setConfirmUnlink({
            isOpen: true,
            childAccountId,
            traderId,
            assignmentId,
          });
        }}
      />

      {/* Assign Parent/Child Modal */}
      <AssignParentModal
        isOpen={assignModal.isOpen}
        onClose={() => setAssignModal({ isOpen: false, targetAccount: null, type: 'child' })}
        targetAccount={assignModal.targetAccount}
        type={assignModal.type}
        allParents={parents}
        allChildren={children}
        onAssignmentSuccess={(msg) => {
          if (msg) setFeedback({ type: 'success', message: msg });
          void loadAccounts();
          void refreshCloudData();
        }}
      />

      {/* Register MT5 Account Modal */}
      <RegisterMT5AccountModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        defaultRole={registerDefaultRole}
        onSuccess={() => {
          void loadAccounts();
          void refreshCloudData();
        }}
      />

      {/* Confirm Connection Toggle */}
      <ConfirmationModal
        isOpen={confirmToggle.isOpen}
        onClose={() => setConfirmToggle({ isOpen: false, id: '', accountNumber: '', currentStatus: '' })}
        onConfirm={() => {
          void handleToggleConnection();
        }}
        title={confirmToggle.currentStatus === 'connected' ? 'Suspend MT5 Terminal' : 'Activate MT5 Terminal'}
        description={
          confirmToggle.currentStatus === 'connected'
            ? `Suspend terminal #${confirmToggle.accountNumber}? Copier synchronization for this account will pause immediately.`
            : `Reactivate terminal #${confirmToggle.accountNumber} for copier synchronization?`
        }
        confirmLabel={confirmToggle.currentStatus === 'connected' ? 'Suspend Terminal' : 'Activate Terminal'}
        variant={confirmToggle.currentStatus === 'connected' ? 'danger' : 'primary'}
      />

      {/* Confirm Unlink */}
      <ConfirmationModal
        isOpen={confirmUnlink.isOpen}
        onClose={() => setConfirmUnlink({ isOpen: false, childAccountId: '', traderId: '' })}
        onConfirm={() => {
          void handleUnlinkChild();
        }}
        title="Unlink Child Account"
        description={`Unlink Child MT5 account #${confirmUnlink.accountNumber || confirmUnlink.childAccountId} from its assigned mentor? Future trades will not be copied.`}
        confirmLabel="Unlink Account"
        variant="warning"
      />
    </div>
  );
};
