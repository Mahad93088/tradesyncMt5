import type {
  MT5Account,
  ParentChildLink,
  Trade,
  TradeMapping,
  SyncLog,
  AuditLog,
  PlatformNotification,
  UserRole,
} from '../types';

export function mapServerAccountToMT5Account(acc: any): MT5Account {
  return {
    id: acc.id,
    userId: acc.user_id,
    accountRole: acc.account_role === 'parent' ? 'parent' : 'child',
    accountNumber: String(acc.account_number),
    broker: acc.broker_name || 'MetaTrader 5',
    server: acc.broker_server || '',
    accountType: acc.account_type === 'live' ? 'live' : 'demo',
    balance: Number(acc.balance) || 0,
    equity: Number(acc.equity) || 0,
    margin: Number(acc.margin) || 0,
    freeMargin: Number(acc.free_margin) || 0,
    currency: acc.currency || 'USD',
    leverage: Number(acc.leverage) || 100,
    connectionStatus: acc.connection_status || 'disconnected',
    isInvestorPassword: Boolean(acc.is_investor_password),
    autoTradingEnabled: Boolean(acc.auto_trading_enabled),
    pingMs: Number(acc.ping_ms) || 0,
    lastHeartbeat: acc.last_sync || acc.created_at || '',
    lastStatusUpdate: acc.last_sync || acc.created_at || undefined,
    errorMessage: acc.error_message || undefined,
    isStale: Boolean(acc.is_stale),
    brokerId: acc.broker_id || null,
    tradingSymbol: acc.trading_symbol || undefined,
    symbolVerified: Boolean(acc.symbol_verified),
    verifiedBalance: acc.verified_balance != null ? Number(acc.verified_balance) : null,
    verifiedEquity: acc.verified_equity != null ? Number(acc.verified_equity) : null,
    balanceVerifiedAt: acc.balance_verified_at || null,
    verifiedSymbolSpecs:
      acc.verified_symbol_specs && typeof acc.verified_symbol_specs === 'object'
        ? acc.verified_symbol_specs
        : undefined,
  };
}

export function mapDbTradeToTrade(t: any): Trade {
  const isRealized = t.is_realized !== undefined ? Boolean(t.is_realized) : t.profit != null;
  return {
    id: t.id,
    ticket: String(t.ticket),
    accountId: t.account_id,
    symbol: t.symbol,
    type: t.type,
    lots: Number(t.volume) || 0,
    requestedVolume: t.requested_volume != null ? Number(t.requested_volume) : undefined,
    openPrice: Number(t.open_price) || 0,
    closePrice: t.close_price != null ? Number(t.close_price) : undefined,
    sl: t.sl != null ? Number(t.sl) : undefined,
    tp: t.tp != null ? Number(t.tp) : undefined,
    currentPrice: Number(t.close_price ?? t.open_price) || 0,
    profit: t.profit != null ? Number(t.profit) : 0,
    openTime: t.open_time || t.created_at || new Date().toISOString(),
    closeTime: t.close_time || undefined,
    status: t.status || 'OPEN',
    comment: t.notes || undefined,
    parentTicket: t.parent_ticket != null ? String(t.parent_ticket) : undefined,
    executionStatus: t.execution_status || undefined,
    rejectionReason: t.rejection_reason || undefined,
    isRealized,
    commission: t.commission != null ? Number(t.commission) : undefined,
    swap: t.swap != null ? Number(t.swap) : undefined,
    pips: t.pips != null ? Number(t.pips) : undefined,
    isMappingFallback: false,
  };
}

