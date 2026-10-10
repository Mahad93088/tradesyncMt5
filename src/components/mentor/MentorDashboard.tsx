import React, { useState } from 'react';
import {
  Server,
  Activity,
  Users,
  Ticket,
  Zap,
  TrendingUp,
  AlertTriangle,
  PlayCircle,
  PauseCircle,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Shield,
  CreditCard,
  Copy,
  Check,
  Plus
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatsCard } from '../common/StatsCard';
import { StatusBadge } from '../common/StatusBadge';

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
  const {
    currentUser,
    mt5Accounts,
    mentorProfiles,
    subscriptions,
    parentChildLinks,
    trades,
    tradeMappings,
    syncLogs,
    simulateParentClose
  } = useApp();

  const [copiedCode, setCopiedCode] = useState(false);

  // Find this mentor's parent MT5 account
  const parentAccount = mt5Accounts.find(
    (a) => a.userId === currentUser.id && a.accountRole === 'parent'
  );

  const profile = mentorProfiles.find((m) => m.userId === currentUser.id) || mentorProfiles[0];
  const sub = subscriptions.find((s) => s.mentorId === currentUser.id);

  // Follower links
  const mentorLinks = parentChildLinks.filter((l) => l.mentorId === currentUser.id);
  const activeFollowers = mentorLinks.filter((l) => l.status === 'active').length;

  // Recent open trades on parent account
  const openParentTrades = trades.filter(
    (t) => parentAccount && t.accountId === parentAccount.id && t.status === 'OPEN'
  );

  // Recent mappings for this mentor
  const mentorMappings = tradeMappings.filter((m) => m.mentorId === currentUser.id);

  const handleCopyCode = () => {
    if (profile?.inviteCode) {
      navigator.clipboard.writeText(profile.inviteCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

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
            {profile?.strategyName} • Strategy performance and multi-follower automated mirror dispatcher.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenInviteModal}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 px-3.5 py-1.5 text-xs font-semibold text-slate-200 transition-colors"
          >
            <Ticket className="h-4 w-4 text-sky-400" />
            <span>Invite Traders</span>
          </button>
          {!parentAccount && (
            <button
              onClick={onOpenConnectModal}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Connect Parent MT5</span>
            </button>
          )}
        </div>
      </div>

      {/* Demo Notice */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs flex items-center justify-between text-slate-400">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-sky-400 shrink-0" />
          <span>
            <strong>Demo Sandbox:</strong> Parent trades are executed against demo liquidity pools and mirrored with simulated latency.
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-500 hidden sm:inline">
          MetaTrader 5 Demo Protocol
        </span>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Active Followers"
          value={activeFollowers}
          subtitle={`Max ${profile?.maxFollowers || 25} capacity`}
          icon={Users}
          accentColor="teal"
          onClick={() => onNavigateTab('child-accounts')}
        />
        <StatsCard
          title="Strategy Win Rate"
          value={`${profile?.winRate || 68.4}%`}
          subtitle={`Profit Factor: ${profile?.profitFactor || 2.31}`}
          icon={TrendingUp}
          accentColor="emerald"
        />
        <StatsCard
          title="Parent MT5 Equity"
          value={parentAccount ? `$${parentAccount.equity.toLocaleString()}` : '$0.00'}
          subtitle={parentAccount ? `${parentAccount.currency} • 1:${parentAccount.leverage}` : 'No account'}
          icon={Activity}
          accentColor="blue"
        />
        <StatsCard
          title="Mirror Stream Status"
          value={parentAccount?.connectionStatus === 'connected' ? 'LIVE' : 'OFFLINE'}
          subtitle={parentAccount?.connectionStatus === 'connected' ? `${parentAccount.pingMs}ms socket ping` : 'Terminal disconnected'}
          icon={Zap}
          accentColor={parentAccount?.connectionStatus === 'connected' ? 'emerald' : 'rose'}
        />
      </div>

      {/* Grid: Parent MT5 Terminal Node + Invitation Quick Box */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Parent MT5 Terminal Card */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Parent MT5 Master Terminal
              </h3>
            </div>
            {parentAccount ? (
              <div className="flex items-center gap-2">
                <StatusBadge status={parentAccount.connectionStatus} size="sm" />
                <button
                  onClick={onOpenConnectModal}
                  className="text-xs text-cyan-400 hover:text-cyan-300 font-medium"
                >
                  Configure
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
                  <span className="text-[10px] text-slate-400 font-sans">{parentAccount.broker}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Broker Server</span>
                  <p className="font-bold text-slate-200">{parentAccount.server}</p>
                  <span className="text-[10px] text-emerald-400 font-sans">{parentAccount.pingMs}ms Latency</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Account Balance</span>
                  <p className="font-bold text-white text-sm">
                    ${parentAccount.balance.toLocaleString()}
                  </p>
                  <span className="text-[10px] text-slate-400 font-sans">Margin: ${parentAccount.margin.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-sans">Free Margin</span>
                  <p className="font-bold text-emerald-400 text-sm">
                    ${parentAccount.freeMargin.toLocaleString()}
                  </p>
                  <span className="text-[10px] text-slate-400 font-sans">Leverage 1:{parentAccount.leverage}</span>
                </div>
              </div>

              {/* Open Positions On Master */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Active Parent Deals ({openParentTrades.length})
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Auto-mirrored to {activeFollowers} follower terminals
                  </span>
                </div>

                {openParentTrades.length > 0 ? (
                  <div className="space-y-2">
                    {openParentTrades.map((t) => (
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
                            <div className={t.profit >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                              {t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}
                            </div>
                            <span className="text-[10px] text-slate-500">Ticket #{t.ticket}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => simulateParentClose(t.ticket)}
                            className="rounded border border-amber-800/80 bg-amber-950/60 hover:bg-amber-900/60 text-amber-300 px-2 py-1 text-[10px] font-semibold transition-colors shadow-sm"
                            title="Close position and mirror close to linked subscribers"
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4 text-center text-slate-500 text-xs">
                    No open positions on parent terminal. Waiting for new signal.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center space-y-3">
              <Server className="h-8 w-8 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">
                You haven't bound a Parent MT5 terminal yet. Connect your account to broadcast trades to subscribers.
              </p>
              <button
                onClick={onOpenConnectModal}
                className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-xs font-semibold text-white transition-colors"
              >
                Connect Parent MT5
              </button>
            </div>
          )}
        </div>

        {/* Quick Invite & Subscription Status Box */}
        <div className="space-y-4">
          {/* Quick Invite Code Box */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg space-y-3">
            <div className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Trader Invite Code</h3>
            </div>
            <p className="text-xs text-slate-400">
              Provide this code to new traders so they can link their child account to your strategy.
            </p>

            <div className="flex items-center justify-between rounded-xl bg-slate-950 border border-slate-800 p-3">
              <span className="font-mono text-sm font-bold text-white tracking-widest">
                {profile?.inviteCode || 'ALPHA-XAU-2026'}
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

          {/* Subscription Mini Card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase">Subscription Tier</span>
              <StatusBadge status={sub?.status || 'active'} size="sm" />
            </div>
            <h4 className="font-bold text-white text-sm">{sub?.planName || 'Pro Mentor (Yearly)'}</h4>
            <div className="text-xs text-slate-400 space-y-1 font-mono">
              <div className="flex justify-between">
                <span>Follower Quota:</span>
                <span className="text-white">{activeFollowers} / {profile?.maxFollowers || 25}</span>
              </div>
              <div className="flex justify-between">
                <span>Renewal Expiry:</span>
                <span className="text-cyan-400">
                  {sub?.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : 'N/A'}
                </span>
              </div>
            </div>
            <button
              onClick={() => onNavigateTab('subscription')}
              className="w-full rounded-lg bg-slate-800 hover:bg-slate-700 py-1.5 text-xs text-slate-200 font-semibold transition-colors"
            >
              Manage Subscription Plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
