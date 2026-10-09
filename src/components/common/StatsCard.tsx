import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  accentColor?: 'blue' | 'teal' | 'emerald' | 'amber' | 'rose' | 'slate';
  isDemo?: boolean;
  onClick?: () => void;
}

export const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  accentColor = 'blue',
  isDemo = false,
  onClick
}) => {
  const colorMap = {
    blue: {
      border: 'border-slate-800 hover:border-sky-500/40',
      iconBg: 'bg-sky-950/50 text-sky-400 border border-sky-800/40'
    },
    teal: {
      border: 'border-slate-800 hover:border-teal-500/40',
      iconBg: 'bg-teal-950/50 text-teal-400 border border-teal-800/40'
    },
    emerald: {
      border: 'border-slate-800 hover:border-emerald-500/40',
      iconBg: 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/40'
    },
    amber: {
      border: 'border-slate-800 hover:border-amber-500/40',
      iconBg: 'bg-amber-950/50 text-amber-400 border border-amber-800/40'
    },
    rose: {
      border: 'border-slate-800 hover:border-rose-500/40',
      iconBg: 'bg-rose-950/50 text-rose-400 border border-rose-800/40'
    },
    slate: {
      border: 'border-slate-800 hover:border-slate-700',
      iconBg: 'bg-slate-800 text-slate-300 border border-slate-700'
    }
  };

  const scheme = colorMap[accentColor] || colorMap.blue;

  return (
    <div
      onClick={onClick}
      className={`relative rounded-xl border bg-slate-900/90 p-4 shadow-sm transition-all duration-150 ${
        scheme.border
      } ${onClick ? 'cursor-pointer hover:bg-slate-900' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium tracking-wider text-slate-400 uppercase">
              {title}
            </span>
            {isDemo && (
              <span className="rounded bg-slate-800 px-1 py-0.2 text-[9px] font-mono text-slate-400">
                Demo
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tracking-tight text-slate-100">
              {value}
            </span>
            {trend && (
              <span
                className={`inline-flex items-center text-xs font-medium font-mono ${
                  trend.isPositive ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {trend.isPositive ? '↑' : '↓'} {trend.value}
              </span>
            )}
          </div>
          {subtitle && <p className="text-[11px] text-slate-400 leading-normal">{subtitle}</p>}
        </div>
        <div className={`rounded-lg p-2.5 shrink-0 ${scheme.iconBg}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
};
