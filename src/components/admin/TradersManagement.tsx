import React, { useState } from 'react';
import {
  UserCheck,
  Search,
  Plus,
  Eye,
  Edit2,
  X,
  Link as LinkIcon,
  Server,
  Archive,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { AddTraderModal } from './AddTraderModal';
import { EditTraderModal } from './EditTraderModal';
import { User } from '../../types';
import {
  AdminPageHeader,
  AdminStatusText,
  AdminFeedbackBanner,
  AdminEmptyState,
} from './adminUi';
import { formatHeartbeatAge, formatLotRuleLabel } from '../common/dashboardHelpers';

interface TradersManagementProps {
  isAddOpen?: boolean;
  setIsAddOpen?: (open: boolean) => void;
}

export const TradersManagement: React.FC<TradersManagementProps> = ({
  isAddOpen: externalIsAddOpen,
  setIsAddOpen: externalSetIsAddOpen,
}) => {
  const { isCloudMode } = useAuth();
  const { users, mt5Accounts, subscriptions, parentChildLinks, tradeMappings, auditLogs, toggleUserStatus, archiveUser } = useApp();

  const [internalIsAddOpen, setInternalIsAddOpen] = useState(false);
  const isAddOpen = externalIsAddOpen !== undefined ? externalIsAddOpen : internalIsAddOpen;
  const setIsAddOpen = externalSetIsAddOpen !== undefined ? externalSetIsAddOpen : setInternalIsAddOpen;

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'pending' | 'suspended'>('all');
  const [filterSub, setFilterSub] = useState<'all' | 'active' | 'unlinked'>('all');

  const [detailsTrader, setDetailsTrader] = useState<User | null>(null);
  const [editingTrader, setEditingTrader] = useState<User | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const [confirmModalData, setConfirmModalData] = useState<{
    isOpen: boolean;
    trader: User | null;
    action: 'approve' | 'suspend' | 'reactivate' | 'archive';
  }>({
    isOpen: false,
    trader: null,
    action: 'suspend',
  });

  const traders = users.filter((u) => u.role === 'trader');

  const filteredTraders = traders.filter((t) => {
    const link = parentChildLinks.find((l) => l.traderId === t.id);
    const matchesSearch =
      t.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.username && t.username.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = filterStatus === 'all' || t.status === filterStatus;
    const matchesSub =
      filterSub === 'all'
        ? true
        : filterSub === 'active'
        ? Boolean(link && link.status === 'active')
        : !link || link.status !== 'active';
    return matchesSearch && matchesStatus && matchesSub;
  });

  const handleConfirmStatus = async () => {
    if (!confirmModalData.trader) return;
    const target = confirmModalData.trader;
    setActionFeedback(null);
    const res =
      confirmModalData.action === 'archive'
        ? await archiveUser(target.id)
        : await toggleUserStatus(target.id);
    if (!res.success) {
      setActionFeedback({
        type: 'error',
        message: res.message || `Failed to update status for ${target.fullName}.`,
      });
    } else {
      setActionFeedback({
        type: 'success',
        message: res.message || `Updated ${target.fullName} account status.`,
      });
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Trader Management"
        meta={`${traders.length} Registered · ${traders.filter((t) => t.status === 'active').length} Active`}
        subtitle="Monitor follower trader accounts, assigned mentors, Child MT5 terminal connectivity, and copy sizing rules."
        actions={
          <button
            type="button"
            onClick={() => setIsAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Trader</span>
          </button>
        }
      />

      {actionFeedback && (
        <AdminFeedbackBanner
          type={actionFeedback.type}
          message={actionFeedback.message}
          onDismiss={() => setActionFeedback(null)}
        />
      )}

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search trader name, username, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center flex-wrap gap-3 w-full sm:w-auto text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium">Account:</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-500"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="pending">Pending Approval</option>
              <option value="suspended">Suspended Only</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium">Copy Link:</span>
            <select
              value={filterSub}
              onChange={(e) => setFilterSub(e.target.value as any)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-sky-500"
            >
              <option value="all">All Links</option>
              <option value="active">Active Linked</option>
              <option value="unlinked">Unlinked / Paused</option>
            </select>
          </div>
        </div>
      </div>

      {/* Traders Table */}
      {filteredTraders.length === 0 ? (
        <AdminEmptyState
          icon={UserCheck}
          title="No traders match your filter criteria"
          description="Try clearing the search or status filters to view registered follower traders."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Trader</th>
                  <th className="px-4 py-3">Assigned Mentor</th>
                  <th className="px-4 py-3">{isCloudMode ? 'Entitlement' : 'Subscription'}</th>
                  <th className="px-4 py-3">Child MT5 Terminal</th>
                  <th className="px-4 py-3">Copy Sizing</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Account Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTraders.map((trader) => {
                  const childAccount = mt5Accounts.find(
                    (a) => a.userId === trader.id && a.accountRole === 'child'
                  );
                  const link = parentChildLinks.find((l) => l.traderId === trader.id);
                  const sub = subscriptions.find((s) => s.userId === trader.id || s.mentorId === trader.id);

                  return (
                    <tr key={trader.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full overflow-hidden border border-slate-200 bg-slate-100 shrink-0 flex items-center justify-center font-bold text-xs text-slate-700">
                            {trader.avatarUrl ? (
                              <img src={trader.avatarUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              trader.fullName[0]
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                              {trader.fullName}
                              {trader.username && (
                                <span className="font-mono text-[11px] text-slate-500 font-normal">
                                  @{trader.username}
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-500">{trader.email}</span>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        {link ? (
                          <div className="space-y-1">
                            <span className="font-semibold text-sky-700 block">{link.mentorName}</span>
                            <div className="flex items-center gap-1 flex-wrap">
                              <AdminStatusText status={link.status} />
                              {link.balancePauseActive && <AdminStatusText status="balance_paused" />}
                            </div>
                            {(link.suspensionReason || link.pauseReason) && (
                              <span className="text-[10px] text-slate-500 block max-w-[180px] truncate" title={link.suspensionReason || link.pauseReason || ''}>
                                {link.suspensionReason || link.pauseReason}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">Unlinked</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        {sub ? (
                          <div className="space-y-1">
                            <span className="text-[11px] font-medium text-slate-800 block">{sub.planName}</span>
                            <AdminStatusText status={sub.status} />
                          </div>
                        ) : link ? (
                          <div className="space-y-1">
                            <span className="text-[11px] font-medium text-slate-800 block">Follower Membership</span>
                            <AdminStatusText status={link.status === 'active' ? 'active' : 'paused'} />
                          </div>
                        ) : (
                          <span className="text-slate-500 text-[11px] font-mono">Free Demo</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        {childAccount ? (
                          <div className="space-y-1 font-mono">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-900 tabular-nums">
                                #{childAccount.accountNumber}
                              </span>
                              <AdminStatusText status={childAccount.isStale ? 'stale' : childAccount.connectionStatus} />
                            </div>
                            <p className="text-[11px] text-slate-500 font-sans tabular-nums">
                              {childAccount.broker} · Eq: ${(childAccount.verifiedEquity ?? childAccount.equity).toLocaleString()}
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">No terminal bound</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-700">
                        {link ? formatLotRuleLabel(link.lotSettings) : <span className="text-slate-400">—</span>}
                      </td>

                      <td className="px-4 py-3.5 text-slate-600 font-mono text-[11px] tabular-nums">
                        {new Date(trader.createdAt).toLocaleDateString()}
                      </td>

                      <td className="px-4 py-3.5">
                        <AdminStatusText status={trader.status} />
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetailsTrader(trader)}
                            className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                            title="View trader details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setEditingTrader(trader)}
                            className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                            title="Edit trader profile"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const action: 'approve' | 'suspend' | 'reactivate' =
                                trader.status === 'active'
                                  ? 'suspend'
                                  : trader.status === 'pending'
                                  ? 'approve'
                                  : 'reactivate';
                              setConfirmModalData({
                                isOpen: true,
                                trader,
                                action,
                              });
                            }}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold border whitespace-nowrap transition-colors ${
                              trader.status === 'active'
                                ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {trader.status === 'active'
                              ? 'Suspend'
                              : trader.status === 'pending'
                              ? 'Approve'
                              : 'Reactivate'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setConfirmModalData({
                                isOpen: true,
                                trader,
                                action: 'archive',
                              });
                            }}
                            title="Archive trader & preserve billing history"
                            className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                          >
                            <Archive className="h-3.5 w-3.5" />
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
      )}

      {/* Trader Details Modal */}
      {detailsTrader && (() => {
        const childAccount = mt5Accounts.find((a) => a.userId === detailsTrader.id && a.accountRole === 'child');
        const link = parentChildLinks.find((l) => l.traderId === detailsTrader.id);
        const recentCopies = tradeMappings.filter((m) => m.traderId === detailsTrader.id).slice(0, 4);
        const traderAuditHistory = auditLogs.filter(
          (log) => log.actorId === detailsTrader.id || log.targetId === detailsTrader.id
        ).slice(0, 4);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 my-auto">
              <div className="flex items-start justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-sm text-slate-800">
                    {detailsTrader.fullName[0]}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      {detailsTrader.fullName}
                      {detailsTrader.username && (
                        <span className="font-mono text-xs text-sky-700">@{detailsTrader.username}</span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-500">{detailsTrader.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailsTrader(null)}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-lg border border-slate-200 font-mono">
                <div>
                  <span className="text-slate-500 block text-[10px]">ACCOUNT STATUS</span>
                  <div className="mt-0.5"><AdminStatusText status={detailsTrader.status} /></div>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">JOINED ON</span>
                  <span className="text-slate-900 tabular-nums">{new Date(detailsTrader.createdAt).toLocaleDateString()}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">PHONE</span>
                  <span className="text-slate-800">{detailsTrader.phone || 'None provided'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">MEMBERSHIP</span>
                  <span className="text-slate-800">
                    {subscriptions.find((s) => s.userId === detailsTrader.id || s.mentorId === detailsTrader.id)?.planName ||
                      (link ? `Follower (${link.status})` : 'Free Demo / Unassigned')}
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2 text-xs">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Server className="h-3.5 w-3.5 text-sky-600" />
                  Child MT5 Terminal (Demo)
                </span>
                {childAccount ? (
                  <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-slate-600">
                    <div>Account: <strong className="text-slate-900">#{childAccount.accountNumber}</strong></div>
                    <div>Broker: <strong className="text-slate-900">{childAccount.broker}</strong></div>
                    <div>Balance: <strong className="text-slate-900 tabular-nums">${(childAccount.verifiedBalance ?? childAccount.balance).toLocaleString()}</strong></div>
                    <div>Equity: <strong className="text-emerald-700 tabular-nums">${(childAccount.verifiedEquity ?? childAccount.equity).toLocaleString()}</strong></div>
                    <div>Connection: <AdminStatusText status={childAccount.isStale ? 'stale' : childAccount.connectionStatus} /></div>
                    <div>Heartbeat: <strong className="text-slate-900">{formatHeartbeatAge(childAccount.lastHeartbeat)}</strong></div>
                  </div>
                ) : (
                  <p className="text-slate-500 italic">No demo terminal bound.</p>
                )}
              </div>

              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2 text-xs">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <LinkIcon className="h-3.5 w-3.5 text-sky-600" />
                  Assigned Mentor &amp; Copy Telemetry
                </span>
                {link ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-slate-600">
                      <div>Mentor: <strong className="text-sky-700 font-sans">{link.mentorName}</strong></div>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span>Link Status:</span>
                        <AdminStatusText status={link.status} />
                        {link.balancePauseActive && <AdminStatusText status="balance_paused" />}
                      </div>
                      <div>Copy Rule: <strong className="text-slate-900">{formatLotRuleLabel(link.lotSettings)}</strong></div>
                      <div>Trades Copied: <strong className="text-slate-900 tabular-nums">{link.totalTradesCopied}</strong></div>
                      <div>
                        Copied P&amp;L:{' '}
                        {isCloudMode && link.totalProfitAvailable === false ? (
                          <span className="text-slate-500 italic font-sans">Awaiting EA sync</span>
                        ) : (
                          <strong className={link.totalProfitUSD >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                            ${link.totalProfitUSD.toLocaleString()}
                          </strong>
                        )}
                      </div>
                    </div>
                    {(link.suspensionReason || link.pauseReason) && (
                      <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700">
                        {link.suspensionReason && (
                          <div>
                            <strong className="text-rose-700">Suspension Reason:</strong> {link.suspensionReason}
                          </div>
                        )}
                        {link.pauseReason && (
                          <div>
                            <strong className="text-amber-700">Balance Pause Reason:</strong> {link.pauseReason}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-slate-500 italic">Not linked to any mentor.</p>
                )}
              </div>

              <div className="space-y-1.5 text-xs">
                <span className="font-semibold text-slate-800 block">Recent Account Activity</span>
                {recentCopies.length > 0 || traderAuditHistory.length > 0 ? (
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {recentCopies.map((m) => (
                      <div key={m.id} className="flex items-center justify-between rounded border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11px]">
                        <span className="text-slate-800">{m.symbol} {m.orderType} ({m.childLots.toFixed(2)}L)</span>
                        <AdminStatusText status={m.status} />
                      </div>
                    ))}
                    {traderAuditHistory.map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px]">
                        <span className="text-slate-700 truncate pr-2">{item.action}: {item.details}</span>
                        <span className="font-mono text-slate-400 shrink-0">{new Date(item.timestamp).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 italic">No recent copy executions or audit entries.</p>
                )}
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setDetailsTrader(null);
                    setEditingTrader(detailsTrader);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Edit Trader
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsTrader(null)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <EditTraderModal
        isOpen={Boolean(editingTrader)}
        trader={editingTrader}
        onClose={() => setEditingTrader(null)}
      />

      <ConfirmationModal
        isOpen={confirmModalData.isOpen}
        onClose={() => setConfirmModalData({ isOpen: false, trader: null, action: 'suspend' })}
        onConfirm={() => {
          void handleConfirmStatus();
        }}
        title={
          confirmModalData.action === 'archive'
            ? 'Archive Trader Account'
            : confirmModalData.action === 'suspend'
            ? 'Suspend Trader Account'
            : confirmModalData.action === 'approve'
            ? 'Approve Trader Account'
            : 'Reactivate Trader Account'
        }
        description={
          confirmModalData.action === 'archive'
            ? `Archive trader ${confirmModalData.trader?.fullName}? Active copy links will pause, their Child MT5 terminal will disconnect, and billing/payment records will remain archived safely.`
            : confirmModalData.action === 'suspend'
            ? `Are you sure you want to suspend trader ${confirmModalData.trader?.fullName}? Automated trade mirroring to their child terminal will be paused immediately.`
            : confirmModalData.action === 'approve'
            ? `Approve ${confirmModalData.trader?.fullName} as an active follower trader? They will be able to register a Child MT5 account and follow mentors.`
            : `Are you sure you want to reactivate trader ${confirmModalData.trader?.fullName}?`
        }
        confirmLabel={
          confirmModalData.action === 'archive'
            ? 'Archive & Preserve'
            : confirmModalData.action === 'suspend'
            ? 'Suspend Trader'
            : confirmModalData.action === 'approve'
            ? 'Approve Trader'
            : 'Reactivate Trader'
        }
        variant={confirmModalData.action === 'suspend' || confirmModalData.action === 'archive' ? 'danger' : 'primary'}
      />

      <AddTraderModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
      />
    </div>
  );
};
