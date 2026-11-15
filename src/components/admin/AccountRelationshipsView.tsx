import React, { useState } from 'react';
import {
  Search,
  ArrowRight,
  PauseCircle,
  PlayCircle,
  Unlink,
  AlertCircle,
  CheckCircle2,
  X
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { StatusBadge } from '../common/StatusBadge';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { ParentChildLink } from '../../types';

export const AccountRelationshipsView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const { parentChildLinks, mt5Accounts, toggleLinkStatus, unlinkTrader } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterMentor, setFilterMentor] = useState<string>('all');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState<ParentChildLink | null>(null);

  const filteredLinks = parentChildLinks.filter((link) => {
    const matchesSearch =
      link.mentorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      link.traderName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMentor = filterMentor === 'all' || link.mentorId === filterMentor;
    return matchesSearch && matchesMentor;
  });

  const mentorsList = Array.from(
    new Map(parentChildLinks.map((l) => [l.mentorId, { id: l.mentorId, name: l.mentorName }])).values()
  );

  const activeCount = parentChildLinks.filter((l) => l.status === 'active').length;

  const handleToggleLink = async (linkId: string) => {
    setFeedback(null);
    const res = await toggleLinkStatus(linkId);
    if (!res.success) {
      setFeedback({ type: 'error', message: res.message || 'Failed to update assignment status.' });
    } else {
      setFeedback({ type: 'success', message: 'Assignment status updated.' });
    }
  };

  const handleConfirmUnlink = async () => {
    if (!confirmUnlink) return;
    setFeedback(null);
    const res = await unlinkTrader(confirmUnlink.id);
    if (!res.success) {
      setFeedback({ type: 'error', message: res.message || 'Failed to unlink assignment.' });
    } else {
      setFeedback({
        type: 'success',
        message: `Unlinked ${confirmUnlink.traderName} from ${confirmUnlink.mentorName}.`,
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            Parent-Child Account Relationships
            <span className="rounded-full bg-cyan-950 border border-cyan-800 px-2 py-0.5 text-xs text-cyan-400 font-mono">
              {activeCount} Active / {parentChildLinks.length} Total
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Visual map of mentor parent MT5 accounts and all downstream follower terminal connections.
          </p>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border p-3 text-xs flex items-center justify-between ${
            feedback.type === 'error'
              ? 'border-rose-800/60 bg-rose-950/40 text-rose-300'
              : 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'error' ? (
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by mentor or trader..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-400 font-medium">Mentor:</span>
          <select
            value={filterMentor}
            onChange={(e) => setFilterMentor(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
          >
            <option value="all">All Mentors</option>
            {mentorsList.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Relationship Cards Grid */}
      <div className="grid grid-cols-1 gap-4">
        {filteredLinks.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-10 text-center text-xs text-slate-500">
            No parent-child account assignments found matching the current filter.
          </div>
        ) : (
          filteredLinks.map((link) => {
            const parentAccount = mt5Accounts.find((a) => a.id === link.parentAccountId);
            const childAccount = mt5Accounts.find((a) => a.id === link.childAccountId);
            const anyStale = Boolean(parentAccount?.isStale || childAccount?.isStale);

            return (
              <div
                key={link.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg backdrop-blur-sm hover:border-slate-700 transition-all"
              >
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                  {/* Visual Flow: Parent -> Child */}
                  <div className="flex flex-1 flex-col sm:flex-row items-start sm:items-center gap-4">
                    {/* Parent Terminal Node */}
                    <div className="flex-1 rounded-xl bg-slate-950/70 border border-slate-800 p-3.5 space-y-1.5 min-w-[200px]">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold text-cyan-400 font-mono tracking-wider">
                          Master Parent
                        </span>
                        {parentAccount && <StatusBadge status={parentAccount.connectionStatus} size="sm" />}
                      </div>
                      <h4 className="font-bold text-white text-sm">{link.mentorName}</h4>
                      {parentAccount ? (
                        <div className="font-mono text-[11px] text-slate-300">
                          <div>#{parentAccount.accountNumber} ({parentAccount.broker})</div>
                          <div className="text-[10px] text-slate-400">
                            {parentAccount.server} • Eq: ${parentAccount.equity.toLocaleString()}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-xs italic">No terminal linked</span>
                      )}
                    </div>

                    {/* Flow Arrow & Latency Badge */}
                    <div className="flex flex-col items-center justify-center px-2 py-1 shrink-0 self-center">
                      <div className="flex items-center gap-1 text-cyan-400 font-mono text-[11px] font-bold">
                        <ArrowRight className="h-4 w-4" />
                        <span>STREAM</span>
                      </div>
                      <span className={`text-[10px] font-mono mt-0.5 ${anyStale ? 'text-amber-400' : 'text-slate-500'}`}>
                        {anyStale
                          ? 'Stale'
                          : childAccount && childAccount.connectionStatus === 'connected'
                          ? `${childAccount.pingMs}ms`
                          : 'Off'}
                      </span>
                    </div>

                    {/* Child Terminal Node */}
                    <div className="flex-1 rounded-xl bg-slate-950/70 border border-slate-800 p-3.5 space-y-1.5 min-w-[200px]">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold text-emerald-400 font-mono tracking-wider">
                          Follower Child
                        </span>
                        {childAccount && <StatusBadge status={childAccount.connectionStatus} size="sm" />}
                      </div>
                      <h4 className="font-bold text-white text-sm">{link.traderName}</h4>
                      {childAccount ? (
                        <div className="font-mono text-[11px] text-slate-300">
                          <div>#{childAccount.accountNumber} ({childAccount.broker})</div>
                          <div className="text-[10px] text-slate-400">
                            {childAccount.server} • Eq: ${childAccount.equity.toLocaleString()}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-xs italic">No terminal linked</span>
                      )}
                    </div>
                  </div>

                  {/* Lot Rules & Stats */}
                  <div className="flex flex-wrap items-center gap-4 border-t lg:border-t-0 lg:border-l border-slate-800 pt-3 lg:pt-0 lg:pl-5 text-xs">
                    {/* Lot Mode */}
                    <div className="min-w-[130px]">
                      <span className="text-[10px] uppercase font-bold text-slate-500 font-mono">Lot Rules</span>
                      <div className="font-semibold text-white mt-0.5">
                        {link.lotSettings.mode === 'parent_lot' ? (
                          <span className="text-indigo-400">1:1 Direct Lot</span>
                        ) : (
                          <span className="text-cyan-400">
                            {link.lotSettings.customType.toUpperCase()}:{' '}
                            {link.lotSettings.customType === 'fixed'
                              ? `${link.lotSettings.fixedLot} lot`
                              : link.lotSettings.customType === 'multiplier'
                              ? `${link.lotSettings.multiplier}x`
                              : link.lotSettings.customType === 'equity_ratio'
                              ? 'Proportional'
                              : `${link.lotSettings.riskPercent}% risk`}
                          </span>
                        )}
                      </div>
                      {!isCloudMode && (
                        <div className="text-[10px] text-slate-400 font-mono">
                          Cap: {link.lotSettings.maxLotCap}L • Slip: {link.lotSettings.slippageMaxPips}p
                        </div>
                      )}
                    </div>

                    {/* Volume Copied */}
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-500 font-mono">Performance</span>
                      <div className="font-mono text-white font-bold mt-0.5">
                        {link.totalTradesCopied} deals
                      </div>
                      {isCloudMode && link.totalProfitAvailable === false ? (
                        <div className="text-[10px] text-slate-400 italic">Deal P&amp;L awaiting EA sync</div>
                      ) : (
                        <div className={`font-mono text-[11px] font-bold ${link.totalProfitUSD >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {link.totalProfitUSD >= 0 ? '+' : ''}${link.totalProfitUSD.toLocaleString()}
                        </div>
                      )}
                    </div>

                    {/* Stream Status & Actions */}
                    <div className="flex items-center gap-2">
                      <StatusBadge status={link.status} size="sm" />

                      <button
                        onClick={() => void handleToggleLink(link.id)}
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
                        onClick={() => setConfirmUnlink(link)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-rose-950/60 hover:text-rose-400 transition-colors"
                        title="Sever parent-child link"
                      >
                        <Unlink className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <ConfirmationModal
        isOpen={Boolean(confirmUnlink)}
        onClose={() => setConfirmUnlink(null)}
        onConfirm={() => {
          void handleConfirmUnlink();
        }}
        title="Unlink Parent-Child Copy Stream"
        description={`Are you sure you want to unlink follower ${confirmUnlink?.traderName} from mentor ${confirmUnlink?.mentorName}? Automated copy execution for this pair will stop immediately.`}
        confirmLabel="Unlink Stream"
        variant="danger"
      />
    </div>
  );
};
