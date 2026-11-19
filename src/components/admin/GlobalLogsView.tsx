import React, { useState } from 'react';
import { FileSpreadsheet, Search, Download, Printer, RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { downloadCsvFile, printCurrentReport } from '../common/exportHelpers';
import {
  AdminPageHeader,
  AdminStatusText,
  AdminEmptyState,
  AdminFeedbackBanner,
} from './adminUi';

interface GlobalLogsViewProps {
  initialSubTab?: 'audit' | 'mappings' | 'engine';
  title?: string;
}

export const GlobalLogsView: React.FC<GlobalLogsViewProps> = ({
  initialSubTab = 'audit',
  title = 'System Audit Logs',
}) => {
  const {
    tradeMappings,
    syncLogs,
    auditLogs,
    users,
    isCloudMode,
    cloudLogsStatus,
    isCloudSyncLoading,
    refreshCloudData,
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'audit' | 'mappings' | 'engine'>(initialSubTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');

  const isWithinDateRange = (timestamp: string) => {
    if (dateFilter === 'all') return true;
    const now = Date.now();
    const itemTime = Date.parse(timestamp);
    if (!Number.isFinite(itemTime)) return true;
    const diffHours = (now - itemTime) / (1000 * 60 * 60);

    if (dateFilter === 'today') return diffHours <= 24;
    if (dateFilter === 'week') return diffHours <= 24 * 7;
    if (dateFilter === 'month') return diffHours <= 24 * 30;
    return true;
  };

  const hasActiveFilters = searchQuery.trim() !== '' || statusFilter !== 'all' || dateFilter !== 'all';

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setDateFilter('all');
  };

  const filteredAuditLogs = auditLogs.filter((log) => {
    const text = `${log.action} ${log.actorName} ${log.actorRole} ${log.targetResource} ${log.details} ${log.targetId || ''}`.toLowerCase();
    const matchesSearch = text.includes(searchQuery.toLowerCase());
    const matchesResult = statusFilter === 'all' || log.result === statusFilter;
    const matchesDate = isWithinDateRange(log.timestamp);
    return matchesSearch && matchesResult && matchesDate;
  });

  const filteredMappings = tradeMappings.filter((m) => {
    const mentor = users.find((u) => u.id === m.mentorId);
    const trader = users.find((u) => u.id === m.traderId);
    const text = `${m.parentTradeTicket} ${m.childTradeTicket} ${m.symbol} ${mentor?.fullName || ''} ${trader?.fullName || ''}`.toLowerCase();
    const matchesSearch = text.includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || m.status === statusFilter;
    const matchesDate = isWithinDateRange(m.openTime);
    return matchesSearch && matchesStatus && matchesDate;
  });

  const filteredSyncLogs = syncLogs.filter((log) => {
    const text = `${log.eventType} ${log.details} ${log.mentorName || ''} ${log.traderName || ''}`.toLowerCase();
    const matchesSearch = text.includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || log.level === statusFilter;
    const matchesDate = isWithinDateRange(log.timestamp);
    return matchesSearch && matchesStatus && matchesDate;
  });

  const activeEndpointStatus =
    activeSubTab === 'audit'
      ? cloudLogsStatus.audit
      : activeSubTab === 'mappings'
      ? cloudLogsStatus.mappings
      : cloudLogsStatus.syncLogs;

  const activeTableName =
    activeSubTab === 'audit'
      ? 'public.audit_logs'
      : activeSubTab === 'mappings'
      ? 'public.trade_mappings'
      : 'public.bridge_sync_logs';

  const activeTabLabel =
    activeSubTab === 'audit'
      ? 'Audit Trail'
      : activeSubTab === 'mappings'
      ? 'Ticket Mappings'
      : 'Bridge Logs';

  const handleExportCsv = () => {
    const dateStamp = new Date().toISOString().slice(0, 10);
    if (activeSubTab === 'audit') {
      downloadCsvFile(
        `tradesync_audit_logs_${dateStamp}.csv`,
        ['Timestamp', 'Actor', 'Role', 'Action', 'Resource', 'Target ID', 'Severity', 'Details'],
        filteredAuditLogs.map((l) => [
          l.timestamp,
          l.actorName,
          l.actorRole,
          l.action,
          l.targetResource,
          l.targetId || '',
          l.result,
          l.details,
        ])
      );
    } else if (activeSubTab === 'mappings') {
      downloadCsvFile(
        `tradesync_ticket_mappings_${dateStamp}.csv`,
        ['Open Time', 'Parent Ticket', 'Child Ticket', 'Symbol', 'Order Type', 'Parent Lots', 'Child Lots', 'Latency (ms)', 'Status', 'Error'],
        filteredMappings.map((m) => [
          m.openTime,
          m.parentTradeTicket,
          m.childTradeTicket,
          m.symbol,
          m.orderType,
          m.parentLots,
          m.childLots,
          m.latencyMs,
          m.status,
          m.errorMessage || '',
        ])
      );
    } else {
      downloadCsvFile(
        `tradesync_bridge_logs_${dateStamp}.csv`,
        ['Timestamp', 'Level', 'Event Type', 'Ticket', 'Mentor', 'Trader', 'Latency (ms)', 'Details'],
        filteredSyncLogs.map((l) => [
          l.timestamp,
          l.level,
          l.eventType,
          l.ticket || '',
          l.mentorName || '',
          l.traderName || '',
          l.latencyMs ?? '',
          l.details,
        ])
      );
    }
  };

  const headerMeta = `${auditLogs.length} Audit · ${syncLogs.length} Sync Events${
    isCloudMode && cloudLogsStatus.lastRefreshedAt
      ? ` · Updated ${new Date(cloudLogsStatus.lastRefreshedAt).toLocaleTimeString()}`
      : ''
  }`;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={title}
        meta={headerMeta}
        subtitle="Structured record of admin actions, account registrations & suspensions, bridge errors, and trade ticket mappings."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isCloudMode && (
              <button
                type="button"
                onClick={() => void refreshCloudData()}
                disabled={isCloudSyncLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${isCloudSyncLoading ? 'animate-spin' : ''}`} />
                <span>{isCloudSyncLoading ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={printCurrentReport}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              <Printer className="h-3.5 w-3.5 text-slate-500" />
              <span>Print Report</span>
            </button>
            <div className="flex rounded-lg border border-slate-200 bg-white p-1 text-xs">
              <button
                type="button"
                onClick={() => { setActiveSubTab('audit'); setStatusFilter('all'); }}
                className={`rounded-md px-3 py-1 font-medium whitespace-nowrap transition-colors ${
                  activeSubTab === 'audit' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Audit Trail ({auditLogs.length})
              </button>
              <button
                type="button"
                onClick={() => { setActiveSubTab('mappings'); setStatusFilter('all'); }}
                className={`rounded-md px-3 py-1 font-medium whitespace-nowrap transition-colors ${
                  activeSubTab === 'mappings' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Ticket Mappings ({tradeMappings.length})
              </button>
              <button
                type="button"
                onClick={() => { setActiveSubTab('engine'); setStatusFilter('all'); }}
                className={`rounded-md px-3 py-1 font-medium whitespace-nowrap transition-colors ${
                  activeSubTab === 'engine' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Bridge Logs ({syncLogs.length})
              </button>
            </div>
          </div>
        }
      />

      {isCloudMode && activeEndpointStatus.schemaMissing && (
        <AdminFeedbackBanner
          type="warning"
          message={`Backing table ${activeTableName} is missing or not yet migrated in Supabase (${activeEndpointStatus.error || 'schema missing'}). Apply pending SQL migrations before viewing ${activeTabLabel}.`}
        />
      )}

      {isCloudMode && !activeEndpointStatus.schemaMissing && !activeEndpointStatus.ok && activeEndpointStatus.error && (
        <AdminFeedbackBanner
          type="error"
          message={`Failed to load ${activeTabLabel} from backend${activeEndpointStatus.statusCode ? ` (HTTP ${activeEndpointStatus.statusCode})` : ''}: ${activeEndpointStatus.error}`}
        />
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder={
              activeSubTab === 'audit'
                ? 'Search event, user, resource, details...'
                : activeSubTab === 'mappings'
                ? 'Search tickets, symbols, mentors...'
                : 'Search event type, details...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center flex-wrap gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium">Date Range:</span>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-sky-500"
            >
              <option value="all">All Time</option>
              <option value="today">Today (24h)</option>
              <option value="week">Past 7 Days</option>
              <option value="month">Past 30 Days</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium">Severity:</span>
            {activeSubTab === 'audit' ? (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-sky-500"
              >
                <option value="all">All Severities</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="failure">Failure</option>
              </select>
            ) : activeSubTab === 'mappings' ? (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-sky-500"
              >
                <option value="all">All States</option>
                <option value="EXECUTED">EXECUTED</option>
                <option value="CLOSED">CLOSED</option>
                <option value="PENDING">PENDING</option>
                <option value="FAILED">FAILED</option>
                <option value="REJECTED_MARGIN">Margin Rejects</option>
                <option value="SLIPPAGE_EXCEEDED">Slippage Exceeded</option>
              </select>
            ) : (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-sky-500"
              >
                <option value="all">All Levels</option>
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
              </select>
            )}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: Audit Trail */}
      {activeSubTab === 'audit' && (
        filteredAuditLogs.length === 0 ? (
          auditLogs.length === 0 ? (
            <AdminEmptyState
              icon={FileSpreadsheet}
              title={
                isCloudMode && !cloudLogsStatus.audit.ok
                  ? 'Unable to retrieve Audit Trail from Supabase'
                  : 'No persisted audit log entries in database yet'
              }
              description={
                isCloudMode && !cloudLogsStatus.audit.ok
                  ? `The backend returned${cloudLogsStatus.audit.statusCode ? ` HTTP ${cloudLogsStatus.audit.statusCode}` : ''}: ${cloudLogsStatus.audit.error || 'Unknown error'}.`
                  : '0 rows exist in public.audit_logs. Authoritative admin actions, user approvals, account registrations, assignments, and billing updates are persisted here as they occur.'
              }
              action={
                isCloudMode ? (
                  <button
                    type="button"
                    onClick={() => void refreshCloudData()}
                    disabled={isCloudSyncLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isCloudSyncLoading ? 'animate-spin' : ''}`} />
                    <span>Refresh from Supabase</span>
                  </button>
                ) : undefined
              }
            />
          ) : (
            <AdminEmptyState
              icon={FileSpreadsheet}
              title="No audit log entries match your active filters"
              description={`${auditLogs.length} audit log record(s) exist in memory, but none match your current search query, date range, or severity filter.`}
              action={
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Clear Filters
                </button>
              }
            />
          )
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Date / Time</th>
                    <th className="px-4 py-3">User &amp; Role</th>
                    <th className="px-4 py-3">Event Type</th>
                    <th className="px-4 py-3">Target Resource</th>
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAuditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{log.actorName}</div>
                        <span className="text-[10px] font-mono text-slate-500 uppercase">{log.actorRole}</span>
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-sky-700">
                        {log.action}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-700">
                        {log.targetResource} {log.targetId ? `(#${log.targetId.slice(-6)})` : ''}
                      </td>
                      <td className="px-4 py-3">
                        <AdminStatusText status={log.result} />
                      </td>
                      <td className="px-4 py-3 text-slate-700 max-w-md leading-relaxed">
                        {log.details}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* TAB 2: Ticket Mappings */}
      {activeSubTab === 'mappings' && (
        filteredMappings.length === 0 ? (
          tradeMappings.length === 0 ? (
            <AdminEmptyState
              icon={FileSpreadsheet}
              title={
                isCloudMode && !cloudLogsStatus.mappings.ok
                  ? 'Unable to retrieve Ticket Mappings from Supabase'
                  : 'No ticket mappings recorded in database yet'
              }
              description={
                isCloudMode && !cloudLogsStatus.mappings.ok
                  ? `The backend returned${cloudLogsStatus.mappings.statusCode ? ` HTTP ${cloudLogsStatus.mappings.statusCode}` : ''}: ${cloudLogsStatus.mappings.error || 'Unknown error'}.`
                  : '0 rows exist in public.trade_mappings. Parent-to-child order ticket mappings appear here once connected MT5 Demo terminals copy real orders through the bridge.'
              }
              action={
                isCloudMode ? (
                  <button
                    type="button"
                    onClick={() => void refreshCloudData()}
                    disabled={isCloudSyncLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isCloudSyncLoading ? 'animate-spin' : ''}`} />
                    <span>Refresh from Supabase</span>
                  </button>
                ) : undefined
              }
            />
          ) : (
            <AdminEmptyState
              icon={FileSpreadsheet}
              title="No ticket mappings match your active filters"
              description={`${tradeMappings.length} ticket mapping(s) exist, but none match your current search, date range, or status filter.`}
              action={
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Clear Filters
                </button>
              }
            />
          )
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Parent Ticket</th>
                    <th className="px-4 py-3">Child Ticket</th>
                    <th className="px-4 py-3">Symbol &amp; Type</th>
                    <th className="px-4 py-3">Parent / Child Lots</th>
                    <th className="px-4 py-3">Latency</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMappings.map((map) => {
                    const mentor = users.find((u) => u.id === map.mentorId);
                    const trader = users.find((u) => u.id === map.traderId);

                    return (
                      <tr key={map.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 font-mono">
                          <div className="font-semibold text-slate-900 tabular-nums">#{map.parentTradeTicket}</div>
                          <span className="text-[11px] text-slate-500 font-sans">
                            {mentor?.fullName || 'Verified Mentor'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {Boolean(map.childTradeTicket && map.childTradeTicket !== 0 && map.childTradeTicket !== '0') ? (
                            <div className="font-semibold text-emerald-700 tabular-nums">#{map.childTradeTicket}</div>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">
                              {map.status === 'PENDING' ? 'Pending' : 'Not Executed'}
                            </span>
                          )}
                          <span className="text-[11px] text-slate-500 font-sans">
                            {trader?.fullName || 'Verified Trader'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono">
                          <span className="font-semibold text-slate-900">{map.symbol}</span>{' '}
                          <span className={`text-[11px] font-bold ${map.orderType.startsWith('BUY') ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {map.orderType}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-700 tabular-nums">
                          P: {map.parentLots.toFixed(2)}L · C: {map.childLots.toFixed(2)}L
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-700 tabular-nums">
                          {map.latencyMs}ms
                        </td>
                        <td className="px-4 py-3">
                          <AdminStatusText status={map.status} />
                          {map.errorMessage && (
                            <p className="text-[11px] text-rose-700 truncate max-w-xs mt-0.5" title={map.errorMessage}>
                              {map.errorMessage}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[11px] text-slate-500 tabular-nums">
                          {new Date(map.openTime).toLocaleTimeString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* TAB 3: Bridge Sync Logs */}
      {activeSubTab === 'engine' && (
        filteredSyncLogs.length === 0 ? (
          syncLogs.length === 0 ? (
            <AdminEmptyState
              icon={FileSpreadsheet}
              title={
                isCloudMode && !cloudLogsStatus.syncLogs.ok
                  ? 'Unable to retrieve Bridge Logs from Supabase'
                  : 'No bridge synchronization logs recorded in database yet'
              }
              description={
                isCloudMode && !cloudLogsStatus.syncLogs.ok
                  ? `The backend returned${cloudLogsStatus.syncLogs.statusCode ? ` HTTP ${cloudLogsStatus.syncLogs.statusCode}` : ''}: ${cloudLogsStatus.syncLogs.error || 'Unknown error'}.`
                  : '0 rows exist in public.bridge_sync_logs. Real terminal connection transitions, copier instruction acknowledgements, auto-trading toggles, and Demo-only blocks appear here as they happen.'
              }
              action={
                isCloudMode ? (
                  <button
                    type="button"
                    onClick={() => void refreshCloudData()}
                    disabled={isCloudSyncLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isCloudSyncLoading ? 'animate-spin' : ''}`} />
                    <span>Refresh from Supabase</span>
                  </button>
                ) : undefined
              }
            />
          ) : (
            <AdminEmptyState
              icon={FileSpreadsheet}
              title="No bridge synchronization logs match your active filters"
              description={`${syncLogs.length} bridge sync event(s) exist, but none match your current search, date range, or severity level.`}
              action={
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Clear Filters
                </button>
              }
            />
          )
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {filteredSyncLogs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-slate-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <AdminStatusText status={log.level} />
                    <span className="font-mono font-semibold text-slate-900">{log.eventType}</span>
                    {log.ticket && (
                      <span className="font-mono text-[11px] text-slate-500">#{log.ticket}</span>
                    )}
                  </div>
                  <p className="text-slate-700 leading-relaxed">{log.details}</p>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
                    {log.mentorName && <span>Mentor: {log.mentorName}</span>}
                    {log.traderName && <span>Trader: {log.traderName}</span>}
                    {log.latencyMs !== undefined && <span className="tabular-nums">Latency: {log.latencyMs}ms</span>}
                  </div>
                </div>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
};
