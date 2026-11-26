import React, { useState, useEffect } from 'react';
import {
  X,
  SlidersHorizontal,
  AlertTriangle,
  Info
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { LotSettings, LotCopyMode } from '../../types';

interface LotSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  linkId: string;
}

const DEFAULT_SETTINGS: LotSettings = {
  mode: 'custom_lot',
  customType: 'multiplier',
  fixedLot: 0.1,
  multiplier: 0.5,
  riskPercent: 1.5,
  maxLotCap: 50,
  minLotClamp: 0.01,
  maxDrawdownProtectionPercent: 20.0,
  copyPendingOrders: false,
  syncSlTp: true,
  slippageMaxPips: 30.0,
  symbolPrefix: '',
  symbolSuffix: '',
};

function isAlignedToStep(value: number, minLot: number, step: number): boolean {
  if (!Number.isFinite(step) || step <= 0) return true;
  const base = Number.isFinite(minLot) && minLot > 0 ? minLot : 0;
  const steps = (value - base) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-4;
}

export const LotSettingsModal: React.FC<LotSettingsModalProps> = ({
  isOpen,
  onClose,
  linkId
}) => {
  const { isCloudMode } = useAuth();
  const { parentChildLinks, updateLotSettings, mt5Accounts } = useApp();

  const link = parentChildLinks.find((l) => l.id === linkId);
  const childAccount = link ? mt5Accounts.find((a) => a.id === link.childAccountId) : null;

  const initialSettings: LotSettings = link?.lotSettings || DEFAULT_SETTINGS;

  const [mode, setMode] = useState<LotCopyMode>(initialSettings.mode);
  const [customType, setCustomType] = useState<'multiplier' | 'fixed'>(
    initialSettings.customType === 'fixed' ? 'fixed' : 'multiplier'
  );
  const [fixedLot, setFixedLot] = useState<number>(initialSettings.fixedLot);
  const [multiplier, setMultiplier] = useState<number>(initialSettings.multiplier);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !link) return;
    const s = link.lotSettings || DEFAULT_SETTINGS;
    setMode(s.mode);
    setCustomType(s.customType === 'fixed' ? 'fixed' : 'multiplier');
    setFixedLot(s.fixedLot);
    setMultiplier(s.multiplier);
    setSaveError(null);
  }, [isOpen, linkId, link]);

  if (!isOpen || !link) return null;

  const specEntries = childAccount?.verifiedSymbolSpecs
    ? Object.entries(childAccount.verifiedSymbolSpecs)
    : [];
  const preferredSymbol = String(childAccount?.tradingSymbol || '').toUpperCase();
  const matchedSpecEntry =
    specEntries.find(([sym]) => sym.toUpperCase() === preferredSymbol) ||
    specEntries.find(([sym]) => sym.toUpperCase().includes('XAU')) ||
    specEntries[0] ||
    null;
  const activeSpecSymbol = matchedSpecEntry?.[0] || childAccount?.tradingSymbol || 'Symbol';
  const brokerMinLot = matchedSpecEntry?.[1]?.minLot;
  const brokerMaxLot = matchedSpecEntry?.[1]?.maxLot;
  const brokerLotStep = matchedSpecEntry?.[1]?.lotStep;

  const currentEquity = childAccount?.verifiedEquity ?? childAccount?.equity ?? 10000;
  const currentLeverage = childAccount?.leverage || 500;
  const sampleLot =
    mode === 'parent_lot'
      ? 1.0
      : customType === 'fixed'
      ? fixedLot
      : 1.0 * multiplier;

  const estimatedRequiredMargin = (sampleLot * 100000) / currentLeverage;
  const isMarginRiskHigh =
    estimatedRequiredMargin > (childAccount?.freeMargin || currentEquity * 0.5) * 0.4;

  const validateBrokerLotConstraints = (): string | null => {
    if (mode === 'custom_lot' && customType === 'multiplier') {
      if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 20) {
        return 'Lot multiplier must be greater than 0 and at most 20.0.';
      }
      return null;
    }
    if (mode === 'custom_lot' && customType === 'fixed') {
      if (!Number.isFinite(fixedLot) || fixedLot <= 0) {
        return 'Fixed lot size must be greater than 0.';
      }
      if (typeof brokerMinLot === 'number' && fixedLot < brokerMinLot - 1e-9) {
        return `Fixed lot ${fixedLot.toFixed(2)} is below broker minimum (${brokerMinLot.toFixed(2)}) for ${activeSpecSymbol}. Volume will not be silently increased.`;
      }
      if (typeof brokerMaxLot === 'number' && fixedLot > brokerMaxLot + 1e-9) {
        return `Fixed lot ${fixedLot.toFixed(2)} exceeds broker maximum (${brokerMaxLot.toFixed(2)}) for ${activeSpecSymbol}.`;
      }
      if (
        typeof brokerLotStep === 'number' &&
        brokerLotStep > 0 &&
        !isAlignedToStep(fixedLot, brokerMinLot ?? 0, brokerLotStep)
      ) {
        return `Fixed lot ${fixedLot.toFixed(2)} must align with broker volume step (${brokerLotStep}) for ${activeSpecSymbol}.`;
      }
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const validationError = validateBrokerLotConstraints();
    if (validationError) {
      setSaveError(validationError);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const base = link.lotSettings || DEFAULT_SETTINGS;
    const res = await updateLotSettings(linkId, {
      mode,
      customType,
      fixedLot,
      multiplier,
      riskPercent: base.riskPercent ?? DEFAULT_SETTINGS.riskPercent,
      maxLotCap: base.maxLotCap ?? DEFAULT_SETTINGS.maxLotCap,
      minLotClamp: base.minLotClamp ?? DEFAULT_SETTINGS.minLotClamp,
      maxDrawdownProtectionPercent:
        base.maxDrawdownProtectionPercent ?? DEFAULT_SETTINGS.maxDrawdownProtectionPercent,
      copyPendingOrders: false,
      syncSlTp: true,
      slippageMaxPips: base.slippageMaxPips ?? DEFAULT_SETTINGS.slippageMaxPips,
      symbolPrefix: base.symbolPrefix || '',
      symbolSuffix: base.symbolSuffix || '',
    });
    setSaving(false);
    if (res && !res.success) {
      setSaveError(res.message || 'Failed to save lot size settings.');
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-cyan-950 p-2 text-cyan-400 border border-cyan-800">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Lot Size Preferences: {link.mentorName}
              </h3>
              <p className="text-xs text-slate-400">
                Select how copied trade volume is sized on your Child MT5 Demo account
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 text-xs">
          {saveError && (
            <div className="rounded-lg border border-rose-900/60 bg-rose-950/50 p-3 text-rose-300 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{saveError}</span>
            </div>
          )}

          {isCloudMode && (
            <div className="rounded-lg border border-sky-900/50 bg-sky-950/30 p-3 text-[11px] text-sky-200 flex items-start gap-2">
              <Info className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
              <span>
                Your lot sizing rule persists in Supabase. Broker volume limits (min, max, step) are strictly enforced without silently increasing volume; unsupported trades are rejected with an honest error.
              </span>
            </div>
          )}

          {/* Mode Selector: Mode A vs Mode B */}
          <div>
            <label className="block text-slate-300 font-semibold mb-2">
              Select Trade Copying Lot Mode:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div
                onClick={() => setMode('parent_lot')}
                className={`cursor-pointer rounded-xl border p-4 transition-all ${
                  mode === 'parent_lot'
                    ? 'border-cyan-500 bg-cyan-950/40 text-cyan-200 ring-1 ring-cyan-500/30'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm">Copy 1:1 Ratio</span>
                  <span className="h-4 w-4 rounded-full border border-slate-700 flex items-center justify-center">
                    {mode === 'parent_lot' && <span className="h-2 w-2 rounded-full bg-cyan-400" />}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                  Automatically matches the mentor&apos;s proportional execution ratio on your terminal, subject to your broker&apos;s min/max/step limits.
                </p>
              </div>

              <div
                onClick={() => setMode('custom_lot')}
                className={`cursor-pointer rounded-xl border p-4 transition-all ${
                  mode === 'custom_lot'
                    ? 'border-cyan-500 bg-cyan-950/40 text-cyan-200 ring-1 ring-cyan-500/30'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm">Custom Lot Size</span>
                  <span className="h-4 w-4 rounded-full border border-slate-700 flex items-center justify-center">
                    {mode === 'custom_lot' && <span className="h-2 w-2 rounded-full bg-cyan-400" />}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                  Choose a fixed lot size per trade or apply a custom multiplier ratio.
                </p>
              </div>
            </div>
          </div>

          {/* Custom Lot Settings Config */}
          {mode === 'custom_lot' && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-4">
              <span className="text-[10px] uppercase font-bold text-cyan-400 font-mono tracking-wider">
                Lot Sizing Method
              </span>

              <div className="grid grid-cols-2 gap-2">
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
              </div>

              <div className="pt-1">
                {customType === 'multiplier' ? (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Lot Multiplier Factor (e.g. 0.50 = 50% scaling)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      min="0.01"
                      max="20"
                      value={multiplier}
                      onChange={(e) => setMultiplier(parseFloat(e.target.value) || 0.1)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Example: 1.00 signal unit executes at <strong>{(1.0 * multiplier).toFixed(2)} lots</strong> on your account.
                    </span>
                  </div>
                ) : (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Fixed Lot Size for Every Copied Trade
                    </label>
                    <input
                      type="number"
                      step={brokerLotStep && brokerLotStep > 0 ? String(brokerLotStep) : '0.01'}
                      min={brokerMinLot ?? 0.01}
                      max={brokerMaxLot ?? 100}
                      value={fixedLot}
                      onChange={(e) => setFixedLot(parseFloat(e.target.value) || 0.01)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Every copied market order opens at exactly <strong>{fixedLot.toFixed(2)} lots</strong> if permitted by broker limits.
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Broker Volume Limits & Margin Preview */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Info className="h-4 w-4 text-cyan-400" />
                Verified Broker Volume Limits ({activeSpecSymbol})
              </span>
              <span className="font-mono text-emerald-400 font-semibold">
                Free Margin: ${childAccount?.freeMargin.toLocaleString() || '0'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 space-y-1 font-mono">
              <div className="flex justify-between">
                <span className="font-sans">Broker Min / Max / Step:</span>
                <span className="text-slate-200">
                  {brokerMinLot !== undefined
                    ? `${brokerMinLot.toFixed(2)} / ${(brokerMaxLot ?? 100).toFixed(2)} / ${brokerLotStep ?? 0.01}`
                    : 'Awaiting EA symbol specs'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans">Estimated Margin (1:{currentLeverage}):</span>
                <span className="font-bold text-white">${estimatedRequiredMargin.toFixed(2)}</span>
              </div>
              {isMarginRiskHigh && (
                <div className="flex items-center gap-1.5 text-amber-400 font-sans font-medium pt-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>Warning: High margin usage for your current balance. Consider lowering your lot size.</span>
                </div>
              )}
            </div>
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
              disabled={saving}
              className="rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 px-4 py-2 font-semibold text-white transition-colors"
            >
              {saving ? 'Saving...' : 'Save Lot Size'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

