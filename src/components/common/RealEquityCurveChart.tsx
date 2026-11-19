import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';
import type { Trade } from '../../types';

interface RealEquityCurveChartProps {
  trades: Trade[];
  isCloudMode: boolean;
  variant?: 'dark' | 'light';
  title?: string;
  subtitle?: string;
}

interface CurvePoint {
  index: number;
  label: string;
  symbol: string;
  tradePnl: number;
  cumulativePnl: number;
}

export const RealEquityCurveChart: React.FC<RealEquityCurveChartProps> = ({
  trades,
  isCloudMode,
  variant = 'dark',
  title = 'Cumulative Realized Performance',
  subtitle = 'Computed strictly from verified closed MT5 deals',
}) => {
  const points = useMemo<CurvePoint[]>(() => {
    const settled = trades
      .filter((t) => !t.isMappingFallback && t.status === 'CLOSED' && (!isCloudMode || t.isRealized !== false))
      .slice()
      .sort((a, b) => {
        const ta = Date.parse(a.closeTime || a.openTime || '');
        const tb = Date.parse(b.closeTime || b.openTime || '');
        return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
      });

    let running = 0;
    return settled.map((t, idx) => {
      const net = Number(t.profit || 0) + Number(t.commission || 0) + Number(t.swap || 0);
      running = Number((running + net).toFixed(2));
      const ts = t.closeTime || t.openTime;
      const d = ts ? new Date(ts) : null;
      return {
        index: idx + 1,
        label: d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : `#${idx + 1}`,
        symbol: t.symbol,
        tradePnl: Number(net.toFixed(2)),
        cumulativePnl: running,
      };
    });
  }, [trades, isCloudMode]);

  const isLight = variant === 'light';
  const cardCls = isLight
    ? 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm'
    : 'rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm';
  const titleCls = isLight ? 'text-sm font-semibold text-slate-900' : 'text-sm font-semibold text-slate-100';
  const subCls = isLight ? 'text-[11px] text-slate-500 mt-0.5' : 'text-[11px] text-slate-400 mt-0.5';

  if (points.length === 0) {
    return (
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className={titleCls}>{title}</h3>
            <p className={subCls}>{subtitle}</p>
          </div>
          <BarChart3 className={`h-4 w-4 ${isLight ? 'text-slate-400' : 'text-slate-500'}`} />
        </div>
        <div
          className={`h-44 rounded-lg border border-dashed flex flex-col items-center justify-center text-center px-4 ${
            isLight ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-slate-800 bg-slate-950/60 text-slate-400'
          }`}
        >
          <p className="text-xs font-medium">No settled closed trades yet</p>
          <p className="text-[11px] opacity-80 mt-1">
            Cumulative equity curve renders automatically once closed MT5 deal telemetry is recorded.
          </p>
        </div>
      </div>
    );
  }

  const latest = points[points.length - 1].cumulativePnl;
  const minVal = Math.min(0, ...points.map((p) => p.cumulativePnl));
  const maxVal = Math.max(0, ...points.map((p) => p.cumulativePnl));
  const span = Math.max(1, maxVal - minVal);

  const width = 640;
  const height = 180;
  const padX = 16;
  const padY = 18;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const coords = points.map((pt, idx) => {
    const x = points.length === 1 ? width / 2 : padX + (idx / (points.length - 1)) * innerW;
    const y = padY + ((maxVal - pt.cumulativePnl) / span) * innerH;
    return { x, y, pt };
  });

  const zeroY = padY + ((maxVal - 0) / span) * innerH;
  const linePath = coords.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const areaPath =
    coords.length > 1
      ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${zeroY.toFixed(1)} L ${coords[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`
      : '';

  const positive = latest >= 0;
  const strokeColor = positive ? '#10b981' : '#f43f5e';
  const gradId = `eqGrad_${positive ? 'pos' : 'neg'}_${variant}`;

  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className={titleCls}>{title}</h3>
          <p className={subCls}>{subtitle}</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={isLight ? 'text-slate-500 font-mono' : 'text-slate-400 font-mono'}>
            {points.length} closed deals
          </span>
          <span
            className={`inline-flex items-center gap-1 font-mono font-bold tabular-nums ${
              positive ? (isLight ? 'text-emerald-700' : 'text-emerald-400') : isLight ? 'text-rose-700' : 'text-rose-400'
            }`}
          >
            {positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {latest >= 0 ? `+$${latest.toFixed(2)}` : `-$${Math.abs(latest).toFixed(2)}`}
          </span>
        </div>
      </div>

      <div className={`rounded-lg border p-2 ${isLight ? 'border-slate-100 bg-slate-50/70' : 'border-slate-800 bg-slate-950/70'}`}>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 overflow-visible" role="img" aria-label={title}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Zero baseline */}
          <line
            x1={padX}
            y1={zeroY}
            x2={width - padX}
            y2={zeroY}
            stroke={isLight ? '#cbd5e1' : '#334155'}
            strokeDasharray="4 4"
            strokeWidth="1"
          />

          {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}
          {coords.length > 1 && (
            <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          )}

          {coords.map((c) => (
            <g key={c.pt.index}>
              <circle cx={c.x} cy={c.y} r="3.5" fill={strokeColor} />
              <title>{`${c.pt.label} | ${c.pt.symbol}: ${c.pt.tradePnl >= 0 ? '+' : ''}$${c.pt.tradePnl.toFixed(2)} (Cum: ${c.pt.cumulativePnl >= 0 ? '+' : ''}$${c.pt.cumulativePnl.toFixed(2)})`}</title>
            </g>
          ))}
        </svg>

        <div className={`flex items-center justify-between text-[10px] font-mono px-2 pt-1 ${isLight ? 'text-slate-500' : 'text-slate-500'}`}>
          <span>Start: {points[0].label}</span>
          <span>Peak: {maxVal >= 0 ? `+$${maxVal.toFixed(2)}` : `-$${Math.abs(maxVal).toFixed(2)}`}</span>
          <span>Latest: {points[points.length - 1].label}</span>
        </div>
      </div>
    </div>
  );
};
