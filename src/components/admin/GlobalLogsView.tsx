import React, { useState } from 'react';
import {
  ListOrdered,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Layers,
  Zap,
  Download,
  Calendar,
  FileSpreadsheet,
  ShieldCheck,
  UserCheck
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from '../common/StatusBadge';

export const GlobalLogsView: React.FC = () => {
  const { tradeMappings, syncLogs, auditLogs, users } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'audit' | 'mappings' | 'engine'>('audit');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');

  const isWithinDateRange = (timestamp: string) => {
    if (dateFilter === 'all') return true;
    const now = new Date().getTime();
    const itemTime = new Date(timestamp).getTime();
    const diffHours = (now - itemTime) / (1000 * 60 * 60);

    if (dateFilter === 'today') return diffHours <= 24;
    if (dateFilter === 'week') return diffHours <= 24 * 7;
    if (dateFilter === 'month') return diffHours <= 24 * 30;
    return true;
  };

  // Filter audit logs
  const filteredAuditLogs = auditLogs.filter((log) => {
    const text = `${log.action} ${log.actorName} ${log.targetResource} ${log.details} ${log.targetId || ''}`.toLowerCase();
    const matchesSearch = text.includes(searchQuery.toLowerCase());
    const matchesResult = statusFilter === 'all' || log.result === statusFilter;
    const matchesDate = isWithinDateRange(log.timestamp);
    return matchesSearch && matchesResult && matchesDate;
  });

  // Filter ticket mappings
  const filteredMappings = tradeMappings.filter((m) => {
    const mentor = users.find((u) => u.id === m.mentorId);
    const trader = users.find((u) => u.id === m.traderId);
    const text = `${m.parentTradeTicket} ${m.childTradeTicket} ${m.symbol} ${mentor?.fullName || ''} ${trader?.fullName || ''}`.toLowerCase();
    const matchesSearch = text.includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || m.status === statusFilter;
    const matchesDate = isWithinDateRange(m.openTime);
    return matchesSearch && matchesStatus && matchesDate;
  });

  // Filter sync logs
  const filteredSyncLogs = syncLogs.filter((log) => {
    const text = `${log.eventType} ${log.details} ${log.mentorName || ''} ${log.traderName || ''}`.toLowerCase();
    const matchesSearch = text.includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || log.level === statusFilter;
    const matchesDate = isWithinDateRange(log.timestamp);
    return matchesSearch && matchesStatus && matchesDate;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            Activity, Audit & Execution Logs
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono">
              Audit Trail
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Structured administrative audit trails, trade copying ticket mappings, and daemon synchronization logs.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-1 text-xs">
          <button
            onClick={() => { setActiveSubTab('audit'); setStatusFilter('all'); }}
            className={`rounded px-3 py-1 font-medium transition-colors ${
              activeSubTab === 'audit'
                ? 'bg-slate-800 text-sky-300 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Audit Trail ({auditLogs.length})
          </button>
          <button
            onClick={() => { setActiveSubTab('mappings'); setStatusFilter('all'); }}
            className={`rounded px-3 py-1 font-medium transition-colors ${
              activeSubTab === 'mappings'
                ? 'bg-slate-800 text-sky-300 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Ticket Mappings ({tradeMappings.length})
          </button>
          <button
            onClick={() => { setActiveSubTab('engine'); setStatusFilter('all'); }}
            className={`rounded px-3 py-1 font-medium transition-colors ${
              activeSubTab === 'engine'
                ? 'bg-slate-800 text-sky-300 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Engine Sync Logs ({syncLogs.length})
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder={
              activeSubTab === 'audit'
                ? 'Search action, user, resource, details...'
                : activeSubTab === 'mappings'
                ? 'Search tickets, symbols, mentors...'
                : 'Search event type, details...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Date:</span>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="rounded-lg border border-slate-750 bg-slate-950 px-2.5 py-1 text-slate-200 focus:outline-none focus:border-sky-500"
            >
              <option value="all">All Time</option>
              <option value="today">Today (24h)</option>
              <option value="week">Past 7 Days</option>
              <option value="month">Past 30 Days</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Result:</span>
            {activeSubTab === 'audit' ? (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-750 bg-slate-950 px-2.5 py-1 text-slate-200 focus:outline-none focus:border-sky-500"
              >
                <option value="all">All Results</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="failure">Failure</option>
              </select>
            ) : activeSubTab === 'mappings' ? (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-750 bg-slate-950 px-2.5 py-1 text-slate-200 focus:outline-none focus:border-sky-500"
              >
                <option value="all">All States</option>
                <option value="EXECUTED">EXECUTED</option>
                <option value="FAILED">FAILED</option>
                <option value="REJECTED_MARGIN">Margin Rejects</option>
                <option value="SLIPPAGE_EXCEEDED">Slippage Exceeded</option>
              </select>
            ) : (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-750 bg-slate-950 px-2.5 py-1 text-slate-200 focus:outline-none focus:border-sky-500"
              >
                <option value="all">All Levels</option>
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
              </select>
            )}
          </div>
        </div>
      </div>

      {/* TAB 1: Activity and Audit Logs */}
      {activeSubTab === 'audit' && (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-950/90 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">User / Administrator</th>
                  <th className="px-4 py-3">Action Performed</th>
                  <th className="px-4 py-3">Target Resource</th>
                  <th className="px-4 py-3">Result</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredAuditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-850/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-200">{log.actorName}</div>
                      <span className="text-[10px] font-mono text-slate-500 uppercase">{log.actorRole}</span>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-sky-400">
                      {log.action}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-300">
                      {log.targetResource} {log.targetId ? `(#${log.targetId.slice(-6)})` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase font-mono ${
                          log.result === 'success'
                            ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/40'
                            : log.result === 'failure'
                            ? 'bg-rose-950/50 text-rose-300 border border-rose-800/40'
                            : 'bg-amber-950/50 text-amber-300 border border-amber-800/40'
                        }`}
                      >
                        {log.result}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300 max-w-sm leading-normal">
                      {log.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Ticket Mappings */}
      {activeSubTab === 'mappings' && (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-950/90 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-3">Parent Ticket</th>
                  <th className="px-4 py-3">Child Ticket</th>
                  <th className="px-4 py-3">Symbol & Type</th>
                  <th className="px-4 py-3">Parent / Child Lots</th>
                  <th className="px-4 py-3">Latency</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredMappings.map((map) => {
                  const mentor = users.find((u) => u.id === map.mentorId);
                  const trader = users.find((u) => u.id === map.traderId);

                  return (
                    <tr key={map.id} className="hover:bg-slate-850/40 transition-colors">
                      <td className="px-4 py-3 font-mono">
                        <div className="font-semibold text-slate-200">#{map.parentTradeTicket}</div>
                        <span className="text-[10px] text-slate-500 font-sans">{mentor?.fullName}</span>
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {map.childTradeTicket > 0 ? (
                          <div className="font-semibold text-emerald-400">#{map.childTradeTicket}</div>
                        ) : (
                          <span className="text-slate-500 italic text-[11px]">Rejected</span>
                        )}
                        <span className="text-[10px] text-slate-500 font-sans">{trader?.fullName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 font-mono">
                          <span className="font-semibold text-slate-200">{map.symbol}</span>
                          <span className={`text-[10px] font-bold ${map.orderType.startsWith('BUY') ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {map.orderType}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px]">
                        <div>P: <strong className="text-slate-200">{map.parentLots.toFixed(2)}L</strong></div>
                        <div>C: <strong className="text-sky-300">{map.childLots.toFixed(2)}L</strong></div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300">
                        {map.latencyMs}ms
                      </td>
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
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Engine Sync Logs */}
      {activeSubTab === 'engine' && (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-sm divide-y divide-slate-800/80">
          {filteredSyncLogs.map((log) => (
            <div key={log.id} className="p-3.5 hover:bg-slate-850/40 transition-colors flex items-start gap-3 text-xs">
              <div className="mt-0.5 shrink-0">
                {log.level === 'success' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : log.level === 'error' ? (
                  <AlertTriangle className="h-4 w-4 text-rose-400" />
                ) : log.level === 'warn' ? (
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                ) : (
                  <Clock className="h-4 w-4 text-sky-400" />
                )}
              </div>

              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-mono">
                    <span className="font-semibold text-slate-200">{log.eventType}</span>
                    {log.ticket && (
                      <span className="rounded bg-slate-800 px-1 py-0.2 text-[10px] text-slate-400">
                        #{log.ticket}
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-slate-500">
                    {new Date(log.timestamp).toLocaleTimeString()} UTC
                  </span>
                </div>

                <p className="text-slate-300 leading-normal">{log.details}</p>

                <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                  {log.mentorName && <span>Mentor: {log.mentorName}</span>}
                  {log.traderName && <span>Trader: {log.traderName}</span>}
                  {log.latencyMs !== undefined && <span>Latency: {log.latencyMs}ms</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
