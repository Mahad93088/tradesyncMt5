import React, { useState } from 'react';
import {
  UserCheck,
  Search,
  Plus,
  Eye,
  Edit2,
  X,
  Mail,
  Calendar,
  Layers,
  Link,
  Shield,
  Activity,
  Server,
  DollarSign,
  TrendingUp,
  User as UserIcon,
  Phone
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from '../common/StatusBadge';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { AddTraderModal } from './AddTraderModal';
import { EditTraderModal } from './EditTraderModal';
import { User } from '../../types';

interface TradersManagementProps {
  isAddOpen?: boolean;
  setIsAddOpen?: (open: boolean) => void;
}

export const TradersManagement: React.FC<TradersManagementProps> = ({
  isAddOpen: externalIsAddOpen,
  setIsAddOpen: externalSetIsAddOpen
}) => {
  const { users, mt5Accounts, parentChildLinks, toggleUserStatus } = useApp();

  // Internal modal state if not passed from parent
  const [internalIsAddOpen, setInternalIsAddOpen] = useState(false);
  const isAddOpen = externalIsAddOpen !== undefined ? externalIsAddOpen : internalIsAddOpen;
  const setIsAddOpen = externalSetIsAddOpen !== undefined ? externalSetIsAddOpen : setInternalIsAddOpen;

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'suspended'>('all');
  const [filterSub, setFilterSub] = useState<'all' | 'active' | 'unlinked'>('all');

  // Trader detail modal state
  const [detailsTrader, setDetailsTrader] = useState<User | null>(null);

  // Edit trader modal state
  const [editingTrader, setEditingTrader] = useState<User | null>(null);

  // Confirmation modal state for suspend / reactivate
  const [confirmModalData, setConfirmModalData] = useState<{
    isOpen: boolean;
    trader: User | null;
    action: 'suspend' | 'reactivate';
  }>({
    isOpen: false,
    trader: null,
    action: 'suspend'
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
        ? link && link.status === 'active'
        : !link || link.status !== 'active';
    return matchesSearch && matchesStatus && matchesSub;
  });

  return (
    <div className="space-y-6">
      {/* Top Header with Add Trader Button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            Trader Management (Followers)
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono">
              {traders.length} Registered
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Monitor follower trader accounts, mentor associations, demo connection health, and copy lot settings.
          </p>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>Add Trader</span>
        </button>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search trader name, username, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-teal-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400">Account:</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="rounded-lg border border-slate-750 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-teal-500"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="suspended">Suspended Only</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400">Subscription:</span>
            <select
              value={filterSub}
              onChange={(e) => setFilterSub(e.target.value as any)}
              className="rounded-lg border border-slate-750 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-teal-500"
            >
              <option value="all">All Subs</option>
              <option value="active">Active Sub</option>
              <option value="unlinked">Unlinked</option>
            </select>
          </div>
        </div>
      </div>

      {/* Traders Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-slate-950/90 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Trader</th>
                <th className="px-4 py-3">Assigned Mentor</th>
                <th className="px-4 py-3">Subscription</th>
                <th className="px-4 py-3">Demo Terminal</th>
                <th className="px-4 py-3">Copy Sizing</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Account Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredTraders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No traders found matching the filter criteria.
                  </td>
                </tr>
              ) : (
                filteredTraders.map((trader) => {
                  const childAccount = mt5Accounts.find(
                    (a) => a.userId === trader.id && a.accountRole === 'child'
                  );
                  const link = parentChildLinks.find((l) => l.traderId === trader.id);

                  return (
                    <tr key={trader.id} className="hover:bg-slate-850/40 transition-colors">
                      {/* Trader */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full overflow-hidden border border-slate-700 bg-slate-800 shrink-0 flex items-center justify-center font-bold text-xs text-slate-300">
                            {trader.avatarUrl ? (
                              <img src={trader.avatarUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              trader.fullName[0]
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                              {trader.fullName}
                              {trader.username && (
                                <span className="font-mono text-[10px] text-teal-400 font-normal">
                                  @{trader.username}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500">{trader.email}</span>
                          </div>
                        </div>
                      </td>

                      {/* Mentor Association */}
                      <td className="px-4 py-3.5">
                        {link ? (
                          <div className="space-y-0.5">
                            <span className="font-semibold text-sky-400">{link.mentorName}</span>
                            <div>
                              <StatusBadge status={link.status} size="sm" />
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic text-[11px]">Unlinked</span>
                        )}
                      </td>

                      {/* Subscription Status */}
                      <td className="px-4 py-3.5">
                        {link ? (
                          <div className="space-y-0.5">
                            <span className="text-[11px] font-medium text-slate-200">
                              Follower Tier
                            </span>
                            <div>
                              <StatusBadge status={link.status === 'active' ? 'active' : 'paused'} size="sm" />
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500 text-[11px] font-mono">Free Demo</span>
                        )}
                      </td>

                      {/* Child MT5 Terminal & Connection */}
                      <td className="px-4 py-3.5">
                        {childAccount ? (
                          <div className="space-y-0.5 font-mono">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-200">
                                #{childAccount.accountNumber}
                              </span>
                              <StatusBadge status={childAccount.connectionStatus} size="sm" />
                            </div>
                            <p className="text-[10px] text-slate-400 font-sans">
                              {childAccount.broker} • Eq: ${childAccount.equity.toLocaleString()}
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic text-[11px]">No terminal bound</span>
                        )}
                      </td>

                      {/* Lot Size Rules */}
                      <td className="px-4 py-3.5 font-mono text-[11px]">
                        {link ? (
                          <div className="space-y-0.5">
                            {link.lotSettings.mode === 'parent_lot' ? (
                              <span className="text-slate-300">1:1 Direct Copy</span>
                            ) : (
                              <span className="text-sky-300 uppercase">
                                {link.lotSettings.customType}:{' '}
                                {link.lotSettings.customType === 'fixed' && `${link.lotSettings.fixedLot} lots`}
                                {link.lotSettings.customType === 'multiplier' && `${link.lotSettings.multiplier}x ratio`}
                                {link.lotSettings.customType === 'risk_percent' && `${link.lotSettings.riskPercent}% risk`}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>

                      {/* Creation Date */}
                      <td className="px-4 py-3.5 text-slate-400 font-mono text-[11px]">
                        {new Date(trader.createdAt).toLocaleDateString()}
                      </td>

                      {/* Account Status */}
                      <td className="px-4 py-3.5">
                        <StatusBadge status={trader.status} size="sm" />
                      </td>

                      {/* Actions: View, Edit, Suspend, Reactivate */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setDetailsTrader(trader)}
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
                            title="View trader details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>

                          <button
                            onClick={() => setEditingTrader(trader)}
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
                            title="Edit trader profile"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>

                          <button
                            onClick={() => {
                              setConfirmModalData({
                                isOpen: true,
                                trader,
                                action: trader.status === 'active' ? 'suspend' : 'reactivate'
                              });
                            }}
                            className={`rounded px-2 py-1 text-[11px] font-medium border transition-colors ${
                              trader.status === 'active'
                                ? 'border-rose-900/60 bg-rose-950/40 text-rose-300 hover:bg-rose-900/50'
                                : 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50'
                            }`}
                          >
                            {trader.status === 'active' ? 'Suspend' : 'Reactivate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Trader Details Modal */}
      {detailsTrader && (() => {
        const childAccount = mt5Accounts.find((a) => a.userId === detailsTrader.id && a.accountRole === 'child');
        const link = parentChildLinks.find((l) => l.traderId === detailsTrader.id);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
              <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-sm text-slate-200">
                    {detailsTrader.fullName[0]}
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                      {detailsTrader.fullName}
                      {detailsTrader.username && (
                        <span className="font-mono text-xs text-teal-400">@{detailsTrader.username}</span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-400">{detailsTrader.email}</p>
                  </div>
                </div>
                <button
                  onClick={() => setDetailsTrader(null)}
                  className="text-slate-500 hover:text-slate-300"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Account Meta & Status */}
              <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950/60 p-3 rounded-lg border border-slate-800 font-mono">
                <div>
                  <span className="text-slate-500 block text-[10px]">ACCOUNT STATUS</span>
                  <StatusBadge status={detailsTrader.status} size="sm" />
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">JOINED ON</span>
                  <span className="text-slate-300">{new Date(detailsTrader.createdAt).toLocaleDateString()}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">PHONE</span>
                  <span className="text-slate-300">{detailsTrader.phone || 'None provided'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">ROLE</span>
                  <span className="text-slate-300 uppercase">{detailsTrader.role} (Follower)</span>
                </div>
              </div>

              {/* Demo Account Overview */}
              <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-3 space-y-2 text-xs">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Server className="h-3.5 w-3.5 text-teal-400" />
                  Demo MT5 Account (Child Terminal)
                </span>
                {childAccount ? (
                  <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-slate-400">
                    <div>Account: <strong className="text-slate-200">#{childAccount.accountNumber}</strong></div>
                    <div>Broker: <strong className="text-slate-200">{childAccount.broker}</strong></div>
                    <div>Balance: <strong className="text-slate-200">${childAccount.balance.toLocaleString()}</strong></div>
                    <div>Equity: <strong className="text-emerald-400">${childAccount.equity.toLocaleString()}</strong></div>
                    <div>Connection: <StatusBadge status={childAccount.connectionStatus} size="sm" /></div>
                    <div>Ping: <strong className="text-slate-200">{childAccount.pingMs}ms</strong></div>
                  </div>
                ) : (
                  <p className="text-slate-500 italic">No demo terminal bound.</p>
                )}
              </div>

              {/* Mentor Association & Copy Settings */}
              <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-3 space-y-2 text-xs">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Link className="h-3.5 w-3.5 text-sky-400" />
                  Mentor Association & Subscription
                </span>
                {link ? (
                  <div className="space-y-1.5 font-mono text-[11px] text-slate-400">
                    <div>Mentor: <strong className="text-sky-300 font-sans">{link.mentorName}</strong></div>
                    <div>Copy Link Status: <StatusBadge status={link.status} size="sm" /></div>
                    <div>Subscription Tier: <strong className="text-slate-200">Follower Standard (${link.status === 'active' ? 'Active' : 'Paused'})</strong></div>
                    <div>Linked Since: <strong className="text-slate-200">{new Date(link.linkedAt).toLocaleDateString()}</strong></div>
                    <div>Lot Mode: <strong className="text-slate-200">{link.lotSettings.mode}</strong></div>
                    <div>Max Lot Cap: <strong className="text-slate-200">{link.lotSettings.maxLotCap} lots</strong></div>
                    <div>Slippage Guard: <strong className="text-slate-200">{link.lotSettings.slippageMaxPips} pips</strong></div>
                    <div>Total Deals Copied: <strong className="text-slate-200">{link.totalTradesCopied}</strong></div>
                    <div>Total Copied Profit: <strong className="text-emerald-400">${link.totalProfitUSD.toLocaleString()}</strong></div>
                  </div>
                ) : (
                  <div className="space-y-1 text-slate-500 italic">
                    <p>Not linked to any mentor.</p>
                    <p className="font-mono text-[10px] text-slate-400">Subscription: Free Demo Follower Account</p>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                <button
                  onClick={() => {
                    setDetailsTrader(null);
                    setEditingTrader(detailsTrader);
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white"
                >
                  Edit Trader
                </button>
                <button
                  onClick={() => setDetailsTrader(null)}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-1.5 text-xs font-medium text-slate-300 hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Trader Modal */}
      <EditTraderModal
        isOpen={Boolean(editingTrader)}
        trader={editingTrader}
        onClose={() => setEditingTrader(null)}
      />

      {/* Confirmation Modal for Suspend / Reactivate */}
      <ConfirmationModal
        isOpen={confirmModalData.isOpen}
        onClose={() => setConfirmModalData({ isOpen: false, trader: null, action: 'suspend' })}
        onConfirm={() => {
          if (confirmModalData.trader) {
            toggleUserStatus(confirmModalData.trader.id);
          }
        }}
        title={confirmModalData.action === 'suspend' ? 'Suspend Trader Account' : 'Reactivate Trader Account'}
        description={
          confirmModalData.action === 'suspend'
            ? `Are you sure you want to suspend trader ${confirmModalData.trader?.fullName}? Automated trade mirroring to their child terminal will be paused immediately.`
            : `Are you sure you want to reactivate trader ${confirmModalData.trader?.fullName}?`
        }
        confirmLabel={confirmModalData.action === 'suspend' ? 'Suspend Trader' : 'Reactivate Trader'}
        variant={confirmModalData.action === 'suspend' ? 'danger' : 'primary'}
      />

      {/* Add Trader Modal */}
      <AddTraderModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
      />
    </div>
  );
};
