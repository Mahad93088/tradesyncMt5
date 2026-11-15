import type { LotSettings, ParentChildLink, Trade } from '../../types';

export function getDeterministicInviteCode(userId?: string | null): string {
  const clean = String(userId || '').trim();
  if (!clean) return 'TS-UNASSIGNED';
  return `TS-${clean.slice(0, 8).toUpperCase()}`;
}

export function formatLotRuleLabel(settings?: LotSettings | null): string {
  if (!settings) return '1:1 Direct';
  if (settings.mode === 'parent_lot') return '1:1 Direct';
  switch (settings.customType) {
    case 'fixed':
      return `FIXED (${Number(settings.fixedLot || 0.1).toFixed(2)}L)`;
    case 'multiplier':
      return `MULTIPLIER (${Number(settings.multiplier || 1.0)}x)`;
    case 'equity_ratio':
      return 'EQUITY RATIO';
    case 'risk_percent':
      return `RISK % (${Number(settings.riskPercent || 1.0)}%)`;
    default:
      return 'CUSTOM LOT';
  }
}

export function formatLinkProfitDisplay(
  link: Pick<ParentChildLink, 'totalProfitUSD' | 'totalProfitAvailable'>,
  isCloudMode: boolean
): { text: string; available: boolean; isPositive: boolean } {
  if (isCloudMode && !link.totalProfitAvailable) {
    return {
      text: 'Deal P&L awaiting EA sync',
      available: false,
      isPositive: true,
    };
  }
  const val = Number(link.totalProfitUSD || 0);
  const sign = val >= 0 ? '+' : '-';
  return {
    text: `${sign}$${Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    available: true,
    isPositive: val >= 0,
  };
}

export function formatTradeProfitDisplay(
  trade: Pick<Trade, 'profit' | 'isMappingFallback'>,
  isCloudMode: boolean
): { text: string; available: boolean; isPositive: boolean } {
  if (isCloudMode && trade.isMappingFallback) {
    return {
      text: 'Awaiting EA sync',
      available: false,
      isPositive: true,
    };
  }
  const val = Number(trade.profit || 0);
  const sign = val >= 0 ? '+' : '-';
  return {
    text: `${sign}$${Math.abs(val).toFixed(2)}`,
    available: true,
    isPositive: val >= 0,
  };
}

export function formatHeartbeatAge(lastHeartbeat?: string | null): string {
  if (!lastHeartbeat) return 'No heartbeat';
  const ms = Date.parse(lastHeartbeat);
  if (!Number.isFinite(ms)) return 'No heartbeat';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(ms).toLocaleDateString();
}
