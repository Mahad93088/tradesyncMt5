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
  };
}

export function mapDbTradeToTrade(t: any): Trade {
  return {
    id: t.id,
    ticket: String(t.ticket),
    accountId: t.account_id,
    symbol: t.symbol,
    type: t.type,
    lots: Number(t.volume) || 0,
    openPrice: Number(t.open_price) || 0,
    closePrice: t.close_price != null ? Number(t.close_price) : undefined,
    sl: t.sl != null ? Number(t.sl) : undefined,
    tp: t.tp != null ? Number(t.tp) : undefined,
    currentPrice: Number(t.close_price ?? t.open_price) || 0,
    profit: Number(t.profit) || 0,
    openTime: t.open_time || t.created_at || new Date().toISOString(),
    closeTime: t.close_time || undefined,
    status: t.status || 'OPEN',
    comment: t.notes || undefined,
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

    const childRealTrades = childAccId ? realTrades.filter((t) => t.accountId === childAccId) : [];
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
      status: a.status === 'active' ? 'active' : 'paused',
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
        fixedLot: Number(a.fixed_lot || 0.1),
        multiplier: Number(a.lot_multiplier || 1.0),
        riskPercent: 1.0,
        maxLotCap: 50,
        minLotClamp: 0.01,
        maxDrawdownProtectionPercent: 20,
        copyPendingOrders: true,
        syncSlTp: true,
        slippageMaxPips: 30,
      },
      linkedAt: a.assigned_at || new Date().toISOString(),
      totalTradesCopied: copiedCount,
      totalProfitUSD,
      totalProfitAvailable,
      lastSyncAt: a.assigned_at || new Date().toISOString(),
    };
  });
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
