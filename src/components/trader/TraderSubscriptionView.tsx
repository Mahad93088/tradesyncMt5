import React from 'react';
import {
  Check,
  AlertCircle,
  Info
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { StatusBadge } from '../common/StatusBadge';
import {
  formatLinkProfitDisplay,
  formatLotRuleLabel,
  formatHeartbeatAge
} from '../common/dashboardHelpers';

export const TraderSubscriptionView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const {
    currentUser,
    parentChildLinks,
    mentorProfiles,
    mentorDirectory,
    mt5Accounts,
    followerAccounts
  } = useApp();

  const childAccount = mt5Accounts.find(
    (a) => a.userId === currentUser.id && a.accountRole === 'child'
  );
  const link = parentChildLinks.find((l) => l.traderId === currentUser.id);
  const mentorProfile = !isCloudMode && link ? mentorProfiles.find((m) => m.userId === link.mentorId) : null;
  const linkedParentAccount = link
    ? followerAccounts.find((a) => a.id === link.parentAccountId) ||
      mt5Accounts.find((a) => a.id === link.parentAccountId)
    : null;
  const linkedMentorDir = link ? mentorDirectory.find((m) => m.id === link.mentorId) : null;
  const linkProfit = link ? formatLinkProfitDisplay(link, isCloudMode) : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          Trader Subscription &amp; Strategy Access
          <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono">
            {isCloudMode ? 'Cloud Demo Entitlement' : 'Follower License'}
          </span>
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          {isCloudMode
            ? 'Active Demo bridge copying entitlement, mentor link status, and Supabase billing schema readiness.'
            : 'Overview of your active follower tier, linked strategy subscription fees, and renewal billing cycle.'}
        </p>
      </div>

      {isCloudMode ? (
        <>
          {/* Honest Schema Status Banner */}
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3.5 text-xs flex items-start gap-2.5 text-amber-200">
            <Info className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              <strong>Subscription Plans, Invoices &amp; Trials Not Yet Provisioned in Supabase:</strong>{' '}
              Dedicated billing tables (<code>subscription_plans</code>, <code>subscriptions</code>, <code>payments</code>) are not yet deployed in the Cloud schema. Your active Demo copying entitlement is governed by your authenticated profile and active mentor assignment.
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Cloud Entitlement Card */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
              <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                    Platform Demo Entitlement
                  </span>
                  <h3 className="text-base font-bold text-slate-100 mt-0.5">
                    Child Demo Copy Access
                  </h3>
                </div>
                <StatusBadge status={currentUser.status} size="sm" />
              </div>

              <div className="space-y-2 text-xs text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-400">Registered Child MT5:</span>
                  <span className="font-mono text-white">
                    {childAccount ? `#${childAccount.accountNumber} (${childAccount.broker})` : 'Not connected'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Account Safeguard:</span>
                  <span className="font-mono text-emerald-400">ACCOUNT_TRADE_MODE_DEMO Only</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Billing / Invoices:</span>
                  <span className="font-mono text-slate-400">Pending Schema Provisioning</span>
                </div>
              </div>
            </div>

            {/* Linked Mentor Cloud Assignment Card */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
              <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                    Linked Mentor Assignment
                  </span>
                  <h3 className="text-base font-bold text-slate-100 mt-0.5">
                    {link ? link.mentorName : 'No Active Mentor'}
                  </h3>
                </div>
                {link ? (
                  <StatusBadge status={link.status} size="sm" />
                ) : (
                  <span className="text-xs text-slate-500 font-mono">Unlinked</span>
                )}
              </div>

              {link ? (
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Lot Rule:</span>
                    <span className="font-mono text-cyan-400 font-semibold">
                      {formatLotRuleLabel(link.lotSettings)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Parent Terminal:</span>
                    <span className="font-mono text-slate-200">
                      {linkedParentAccount
                        ? `#${linkedParentAccount.accountNumber} (${linkedParentAccount.connectionStatus})`
                        : linkedMentorDir?.parentAccountNumber
                        ? `#${linkedMentorDir.parentAccountNumber} (${linkedMentorDir.connectionStatus})`
                        : 'Pending telemetry'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Last Parent Heartbeat:</span>
                    <span className="font-mono text-slate-300">
                      {formatHeartbeatAge(linkedParentAccount?.lastHeartbeat || linkedMentorDir?.lastSync)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Mirrored Deals / P&amp;L:</span>
                    <span className="font-mono text-slate-300">
                      {link.totalTradesCopied} ({linkProfit?.text})
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 py-4 text-center">
                  <p className="text-xs text-slate-400">
                    You are not currently linked to any mentor. Connect using a verified mentor invite code to enable trade copying.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Simulated Billing Disclaimer */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs flex items-center justify-between text-slate-400">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-sky-400 shrink-0" />
              <span>
                <strong>Sandbox Mode:</strong> Payment provider connection is simulated. No real credit card or banking charges are incurred in demo sandbox mode.
              </span>
            </div>
            <span className="font-mono text-[10px] text-slate-500">Local Demo Billing Simulator</span>
          </div>

          {/* Subscription Card Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Card 1: Platform Follower License */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
              <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                    Platform License
                  </span>
                  <h3 className="text-base font-bold text-slate-100 mt-0.5">
                    TradeSync Follower Basic
                  </h3>
                </div>
                <StatusBadge status="active" size="sm" />
              </div>

              <div className="flex items-baseline gap-1 font-mono">
                <span className="text-2xl font-bold text-slate-100">$0.00</span>
                <span className="text-xs text-slate-400">/month (Complimentary Demo)</span>
              </div>

              <div className="space-y-2 text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-sky-400" />
                  <span>1 Child MT5 terminal connection</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-sky-400" />
                  <span>Real-time trade mirroring</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-sky-400" />
                  <span>Slippage guard &amp; equity protection limits</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-sky-400" />
                  <span>Full ticket mapping &amp; sync audit trail</span>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                <span>Next Renewal:</span>
                <span className="font-mono text-slate-200">Sandbox Complimentary</span>
              </div>
            </div>

            {/* Card 2: Linked Mentor Strategy Subscription */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
              <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                    Strategy Subscription
                  </span>
                  <h3 className="text-base font-bold text-slate-100 mt-0.5">
                    {link ? link.mentorName : 'No Active Mentor'}
                  </h3>
                </div>
                {link ? (
                  <StatusBadge status={link.status} size="sm" />
                ) : (
                  <span className="text-xs text-slate-500 font-mono">Unlinked</span>
                )}
              </div>

              {link ? (
                <>
                  <div className="flex items-baseline gap-1 font-mono">
                    <span className="text-2xl font-bold text-slate-100">
                      ${mentorProfile?.monthlyFee ?? 0}.00
                    </span>
                    <span className="text-xs text-slate-400">/month strategy fee</span>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-300">
                    <p className="text-sky-300 font-medium">
                      {mentorProfile?.strategyName || 'Mentor Strategy'}
                    </p>
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] border border-slate-800">
                      <div>
                        <span className="text-slate-500 text-[10px]">Win Rate:</span>
                        <p className="text-emerald-400 font-bold">{mentorProfile?.winRate ?? '--'}%</p>
                      </div>
                      <div>
                        <span className="text-slate-500 text-[10px]">Profit Factor:</span>
                        <p className="text-slate-200 font-bold">{mentorProfile?.profitFactor ?? '--'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                    <span>Billing Status:</span>
                    <span className="text-emerald-400 font-medium">Sandbox Active</span>
                  </div>
                </>
              ) : (
                <div className="space-y-3 py-4 text-center">
                  <p className="text-xs text-slate-400">
                    You are not currently subscribed to any mentor strategy. Connect using a mentor invite code to copy trades.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