export function buildCloudTrades(dbTradesRaw: any[], mappingsList: TradeMapping[]): Trade[] {
  const realTrades = (dbTradesRaw || []).map(mapDbTradeToTrade);
  const existingKeys = new Set(realTrades.map((t) => `${t.accountId}:${String(t.ticket)}`));

  const fallbackTrades: Trade[] = [];
  for (const m of mappingsList || []) {
    if (m.status !== 'EXECUTED' && m.status !== 'CLOSED' && m.status !== 'PENDING') continue;
    const ticketVal =
      m.childTradeTicket && m.childTradeTicket !== '0' && m.childTradeTicket !== 0
        ? String(m.childTradeTicket)
        : String(m.parentTradeTicket);
    const key = `${m.childAccountId}:${ticketVal}`;
    if (existingKeys.has(key)) continue;

    fallbackTrades.push({
      id: m.id,
      ticket: ticketVal,
      accountId: m.childAccountId,
      symbol: m.symbol,
      type: m.orderType,
      lots: m.childLots,
      openPrice: 0,
      currentPrice: 0,
      profit: 0,
      openTime: m.openTime,
      status: m.status === 'CLOSED' ? 'CLOSED' : m.status === 'EXECUTED' ? 'OPEN' : 'PENDING',
      comment: `Parent #${m.parentTradeTicket}`,
      isMappingFallback: true,
    });
  }

  return [...realTrades, ...fallbackTrades];
}

export function mapAssignmentsToLinks(
  assignments: any[],
  profilesList: any[],
  mappingsList: TradeMapping[] = [],
  dbTrades: Trade[] = []
): ParentChildLink[] {
  const profMap = new Map<string, any>((profilesList || []).map((p: any) => [p.id, p]));
  const realTrades = (dbTrades || []).filter((t) => !t.isMappingFallback);

  return (assignments || []).map((a: any) => {
    const mentorProf = profMap.get(a.mentor_id);
    const traderProf = profMap.get(a.trader_id);
    const lotMode = String(a.lot_mode || 'parent_lot').toLowerCase();
    const isFixed = lotMode === 'fixed' || lotMode === 'fixed_lot';
    const isMult = lotMode === 'multiplier';

    const parentAccId = a.parent_account_id || '';
    const childAccId = a.child_account_id || '';

    const copiedCount = (mappingsList || []).filter((m) => {
      const accMatch =
        (parentAccId && childAccId && m.parentAccountId === parentAccId && m.childAccountId === childAccId) ||
        (m.mentorId === a.mentor_id && m.traderId === a.trader_id);
      return accMatch && (m.status === 'EXECUTED' || m.status === 'CLOSED');
    }).length;

    const childRealTrades = childAccId
      ? realTrades.filter((t) => t.accountId === childAccId && t.isRealized !== false)
      : [];
    const totalProfitAvailable = childRealTrades.length > 0;
    const totalProfitUSD = totalProfitAvailable
      ? Number(childRealTrades.reduce((sum, t) => sum + (Number(t.profit) || 0), 0).toFixed(2))
      : 0;

    return {
      id: a.id,
      mentorId: a.mentor_id,
      traderId: a.trader_id,
      mentorName: mentorProf?.full_name || mentorProf?.email || 'Verified Mentor',
      traderName: traderProf?.full_name || traderProf?.email || 'Trader Follower',
      parentAccountId: parentAccId,
      childAccountId: childAccId,
      groupId: a.group_id || null,
      status:
        a.status === 'active'
          ? 'active'
          : a.status === 'suspended'
          ? 'suspended'
          : 'paused',
      lotSettings: {
        mode:
          isFixed || isMult || lotMode === 'equity_ratio' || lotMode === 'risk_percent'
            ? 'custom_lot'
            : 'parent_lot',
        customType: isFixed
          ? 'fixed'
          : lotMode === 'equity_ratio'
          ? 'equity_ratio'
          : lotMode === 'risk_percent'
          ? 'risk_percent'
          : 'multiplier',
        fixedLot: Number(a.fixed_lot ?? 0.1),
        multiplier: Number(a.lot_multiplier ?? 1.0),
        riskPercent: Number(a.risk_percent ?? 1.0),
        maxLotCap: Number(a.max_lot_cap ?? 50),
        minLotClamp: Number(a.min_lot_clamp ?? 0.01),
        maxDrawdownProtectionPercent: Number(a.max_drawdown_percent ?? 20),
        copyPendingOrders: a.copy_pending_orders !== undefined ? Boolean(a.copy_pending_orders) : false,
        syncSlTp: a.sync_sl_tp !== undefined ? Boolean(a.sync_sl_tp) : true,
        slippageMaxPips: Number(a.slippage_max_pips ?? 30),
        symbolPrefix: a.symbol_prefix ? String(a.symbol_prefix) : '',
        symbolSuffix: a.symbol_suffix ? String(a.symbol_suffix) : '',
      },
      linkedAt: a.assigned_at || new Date().toISOString(),
      totalTradesCopied: copiedCount,
      totalProfitUSD,
      totalProfitAvailable,
      lastSyncAt: a.assigned_at || new Date().toISOString(),
      membershipStatus: a.membership_status || 'active',
      membershipPriceUsd: a.membership_price_usd != null ? Number(a.membership_price_usd) : 0,
      billingPeriod: a.billing_period || 'monthly',
      suspendedBy: a.suspended_by || null,
      suspendedAt: a.suspended_at || null,
      suspensionReason: a.suspension_reason || null,
      balancePauseActive: Boolean(a.balance_pause_active),
      pauseReason: a.pause_reason || null,
      pausedAt: a.paused_at || null,
      resumedAt: a.resumed_at || null,
      activatedAt: a.activated_at || null,
      activationEpoch: a.activation_epoch != null ? Number(a.activation_epoch) : 1,
    };
  });
}

