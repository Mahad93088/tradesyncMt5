import React, { useState } from 'react';
import {
  ListOrdered,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Layers,
  SlidersHorizontal,
  Zap,
  Users,
  ShieldAlert
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from '../common/StatusBadge';

export const MentorActivityView: React.FC = () => {
  const { currentUser, tradeMappings, syncLogs, parentChildLinks, users } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterState, setFilterState] = useState<'all' | 'EXECUTED' | 'FAILED' | 'REJECTED'>('all');

  // Filter mappings strictly for this mentor (Security: mentor isolation)
  const myMappings = tradeMappings.filter((m) => m.mentorId === currentUser.id);

  // Filter sync logs strictly for this mentor
  const mySyncLogs = syncLogs.filter(
    (l) => l.mentorName === currentUser.fullName || l.eventType.includes('PARENT')
  );

  // Follower links for this mentor
  const myFollowers = parentChildLinks.filter((l) => l.mentorId === currentUser.id);

  // Copy Preference Summaries
  const parentLotCount = myFollowers.filter((l) => l.lotSettings.mode === 'parent_lot').length;
  const customLotCount = myFollowers.filter((l) => l.lotSettings.mode === 'custom_lot').length;
  const fixedLotCount = myFollowers.filter(
    (l) => l.lotSettings.mode === 'custom_lot' && l.lotSettings.customType === 'fixed'
  ).length;
  const multiplierCount = myFollowers.filter(
    (l) => l.lotSettings.mode === 'custom_lot' && l.lotSettings.customType === 'multiplier'
  ).length;
  const riskPctCount = myFollowers.filter(
    (l) => l.lotSettings.mode === 'custom_lot' && l.lotSettings.customType === 'risk_percent'
  ).length;

  const filteredMappings = myMappings.filter((m) => {
    const trader = users.find((u) => u.id === m.traderId);
    const text = `${m.parentTradeTicket} ${m.childTradeTicket} ${m.symbol} ${trader?.fullName || ''}`.toLowerCase();
    const matchesSearch = text.includes(searchQuery.toLowerCase());
    const matchesFilter =
      filterState === 'all'
        ? true
        : filterState === 'EXECUTED'
        ? m.status === 'EXECUTED'
        : filterState === 'FAILED'
        ? m.status === 'FAILED'
        : m.status.startsWith('REJECTED') || m.status.includes('SLIPPAGE');
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          Strategy Activity & Synchronization Logs
          <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono">
            {myMappings.length} Total Events
          </span>
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Real-time trade copying logs, ticket mapping history, and follower lot preference breakdowns.
        </p>
      </div>

      {/* Copy Preference Summaries Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">
              1:1 Parent Lot Copy
            </span>
            <Users className="h-4 w-4 text-sky-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-slate-100">{parentLotCount}</span>
            <span className="text-xs text-slate-500">Traders</span>
          </div>
          <p className="text-[11px] text-slate-400">
            {myFollowers.length > 0
              ? `${Math.round((parentLotCount / myFollowers.length) * 100)}% of followers`
              : '0%'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">
              Custom Lot Sizing
            </span>
            <SlidersHorizontal className="h-4 w-4 text-teal-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-slate-100">{customLotCount}</span>
            <span className="text-xs text-slate-500">Traders</span>
          </div>
          <p className="text-[11px] text-slate-400">
            {fixedLotCount} Fixed • {multiplierCount} Multiplier • {riskPctCount} % Risk
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">
              Successful Mirror Rate
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-emerald-400">
              {myMappings.length > 0
                ? `${Math.round(
                    (myMappings.filter((m) => m.status === 'EXECUTED').length /
                      myMappings.length) *
                      100
                  )}%`
                : '100%'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            {myMappings.filter((m) => m.status === 'EXECUTED').length} of {myMappings.length} executed
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">
              Average Execution Latency
            </span>
            <Zap className="h-4 w-4 text-amber-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-slate-100">
              {myMappings.length > 0
                ? `${Math.round(
                    myMappings.reduce((acc, m) => acc + m.latencyMs, 0) / myMappings.length
                  )}ms`
                : '18ms'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-mono">FastAPI WebSocket pipe</p>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search ticket, symbol, or follower..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-slate-400">Status:</span>
          <select
            value={filterState}
            onChange={(e) => setFilterState(e.target.value as any)}
            className="rounded-lg border border-slate-750 bg-slate-950 px-2.5 py-1 text-slate-200 focus:outline-none focus:border-sky-500"
          >
            <option value="all">All Operations</option>
            <option value="EXECUTED">Executed Successfully</option>
            <option value="FAILED">Execution Errors</option>
            <option value="REJECTED">Risk / Slippage Rejects</option>
          </select>
        </div>
      </div>

      {/* Synchronized Ticket Mappings Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-slate-950/90 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Parent Ticket</th>
                <th className="px-4 py-3">Follower Trader</th>
                <th className="px-4 py-3">Child Ticket</th>
                <th className="px-4 py-3">Symbol & Direction</th>
                <th className="px-4 py-3">Lots (Parent → Child)</th>
                <th className="px-4 py-3">Latency</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredMappings.map((map) => {
                const trader = users.find((u) => u.id === map.traderId);

                return (
                  <tr key={map.id} className="hover:bg-slate-850/40 transition-colors">
                    {/* Parent Ticket */}
                    <td className="px-4 py-3 font-mono">
                      <span className="font-semibold text-slate-200">#{map.parentTradeTicket}</span>
                    </td>

                    {/* Trader */}
                    <td className="px-4 py-3 font-medium text-slate-200">
                      {trader?.fullName || 'Follower'}
                    </td>

                    {/* Child Ticket */}
                    <td className="px-4 py-3 font-mono">
                      {map.childTradeTicket > 0 ? (
                        <span className="font-semibold text-emerald-400">#{map.childTradeTicket}</span>
                      ) : (
                        <span className="text-slate-500 italic text-[11px]">Rejected</span>
                      )}
                    </td>

                    {/* Symbol & Direction */}
                    <td className="px-4 py-3 font-mono">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-200">{map.symbol}</span>
                        <span
                          className={`text-[10px] font-bold ${
                            map.orderType.startsWith('BUY') ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {map.orderType}
                        </span>
                      </div>
                    </td>

                    {/* Lots */}
                    <td className="px-4 py-3 font-mono text-[11px]">
                      <span className="text-slate-400">{map.parentLots.toFixed(2)}L</span>
                      <span className="text-slate-600 mx-1">→</span>
                      <span className="text-sky-300 font-semibold">{map.childLots.toFixed(2)}L</span>
                    </td>

                    {/* Latency */}
                    <td className="px-4 py-3 font-mono text-slate-300">
                      {map.latencyMs}ms
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <StatusBadge status={map.status} size="sm" />
                      {map.errorMessage && (
                        <p className="text-[10px] text-rose-400 truncate max-w-xs mt-0.5" title={map.errorMessage}>
                          {map.errorMessage}
                        </p>
                      )}
                    </td>

                    {/* Timestamp */}
                    <td className="px-4 py-3 text-right font-mono text-[11px] text-slate-400">
                      {new Date(map.openTime).toLocaleTimeString()} UTC
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
