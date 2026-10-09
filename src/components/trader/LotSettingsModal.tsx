import React, { useState } from 'react';
import {
  X,
  SlidersHorizontal,
  Check,
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  TrendingUp,
  Percent,
  Layers,
  Zap,
  Info
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { LotSettings, LotCopyMode, CustomLotType } from '../../types';

interface LotSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  linkId: string;
}

export const LotSettingsModal: React.FC<LotSettingsModalProps> = ({
  isOpen,
  onClose,
  linkId
}) => {
  const { parentChildLinks, updateLotSettings, mt5Accounts } = useApp();

  const link = parentChildLinks.find((l) => l.id === linkId);
  const childAccount = link ? mt5Accounts.find((a) => a.id === link.childAccountId) : null;

  const initialSettings: LotSettings = link?.lotSettings || {
    mode: 'custom_lot',
    customType: 'multiplier',
    fixedLot: 0.1,
    multiplier: 0.5,
    riskPercent: 1.5,
    maxLotCap: 0.5,
    minLotClamp: 0.01,
    maxDrawdownProtectionPercent: 10.0,
    copyPendingOrders: true,
    syncSlTp: true,
    slippageMaxPips: 3.0
  };

  const [mode, setMode] = useState<LotCopyMode>(initialSettings.mode);
  const [customType, setCustomType] = useState<CustomLotType>(initialSettings.customType);
  const [fixedLot, setFixedLot] = useState<number>(initialSettings.fixedLot);
  const [multiplier, setMultiplier] = useState<number>(initialSettings.multiplier);
  const [riskPercent, setRiskPercent] = useState<number>(initialSettings.riskPercent);
  const [maxLotCap, setMaxLotCap] = useState<number>(initialSettings.maxLotCap);
  const [minLotClamp, setMinLotClamp] = useState<number>(initialSettings.minLotClamp);
  const [maxDrawdown, setMaxDrawdown] = useState<number>(initialSettings.maxDrawdownProtectionPercent);
  const [syncSlTp, setSyncSlTp] = useState<boolean>(initialSettings.syncSlTp);
  const [copyPending, setCopyPending] = useState<boolean>(initialSettings.copyPendingOrders);
  const [slippagePips, setSlippagePips] = useState<number>(initialSettings.slippageMaxPips);

  if (!isOpen || !link) return null;

  // Margin calculation estimate
  const currentEquity = childAccount?.equity || 10000;
  const currentLeverage = childAccount?.leverage || 500;
  const sampleLot =
    mode === 'parent_lot'
      ? 1.0
      : customType === 'fixed'
      ? fixedLot
      : customType === 'multiplier'
      ? 1.0 * multiplier
      : (currentEquity * (riskPercent / 100)) / 500;

  const estimatedRequiredMargin = (sampleLot * 100000) / currentLeverage;
  const isMarginRiskHigh = estimatedRequiredMargin > (childAccount?.freeMargin || 5000) * 0.4;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateLotSettings(linkId, {
      mode,
      customType,
      fixedLot,
      multiplier,
      riskPercent,
      maxLotCap,
      minLotClamp,
      maxDrawdownProtectionPercent: maxDrawdown,
      copyPendingOrders: copyPending,
      syncSlTp,
      slippageMaxPips: slippagePips
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-cyan-950 p-2 text-cyan-400 border border-cyan-800">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Lot Sizing & Risk Controls: {link.mentorName}
              </h3>
              <p className="text-xs text-slate-400">Configure child deal volumes, slippage guard, and margin safety</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 text-xs">
          {/* Mode Selector: Mode A vs Mode B */}
          <div>
            <label className="block text-slate-300 font-semibold mb-2">
              Select Trade Copying Lot Mode:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Mode A */}
              <div
                onClick={() => setMode('parent_lot')}
                className={`cursor-pointer rounded-xl border p-4 transition-all ${
                  mode === 'parent_lot'
                    ? 'border-cyan-500 bg-cyan-950/40 text-cyan-200 ring-1 ring-cyan-500/30'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm">Mode A: Copy Parent Lot Size</span>
                  <span className="h-4 w-4 rounded-full border border-slate-700 flex items-center justify-center">
                    {mode === 'parent_lot' && <span className="h-2 w-2 rounded-full bg-cyan-400" />}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                  The child account directly mirrors the identical volume of the parent trade (1.00 lot parent = 1.00 lot child).
                </p>
              </div>

              {/* Mode B */}
              <div
                onClick={() => setMode('custom_lot')}
                className={`cursor-pointer rounded-xl border p-4 transition-all ${
                  mode === 'custom_lot'
                    ? 'border-cyan-500 bg-cyan-950/40 text-cyan-200 ring-1 ring-cyan-500/30'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm">Mode B: Custom Lot Size</span>
                  <span className="h-4 w-4 rounded-full border border-slate-700 flex items-center justify-center">
                    {mode === 'custom_lot' && <span className="h-2 w-2 rounded-full bg-cyan-400" />}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                  Configure custom volume algorithms: Multipliers (e.g. 0.5x), Fixed lots, or Risk % adjusted to your child balance.
                </p>
              </div>
            </div>
          </div>

          {/* Custom Settings Config (Active when Mode B is selected) */}
          {mode === 'custom_lot' && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-4">
              <span className="text-[10px] uppercase font-bold text-cyan-400 font-mono tracking-wider">
                Mode B Sizing Algorithm
              </span>

              {/* Sub-type picker */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setCustomType('multiplier')}
                  className={`rounded-lg border p-2 text-center transition-colors ${
                    customType === 'multiplier'
                      ? 'border-cyan-500 bg-cyan-950/80 text-cyan-300 font-bold'
                      : 'border-slate-800 bg-slate-900 text-slate-400'
                  }`}
                >
                  Multiplier Ratio
                </button>
                <button
                  type="button"
                  onClick={() => setCustomType('fixed')}
                  className={`rounded-lg border p-2 text-center transition-colors ${
                    customType === 'fixed'
                      ? 'border-cyan-500 bg-cyan-950/80 text-cyan-300 font-bold'
                      : 'border-slate-800 bg-slate-900 text-slate-400'
                  }`}
                >
                  Fixed Lot Size
                </button>
                <button
                  type="button"
                  onClick={() => setCustomType('risk_percent')}
                  className={`rounded-lg border p-2 text-center transition-colors ${
                    customType === 'risk_percent'
                      ? 'border-cyan-500 bg-cyan-950/80 text-cyan-300 font-bold'
                      : 'border-slate-800 bg-slate-900 text-slate-400'
                  }`}
                >
                  Risk % of Equity
                </button>
              </div>

              {/* Input for selected type */}
              <div className="pt-2">
                {customType === 'multiplier' && (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Lot Multiplier Factor (e.g. 0.20 = 20% of parent volume)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      min="0.01"
                      max="5.0"
                      value={multiplier}
                      onChange={(e) => setMultiplier(parseFloat(e.target.value) || 0.1)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Example: 1.00 lot on Mentor will execute as <strong>{(1.0 * multiplier).toFixed(2)} lots</strong> on your terminal.
                    </span>
                  </div>
                )}

                {customType === 'fixed' && (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Fixed Lot Size for Every Copied Trade
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="10.0"
                      value={fixedLot}
                      onChange={(e) => setFixedLot(parseFloat(e.target.value) || 0.01)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Every order opens at exactly {fixedLot.toFixed(2)} lots, regardless of parent size.
                    </span>
                  </div>
                )}

                {customType === 'risk_percent' && (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Risk Percentage of Account Equity (%)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.1"
                      max="10.0"
                      value={riskPercent}
                      onChange={(e) => setRiskPercent(parseFloat(e.target.value) || 1.0)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Volume is dynamically derived from your stop-loss distance and equity (${currentEquity.toLocaleString()}).
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Protective Bounds & Safeguards */}
          <div className="space-y-3">
            <span className="text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wider">
              Safety Clamps & Execution Thresholds
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Max Lot Cap</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.01"
                  value={maxLotCap}
                  onChange={(e) => setMaxLotCap(parseFloat(e.target.value) || 0.5)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-500">Hard limit ceiling</span>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Min Lot Clamp</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={minLotClamp}
                  onChange={(e) => setMinLotClamp(parseFloat(e.target.value) || 0.01)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-500">Broker minimum</span>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Max Slippage (Pips)</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="10.0"
                  value={slippagePips}
                  onChange={(e) => setSlippagePips(parseFloat(e.target.value) || 3.0)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-500">Auto-reject threshold</span>
              </div>
            </div>
          </div>

          {/* Broker Margin Validation Sandbox Box */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Info className="h-4 w-4 text-cyan-400" />
                Broker Limits & Margin Pre-Check
              </span>
              <span className="font-mono text-emerald-400 font-semibold">
                Available: ${childAccount?.freeMargin.toLocaleString() || '10,000'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>Estimated Target Lot Size:</span>
                <span className="font-mono font-bold text-white">{sampleLot.toFixed(2)} Lots</span>
              </div>
              <div className="flex justify-between">
                <span>Estimated Margin Requirement (1:{currentLeverage}):</span>
                <span className="font-mono font-bold text-white">${estimatedRequiredMargin.toFixed(2)}</span>
              </div>
              {isMarginRiskHigh && (
                <div className="flex items-center gap-1.5 text-amber-400 font-medium pt-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>Warning: High leverage margin consumption. Consider lowering your multiplier or lot size.</span>
                </div>
              )}
            </div>
          </div>

          {/* Checkbox Toggles */}
          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={syncSlTp}
                onChange={(e) => setSyncSlTp(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0"
              />
              <span className="text-slate-300">Synchronize Stop Loss & Take Profit modifications</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
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
              Save Lot Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
