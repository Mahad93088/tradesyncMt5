import React from 'react';
import { LucideIcon, AlertCircle, CheckCircle2, AlertTriangle, Clock, Info, ShieldAlert } from 'lucide-react';

interface AdminPageHeaderProps {
  title: string;
  subtitle: string;
  meta?: string;
  actions?: React.ReactNode;
}

export const AdminPageHeader: React.FC<AdminPageHeaderProps> = ({
  title,
  subtitle,
  meta,
  actions,
}) => {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
      <div className="min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
          {meta && (
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {meta}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-600 leading-relaxed">{subtitle}</p>
      </div>
      {actions && (
        <div className="flex items-center flex-wrap gap-2 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
};

interface AdminStatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  tone?: 'neutral' | 'blue' | 'emerald' | 'amber' | 'rose';
  onClick?: () => void;
}

export const AdminStatCard: React.FC<AdminStatCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  tone = 'neutral',
  onClick,
}) => {
  const toneStyles: Record<NonNullable<AdminStatCardProps['tone']>, { iconBox: string; valueText: string }> = {
    neutral: {
      iconBox: 'bg-slate-100 text-slate-600 border-slate-200',
      valueText: 'text-slate-900',
    },
    blue: {
      iconBox: 'bg-sky-50 text-sky-700 border-sky-200',
      valueText: 'text-slate-900',
    },
    emerald: {
      iconBox: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      valueText: 'text-emerald-700',
    },
    amber: {
      iconBox: 'bg-amber-50 text-amber-700 border-amber-200',
      valueText: 'text-amber-700',
    },
    rose: {
      iconBox: 'bg-rose-50 text-rose-700 border-rose-200',
      valueText: 'text-rose-700',
    },
  };

  const scheme = toneStyles[tone];

  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-slate-200 bg-white p-4 transition-colors ${
        onClick ? 'cursor-pointer hover:border-slate-300 hover:bg-slate-50/60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 truncate">
            {title}
          </div>
          <div className={`font-mono text-2xl font-bold tracking-tight tabular-nums ${scheme.valueText}`}>
            {value}
          </div>
          {subtitle && (
            <p className="text-[11px] text-slate-500 leading-snug truncate" title={subtitle}>
              {subtitle}
            </p>
          )}
        </div>
        <div className={`rounded-lg border p-2 shrink-0 ${scheme.iconBox}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
};

interface AdminStatusTextProps {
  status: string;
}

export const AdminStatusText: React.FC<AdminStatusTextProps> = ({ status }) => {
  const s = (status || 'unknown').toLowerCase();

  let colorClass = 'text-slate-600 bg-slate-100 border-slate-200';
  let dotClass = 'bg-slate-400';

  if (
    s === 'connected' ||
    s === 'active' ||
    s === 'executed' ||
    s === 'closed' ||
    s === 'running' ||
    s === 'healthy' ||
    s === 'paid' ||
    s === 'succeeded' ||
    s === 'success' ||
    s === 'verified'
  ) {
    colorClass = 'text-emerald-700 bg-emerald-50 border-emerald-200';
    dotClass = 'bg-emerald-600';
  } else if (
    s === 'disconnected' ||
    s === 'paused' ||
    s === 'standby' ||
    s === 'degraded' ||
    s === 'pending' ||
    s === 'stale' ||
    s === 'trial' ||
    s === 'warning' ||
    s === 'warn' ||
    s === 'retried' ||
    s === 'connecting'
  ) {
    colorClass = 'text-amber-700 bg-amber-50 border-amber-200';
    dotClass = 'bg-amber-600';
  } else if (
    s === 'error' ||
    s === 'suspended' ||
    s === 'expired' ||
    s === 'failed' ||
    s === 'failure' ||
    s === 'rejected_margin' ||
    s === 'rejected_off_quotes' ||
    s === 'slippage_exceeded' ||
    s === 'skipped_lot_limit' ||
    s === 'critical' ||
    s === 'refunded'
  ) {
    colorClass = 'text-rose-700 bg-rose-50 border-rose-200';
    dotClass = 'bg-rose-600';
  }

  const label = status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${colorClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClass}`} />
      <span>{label}</span>
    </span>
  );
};

interface AdminNotConfiguredProps {
  title: string;
  description: string;
  requiredTables?: string[];
  enforcedToday?: string[];
}

export const AdminNotConfiguredBanner: React.FC<AdminNotConfiguredProps> = ({
  title,
  description,
  requiredTables = [],
  enforcedToday = [],
}) => {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-amber-200 bg-white p-2 text-amber-600 shrink-0">
          <AlertCircle className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
            <span className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-mono font-semibold text-amber-800 uppercase">
              Not Configured in Cloud Mode
            </span>
          </div>
          <p className="text-xs text-slate-700 leading-relaxed">{description}</p>
        </div>
      </div>

      {(requiredTables.length > 0 || enforcedToday.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-amber-200/80 text-xs">
          {requiredTables.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-1.5">
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 block">
                Pending Backend Schema
              </span>
              <ul className="space-y-1 font-mono text-[11px] text-slate-700">
                {requiredTables.map((item, idx) => (
                  <li key={idx}>· {item}</li>
                ))}
              </ul>
            </div>
          )}

          {enforcedToday.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-1.5">
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-emerald-700 block">
                Enforced Today
              </span>
              <ul className="space-y-1 text-[11px] text-slate-700">
                {enforcedToday.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface AdminEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export const AdminEmptyState: React.FC<AdminEmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
}) => (
  <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-3">
    <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
      <Icon className="h-5 w-5" />
    </div>
    <div className="space-y-1 max-w-md mx-auto">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="text-xs text-slate-600 leading-relaxed">{description}</p>
    </div>
    {action && <div className="pt-1 flex justify-center">{action}</div>}
  </div>
);

interface AdminBarSeriesItem {
  label: string;
  value: number;
  secondaryValue?: number;
  colorClass?: string;
}

interface AdminDistributionChartProps {
  title: string;
  subtitle?: string;
  items: AdminBarSeriesItem[];
  unit?: string;
  emptyText?: string;
}

export const AdminDistributionChart: React.FC<AdminDistributionChartProps> = ({
  title,
  subtitle,
  items,
  unit = '',
  emptyText = 'No telemetry data recorded yet.',
}) => {
  const maxVal = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((sum, i) => sum + i.value, 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums">
          Total: {total.toLocaleString()}{unit}
        </span>
      </div>

      {total === 0 ? (
        <div className="py-6 text-center text-xs text-slate-500">{emptyText}</div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => {
            const pct = Math.round((item.value / maxVal) * 100);
            const sharePct = total > 0 ? Math.round((item.value / total) * 100) : 0;
            return (
              <div key={item.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{item.label}</span>
                  <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                    <strong className="text-slate-900">{item.value.toLocaleString()}{unit}</strong>
                    <span className="text-slate-400 ml-1.5">({sharePct}%)</span>
                  </span>
                </div>
                <div className="h-2 w-full rounded bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded transition-all duration-300 ${item.colorClass || 'bg-sky-600'}`}
                    style={{ width: `${Math.max(item.value > 0 ? 4 : 0, pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface AdminSparkBarChartProps {
  title: string;
  subtitle?: string;
  points: Array<{ label: string; primary: number; secondary?: number }>;
  primaryLabel: string;
  secondaryLabel?: string;
  valuePrefix?: string;
  notConfiguredText?: string;
}

export const AdminSparkBarChart: React.FC<AdminSparkBarChartProps> = ({
  title,
  subtitle,
  points,
  primaryLabel,
  secondaryLabel,
  valuePrefix = '',
  notConfiguredText,
}) => {
  if (notConfiguredText) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">{title}</h3>
            {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-amber-800">
            Not Configured
          </span>
        </div>
        <div className="py-7 px-3 text-center space-y-1.5">
          <Info className="h-4 w-4 text-amber-600 mx-auto" />
          <p className="text-xs text-slate-600 leading-relaxed">{notConfiguredText}</p>
        </div>
      </div>
    );
  }

  const maxVal = Math.max(
    1,
    ...points.map((p) => Math.max(p.primary, p.secondary || 0))
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-600 shrink-0">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-sky-600" />
            {primaryLabel}
          </span>
          {secondaryLabel && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-emerald-600" />
              {secondaryLabel}
            </span>
          )}
        </div>
      </div>

      {points.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500">
          No historical points recorded yet.
        </div>
      ) : (
        <div className="pt-2">
          <div className="h-32 flex items-end justify-between gap-2 border-b border-slate-200 pb-1">
            {points.map((pt) => {
              const h1 = Math.max(pt.primary > 0 ? 8 : 2, Math.round((pt.primary / maxVal) * 100));
              const h2 =
                pt.secondary !== undefined
                  ? Math.max(pt.secondary > 0 ? 8 : 2, Math.round((pt.secondary / maxVal) * 100))
                  : null;
              return (
                <div
                  key={pt.label}
                  className="flex-1 flex flex-col items-center justify-end h-full group"
                  title={`${pt.label}: ${valuePrefix}${pt.primary.toLocaleString()}${
                    pt.secondary !== undefined ? ` / ${valuePrefix}${pt.secondary.toLocaleString()}` : ''
                  }`}
                >
                  <div className="w-full flex items-end justify-center gap-1 h-full">
                    <div
                      className="w-full max-w-[18px] rounded-t bg-sky-600 group-hover:bg-sky-700 transition-colors"
                      style={{ height: `${h1}%` }}
                    />
                    {h2 !== null && (
                      <div
                        className="w-full max-w-[18px] rounded-t bg-emerald-600 group-hover:bg-emerald-700 transition-colors"
                        style={{ height: `${h2}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2 pt-1.5">
            {points.map((pt) => (
              <div key={pt.label} className="flex-1 text-center font-mono text-[10px] text-slate-500 truncate tabular-nums">
                {pt.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const AdminFeedbackBanner: React.FC<{
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  onDismiss?: () => void;
}> = ({ type, message, onDismiss }) => {
  const styles = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
  };
  const Icon =
    type === 'success'
      ? CheckCircle2
      : type === 'error'
      ? ShieldAlert
      : type === 'warning'
      ? AlertTriangle
      : Clock;

  return (
    <div className={`rounded-xl border px-4 py-3 text-xs flex items-center justify-between gap-3 ${styles[type]}`}>
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="leading-relaxed">{message}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-semibold opacity-70 hover:opacity-100 shrink-0"
        >
          Dismiss
        </button>
      )}
    </div>
  );
};
