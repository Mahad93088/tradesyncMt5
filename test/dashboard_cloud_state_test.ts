import assert from 'node:assert';
import {
  mapServerAccountToMT5Account,
  buildCloudTrades,
  mapAssignmentsToLinks,
  buildCloudAuditLogs,
  buildCloudNotifications,
} from '../src/context/cloudStateUtils.js';
import type { TradeMapping, SyncLog } from '../src/types/index.js';

function runTests() {
  console.log('=== TradeSync MT5 Dashboard Stage 2 Cloud State Tests ===\n');

  // 1. Account mapping preserves is_stale, accurate heartbeat, and pingMs
  const serverAcc = {
    id: 'acc-1',
    user_id: 'user-1',
    account_role: 'child',
    account_number: '88220022',
    broker_name: 'XM',
    broker_server: 'XMGlobal-MT5 7',
    account_type: 'demo',
    balance: 10500,
    equity: 10750,
    margin: 250,
    free_margin: 10500,
    currency: 'USD',
    leverage: 100,
    connection_status: 'disconnected',
    is_stale: true,
    ping_ms: 0,
    last_sync: '2026-11-14T10:00:00.000Z',
    error_message: 'Heartbeat stale (120s since last EA sync)',
    is_investor_password: true,
    auto_trading_enabled: true,
  };
  const mappedAcc = mapServerAccountToMT5Account(serverAcc);
  assert.strictEqual(mappedAcc.isStale, true);
  assert.strictEqual(mappedAcc.pingMs, 0);
  assert.strictEqual(mappedAcc.lastHeartbeat, '2026-11-14T10:00:00.000Z');
  assert.strictEqual(mappedAcc.connectionStatus, 'disconnected');
  console.log('[PASS] 1. mapServerAccountToMT5Account maps isStale, accurate zero ping when offline, and real lastHeartbeat.');

  // 2. buildCloudTrades prefers real DB trades over mapping fallbacks and marks fallback explicitly
  const mappings: TradeMapping[] = [
    {
      id: 'map-1',
      parentTradeTicket: '1001',
      childTradeTicket: '2001',
      mentorId: 'm-1',
      traderId: 't-1',
      parentAccountId: 'p-acc-1',
      childAccountId: 'c-acc-1',
      symbol: 'EURUSD',
      orderType: 'BUY',
      parentLots: 0.2,
      childLots: 0.3,
      openTime: '2026-11-14T10:05:00.000Z',
      latencyMs: 32,
      status: 'EXECUTED',
      retryCount: 0,
    },
    {
      id: 'map-2',
      parentTradeTicket: '1002',
      childTradeTicket: '2002',
      mentorId: 'm-1',
      traderId: 't-1',
      parentAccountId: 'p-acc-1',
      childAccountId: 'c-acc-1',
      symbol: 'XAUUSD',
      orderType: 'SELL',
      parentLots: 0.1,
      childLots: 0.15,
      openTime: '2026-11-14T10:06:00.000Z',
      latencyMs: 41,
      status: 'CLOSED',
      retryCount: 0,
    },
    {
      id: 'map-fail',
      parentTradeTicket: '1003',
      childTradeTicket: '0',
      mentorId: 'm-1',
      traderId: 't-1',
      parentAccountId: 'p-acc-1',
      childAccountId: 'c-acc-1',
      symbol: 'GBPUSD',
      orderType: 'BUY',
      parentLots: 0.5,
      childLots: 0.5,
      openTime: '2026-11-14T10:07:00.000Z',
      latencyMs: 0,
      status: 'FAILED',
      retryCount: 1,
    },
  ];

  const dbTrades = [
    {
      id: 'db-trade-1',
      account_id: 'c-acc-1',
      ticket: '2001',
      symbol: 'EURUSD',
      type: 'BUY',
      volume: 0.3,
      open_price: 1.085,
      profit: 64.5,
      status: 'OPEN',
      open_time: '2026-11-14T10:05:01.000Z',
    },
  ];

  const combined = buildCloudTrades(dbTrades, mappings);
  assert.strictEqual(combined.length, 2, '1 real DB trade + 1 non-duplicate mapping fallback');
  assert.strictEqual(combined[0].isMappingFallback, false);
  assert.strictEqual(combined[0].profit, 64.5);
  assert.strictEqual(combined[1].isMappingFallback, true);
  assert.strictEqual(combined[1].ticket, '2002');
  console.log('[PASS] 2. buildCloudTrades deduplicates against real DB trades and tags fallback rows cleanly.');

  // 3. mapAssignmentsToLinks computes real copied count & P&L availability (never fake $0 or hardcoded zero count)
  const assignments = [
    {
      id: 'assign-1',
      mentor_id: 'm-1',
      trader_id: 't-1',
      parent_account_id: 'p-acc-1',
      child_account_id: 'c-acc-1',
      status: 'inactive',
      lot_mode: 'fixed',
      lot_multiplier: 1.0,
      fixed_lot: 0.25,
      assigned_at: '2026-11-14T09:00:00.000Z',
    },
  ];
  const profiles = [
    { id: 'm-1', full_name: 'Mentor Alpha' },
    { id: 't-1', full_name: 'Student Beta' },
  ];

  const links = mapAssignmentsToLinks(assignments, profiles, mappings, combined);
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].status, 'paused', 'DB inactive maps cleanly to UI paused');
  assert.strictEqual(links[0].totalTradesCopied, 2, 'Must count real EXECUTED + CLOSED mappings (excludes FAILED)');
  assert.strictEqual(links[0].totalProfitAvailable, true);
  assert.strictEqual(links[0].totalProfitUSD, 64.5);
  assert.strictEqual(links[0].lotSettings.customType, 'fixed');
  assert.strictEqual(links[0].lotSettings.fixedLot, 0.25);
  console.log('[PASS] 3. mapAssignmentsToLinks computes accurate totalTradesCopied, totalProfitUSD, and paused status.');

  // 4. Audit logs and notifications derive exclusively from real syncLogs (zero mock seed leakage)
  const logs: SyncLog[] = [
    {
      id: 'l-1',
      timestamp: '2026-11-14T10:10:00.000Z',
      eventType: 'ADMIN_USER_STATUS_CHANGED',
      level: 'warn',
      details: 'Admin suspended user X',
    },
    {
      id: 'l-2',
      timestamp: '2026-11-14T10:11:00.000Z',
      eventType: 'BRIDGE_OPEN_QUEUED',
      level: 'info',
      details: 'Queued #1001',
      ticket: '1001',
    },
  ];
  const audits = buildCloudAuditLogs(logs);
  assert.strictEqual(audits.length, 1);
  assert.strictEqual(audits[0].action, 'ADMIN_USER_STATUS_CHANGED');
  const notifs = buildCloudNotifications(logs, 'admin');
  assert.strictEqual(notifs.length, 1);
  assert.strictEqual(notifs[0].type, 'warning');
  console.log('[PASS] 4. Audit logs and notifications derive strictly from real bridge logs without mock seeds.');

  console.log('\nALL DASHBOARD STAGE 2 CLOUD STATE TESTS PASSED.');
}

runTests();
