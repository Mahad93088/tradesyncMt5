import React, { useState } from 'react';
import {
  Search,
  PauseCircle,
  PlayCircle,
  Unlink,
  AlertTriangle,
  CheckCircle2,
  Users
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { StatusBadge } from '../common/StatusBadge';
import { ConfirmationModal } from '../common/ConfirmationModal';
import {
  formatLotRuleLabel,
  formatLinkProfitDisplay,
  formatHeartbeatAge,
} from '../common/dashboardHelpers';

export const ChildAccountsList: React.FC = () => {
  const { isCloudMode } = useAuth();
  const {
    currentUser,
    parentChildLinks,
    mt5Accounts,
    followerAccounts,
    toggleLinkStatus,
    unlinkTrader,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'error'>('all');
  const [pendingUnlink, setPendingUnlink] = useState<{ id: string; traderName: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  // Filter links for this mentor
  const mentorLinks = parentChildLinks.filter((l) => l.mentorId === currentUser.id);

  const resolveChildAccount = (childAccountId: string) =>
    followerAccounts.find((a) => a.id === childAccountId) ||
    mt5Accounts.find((a) => a.id === childAccountId);

  const filteredLinks = mentorLinks.filter((link) => {
    const childAccount = resolveChildAccount(link.childAccountId);
    const text = `${link.traderName} ${childAccount?.accountNumber || ''} ${childAccount?.broker || ''}`.toLowerCase();
    const matchesSearch = text.includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || link.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleToggleStatus = async (linkId: string) => {
    setActionFeedback(null);
    const res = await toggleLinkStatus(linkId);
    if (!res.success) {
      setActionFeedback({ message: res.message || 'Failed to update copy link status.', isError: true });
    }
  };

  const handleConfirmUnlink = async () => {
    if (!pendingUnlink) return;
    setIsProcessing(true);
    setActionFeedback(null);
    const res = await unlinkTrader(pendingUnlink.id);
    setIsProcessing(false);
    if (!res.success) {
      setActionFeedback({ message: res.message || 'Failed to remove follower link.', isError: true });
    } else {
      setActionFeedback({ message: `Disconnected follower ${pendingUnlink.traderName}.`, isError: false });
    }
    setPendingUnlink(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            Connected Students & Child Terminals
            <span className="rounded-full bg-cyan-950 border border-cyan-800 px-2 py-0.5 text-xs text-cyan-400 font-mono">
              {mentorLinks.length} Total Traders
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Monitor each assigned child terminal's balance, equity, heartbeat health, and pause or remove followers.
          </p>
        </div>
      </div>

      {actionFeedback && (
        <div
          className={`rounded-xl border p-3 text-xs flex items-center justify-between gap-2 ${
            actionFeedback.isError
              ? 'border-rose-800 bg-rose-950/40 text-rose-300'
              : 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionFeedback.isError ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            )}
            <span>{actionFeedback.message}</span>
          </div>
          <button
            onClick={() => setActionFeedback(null)}
            className="text-[11px] text-slate-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by student name or account #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-400 font-medium">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Followers</option>
            <option value="active">Active Only</option>
            <option value="paused">Paused Only</option>
            <option value="error">Error Only</option>
          </select>
        </div>
      </div>

      {/* Follower Cards Grid */}
      {filteredLinks.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredLinks.map((link) => {
            const childAccount = resolveChildAccount(link.childAccountId);
            const profitInfo = formatLinkProfitDisplay(link, isCloudMode);

            return (
              <div
                key={link.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg backdrop-blur-sm space-y-4 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-white text-sm">{link.traderName}</h4>
                      <StatusBadge status={link.status} size="sm" />
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Linked since {new Date(link.linkedAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(link.id)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                      title={link.status === 'active' ? 'Pause trade copying' : 'Resume trade copying'}
                    >
                      {link.status === 'active' ? (
                        <PauseCircle className="h-5 w-5 text-amber-400" />
                      ) : (
                        <PlayCircle className="h-5 w-5 text-emerald-400" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingUnlink({ id: link.id, traderName: link.traderName })}
                      className="rounded-lg p-2 text-slate-400 hover:bg-rose-950/60 hover:text-rose-400 transition-colors"
                      title="Remove follower assignment"
                    >
                      <Unlink className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* Child MT5 Terminal Specs */}
                {childAccount ? (
                  <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-mono">Terminal Node</span>
                      <p className="font-mono font-bold text-white">#{childAccount.accountNumber}</p>
                      <span className="text-[10px] text-slate-400">
                        {childAccount.broker} • {childAccount.server}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-mono">Connection</span>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <StatusBadge status={childAccount.isStale ? 'error' : childAccount.connectionStatus} size="sm" />
                        <span className={`font-mono text-[10px] ${childAccount.isStale ? 'text-amber-400' : 'text-slate-400'}`}>
                          {childAccount.isStale
                            ? 'Stale Heartbeat'
                            : childAccount.connectionStatus === 'connected'
                            ? formatHeartbeatAge(childAccount.lastHeartbeat)
                            : 'Off'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-mono">Balance / Equity</span>
                      <p className="font-mono font-semibold text-emerald-400">
                        ${childAccount.balance.toLocaleString()} / ${childAccount.equity.toLocaleString()} {childAccount.currency}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-mono">Free Margin</span>
                      <p className="font-mono font-semibold text-slate-200">
                        ${childAccount.freeMargin.toLocaleString()}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-slate-950/40 border border-slate-800/60 p-3 text-slate-500 italic text-xs">
                    Student has not bound a Child MT5 terminal yet.
                  </div>
                )}

                {/* Lot Settings Rule & Performance */}
                <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/80">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-mono">Lot Mode</span>
                    <p className="font-semibold text-white">{formatLotRuleLabel(link.lotSettings)}</p>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 uppercase font-mono">Deals Copied & P&L</span>
                    <p className="font-mono font-bold text-cyan-300">
                      {link.totalTradesCopied} deals
                    </p>
                    <span
                      className={`text-[10px] font-mono ${
                        profitInfo.available
                          ? profitInfo.isPositive
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                          : 'text-slate-400 italic'
                      }`}
                    >
                      {profitInfo.text}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center space-y-2">
          <Users className="h-8 w-8 text-slate-600 mx-auto" />
          <p className="text-sm font-semibold text-slate-300">No linked students match the current filter</p>
          <p className="text-xs text-slate-500">
            Share your Invite Code so students can connect their Child MT5 demo accounts.
          </p>
        </div>
      )}

      <ConfirmationModal
        isOpen={Boolean(pendingUnlink)}
        onClose={() => setPendingUnlink(null)}
        onConfirm={handleConfirmUnlink}
        isLoading={isProcessing}
        variant="danger"
        title="Remove Student Follower"
        description={`Sever copy link for ${pendingUnlink?.traderName || 'this student'}? Future parent deals will no longer be dispatched to their child terminal.`}
        confirmLabel="Remove Follower"
      />
    </div>
  );
};

