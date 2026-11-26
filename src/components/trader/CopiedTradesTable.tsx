import React, { useState } from 'react';
import { Search, Download, Printer } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { StatusBadge } from '../common/StatusBadge';
import { formatTradeProfitDisplay } from '../common/dashboardHelpers';
import { downloadCsvFile, printCurrentReport } from '../common/exportHelpers';

function formatTime(timestamp?: string | null): string {
  if (!timestamp) return '--';
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return '--';
  return new Date(ms).toLocaleTimeString();
}

export const CopiedTradesTable: React.FC = () => {
  const { isCloudMode } = useAuth();
  const { currentUser, mt5Accounts, trades, tradeMappings } = useApp();

  const [filterType, setFilterType] = useState<'all' | 'open' | 'closed'>('all');
  const [timeframeFilter, setTimeframeFilter] = useState<'all' | '24h' | '7d' | '30d'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChildId, setSelectedChildId] = useState<string>('all');

  const childAccounts = mt5Accounts.filter(
    (a) => a.userId === currentUser.id && a.accountRole === 'child'
  );
  const childAccountIds = new Set(childAccounts.map((a) => a.id));

  const withinTimeframe = (iso?: string | null): boolean => {
    if (timeframeFilter === 'all') return true;
    const ms = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(ms)) return false;
    const cutoffHours = timeframeFilter === '24h' ? 24 : timeframeFilter === '7d' ? 24 * 7 : 24 * 30;
    return Date.now() - ms <= cutoffHours * 3600 * 1000;
  };

  const childTrades = trades.filter((t) => {
    const matchesOwner = childAccountIds.has(t.accountId);
    if (!matchesOwner) return false;
    return selectedChildId === 'all' ? true : t.accountId === selectedChildId;
  });

  const traderMappings = tradeMappings.filter((m) => {
    const matchesOwner = m.traderId === currentUser.id || childAccountIds.has(m.childAccountId);
    if (!matchesOwner) return false;
    return selectedChildId === 'all' ? true : m.childAccountId === selectedChildId;
  });

  const realDbTrades = childTrades.filter((t) => !t.isMappingFallback);
  const useCloudMappingsView =
    (isCloudMode && realDbTrades.length === 0 && traderMappings.length > 0) ||
    (!isCloudMode && childTrades.length === 0 && traderMappings.length > 0);

  const filteredTrades = childTrades.filter((t) => {
    if (!withinTimeframe(t.closeTime || t.openTime)) return false;
    const matchesSearch =
      t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
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

  const filteredMappings = traderMappings.filter((m) => {
    if (!withinTimeframe(m.closeTime || m.openTime)) return false;
    const matchesSearch =
      m.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(m.childTradeTicket).includes(searchQuery);
    const matchesType =
      filterType === 'all'
        ? true
        : filterType === 'open'
        ? m.status === 'EXECUTED' || m.status === 'PENDING'
        : m.status === 'CLOSED';
    return matchesSearch && matchesType;
  });

  const totalCount = useCloudMappingsView ? traderMappings.length : childTrades.length;

  const handleExportCsv = () => {
    if (useCloudMappingsView) {
      downloadCsvFile(
        `tradesync_copied_mappings_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Child Ticket', 'Symbol', 'Direction', 'Lots', 'Latency Ms', 'Status', 'Timestamp', 'Error'],
        filteredMappings.map((m) => [
          m.childTradeTicket || '',
          m.symbol,
          m.orderType,
          m.childLots.toFixed(2),
          m.latencyMs,
          m.status,
          m.openTime,
          m.errorMessage || '',
        ])
      );
    } else {
      downloadCsvFile(
        `tradesync_copied_trades_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Ticket', 'Symbol', 'Type', 'Lots', 'Open Price', 'Close Price', 'Commission', 'Swap', 'Pips', 'Profit', 'Status', 'Exec Status', 'Open Time', 'Close Time'],
        filteredTrades.map((t) => [
          t.ticket,
          t.symbol,
          t.type,
          t.lots.toFixed(2),
          t.openPrice || '',
          t.closePrice ?? t.currentPrice ?? '',
          t.commission ?? 0,
          t.swap ?? 0,
          t.pips ?? 0,
          t.profit.toFixed(2),
          t.status,
          t.executionStatus || '',
          t.openTime,
          t.closeTime ?? '',
        ])
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            Copied Trades &amp; Position History
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono">
              {totalCount} {useCloudMappingsView ? 'Mappings' : 'Deals'}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Positions mirrored from your linked mentor with execution latency, commission/swap/pips breakdown, and ticket references.
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
            <span>Print</span>
          </button>
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
              {useCloudMappingsView ? 'Active / Queued' : 'Open Deals'}
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
      </div>

      {/* Search, Window & Child Account Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs">
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

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {childAccounts.length > 1 && (
            <select
              value={selectedChildId}
              onChange={(e) => setSelectedChildId(e.target.value)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="all">All Child Terminals</option>
              {childAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  #{acc.accountNumber} ({acc.broker})
                </option>
              ))}
            </select>
          )}
          <select
            value={timeframeFilter}
            onChange={(e) => setTimeframeFilter(e.target.value as any)}
            className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
          >
            <option value="all">All Time</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
        </div>
      </div>

      {/* Trades Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-xl">
        <div className="overflow-x-auto">
          {useCloudMappingsView ? (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-950/80 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-5 py-3.5">Your Ticket</th>
                  <th className="px-4 py-3.5">Symbol &amp; Type</th>
                  <th className="px-4 py-3.5">Lot Size</th>
                  <th className="px-4 py-3.5">Fill / Close</th>
                  <th className="px-4 py-3.5">Latency</th>
                  <th className="px-4 py-3.5">P&amp;L</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Timestamps</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {filteredMappings.length > 0 ? (
                  filteredMappings.map((map) => {
                    const matchedTrade = childTrades.find(
                      (t) =>
                        !t.isMappingFallback &&
                        map.childTradeTicket &&
                        String(t.ticket) === String(map.childTradeTicket)
                    );
                    const pnl = matchedTrade
                      ? formatTradeProfitDisplay(matchedTrade, isCloudMode)
                      : {
                          text: isCloudMode ? 'Awaiting EA sync' : '$0.00',
                          available: !isCloudMode,
                          isPositive: true
                        };

                    return (
                      <tr key={map.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="px-5 py-4 font-mono font-bold text-white text-xs">
                          {Boolean(map.childTradeTicket && map.childTradeTicket !== 0 && map.childTradeTicket !== '0')
                            ? `#${map.childTradeTicket}`
                            : <span className="text-slate-500 italic">Pending / None</span>}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-white">{map.symbol}</span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold font-mono ${
                                map.orderType.startsWith('BUY')
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : 'bg-rose-950 text-rose-400 border border-rose-800'
                              }`}
                            >
                              {map.orderType}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 font-mono text-white">
                          <span className="text-cyan-300 font-bold">{map.childLots.toFixed(2)}L</span>
                        </td>
                        <td className="px-4 py-4 font-mono text-[11px] text-slate-300">
                          <div>{matchedTrade && matchedTrade.openPrice ? matchedTrade.openPrice : '--'}</div>
                          <div className="text-slate-500">
                            → {map.closePrice || matchedTrade?.closePrice || '--'}
                          </div>
                        </td>
                        <td className="px-4 py-4 font-mono text-slate-300">
                          {map.latencyMs}ms
                        </td>
                        <td className="px-4 py-4 font-mono text-xs">
                          <span
                            className={
                              !pnl.available
                                ? 'text-slate-500 italic'
                                : pnl.isPositive
                                ? 'text-emerald-400 font-bold'
                                : 'text-rose-400 font-bold'
                            }
                          >
                            {pnl.text}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status={map.status} size="sm" />
                          {map.errorMessage && (
                            <div className="text-[10px] text-rose-400 mt-1 max-w-xs truncate" title={map.errorMessage}>
                              {map.errorMessage}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right font-mono text-[11px] text-slate-400">
                          <div>{formatTime(map.openTime)}</div>
                          {map.closeTime && <div className="text-slate-500">→ {formatTime(map.closeTime)}</div>}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-xs text-slate-500">
                      No copied trade mappings recorded for your account yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-950/80 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-5 py-3.5">Your Ticket</th>
                  <th className="px-4 py-3.5">Symbol &amp; Type</th>
                  <th className="px-4 py-3.5">Lot Size</th>
                  <th className="px-4 py-3.5">Fill / Close</th>
                  <th className="px-4 py-3.5">SL / TP</th>
                  <th className="px-4 py-3.5">Comm / Swap / Pips</th>
                  <th className="px-4 py-3.5">Profit ($)</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Timestamps</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {filteredTrades.length > 0 ? (
                  filteredTrades.map((trade) => {
                    const mapping = tradeMappings.find(
                      (m) => String(m.childTradeTicket) === String(trade.ticket)
                    );
                    const pnl = formatTradeProfitDisplay(trade, isCloudMode);

                    return (
                      <tr key={trade.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="px-5 py-4">
                          <div className="space-y-0.5">
                            <span className="font-mono font-bold text-white text-xs">
                              #{trade.ticket}
                            </span>
                            {mapping && (
                              <div className="text-[10px] text-slate-400 font-mono">
                                Mirrored ({mapping.latencyMs}ms)
                              </div>
                            )}
                          </div>
                        </td>

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

                        <td className="px-4 py-4 font-mono text-white">
                          <span className="font-bold">{trade.lots.toFixed(2)}L</span>
                        </td>

                        <td className="px-4 py-4 font-mono text-[11px] text-slate-300">
                          <div>{trade.isMappingFallback || !trade.openPrice ? '--' : trade.openPrice}</div>
                          <div className="text-slate-500">
                            → {trade.isMappingFallback ? '--' : trade.closePrice || trade.currentPrice || '--'}
                          </div>
                        </td>

                        <td className="px-4 py-4 font-mono text-[11px] text-slate-400">
                          <div>SL: {trade.sl || '-'}</div>
                          <div>TP: {trade.tp || '-'}</div>
                        </td>

                        <td className="px-4 py-4 font-mono text-[11px] text-slate-400">
                          <div>
                            C: {trade.commission != null ? `$${trade.commission.toFixed(2)}` : '--'} • S:{' '}
                            {trade.swap != null ? `$${trade.swap.toFixed(2)}` : '--'}
                          </div>
                          <div>Pips: {trade.pips != null ? trade.pips.toFixed(1) : '--'}</div>
                        </td>

                        <td className="px-4 py-4 font-mono font-bold text-xs">
                          <span
                            className={
                              !pnl.available
                                ? 'text-slate-500 font-normal italic'
                                : pnl.isPositive
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }
                          >
                            {pnl.text}
                          </span>
                        </td>

                        <td className="px-4 py-4">
                          <StatusBadge status={trade.status} size="sm" />
                          {(trade.executionStatus || trade.rejectionReason) && (
                            <div className="text-[10px] font-mono text-slate-400 mt-0.5 max-w-[160px] truncate" title={trade.rejectionReason || trade.executionStatus}>
                              {trade.rejectionReason || trade.executionStatus}
                            </div>
                          )}
                        </td>

                        <td className="px-5 py-4 text-right font-mono text-[11px] text-slate-400">
                          <div>{formatTime(trade.openTime)}</div>
                          {trade.closeTime && <div className="text-slate-500">→ {formatTime(trade.closeTime)}</div>}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="px-5 py-10 text-center text-xs text-slate-500">
                      No copied trades found for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
