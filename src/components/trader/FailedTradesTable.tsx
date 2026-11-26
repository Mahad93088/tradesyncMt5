import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from '../common/StatusBadge';

function formatTimestamp(ts?: string | null): string {
  if (!ts) return '--';
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return '--';
  return new Date(ms).toLocaleTimeString();
}

export const FailedTradesTable: React.FC = () => {
  const { currentUser, tradeMappings, mt5Accounts } = useApp();

  const childAccountIds = new Set(
    mt5Accounts
      .filter((a) => a.userId === currentUser.id && a.accountRole === 'child')
      .map((a) => a.id)
  );

  // Filter failed or rejected trade mappings across all child accounts for this trader
  const failedMappings = tradeMappings.filter(
    (m) =>
      (m.traderId === currentUser.id || childAccountIds.has(m.childAccountId)) &&
      m.status !== 'EXECUTED' &&
      m.status !== 'CLOSED' &&
      m.status !== 'PENDING'
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          Failed Trades & Error Diagnostics
          <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-rose-400 font-mono">
            {failedMappings.length} Safeguard Triggers
          </span>
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Complete log of skipped, rejected, or timed-out orders with exact broker retcodes and cause analysis.
        </p>
      </div>

      {failedMappings.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-950/80 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-5 py-3.5">Order Ref</th>
                  <th className="px-4 py-3.5">Symbol &amp; Type</th>
                  <th className="px-4 py-3.5">Target Lots</th>
                  <th className="px-4 py-3.5">Error Reason</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Retry Count</th>
                  <th className="px-5 py-3.5 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {failedMappings.map((map) => (
                  <tr key={map.id} className="hover:bg-slate-800/40 transition-colors">
                    {/* Child Order Ref */}
                    <td className="px-5 py-4 font-mono font-bold text-slate-300 text-xs">
                      {map.childTradeTicket ? `#${map.childTradeTicket}` : `#${map.id.slice(0, 8)}`}
                    </td>

                    {/* Symbol & Type */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-white">{map.symbol}</span>
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold font-mono bg-slate-800 text-slate-300">
                          {map.orderType}
                        </span>
                      </div>
                    </td>

                    {/* Child Lots */}
                    <td className="px-4 py-4 font-mono text-slate-300">
                      {map.childLots.toFixed(2)} lots
                    </td>

                    {/* Error Reason */}
                    <td className="px-4 py-4">
                      <div className="max-w-md">
                        <p className="text-rose-400 font-medium leading-relaxed">
                          {map.errorMessage || 'OrderSend rejected by broker liquidity gateway'}
                        </p>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4">
                      <StatusBadge status={map.status} size="sm" />
                    </td>

                    {/* Retry */}
                    <td className="px-4 py-4 font-mono text-slate-400">
                      {map.retryCount} attempts
                    </td>

                    {/* Timestamp */}
                    <td className="px-5 py-4 text-right font-mono text-[11px] text-slate-400">
                      {formatTimestamp(map.openTime)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center space-y-3">
          <div className="h-10 w-10 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center justify-center mx-auto">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h4 className="font-bold text-white text-sm">Clean Execution History</h4>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            No failed trade executions detected on your child account. All signal transmissions completed successfully.
          </p>
        </div>
      )}

      {/* Common Error Troubleshooting Reference Guide */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
          MT5 Trade Error Diagnostics Guide
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 space-y-1">
            <span className="font-bold text-rose-400 font-mono text-[11px]">SKIPPED_LOT_LIMIT</span>
            <p className="text-slate-400 text-[11px]">
              Requested or scaled volume violated your broker&apos;s min, max, or volume step constraints. Trade was skipped safely without silently increasing lot size.
            </p>
          </div>
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 space-y-1">
            <span className="font-bold text-amber-400 font-mono text-[11px]">TRADE_RETCODE_NOT_ENOUGH_MONEY</span>
            <p className="text-slate-400 text-[11px]">
              Child account balance lacks free margin for the target lot volume. Lower your lot size or verify your balance is above $100.
            </p>
          </div>
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 space-y-1">
            <span className="font-bold text-cyan-400 font-mono text-[11px]">TRADE_RETCODE_NO_CONNECTION</span>
            <p className="text-slate-400 text-[11px]">
              Terminal lost connection with broker server. Re-check demo login credentials and EA attachment.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
