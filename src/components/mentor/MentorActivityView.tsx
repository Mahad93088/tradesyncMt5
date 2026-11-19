import React, { useState } from 'react';
import {
  Search,
  CheckCircle2,
  SlidersHorizontal,
  Zap,
  Users,
  Terminal,
  ListOrdered,
  Download,
  Printer,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { StatusBadge } from '../common/StatusBadge';
import { downloadCsvFile, printCurrentReport } from '../common/exportHelpers';

export const MentorActivityView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const { currentUser, tradeMappings, syncLogs, parentChildLinks, users } = useApp();

  const [activeTab, setActiveTab] = useState<'mappings' | 'logs'>('mappings');
  const [searchQuery, setSearchQuery] = useState('');
  const [timeframeFilter, setTimeframeFilter] = useState<'all' | '24h' | '7d' | '30d'>('all');
  const [filterState, setFilterState] = useState<'all' | 'EXECUTED' | 'CLOSED' | 'PENDING' | 'FAILED' | 'REJECTED'>('all');

  const myMappings = tradeMappings.filter((m) => m.mentorId === currentUser.id);
  const mySyncLogs = isCloudMode
    ? syncLogs
    : syncLogs.filter((l) => l.mentorName === currentUser.fullName || l.eventType.includes('PARENT'));
  const myFollowers = parentChildLinks.filter((l) => l.mentorId === currentUser.id);

  const withinTimeframe = (iso?: string | null): boolean => {
    if (timeframeFilter === 'all') return true;
    const ms = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(ms)) return false;
    const cutoffHours = timeframeFilter === '24h' ? 24 : timeframeFilter === '7d' ? 24 * 7 : 24 * 30;
    return Date.now() - ms <= cutoffHours * 3600 * 1000;
  };

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
    (l) =>
      l.lotSettings.mode === 'custom_lot' &&
      (l.lotSettings.customType === 'risk_percent' || l.lotSettings.customType === 'equity_ratio')
  ).length;

  const executedOrClosed = myMappings.filter((m) => m.status === 'EXECUTED' || m.status === 'CLOSED');

  const filteredMappings = myMappings.filter((m) => {
    if (!withinTimeframe(m.closeTime || m.openTime)) return false;
    const trader = users.find((u) => u.id === m.traderId);
    const text = `${m.parentTradeTicket} ${m.childTradeTicket} ${m.symbol} ${trader?.fullName || ''}`.toLowerCase();
    const matchesSearch = text.includes(searchQuery.toLowerCase());
    const matchesFilter =
      filterState === 'all'
        ? true
        : filterState === 'EXECUTED'
        ? m.status === 'EXECUTED'
        : filterState === 'CLOSED'
        ? m.status === 'CLOSED'
        : filterState === 'PENDING'
        ? m.status === 'PENDING'
        : filterState === 'FAILED'
        ? m.status === 'FAILED'
        : m.status.startsWith('REJECTED') || m.status.includes('SLIPPAGE') || m.status === 'SKIPPED_LOT_LIMIT';
    return matchesSearch && matchesFilter;
  });

  const filteredLogs = mySyncLogs.filter((l) => {
    if (!withinTimeframe(l.timestamp)) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      l.eventType.toLowerCase().includes(q) ||
      l.details.toLowerCase().includes(q) ||
      String(l.ticket || '').toLowerCase().includes(q)
    );
  });

  const handleExportCsv = () => {
    if (activeTab === 'mappings') {
      downloadCsvFile(
        `tradesync_mentor_mappings_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Parent Ticket', 'Follower', 'Child Ticket', 'Symbol', 'Direction', 'Parent Lots', 'Child Lots', 'Latency Ms', 'Status', 'Timestamp', 'Error'],
        filteredMappings.map((map) => {
          const trader = users.find((u) => u.id === map.traderId);
          return [
            map.parentTradeTicket,
            trader?.fullName || map.traderId,
            map.childTradeTicket || '',
            map.symbol,
            map.orderType,
            map.parentLots.toFixed(2),
            map.childLots.toFixed(2),
            map.latencyMs,
            map.status,
            map.openTime,
            map.errorMessage || '',
          ];
        })
      );
    } else {
      downloadCsvFile(
        `tradesync_mentor_sync_logs_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Timestamp', 'Event Type', 'Level', 'Ticket', 'Details'],
        filteredLogs.map((l) => [l.timestamp, l.eventType, l.level, l.ticket || '', l.details])
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            Strategy Activity &amp; Synchronization Logs
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono">
              {myMappings.length} Mappings
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time trade copying logs, ticket mapping history, and follower lot preference breakdowns.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-cyan-400" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={printCurrentReport}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors print:hidden"
          >
            <Printer className="h-3.5 w-3.5 text-slate-300" />
            <span>Print Report</span>
          </button>
          <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('mappings')}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition-colors ${
                activeTab === 'mappings' ? 'bg-slate-800 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <ListOrdered className="h-3.5 w-3.5" />
              <span>Ticket Mappings ({myMappings.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition-colors ${
                activeTab === 'logs' ? 'bg-slate-800 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>Sync Logs ({mySyncLogs.length})</span>
            </button>
          </div>
        </div>
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
            {fixedLotCount} Fixed • {multiplierCount} Multiplier • {riskPctCount} Risk/Eq
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
                ? `${Math.round((executedOrClosed.length / myMappings.length) * 100)}%`
                : '--'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            {executedOrClosed.length} of {myMappings.length} executed
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
              {executedOrClosed.filter((m) => m.latencyMs > 0).length > 0
                ? `${Math.round(
                    executedOrClosed
                      .filter((m) => m.latencyMs > 0)
                      .reduce((acc, m) => acc + m.latencyMs, 0) /
                      executedOrClosed.filter((m) => m.latencyMs > 0).length
                  )}ms`
                : '--'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-mono">
            {isCloudMode ? 'Supabase Cloud Bridge' : 'Demo Copy Simulator'}
          </p>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder={activeTab === 'mappings' ? 'Search ticket, symbol, or follower...' : 'Search sync event or ticket...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Window:</span>
            <select
              value={timeframeFilter}
              onChange={(e) => setTimeframeFilter(e.target.value as any)}
              className="rounded-lg border border-slate-750 bg-slate-950 px-2.5 py-1 text-slate-200 focus:outline-none focus:border-sky-500"
            >
              <option value="all">All Time</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>

          {activeTab === 'mappings' && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Status:</span>
              <select
                value={filterState}
                onChange={(e) => setFilterState(e.target.value as any)}
                className="rounded-lg border border-slate-750 bg-slate-950 px-2.5 py-1 text-slate-200 focus:outline-none focus:border-sky-500"
              >
                <option value="all">All Operations</option>
                <option value="EXECUTED">Executed</option>
                <option value="CLOSED">Closed</option>
                <option value="PENDING">Pending</option>
                <option value="FAILED">Execution Errors</option>
                <option value="REJECTED">Risk / Slippage Rejects</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {activeTab === 'mappings' ? (
        /* Synchronized Ticket Mappings Table */
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-950/90 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">Parent Ticket</th>
                  <th className="px-4 py-3">Follower Trader</th>
                  <th className="px-4 py-3">Child Ticket</th>
                  <th className="px-4 py-3">Symbol &amp; Direction</th>
                  <th className="px-4 py-3">Lots (Parent → Child)</th>
                  <th className="px-4 py-3">Latency</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredMappings.length > 0 ? (
                  filteredMappings.map((map) => {
                    const trader = users.find((u) => u.id === map.traderId);
                    const link = parentChildLinks.find(
                      (l) => l.traderId === map.traderId && l.mentorId === map.mentorId
                    );

                    return (
                      <tr key={map.id} className="hover:bg-slate-850/40 transition-colors">
                        <td className="px-4 py-3 font-mono">
                          <span className="font-semibold text-slate-200">#{map.parentTradeTicket}</span>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-200">
                          {trader?.fullName || link?.traderName || 'Follower'}
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {Boolean(map.childTradeTicket && map.childTradeTicket !== 0 && map.childTradeTicket !== '0') ? (
                            <span className="font-semibold text-emerald-400">#{map.childTradeTicket}</span>
                          ) : (
                            <span className="text-slate-500 italic text-[11px]">None</span>
                          )}
                        </td>
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
                        <td className="px-4 py-3 font-mono text-[11px]">
                          <span className="text-slate-400">{map.parentLots.toFixed(2)}L</span>
                          <span className="text-slate-600 mx-1">→</span>
                          <span className="text-sky-300 font-semibold">{map.childLots.toFixed(2)}L</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-300">{map.latencyMs}ms</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={map.status} size="sm" />
                          {map.errorMessage && (
                            <p className="text-[10px] text-rose-400 truncate max-w-xs mt-0.5" title={map.errorMessage}>
                              {map.errorMessage}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[11px] text-slate-400">
                          {new Date(map.openTime).toLocaleTimeString()}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500 text-xs">
                      No mirrored trade mappings recorded for your account yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Scoped Synchronization Logs List */
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 divide-y divide-slate-800/80 shadow-sm">
          {filteredLogs.length > 0 ? (
            filteredLogs.map((log) => (
              <div key={log.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                        log.level === 'error'
                          ? 'bg-rose-950 text-rose-400 border border-rose-800'
                          : log.level === 'warn'
                          ? 'bg-amber-950 text-amber-400 border border-amber-800'
                          : log.level === 'success'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-sky-950 text-sky-400 border border-sky-800'
                      }`}
                    >
                      {log.eventType}
                    </span>
                    {log.ticket && (
                      <span className="font-mono text-[10px] text-slate-400">Ticket #{log.ticket}</span>
                    )}
                  </div>
                  <p className="text-slate-300 leading-relaxed">{log.details}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-500 shrink-0">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
              </div>
            ))
          ) : (
            <div className="p-10 text-center text-slate-500 text-xs">
              No bridge synchronization logs recorded for your tenant yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
