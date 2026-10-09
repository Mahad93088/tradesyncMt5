import React, { useState } from 'react';
import {
  Play,
  XCircle,
  AlertOctagon,
  Zap,
  TrendingUp,
  TrendingDown,
  WifiOff,
  Sliders,
  FlaskConical,
  Info
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const SimulationToolbar: React.FC = () => {
  const {
    simulateParentOrder,
    simulateParentClose,
    simulateErrorEvent,
    trades,
    systemHealth
  } = useApp();

  const [selectedSymbol, setSelectedSymbol] = useState<'XAUUSD' | 'EURUSD' | 'US30.cash'>('XAUUSD');
  const [lotInput, setLotInput] = useState<number>(1.0);
  const [isBusy, setIsBusy] = useState(false);

  // Find active parent trades to close
  const openParentTrades = trades.filter((t) => t.status === 'OPEN' && t.magicNumber === 7701);

  const handleSimulate = (type: 'BUY' | 'SELL') => {
    setIsBusy(true);
    simulateParentOrder(selectedSymbol, type, lotInput);
    setTimeout(() => setIsBusy(false), 300);
  };

  const handleClose = () => {
    if (openParentTrades.length > 0) {
      simulateParentClose(openParentTrades[0].ticket);
    }
  };

  return (
    <div className="border-b border-slate-800 bg-slate-900 px-4 py-2 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs">
        {/* Left: Simulation Engine Status */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-slate-300 font-mono text-[11px]">
            <FlaskConical className="h-3.5 w-3.5 text-sky-400" />
            <span className="font-semibold uppercase tracking-wider text-[10px]">Demo Signal Simulator</span>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-slate-400 text-xs">
            <span>Simulated Latency: <strong className="text-slate-200 font-mono">{systemHealth.averageCopyLatencyMs}ms</strong></span>
            <span>•</span>
            <span>Active Signals: <strong className="text-slate-200 font-mono">{openParentTrades.length}</strong></span>
          </div>
        </div>

        {/* Center: Live Order Triggers */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Symbol Select */}
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value as any)}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
          >
            <option value="XAUUSD">XAUUSD (Gold)</option>
            <option value="EURUSD">EURUSD (Euro)</option>
            <option value="US30.cash">US30 (Dow 30)</option>
          </select>

          {/* Lots Input */}
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5">
            <span className="text-[10px] text-slate-500">Lots:</span>
            <input
              type="number"
              step="0.1"
              min="0.01"
              max="10.0"
              value={lotInput}
              onChange={(e) => setLotInput(parseFloat(e.target.value) || 0.1)}
              className="w-12 bg-transparent text-xs font-mono text-slate-200 text-right focus:outline-none"
            />
          </div>

          {/* BUY Button */}
          <button
            disabled={isBusy}
            onClick={() => handleSimulate('BUY')}
            className="flex items-center gap-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white px-2.5 py-1 text-xs font-medium transition-colors shadow-sm disabled:opacity-50"
            title="Simulate Parent Opening BUY position"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Simulate BUY
          </button>

          {/* SELL Button */}
          <button
            disabled={isBusy}
            onClick={() => handleSimulate('SELL')}
            className="flex items-center gap-1 rounded bg-rose-700 hover:bg-rose-600 text-white px-2.5 py-1 text-xs font-medium transition-colors shadow-sm disabled:opacity-50"
            title="Simulate Parent Opening SELL position"
          >
            <TrendingDown className="h-3.5 w-3.5" />
            Simulate SELL
          </button>

          {/* Close Active Parent Trade */}
          {openParentTrades.length > 0 && (
            <button
              onClick={handleClose}
              className="flex items-center gap-1 rounded border border-amber-800/80 bg-amber-950/60 hover:bg-amber-900/60 text-amber-200 px-2.5 py-1 text-xs font-medium transition-colors"
              title="Close active parent trade and mirror close to followers"
            >
              <XCircle className="h-3.5 w-3.5 text-amber-400" />
              Close Trade (#{openParentTrades[0].ticket})
            </button>
          )}

          {/* Error Injection Actions */}
          <div className="hidden md:flex items-center gap-1 border-l border-slate-800 pl-2">
            <button
              onClick={() => simulateErrorEvent('slippage')}
              className="rounded border border-slate-700 bg-slate-800 hover:bg-slate-750 px-2 py-1 text-[11px] text-slate-300 transition-colors"
              title="Simulate Slippage Reject trigger"
            >
              Simulate Slippage
            </button>
            <button
              onClick={() => simulateErrorEvent('margin')}
              className="rounded border border-slate-700 bg-slate-800 hover:bg-slate-750 px-2 py-1 text-[11px] text-slate-300 transition-colors"
              title="Simulate Margin Exceeded scenario"
            >
              Simulate Margin Error
            </button>
            <button
              onClick={() => simulateErrorEvent('disconnect')}
              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 hover:bg-slate-750 px-2 py-1 text-[11px] text-slate-300 transition-colors"
              title="Simulate Socket Drop"
            >
              <WifiOff className="h-3 w-3 text-rose-400" />
              Simulate Disconnect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
