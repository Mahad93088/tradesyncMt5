import React, { useState, useEffect } from 'react';
import {
  Layers,
  Search,
  Filter,
  RefreshCw,
  Eye,
  Server,
  ArrowRight,
  Info,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Sliders,
  ShieldAlert,
  Power,
  ShieldCheck,
  UserCheck,
  UserX
} from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { ParentAccountItem, ChildAccountItem, mt5AdminService } from '../../services/mt5AdminService';
import { AccountDetailsModal } from './AccountDetailsModal';
import { AssignParentModal } from './AssignParentModal';
import { useAuth } from '../../contexts/AuthContext';
import { useApp } from '../../context/AppContext';

export const ChildAccountsView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const { mt5Accounts, users, parentChildLinks, toggleUserStatus, addAuditLog, currentUser } = useApp();

  const [children, setChildren] = useState<ChildAccountItem[]>([]);
  const [parents, setParents] = useState<ParentAccountItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAccountStatus, setFilterAccountStatus] = useState<string>('all');
  const [filterConnectionStatus, setFilterConnectionStatus] = useState<string>('all');
  const [filterParentMentor, setFilterParentMentor] = useState<string>('all');
  const [dataSource, setDataSource] = useState<'supabase' | 'demo_harness'>('demo_harness');

  // Modal states
  const [selectedAccountForDetails, setSelectedAccountForDetails] = useState<ChildAccountItem | null>(null);
  const [selectedChildForAssign, setSelectedChildForAssign] = useState<ChildAccountItem | null>(null);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);

  // Status toggle confirmation
  const [confirmStatusModal, setConfirmStatusModal] = useState<{
    isOpen: boolean;
    child: ChildAccountItem | null;
  }>({
    isOpen: false,
    child: null,
  });

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      const [childrenRes, parentsRes] = await Promise.all([
        mt5AdminService.getChildAccounts({
          demoAccounts: mt5Accounts,
          demoUsers: users,
          demoLinks: parentChildLinks,
          isCloudMode,
        }),
        mt5AdminService.getParentAccounts({
          demoAccounts: mt5Accounts,
          demoUsers: users,
          demoLinks: parentChildLinks,
          isCloudMode,
        }),
      ]);

      setChildren(childrenRes.data);
      setParents(parentsRes.data);
      setDataSource(childrenRes.source);
    } catch (e) {
      console.error('Failed to load child accounts:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, [mt5Accounts, users, parentChildLinks, isCloudMode]);

  // Handle Suspend/Activate action
  const handleToggleStatusConfirm = async () => {
    const child = confirmStatusModal.child;
    if (!child) return;

    try {
      const res = await mt5AdminService.toggleTraderStatus(child.userId, child.traderStatus, isCloudMode);
      
      // Also update in AppContext local state
      toggleUserStatus(child.userId);

      addAuditLog({
        actorId: currentUser.id,
        actorName: currentUser.fullName,
        actorRole: 'admin',
        action: 'TOGGLE_TRADER_STATUS',
        targetResource: 'profiles / mt5_accounts',
        targetId: child.userId,
        result: 'success',
        details: `Trader ${child.traderName} (Child #${child.accountNumber}) status changed to ${res.newStatus}.`,
      });

      await fetchAccounts();
    } catch (err: any) {
      console.error('Error toggling trader status:', err);
    } finally {
      setConfirmStatusModal({ isOpen: false, child: null });
    }
  };

  // Distinct mentors list for the filter dropdown
  const mentorsList = Array.from(
    new Map(
      parents.map((p) => [p.userId, { id: p.userId, name: p.mentorName, accNo: p.accountNumber }])
    ).values()
  );

  // Filtered children
  const filteredChildren = children.filter((c) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      c.traderName.toLowerCase().includes(query) ||
      c.accountNumber.toLowerCase().includes(query) ||
      c.brokerName.toLowerCase().includes(query) ||
      c.brokerServer.toLowerCase().includes(query) ||
      c.traderEmail.toLowerCase().includes(query) ||
      (c.assignedMentorName && c.assignedMentorName.toLowerCase().includes(query));

    const matchesAccountStatus =
      filterAccountStatus === 'all' || c.traderStatus === filterAccountStatus;

    const matchesConnectionStatus =
      filterConnectionStatus === 'all' || c.connectionStatus === filterConnectionStatus;

    let matchesParent = true;
    if (filterParentMentor === 'unassigned') {
      matchesParent = !c.isAssigned;
    } else if (filterParentMentor !== 'all') {
      matchesParent = c.assignedMentorId === filterParentMentor;
    }

    return matchesSearch && matchesAccountStatus && matchesConnectionStatus && matchesParent;
  });

  const unassignedCount = children.filter((c) => !c.isAssigned).length;
  const activeCount = children.filter((c) => c.traderStatus === 'active').length;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Layers className="h-5 w-5 text-emerald-400" />
              Child MT5 Accounts
            </h1>
            <span className="rounded-full bg-emerald-950 border border-emerald-800 px-2.5 py-0.5 text-xs text-emerald-300 font-mono font-medium">
              {children.length} Followers
            </span>
            {unassignedCount > 0 ? (
              <span className="rounded-full bg-amber-950/80 border border-amber-800 px-2.5 py-0.5 text-xs text-amber-300 font-mono font-semibold">
                {unassignedCount} Unassigned
              </span>
            ) : (
              <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs text-slate-400 font-mono">
                All Linked
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Searchable registry of follower client terminals synchronized to master parent trading signals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchAccounts}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-750 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Operational Disclaimer Banner */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2 text-xs">
        <div className="flex items-start gap-3">
          <Info className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-200">Terminal Source:</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                dataSource === 'supabase'
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                  : 'bg-amber-950/80 text-amber-300 border-amber-800'
              }`}>
                {dataSource === 'supabase' ? 'PostgreSQL Supabase (Cloud Database)' : 'Simulated Testnet Environment'}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {isCloudMode ? 'Cloud Mode Active' : 'Demo Mode Active'}
              </span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              <strong>Copy Integrity:</strong> Unassigned child terminals do not duplicate trades until explicitly paired with an authorized mentor parent. Authorized administrators can adjust risk sizing, assign parents, or toggle trading status below.
            </p>
          </div>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/80 p-3.5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search trader, login #, broker, or mentor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* Account Status Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-medium">Account:</span>
            <select
              value={filterAccountStatus}
              onChange={(e) => setFilterAccountStatus(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="all">All Accounts</option>
              <option value="active">Active Only</option>
              <option value="suspended">Suspended Only</option>
            </select>
          </div>

          {/* Connection Status Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-medium">Conn:</span>
            <select
              value={filterConnectionStatus}
              onChange={(e) => setFilterConnectionStatus(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="all">All States</option>
              <option value="connected">Connected</option>
              <option value="disconnected">Disconnected</option>
              <option value="error">Error</option>
            </select>
          </div>

          {/* Parent Mentor Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-medium">Parent:</span>
            <select
              value={filterParentMentor}
              onChange={(e) => setFilterParentMentor(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 max-w-[160px] truncate"
            >
              <option value="all">All Mentors</option>
              <option value="unassigned">⚠️ Unassigned Only</option>
              {mentorsList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (#{m.accNo})
                </option>
              ))}
            </select>
          </div>

          {(searchQuery || filterAccountStatus !== 'all' || filterConnectionStatus !== 'all' || filterParentMentor !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setFilterAccountStatus('all');
                setFilterConnectionStatus('all');
                setFilterParentMentor('all');
              }}
              className="text-[11px] text-emerald-400 hover:underline px-1 py-1"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Child Accounts Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 border-b border-slate-800 text-[10px] font-mono uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-3 px-4">Trader (Follower)</th>
                <th className="py-3 px-4">MT5 Login</th>
                <th className="py-3 px-4">Broker / Server</th>
                <th className="py-3 px-4">Assigned Parent / Mentor</th>
                <th className="py-3 px-4">Copy Mode</th>
                <th className="py-3 px-4">Lot Multiplier / Sizing</th>
                <th className="py-3 px-4">Connection</th>
                <th className="py-3 px-4">Account Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 font-mono">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-emerald-400" />
                      <span>Loading Child MT5 Accounts...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredChildren.length > 0 ? (
                filteredChildren.map((child) => (
                  <tr key={child.id} className="hover:bg-slate-850/50 transition-colors">
                    {/* Trader Name */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-slate-300 overflow-hidden shrink-0">
                          {child.traderAvatar ? (
                            <img src={child.traderAvatar} alt="" className="h-full w-full object-cover" />
                          ) : (
                            child.traderName[0]
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-white truncate">{child.traderName}</div>
                          <div className="text-[10px] text-slate-400 font-mono truncate">{child.traderEmail}</div>
                        </div>
                      </div>
                    </td>

                    {/* MT5 Login */}
                    <td className="py-3 px-4">
                      <span className="font-mono font-bold text-emerald-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        #{child.accountNumber}
                      </span>
                    </td>

                    {/* Broker / Server */}
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-200">{child.brokerName}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{child.brokerServer}</div>
                    </td>

                    {/* Assigned Parent / Mentor */}
                    <td className="py-3 px-4">
                      {child.isAssigned ? (
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                          <div>
                            <div className="font-semibold text-cyan-300 truncate max-w-[150px]">
                              {child.assignedMentorName}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              Master #{child.assignedParentAccountNumber || 'Parent'}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-amber-950/80 border border-amber-800 text-amber-300">
                          <AlertTriangle className="h-3 w-3 text-amber-400" />
                          Unassigned
                        </span>
                      )}
                    </td>

                    {/* Copy Mode */}
                    <td className="py-3 px-4 font-mono text-[11px]">
                      {child.isAssigned ? (
                        <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 uppercase font-semibold">
                          {child.copyMode}
                        </span>
                      ) : (
                        <span className="text-slate-500 italic">N/A</span>
                      )}
                    </td>

                    {/* Lot Multiplier / Fixed Size */}
                    <td className="py-3 px-4 font-mono text-[11px]">
                      {child.isAssigned ? (
                        child.copyMode === 'fixed' ? (
                          <span className="text-slate-300 font-bold">{child.fixedLot.toFixed(2)} Lots Fixed</span>
                        ) : (
                          <span className="text-cyan-400 font-bold">{child.lotMultiplier.toFixed(2)}x Multiplier</span>
                        )
                      ) : (
                        <span className="text-slate-500 italic">—</span>
                      )}
                    </td>

                    {/* Connection Status */}
                    <td className="py-3 px-4">
                      <StatusBadge status={child.connectionStatus} size="sm" />
                      {child.pingMs > 0 && (
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {child.pingMs}ms latency
                        </div>
                      )}
                    </td>

                    {/* Account Status */}
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                        child.traderStatus === 'active'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                          : 'bg-rose-950 text-rose-300 border-rose-800'
                      }`}>
                        {child.traderStatus.toUpperCase()}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Assign / Reassign Parent button */}
                        <button
                          onClick={() => {
                            setSelectedChildForAssign(child);
                            setIsAssignModalOpen(true);
                          }}
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors flex items-center gap-1 border ${
                            child.isAssigned
                              ? 'border-slate-750 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white'
                              : 'border-amber-700 bg-amber-950/80 hover:bg-amber-900 text-amber-200'
                          }`}
                          title={child.isAssigned ? 'Reassign mentor' : 'Assign mentor'}
                        >
                          <Server className="h-3 w-3" />
                          <span>{child.isAssigned ? 'Reassign' : 'Assign Parent'}</span>
                        </button>

                        {/* Suspend / Activate action */}
                        <button
                          onClick={() => setConfirmStatusModal({ isOpen: true, child })}
                          className={`rounded-lg p-1.5 text-xs transition-colors border ${
                            child.traderStatus === 'active'
                              ? 'border-rose-900/60 bg-rose-950/40 text-rose-400 hover:bg-rose-900/60'
                              : 'border-emerald-900/60 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-900/60'
                          }`}
                          title={child.traderStatus === 'active' ? 'Suspend Account' : 'Activate Account'}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>

                        {/* View Details */}
                        <button
                          onClick={() => setSelectedAccountForDetails(child)}
                          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors flex items-center gap-1"
                        >
                          <Eye className="h-3 w-3" />
                          <span className="hidden sm:inline">Details</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <p className="text-xs">No child MT5 accounts match the selected filters.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Account Details Modal */}
      <AccountDetailsModal
        isOpen={Boolean(selectedAccountForDetails)}
        onClose={() => setSelectedAccountForDetails(null)}
        account={selectedAccountForDetails}
        type="child"
        onOpenAssignModal={(acc) => {
          setSelectedChildForAssign(acc as ChildAccountItem);
          setIsAssignModalOpen(true);
        }}
      />

      {/* Assign Parent Modal */}
      <AssignParentModal
        isOpen={isAssignModalOpen}
        onClose={() => {
          setIsAssignModalOpen(false);
          setSelectedChildForAssign(null);
        }}
        targetAccount={selectedChildForAssign}
        type="child"
        allParents={parents}
        allChildren={children}
        onAssignmentSuccess={async () => {
          await fetchAccounts();
        }}
      />

      {/* Suspend / Activate Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmStatusModal.isOpen}
        onClose={() => setConfirmStatusModal({ isOpen: false, child: null })}
        onConfirm={handleToggleStatusConfirm}
        title={confirmStatusModal.child?.traderStatus === 'active' ? 'Suspend Follower Account' : 'Activate Follower Account'}
        description={`Are you sure you want to ${
          confirmStatusModal.child?.traderStatus === 'active' ? 'suspend' : 'activate'
        } trader ${confirmStatusModal.child?.traderName} (MT5 #${confirmStatusModal.child?.accountNumber})? ${
          confirmStatusModal.child?.traderStatus === 'active'
            ? 'Suspended accounts stop receiving copy signals from parent mentors.'
            : 'Activated accounts immediately resume real-time order synchronization.'
        }`}
        confirmLabel={confirmStatusModal.child?.traderStatus === 'active' ? 'Suspend Account' : 'Activate Account'}
        variant={confirmStatusModal.child?.traderStatus === 'active' ? 'danger' : 'primary'}
      />
    </div>
  );
};
