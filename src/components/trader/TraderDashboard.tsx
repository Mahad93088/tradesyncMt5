import React, { useState } from 'react';
import {
  Server,
  Activity,
  UserCheck,
  SlidersHorizontal,
  PlayCircle,
  PauseCircle,
  AlertTriangle,
  TrendingUp,
  Zap,
  Shield,
  Plus,
  CheckCircle2,
  Power,
  Download,
  Printer,
  Mail,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { ensureValidSession } from '../../lib/sessionManager';
import { StatsCard } from '../common/StatsCard';
import { StatusBadge } from '../common/StatusBadge';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { RealEquityCurveChart } from '../common/RealEquityCurveChart';
import { downloadCsvFile, printCurrentReport } from '../common/exportHelpers';
import {
  formatLotRuleLabel,
  formatLinkProfitDisplay,
  formatTradeProfitDisplay,
  formatHeartbeatAge
} from '../common/dashboardHelpers';
import { computeReportingSummary } from '../../context/cloudStateUtils';

interface TraderDashboardProps {
  onNavigateTab: (tab: string) => void;
  onOpenConnectModal: () => void;
  onOpenLotModal: () => void;
}

export const TraderDashboard: React.FC<TraderDashboardProps> = ({
  onNavigateTab,
  onOpenConnectModal,
  onOpenLotModal
}) => {
  const { isCloudMode } = useAuth();
  const {
    currentUser,
    mt5Accounts,
    followerAccounts,
    parentChildLinks,
    mentorProfiles,
    mentorDirectory,
    subscriptions,
    trades,
    tradeMappings,
    mentorInvitations,
    refreshCloudData,
    toggleLinkStatus,
    unlinkTrader,
    disconnectMT5Account,
    reconnectMT5Account,
    toggleAutoTrading
  } = useApp();

  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [respondingInviteId, setRespondingInviteId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string>('');

  const pendingMentorInvites = mentorInvitations.filter(
    (inv) => inv.direction === 'mentor_invite' && inv.status === 'pending'
  );

  // Support multiple child MT5 accounts belonging to this trader
  const childAccounts = mt5Accounts.filter(
    (a) => a.userId === currentUser.id && a.accountRole === 'child'
  );
  const childAccount =
    childAccounts.find((a) => a.id === selectedChildId) || childAccounts[0] || undefined;

  // Find link scoped to selected child account
  const link = childAccount
    ? parentChildLinks.find((l) => l.childAccountId === childAccount.id) ||
      parentChildLinks.find((l) => l.traderId === currentUser.id)
    : parentChildLinks.find((l) => l.traderId === currentUser.id);
  const linkedParentAccount = link
    ? followerAccounts.find((a) => a.id === link.parentAccountId) ||
      mt5Accounts.find((a) => a.id === link.parentAccountId)
    : null;
  const linkedMentorDirectory = link
    ? mentorDirectory.find((m) => m.id === link.mentorId)
    : null;
  const mentorProfile =
    !isCloudMode && link ? mentorProfiles.find((m) => m.userId === link.mentorId) : null;
  const activeUserSub = subscriptions.find(
    (s) => s.userId === currentUser.id || s.mentorId === currentUser.id
  );

  // Trades & mappings on selected child account
  const scopedTrades = childAccount
    ? trades.filter((t) => t.accountId === childAccount.id)
    : [];
  const openTrades = scopedTrades.filter((t) => t.status === 'OPEN');
  const realOpenTrades = openTrades.filter((t) => !t.isMappingFallback);
  const closedRealizedTrades = scopedTrades.filter(
    (t) => !t.isMappingFallback && t.status === 'CLOSED' && (!isCloudMode || t.isRealized !== false)
  );
  const totalCommission = closedRealizedTrades.reduce((acc, t) => acc + Number(t.commission || 0), 0);
  const totalSwap = closedRealizedTrades.reduce((acc, t) => acc + Number(t.swap || 0), 0);
  const totalPips = closedRealizedTrades.reduce((acc, t) => acc + Number(t.pips || 0), 0);

  const traderMappings = tradeMappings.filter(
    (m) =>
      (childAccount ? m.childAccountId === childAccount.id : m.traderId === currentUser.id) &&
      (m.status === 'EXECUTED' || m.status === 'PENDING')
  );
  const scopedMappings = tradeMappings.filter((m) =>
    childAccount ? m.childAccountId === childAccount.id : m.traderId === currentUser.id
  );
  const reporting = computeReportingSummary({
    trades: scopedTrades,
    mappings: scopedMappings,
    accounts: childAccount ? [childAccount] : childAccounts,
    isCloudMode,
  });

  const linkProfit = link
    ? formatLinkProfitDisplay(link, isCloudMode)
    : { text: '$0.00', available: true, isPositive: true };

  const handleToggleCopyStream = async () => {
    if (!link) return;
    setActionBusy(true);
    setFeedback(null);
    const res = await toggleLinkStatus(link.id);
    setActionBusy(false);
    if (res && !res.success) {
      setFeedback({ message: res.message || 'Failed to update copying status.', isError: true });
    }
  };

  const handleConfirmUnlink = async () => {
    if (!link) return;
    setActionBusy(true);
    setFeedback(null);
    const res = await unlinkTrader(link.id);
    setActionBusy(false);
    if (res && !res.success) {
      setFeedback({ message: res.message || 'Failed to remove mentor link.', isError: true });
    } else {
      setFeedback({ message: 'Mentor link removed. Future trade mirroring halted.', isError: false });
    }
  };

  const handleTerminalConnectionToggle = async (
    accountId: string,
    action: 'disconnect' | 'reconnect'
  ) => {
    setActionBusy(true);
    setFeedback(null);
    const res =
      action === 'disconnect'
        ? await disconnectMT5Account(accountId)
        : await reconnectMT5Account(accountId);
    setActionBusy(false);
    if (!res.success) {
      setFeedback({
        message: res.message || `Failed to ${action} child MT5 terminal.`,
        isError: true,
      });
    } else if (res.message) {
      setFeedback({ message: res.message, isError: false });
    }
  };

  const handleRespondToInvite = async (invitationId: string, decision: 'accept' | 'reject') => {
    if (!isCloudMode) return;
    setRespondingInviteId(invitationId);
    setFeedback(null);
    try {
      const sessionCheck = await ensureValidSession();
      const token = sessionCheck.session?.access_token;
      if (!sessionCheck.valid || !token) {
        setFeedback({ message: 'Session expired. Please sign in again.', isError: true });
        return;
      }
      const res = await fetch(`/api/v1/bridge/trader/invitations/${encodeURIComponent(invitationId)}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          decision,
          childAccountId: childAccount?.id,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setFeedback({
          message: json?.error || `HTTP ${res.status}: Failed to ${decision} invitation.`,
          isError: true,
        });
        return;
      }
      await refreshCloudData();
      setFeedback({
        message:
          decision === 'accept'
            ? 'Mentor invitation accepted and trade copying activated.'
            : 'Mentor invitation declined.',
        isError: false,
      });
    } catch (err: any) {
      setFeedback({ message: err.message || 'Network error responding to invitation.', isError: true });
    } finally {
      setRespondingInviteId(null);
    }
  };

  const handleExportCsv = () => {
    downloadCsvFile(
      `tradesync_trader_report_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Ticket', 'Symbol', 'Type', 'Lots', 'Open Price', 'Close Price', 'Commission', 'Swap', 'Pips', 'Profit', 'Status', 'Open Time', 'Close Time'],
      scopedTrades
        .filter((t) => !t.isMappingFallback)
        .map((t) => [
          t.ticket,
          t.symbol,
          t.type,
          t.lots.toFixed(2),
          t.openPrice,
          t.closePrice ?? '',
          t.commission ?? 0,
          t.swap ?? 0,
          t.pips ?? 0,
          t.profit.toFixed(2),
          t.status,
          t.openTime,
          t.closeTime ?? '',
        ])
    );
  };

  const copyingStreamSubtitle = !childAccount
    ? 'Terminal offline'
    : childAccount.isStale
    ? `Stale heartbeat (${formatHeartbeatAge(childAccount.lastHeartbeat)})`
    : childAccount.connectionStatus === 'connected'
    ? isCloudMode
      ? `Synced ${formatHeartbeatAge(childAccount.lastHeartbeat)}`
      : `${childAccount.pingMs}ms connection`
    : 'Terminal offline';

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              Trader Workspace (Child Account)
            </h1>
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald-400">
              FOLLOWER SUBSCRIBER
            </span>
            <span className="rounded bg-amber-950/60 border border-amber-800/70 px-2 py-0.5 text-[10px] font-mono font-semibold text-amber-300">
              DEMO-ONLY EA
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Automated Demo trade mirroring client connected to verified mentor strategies.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleExportCsv}
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
          {childAccounts.length > 1 && childAccount && (
            <select
              value={childAccount.id}
              onChange={(e) => setSelectedChildId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:border-emerald-500 focus:outline-none"
              aria-label="Select Child MT5 Account"
            >
              {childAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  #{acc.accountNumber} ({acc.broker})
                </option>
              ))}
            </select>
          )}
          {childAccount && (
            <button
              onClick={() => toggleAutoTrading(childAccount.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                childAccount.autoTradingEnabled
                  ? 'border-emerald-800 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50'
                  : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-750'
              }`}
            >
              <Power className="h-3.5 w-3.5" />
              <span>{childAccount.autoTradingEnabled ? 'Auto-Trading ON' : 'Auto-Trading OFF'}</span>
            </button>
          )}

          {link && (
            <button
              onClick={handleToggleCopyStream}
              disabled={actionBusy}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                link.status === 'active'
                  ? 'border border-amber-800 bg-amber-950/50 hover:bg-amber-900/50 text-amber-300'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              {link.status === 'active' ? (
                <>
                  <PauseCircle className="h-4 w-4" />
                  <span>Pause Copying</span>
                </>
              ) : (
                <>
                  <PlayCircle className="h-4 w-4" />
                  <span>Enable Copying</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={onOpenConnectModal}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>{childAccount ? 'Add Child MT5' : 'Connect Child MT5'}</span>
          </button>
        </div>
      </div>

      {/* Mode Status Notice */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs flex items-center justify-between text-slate-400">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>
            {isCloudMode ? (
              <>
                <strong>Cloud Demo Bridge Mode:</strong> Authenticated child receiver polling live Supabase copy instructions (ACCOUNT_TRADE_MODE_DEMO enforced).
              </>
            ) : (
              <>
                <strong>Demo Sandbox Mode:</strong> Copying signals are simulated against broker demo servers. Zero real capital at risk.
              </>
            )}
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-500 hidden sm:inline">
          {isCloudMode ? 'Supabase Cloud Bridge' : 'Local Demo Simulator'}
        </span>
      </div>

      {feedback && (
        <div
          className={`rounded-lg border p-3 text-xs flex items-center gap-2 ${
            feedback.isError
              ? 'border-rose-900/60 bg-rose-950/50 text-rose-300'
              : 'border-emerald-900/60 bg-emerald-950/50 text-emerald-300'
          }`}
        >
          {feedback.isError ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {isCloudMode && pendingMentorInvites.length > 0 && (
        <div className="rounded-xl border border-cyan-800/60 bg-cyan-950/20 p-4 space-y-2.5 text-xs">
          <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-cyan-300">
            <Mail className="h-4 w-4" />
            <span>Pending Mentor Invitations ({pendingMentorInvites.length})</span>
          </div>
          {pendingMentorInvites.map((inv) => {
            const busy = respondingInviteId === inv.id;
            return (
              <div
                key={inv.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3"
              >
                <div>
                  <span className="font-semibold text-white">{inv.mentorName || 'Verified Mentor'}</span>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {inv.message || 'Invited you to link your Child MT5 Demo account.'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRespondToInvite(inv.id, 'accept')}
                    className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors"
                  >
                    {busy ? 'Working...' : 'Accept & Link'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRespondToInvite(inv.id, 'reject')}
                    className="rounded-lg border border-rose-800 bg-rose-950/50 hover:bg-rose-900/50 disabled:opacity-50 px-3 py-1.5 text-[11px] font-semibold text-rose-300 transition-colors"
                  >
                    Decline
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Account Equity"
          value={childAccount ? `$${childAccount.equity.toLocaleString()}` : '$0.00'}
          subtitle={childAccount ? `Balance: $${childAccount.balance.toLocaleString()}` : 'Not connected'}
          icon={Activity}
          accentColor="emerald"
        />
        <StatsCard
          title="Free Margin"
          value={childAccount ? `$${childAccount.freeMargin.toLocaleString()}` : '$0.00'}
          subtitle={
            childAccount
              ? `Margin: $${childAccount.margin.toLocaleString()} (1:${childAccount.leverage})`
              : 'No terminal bound'
          }
          icon={Shield}
          accentColor="teal"
        />
        <StatsCard
          title="Trades Copied"
          value={link ? link.totalTradesCopied : 0}
          subtitle={
            link
              ? linkProfit.available
                ? `Total PnL: ${linkProfit.text}`
                : linkProfit.text
              : 'No mentor linked'
          }
          icon={TrendingUp}
          accentColor="blue"
          onClick={() => onNavigateTab('copied-trades')}
        />
        <StatsCard
          title="Copying Stream"
          value={link?.status === 'active' ? 'ENABLED' : link ? 'PAUSED' : 'UNLINKED'}
          subtitle={copyingStreamSubtitle}
          icon={Zap}
          accentColor={
            childAccount?.isStale ? 'amber' : link?.status === 'active' ? 'emerald' : 'amber'
          }
        />
      </div>

      {/* Grid: Child MT5 Terminal + Linked Mentor & Lot Config */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Child MT5 Terminal Card */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Child MT5 Terminal Node
              </h3>
            </div>
            {childAccount ? (
              <div className="flex items-center gap-2">
                {childAccount.isStale && (
                  <span className="rounded bg-amber-950/70 border border-amber-800/70 px-2 py-0.5 text-[10px] font-mono font-semibold text-amber-300">
                    Stale Heartbeat
                  </span>
                )}
                <StatusBadge status={childAccount.connectionStatus} size="sm" />
                {childAccount.connectionStatus === 'connected' ? (
                  <button
                    onClick={() => void handleTerminalConnectionToggle(childAccount.id, 'disconnect')}
                    disabled={actionBusy}
                    className="text-xs text-rose-400 hover:text-rose-300 font-medium disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => void handleTerminalConnectionToggle(childAccount.id, 'reconnect')}
                    disabled={actionBusy}
                    className="text-xs text-cyan-400 hover:text-cyan-300 font-medium disabled:opacity-50"
                    title={isCloudMode ? 'Activation requires an authenticated EA heartbeat' : 'Reconnect Demo Terminal'}
                  >
                    {isCloudMode ? 'Refresh EA Status' : 'Reconnect'}
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={onOpenConnectModal}
                className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold"
              >
                + Connect Terminal
              </button>
            )}
          </div>

          {childAccount ? (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-slate-950/70 border border-slate-800 p-4 font-mono">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Account Login</span>
                  <p className="font-bold text-white text-sm">#{childAccount.accountNumber}</p>
                  <span className="text-[10px] text-slate-400 font-sans">{childAccount.broker}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Broker Server &amp; Symbol</span>
                  <p className="font-bold text-slate-200 truncate">
                    {childAccount.server} • <span className="text-amber-300">{childAccount.tradingSymbol || 'XAUUSD'}</span>
                  </p>
                  <span
                    className={`text-[10px] font-sans ${
                      childAccount.isStale ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    {isCloudMode
                      ? `${formatHeartbeatAge(childAccount.lastHeartbeat)} • ${
                          childAccount.symbolVerified ? 'Verified' : 'Unverified Baseline'
                        }`
                      : `${childAccount.pingMs}ms Latency`}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Balance ($)</span>
                  <p className="font-bold text-white text-sm">
                    ${childAccount.balance.toLocaleString()}
                  </p>
                  <span className="text-[10px] text-slate-400 font-sans">
                    Margin: ${childAccount.margin.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Free Margin</span>
                  <p className="font-bold text-emerald-400 text-sm">
                    ${childAccount.freeMargin.toLocaleString()}
                  </p>
                  <span className="text-[10px] text-slate-400 font-sans">
                    Leverage 1:{childAccount.leverage}
                  </span>
                </div>
              </div>

              {/* Open Copied Positions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {isCloudMode && realOpenTrades.length === 0
                      ? `Live Mirrored Positions (${traderMappings.length})`
                      : `Live Open Positions (${realOpenTrades.length})`}
                  </span>
                  <button
                    onClick={() => onNavigateTab('copied-trades')}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300"
                  >
                    View All History
                  </button>
                </div>

                {realOpenTrades.length > 0 ? (
                  <div className="space-y-2">
                    {realOpenTrades.map((t) => {
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
                                {t.lots.toFixed(2)} lots @ {t.openPrice || '--'}
                              </span>
                            </div>
                          </div>

                          <div className="text-right font-mono text-xs">
                            <div
                              className={
                                !pnl.available
                                  ? 'text-slate-400 font-medium'
                                  : pnl.isPositive
                                  ? 'text-emerald-400 font-bold'
                                  : 'text-rose-400 font-bold'
                              }
                            >
                              {pnl.text}
                            </div>
                            <span className="text-[10px] text-slate-500">Ticket #{t.ticket}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : isCloudMode && traderMappings.length > 0 ? (
                  <div className="space-y-2">
                    {traderMappings.slice(0, 5).map((m) => (
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
                              {m.childLots.toFixed(2)} lots (Parent #{m.parentTradeTicket})
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <StatusBadge status={m.status} size="sm" />
                          <span className="text-[10px] font-mono text-slate-500">
                            {m.childTradeTicket ? `#${m.childTradeTicket}` : `${m.latencyMs}ms`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4 text-center text-slate-500 text-xs">
                    No active positions currently running on your account.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center space-y-3">
              <Server className="h-8 w-8 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">
                You haven't bound an MT5 terminal yet. Connect your broker Demo account to start copying trades.
              </p>
              <button
                onClick={onOpenConnectModal}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-semibold text-white transition-colors"
              >
                Connect Child MT5
              </button>
            </div>
          )}
        </div>

        {/* Linked Mentor & Lot Settings Card */}
        <div className="space-y-4">
          {/* Mentor Details Box */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Linked Mentor</h3>
              </div>
              {link && <StatusBadge status={link.status} size="sm" />}
            </div>

            {link ? (
              <div className="space-y-3 text-xs">
                <div>
                  <h4 className="font-bold text-white text-base">{link.mentorName}</h4>
                  <p className="text-cyan-400 text-[11px] font-medium">
                    {isCloudMode
                      ? linkedParentAccount
                        ? `Master MT5 #${linkedParentAccount.accountNumber} (${linkedParentAccount.broker})`
                        : linkedMentorDirectory?.parentAccountNumber
                        ? `Master MT5 #${linkedMentorDirectory.parentAccountNumber} (${linkedMentorDirectory.brokerName})`
                        : 'Verified Cloud Bridge Mentor'
                      : mentorProfile?.strategyName || 'Mentor Strategy'}
                  </p>
                </div>

                {isCloudMode ? (
                  <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-1.5 font-mono text-[11px]">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Parent Terminal:</span>
                      <span className="text-slate-200 font-semibold">
                        {linkedParentAccount?.connectionStatus ||
                          linkedMentorDirectory?.connectionStatus ||
                          'unknown'}
                        {(linkedParentAccount?.isStale || linkedMentorDirectory?.isStale) &&
                          ' (stale)'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Last Parent Sync:</span>
                      <span className="text-slate-200">
                        {formatHeartbeatAge(
                          linkedParentAccount?.lastHeartbeat || linkedMentorDirectory?.lastSync
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Realized P&amp;L:</span>
                      <span
                        className={
                          !linkProfit.available
                            ? 'text-slate-400'
                            : linkProfit.isPositive
                            ? 'text-emerald-400 font-bold'
                            : 'text-rose-400 font-bold'
                        }
                      >
                        {linkProfit.text}
                      </span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-slate-800/80">
                      <span className="text-slate-400">SaaS License:</span>
                      <button
                        type="button"
                        onClick={() => onNavigateTab('subscription')}
                        className="text-cyan-400 hover:underline font-sans font-semibold"
                      >
                        {activeUserSub ? `${activeUserSub.planName} (${activeUserSub.status})` : 'Manage Billing →'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-1.5 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Strategy Win Rate:</span>
                      <span className="text-emerald-400 font-bold">{mentorProfile?.winRate ?? '--'}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Profit Factor:</span>
                      <span className="text-white font-bold">{mentorProfile?.profitFactor ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Subscription Fee:</span>
                      <span className="text-slate-200">${mentorProfile?.monthlyFee ?? 0}/mo</span>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => setUnlinkConfirmOpen(true)}
                    disabled={actionBusy}
                    className="w-full rounded-lg border border-rose-900/60 bg-rose-950/40 hover:bg-rose-900/60 py-1.5 text-xs text-rose-300 font-semibold transition-colors disabled:opacity-50"
                  >
                    Sever Mentor Link
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400 space-y-2">
                <p>You are not currently linked to any mentor strategy.</p>
                <button
                  onClick={() => onNavigateTab('mentor-link')}
                  className="w-full rounded-lg bg-cyan-600 hover:bg-cyan-500 py-1.5 text-xs text-white font-semibold transition-colors"
                >
                  Join via Mentor Invite Code
                </button>
              </div>
            )}
          </div>

          {/* Lot Size Rules Mini Box */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase">Lot Size Rules</span>
              <button
                onClick={onOpenLotModal}
                className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Configure
              </button>
            </div>

            {link ? (
              <div className="space-y-2 text-xs">
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-1 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Sizing Rule:</span>
                    <span className="text-cyan-400 font-bold">
                      {formatLotRuleLabel(link.lotSettings)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Max Lot Cap:</span>
                    <span className="text-slate-200">{link.lotSettings.maxLotCap} lots</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Slippage Tolerance:</span>
                    <span className="text-slate-200">{link.lotSettings.slippageMaxPips} pips</span>
                  </div>
                  {isCloudMode && (
                    <p className="pt-1 border-t border-slate-800/80 text-[10px] font-sans text-slate-500">
                      All 12 sizing &amp; risk controls persist in Supabase and enforce server-side.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <span className="text-slate-500 text-xs italic">
                Link to a mentor to configure lot sizing.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Realized Reporting & Equity Curve */}
      <RealEquityCurveChart
        trades={scopedTrades}
        isCloudMode={isCloudMode}
        variant="dark"
        title="Follower Realized Performance Curve"
        subtitle={
          reporting.realizedPnlAvailable
            ? `Cumulative net profit across ${reporting.realizedClosedCount} settled child deal(s)`
            : 'Renders automatically from closed child MT5 deals'
        }
      />

      {/* Realized Reporting & Execution Metrics */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Performance &amp; Copier Reporting
            </h3>
            <p className="text-[11px] text-slate-400">
              {reporting.realizedPnlAvailable
                ? `Computed strictly from ${reporting.realizedClosedCount} settled MT5 deal(s). Commission: $${totalCommission.toFixed(2)} • Swap: $${totalSwap.toFixed(2)} • Net Pips: ${totalPips.toFixed(1)}`
                : 'Awaiting closed deal data from MT5 Expert Advisor.'}
            </p>
          </div>
          <span className="font-mono text-[11px] text-slate-400">
            {reporting.executedCopiesCount} Executed • {reporting.failedCopiesCount} Failed
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs font-mono">
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <span className="text-[10px] text-slate-500 uppercase font-sans">Realized P&amp;L</span>
            <p
              className={`font-bold text-sm mt-0.5 ${
                !reporting.realizedPnlAvailable
                  ? 'text-slate-400 font-normal text-xs'
                  : reporting.realizedPnlUSD >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {reporting.realizedPnlAvailable
                ? `${reporting.realizedPnlUSD >= 0 ? '+' : '-'}$${Math.abs(reporting.realizedPnlUSD).toFixed(2)}`
                : 'Awaiting EA sync'}
            </p>
          </div>

          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <span className="text-[10px] text-slate-500 uppercase font-sans">Floating / Open P&amp;L</span>
            <p
              className={`font-bold text-sm mt-0.5 ${
                !reporting.floatingPnlAvailable
                  ? 'text-slate-400 font-normal text-xs'
                  : reporting.floatingPnlUSD >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {reporting.floatingPnlAvailable
                ? `${reporting.floatingPnlUSD >= 0 ? '+' : '-'}$${Math.abs(reporting.floatingPnlUSD).toFixed(2)}`
                : 'Awaiting EA sync'}
            </p>
          </div>

          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <span className="text-[10px] text-slate-500 uppercase font-sans">Win Rate</span>
            <p className="font-bold text-white text-sm mt-0.5">
              {reporting.winRatePercent !== null ? `${reporting.winRatePercent}%` : '--'}
            </p>
          </div>

          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <span className="text-[10px] text-slate-500 uppercase font-sans">Profit Factor</span>
            <p className="font-bold text-white text-sm mt-0.5">
              {reporting.profitFactor !== null ? reporting.profitFactor.toFixed(2) : '--'}
            </p>
          </div>

          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <span className="text-[10px] text-slate-500 uppercase font-sans">24h / 7d Realized</span>
            <p className="font-bold text-slate-200 text-xs mt-1">
              {reporting.dailyRealizedUSD !== null
                ? `$${reporting.dailyRealizedUSD.toFixed(2)} / $${(reporting.weeklyRealizedUSD ?? 0).toFixed(2)}`
                : '-- / --'}
            </p>
          </div>

          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <span className="text-[10px] text-slate-500 uppercase font-sans">30d Realized</span>
            <p className="font-bold text-slate-200 text-sm mt-0.5">
              {reporting.monthlyRealizedUSD !== null ? `$${reporting.monthlyRealizedUSD.toFixed(2)}` : '--'}
            </p>
          </div>

          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3">
            <span className="text-[10px] text-slate-500 uppercase font-sans">Avg Copy Delay</span>
            <p className="font-bold text-cyan-400 text-sm mt-0.5">
              {reporting.avgCopyLatencyMs !== null ? `${reporting.avgCopyLatencyMs}ms` : '--'}
            </p>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={unlinkConfirmOpen}
        onClose={() => setUnlinkConfirmOpen(false)}
        onConfirm={() => {
          void handleConfirmUnlink();
        }}
        title="Sever Mentor Link?"
        description={`Disconnecting from ${link?.mentorName || 'this mentor'} immediately halts future copied trades on your Child MT5 terminal. Existing open positions remain on your broker account.`}
        confirmLabel="Sever Link"
        variant="danger"
        isLoading={actionBusy}
      />
    </div>
  );
};