export interface ReportingSummary {
  totalBalance: number;
  totalEquity: number;
  totalFreeMargin: number;
  openTradesCount: number;
  closedTradesCount: number;
  realizedClosedCount: number;
  realizedPnlAvailable: boolean;
  realizedPnlUSD: number;
  floatingPnlAvailable: boolean;
  floatingPnlUSD: number;
  winRatePercent: number | null;
  profitFactor: number | null;
  dailyRealizedUSD: number | null;
  weeklyRealizedUSD: number | null;
  monthlyRealizedUSD: number | null;
  avgCopyLatencyMs: number | null;
  executedCopiesCount: number;
  failedCopiesCount: number;
}

export function computeReportingSummary(params: {
  trades: Trade[];
  mappings: TradeMapping[];
  accounts: MT5Account[];
  isCloudMode: boolean;
  nowMs?: number;
}): ReportingSummary {
  const { trades, mappings, accounts, isCloudMode } = params;
  const now = params.nowMs ?? Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const sevenDaysMs = 7 * oneDayMs;
  const thirtyDaysMs = 30 * oneDayMs;

  const totalBalance = Number(accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0).toFixed(2));
  const totalEquity = Number(accounts.reduce((s, a) => s + (Number(a.equity) || 0), 0).toFixed(2));
  const totalFreeMargin = Number(accounts.reduce((s, a) => s + (Number(a.freeMargin) || 0), 0).toFixed(2));

  const realTrades = trades.filter((t) => !t.isMappingFallback);
  const openTrades = realTrades.filter((t) => t.status === 'OPEN' || t.status === 'PENDING');
  const closedTrades = realTrades.filter((t) => t.status === 'CLOSED');
  const realizedClosedTrades = closedTrades.filter((t) => !isCloudMode || t.isRealized !== false);

  const realizedPnlAvailable = realizedClosedTrades.length > 0;
  const realizedPnlUSD = realizedPnlAvailable
    ? Number(realizedClosedTrades.reduce((s, t) => s + (Number(t.profit) || 0), 0).toFixed(2))
    : 0;

  const realizedOpenTrades = openTrades.filter((t) => !isCloudMode || t.isRealized === true);
  const floatingPnlAvailable = realizedOpenTrades.length > 0;
  const floatingPnlUSD = floatingPnlAvailable
    ? Number(realizedOpenTrades.reduce((s, t) => s + (Number(t.profit) || 0), 0).toFixed(2))
    : 0;

  let winRatePercent: number | null = null;
  let profitFactor: number | null = null;
  let dailyRealizedUSD: number | null = null;
  let weeklyRealizedUSD: number | null = null;
  let monthlyRealizedUSD: number | null = null;

  if (realizedClosedTrades.length > 0) {
    const wins = realizedClosedTrades.filter((t) => Number(t.profit) > 0);
    const losses = realizedClosedTrades.filter((t) => Number(t.profit) < 0);
    winRatePercent = Number(((wins.length / realizedClosedTrades.length) * 100).toFixed(1));

    const grossProfit = wins.reduce((s, t) => s + Number(t.profit), 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + Number(t.profit), 0));
    if (grossLoss > 0) {
      profitFactor = Number((grossProfit / grossLoss).toFixed(2));
    } else if (grossProfit > 0) {
      profitFactor = Number(grossProfit.toFixed(2));
    } else {
      profitFactor = 0;
    }

    let daily = 0;
    let weekly = 0;
    let monthly = 0;
    for (const t of realizedClosedTrades) {
      const ts = Date.parse(t.closeTime || t.openTime || '');
      if (!Number.isFinite(ts)) continue;
      const age = now - ts;
      const val = Number(t.profit) || 0;
      if (age <= oneDayMs) daily += val;
      if (age <= sevenDaysMs) weekly += val;
      if (age <= thirtyDaysMs) monthly += val;
    }
    dailyRealizedUSD = Number(daily.toFixed(2));
    weeklyRealizedUSD = Number(weekly.toFixed(2));
    monthlyRealizedUSD = Number(monthly.toFixed(2));
  }

  const executedMappings = mappings.filter((m) => m.status === 'EXECUTED' || m.status === 'CLOSED');
  const failedMappings = mappings.filter((m) =>
    ['FAILED', 'REJECTED_MARGIN', 'REJECTED_OFF_QUOTES', 'SLIPPAGE_EXCEEDED', 'SKIPPED_LOT_LIMIT'].includes(m.status)
  );
  const measuredLatencies = executedMappings
    .map((m) => Number(m.latencyMs))
    .filter((ms) => Number.isFinite(ms) && ms > 0);
  const avgCopyLatencyMs =
    measuredLatencies.length > 0
      ? Math.round(measuredLatencies.reduce((s, v) => s + v, 0) / measuredLatencies.length)
      : null;

  return {
    totalBalance,
    totalEquity,
    totalFreeMargin,
    openTradesCount: openTrades.length,
    closedTradesCount: closedTrades.length,
    realizedClosedCount: realizedClosedTrades.length,
    realizedPnlAvailable,
    realizedPnlUSD,
    floatingPnlAvailable,
    floatingPnlUSD,
    winRatePercent,
    profitFactor,
    dailyRealizedUSD,
    weeklyRealizedUSD,
    monthlyRealizedUSD,
    avgCopyLatencyMs,
    executedCopiesCount: executedMappings.length,
    failedCopiesCount: failedMappings.length,
  };
}

