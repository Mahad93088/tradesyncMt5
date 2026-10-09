import React from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  RefreshCw,
  Server,
  ShieldAlert,
  Clock,
  Zap,
  Info
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from '../common/StatusBadge';

export const FailedTradesTable: React.FC = () => {
  const { currentUser, tradeMappings, mt5Accounts } = useApp();

  const childAccount = mt5Accounts.find(
    (a) => a.userId === currentUser.id && a.accountRole === 'child'
  );

  // Filter failed or rejected trade mappings for this trader
  const failedMappings = tradeMappings.filter(
    (m) => m.traderId === currentUser.id && m.status !== 'EXECUTED'
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
                  <th className="px-5 py-3.5">Parent Ticket</th>
                  <th className="px-4 py-3.5">Symbol & Type</th>
                  <th className="px-4 py-3.5">Parent Lots</th>
                  <th className="px-4 py-3.5">Error Reason</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Retry Count</th>
                  <th className="px-5 py-3.5 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {failedMappings.map((map) => (
                  <tr key={map.id} className="hover:bg-slate-800/40 transition-colors">
                    {/* Parent Ticket */}
                    <td className="px-5 py-4 font-mono font-bold text-white text-xs">
                      #{map.parentTradeTicket}
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

                    {/* Parent Lots */}
                    <td className="px-4 py-4 font-mono text-slate-300">
                      {map.parentLots.toFixed(2)} lots
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
                      {new Date(map.openTime).toLocaleTimeString()}
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
            <span className="font-bold text-rose-400 font-mono text-[11px]">TRADE_RETCODE_NOT_ENOUGH_MONEY</span>
            <p className="text-slate-400 text-[11px]">
              Child account balance lacks free margin for the requested lot volume. Reduce multiplier or deposit capital.
            </p>
          </div>
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 space-y-1">
            <span className="font-bold text-amber-400 font-mono text-[11px]">SLIPPAGE_EXCEEDED</span>
            <p className="text-slate-400 text-[11px]">
              Market moved beyond your maximum allowed pip deviation during fast news spikes. The order was aborted safely.
            </p>
          </div>
          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 space-y-1">
            <span className="font-bold text-cyan-400 font-mono text-[11px]">TRADE_RETCODE_NO_CONNECTION</span>
            <p className="text-slate-400 text-[11px]">
              Terminal lost socket ping with broker server. Re-check login credentials and server name.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
