import React, { useState } from 'react';
import { LucideIcon, Info, AlertTriangle, CheckCircle2, ShieldAlert, Database } from 'lucide-react';

interface AdminPageHeaderProps {
  title: string;
  description: string;
  badge?: string;
  badgeTone?: 'neutral' | 'emerald' | 'amber' | 'sky' | 'rose';
  actions?: React.ReactNode;
}

export const AdminPageHeader: React.FC<AdminPageHeaderProps> = ({
  title,
  description,
  badge,
  badgeTone = 'neutral',
  actions
}) => {
  const toneClass =
    badgeTone === 'emerald'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : badgeTone === 'amber'
      ? 'bg-amber-50 text-amber-800 border-amber-200'
      : badgeTone === 'sky'
      ? 'bg-sky-50 text-sky-700 border-sky-200'
      : badgeTone === 'rose'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : 'bg-slate-100 text-slate-700 border-slate-200';

  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-xs">
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">{title}</h1>
          {badge && (
            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-mono font-semibold ${toneClass}`}>
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">{description}</p>
      </div>
      {actions && <div className="flex items-center flex-wrap gap-2 shrink-0">{actions}</div>}
    </div>
  );
};

interface AdminKpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  meta?: string;
  icon: LucideIcon;
  tone?: 'slate' | 'sky' | 'emerald' | 'amber' | 'rose' | 'indigo';
  onClick?: () => void;
}

export const AdminKpiCard: React.FC<AdminKpiCardProps> = ({
  title,
  value,
  subtitle,
  meta,
  icon: Icon,
  tone = 'slate',
  onClick
}) => {
  const iconTone =
    tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
      : tone === 'amber'
      ? 'bg-amber-50 text-amber-600 border-amber-200'
      : tone === 'rose'
      ? 'bg-rose-50 text-rose-600 border-rose-200'
      : tone === 'sky'
      ? 'bg-sky-50 text-sky-600 border-sky-200'
      : tone === 'indigo'
      ? 'bg-indigo-50 text-indigo-600 border-indigo-200'
      : 'bg-slate-100 text-slate-600 border-slate-200';

  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition-colors ${
        onClick ? 'cursor-pointer hover:border-slate-300 hover:bg-slate-50/60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</span>
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${iconTone}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-2xl font-bold tracking-tight text-slate-900 font-mono tabular-nums">{value}</span>
        {meta && <span className="text-[11px] font-mono font-medium text-slate-500">{meta}</span>}
      </div>
      {subtitle && <p className="mt-1.5 text-[11px] text-slate-600 truncate">{subtitle}</p>}
    </div>
  );
};

interface AdminNoticeBannerProps {
  variant: 'info' | 'warning' | 'success' | 'error' | 'not_configured';
  title?: string;
  message: React.ReactNode;
  rightBadge?: string;
  action?: React.ReactNode;
}

export const AdminNoticeBanner: React.FC<AdminNoticeBannerProps> = ({
  variant,
  title,
  message,
  rightBadge,
  action
}) => {
  const styles =
    variant === 'success'
      ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
      : variant === 'warning' || variant === 'not_configured'
      ? 'border-amber-200 bg-amber-50/80 text-amber-950'
      : variant === 'error'
      ? 'border-rose-200 bg-rose-50/80 text-rose-950'
      : 'border-slate-200 bg-white text-slate-700';

  const IconComp =
    variant === 'success'
      ? CheckCircle2
      : variant === 'warning'
      ? AlertTriangle
      : variant === 'not_configured'
      ? Database
      : variant === 'error'
      ? ShieldAlert
      : Info;

  const iconColor =
    variant === 'success'
      ? 'text-emerald-600'
      : variant === 'warning' || variant === 'not_configured'
      ? 'text-amber-600'
      : variant === 'error'
      ? 'text-rose-600'
      : 'text-sky-600';

  return (
    <div className={`rounded-xl border px-4 py-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${styles}`}>
      <div className="flex items-start gap-2.5 min-w-0">
        <IconComp className={`h-4 w-4 shrink-0 mt-0.5 ${iconColor}`} />
        <div className="space-y-0.5 min-w-0">
          {title && <div className="font-semibold text-slate-900">{title}</div>}
          <div className="leading-relaxed opacity-90">{message}</div>
        </div>
      </div>
      {(rightBadge || action) && (
        <div className="flex items-center gap-2 shrink-0">
          {rightBadge && (
            <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-mono font-medium text-slate-700">
              {rightBadge}
            </span>
          )}
          {action}
        </div>
      )}
    </div>
  );
};

interface AdminBarDatum {
  label: string;
  value: number;
  secondaryValue?: number;
  color?: string;
  secondaryColor?: string;
}

interface AdminBarChartProps {
  title: string;
  subtitle?: string;
  data: AdminBarDatum[];
  primaryLabel?: string;
  secondaryLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  valuePrefix?: string;
  valueSuffix?: string;
}

export const AdminBarChart: React.FC<AdminBarChartProps> = ({
  title,
  subtitle,
  data,
  primaryLabel = 'Primary',
  secondaryLabel,
  emptyTitle = 'No data available',
  emptyDescription = 'No records recorded in the active dataset.',
  valuePrefix = '',
  valueSuffix = ''
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const maxVal = Math.max(
    1,
    ...data.map((d) => Math.max(d.value, d.secondaryValue || 0))
  );
  const hasAnyPositive = data.some((d) => d.value > 0 || (d.secondaryValue || 0) > 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs flex flex-col justify-between">
      <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {secondaryLabel && (
          <div className="flex items-center gap-3 text-[10px] font-medium text-slate-600 shrink-0">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-xs bg-sky-600" />
              {primaryLabel}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-xs bg-emerald-500" />
              {secondaryLabel}
            </span>
          </div>
        )}
      </div>

      {data.length === 0 || !hasAnyPositive ? (
        <div className="py-10 text-center space-y-1">
          <p className="text-xs font-semibold text-slate-700">{emptyTitle}</p>
          <p className="text-[11px] text-slate-500 max-w-xs mx-auto">{emptyDescription}</p>
        </div>
      ) : (
        <div className="pt-4">
          <div className="relative h-40 flex items-end gap-2 px-1">
            {data.map((item, idx) => {
              const primaryH = Math.max(4, Math.round((item.value / maxVal) * 124));
              const secondaryH =
                item.secondaryValue !== undefined
                  ? Math.max(item.secondaryValue > 0 ? 4 : 0, Math.round((item.secondaryValue / maxVal) * 124))
                  : 0;
              const isHovered = hoverIdx === idx;

              return (
                <div
                  key={item.label}
                  onMouseEnter={() => setHoverIdx(idx)}
                  onMouseLeave={() => setHoverIdx(null)}
                  className="flex-1 flex flex-col items-center justify-end gap-1.5 relative group cursor-default"
                >
                  {isHovered && (
                    <div className="absolute -top-7 z-10 whitespace-nowrap rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-mono text-white shadow-md">
                      {item.label}: {valuePrefix}{item.value.toLocaleString()}{valueSuffix}
                      {item.secondaryValue !== undefined
                        ? ` / ${valuePrefix}${item.secondaryValue.toLocaleString()}${valueSuffix}`
                        : ''}
                    </div>
                  )}
                  <div className="w-full flex items-end justify-center gap-1 h-32">
                    <div
                      className={`w-full max-w-[20px] rounded-t-sm transition-all ${
                        item.color || 'bg-sky-600'
                      } ${isHovered ? 'opacity-100' : 'opacity-85'}`}
                      style={{ height: `${item.value === 0 ? 2 : primaryH}px` }}
                    />
                    {item.secondaryValue !== undefined && (
                      <div
                        className={`w-full max-w-[20px] rounded-t-sm transition-all ${
                          item.secondaryColor || 'bg-emerald-500'
                        } ${isHovered ? 'opacity-100' : 'opacity-85'}`}
                        style={{ height: `${item.secondaryValue === 0 ? 2 : secondaryH}px` }}
                      />
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 truncate max-w-full">
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

interface DonutSegment {
  label: string;
  value: number;
  stroke: string;
  dot: string;
}

interface AdminDonutChartProps {
  title: string;
  subtitle?: string;
  segments: DonutSegment[];
  centerLabel: string;
  emptyLabel?: string;
}

export const AdminDonutChart: React.FC<AdminDonutChartProps> = ({
  title,
  subtitle,
  segments,
  centerLabel,
  emptyLabel = 'No active records'
}) => {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  let offsetAccum = 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs flex flex-col justify-between">
      <div className="pb-3 border-b border-slate-100">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">{title}</h3>
        {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>

      {total === 0 ? (
        <div className="py-10 text-center text-xs text-slate-500">{emptyLabel}</div>
      ) : (
        <div className="pt-4 flex flex-col sm:flex-row items-center gap-5">
          <div className="relative h-28 w-28 shrink-0 flex items-center justify-center">
            <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke="#F1F5F9"
                strokeWidth="12"
              />
              {segments
                .filter((s) => s.value > 0)
                .map((seg) => {
                  const pct = seg.value / total;
                  const dash = pct * circumference;
                  const currentOffset = offsetAccum;
                  offsetAccum += dash;
                  return (
                    <circle
                      key={seg.label}
                      cx="50"
                      cy="50"
                      r={radius}
                      fill="none"
                      stroke={seg.stroke}
                      strokeWidth="12"
                      strokeDasharray={`${dash} ${circumference - dash}`}
                      strokeDashoffset={-currentOffset}
                    />
                  );
                })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-lg font-bold font-mono tabular-nums text-slate-900">{total}</span>
              <span className="text-[10px] font-medium text-slate-500 uppercase">{centerLabel}</span>
            </div>
          </div>

          <div className="flex-1 w-full space-y-2">
            {segments.map((seg) => {
              const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
              return (
                <div key={seg.label} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${seg.dot}`} />
                    <span className="text-slate-700 truncate">{seg.label}</span>
                  </div>
                  <div className="font-mono tabular-nums text-slate-900 font-semibold shrink-0">
                    {seg.value} <span className="text-slate-400 font-normal text-[10px]">({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

interface AdminEmptyChartProps {
  title: string;
  subtitle?: string;
  badgeText?: string;
  message: string;
}

export const AdminEmptyChart: React.FC<AdminEmptyChartProps> = ({
  title,
  subtitle,
  badgeText = 'Not Configured',
  message
}) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs flex flex-col justify-between">
    <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">{title}</h3>
        {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-mono font-semibold text-amber-800 shrink-0">
        {badgeText}
      </span>
    </div>
    <div className="py-10 px-4 text-center space-y-1.5">
      <Database className="h-6 w-6 text-slate-300 mx-auto" />
      <p className="text-xs font-semibold text-slate-700">{badgeText}</p>
      <p className="text-[11px] text-slate-500 max-w-xs mx-auto leading-relaxed">{message}</p>
    </div>
  </div>
);
