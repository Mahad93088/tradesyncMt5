import React, { useState } from 'react';
import {
  ListOrdered,
  Search,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Clock,
  Zap,
  ArrowRight
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from '../common/StatusBadge';

export const CopiedTradesTable: React.FC = () => {
  const { currentUser, mt5Accounts, trades, tradeMappings } = useApp();

  const [filterType, setFilterType] = useState<'all' | 'open' | 'closed'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Find child account
  const childAccount = mt5Accounts.find(
    (a) => a.userId === currentUser.id && a.accountRole === 'child'
  );

  const childTrades = trades.filter((t) => childAccount && t.accountId === childAccount.id);

  const filteredTrades = childTrades.filter((t) => {
    const matchesSearch = t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.ticket.toString().includes(searchQuery) ||
      (t.comment && t.comment.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesType =
      filterType === 'all'
        ? true
        : filterType === 'open'
        ? t.status === 'OPEN'
        : t.status === 'CLOSED';
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            Copied Trades & Position History
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono">
              {childTrades.length} Deals
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time positions mirrored from your linked mentor with execution latency and ticket references.
          </p>
        </div>

        {/* Filter pills */}
        <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-1 text-xs">
          <button
            onClick={() => setFilterType('all')}
            className={`rounded px-3 py-1 font-medium transition-colors ${
              filterType === 'all' ? 'bg-slate-800 text-sky-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Deals
          </button>
          <button
            onClick={() => setFilterType('open')}
            className={`rounded px-3 py-1 font-medium transition-colors ${
              filterType === 'open' ? 'bg-slate-800 text-sky-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Open Deals
          </button>
          <button
            onClick={() => setFilterType('closed')}
            className={`rounded px-3 py-1 font-medium transition-colors ${
              filterType === 'closed' ? 'bg-slate-800 text-sky-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            History
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search by symbol (XAUUSD, EURUSD) or ticket..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Trades Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-slate-950/80 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Child Ticket</th>
                <th className="px-4 py-3.5">Symbol & Type</th>
                <th className="px-4 py-3.5">Lots</th>
                <th className="px-4 py-3.5">Open Price</th>
                <th className="px-4 py-3.5">Current / Close</th>
                <th className="px-4 py-3.5">SL / TP</th>
                <th className="px-4 py-3.5">Profit ($)</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {filteredTrades.map((trade) => {
                const mapping = tradeMappings.find((m) => m.childTradeTicket === trade.ticket);

                return (
                  <tr key={trade.id} className="hover:bg-slate-800/40 transition-colors">
                    {/* Child Ticket */}
                    <td className="px-5 py-4">
                      <div className="space-y-0.5">
                        <span className="font-mono font-bold text-white text-xs">
                          #{trade.ticket}
                        </span>
                        {mapping && (
                          <div className="text-[10px] text-slate-400 font-mono">
                            Parent: #{mapping.parentTradeTicket} ({mapping.latencyMs}ms)
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Symbol & Type */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-white">{trade.symbol}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold font-mono ${
                            trade.type.startsWith('BUY')
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                              : 'bg-rose-950 text-rose-400 border border-rose-800'
                          }`}
                        >
                          {trade.type}
                        </span>
                      </div>
                    </td>

                    {/* Lots */}
                    <td className="px-4 py-4 font-mono font-bold text-white">
                      {trade.lots.toFixed(2)}
                    </td>

                    {/* Open Price */}
                    <td className="px-4 py-4 font-mono text-slate-300">
                      {trade.openPrice}
                    </td>

                    {/* Current / Close */}
                    <td className="px-4 py-4 font-mono text-slate-300">
                      {trade.closePrice || trade.currentPrice}
                    </td>

                    {/* SL / TP */}
                    <td className="px-4 py-4 font-mono text-[11px] text-slate-400">
                      <div>SL: {trade.sl || '-'}</div>
                      <div>TP: {trade.tp || '-'}</div>
                    </td>

                    {/* Profit */}
                    <td className="px-4 py-4 font-mono font-bold text-xs">
                      <span className={trade.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4">
                      <StatusBadge status={trade.status} size="sm" />
                    </td>

                    {/* Time */}
                    <td className="px-5 py-4 text-right font-mono text-[11px] text-slate-400">
                      {new Date(trade.openTime).toLocaleTimeString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
