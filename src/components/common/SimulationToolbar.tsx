import React, { useState, useEffect } from 'react';
import {
  XCircle,
  TrendingUp,
  TrendingDown,
  WifiOff,
  FlaskConical,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  Info
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface FeedbackState {
  type: 'success' | 'error' | 'info';
  message: string;
  details?: string;
}

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
  const [submittingAction, setSubmittingAction] = useState<'BUY' | 'SELL' | 'CLOSE' | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [selectedCloseTicket, setSelectedCloseTicket] = useState<number | null>(null);

  // Active open parent trades (magicNumber 7701 or marked as parent live order)
  const openParentTrades = trades.filter(
    (t) => t.status === 'OPEN' && (t.magicNumber === 7701 || t.comment?.includes('Parent'))
  );

  // Auto-clear feedback banner after 6 seconds
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => {
      setFeedback(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [feedback]);

  // Keep selected close ticket in sync with open trades
  useEffect(() => {
    if (openParentTrades.length > 0) {
      if (!selectedCloseTicket || !openParentTrades.some((t) => t.ticket === selectedCloseTicket)) {
        setSelectedCloseTicket(openParentTrades[0].ticket);
      }
    } else {
      setSelectedCloseTicket(null);
    }
  }, [openParentTrades, selectedCloseTicket]);

  const handleSimulate = (type: 'BUY' | 'SELL') => {
    if (submittingAction) return;

    if (isNaN(lotInput) || lotInput <= 0) {
      setFeedback({
        type: 'error',
        message: 'Invalid Lot Size',
        details: 'Please specify a lot volume greater than 0.00 (e.g. 0.10, 1.00).'
      });
      return;
    }

    setSubmittingAction(type);

    setTimeout(() => {
      try {
        const result = simulateParentOrder(selectedSymbol, type, lotInput);
        if (result.success) {
          setFeedback({
            type: 'success',
            message: `Simulated ${type} Signal Dispatched`,
            details: result.message
          });
        } else {
          setFeedback({
            type: 'error',
            message: 'Simulation Aborted',
            details: result.message
          });
        }
      } catch (err: any) {
        setFeedback({
          type: 'error',
          message: 'Simulation Error',
          details: err?.message || 'An unexpected failure occurred while placing order.'
        });
      } finally {
        setSubmittingAction(null);
      }
    }, 200);
  };

  const handleClose = () => {
    if (submittingAction) return;

    const targetTicket = selectedCloseTicket || (openParentTrades[0] ? openParentTrades[0].ticket : null);
    if (!targetTicket) {
      setFeedback({
        type: 'info',
        message: 'No Open Positions',
        details: 'There are no active parent positions available to close.'
      });
      return;
    }

    setSubmittingAction('CLOSE');

    setTimeout(() => {
      try {
        const result = simulateParentClose(targetTicket);
        if (result.success) {
          setFeedback({
            type: 'success',
            message: 'Position Closed Successfully',
            details: result.message
          });
        } else {
          setFeedback({
            type: 'error',
            message: 'Close Action Failed',
            details: result.message
          });
        }
      } catch (err: any) {
        setFeedback({
          type: 'error',
          message: 'Close Trade Error',
          details: err?.message || 'Failed to close position.'
        });
      } finally {
        setSubmittingAction(null);
      }
    }, 200);
  };

  const handleInjectError = (scenario: 'slippage' | 'margin' | 'disconnect') => {
    simulateErrorEvent(scenario);
    const labels = {
      slippage: 'Slippage Protection Filter (4.2 pips deviation)',
      margin: 'Insufficient Broker Margin Rejection ($180 vs $420)',
      disconnect: 'Simulated Socket Interruption / Terminal Offline'
    };
    setFeedback({
      type: 'info',
      message: 'Demo Stress Scenario Injected',
      details: labels[scenario]
    });
  };

  const activeTicketToClose = selectedCloseTicket || (openParentTrades[0] ? openParentTrades[0].ticket : null);

  return (
    <div className="border-b border-slate-800 bg-slate-900 px-4 py-2 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs">
        {/* Left: Simulation Engine Status */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded bg-slate-800 border border-slate-700 px-2.5 py-1 text-slate-300 font-mono text-[11px]">
            <FlaskConical className="h-3.5 w-3.5 text-sky-400" />
            <span className="font-semibold uppercase tracking-wider text-[10px]">Demo Signal Simulator</span>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-slate-400 text-xs">
            <span>
              Simulated Latency: <strong className="text-slate-200 font-mono">{systemHealth.averageCopyLatencyMs}ms</strong>
            </span>
            <span>•</span>
            <span>
              Active Signals: <strong className="text-emerald-400 font-mono">{openParentTrades.length}</strong>
            </span>
          </div>
        </div>

        {/* Center/Right: Live Order Triggers & Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Symbol Select */}
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value as any)}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
            aria-label="Select symbol"
          >
            <option value="XAUUSD">XAUUSD (Gold)</option>
            <option value="EURUSD">EURUSD (Euro)</option>
            <option value="US30.cash">US30 (Dow 30)</option>
          </select>

          {/* Lots Input */}
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded px-2 py-1">
            <span className="text-[10px] text-slate-500 font-medium">Lots:</span>
            <input
              type="number"
              step="0.1"
              min="0.01"
              max="20.0"
              value={lotInput}
              onChange={(e) => setLotInput(parseFloat(e.target.value) || 0.1)}
              className="w-14 bg-transparent text-xs font-mono text-slate-200 text-right focus:outline-none"
              aria-label="Lot volume"
            />
          </div>

          {/* BUY Button */}
          <button
            disabled={submittingAction !== null}
            onClick={() => handleSimulate('BUY')}
            className="flex items-center gap-1.5 rounded bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white px-3 py-1.5 text-xs font-semibold transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Simulate Parent Opening BUY position"
          >
            {submittingAction === 'BUY' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-200" />
            ) : (
              <TrendingUp className="h-3.5 w-3.5" />
            )}
            <span>{submittingAction === 'BUY' ? 'Simulating...' : 'Simulate BUY'}</span>
          </button>

          {/* SELL Button */}
          <button
            disabled={submittingAction !== null}
            onClick={() => handleSimulate('SELL')}
            className="flex items-center gap-1.5 rounded bg-rose-700 hover:bg-rose-600 active:bg-rose-800 text-white px-3 py-1.5 text-xs font-semibold transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Simulate Parent Opening SELL position"
          >
            {submittingAction === 'SELL' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-200" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            <span>{submittingAction === 'SELL' ? 'Simulating...' : 'Simulate SELL'}</span>
          </button>

          {/* Close Active Parent Trade */}
          {openParentTrades.length > 0 && activeTicketToClose && (
            <div className="flex items-center gap-1">
              {openParentTrades.length > 1 && (
                <select
                  value={selectedCloseTicket || openParentTrades[0].ticket}
                  onChange={(e) => setSelectedCloseTicket(Number(e.target.value))}
                  className="rounded border border-amber-800/80 bg-slate-950 px-1.5 py-1 text-[11px] text-amber-200 font-mono focus:outline-none"
                  aria-label="Select open trade to close"
                >
                  {openParentTrades.map((t) => (
                    <option key={t.ticket} value={t.ticket}>
                      #{t.ticket} ({t.type} {t.symbol})
                    </option>
                  ))}
                </select>
              )}

              <button
                disabled={submittingAction !== null}
                onClick={handleClose}
                className="flex items-center gap-1.5 rounded border border-amber-800/80 bg-amber-950/60 hover:bg-amber-900/60 active:bg-amber-950 text-amber-200 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                title="Close active parent trade and mirror close to followers"
              >
                {submittingAction === 'CLOSE' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-amber-400" />
                )}
                <span>
                  {submittingAction === 'CLOSE'
                    ? 'Closing...'
                    : `Close Trade (#${activeTicketToClose})`}
                </span>
              </button>
            </div>
          )}

          {/* Error Injection Actions */}
          <div className="hidden lg:flex items-center gap-1 border-l border-slate-800 pl-2">
            <button
              onClick={() => handleInjectError('slippage')}
              className="rounded border border-slate-700 bg-slate-800 hover:bg-slate-750 px-2 py-1 text-[11px] text-slate-300 transition-colors"
              title="Simulate Slippage Reject trigger"
            >
              Simulate Slippage
            </button>
            <button
              onClick={() => handleInjectError('margin')}
              className="rounded border border-slate-700 bg-slate-800 hover:bg-slate-750 px-2 py-1 text-[11px] text-slate-300 transition-colors"
              title="Simulate Margin Exceeded scenario"
            >
              Simulate Margin Error
            </button>
            <button
              onClick={() => handleInjectError('disconnect')}
              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 hover:bg-slate-750 px-2 py-1 text-[11px] text-slate-300 transition-colors"
              title="Simulate Socket Drop"
            >
              <WifiOff className="h-3 w-3 text-rose-400" />
              Simulate Disconnect
            </button>
          </div>
        </div>
      </div>

      {/* Dismissible Feedback Notification Banner */}
      {feedback && (
        <div
          className={`mt-2 flex items-start justify-between gap-3 rounded-lg border p-2.5 text-xs transition-all animate-in fade-in slide-in-from-top-1 ${
            feedback.type === 'success'
              ? 'border-emerald-800/80 bg-emerald-950/80 text-emerald-200'
              : feedback.type === 'error'
              ? 'border-rose-800/80 bg-rose-950/80 text-rose-200'
              : 'border-sky-800/80 bg-sky-950/80 text-sky-200'
          }`}
        >
          <div className="flex items-start gap-2 min-w-0">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : feedback.type === 'error' ? (
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            ) : (
              <Info className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5 min-w-0">
              <strong className="font-semibold block">{feedback.message}</strong>
              {feedback.details && (
                <p className="text-[11px] opacity-90 leading-relaxed font-mono truncate sm:whitespace-normal">
                  {feedback.details}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => setFeedback(null)}
            className="rounded p-1 hover:bg-white/10 text-slate-400 hover:text-white transition-colors shrink-0"
            aria-label="Dismiss message"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
