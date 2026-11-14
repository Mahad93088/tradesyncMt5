import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import {
  createApiApp,
  computeEffectiveConnectionStatus,
  STALE_HEARTBEAT_THRESHOLD_MS,
} from '../src/server/apiApp.js';
import { BridgeStore } from '../src/server/bridgeStore.js';
const bridgeStore = BridgeStore.getInstance();

interface DbState {
  profiles: Record<string, any>[];
  mt5_accounts: Record<string, any>[];
  mentor_assignments: Record<string, any>[];
  bridge_instructions: Record<string, any>[];
  trade_mappings: Record<string, any>[];
  bridge_sync_logs: Record<string, any>[];
}

function createStage2MockSupabase(state: DbState) {
  const applyFilters = (
    rows: Record<string, any>[],
    filters: Array<{ op: string; col: string; val: any }>
  ) =>
    rows.filter((row) =>
      filters.every((f) => {
        if (f.op === 'eq') return row[f.col] === f.val;
        if (f.op === 'neq') return row[f.col] !== f.val;
        if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(row[f.col]);
        return true;
      })
    );

  return {
    from(tableName: keyof DbState) {
      const filters: Array<{ op: string; col: string; val: any }> = [];
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitNum: number | null = null;
      let mode: 'select' | 'insert' | 'update' = 'select';
      let payload: any = null;

      const execute = async () => {
        const table = state[tableName];
        if (!table) {
          return { data: null, error: { message: `Table ${String(tableName)} not found` } };
        }

        if (mode === 'insert') {
          const items = Array.isArray(payload) ? payload : [payload];
          const inserted = items.map((item) => {
            const copy = {
              id: item.id || crypto.randomUUID(),
              created_at: item.created_at || new Date().toISOString(),
              ...item,
            };
            table.push(copy);
            return copy;
          });
          return { data: inserted, error: null };
        }

        if (mode === 'update') {
          const matched = applyFilters(table, filters);
          for (const row of matched) {
            Object.assign(row, payload);
          }
          return { data: matched, error: null };
        }

        let matched = applyFilters(table, filters);
        if (orderCol) {
          matched = [...matched].sort((a, b) => {
            const av = a[orderCol!];
            const bv = b[orderCol!];
            if (av === bv) return 0;
            return (av < bv ? -1 : 1) * (orderAsc ? 1 : -1);
          });
        }
        if (limitNum !== null) {
          matched = matched.slice(0, limitNum);
        }
        return { data: matched.map((r) => ({ ...r })), error: null };
      };

      const builder: any = {
        select() {
          mode = 'select';
          return builder;
        },
        insert(vals: any) {
          mode = 'insert';
          payload = vals;
          return builder;
        },
        update(vals: any) {
          mode = 'update';
          payload = vals;
          return builder;
        },
        eq(col: string, val: any) {
          filters.push({ op: 'eq', col, val });
          return builder;
        },
        neq(col: string, val: any) {
          filters.push({ op: 'neq', col, val });
          return builder;
        },
        in(col: string, val: any[]) {
          filters.push({ op: 'in', col, val });
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orderCol = col;
          orderAsc = opts?.ascending !== false;
          return builder;
        },
        limit(n: number) {
          limitNum = n;
          return builder;
        },
        maybeSingle: async () => {
          const res = await execute();
          if (res.error) return res;
          return { data: res.data?.[0] || null, error: null };
        },
        single: async () => {
          const res = await execute();
          if (res.error) return res;
          if (!res.data || res.data.length === 0) {
            return { data: null, error: { message: 'Row not found' } };
          }
          return { data: res.data[0], error: null };
        },
        then(resolve: any, reject: any) {
          return execute().then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(fnName: string, params: Record<string, any>) {
      if (fnName === 'claim_pending_instructions') {
        assert.strictEqual(params.p_limit, 0, 'Health check calls claim_pending_instructions with p_limit=0');
        return { data: [], error: null };
      }
      return { data: null, error: { message: `Unknown RPC ${fnName}` } };
    },
  };
}

async function runTests() {
  console.log('=== TradeSync MT5 Phase 2 Stage 2 Tests ===\n');

  // ------------------------------------------------------------------
  // 1. Stale Heartbeat Detection Logic
  // ------------------------------------------------------------------
  const now = Date.now();
  const freshSync = new Date(now - 20_000).toISOString();
  const staleSync = new Date(now - STALE_HEARTBEAT_THRESHOLD_MS - 35_000).toISOString();

  const freshRes = computeEffectiveConnectionStatus('connected', freshSync, null, now);
  assert.strictEqual(freshRes.effectiveStatus, 'connected');
  assert.strictEqual(freshRes.isStale, false);

  const staleRes = computeEffectiveConnectionStatus('connected', staleSync, null, now);
  assert.strictEqual(staleRes.effectiveStatus, 'disconnected');
  assert.strictEqual(staleRes.isStale, true);
  assert.ok(staleRes.errorMessage?.includes('Heartbeat stale'));

  const missingSyncRes = computeEffectiveConnectionStatus('connected', null, null, now);
  assert.strictEqual(missingSyncRes.effectiveStatus, 'disconnected');
  assert.strictEqual(missingSyncRes.isStale, true);

  const manualOffRes = computeEffectiveConnectionStatus('disconnected', freshSync, 'Manual disconnect', now);
  assert.strictEqual(manualOffRes.effectiveStatus, 'disconnected');
  assert.strictEqual(manualOffRes.isStale, false);
  assert.strictEqual(manualOffRes.errorMessage, 'Manual disconnect');
  console.log('[PASS] 1. computeEffectiveConnectionStatus handles fresh, stale (>90s), missing last_sync, and manual disconnects.');

  // ------------------------------------------------------------------
  // Setup API App + Mock Supabase State
  // ------------------------------------------------------------------
  const adminId = '11111111-1111-4111-8111-111111111111';
  const mentorId = '22222222-2222-4222-8222-222222222222';
  const traderId = '33333333-3333-4333-8333-333333333333';
  const otherTraderId = '44444444-4444-4444-8444-444444444444';

  const parentAccId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const childFreshAccId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const childStaleAccId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
  const childOtherAccId = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4';

  const state: DbState = {
    profiles: [
      { id: adminId, email: 'admin@tradesync.io', full_name: 'Admin User', role: 'admin', status: 'active' },
      { id: mentorId, email: 'mentor@tradesync.io', full_name: 'Mentor Alpha', role: 'mentor', status: 'active' },
      { id: traderId, email: 'trader@tradesync.io', full_name: 'Trader One', role: 'trader', status: 'active' },
      { id: otherTraderId, email: 'other@tradesync.io', full_name: 'Other Trader', role: 'trader', status: 'active' },
    ],
    mt5_accounts: [
      {
        id: parentAccId,
        user_id: mentorId,
        account_role: 'parent',
        account_number: '99110011',
        broker_name: 'XM',
        broker_server: 'XMGlobal-MT5 7',
        account_type: 'demo',
        balance: 50000,
        equity: 51200,
        margin: 500,
        free_margin: 50700,
        currency: 'USD',
        leverage: 100,
        connection_status: 'connected',
        ping_ms: 14,
        auto_trading_enabled: true,
        last_sync: freshSync,
        error_message: null,
        created_at: freshSync,
      },
      {
        id: childFreshAccId,
        user_id: traderId,
        account_role: 'child',
        account_number: '88220022',
        broker_name: 'XM',
        broker_server: 'XMGlobal-MT5 7',
        account_type: 'demo',
        balance: 10000,
        equity: 10200,
        margin: 120,
        free_margin: 10080,
        currency: 'USD',
        leverage: 100,
        connection_status: 'connected',
        ping_ms: 21,
        auto_trading_enabled: true,
        last_sync: freshSync,
        error_message: null,
        created_at: freshSync,
      },
      {
        id: childStaleAccId,
        user_id: otherTraderId,
        account_role: 'child',
        account_number: '77330033',
        broker_name: 'XM',
        broker_server: 'XMGlobal-MT5 7',
        account_type: 'demo',
        balance: 12000,
        equity: 12000,
        margin: 0,
        free_margin: 12000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'connected', // DB says connected, but last_sync is > 90s old!
        ping_ms: 35,
        auto_trading_enabled: false,
        last_sync: staleSync,
        error_message: null,
        created_at: staleSync,
      },
      {
        id: childOtherAccId,
        user_id: otherTraderId,
        account_role: 'child',
        account_number: '66440044',
        broker_name: 'XM',
        broker_server: 'XMGlobal-MT5 7',
        account_type: 'demo',
        balance: 5000,
        equity: 5000,
        margin: 0,
        free_margin: 5000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        ping_ms: 0,
        auto_trading_enabled: true,
        last_sync: freshSync,
        error_message: 'Manually paused',
        created_at: freshSync,
      },
    ],
    mentor_assignments: [
      {
        id: 'assign-1',
        mentor_id: mentorId,
        trader_id: traderId,
        parent_account_id: parentAccId,
        child_account_id: childFreshAccId,
        status: 'active',
        lot_mode: 'multiplier',
        lot_multiplier: 1.5,
        fixed_lot: 0.01,
        assigned_at: freshSync,
      },
    ],
    bridge_instructions: [
      { id: 'inst-1', status: 'QUEUED' },
      { id: 'inst-2', status: 'IN_FLIGHT' },
      { id: 'inst-3', status: 'EXECUTED' },
    ],
    trade_mappings: [
      {
        id: 'map-1',
        parent_trade_ticket: '1001',
        child_trade_ticket: '2001',
        parent_account_id: parentAccId,
        child_account_id: childFreshAccId,
        symbol: 'EURUSD',
        order_type: 'BUY',
        parent_lots: 0.2,
        child_lots: 0.3,
        open_time: freshSync,
        latency_ms: 42,
        status: 'EXECUTED',
        retry_count: 0,
      },
      {
        id: 'map-2',
        parent_trade_ticket: '1002',
        child_trade_ticket: '2002',
        parent_account_id: parentAccId,
        child_account_id: childFreshAccId,
        symbol: 'XAUUSD',
        order_type: 'SELL',
        parent_lots: 0.1,
        child_lots: 0.15,
        open_time: freshSync,
        latency_ms: 58,
        status: 'CLOSED',
        retry_count: 0,
      },
      {
        id: 'map-3',
        parent_trade_ticket: '1003',
        child_trade_ticket: '0',
        parent_account_id: parentAccId,
        child_account_id: childStaleAccId,
        symbol: 'GBPUSD',
        order_type: 'BUY',
        parent_lots: 0.5,
        child_lots: 0.5,
        open_time: freshSync,
        latency_ms: 0,
        status: 'REJECTED_MARGIN',
        error_message: 'Not enough free margin',
        retry_count: 1,
      },
    ],
    bridge_sync_logs: [],
  };

  const mockSupabase = createStage2MockSupabase(state);
  const tokenToUser = new Map<string, string>([
    ['jwt-admin', adminId],
    ['jwt-mentor', mentorId],
    ['jwt-trader', traderId],
    ['jwt-other', otherTraderId],
  ]);

  const app = createApiApp({
    supabaseUrl: 'https://mock.supabase.co',
    serviceRoleKey: 'mock-service-role-key',
    serviceRoleClient: mockSupabase as any,
    verifyAuthToken: async (token: string) => {
      const uid = tokenToUser.get(token);
      if (!uid) return { user: null, error: 'Invalid token' };
      const profile = state.profiles.find((p) => p.id === uid);
      return { user: { id: uid, email: profile?.email }, error: null };
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // ------------------------------------------------------------------
    // 2. Test empty bridge_sync_logs returns [] (no mock/L1 leakage)
    // ------------------------------------------------------------------
    const emptyLogs = await bridgeStore.getSyncLogs(mockSupabase as any);
    assert.strictEqual(emptyLogs.length, 0, 'Empty bridge_sync_logs must return [] cleanly');

    // Hydrate mentorId & traderId in getTradeMappings
    const hydratedMappings = await bridgeStore.getTradeMappings(mockSupabase as any);
    assert.strictEqual(hydratedMappings.length, 3);
    assert.strictEqual(hydratedMappings[0].mentorId, mentorId, 'getTradeMappings must hydrate mentorId from parent mt5_accounts');
    assert.strictEqual(hydratedMappings[0].traderId, traderId, 'getTradeMappings must hydrate traderId from child mt5_accounts');
    console.log('[PASS] 2. bridgeStore.getTradeMappings hydrates mentorId/traderId & getSyncLogs returns [] cleanly on empty table.');

    // ------------------------------------------------------------------
    // 3. Test Admin Accounts Stale Heartbeat Enrichment
    // ------------------------------------------------------------------
    const adminAccRes = await fetch(`${baseUrl}/api/v1/admin/accounts`, {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(adminAccRes.status, 200);
    const adminAccJson: any = await adminAccRes.json();
    const staleAcc = adminAccJson.accounts.find((a: any) => a.id === childStaleAccId);
    const freshAcc = adminAccJson.accounts.find((a: any) => a.id === childFreshAccId);
    assert.strictEqual(freshAcc.connection_status, 'connected');
    assert.strictEqual(freshAcc.is_stale, false);
    assert.strictEqual(staleAcc.connection_status, 'disconnected', 'Stale connected terminal must report disconnected');
    assert.strictEqual(staleAcc.is_stale, true);
    assert.ok(staleAcc.error_message?.includes('Heartbeat stale'));
    console.log('[PASS] 3. GET /api/v1/admin/accounts reports stale heartbeat as disconnected with descriptive error_message.');

    // ------------------------------------------------------------------
    // 4. Test Bridge Status Real Telemetry Counts
    // ------------------------------------------------------------------
    const statusRes = await fetch(`${baseUrl}/api/v1/bridge/status`, {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(statusRes.status, 200);
    const statusJson: any = await statusRes.json();
    assert.strictEqual(statusJson.databasePersistence, true);
    assert.strictEqual(statusJson.bridgeTelemetry.totalTerminalsCount, 4);
    assert.strictEqual(statusJson.bridgeTelemetry.activeTerminalsCount, 2); // parentAcc + childFreshAcc
    assert.strictEqual(statusJson.bridgeTelemetry.staleTerminalsCount, 1); // childStaleAcc
    assert.strictEqual(statusJson.bridgeTelemetry.disconnectedTerminalsCount, 2); // childStaleAcc + childOtherAcc
    assert.strictEqual(statusJson.bridgeTelemetry.pendingInstructionsCount, 2); // QUEUED + IN_FLIGHT
    assert.strictEqual(statusJson.bridgeTelemetry.failedMappingsCount, 1); // Only map-3 (REJECTED_MARGIN), NOT CLOSED!
    assert.strictEqual(statusJson.bridgeTelemetry.averageCopyLatencyMs, 50); // Avg(42, 58) = 50ms
    console.log('[PASS] 4. GET /api/v1/bridge/status computes real bridgeTelemetry (terminals, stale, queue, failed excluding CLOSED, latency).');

    // ------------------------------------------------------------------
    // 5. Test Tenant-Scoped /api/v1/bridge/my-accounts
    // ------------------------------------------------------------------
    const unauthMyRes = await fetch(`${baseUrl}/api/v1/bridge/my-accounts`);
    assert.strictEqual(unauthMyRes.status, 401);

    const traderMyRes = await fetch(`${baseUrl}/api/v1/bridge/my-accounts`, {
      headers: { Authorization: 'Bearer jwt-trader' },
    });
    assert.strictEqual(traderMyRes.status, 200);
    const traderMyJson: any = await traderMyRes.json();
    assert.strictEqual(traderMyJson.accounts.length, 1);
    assert.strictEqual(traderMyJson.accounts[0].id, childFreshAccId);
    assert.strictEqual(traderMyJson.assignments.length, 1);
    assert.ok(traderMyJson.profiles.some((p: any) => p.id === mentorId), 'Linked mentor profile included');
    assert.ok(!traderMyJson.profiles.some((p: any) => p.id === otherTraderId), 'Unrelated user profile excluded');
    console.log('[PASS] 5. GET /api/v1/bridge/my-accounts enforces strict tenant scoping.');

    // ------------------------------------------------------------------
    // 6. Test Connection & Auto-Trading Toggle Ownership Enforcement
    // ------------------------------------------------------------------
    const forbiddenConn = await fetch(`${baseUrl}/api/v1/bridge/accounts/${childFreshAccId}/connection`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer jwt-other',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ connectionStatus: 'disconnected' }),
    });
    assert.strictEqual(forbiddenConn.status, 403, 'Non-owner non-admin cannot toggle another user connection');

    const ownerAutoRes = await fetch(`${baseUrl}/api/v1/bridge/accounts/${childFreshAccId}/auto-trading`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer jwt-trader',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: false }),
    });
    assert.strictEqual(ownerAutoRes.status, 200);
    const ownerAutoJson: any = await ownerAutoRes.json();
    assert.strictEqual(ownerAutoJson.autoTradingEnabled, false);
    assert.strictEqual(state.mt5_accounts.find((a) => a.id === childFreshAccId)?.auto_trading_enabled, false);

    const adminDisconnRes = await fetch(`${baseUrl}/api/v1/bridge/accounts/${childFreshAccId}/connection`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer jwt-admin',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ connectionStatus: 'disconnected' }),
    });
    assert.strictEqual(adminDisconnRes.status, 200);
    assert.strictEqual(state.mt5_accounts.find((a) => a.id === childFreshAccId)?.connection_status, 'disconnected');
    console.log('[PASS] 6. Connection and Auto-Trading toggle endpoints enforce Admin/Owner authorization and persist changes.');

    console.log('\nALL PHASE 2 STAGE 2 TESTS PASSED.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('Stage 2 test failed:', err);
  process.exit(1);
});
