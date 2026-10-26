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
  ExternalLink,
  Download,
  Key,
  Copy,
  Check
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
  const [generatedTokens, setGeneratedTokens] = useState<Record<string, string>>({
    acc_parent_1: 'ts_parent_demo_token_889911',
    acc_child_1: 'ts_child_demo_token_223344',
  });
  const [copiedTokenAccId, setCopiedTokenAccId] = useState<string | null>(null);
  const [isGeneratingToken, setIsGeneratingToken] = useState<string | null>(null);

  const handleGenerateToken = async (account: MT5Account) => {
    setIsGeneratingToken(account.id);
    try {
      const res = await fetch('/api/v1/bridge/terminals/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: account.id,
          accountNumber: account.accountNumber,
          brokerServer: account.server,
          brokerName: account.broker,
          accountRole: account.accountRole,
        }),
      });
      const data = await res.json();
      if (data.success && data.terminalToken) {
        setGeneratedTokens((prev) => ({ ...prev, [account.id]: data.terminalToken }));
      }
    } catch (err) {
      console.error('Failed to generate token:', err);
    } finally {
      setIsGeneratingToken(null);
    }
  };

  const copyToken = (tokenId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTokenAccId(tokenId);
    setTimeout(() => setCopiedTokenAccId(null), 2000);
  };

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
            <strong>Demo Bridge Safety Rule:</strong> All dashboard metrics represent demo simulator data until actual MT5 Expert Advisors are attached and verified on demo broker accounts.
          </span>
        </div>
        <span className="font-mono text-[10px] text-cyan-400 border border-cyan-800/80 bg-cyan-950/60 px-2 py-0.5 rounded">Option A Active</span>
      </div>

      {/* MQL5 EA Bridge Download & Token Provisioning */}
      <div className="rounded-xl border border-cyan-800/60 bg-gradient-to-br from-slate-900 via-cyan-950/20 to-slate-900 p-4 space-y-4 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wide">
                MQL5 Expert Advisor Bridge (Option A Architecture)
              </h3>
              <span className="rounded bg-cyan-950 text-cyan-300 border border-cyan-700/80 px-2 py-0.5 text-[10px] font-mono">
                API: /api/v1/bridge/*
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Download the native MQL5 Expert Advisors for real-time MT5 trade copying between Parent (Mentor) and Child (Trader) accounts.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href="/api/mql5/download/broadcaster"
              download="TradeSync_Broadcaster.mq5"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow-md transition-all"
            >
              <Download className="h-3.5 w-3.5" />
              Broadcaster (Parent EA)
            </a>
            <a
              href="/api/mql5/download/receiver"
              download="TradeSync_Receiver.mq5"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-xs shadow-md transition-all"
            >
              <Download className="h-3.5 w-3.5" />
              Receiver (Child EA)
            </a>
          </div>
        </div>

        {/* Quick Instructions & Token List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-3 space-y-2">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5 text-cyan-400" /> MT5 WebRequest Requirement
            </span>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              In your MetaTrader 5 terminal, navigate to: <code className="text-cyan-300 bg-slate-900 px-1 py-0.5 rounded font-mono">Tools → Options → Expert Advisors</code>.
              Check <strong>"Allow WebRequest for listed URL"</strong> and add your server domain or <code className="text-cyan-300 font-mono">http://localhost:3000</code>.
            </p>
          </div>

          <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-3 space-y-2">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Key className="h-3.5 w-3.5 text-amber-400" /> Terminal Authentication Tokens
            </span>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Each EA requires its unique secret terminal token. The server validates tokens cryptographically and rejects unverified account requests.
            </p>
          </div>
        </div>

        {/* Terminal Token Registry Table */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 overflow-hidden">
          <div className="px-3 py-2 bg-slate-900/80 border-b border-slate-800 text-[11px] font-semibold text-slate-300 flex items-center justify-between">
            <span>Registered Account Terminal Tokens</span>
            <span className="text-[10px] text-slate-500 font-mono">Server-Authoritative Hashing</span>
          </div>
          <div className="divide-y divide-slate-800/60">
            {mt5Accounts.slice(0, 3).map((acc) => {
              const token = generatedTokens[acc.id];
              const isCopied = copiedTokenAccId === acc.id;
              return (
                <div key={acc.id} className="p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${
                      acc.accountRole === 'parent' ? 'bg-amber-950 text-amber-300 border border-amber-800/80' : 'bg-sky-950 text-sky-300 border border-sky-800/80'
                    }`}>
                      {acc.accountRole}
                    </span>
                    <span className="font-mono text-slate-200 font-medium">#{acc.accountNumber}</span>
                    <span className="text-slate-500 text-[11px]">({acc.broker})</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {token ? (
                      <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-750 px-2 py-1 rounded">
                        <code className="font-mono text-[11px] text-cyan-300 max-w-[180px] sm:max-w-[240px] truncate">
                          {token}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyToken(acc.id, token)}
                          className="text-slate-400 hover:text-white p-0.5"
                          title="Copy token to clipboard"
                        >
                          {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleGenerateToken(acc)}
                        disabled={isGeneratingToken === acc.id}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] border border-slate-700"
                      >
                        <Key className="h-3 w-3 text-amber-400" />
                        {isGeneratingToken === acc.id ? 'Generating...' : 'Generate Token'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
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
