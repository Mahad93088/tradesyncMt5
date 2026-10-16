import React, { useState, useEffect } from 'react';
import {
  X,
  Server,
  Layers,
  ArrowRight,
  TrendingUp,
  Activity,
  Shield,
  ShieldAlert,
  Info,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
  User,
  Sliders,
  DollarSign
} from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';
import { ParentAccountItem, ChildAccountItem, AccountTradeItem, mt5AdminService } from '../../services/mt5AdminService';
import { useAuth } from '../../contexts/AuthContext';
import { useApp } from '../../context/AppContext';

interface AccountDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: ParentAccountItem | ChildAccountItem | null;
  type: 'parent' | 'child';
  onOpenAssignModal?: (account: ChildAccountItem | ParentAccountItem) => void;
  onUnlinkChild?: (childAccountId: string, traderId: string, assignmentId?: string) => void;
}

export const AccountDetailsModal: React.FC<AccountDetailsModalProps> = ({
  isOpen,
  onClose,
  account,
  type,
  onOpenAssignModal,
  onUnlinkChild,
}) => {
  const { isCloudMode } = useAuth();
  const { trades } = useApp();

  const [tradeLogs, setTradeLogs] = useState<AccountTradeItem[]>([]);
  const [isLoadingTrades, setIsLoadingTrades] = useState(false);
  const [tradeFilter, setTradeFilter] = useState<'all' | 'OPEN' | 'CLOSED'>('all');
  const [symbolSearch, setSymbolSearch] = useState('');

  useEffect(() => {
    if (!isOpen || !account) return;

    let isMounted = true;
    setIsLoadingTrades(true);

    mt5AdminService.getAccountTrades(account.id, isCloudMode, trades)
      .then((data) => {
        if (isMounted) {
          setTradeLogs(data);
          setIsLoadingTrades(false);
        }
      })
      .catch((err) => {
        console.error('Error fetching account trades:', err);
        if (isMounted) setIsLoadingTrades(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, account, isCloudMode, trades]);

  if (!isOpen || !account) return null;

  const parentAccount = type === 'parent' ? (account as ParentAccountItem) : null;
  const childAccount = type === 'child' ? (account as ChildAccountItem) : null;

  const filteredTrades = tradeLogs.filter((t) => {
    const matchesFilter = tradeFilter === 'all' || t.status === tradeFilter;
    const matchesSymbol = t.symbol.toLowerCase().includes(symbolSearch.toLowerCase()) ||
                          t.ticket.includes(symbolSearch);
    return matchesFilter && matchesSymbol;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4 bg-slate-900/90 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl border ${
              type === 'parent'
                ? 'bg-cyan-950/60 border-cyan-800 text-cyan-400'
                : 'bg-emerald-950/60 border-emerald-800 text-emerald-400'
            }`}>
              {type === 'parent' ? <Server className="h-5 w-5" /> : <Layers className="h-5 w-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">
                  MT5 Terminal #{account.accountNumber}
                </h3>
                <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full border ${
                  type === 'parent'
                    ? 'bg-cyan-950 border-cyan-800 text-cyan-300'
                    : 'bg-emerald-950 border-emerald-800 text-emerald-300'
                }`}>
                  {type === 'parent' ? 'Parent / Mentor' : 'Child / Follower'}
                </span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                  account.accountType === 'live'
                    ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                    : 'bg-amber-950/80 border-amber-800 text-amber-300'
                }`}>
                  {account.accountType === 'live' ? 'Live Broker Account' : 'Demo / Sandbox'}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                {account.brokerName} • {account.brokerServer}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Integrity & Demo Distinction Notice */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 flex items-start gap-3 text-xs text-slate-400">
            <Info className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-200">Execution Engine Status:</span>
                <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                  {account.dataSource === 'supabase' ? 'Supabase Database Record' : 'Simulated Testnet Harness'}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed">
                {account.accountType === 'live'
                  ? 'Real-time trade replication requires the TradeSync MT5 Expert Advisor (EA) or REST bridge daemon active on the broker server.'
                  : 'This terminal operates in a simulated demo environment. High-frequency trade copying signals and balances reflect demo executions.'}
              </p>
            </div>
          </div>

          {/* User & Financials Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Account Owner Card */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold">
                Account Owner & Authentication
              </span>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full border border-slate-700 bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-200 overflow-hidden shrink-0">
                  {type === 'parent' ? (
                    parentAccount?.mentorAvatar ? (
                      <img src={parentAccount.mentorAvatar} alt="" className="h-full w-full object-cover" />
                    ) : (
                      parentAccount?.mentorName?.[0] || 'M'
                    )
                  ) : (
                    childAccount?.traderAvatar ? (
                      <img src={childAccount.traderAvatar} alt="" className="h-full w-full object-cover" />
                    ) : (
                      childAccount?.traderName?.[0] || 'T'
                    )
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-white text-sm truncate">
                    {type === 'parent' ? parentAccount?.mentorName : childAccount?.traderName}
                  </h4>
                  <p className="text-xs text-slate-400 truncate">
                    {type === 'parent' ? parentAccount?.mentorEmail : childAccount?.traderEmail}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-slate-400">Status:</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                      (type === 'parent' ? parentAccount?.mentorStatus : childAccount?.traderStatus) === 'active'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : 'bg-rose-950 text-rose-300 border border-rose-800'
                    }`}>
                      {type === 'parent' ? parentAccount?.mentorStatus : childAccount?.traderStatus}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-xs font-mono">
                <div>
                  <span className="text-slate-500 text-[10px]">Connection:</span>
                  <div className="mt-0.5">
                    <StatusBadge status={account.connectionStatus} size="sm" />
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px]">Ping Latency:</span>
                  <div className="text-slate-200 mt-0.5">{account.pingMs} ms</div>
                </div>
              </div>
            </div>

            {/* Financials & Balances */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold">
                Financials & Margin Parameters
              </span>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-slate-900 border border-slate-800 p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">Balance</span>
                  <div className="text-base font-bold font-mono text-white mt-0.5">
                    ${account.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">{account.currency}</span>
                </div>
                <div className="rounded-lg bg-slate-900 border border-slate-800 p-2.5">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">Equity</span>
                  <div className="text-base font-bold font-mono text-emerald-400 mt-0.5">
                    ${account.equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">{account.currency}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1 text-xs font-mono border-t border-slate-800/80 text-slate-300">
                <div>
                  <span className="text-[10px] text-slate-500">Margin:</span>
                  <div>${account.margin.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500">Free Margin:</span>
                  <div>${account.freeMargin.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500">Leverage:</span>
                  <div>1:{account.leverage}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Parent-Child Relationship Section */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-cyan-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200 font-mono">
                  {type === 'parent' ? 'Linked Follower Accounts (Children)' : 'Mentor Synchronization Link'}
                </h4>
              </div>

              {type === 'parent' && onOpenAssignModal && (
                <button
                  onClick={() => onOpenAssignModal(account)}
                  className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-1 text-xs font-semibold text-white transition-colors flex items-center gap-1.5"
                >
                  <span>Assign New Follower</span>
                </button>
              )}

              {type === 'child' && onOpenAssignModal && (
                <button
                  onClick={() => onOpenAssignModal(account)}
                  className="rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-1 text-xs font-semibold text-white transition-colors flex items-center gap-1.5"
                >
                  <span>{childAccount?.isAssigned ? 'Reassign Mentor' : 'Assign to Mentor'}</span>
                </button>
              )}
            </div>

            {/* PARENT VIEW: List of child accounts */}
            {type === 'parent' && (
              <>
                {parentAccount && parentAccount.assignedChildren.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase font-mono text-slate-500">
                          <th className="pb-2">Follower Trader</th>
                          <th className="pb-2">Child MT5 Account</th>
                          <th className="pb-2">Broker & Server</th>
                          <th className="pb-2">Status</th>
                          <th className="pb-2">Copy Sizing</th>
                          <th className="pb-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {parentAccount.assignedChildren.map((child) => (
                          <tr key={child.childAccountId || child.traderId} className="hover:bg-slate-900/40">
                            <td className="py-2.5 font-medium text-slate-200">
                              <div>{child.traderName}</div>
                              <div className="text-[10px] text-slate-500 font-mono">{child.traderEmail}</div>
                            </td>
                            <td className="py-2.5 font-mono text-slate-300">
                              #{child.childAccountNumber}
                            </td>
                            <td className="py-2.5 text-slate-400 font-mono text-[11px]">
                              {child.brokerName}
                            </td>
                            <td className="py-2.5">
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
                                {child.assignmentStatus}
                              </span>
                            </td>
                            <td className="py-2.5 font-mono text-slate-300 text-[11px]">
                              {child.lotMultiplier}x Multiplier
                            </td>
                            <td className="py-2.5 text-right">
                              {onUnlinkChild && (
                                <button
                                  onClick={() => onUnlinkChild(child.childAccountId, child.traderId, child.assignmentId)}
                                  className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline font-medium"
                                >
                                  Unlink
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center space-y-2">
                    <p className="text-xs text-slate-400">
                      No child trading accounts currently linked to this parent mentor.
                    </p>
                    {onOpenAssignModal && (
                      <button
                        onClick={() => onOpenAssignModal(account)}
                        className="text-xs text-cyan-400 hover:underline font-medium"
                      >
                        + Assign a child follower account now
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {/* CHILD VIEW: Show assigned parent & lot settings */}
            {type === 'child' && (
              <div>
                {childAccount?.isAssigned ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400">
                        <Server className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="text-[10px] font-mono uppercase text-cyan-400 tracking-wider font-semibold">
                          Assigned Master Parent
                        </span>
                        <h5 className="text-sm font-bold text-white mt-0.5">
                          {childAccount.assignedMentorName || 'Master Mentor Provider'}
                        </h5>
                        <div className="text-xs text-slate-400 font-mono mt-0.5">
                          Parent Account: #{childAccount.assignedParentAccountNumber || 'Registered Parent'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto border-t sm:border-t-0 border-slate-800 pt-3 sm:pt-0">
                      <div className="font-mono text-xs text-slate-300">
                        <span className="text-[10px] text-slate-500 uppercase block">Copy Rule</span>
                        <span className="font-semibold text-emerald-400">
                          {childAccount.copyMode.toUpperCase()} ({childAccount.lotMultiplier}x)
                        </span>
                      </div>
                      {onOpenAssignModal && (
                        <button
                          onClick={() => onOpenAssignModal(account)}
                          className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors"
                        >
                          Reassign Parent
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
                      <div>
                        <h5 className="text-xs font-bold text-amber-200">Terminal is Unassigned</h5>
                        <p className="text-[11px] text-amber-300/80">
                          This child follower account does not copy trades from any mentor parent yet.
                        </p>
                      </div>
                    </div>
                    {onOpenAssignModal && (
                      <button
                        onClick={() => onOpenAssignModal(account)}
                        className="rounded-lg bg-amber-600 hover:bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors shrink-0"
                      >
                        Assign to Parent Mentor
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Trade Copy Activity Logs */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200 font-mono flex items-center gap-2">
                  <Activity className="h-4 w-4 text-emerald-400" />
                  Terminal Trade Activity Logs
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-mono text-slate-400">
                    {filteredTrades.length} Deals
                  </span>
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Synchronized order executions, tickets, volume, and realized profit/loss.
                </p>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-40">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Symbol or ticket..."
                    value={symbolSearch}
                    onChange={(e) => setSymbolSearch(e.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-8 pr-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <select
                  value={tradeFilter}
                  onChange={(e) => setTradeFilter(e.target.value as any)}
                  className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs text-white focus:outline-none focus:border-sky-500"
                >
                  <option value="all">All Status</option>
                  <option value="OPEN">Open Only</option>
                  <option value="CLOSED">Closed Deals</option>
                </select>
              </div>
            </div>

            {isLoadingTrades ? (
              <div className="py-8 flex justify-center items-center gap-2 text-xs text-slate-400 font-mono">
                <RefreshCw className="h-4 w-4 animate-spin text-sky-400" />
                <span>Loading trade logs from database...</span>
              </div>
            ) : filteredTrades.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
                      <th className="pb-2">Ticket #</th>
                      <th className="pb-2">Symbol</th>
                      <th className="pb-2">Type</th>
                      <th className="pb-2">Volume</th>
                      <th className="pb-2">Open Price</th>
                      <th className="pb-2">Close Price</th>
                      <th className="pb-2">Profit (USD)</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2">Open Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-[11px]">
                    {filteredTrades.map((t) => (
                      <tr key={t.id || t.ticket} className="hover:bg-slate-900/40">
                        <td className="py-2 text-slate-400 font-semibold">#{t.ticket}</td>
                        <td className="py-2 text-white font-bold">{t.symbol}</td>
                        <td className="py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            t.type.includes('BUY')
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                              : 'bg-rose-950 text-rose-400 border border-rose-800/60'
                          }`}>
                            {t.type}
                          </span>
                        </td>
                        <td className="py-2 text-slate-300">{t.volume.toFixed(2)}</td>
                        <td className="py-2 text-slate-300">{t.openPrice.toFixed(4)}</td>
                        <td className="py-2 text-slate-400">
                          {t.closePrice ? t.closePrice.toFixed(4) : '—'}
                        </td>
                        <td className="py-2 font-bold">
                          <span className={t.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {t.profit >= 0 ? `+$${t.profit.toFixed(2)}` : `-$${Math.abs(t.profit).toFixed(2)}`}
                          </span>
                        </td>
                        <td className="py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            t.status === 'OPEN'
                              ? 'bg-sky-950 text-sky-400 border border-sky-800'
                              : 'bg-slate-800 text-slate-300'
                          }`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="py-2 text-slate-500 text-[10px]">
                          {new Date(t.openTime).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-500 font-mono">
                No trades found matching current filter criteria.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 px-5 py-3.5 bg-slate-900/90 flex items-center justify-between">
          <div className="text-[11px] text-slate-500 font-mono">
            ID: <span className="text-slate-400">{account.id}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 hover:bg-slate-750 px-4 py-1.5 text-xs font-semibold text-slate-200 transition-colors"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
};
