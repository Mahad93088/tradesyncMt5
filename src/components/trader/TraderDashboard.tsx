import React, { useState } from 'react';
import {
  Server,
  Activity,
  UserCheck,
  SlidersHorizontal,
  PlayCircle,
  PauseCircle,
  AlertTriangle,
  Unlink,
  TrendingUp,
  Zap,
  ArrowRight,
  Shield,
  Clock,
  Plus
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatsCard } from '../common/StatsCard';
import { StatusBadge } from '../common/StatusBadge';

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
  const {
    currentUser,
    mt5Accounts,
    parentChildLinks,
    mentorProfiles,
    trades,
    toggleLinkStatus,
    unlinkTrader,
    disconnectMT5Account,
    reconnectMT5Account
  } = useApp();

  // Find child MT5 account
  const childAccount = mt5Accounts.find(
    (a) => a.userId === currentUser.id && a.accountRole === 'child'
  );

  // Find linked mentor
  const link = parentChildLinks.find((l) => l.traderId === currentUser.id);
  const mentorProfile = link ? mentorProfiles.find((m) => m.userId === link.mentorId) : null;

  // Open trades on this child account
  const openTrades = trades.filter(
    (t) => childAccount && t.accountId === childAccount.id && t.status === 'OPEN'
  );

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              Trader Workspace (Child Account)
            </h1>
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald-400">
              FOLLOWER SUBSCRIBER
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Automated trade mirroring client connected to professional mentor strategies.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {link && (
            <button
              onClick={() => toggleLinkStatus(link.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
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

          {!childAccount && (
            <button
              onClick={onOpenConnectModal}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Connect Child MT5</span>
            </button>
          )}
        </div>
      </div>

      {/* Demo Notice */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs flex items-center justify-between text-slate-400">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>
            <strong>Demo Sandbox Mode:</strong> Copying signals are simulated against broker demo servers. Zero real capital at risk.
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-500 hidden sm:inline">
          FastAPI Copy Engine Active
        </span>
      </div>

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
          subtitle={childAccount ? `Leverage 1:${childAccount.leverage}` : 'Leverage 0'}
          icon={Shield}
          accentColor="teal"
        />
        <StatsCard
          title="Trades Copied"
          value={link ? link.totalTradesCopied : 0}
          subtitle={`Total PnL: ${link && link.totalProfitUSD >= 0 ? '+' : ''}$${link?.totalProfitUSD.toLocaleString() || '0.00'}`}
          icon={TrendingUp}
          accentColor="blue"
          onClick={() => onNavigateTab('copied-trades')}
        />
        <StatsCard
          title="Copying Stream"
          value={link?.status === 'active' ? 'ENABLED' : link ? 'PAUSED' : 'UNLINKED'}
          subtitle={childAccount?.connectionStatus === 'connected' ? `${childAccount.pingMs}ms connection` : 'Terminal offline'}
          icon={Zap}
          accentColor={link?.status === 'active' ? 'emerald' : 'amber'}
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
                <StatusBadge status={childAccount.connectionStatus} size="sm" />
                {childAccount.connectionStatus === 'connected' ? (
                  <button
                    onClick={() => disconnectMT5Account(childAccount.id)}
                    className="text-xs text-rose-400 hover:text-rose-300 font-medium"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => reconnectMT5Account(childAccount.id)}
                    className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
                  >
                    Reconnect
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
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Broker Server</span>
                  <p className="font-bold text-slate-200">{childAccount.server}</p>
                  <span className="text-[10px] text-emerald-400 font-sans">{childAccount.pingMs}ms Latency</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Balance ($)</span>
                  <p className="font-bold text-white text-sm">
                    ${childAccount.balance.toLocaleString()}
                  </p>
                  <span className="text-[10px] text-slate-400 font-sans">Margin: ${childAccount.margin.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Free Margin</span>
                  <p className="font-bold text-emerald-400 text-sm">
                    ${childAccount.freeMargin.toLocaleString()}
                  </p>
                  <span className="text-[10px] text-slate-400 font-sans">Leverage 1:{childAccount.leverage}</span>
                </div>
              </div>

              {/* Open Copied Positions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Live Open Positions ({openTrades.length})
                  </span>
                  <button
                    onClick={() => onNavigateTab('copied-trades')}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300"
                  >
                    View All History
                  </button>
                </div>

                {openTrades.length > 0 ? (
                  <div className="space-y-2">
                    {openTrades.map((t) => (
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

                        <div className="text-right font-mono text-xs">
                          <div className={t.profit >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                            {t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}
                          </div>
                          <span className="text-[10px] text-slate-500">Ticket #{t.ticket}</span>
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
                You haven't bound an MT5 terminal yet. Connect your broker account to start copying trades.
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
                    {mentorProfile?.strategyName || 'Algorithmic Gold & Flow'}
                  </p>
                </div>

                <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-1.5 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Strategy Win Rate:</span>
                    <span className="text-emerald-400 font-bold">{mentorProfile?.winRate || 68.4}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Profit Factor:</span>
                    <span className="text-white font-bold">{mentorProfile?.profitFactor || 2.31}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Subscription Fee:</span>
                    <span className="text-slate-200">${mentorProfile?.monthlyFee || 149}/mo</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => unlinkTrader(link.id)}
                    className="w-full rounded-lg border border-rose-900/60 bg-rose-950/40 hover:bg-rose-900/60 py-1.5 text-xs text-rose-300 font-semibold transition-colors"
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
                    <span className="text-slate-400">Mode:</span>
                    <span className="text-white font-bold">
                      {link.lotSettings.mode === 'parent_lot' ? 'Mode A: 1:1 Copy' : 'Mode B: Custom'}
                    </span>
                  </div>
                  {link.lotSettings.mode === 'custom_lot' && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Sizing Rule:</span>
                      <span className="text-cyan-400 font-bold uppercase">
                        {link.lotSettings.customType}:{' '}
                        {link.lotSettings.customType === 'fixed'
                          ? `${link.lotSettings.fixedLot}L`
                          : link.lotSettings.customType === 'multiplier'
                          ? `${link.lotSettings.multiplier}x`
                          : `${link.lotSettings.riskPercent}%`}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-400">Max Lot Cap:</span>
                    <span className="text-slate-200">{link.lotSettings.maxLotCap} lots</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Slippage Tolerance:</span>
                    <span className="text-slate-200">{link.lotSettings.slippageMaxPips} pips</span>
                  </div>
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
    </div>
  );
};
