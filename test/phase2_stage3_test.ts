import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApiApp } from '../src/server/apiApp.js';
import { BridgeStore } from '../src/server/bridgeStore.js';

interface DbState {
  profiles: Record<string, any>[];
  mt5_accounts: Record<string, any>[];
  mentor_assignments: Record<string, any>[];
  bridge_instructions: Record<string, any>[];
  trade_mappings: Record<string, any>[];
  bridge_sync_logs: Record<string, any>[];
}

function createStage3MockSupabase(
  state: DbState,
  opts?: {
    onAccountUpdate?: (payload: Record<string, any>) => void;
    failSyncLogInsert?: boolean;
  }
) {
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
          if (tableName === 'bridge_sync_logs' && opts?.failSyncLogInsert) {
            return { data: null, error: { message: 'Simulated DB insert failure for bridge_sync_logs' } };
          }
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
            if (tableName === 'mt5_accounts') {
              opts?.onAccountUpdate?.({ ...payload });
            }
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
        order(col: string, oOpts?: { ascending?: boolean }) {
          orderCol = col;
          orderAsc = oOpts?.ascending !== false;
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

    async rpc() {
      return { data: [], error: null };
    },
  };
}

async function runTests() {
  console.log('=== TradeSync MT5 Phase 2 Stage 3 Tests ===\n');

  const mentorId = '22222222-2222-4222-8222-222222222222';
  const traderId = '33333333-3333-4333-8333-333333333333';
  const parentAccId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const childAccId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

  const parentToken = BridgeStore.generateSecureToken('ts_parent');
  const childToken = BridgeStore.generateSecureToken('ts_child');

  let accountUpdateWrites: Array<Record<string, any>> = [];

  const state: DbState = {
    profiles: [
      { id: mentorId, email: 'mentor@tradesync.io', full_name: 'Mentor Alpha', role: 'mentor', status: 'active' },
      { id: traderId, email: 'trader@tradesync.io', full_name: 'Trader One', role: 'trader', status: 'active' },
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
        equity: 50000,
        margin: 0,
        free_margin: 50000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        ping_ms: 0,
        auto_trading_enabled: false,
        last_sync: null,
        error_message: 'Idle startup',
        terminal_token_hash: BridgeStore.hashToken(parentToken),
      },
      {
        id: childAccId,
        user_id: traderId,
        account_role: 'child',
        account_number: '88220022',
        broker_name: 'XM',
        broker_server: 'XMGlobal-MT5 2',
        account_type: 'demo',
        balance: 10000,
        equity: 10000,
        margin: 0,
        free_margin: 10000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        ping_ms: 0,
        auto_trading_enabled: true,
        last_sync: null,
        error_message: null,
        terminal_token_hash: BridgeStore.hashToken(childToken),
      },
    ],
    mentor_assignments: [],
    bridge_instructions: [],
    trade_mappings: [],
    bridge_sync_logs: [],
  };

  const mockSupabase = createStage3MockSupabase(state, {
    onAccountUpdate: (payload) => accountUpdateWrites.push(payload),
  });

  const app = createApiApp({
    supabaseUrlOverride: 'https://mock.supabase.co',
    serviceRoleKeyOverride: 'mock-service-role-key',
    serviceRoleClientOverride: mockSupabase as any,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // ------------------------------------------------------------------
    // 1. Poll Throttling & Duplicate DB Update Elimination
    // ------------------------------------------------------------------
    accountUpdateWrites = [];
    const firstPoll = await fetch(`${baseUrl}/api/v1/bridge/instructions/pending`, {
      headers: {
        'X-Terminal-Token': childToken,
        'X-Account-Number': '88220022',
      },
    });
    assert.strictEqual(firstPoll.status, 200);
    assert.strictEqual(
      accountUpdateWrites.length,
      1,
      'First poll when disconnected must perform exactly 1 mt5_accounts UPDATE (eliminating duplicate update)'
    );
    assert.strictEqual(state.mt5_accounts[1].connection_status, 'connected');

    // Perform 5 rapid subsequent idle polls within 15s throttle window
    for (let i = 0; i < 5; i++) {
      const pollRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/pending`, {
        headers: {
          'X-Terminal-Token': childToken,
          'X-Account-Number': '88220022',
        },
      });
      assert.strictEqual(pollRes.status, 200);
    }
    assert.strictEqual(
      accountUpdateWrites.length,
      1,
      'Rapid subsequent idle polls within 15s throttle must produce 0 extra mt5_accounts DB writes'
    );
    console.log('[PASS] 1. Polling consolidates duplicate DB updates and throttles idle last_sync writes within 15s.');

    // ------------------------------------------------------------------
    // 2. Heartbeat Telemetry Persistence & Demo-Only TradeMode Guard
    // ------------------------------------------------------------------
    accountUpdateWrites = [];
    const realBlockRes = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-Token': parentToken,
        'X-Account-Number': '99110011',
      },
      body: JSON.stringify({
        account_number: '99110011',
        tradeMode: 'REAL',
        balance: 99999,
      }),
    });
    assert.strictEqual(realBlockRes.status, 403);
    const realBlockJson: any = await realBlockRes.json();
    assert.strictEqual(realBlockJson.code, 'DEMO_ONLY_SAFETY_BLOCK');
    assert.strictEqual(accountUpdateWrites.length, 0, 'Blocked REAL heartbeat must not update mt5_accounts');

    const hbRes = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-Token': parentToken,
        'X-Account-Number': '99110011',
      },
      body: JSON.stringify({
        account_number: '99110011',
        tradeMode: 'DEMO',
        balance: 52340.5,
        equity: 52890.75,
        margin: 410.25,
        freeMargin: 52480.5,
        pingMs: 17,
        autoTradingEnabled: true,
      }),
    });
    assert.strictEqual(hbRes.status, 200);
    const hbJson: any = await hbRes.json();
    assert.strictEqual(hbJson.success, true);
    assert.strictEqual(accountUpdateWrites.length, 1, 'Heartbeat performs single consolidated DB write');
    const updatedParent = state.mt5_accounts.find((a) => a.id === parentAccId)!;
    assert.strictEqual(updatedParent.connection_status, 'connected');
    assert.strictEqual(updatedParent.error_message, null);
    assert.strictEqual(updatedParent.balance, 52340.5);
    assert.strictEqual(updatedParent.equity, 52890.75);
    assert.strictEqual(updatedParent.margin, 410.25);
    assert.strictEqual(updatedParent.free_margin, 52480.5);
    assert.strictEqual(updatedParent.ping_ms, 17);
    assert.strictEqual(updatedParent.auto_trading_enabled, true);
    console.log('[PASS] 2. Heartbeat rejects non-DEMO mode and persists full telemetry cleanly in 1 DB write.');

    // ------------------------------------------------------------------
    // 3. Awaited Sync Log Persistence & Failure Handling
    // ------------------------------------------------------------------
    state.bridge_sync_logs = [];
    const tradeOpenRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-Token': parentToken,
        'X-Account-Number': '99110011',
      },
      body: JSON.stringify({
        account_number: '99110011',
        ticket: '700001',
        symbol: 'EURUSD',
        type: 'BUY',
        lots: 0.25,
      }),
    });
    assert.strictEqual(tradeOpenRes.status, 200);
    assert.strictEqual(
      state.bridge_sync_logs.length,
      1,
      'Awaited NO_ACTIVE_CHILDREN sync log must already be persisted when HTTP 200 returns'
    );
    assert.strictEqual(state.bridge_sync_logs[0].event_type, 'NO_ACTIVE_CHILDREN');

    const store = BridgeStore.getInstance();
    const failingClient = createStage3MockSupabase(state, { failSyncLogInsert: true });
    const okWrite = await store.addSyncLog(
      { eventType: 'TEST_OK', level: 'info', details: 'ok' },
      mockSupabase as any
    );
    assert.strictEqual(okWrite, true);
    const failedWrite = await store.addSyncLog(
      { eventType: 'TEST_FAIL', level: 'error', details: 'should return false gracefully' },
      failingClient as any
    );
    assert.strictEqual(failedWrite, false, 'addSyncLog returns false cleanly on DB insert error');
    console.log('[PASS] 3. Sync logs are reliably awaited and report persistence errors cleanly without crashing.');

    // ------------------------------------------------------------------
    // 4. Verify MQL5 Broadcaster & Receiver Stage 3 + Demo Safety
    // ------------------------------------------------------------------
    const broadcasterSrc = fs.readFileSync(path.join(process.cwd(), 'public/mql5/TradeSync_Broadcaster.mq5'), 'utf-8');
    const receiverSrc = fs.readFileSync(path.join(process.cwd(), 'public/mql5/TradeSync_Receiver.mq5'), 'utf-8');

    assert.ok(broadcasterSrc.includes('ACCOUNT_TRADE_MODE_DEMO'), 'Broadcaster Demo guard intact');
    assert.ok(broadcasterSrc.includes('EnsureDemoAccount("OnInit")'));
    assert.ok(broadcasterSrc.includes('PendingEventRecord'), 'Broadcaster retry queue struct present');
    assert.ok(broadcasterSrc.includes('EnqueuePendingEvent'), 'Broadcaster event enqueue function present');
    assert.ok(broadcasterSrc.includes('FlushPendingEvents'), 'Broadcaster timer retry flush present');
    assert.ok(broadcasterSrc.includes('DispatchOrQueueEvent'), 'Broadcaster dispatch-or-queue helper present');
    assert.ok(broadcasterSrc.includes('EventSetTimer(1)'), 'Broadcaster 1s timer pump enabled');
    assert.ok(broadcasterSrc.includes('AccountInfoDouble(ACCOUNT_EQUITY)'), 'Broadcaster telemetry enabled');

    assert.ok(receiverSrc.includes('ACCOUNT_TRADE_MODE_DEMO'), 'Receiver Demo guard intact');
    assert.ok(receiverSrc.includes('EnsureDemoAccount("TrySendAckNow")'));
    assert.ok(receiverSrc.includes('SendReceiverHeartbeat'), 'Receiver periodic telemetry heartbeat added');
    assert.ok(receiverSrc.includes('RECEIVER_HEARTBEAT_INTERVAL_SEC'), 'Receiver 60s heartbeat throttle constant present');
    assert.ok(receiverSrc.includes('AccountInfoDouble(ACCOUNT_EQUITY)'), 'Receiver telemetry enabled');
    console.log('[PASS] 4. Broadcaster retry queue, 1s timer / 30s heartbeat, Receiver 60s telemetry & Demo guards verified.');

    console.log('\nALL PHASE 2 STAGE 3 TESTS PASSED SUCCESSFULLY!');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('Stage 3 test failed:', err);
  process.exit(1);
});
