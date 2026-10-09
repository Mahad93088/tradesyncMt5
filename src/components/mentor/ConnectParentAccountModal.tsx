import React, { useState } from 'react';
import {
  Server,
  X,
  ShieldCheck,
  AlertTriangle,
  Lock,
  DollarSign,
  TrendingUp,
  Cpu
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface ConnectParentAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectParentAccountModal: React.FC<ConnectParentAccountModalProps> = ({
  isOpen,
  onClose
}) => {
  const { currentUser, connectMT5Account } = useApp();

  const [broker, setBroker] = useState('IC Markets (SC)');
  const [server, setServer] = useState('ICMarketsSC-Live04');
  const [accountNumber, setAccountNumber] = useState('');
  const [password, setPassword] = useState('');
  const [isInvestorPassword, setIsInvestorPassword] = useState(false);
  const [accountType, setAccountType] = useState<'demo' | 'live'>('live');
  const [leverage, setLeverage] = useState(500);
  const [currency, setCurrency] = useState('USD');
  const [balance, setBalance] = useState<number>(50000);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountNumber || !password) return;

    connectMT5Account({
      userId: currentUser.id,
      accountRole: 'parent',
      accountNumber,
      broker,
      server,
      accountType,
      balance,
      equity: balance,
      margin: 0,
      freeMargin: balance,
      currency,
      leverage,
      isInvestorPassword,
      autoTradingEnabled: true
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-cyan-950 p-2 text-cyan-400 border border-cyan-800">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Connect Parent MT5 Master Account</h3>
              <p className="text-xs text-slate-400">Terminal bridge credentials for trade signal broadcasting</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Broker and Server */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Broker Name</label>
              <input
                type="text"
                required
                placeholder="e.g. IC Markets (SC)"
                value={broker}
                onChange={(e) => setBroker(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">MT5 Server</label>
              <input
                type="text"
                required
                placeholder="e.g. ICMarketsSC-Live04"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white focus:border-cyan-500 focus:outline-none font-mono"
              />
            </div>
          </div>

          {/* Account Number & Password */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">MT5 Login (Account #)</label>
              <input
                type="text"
                required
                placeholder="e.g. 8829410"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white focus:border-cyan-500 focus:outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Terminal Password</label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Account Type & Balance */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Account Type</label>
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as any)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white focus:border-cyan-500 focus:outline-none"
              >
                <option value="live">Live Real</option>
                <option value="demo">Demo Testnet</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Balance ($)</label>
              <input
                type="number"
                min="100"
                value={balance}
                onChange={(e) => setBalance(parseFloat(e.target.value) || 1000)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Leverage (1:X)</label>
              <input
                type="number"
                min="1"
                value={leverage}
                onChange={(e) => setLeverage(parseInt(e.target.value) || 100)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Investor Password Checkbox */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 space-y-2">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isInvestorPassword}
                onChange={(e) => setIsInvestorPassword(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0 mt-0.5"
              />
              <div className="text-slate-300">
                <span className="font-semibold text-white">Using Read-Only Investor Password</span>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                  Recommended for parent mentors. TradeSync will monitor open positions and closed history without executing orders on your account.
                </p>
              </div>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 font-medium text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-4 py-2 font-semibold text-white transition-colors"
            >
              Initialize Connection
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
