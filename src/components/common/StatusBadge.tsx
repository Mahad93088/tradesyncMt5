import React from 'react';
import { ConnectionStatus, SubscriptionStatus, AccountStatus, CopyLinkStatus, MappingExecutionStatus } from '../../types';

interface StatusBadgeProps {
  status: ConnectionStatus | SubscriptionStatus | AccountStatus | CopyLinkStatus | MappingExecutionStatus | string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const s = status.toLowerCase();
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs font-medium';

  let colorClasses = 'bg-slate-800/80 text-slate-300 border-slate-700/80';
  let dotColor = 'bg-slate-400';

  if (s === 'connected' || s === 'active' || s === 'executed' || s === 'running' || s === 'healthy') {
    colorClasses = 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50';
    dotColor = 'bg-emerald-400';
  } else if (s === 'disconnected' || s === 'paused' || s === 'standby' || s === 'degraded' || s === 'pending') {
    colorClasses = 'bg-amber-950/40 text-amber-300 border-amber-800/50';
    dotColor = 'bg-amber-400';
  } else if (
    s === 'error' ||
    s === 'suspended' ||
    s === 'expired' ||
    s === 'failed' ||
    s === 'rejected_margin' ||
    s === 'rejected_off_quotes' ||
    s === 'slippage_exceeded' ||
    s === 'critical'
  ) {
    colorClasses = 'bg-rose-950/40 text-rose-300 border-rose-800/50';
    dotColor = 'bg-rose-400';
  } else if (s === 'connecting' || s === 'retried' || s === 'trial') {
    colorClasses = 'bg-sky-950/40 text-sky-300 border-sky-800/50';
    dotColor = 'bg-sky-400';
  } else if (s === 'cancelled' || s === 'unlinked') {
    colorClasses = 'bg-slate-900 text-slate-400 border-slate-800';
    dotColor = 'bg-slate-500';
  }

  // Format label
  const label = status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border ${colorClasses} ${sizeClasses}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      <span>{label}</span>
    </span>
  );
};
