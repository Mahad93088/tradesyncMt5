import React, { useState, useEffect } from 'react';
import {
  Server,
  Search,
  Filter,
  RefreshCw,
  Plus,
  Eye,
  Layers,
  ArrowRight,
  Info,
  CheckCircle2,
  AlertTriangle,
  Radio,
  ExternalLink,
  ShieldCheck,
  UserCheck,
  Sparkles,
  AlertCircle
} from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';
import { ParentAccountItem, ChildAccountItem, mt5AdminService } from '../../services/mt5AdminService';
import { AccountDetailsModal } from './AccountDetailsModal';
import { AssignParentModal } from './AssignParentModal';
import { CreateDemoAccountModal } from './CreateDemoAccountModal';
import { useAuth } from '../../contexts/AuthContext';
import { useApp } from '../../context/AppContext';

export const ParentAccountsView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const { mt5Accounts, users, parentChildLinks, unlinkTrader, addAuditLog, currentUser } = useApp();

  const [parents, setParents] = useState<ParentAccountItem[]>([]);
  const [children, setChildren] = useState<ChildAccountItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterAccountType, setFilterAccountType] = useState<string>('all');
  const [dataSource, setDataSource] = useState<'supabase' | 'demo_harness'>('demo_harness');

  // Modal states
  const [selectedAccountForDetails, setSelectedAccountForDetails] = useState<ParentAccountItem | null>(null);
  const [selectedParentForAssign, setSelectedParentForAssign] = useState<ParentAccountItem | null>(null);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isCreateDemoModalOpen, setIsCreateDemoModalOpen] = useState(false);

  // Seeding state
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedNotice, setSeedNotice] = useState<string | null>(null);

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      const [parentsRes, childrenRes] = await Promise.all([
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

      setParents(parentsRes.data);
      setChildren(childrenRes.data);
      setDataSource(parentsRes.source);
    } catch (e) {
      console.error('Failed to load parent accounts:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, [mt5Accounts, users, parentChildLinks, isCloudMode]);

  const handleSeedDemoAccounts = async () => {
    setIsSeeding(true);
    setSeedNotice(null);
    try {
      const res = await mt5AdminService.seedStandardDemoAccounts({
        isCloudMode,
        currentUserId: currentUser.id,
      });

      if (res.success) {
        setSeedNotice('Successfully provisioned sandbox demo accounts! Refreshing list...');
        await fetchAccounts();
        setTimeout(() => setSeedNotice(null), 4000);
      }
    } catch (err: any) {
      console.error('Failed to seed demo accounts:', err);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleUnlinkChild = async (childAccountId: string, traderId: string, assignmentId?: string) => {
    if (!window.confirm('Are you sure you want to unlink this child account from the master parent?')) {
      return;
    }

    try {
      await mt5AdminService.unassignChild({ assignmentId, traderId, isCloudMode });

      // Also unlink in local state if link exists
      const link = parentChildLinks.find((l) => l.childAccountId === childAccountId || l.traderId === traderId);
      if (link) {
        unlinkTrader(link.id);
      }

      addAuditLog({
        actorId: currentUser.id,
        actorName: currentUser.fullName,
        actorRole: 'admin',
        action: 'UNLINK_CHILD_ACCOUNT',
        targetResource: 'mt5_accounts / mentor_assignments',
        targetId: childAccountId,
        result: 'success',
        details: `Unlinked child account #${childAccountId} from parent stream.`,
      });

      // Refresh list
      await fetchAccounts();

      // If details modal was open, refresh its data
      if (selectedAccountForDetails) {
        const updated = parents.find((p) => p.id === selectedAccountForDetails.id);
        if (updated) setSelectedAccountForDetails(updated);
      }
    } catch (err: any) {
      console.error('Failed to unlink child:', err);
    }
  };

  // Filtered Parents
  const filteredParents = parents.filter((p) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      p.mentorName.toLowerCase().includes(query) ||
      p.accountNumber.toLowerCase().includes(query) ||
      p.brokerName.toLowerCase().includes(query) ||
      p.brokerServer.toLowerCase().includes(query) ||
      p.mentorEmail.toLowerCase().includes(query);

    const matchesStatus = filterStatus === 'all' || p.connectionStatus === filterStatus;
    const matchesType = filterAccountType === 'all' || p.accountType === filterAccountType;

    return matchesSearch && matchesStatus && matchesType;
  });

  const totalAssignedChildren = parents.reduce((sum, p) => sum + p.assignedChildCount, 0);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Server className="h-5 w-5 text-cyan-400" />
              Parent MT5 Accounts
            </h1>
            <span className="rounded-full bg-cyan-950 border border-cyan-800 px-2.5 py-0.5 text-xs text-cyan-300 font-mono font-medium">
              {parents.length} Masters
            </span>
            <span className="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300 font-mono">
              {totalAssignedChildren} Assigned Children
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Searchable registry of mentor master trading terminals broadcast across follower copy streams.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleSeedDemoAccounts}
            disabled={isSeeding || isLoading}
            className="flex items-center gap-1.5 rounded-lg border border-amber-600/40 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
            title="Seed sandbox demo parent and child accounts for testing"
          >
            <Sparkles className={`h-3.5 w-3.5 ${isSeeding ? 'animate-spin' : ''}`} />
            <span>{isSeeding ? 'Provisioning...' : 'Seed Demo Accounts'}</span>
          </button>

          <button
            onClick={() => setIsCreateDemoModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Demo Parent</span>
          </button>

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

      {seedNotice && (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/60 p-3 flex items-center gap-2 text-xs text-emerald-300 animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>{seedNotice}</span>
        </div>
      )}

      {/* Operational Disclaimer & Demo / Live Distinction Banner */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2 text-xs">
        <div className="flex items-start gap-3">
          <Info className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
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
              Parent terminals broadcast orders to child terminals based on Row-Level Security and active mentor assignments. Demo accounts are simulated sandbox bridges for testing sizing and execution routing.
            </p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by mentor name, account #, broker, or server..."
            className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Statuses</option>
            <option value="connected">Connected</option>
            <option value="disconnected">Disconnected</option>
            <option value="connecting">Connecting</option>
            <option value="error">Error</option>
          </select>

          <select
            value={filterAccountType}
            onChange={(e) => setFilterAccountType(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Account Types</option>
            <option value="demo">Demo Only</option>
            <option value="live">Live Broker</option>
          </select>
        </div>
      </div>

      {/* Accounts Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 border-b border-slate-800 text-slate-400 font-medium">
              <tr>
                <th className="py-3 px-4">Master Mentor</th>
                <th className="py-3 px-4">MT5 Account #</th>
                <th className="py-3 px-4">Broker / Server</th>
                <th className="py-3 px-4">Account Type</th>
                <th className="py-3 px-4">Connection</th>
                <th className="py-3 px-4 text-right">Balance / Equity</th>
                <th className="py-3 px-4 text-center">Assigned Children</th>
                <th className="py-3 px-4">Registered</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-cyan-400" />
                    <p className="text-xs">Loading Parent MT5 Accounts...</p>
                  </td>
                </tr>
              ) : filteredParents.length > 0 ? (
                filteredParents.map((parent) => (
                  <tr key={parent.id} className="hover:bg-slate-800/40 transition-colors">
                    {/* Mentor Info */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        {parent.mentorAvatar ? (
                          <img
                            src={parent.mentorAvatar}
                            alt={parent.mentorName}
                            className="h-7 w-7 rounded-full object-cover border border-slate-700"
                          />
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-300 font-bold flex items-center justify-center text-[10px]">
                            {parent.mentorName.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="font-semibold text-white flex items-center gap-1.5">
                            <span>{parent.mentorName}</span>
                            <span className="text-[10px] text-cyan-400 font-mono">Master</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">{parent.mentorEmail}</div>
                        </div>
                      </div>
                    </td>

                    {/* Account Number */}
                    <td className="py-3 px-4 font-mono font-bold text-white">
                      #{parent.accountNumber}
                    </td>

                    {/* Broker & Server */}
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-200">{parent.brokerName}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{parent.brokerServer}</div>
                    </td>

                    {/* Account Type */}
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                        parent.accountType === 'live'
                          ? 'bg-rose-950/70 text-rose-300 border-rose-800'
                          : 'bg-cyan-950/70 text-cyan-300 border-cyan-800'
                      }`}>
                        {parent.accountType}
                      </span>
                    </td>

                    {/* Connection Status */}
                    <td className="py-3 px-4">
                      <StatusBadge status={parent.connectionStatus} size="sm" />
                      {parent.pingMs > 0 && (
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {parent.pingMs}ms latency
                        </div>
                      )}
                    </td>

                    {/* Balance / Equity */}
                    <td className="py-3 px-4 text-right font-mono">
                      <div className="font-bold text-slate-100">
                        ${parent.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-[10px] text-emerald-400">
                        Eq: ${parent.equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </div>
                    </td>

                    {/* Number of Assigned Children */}
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border ${
                        parent.assignedChildCount > 0
                          ? 'bg-cyan-950 text-cyan-300 border-cyan-800'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        <Layers className="h-3 w-3" />
                        {parent.assignedChildCount}
                      </span>
                    </td>

                    {/* Creation Date */}
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                      {new Date(parent.createdAt).toLocaleDateString()}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => {
                            setSelectedParentForAssign(parent);
                            setIsAssignModalOpen(true);
                          }}
                          className="rounded-lg border border-slate-750 bg-slate-800 hover:bg-slate-750 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white transition-colors flex items-center gap-1"
                          title="Assign child account to this parent"
                        >
                          <Plus className="h-3 w-3" />
                          <span className="hidden sm:inline">Assign Child</span>
                        </button>
                        <button
                          onClick={() => setSelectedAccountForDetails(parent)}
                          className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-1 text-xs font-semibold text-white shadow-sm transition-colors flex items-center gap-1"
                        >
                          <Eye className="h-3 w-3" />
                          <span>View Details</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    {parents.length === 0 ? (
                      <div className="max-w-md mx-auto space-y-3 p-4">
                        <div className="p-3 bg-slate-800/80 rounded-full w-12 h-12 flex items-center justify-center mx-auto text-cyan-400 border border-slate-700">
                          <Server className="h-6 w-6" />
                        </div>
                        <h4 className="text-sm font-bold text-white">No Parent MT5 Accounts Found</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          No mentor master trading accounts are currently provisioned in the system. You can provision demo accounts for sandbox routing tests or create a custom account record.
                        </p>
                        <div className="flex items-center justify-center gap-2 pt-2">
                          <button
                            type="button"
                            onClick={handleSeedDemoAccounts}
                            disabled={isSeeding}
                            className="rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 px-3.5 py-1.5 text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>⚡ Seed Sandbox Demo Accounts</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsCreateDemoModalOpen(true)}
                            className="rounded-lg bg-slate-800 hover:bg-slate-700 text-white px-3.5 py-1.5 text-xs font-medium border border-slate-700 transition-colors flex items-center gap-1"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>Create Demo Parent</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs">No parent MT5 accounts match the selected filters.</p>
                    )}
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
        type="parent"
        onOpenAssignModal={(acc) => {
          setSelectedParentForAssign(acc as ParentAccountItem);
          setIsAssignModalOpen(true);
        }}
        onUnlinkChild={handleUnlinkChild}
      />

      {/* Assign Parent Modal */}
      <AssignParentModal
        isOpen={isAssignModalOpen}
        onClose={() => {
          setIsAssignModalOpen(false);
          setSelectedParentForAssign(null);
        }}
        targetAccount={selectedParentForAssign}
        type="parent"
        allParents={parents}
        allChildren={children}
        onAssignmentSuccess={async () => {
          await fetchAccounts();
        }}
      />

      {/* Create Demo Account Modal */}
      <CreateDemoAccountModal
        isOpen={isCreateDemoModalOpen}
        onClose={() => setIsCreateDemoModalOpen(false)}
        defaultRole="parent"
        onSuccess={async () => {
          await fetchAccounts();
        }}
      />
    </div>
  );
};
