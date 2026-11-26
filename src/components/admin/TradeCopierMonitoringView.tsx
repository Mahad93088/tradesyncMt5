import React, { useState } from 'react';
import {
  Server,
  Layers,
  Link2,
  Activity,
  Zap,
  ShieldCheck,
  Search,
  Pause,
  Play,
  Trash2,
  AlertTriangle,
  ShieldOff,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { ParentChildLink } from '../../types';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { countDistinctTraders, formatHeartbeatAge, formatLotRuleLabel } from '../common/dashboardHelpers';
import { computeReportingSummary } from '../../context/cloudStateUtils';
import {
  AdminPageHeader,
  AdminStatCard,
  AdminStatusText,
  AdminFeedbackBanner,
  AdminEmptyState,
} from './adminUi';

export const TradeCopierMonitoringView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const {
    users,
    mt5Accounts,
    parentChildLinks,
    trades,
    tradeMappings,
    syncLogs,
    cloudBridgeTelemetry,
    toggleLinkStatus,
    unlinkTrader,
  } = useApp();

  const reporting = computeReportingSummary({
    trades,
    mappings: tradeMappings,
    accounts: mt5Accounts,
    isCloudMode,
  });

  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'suspended' | 'balance_paused'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [subTab, setSubTab] = useState<'assignments' | 'executions' | 'errors'>('assignments');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingSuspendLink, setPendingSuspendLink] = useState<ParentChildLink | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [isSubmittingSuspend, setIsSubmittingSuspend] = useState(false);

  const [confirmLinkModal, setConfirmLinkModal] = useState<{
    isOpen: boolean;
    link: ParentChildLink | null;
    action: 'pause' | 'resume' | 'reactivate' | 'unlink';
  }>({
    isOpen: false,
    link: null,
    action: 'pause',
  });

  const activeParentAccounts = mt5Accounts.filter(
    (a) => a.accountRole === 'parent' && a.connectionStatus === 'connected'
  );
  const connectedChildAccounts = mt5Accounts.filter(
    (a) => a.accountRole === 'child' && a.connectionStatus === 'connected'
  );
  const activeCopyAssignments = parentChildLinks.filter((l) => l.status === 'active');
  const activeDistinctTraders = countDistinctTraders(parentChildLinks, ['active']);

  const pendingInstructions = tradeMappings.filter((m) => m.status === 'PENDING').length;
  const executedInstructions = tradeMappings.filter(
    (m) => m.status === 'EXECUTED' || m.status === 'CLOSED'
  ).length;
  const failedInstructions = tradeMappings.filter(
    (m) => m.status !== 'EXECUTED' && m.status !== 'CLOSED' && m.status !== 'PENDING'
  ).length;

  const filteredLinks = parentChildLinks.filter((link) => {
    const parentAcc = mt5Accounts.find((a) => a.id === link.parentAccountId);
    const childAcc = mt5Accounts.find((a) => a.id === link.childAccountId);
    const matchesAccount =
      accountFilter === 'all' ||
      link.parentAccountId === accountFilter ||
      link.childAccountId === accountFilter;
    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'balance_paused'
        ? Boolean(link.balancePauseActive)
        : link.status === statusFilter;
    const text = `${link.mentorName} ${link.traderName} ${parentAcc?.accountNumber || ''} ${childAcc?.accountNumber || ''} ${link.suspensionReason || ''} ${link.pauseReason || ''}`.toLowerCase();
    return matchesAccount && matchesStatus && text.includes(searchQuery.toLowerCase());
  });

  const filteredMappings = tradeMappings.filter((m) => {
    const matchesAccount =
      accountFilter === 'all' ||
      m.parentAccountId === accountFilter ||
      m.childAccountId === accountFilter;
    const text = `${m.symbol} ${m.parentTradeTicket} ${m.childTradeTicket} ${m.status}`.toLowerCase();
    return matchesAccount && text.includes(searchQuery.toLowerCase());
  });

  const errorSyncLogs = syncLogs.filter((l) => l.level === 'error' || l.level === 'warn');

  const handleConfirmLinkAction = async () => {
    if (!confirmLinkModal.link) return;
    const link = confirmLinkModal.link;
    setFeedback(null);
    if (confirmLinkModal.action === 'unlink') {
      const res = await unlinkTrader(link.id);
      setFeedback({
        type: res.success ? 'success' : 'error',
        message: res.message || (res.success ? `Unlinked ${link.traderName} from ${link.mentorName}.` : 'Failed to unlink copy assignment.'),
      });
    } else if (confirmLinkModal.action === 'reactivate') {
      const res = await toggleLinkStatus(link.id, 'active');
      setFeedback({
        type: res.success ? 'success' : 'error',
        message: res.message || (res.success ? `Reactivated copy assignment for ${link.traderName}.` : 'Failed to reactivate copy assignment.'),
      });
    } else {
      const res = await toggleLinkStatus(link.id, confirmLinkModal.action === 'pause' ? 'paused' : 'active');
      setFeedback({
        type: res.success ? 'success' : 'error',
        message: res.message || (res.success ? `Updated copy link status for ${link.traderName}.` : 'Failed to update copy link status.'),
      });
    }
  };

  const handleConfirmSuspend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingSuspendLink) return;
    setFeedback(null);
    setIsSubmittingSuspend(true);
    const res = await toggleLinkStatus(pendingSuspendLink.id, 'suspended', suspendReason.trim() || undefined);
    setIsSubmittingSuspend(false);
    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.message || `Failed to suspend assignment for ${pendingSuspendLink.traderName}.`,
      });
      return;
    }
    setFeedback({
      type: 'success',
      message: res.message || `Suspended copy assignment for ${pendingSuspendLink.traderName}.`,
    });
    setPendingSuspendLink(null);
    setSuspendReason('');
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Trade Copier Monitoring"
        meta={`${activeCopyAssignments.length} Active Assignments · ${cloudBridgeTelemetry.averageCopyLatencyMs || 0}ms avg`}
        subtitle="Real-time operational monitoring of Parent-to-Child copy streams, queued/executed instructions, replication latency, and error telemetry."
      />

      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-slate-700">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>
            <strong>Demo-Only Copier Guardrail Active:</strong> Broadcaster and Receiver EAs enforce <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-900">ACCOUNT_TRADE_MODE_DEMO</code>. Live real-money execution remains blocked.
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-500 shrink-0 tabular-nums">
          Pending: {pendingInstructions} · Executed: {executedInstructions} · Failed: {failedInstructions}
        </span>
      </div>

      {feedback && (
        <AdminFeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* Copier KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <AdminStatCard
          title="Active Parent Accounts"
          value={activeParentAccounts.length}
          subtitle={`${mt5Accounts.filter((a) => a.accountRole === 'parent').length} total registered`}
          icon={Server}
          tone="blue"
        />
        <AdminStatCard
          title="Connected Child Accounts"
          value={connectedChildAccounts.length}
          subtitle={`${mt5Accounts.filter((a) => a.accountRole === 'child').length} total registered`}
          icon={Layers}
          tone="emerald"
        />
        <AdminStatCard
          title="Active Copy Assignments"
          value={activeCopyAssignments.length}
          subtitle={`${activeDistinctTraders} distinct active traders · ${parentChildLinks.length} links`}
          icon={Link2}
          tone="blue"
        />
        <AdminStatCard
          title="Executed / Pending"
          value={`${executedInstructions} / ${pendingInstructions}`}
          subtitle="Copied / queued instructions"
          icon={Activity}
          tone="emerald"
        />
        <AdminStatCard
          title="Failed Instructions"
          value={failedInstructions}
          subtitle={`${errorSyncLogs.length} engine warnings/errors`}
          icon={Zap}
          tone={failedInstructions > 0 ? 'rose' : 'neutral'}
        />
      </div>

      {/* Platform Deal Reporting Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Realized Net P&amp;L
          </span>
          <p
            className={`font-mono font-bold text-sm mt-0.5 ${
              !reporting.realizedPnlAvailable
                ? 'text-slate-500 font-normal text-xs'
                : reporting.realizedPnlUSD >= 0
                ? 'text-emerald-700'
                : 'text-rose-700'
            }`}
          >
            {reporting.realizedPnlAvailable
              ? `${reporting.realizedPnlUSD >= 0 ? '+' : '-'}$${Math.abs(reporting.realizedPnlUSD).toFixed(2)}`
              : 'Awaiting closed deal data'}
          </p>
        </div>
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Win Rate / Profit Factor
          </span>
          <p className="font-mono font-bold text-slate-900 text-sm mt-0.5">
            {reporting.winRatePercent !== null
              ? `${reporting.winRatePercent}% / ${(reporting.profitFactor ?? 0).toFixed(2)}`
              : '--'}
          </p>
        </div>
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            24h / 7d Realized
          </span>
          <p className="font-mono font-semibold text-slate-800 text-sm mt-0.5">
            {reporting.dailyRealizedUSD !== null
              ? `$${reporting.dailyRealizedUSD.toFixed(2)} / $${(reporting.weeklyRealizedUSD ?? 0).toFixed(2)}`
              : '-- / --'}
          </p>
        </div>
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            30d Realized
          </span>
          <p className="font-mono font-semibold text-slate-800 text-sm mt-0.5">
            {reporting.monthlyRealizedUSD !== null ? `$${reporting.monthlyRealizedUSD.toFixed(2)}` : '--'}
          </p>
        </div>
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Measured Avg Copy Delay
          </span>
          <p className="font-mono font-bold text-sky-700 text-sm mt-0.5">
            {reporting.avgCopyLatencyMs !== null ? `${reporting.avgCopyLatencyMs}ms` : '--'}
          </p>
        </div>
      </div>

      {/* Filters & Sub-Navigation */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 overflow-x-auto">
          {([
            { id: 'assignments', label: `Copy Assignments (${filteredLinks.length})` },
            { id: 'executions', label: `Sync Events (${filteredMappings.length})` },
            { id: 'errors', label: `Error Logs (${errorSyncLogs.length})` },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                subTab === tab.id
                  ? 'bg-white text-slate-900 font-semibold border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full lg:w-auto">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search mentor, trader, symbol, ticket..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:outline-none"
            />
          </div>

          {subTab === 'assignments' && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full sm:w-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-500"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="suspended">Suspended</option>
              <option value="balance_paused">Balance Paused</option>
            </select>
          )}

          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="w-full sm:w-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-500"
          >
            <option value="all">All MT5 Accounts</option>
            {mt5Accounts.map((acc) => {
              const owner = users.find((u) => u.id === acc.userId);
              return (
                <option key={acc.id} value={acc.id}>
                  #{acc.accountNumber} ({acc.accountRole.toUpperCase()}) · {owner?.fullName || acc.broker}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* TAB 1: Active Copy Assignments */}
      {subTab === 'assignments' && (
        filteredLinks.length === 0 ? (
          <AdminEmptyState
            icon={Link2}
            title="No parent-child copy assignments found"
            description="Assign a Child MT5 follower account to a verified Parent Mentor in MT5 Account Management to establish a copy stream."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Parent Mentor &amp; Terminal</th>
                    <th className="px-4 py-3">Child Trader &amp; Terminal</th>
                    <th className="px-4 py-3">Lot Sizing Rule</th>
                    <th className="px-4 py-3">Copier Status</th>
                    <th className="px-4 py-3">Trades Copied</th>
                    <th className="px-4 py-3">Last Sync</th>
                    <th className="px-4 py-3 text-right">Controls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLinks.map((link) => {
                    const parentAcc = mt5Accounts.find((a) => a.id === link.parentAccountId);
                    const childAcc = mt5Accounts.find((a) => a.id === link.childAccountId);
                    return (
                      <tr key={link.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-slate-900">{link.mentorName}</div>
                          <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {parentAcc ? `#${parentAcc.accountNumber} · ${parentAcc.connectionStatus}` : 'Parent Terminal'}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-slate-900">{link.traderName}</div>
                          <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {childAcc ? `#${childAcc.accountNumber} · ${childAcc.connectionStatus}` : 'Child Terminal'}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-[11px] text-slate-700">
                          {formatLotRuleLabel(link.lotSettings)}
                        </td>
                        <td className="px-4 py-3.5 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <AdminStatusText status={link.status} />
                            {link.balancePauseActive && <AdminStatusText status="balance_paused" />}
                          </div>
                          {link.status === 'suspended' && (
                            <p className="text-[11px] text-rose-700 max-w-[220px] truncate" title={link.suspensionReason || 'Manual suspension'}>
                              {link.suspensionReason || 'Suspended by mentor/admin'}
                            </p>
                          )}
                          {link.balancePauseActive && (
                            <p className="text-[11px] text-amber-800 max-w-[220px] truncate" title={link.pauseReason || 'Balance below $50 threshold'}>
                              {link.pauseReason || 'Paused below $50 (resumes at $100)'}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-slate-900 font-semibold tabular-nums">
                          {link.totalTradesCopied}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-[11px] text-slate-500 tabular-nums">
                          {formatHeartbeatAge(link.lastSyncAt)}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {link.status === 'suspended' ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmLinkModal({
                                    isOpen: true,
                                    link,
                                    action: 'reactivate',
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 whitespace-nowrap"
                              >
                                <ShieldCheck className="h-3 w-3" /> Reactivate
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmLinkModal({
                                      isOpen: true,
                                      link,
                                      action: link.status === 'active' ? 'pause' : 'resume',
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 whitespace-nowrap"
                                >
                                  {link.status === 'active' ? (
                                    <>
                                      <Pause className="h-3 w-3 text-amber-600" /> Pause
                                    </>
                                  ) : (
                                    <>
                                      <Play className="h-3 w-3 text-emerald-600" /> Resume
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPendingSuspendLink(link);
                                    setSuspendReason(link.suspensionReason || '');
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700 whitespace-nowrap"
                                >
                                  <ShieldOff className="h-3 w-3" /> Suspend
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmLinkModal({
                                  isOpen: true,
                                  link,
                                  action: 'unlink',
                                })
                              }
                              className="rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 p-1.5 text-rose-700"
                              title="Unlink copy stream"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
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

      {/* TAB 2: Recent Trade Sync Events */}
      {subTab === 'executions' && (
        filteredMappings.length === 0 ? (
          <AdminEmptyState
            icon={Activity}
            title="No trade synchronization events recorded"
            description="Parent-to-child copy instructions and replication latencies will appear here as orders are mirrored."
          />
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
                    <th className="px-4 py-3 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMappings.map((map) => (
                    <tr key={map.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900 tabular-nums">
                        #{map.parentTradeTicket}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700 tabular-nums">
                        {map.childTradeTicket && map.childTradeTicket !== 0 && map.childTradeTicket !== '0'
                          ? `#${map.childTradeTicket}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        <span className="font-semibold text-slate-900">{map.symbol}</span>{' '}
                        <span className={map.orderType.startsWith('BUY') ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}>
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
                          <p className="text-[11px] text-rose-700 mt-0.5 max-w-xs truncate" title={map.errorMessage}>
                            {map.errorMessage}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[11px] text-slate-500 tabular-nums">
                        {new Date(map.openTime).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* TAB 3: Error Logs */}
      {subTab === 'errors' && (
        errorSyncLogs.length === 0 ? (
          <AdminEmptyState
            icon={AlertTriangle}
            title="Zero copier errors flagged"
            description={
              isCloudMode
                ? 'No warning or error events have been logged by bridge_sync_logs.'
                : 'No error or warning events in the current sandbox session.'
            }
          />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {errorSyncLogs.map((log) => (
              <div key={log.id} className="p-4 flex items-start justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <AdminStatusText status={log.level} />
                    <span className="font-mono font-semibold text-slate-900">{log.eventType}</span>
                    {log.ticket && <span className="font-mono text-[11px] text-slate-500">#{log.ticket}</span>}
                  </div>
                  <p className="text-slate-700 leading-relaxed">{log.details}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )
      )}

      {pendingSuspendLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <ShieldOff className="h-4 w-4 text-rose-600" />
                  <span>Suspend Copy Assignment</span>
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Suspend {pendingSuspendLink.traderName} from mentor {pendingSuspendLink.mentorName}. Existing open positions remain preserved.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPendingSuspendLink(null);
                  setSuspendReason('');
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmSuspend} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Suspension Reason (optional)</label>
                <textarea
                  rows={2}
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="e.g. Risk compliance review or manual mentor pause"
                  className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-slate-900 placeholder-slate-400 focus:border-rose-500 focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setPendingSuspendLink(null);
                    setSuspendReason('');
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingSuspend}
                  className="rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 px-3.5 py-1.5 font-semibold text-white"
                >
                  {isSubmittingSuspend ? 'Suspending...' : 'Confirm Suspend'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={confirmLinkModal.isOpen}
        onClose={() => setConfirmLinkModal({ isOpen: false, link: null, action: 'pause' })}
        onConfirm={() => {
          void handleConfirmLinkAction();
        }}
        title={
          confirmLinkModal.action === 'unlink'
            ? 'Unlink Copy Assignment'
            : confirmLinkModal.action === 'reactivate'
            ? 'Reactivate Copy Assignment'
            : confirmLinkModal.action === 'pause'
            ? 'Pause Copy Assignment'
            : 'Resume Copy Assignment'
        }
        description={
          confirmLinkModal.action === 'unlink'
            ? `Permanently unlink follower ${confirmLinkModal.link?.traderName} from mentor ${confirmLinkModal.link?.mentorName}?`
            : confirmLinkModal.action === 'reactivate'
            ? `Reactivate suspended assignment for ${confirmLinkModal.link?.traderName}? Future trades from ${confirmLinkModal.link?.mentorName} will resume copying subject to balance thresholds.`
            : confirmLinkModal.action === 'pause'
            ? `Pause trade copying from ${confirmLinkModal.link?.mentorName} to ${confirmLinkModal.link?.traderName}?`
            : `Resume trade copying from ${confirmLinkModal.link?.mentorName} to ${confirmLinkModal.link?.traderName}?`
        }
        confirmLabel={
          confirmLinkModal.action === 'unlink'
            ? 'Unlink Stream'
            : confirmLinkModal.action === 'reactivate'
            ? 'Reactivate Assignment'
            : confirmLinkModal.action === 'pause'
            ? 'Pause Stream'
            : 'Resume Stream'
        }
        variant={confirmLinkModal.action === 'unlink' ? 'danger' : confirmLinkModal.action === 'pause' ? 'warning' : 'primary'}
      />
    </div>
  );
};
