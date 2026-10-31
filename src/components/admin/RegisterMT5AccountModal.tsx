import React, { useState, useEffect } from 'react';
import {
  X,
  Server,
  Layers,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  Download,
  Info,
  Key,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Link2
} from 'lucide-react';
import { mt5AdminService, ParentAccountItem } from '../../services/mt5AdminService';
import { useAuth } from '../../contexts/AuthContext';
import { useApp } from '../../context/AppContext';
import { MT5Account } from '../../types';

interface RegisterMT5AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultRole?: 'parent' | 'child';
  onSuccess: () => void;
}

export const RegisterMT5AccountModal: React.FC<RegisterMT5AccountModalProps> = ({
  isOpen,
  onClose,
  defaultRole = 'parent',
  onSuccess,
}) => {
  const { isCloudMode } = useAuth();
  const { addAuditLog, currentUser, setMt5Accounts, mt5Accounts } = useApp();

  const [accountRole, setAccountRole] = useState<'parent' | 'child'>(defaultRole);
  const [brokerName, setBrokerName] = useState<string>('XM');
  const [brokerServer, setBrokerServer] = useState<string>(
    defaultRole === 'parent' ? 'xmglobal_mt5 7' : 'xmglobal_mt5 2'
  );
  const [accountNumber, setAccountNumber] = useState<string>('');
  const [accountType, setAccountType] = useState<'demo' | 'live'>('demo');
  const [balance, setBalance] = useState<string | number>(defaultRole === 'parent' ? 50000 : 10000);
  const [currency, setCurrency] = useState<string>('USD');
  const [leverage, setLeverage] = useState<number>(100);

  // Child linkage settings
  const [parentAccountId, setParentAccountId] = useState<string>('');
  const [copyMode, setCopyMode] = useState<'multiplier' | 'fixed' | 'parent_lot'>('multiplier');
  const [multiplier, setMultiplier] = useState<number>(1.0);
  const [fixedLot, setFixedLot] = useState<number>(0.1);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Post-Registration Token Display State
  const [registeredResult, setRegisteredResult] = useState<{
    account: MT5Account;
    terminalToken: string;
    tokenPrefix?: string;
    instructions?: any;
  } | null>(null);
  const [copiedToken, setCopiedToken] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);

  // Filter available parent accounts for child link dropdown
  const parentAccounts = mt5Accounts.filter((a) => a.accountRole === 'parent');

  useEffect(() => {
    if (isOpen) {
      setAccountRole(defaultRole);
      setBrokerName('XM');
      setBrokerServer(defaultRole === 'parent' ? 'xmglobal_mt5 7' : 'xmglobal_mt5 2');
      setAccountNumber('');
      setAccountType('demo');
      setBalance(defaultRole === 'parent' ? 50000 : 10000);
      setErrorMessage(null);
      setRegisteredResult(null);
      setCopiedToken(false);
      setCopiedUrl(false);
      if (parentAccounts.length > 0) {
        setParentAccountId(parentAccounts[0].id);
      }
    }
  }, [isOpen, defaultRole]);

  const handleRoleChange = (role: 'parent' | 'child') => {
    setAccountRole(role);
    setBrokerServer(role === 'parent' ? 'xmglobal_mt5 7' : 'xmglobal_mt5 2');
    setBalance(role === 'parent' ? 50000 : 10000);
  };

  const handleCopy = (text: string, type: 'token' | 'url') => {
    navigator.clipboard.writeText(text);
    if (type === 'token') {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2500);
    } else {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!accountNumber.trim()) {
      setErrorMessage('Account number is required (e.g. your MT5 demo login number).');
      return;
    }
    if (!brokerServer.trim()) {
      setErrorMessage('MT5 Broker server name is required (e.g. xmglobal_mt5 7 or xmglobal_mt5 2).');
      return;
    }

    setIsSubmitting(true);

    try {
      const parsedBalance = balance !== '' && !isNaN(Number(balance)) ? Number(balance) : 10000;
      const res = await mt5AdminService.registerMT5Account({
        accountRole,
        brokerName: brokerName.trim() || 'XM',
        brokerServer: brokerServer.trim(),
        accountNumber: accountNumber.trim(),
        accountType,
        balance: parsedBalance,
        equity: parsedBalance,
        currency,
        leverage: Number(leverage) || 100,
        parentAccountId: accountRole === 'child' ? parentAccountId : undefined,
        lotSettings:
          accountRole === 'child'
            ? {
                copyMode,
                multiplier: Number(multiplier) || 1.0,
                fixedLot: Number(fixedLot) || 0.1,
              }
            : undefined,
        isCloudMode,
      });

      if (!res.success || !res.account || !res.terminalToken) {
        throw new Error(res.error || 'Account registration failed');
      }

      // Update in AppContext
      if (typeof setMt5Accounts === 'function') {
        setMt5Accounts((prev) => [res.account!, ...prev.filter((a) => a.id !== res.account!.id)]);
      }

      // Log audit entry
      addAuditLog({
        actorId: currentUser.id,
        actorName: currentUser.fullName,
        actorRole: 'admin',
        action: 'CREATE_DEMO_ACCOUNT',
        targetResource: 'mt5_accounts',
        targetId: accountNumber.trim(),
        result: 'success',
        details: `Registered MT5 ${accountRole} account #${accountNumber.trim()} on ${brokerName} (${brokerServer}). Token provisioned.`,
      });

      // Transition modal into Token Presentation Screen
      setRegisteredResult({
        account: res.account,
        terminalToken: res.terminalToken,
        tokenPrefix: res.tokenPrefix,
        instructions: res.instructions,
      });

      onSuccess();
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred during account registration.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const serverBaseUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://tradesync-mt5.vercel.app';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden my-auto animate-in fade-in">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl border ${
              accountRole === 'parent'
                ? 'bg-amber-950/60 border-amber-800/80 text-amber-400'
                : 'bg-cyan-950/60 border-cyan-800/80 text-cyan-400'
            }`}>
              <Server className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                {registeredResult ? 'Terminal Authentication Token Provisioned' : 'Register MT5 Account'}
                <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border font-semibold ${
                  accountRole === 'parent'
                    ? 'bg-amber-950 text-amber-300 border-amber-800'
                    : 'bg-cyan-950 text-cyan-300 border-cyan-800'
                }`}>
                  {accountRole === 'parent' ? 'Parent (Signal)' : 'Child (Follower)'}
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {registeredResult
                  ? 'Attach your Expert Advisor to complete terminal synchronization'
                  : 'Configure broker server credentials and cryptographic EA authentication'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* VIEW 1: One-Time Token Presentation View (After Successful Registration) */}
        {registeredResult ? (
          <div className="p-5 space-y-5">
            {/* Security Notice */}
            <div className="rounded-xl border border-amber-800/70 bg-amber-950/30 p-4 space-y-2">
              <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
                <Key className="h-4 w-4 shrink-0 text-amber-400" />
                <span>One-Time Plaintext Token Notice</span>
              </div>
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                For security, this secret token is <strong>never stored in plaintext</strong> in the database and cannot be retrieved again.
                Copy and save it now into your MT5 Expert Advisor.
              </p>
            </div>

            {/* Secret Terminal Token Box */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Secret Terminal Authentication Token</span>
                <span className="text-[10px] text-slate-500 font-mono">X-Terminal-Token Header</span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg bg-slate-950 border border-slate-750 px-3 py-2.5 font-mono text-xs text-cyan-300 select-all break-all shadow-inner">
                  {registeredResult.terminalToken}
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(registeredResult.terminalToken, 'token')}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow-md transition-all shrink-0"
                >
                  {copiedToken ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-300" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      <span>Copy Token</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* MT5 WebRequest URL Box */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Allow WebRequest Server URL (for MT5 Options)</span>
                <span className="text-[10px] text-slate-500 font-mono">Tools → Options → EA</span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg bg-slate-950 border border-slate-750 px-3 py-2 font-mono text-xs text-slate-300 select-all truncate shadow-inner">
                  {serverBaseUrl}
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(serverBaseUrl, 'url')}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 font-medium text-xs transition-all shrink-0"
                >
                  {copiedUrl ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy URL</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick EA Setup Instructions */}
            <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3 text-xs">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Next Steps to Connect MT5 Terminal:
              </span>
              <ol className="list-decimal list-inside space-y-1.5 text-slate-400 text-[11px] leading-relaxed">
                <li>
                  In your MT5 terminal (connected to <strong>{registeredResult.account.server}</strong>), go to:
                  <code className="text-cyan-300 bg-slate-900 px-1 py-0.5 rounded ml-1 font-mono">
                    Tools → Options → Expert Advisors
                  </code>
                </li>
                <li>
                  Check <strong>"Allow WebRequest for listed URL"</strong> and add:
                  <code className="text-cyan-300 bg-slate-900 px-1 py-0.5 rounded ml-1 font-mono">
                    {serverBaseUrl}
                  </code>
                </li>
                <li>
                  Download and attach <strong>{accountRole === 'parent' ? 'TradeSync_Broadcaster.mq5' : 'TradeSync_Receiver.mq5'}</strong> to any one chart.
                </li>
                <li>
                  Set parameter <code className="text-cyan-300 bg-slate-900 px-1 py-0.5 rounded font-mono">InpTerminalToken</code> to your copied secret token.
                </li>
                <li>
                  Set <code className="text-cyan-300 bg-slate-900 px-1 py-0.5 rounded font-mono">InpServerUrl</code> to <code className="text-cyan-300 bg-slate-900 px-1 py-0.5 rounded font-mono">{serverBaseUrl}</code>.
                </li>
                <li>
                  Click OK. The connection status in the dashboard will flip from <strong>Disconnected</strong> to <strong>Connected (EA Active)</strong> upon the first heartbeat.
                </li>
              </ol>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <a
                href={accountRole === 'parent' ? '/api/mql5/download/broadcaster' : '/api/mql5/download/receiver'}
                download={accountRole === 'parent' ? 'TradeSync_Broadcaster.mq5' : 'TradeSync_Receiver.mq5'}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold shadow-md transition-all"
              >
                <Download className="h-4 w-4 text-cyan-400" />
                Download {accountRole === 'parent' ? 'Broadcaster EA (.mq5)' : 'Receiver EA (.mq5)'}
              </a>
              <button
                type="button"
                onClick={onClose}
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-all"
              >
                <CheckCircle2 className="h-4 w-4" />
                Done & Return to Dashboard
              </button>
            </div>
          </div>
        ) : (
          /* VIEW 2: Registration Form */
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Account Role Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Account Execution Role</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleRoleChange('parent')}
                  className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                    accountRole === 'parent'
                      ? 'border-amber-500 bg-amber-950/40 text-amber-200'
                      : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">Parent Account</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/60 border border-amber-700 text-amber-300 font-mono">
                      Signal Provider
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Broadcaster EA runs here. Trades copied out to assigned children.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRoleChange('child')}
                  className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                    accountRole === 'child'
                      ? 'border-cyan-500 bg-cyan-950/40 text-cyan-200'
                      : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">Child Account</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/60 border border-cyan-700 text-cyan-300 font-mono">
                      Follower
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Receiver EA runs here. Executes copied trades with lot risk multiplier.
                  </span>
                </button>
              </div>
            </div>

            {/* Broker & Server Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Broker Name */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">Broker Name</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setBrokerName('XM')}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700"
                    >
                      + XM
                    </button>
                    <button
                      type="button"
                      onClick={() => setBrokerName('XM Global')}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700"
                    >
                      + XM Global
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  required
                  value={brokerName}
                  onChange={(e) => setBrokerName(e.target.value)}
                  placeholder="e.g. XM, IC Markets, Pepperstone"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {/* MT5 Server Name */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">Exact MT5 Server Name</label>
                  {/* Preset chips for the client's XM servers */}
                  <div className="flex items-center gap-1">
                    {accountRole === 'parent' ? (
                      <button
                        type="button"
                        onClick={() => setBrokerServer('xmglobal_mt5 7')}
                        className="text-[10px] text-amber-400 hover:text-amber-300 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 font-mono"
                        title="Client Parent XM Server"
                      >
                        xmglobal_mt5 7
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setBrokerServer('xmglobal_mt5 2')}
                        className="text-[10px] text-cyan-400 hover:text-cyan-300 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 font-mono"
                        title="Client Child XM Server"
                      >
                        xmglobal_mt5 2
                      </button>
                    )}
                  </div>
                </div>
                <input
                  type="text"
                  required
                  value={brokerServer}
                  onChange={(e) => setBrokerServer(e.target.value)}
                  placeholder="e.g. xmglobal_mt5 7, xmglobal_mt5 2"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Account Number & Account Type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">MT5 Login / Account Number</label>
                <input
                  type="text"
                  required
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="e.g. 51234892"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white font-mono placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Account Type</label>
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as any)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                >
                  <option value="demo">Demo Account (Recommended for initial tests)</option>
                  <option value="live">Live Trading Account</option>
                </select>
              </div>
            </div>

            {/* Financial Details (Balance, Currency, Leverage) */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Balance</label>
                <input
                  type="number"
                  step="any"
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                  placeholder="e.g. 500000"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Leverage</label>
                <select
                  value={leverage}
                  onChange={(e) => setLeverage(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none font-mono"
                >
                  <option value={100}>1:100</option>
                  <option value={200}>1:200</option>
                  <option value={500}>1:500</option>
                </select>
              </div>
            </div>

            {/* If Child Account: Parent Linkage Options */}
            {accountRole === 'child' && (
              <div className="rounded-xl border border-cyan-800/60 bg-cyan-950/20 p-3.5 space-y-3">
                <div className="flex items-center gap-2 text-cyan-300 text-xs font-semibold">
                  <Link2 className="h-4 w-4 text-cyan-400" />
                  <span>Assign to Parent Mentor Account</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">Parent Mentor Account</label>
                    <select
                      value={parentAccountId}
                      onChange={(e) => setParentAccountId(e.target.value)}
                      className="w-full rounded-lg border border-slate-750 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="">-- Select Parent Account --</option>
                      {parentAccounts.map((p) => (
                        <option key={p.id} value={p.id}>
                          #{p.accountNumber} ({p.broker} - {p.server})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">Lot Copy Mode</label>
                    <select
                      value={copyMode}
                      onChange={(e) => setCopyMode(e.target.value as any)}
                      className="w-full rounded-lg border border-slate-750 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="multiplier">Lot Multiplier (e.g. 1.0x)</option>
                      <option value="parent_lot">Parent Lot 1:1</option>
                      <option value="fixed">Fixed Lot Size</option>
                    </select>
                  </div>
                </div>

                {copyMode === 'multiplier' && (
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">Multiplier Ratio (e.g. 1.0 = equal size, 0.5 = half)</label>
                    <input
                      type="number"
                      step="0.05"
                      min="0.01"
                      max="10"
                      value={multiplier}
                      onChange={(e) => setMultiplier(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-750 bg-slate-900 px-2.5 py-1.5 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                )}

                {copyMode === 'fixed' && (
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">Fixed Lot Per Trade</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="50"
                      value={fixedLot}
                      onChange={(e) => setFixedLot(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-750 bg-slate-900 px-2.5 py-1.5 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Error Message */}
            {errorMessage && (
              <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 flex items-start gap-2.5 text-xs text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Submit Button */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-xs text-white shadow-lg transition-all ${
                  accountRole === 'parent'
                    ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-950/50'
                    : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-950/50'
                } disabled:opacity-50`}
              >
                {isSubmitting ? (
                  <span>Registering Account & Provisioning Token...</span>
                ) : (
                  <>
                    <Key className="h-4 w-4" />
                    <span>Register Account & Generate Token</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
