import React, { useState } from 'react';
import {
  Users,
  Search,
  PauseCircle,
  PlayCircle,
  Unlink,
  Server,
  Activity,
  AlertTriangle,
  Sliders,
  DollarSign
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from '../common/StatusBadge';

export const ChildAccountsList: React.FC = () => {
  const { currentUser, parentChildLinks, mt5Accounts, toggleLinkStatus, unlinkTrader } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'error'>('all');

  // Filter links for this mentor
  const mentorLinks = parentChildLinks.filter((l) => l.mentorId === currentUser.id);

  const filteredLinks = mentorLinks.filter((link) => {
    const childAccount = mt5Accounts.find((a) => a.id === link.childAccountId);
    const text = `${link.traderName} ${childAccount?.accountNumber || ''} ${childAccount?.broker || ''}`.toLowerCase();
    const matchesSearch = text.includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || link.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            Connected Followers & Child Terminals
            <span className="rounded-full bg-cyan-950 border border-cyan-800 px-2 py-0.5 text-xs text-cyan-400 font-mono">
              {mentorLinks.length} Total Traders
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Manage your follower pool, check individual child terminal health, and pause or resume copy streams.
          </p>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by follower name or account #..."
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredLinks.map((link) => {
          const childAccount = mt5Accounts.find((a) => a.id === link.childAccountId);

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
                    onClick={() => toggleLinkStatus(link.id)}
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
                    onClick={() => unlinkTrader(link.id)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-rose-950/60 hover:text-rose-400 transition-colors"
                    title="Disconnect follower"
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
                    <span className="text-[10px] text-slate-400">{childAccount.broker}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-mono">Connection</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <StatusBadge status={childAccount.connectionStatus} size="sm" />
                      <span className="font-mono text-[10px] text-slate-400">
                        {childAccount.connectionStatus === 'connected' ? `${childAccount.pingMs}ms` : 'Off'}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-mono">Equity</span>
                    <p className="font-mono font-semibold text-emerald-400">
                      ${childAccount.equity.toLocaleString()} {childAccount.currency}
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
                <div className="rounded-xl bg-slate-950/40 p-3 text-slate-500 italic text-xs">
                  Child terminal not provisioned.
                </div>
              )}

              {/* Lot Settings Rule & Performance */}
              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/80">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-mono">Lot Mode</span>
                  <p className="font-semibold text-white">
                    {link.lotSettings.mode === 'parent_lot'
                      ? '1:1 Direct'
                      : `${link.lotSettings.customType.toUpperCase()} (${
                          link.lotSettings.customType === 'fixed'
                            ? `${link.lotSettings.fixedLot}L`
                            : link.lotSettings.customType === 'multiplier'
                            ? `${link.lotSettings.multiplier}x`
                            : `${link.lotSettings.riskPercent}%`
                        })`}
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-slate-500 uppercase font-mono">Deals Copied</span>
                  <p className="font-mono font-bold text-cyan-300">
                    {link.totalTradesCopied} deals ({link.totalProfitUSD >= 0 ? '+' : ''}${link.totalProfitUSD.toLocaleString()})
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