export function buildCloudAuditLogs(logs: SyncLog[]): AuditLog[] {
  return (logs || [])
    .filter((l) => {
      const ev = String(l.eventType || '').toUpperCase();
      return (
        ev.startsWith('ADMIN_') ||
        ev.startsWith('ASSIGNMENT_') ||
        ev.startsWith('MT5_ACCOUNT_') ||
        ev.startsWith('MENTOR_') ||
        l.level === 'error'
      );
    })
    .map((l) => ({
      id: `audit_${l.id}`,
      timestamp: l.timestamp,
      actorId: 'supabase-bridge',
      actorName: l.eventType.startsWith('ADMIN_') ? 'Super Admin' : 'Bridge Engine',
      actorRole: (l.eventType.startsWith('ADMIN_') ? 'admin' : 'mentor') as UserRole,
      action: l.eventType,
      targetResource: l.ticket ? `Ticket #${l.ticket}` : 'Bridge Platform',
      targetId: l.ticket != null ? String(l.ticket) : undefined,
      result: l.level === 'error' ? 'failure' : l.level === 'warn' ? 'warning' : 'success',
      details: l.details,
    }));
}

export function buildCloudNotifications(logs: SyncLog[], userRole: UserRole): PlatformNotification[] {
  return (logs || [])
    .filter((l) => l.level === 'error' || l.level === 'warn' || l.eventType.startsWith('ADMIN_'))
    .slice(0, 15)
    .map((l) => ({
      id: `notif_${l.id}`,
      targetRole: userRole,
      title: l.eventType.replace(/_/g, ' '),
      message: l.details,
      type: l.level === 'error' ? 'error' : l.level === 'warn' ? 'warning' : 'info',
      timestamp: l.timestamp,
      read: false,
    }));
}
