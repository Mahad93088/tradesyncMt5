import React, { useState } from 'react';
import {
  X,
  Server,
  Layers,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Plus,
  Info
} from 'lucide-react';
import { mt5AdminService, CreateDemoAccountParams } from '../../services/mt5AdminService';
import { useAuth } from '../../contexts/AuthContext';
import { useApp } from '../../context/AppContext';

interface CreateDemoAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultRole?: 'parent' | 'child';
  onSuccess: () => void;
}

export const CreateDemoAccountModal: React.FC<CreateDemoAccountModalProps> = ({
  isOpen,
  onClose,
  defaultRole = 'parent',
  onSuccess,
}) => {
  const { isCloudMode, user } = useAuth();
  const { addAuditLog, currentUser, setMt5Accounts, setUsers } = useApp();

  const [accountRole, setAccountRole] = useState<'parent' | 'child'>(defaultRole);
  const [ownerName, setOwnerName] = useState<string>('');
  const [accountNumber, setAccountNumber] = useState<string>(() =>
    `DEMO-${defaultRole === 'parent' ? '700' : '900'}${Math.floor(100 + Math.random() * 900)}`
  );
  const [brokerName, setBrokerName] = useState<string>('TradeSync Sandbox Demo Broker');
  const [brokerServer, setBrokerServer] = useState<string>('TradeSync-DemoBridge-01');
  const [balance, setBalance] = useState<number>(defaultRole === 'parent' ? 100000 : 10000);
  const [leverage, setLeverage] = useState<number>(100);
  const [currency, setCurrency] = useState<string>('USD');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Update defaults when role changes
  const handleRoleChange = (role: 'parent' | 'child') => {
    setAccountRole(role);
    setAccountNumber(`DEMO-${role === 'parent' ? '700' : '900'}${Math.floor(100 + Math.random() * 900)}`);
    setBalance(role === 'parent' ? 100000 : 10000);
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!accountNumber.trim()) {
      setErrorMessage('Account number is required.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await mt5AdminService.createDemoMT5Account({
        accountRole,
        accountNumber: accountNumber.trim(),
        brokerName: brokerName.trim() || 'TradeSync Sandbox Demo Broker',
        brokerServer: brokerServer.trim() || 'TradeSync-DemoBridge-01',
        balance: Number(balance) || 10000,
        currency,
        leverage,
        userName: ownerName.trim() || (accountRole === 'parent' ? 'Demo Master Trader' : 'Demo Follower Trader'),
        isCloudMode,
      });

      if (!res.success) {
        throw new Error(res.error || 'Failed to create demo MT5 account');
      }

      if (res.data && typeof setMt5Accounts === 'function') {
        setMt5Accounts((prev) => [res.data!, ...prev.filter((a) => a.id !== res.data!.id)]);
      }
      if (res.owner && typeof setUsers === 'function') {
        setUsers((prev) => [res.owner!, ...prev.filter((u) => u.id !== res.owner!.id)]);
      }

      // Log audit entry
      addAuditLog({
        actorId: currentUser.id,
        actorName: currentUser.fullName,
        actorRole: 'admin',
        action: 'CREATE_DEMO_ACCOUNT',
        targetResource: 'mt5_accounts',
        targetId: accountNumber,
        result: 'success',
        details: `Created demo ${accountRole} MT5 account #${accountNumber} for testing (${ownerName || 'Demo Sandbox'}).`,
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred while creating demo account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden my-auto animate-in fade-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Create Sandbox Demo MT5 Account</h3>
              <p className="text-xs text-slate-400">
                Provision a clearly labelled simulation account for trade-copy routing tests
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Simulation Disclaimer Banner */}
          <div className="rounded-xl border border-cyan-800/60 bg-cyan-950/30 p-3.5 flex items-start gap-3">
            <Info className="h-4 w-4 shrink-0 text-cyan-400 mt-0.5" />
            <div className="space-y-0.5 text-xs text-cyan-200">
              <span className="font-semibold block">Simulation Sandbox Account</span>
              <p className="text-[11px] text-cyan-300/80 leading-relaxed">
                This record uses simulated bridge telemetry for routing and allocation tests. It does not connect to or expose real MT5 live trading terminal credentials.
              </p>
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 flex items-start gap-2 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Account Role Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Account Classification</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleRoleChange('parent')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  accountRole === 'parent'
                    ? 'border-cyan-500 bg-cyan-950/40 text-white shadow-sm'
                    : 'border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-cyan-400">Master Parent</span>
                  <Server className="h-3.5 w-3.5 text-cyan-400" />
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Signal Provider / Mentor Master account that follower child terminals copy from.
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleRoleChange('child')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  accountRole === 'child'
                    ? 'border-emerald-500 bg-emerald-950/40 text-white shadow-sm'
                    : 'border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-emerald-400">Follower Child</span>
                  <Layers className="h-3.5 w-3.5 text-emerald-400" />
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Follower terminal that receives and copies synchronized positions from a parent.
                </p>
              </button>
            </div>
          </div>

          {/* Account Owner / Display Name */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">
              Account Holder / Label <span className="text-slate-500 font-normal">(Display Name)</span>
            </label>
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder={accountRole === 'parent' ? 'e.g. Mentor Alpha (Alex Vance)' : 'e.g. Follower Trader (Sarah)'}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Account Number & Leverage Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">MT5 Account Number</label>
              <input
                type="text"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="DEMO-700101"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Demo Leverage</label>
              <select
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              >
                <option value={50}>1:50</option>
                <option value={100}>1:100 (Standard)</option>
                <option value={200}>1:200</option>
                <option value={500}>1:500</option>
              </select>
            </div>
          </div>

          {/* Balance & Currency Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Simulated Balance</label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-xs text-slate-500 font-mono">$</span>
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={balance}
                  onChange={(e) => setBalance(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-7 pr-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
          </div>

          {/* Broker Server Info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Demo Broker</label>
              <input
                type="text"
                value={brokerName}
                onChange={(e) => setBrokerName(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Broker Server</label>
              <input
                type="text"
                value={brokerServer}
                onChange={(e) => setBrokerServer(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg bg-slate-800 hover:bg-slate-750 px-3.5 py-1.5 text-xs font-semibold text-slate-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Creating Account...</span>
                </>
              ) : (
                <span>Create Demo Account</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
