import React, { useState } from 'react';
import {
  Server,
  Activity,
  Users,
  Ticket,
  Zap,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Shield,
  Copy,
  Check,
  Plus,
  Power,
  Layers,
  Download,
  Printer,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { StatsCard } from '../common/StatsCard';
import { StatusBadge } from '../common/StatusBadge';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { RealEquityCurveChart } from '../common/RealEquityCurveChart';
import { downloadCsvFile, printCurrentReport } from '../common/exportHelpers';
import {
  getDeterministicInviteCode,
  formatHeartbeatAge,
  formatTradeProfitDisplay,
} from '../common/dashboardHelpers';
import { computeReportingSummary } from '../../context/cloudStateUtils';

interface MentorDashboardProps {
  onNavigateTab: (tab: string) => void;
  onOpenConnectModal: () => void;
  onOpenInviteModal: () => void;
}

export const MentorDashboard: React.FC<MentorDashboardProps> = ({
  onNavigateTab,
  onOpenConnectModal,
  onOpenInviteModal
}) => {
  const { isCloudMode } = useAuth();
  const {
    currentUser,
    mt5Accounts,
    mentorProfiles,
    subscriptions,
    subscriptionPlans,
    mentorGroups,
    parentChildLinks,
    trades,
    tradeMappings,
    toggleAutoTrading,
    emergencyCloseParentTicket,
  } = useApp();

  const [copiedCode, setCopiedCode] = useState(false);
  const [dealsTab, setDealsTab] = useState<'open' | 'history'>('open');
  const [pendingEmergencyTicket, setPendingEmergencyTicket] = useState<string | number | null>(null);
  const [isClosingTicket, setIsClosingTicket] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  // Find this mentor's parent MT5 account
  const parentAccount = mt5Accounts.find(
    (a) => a.userId === currentUser.id && a.accountRole === 'parent'
  );

  const profile = mentorProfiles.find((m) => m.userId === currentUser.id) || mentorProfiles[0] || null;
  const sub =
    subscriptions.find((s) => s.mentorId === currentUser.id || s.userId === currentUser.id) || null;
  const activePlan = sub ? subscriptionPlans.find((p) => p.id === sub.planId) : null;
  const inviteCode = profile?.inviteCode || getDeterministicInviteCode(currentUser.id);
  const myGroups = mentorGroups.filter((g) => g.mentorId === currentUser.id);

  // Follower links
  const mentorLinks = parentChildLinks.filter((l) => l.mentorId === currentUser.id);
  const activeFollowers = mentorLinks.filter((l) => l.status === 'active').length;
  const maxQuota = sub?.maxFollowers ?? activePlan?.maxFollowers ?? activePlan?.maxChildAccounts ?? profile?.maxFollowers ?? 25;

  // Parent trades (open & closed history)
  const parentTrades = trades.filter(
    (t) => parentAccount && t.accountId === parentAccount.id && !t.isMappingFallback
  );
  const openParentTrades = parentTrades.filter((t) => t.status === 'OPEN' || t.status === 'PENDING');
  const closedParentTrades = parentTrades.filter((t) => t.status === 'CLOSED' || t.status === 'CANCELLED');

  // Mappings for this mentor
  const mentorMappings = tradeMappings.filter((m) => m.mentorId === currentUser.id);
  const executedMappings = mentorMappings.filter((m) => m.status === 'EXECUTED' || m.status === 'CLOSED');
  const openUniqueParentTickets = Array.from(
    new Map(
      mentorMappings
        .filter((m) => m.status === 'EXECUTED' || m.status === 'PENDING')
        .map((m) => [String(m.parentTradeTicket), m])
    ).values()
  );

  const reporting = computeReportingSummary({
    trades: parentTrades,
    mappings: mentorMappings,
    accounts: parentAccount ? [parentAccount] : [],
    isCloudMode,
  });

  const handleCopyCode = () => {
    navigator.clipboard.writeText(inviteCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleConfirmEmergencyClose = async () => {
    if (pendingEmergencyTicket == null) return;
    setIsClosingTicket(true);
    setActionFeedback(null);
    const res = await emergencyCloseParentTicket(pendingEmergencyTicket);
    setIsClosingTicket(false);
    setActionFeedback({ message: res.message, isError: !res.success });
    setPendingEmergencyTicket(null);
  };

  const handleExportMasterTrades = () => {
    downloadCsvFile(
      `tradesync_mentor_report_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Ticket', 'Symbol', 'Direction', 'Lots', 'Open Price', 'Close Price', 'Commission', 'Swap', 'Profit', 'Status', 'Open Time', 'Close Time'],
      parentTrades.map((t) => [
        t.ticket,
        t.symbol,
        t.type,
        t.lots.toFixed(2),
        t.openPrice,
        t.closePrice ?? '',
        t.commission ?? 0,
        t.swap ?? 0,
        t.profit.toFixed(2),
        t.status,
        t.openTime,
        t.closeTime ?? '',
      ])
    );
  };

  const isStreamConnected = parentAccount?.connectionStatus === 'connected' && !parentAccount?.isStale;

  return (
    <div className="space-y-6">
      {/* Mentor Welcome Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              Mentor Trading Console
            </h1>
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-mono font-semibold text-sky-400">
              PARENT MASTER
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {profile?.strategyName || 'Master Strategy'} • Strategy performance, follower groups, and multi-follower mirror dispatcher.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportMasterTrades}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-750 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-cyan-400" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={printCurrentReport}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-750 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors print:hidden"
          >
            <Printer className="h-3.5 w-3.5 text-slate-300" />
            <span>Print</span>
          </button>
          <button
            onClick={onOpenInviteModal}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 px-3.5 py-1.5 text-xs font-semibold text-slate-200 transition-colors"
          >
            <Ticket className="h-4 w-4 text-sky-400" />
            <span>Invite Students</span>
          </button>
          {!parentAccount && (
            <button
              onClick={onOpenConnectModal}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Connect Master MT5</span>
            </button>
          )}
        </div>
      </div>

      {/* Mode Status Notice */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs flex items-center justify-between text-slate-400">
        <div className="flex items-center gap-2">
          <Shield className={`h-4 w-4 shrink-0 ${isCloudMode ? 'text-emerald-400' : 'text-sky-400'}`} />
          <span>
            {isCloudMode ? (
              <>
                <strong>Cloud Demo Bridge:</strong> Parent MT5 demo deals broadcast via authenticated WebRequest and persist in Supabase.
              </>
            ) : (
              <>
                <strong>Demo Sandbox:</strong> Parent trades are executed against demo liquidity pools and mirrored with simulated latency.
              </>
            )}
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-500 hidden sm:inline">
          MetaTrader 5 Demo Protocol
        </span>
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

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Active Followers"
          value={activeFollowers}
          subtitle={`${activeFollowers} / ${maxQuota} plan quota (${myGroups.length} group${myGroups.length === 1 ? '' : 's'})`}
          icon={Users}
          accentColor="teal"
          onClick={() => onNavigateTab('child-accounts')}
        />
        <StatsCard
          title={reporting.realizedPnlAvailable ? 'Realized Strategy P&L' : 'Mirrored Signals'}
          value={
            reporting.realizedPnlAvailable
              ? `${reporting.realizedPnlUSD >= 0 ? '+' : '-'}$${Math.abs(reporting.realizedPnlUSD).toFixed(2)}`
              : isCloudMode
              ? mentorMappings.length
              : `${profile?.winRate || 0}%`
          }
          subtitle={
            reporting.realizedPnlAvailable
              ? `Win Rate: ${reporting.winRatePercent ?? 0}% • PF: ${reporting.profitFactor?.toFixed(2) ?? '0.00'}`
              : isCloudMode
              ? 'Awaiting closed deal data'
              : `Profit Factor: ${profile?.profitFactor || 0}`
          }
          icon={TrendingUp}
          accentColor="emerald"
          onClick={() => onNavigateTab('trade-activity')}
        />
        <StatsCard
          title="Master MT5 Equity"
          value={parentAccount ? `$${parentAccount.equity.toLocaleString()}` : '$0.00'}
          subtitle={
            parentAccount
              ? `Balance: $${parentAccount.balance.toLocaleString()} • 1:${parentAccount.leverage}`
              : 'No terminal connected'
          }
          icon={Activity}
          accentColor="blue"
        />
        <StatsCard
          title="Mirror Stream Status"
          value={
            !parentAccount
              ? 'UNBOUND'
              : parentAccount.isStale
              ? 'STALE'
              : isStreamConnected
              ? 'LIVE'
              : 'OFFLINE'
          }
          subtitle={
            !parentAccount
              ? 'Connect Parent MT5'
              : parentAccount.isStale
              ? `Heartbeat stale (${formatHeartbeatAge(parentAccount.lastHeartbeat)})`
              : isStreamConnected
              ? `Heartbeat ${formatHeartbeatAge(parentAccount.lastHeartbeat)}`
              : 'Terminal disconnected'
          }
          icon={Zap}
          accentColor={isStreamConnected ? 'emerald' : parentAccount?.isStale ? 'amber' : 'rose'}
        />
      </div>

      {/* Realized Reporting Strip */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs font-mono">
        <div>
          <span className="text-[10px] text-slate-500 uppercase font-sans">Win Rate / PF</span>
          <p className="font-bold text-white mt-0.5">
            {reporting.winRatePercent !== null
              ? `${reporting.winRatePercent}% / ${(reporting.profitFactor ?? 0).toFixed(2)}`
              : 'Awaiting closed deal data'}
          </p>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 uppercase font-sans">24h Realized</span>
          <p className="font-bold text-slate-200 mt-0.5">
            {reporting.dailyRealizedUSD !== null ? `$${reporting.dailyRealizedUSD.toFixed(2)}` : '--'}
          </p>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 uppercase font-sans">7d / 30d Realized</span>
          <p className="font-bold text-slate-200 mt-0.5">
            {reporting.weeklyRealizedUSD !== null
              ? `$${reporting.weeklyRealizedUSD.toFixed(2)} / $${(reporting.monthlyRealizedUSD ?? 0).toFixed(2)}`
              : '-- / --'}
          </p>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 uppercase font-sans">Avg Follower Delay</span>
          <p className="font-bold text-cyan-400 mt-0.5">
            {reporting.avgCopyLatencyMs !== null ? `${reporting.avgCopyLatencyMs}ms` : '--'}
          </p>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 uppercase font-sans">Executed / Failed</span>
          <p className="font-bold text-slate-200 mt-0.5">
            {executedMappings.length} / <span className="text-rose-400">{reporting.failedCopiesCount}</span>
          </p>
        </div>
      </div>

      {/* Real Equity Curve Chart */}
      <RealEquityCurveChart
        trades={parentTrades}
        isCloudMode={isCloudMode}
        variant="dark"
        title="Master Strategy Realized Equity Curve"
        subtitle={
          reporting.realizedPnlAvailable
            ? `Cumulative realized P&L across ${reporting.realizedClosedCount} settled master deal(s)`
            : 'Renders automatically from verified closed master MT5 deals'
        }
      />

      {/* Grid: Parent MT5 Terminal Node + Invitation & Plan Box */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Parent MT5 Terminal Card */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Parent MT5 Master Terminal
              </h3>
            </div>
            {parentAccount ? (
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={parentAccount.isStale ? 'error' : parentAccount.connectionStatus} size="sm" />
                {parentAccount.isStale && (
                  <span className="rounded bg-amber-950/70 border border-amber-800 px-2 py-0.5 text-[10px] font-mono text-amber-300">
                    Stale Heartbeat
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => toggleAutoTrading(parentAccount.id)}
                  className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    parentAccount.autoTradingEnabled
                      ? 'border-emerald-800 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50'
                      : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <Power className="h-3 w-3" />
                  <span>{parentAccount.autoTradingEnabled ? 'Broadcasting ON' : 'Broadcasting PAUSED'}</span>
                </button>
                <button
                  onClick={onOpenConnectModal}
                  className="text-xs text-cyan-400 hover:text-cyan-300 font-medium"
                >
                  Rotate / Re-register
                </button>
              </div>
            ) : (
              <button
                onClick={onOpenConnectModal}
                className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold"
              >
                + Connect Terminal
              </button>
            )}
          </div>

          {parentAccount ? (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-slate-950/70 border border-slate-800 p-4 font-mono">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Account Login</span>
                  <p className="font-bold text-white text-sm">#{parentAccount.accountNumber}</p>
                  <span className="text-[10px] text-slate-400 font-sans">
                    {parentAccount.broker} ({parentAccount.accountType.toUpperCase()})
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Broker Server</span>
                  <p className="font-bold text-slate-200 truncate">{parentAccount.server}</p>
                  <span className={`text-[10px] font-sans ${parentAccount.isStale ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {formatHeartbeatAge(parentAccount.lastHeartbeat)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Balance / Equity</span>
                  <p className="font-bold text-white text-sm">${parentAccount.balance.toLocaleString()}</p>
                  <span className="text-[10px] text-cyan-300 font-sans">
                    Eq: ${parentAccount.equity.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Free Margin</span>
                  <p className="font-bold text-emerald-400 text-sm">${parentAccount.freeMargin.toLocaleString()}</p>
                  <span className="text-[10px] text-slate-400 font-sans">
                    Margin: ${parentAccount.margin.toLocaleString()} • 1:{parentAccount.leverage}
                  </span>
                </div>
              </div>

              {/* Open Positions & Trade History */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
                    <button
                      type="button"
                      onClick={() => setDealsTab('open')}
                      className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        dealsTab === 'open' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Open Positions ({openParentTrades.length > 0 ? openParentTrades.length : openUniqueParentTickets.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setDealsTab('history')}
                      className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        dealsTab === 'history' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Trade History ({closedParentTrades.length > 0 ? closedParentTrades.length : mentorMappings.length})
                    </button>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Auto-mirrored to {activeFollowers} active follower(s)
                  </span>
                </div>

                {dealsTab === 'open' ? (
                  openParentTrades.length > 0 ? (
                    <div className="space-y-2">
                      {openParentTrades.map((t) => {
                        const pnl = formatTradeProfitDisplay(t, isCloudMode);
                        return (
                          <div
                            key={t.id}
                            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3"
                          >
                            <div className="flex items-center gap-3">
                              <span
                                className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                                  t.type.startsWith('BUY')
                                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                    : 'bg-rose-950 text-rose-400 border border-rose-800'
                                }`}
                              >
                                {t.type}
                              </span>
                              <div>
                                <span className="font-mono font-bold text-white text-xs">{t.symbol}</span>
                                <span className="text-slate-400 text-[11px] ml-2 font-mono">
                                  {t.lots.toFixed(2)} lots @ {t.openPrice}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="text-right font-mono text-xs">
                                <div className={pnl.available ? (pnl.isPositive ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold') : 'text-slate-400 text-[10px]'}>
                                  {pnl.text}
                                </div>
                                <span className="text-[10px] text-slate-500">Ticket #{t.ticket}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setPendingEmergencyTicket(t.ticket)}
                                className="rounded border border-rose-800/80 bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 px-2.5 py-1 text-[10px] font-semibold transition-colors shadow-sm"
                                title="Queue emergency CLOSE instruction for all linked followers"
                              >
                                Emergency Close
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : isCloudMode && openUniqueParentTickets.length > 0 ? (
                    <div className="space-y-2">
                      {openUniqueParentTickets.slice(0, 6).map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3"
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                                m.orderType.startsWith('BUY')
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : 'bg-rose-950 text-rose-400 border border-rose-800'
                              }`}
                            >
                              {m.orderType}
                            </span>
                            <div>
                              <span className="font-mono font-bold text-white text-xs">{m.symbol}</span>
                              <span className="text-slate-400 text-[11px] ml-2 font-mono">
                                Parent {m.parentLots.toFixed(2)}L • Ticket #{m.parentTradeTicket}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <StatusBadge status={m.status} size="sm" />
                            <button
                              type="button"
                              onClick={() => setPendingEmergencyTicket(m.parentTradeTicket)}
                              className="rounded border border-rose-800/80 bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 px-2.5 py-1 text-[10px] font-semibold transition-colors"
                            >
                              Emergency Close
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4 text-center text-slate-500 text-xs">
                      No open positions on master terminal. Waiting for Broadcaster EA trade event.
                    </div>
                  )
                ) : closedParentTrades.length > 0 ? (
                  <div className="space-y-2">
                    {closedParentTrades.slice(0, 8).map((t) => {
                      const pnl = formatTradeProfitDisplay(t, isCloudMode);
                      return (
                        <div
                          key={t.id}
                          className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3"
                        >
                          <div className="flex items-center gap-3">
                            <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold bg-slate-800 text-slate-300">
                              {t.type}
                            </span>
                            <div>
                              <span className="font-mono font-bold text-white text-xs">{t.symbol}</span>
                              <span className="text-slate-400 text-[11px] ml-2 font-mono">
                                {t.lots.toFixed(2)}L • #{t.ticket}
                              </span>
                            </div>
                          </div>
                          <div className="text-right font-mono text-xs">
                            <span className={pnl.available ? (pnl.isPositive ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold') : 'text-slate-400'}>
                              {pnl.text}
                            </span>
                            <div className="text-[10px] text-slate-500">
                              {t.closeTime ? new Date(t.closeTime).toLocaleString() : new Date(t.openTime).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : mentorMappings.length > 0 ? (
                  <div className="space-y-2">
                    {mentorMappings.slice(0, 6).map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3"
                      >
                        <div className="flex items-center gap-3">
                          <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold bg-slate-800 text-slate-300">
                            {m.orderType}
                          </span>
                          <div>
                            <span className="font-mono font-bold text-white text-xs">{m.symbol}</span>
                            <span className="text-slate-400 text-[11px] ml-2 font-mono">
                              P: {m.parentLots.toFixed(2)}L → C: {m.childLots.toFixed(2)}L
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={m.status} size="sm" />
                          <span className="text-[10px] font-mono text-slate-500">#{m.parentTradeTicket}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4 text-center text-slate-500 text-xs">
                    No master trade history recorded yet.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center space-y-3">
              <Server className="h-8 w-8 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">
                You haven't registered a Parent MT5 terminal yet. Connect your master demo account to generate your EA token.
              </p>
              <button
                onClick={onOpenConnectModal}
                className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-xs font-semibold text-white transition-colors"
              >
                Connect Master MT5
              </button>
            </div>
          )}
        </div>

        {/* Quick Invite & Subscription Box */}
        <div className="space-y-4">
          {/* Quick Invite Code Box */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg space-y-3">
            <div className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Student Invite Code</h3>
            </div>
            <p className="text-xs text-slate-400">
              Students enter this deterministic code in their dashboard to link their child MT5 account to you.
            </p>

            <div className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-800 p-3">
              <span className="font-mono text-sm font-bold text-white tracking-wider">
                {inviteCode}
              </span>
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1 rounded bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-slate-200 text-xs transition-colors"
              >
                {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedCode ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Subscription & Groups Summary Card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-cyan-400" />
                Plan & Follower Groups
              </span>
              <StatusBadge status={sub?.status || 'pending'} size="sm" />
            </div>
            <h4 className="font-bold text-white text-sm">
              {sub?.planName || activePlan?.name || (isCloudMode ? 'Starter Free / No Paid Plan' : 'Demo Sandbox Tier')}
            </h4>
            <div className="text-xs text-slate-400 space-y-1 font-mono">
              <div className="flex justify-between">
                <span>Follower Quota:</span>
                <span className="text-white">{activeFollowers} / {maxQuota}</span>
              </div>
              <div className="flex justify-between">
                <span>Strategy Groups:</span>
                <span className="text-slate-200">{myGroups.length} active</span>
              </div>
              <div className="flex justify-between">
                <span>Renewal Expiry:</span>
                <span className="text-cyan-400">
                  {sub?.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : 'N/A'}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => onNavigateTab('child-accounts')}
                className="rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 py-1.5 text-xs text-slate-200 font-semibold transition-colors"
              >
                Manage Groups
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab('subscription')}
                className="rounded-lg bg-cyan-600/90 hover:bg-cyan-500 py-1.5 text-xs text-white font-semibold transition-colors"
              >
                Billing & Plans
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={pendingEmergencyTicket !== null}
        onClose={() => setPendingEmergencyTicket(null)}
        onConfirm={handleConfirmEmergencyClose}
        isLoading={isClosingTicket}
        variant="danger"
        title="Confirm Emergency Close Dispatch"
        description={`Queue CLOSE instructions across all active follower child terminals for Parent Ticket #${pendingEmergencyTicket}?`}
        confirmLabel="Dispatch Close Instructions"
      />
    </div>
  );
};
