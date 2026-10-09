import React, { useState } from 'react';
import {
  Server,
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Power,
  ShieldAlert,
  Clock,
  Info,
  Radio,
  ExternalLink
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from '../common/StatusBadge';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { MT5Account } from '../../types';

export const ConnectionsView: React.FC = () => {
  const {
    mt5Accounts,
    users,
    disconnectMT5Account,
    reconnectMT5Account
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterState, setFilterState] = useState<string>('all');
  const [filterRole, setFilterRole] = useState<string>('all');

  // Confirmation modal for disconnect / reconnect
  const [confirmData, setConfirmData] = useState<{
    isOpen: boolean;
    account: MT5Account | null;
    action: 'disconnect' | 'reconnect';
  }>({
    isOpen: false,
    account: null,
    action: 'disconnect'
  });

  const filteredAccounts = mt5Accounts.filter((acc) => {
    const owner = users.find((u) => u.id === acc.userId);
    const text = `${acc.accountNumber} ${acc.broker} ${acc.server} ${owner?.fullName || ''}`.toLowerCase();
    const matchesSearch = text.includes(searchQuery.toLowerCase());
    const matchesState = filterState === 'all' || acc.connectionStatus === filterState;
    const matchesRole = filterRole === 'all' || acc.accountRole === filterRole;
    return matchesSearch && matchesState && matchesRole;
  });

  const connectedCount = mt5Accounts.filter((a) => a.connectionStatus === 'connected').length;
  const disconnectedCount = mt5Accounts.filter((a) => a.connectionStatus === 'disconnected').length;
  const errorCount = mt5Accounts.filter((a) => a.connectionStatus === 'error').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            Demo Account Connection Records
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono">
              {mt5Accounts.length} Total
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Audit connection logs, inspect terminal status records, and review error diagnostics.
          </p>
        </div>
      </div>

      {/* Safety Notice */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs flex items-center justify-between text-slate-400">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-sky-400 shrink-0" />
          <span>
            <strong>Demo Bridge Safety Rule:</strong> All records represent simulated demo terminals. Actual MT5 connections remain unverified until authorized binary bridge tokens are supplied.
          </span>
        </div>
        <span className="font-mono text-[10px] text-slate-500">FastAPI Simulation Daemon</span>
      </div>

      {/* State Counters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3.5 space-y-1">
          <span className="text-[10px] font-semibold uppercase text-slate-400">Connected Terminals</span>
          <div className="font-mono text-2xl font-bold text-emerald-400">{connectedCount}</div>
          <span className="text-[11px] text-slate-500 font-mono">Active heartbeat polling</span>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3.5 space-y-1">
          <span className="text-[10px] font-semibold uppercase text-slate-400">Disconnected Terminals</span>
          <div className="font-mono text-2xl font-bold text-slate-300">{disconnectedCount}</div>
          <span className="text-[11px] text-slate-500 font-mono">Idle / Manually severed</span>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3.5 space-y-1">
          <span className="text-[10px] font-semibold uppercase text-slate-400">Connection Errors</span>
          <div className="font-mono text-2xl font-bold text-rose-400">{errorCount}</div>
          <span className="text-[11px] text-slate-500 font-mono">Socket / Auth exceptions</span>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search account #, broker, owner..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-750 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Status:</span>
            <select
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
              className="rounded-lg border border-slate-750 bg-slate-950 px-2.5 py-1 text-slate-200 focus:outline-none focus:border-sky-500"
            >
              <option value="all">All States</option>
              <option value="connected">Connected</option>
              <option value="disconnected">Disconnected</option>
              <option value="error">Error</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Role:</span>
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="rounded-lg border border-slate-750 bg-slate-950 px-2.5 py-1 text-slate-200 focus:outline-none focus:border-sky-500"
            >
              <option value="all">All Roles</option>
              <option value="parent">Parent Mentor</option>
              <option value="child">Child Trader</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-slate-950/90 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Account Number</th>
                <th className="px-4 py-3">Owner & Role</th>
                <th className="px-4 py-3">Broker & Server</th>
                <th className="px-4 py-3">Connection State</th>
                <th className="px-4 py-3">Last Status Update</th>
                <th className="px-4 py-3">Diagnostic Message</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredAccounts.map((acc) => {
                const owner = users.find((u) => u.id === acc.userId);

                return (
                  <tr key={acc.id} className="hover:bg-slate-850/40 transition-colors">
                    {/* Account Number */}
                    <td className="px-4 py-3.5 font-mono">
                      <div className="font-semibold text-slate-200">#{acc.accountNumber}</div>
                      <span className="text-[10px] text-slate-500">
                        {acc.accountType === 'live' ? 'Simulated Live' : 'Demo Testnet'}
                      </span>
                    </td>

                    {/* Owner & Role */}
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-slate-100">{owner?.fullName}</div>
                      <span className="text-[10px] font-mono text-slate-400 uppercase">
                        {acc.accountRole === 'parent' ? 'Parent Mentor' : 'Child Trader'}
                      </span>
                    </td>

                    {/* Broker & Server */}
                    <td className="px-4 py-3.5 font-mono text-[11px]">
                      <div className="text-slate-200 font-sans">{acc.broker}</div>
                      <span className="text-slate-500">{acc.server}</span>
                    </td>

                    {/* Connection State */}
                    <td className="px-4 py-3.5">
                      <StatusBadge status={acc.connectionStatus} size="sm" />
                      {acc.connectionStatus === 'connected' && (
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          Ping: {acc.pingMs}ms
                        </div>
                      )}
                    </td>

                    {/* Last Status Update */}
                    <td className="px-4 py-3.5 font-mono text-[11px] text-slate-400">
                      {new Date(acc.lastHeartbeat).toLocaleTimeString()} UTC
                    </td>

                    {/* Diagnostics Message */}
                    <td className="px-4 py-3.5">
                      {acc.errorMessage ? (
                        <span className="text-[11px] text-rose-400 font-medium" title={acc.errorMessage}>
                          {acc.errorMessage}
                        </span>
                      ) : acc.connectionStatus === 'connected' ? (
                        <span className="text-[11px] text-emerald-400">
                          Heartbeat acknowledged; zero packet loss.
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-500 italic">
                          Standby (Session offline)
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5 text-right">
                      {acc.connectionStatus === 'connected' ? (
                        <button
                          onClick={() => {
                            setConfirmData({
                              isOpen: true,
                              account: acc,
                              action: 'disconnect'
                            });
                          }}
                          className="rounded px-2.5 py-1 text-[11px] font-medium border border-rose-900/60 bg-rose-950/40 text-rose-300 hover:bg-rose-900/50 transition-colors"
                        >
                          Disconnect
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setConfirmData({
                              isOpen: true,
                              account: acc,
                              action: 'reconnect'
                            });
                          }}
                          className="rounded px-2.5 py-1 text-[11px] font-medium border border-emerald-900/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50 transition-colors"
                        >
                          Reconnect
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmData.isOpen}
        onClose={() => setConfirmData({ isOpen: false, account: null, action: 'disconnect' })}
        onConfirm={() => {
          if (confirmData.account) {
            if (confirmData.action === 'disconnect') {
              disconnectMT5Account(confirmData.account.id);
            } else {
              reconnectMT5Account(confirmData.account.id);
            }
          }
        }}
        title={confirmData.action === 'disconnect' ? 'Disconnect Demo Terminal' : 'Reconnect Demo Terminal'}
        description={
          confirmData.action === 'disconnect'
            ? `Are you sure you want to disconnect terminal #${confirmData.account?.accountNumber}? Trade copying will be paused until reconnected.`
            : `Are you sure you want to re-establish connection for terminal #${confirmData.account?.accountNumber}?`
        }
        confirmLabel={confirmData.action === 'disconnect' ? 'Disconnect Terminal' : 'Reconnect Terminal'}
        variant={confirmData.action === 'disconnect' ? 'danger' : 'primary'}
      />
    </div>
  );
};
