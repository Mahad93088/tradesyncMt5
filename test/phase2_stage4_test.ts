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

function createStage4MockSupabase(state: DbState) {
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
  console.log('=== TradeSync MT5 Phase 2 Stage 4 Tests ===\n');

  const mentorId = '22222222-2222-4222-8222-222222222222';
  const traderId = '33333333-3333-4333-8333-333333333333';
  const parentAccId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const childAccId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

  const parentToken = BridgeStore.generateSecureToken('ts_parent');
  const childToken = BridgeStore.generateSecureToken('ts_child');

  const parentTicketPartial = '800001';
  const parentTicketFullExplicit = '800002';
  const parentTicketFullLegacy = '800003';

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
        connection_status: 'connected',
        ping_ms: 10,
        auto_trading_enabled: true,
        last_sync: new Date().toISOString(),
        error_message: null,
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
        connection_status: 'connected',
        ping_ms: 12,
        auto_trading_enabled: true,
        last_sync: new Date().toISOString(),
        error_message: null,
        terminal_token_hash: BridgeStore.hashToken(childToken),
      },
    ],
    mentor_assignments: [],
    bridge_instructions: [],
    trade_mappings: [
      {
        id: 'map-partial-1',
        parent_trade_ticket: parentTicketPartial,
        child_trade_ticket: '910001',
        parent_account_id: parentAccId,
        child_account_id: childAccId,
        symbol: 'EURUSD',
        order_type: 'BUY',
        parent_lots: 0.2,
        child_lots: 0.2,
        open_time: new Date().toISOString(),
        latency_ms: 18,
        status: 'EXECUTED',
        retry_count: 0,
      },
      {
        id: 'map-full-explicit-1',
        parent_trade_ticket: parentTicketFullExplicit,
        child_trade_ticket: '910002',
        parent_account_id: parentAccId,
        child_account_id: childAccId,
        symbol: 'GBPUSD',
        order_type: 'SELL',
        parent_lots: 0.1,
        child_lots: 0.1,
        open_time: new Date().toISOString(),
        latency_ms: 21,
        status: 'EXECUTED',
        retry_count: 0,
      },
      {
        id: 'map-full-legacy-1',
        parent_trade_ticket: parentTicketFullLegacy,
        child_trade_ticket: '910003',
        parent_account_id: parentAccId,
        child_account_id: childAccId,
        symbol: 'USDJPY',
        order_type: 'BUY',
        parent_lots: 0.15,
        child_lots: 0.15,
        open_time: new Date().toISOString(),
        latency_ms: 16,
        status: 'EXECUTED',
        retry_count: 0,
      },
    ],
    bridge_sync_logs: [],
  };

  const mockSupabase = createStage4MockSupabase(state);
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
    // 1. Explicit PARTIAL close is logged cleanly and NOT executed
    // ------------------------------------------------------------------
    const partialRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-Token': parentToken,
        'X-Account-Number': '99110011',
      },
      body: JSON.stringify({
        account_number: '99110011',
        ticket: parentTicketPartial,
        dealTicket: '9001',
        closePrice: 1.095,
        closeType: 'PARTIAL',
        closedLots: 0.1,
        remainingLots: 0.1,
      }),
    });

    assert.strictEqual(partialRes.status, 200);
    const partialJson: any = await partialRes.json();
    assert.strictEqual(partialJson.success, true);
    assert.strictEqual(partialJson.parentTicket, parentTicketPartial);
    assert.strictEqual(partialJson.closeType, 'PARTIAL');
    assert.strictEqual(partialJson.partialCloseHandled, 'logged_not_executed');
    assert.strictEqual(partialJson.closeInstructionsQueued, 0);
    assert.deepStrictEqual(partialJson.instructions, []);

    assert.strictEqual(
      state.bridge_instructions.length,
      0,
      'PARTIAL close must NOT queue any CLOSE instructions'
    );
    assert.strictEqual(
      state.trade_mappings[0].status,
      'EXECUTED',
      'Open child trade mapping must remain EXECUTED until FULL close'
    );

    const partialLogs = state.bridge_sync_logs.filter((l) => l.event_type === 'PARTIAL_CLOSE_SKIPPED');
    assert.strictEqual(partialLogs.length, 1, 'PARTIAL_CLOSE_SKIPPED audit log must be persisted');
    assert.strictEqual(partialLogs[0].level, 'warn');
    assert.strictEqual(partialLogs[0].ticket, parentTicketPartial);
    assert.ok(partialLogs[0].details.includes('deal #9001'));
    console.log('[PASS] 1. Explicit PARTIAL close logs PARTIAL_CLOSE_SKIPPED, queues 0 CLOSE instructions, and keeps child open.');

    // ------------------------------------------------------------------
    // 2. Omitted closeType with remainingLots > 0.00001 is safely detected as PARTIAL
    // ------------------------------------------------------------------
    const implicitPartialRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-Token': parentToken,
        'X-Account-Number': '99110011',
      },
      body: JSON.stringify({
        account_number: '99110011',
        ticket: parentTicketPartial,
        closePrice: 1.096,
        remainingLots: 0.05,
      }),
    });

    assert.strictEqual(implicitPartialRes.status, 200);
    const implicitPartialJson: any = await implicitPartialRes.json();
    assert.strictEqual(implicitPartialJson.closeType, 'PARTIAL');
    assert.strictEqual(implicitPartialJson.partialCloseHandled, 'logged_not_executed');
    assert.strictEqual(implicitPartialJson.closeInstructionsQueued, 0);
    assert.strictEqual(state.bridge_instructions.length, 0);
    assert.strictEqual(state.bridge_sync_logs.filter((l) => l.event_type === 'PARTIAL_CLOSE_SKIPPED').length, 2);
    console.log('[PASS] 2. Omitted closeType with remainingLots > 0.00001 is safely treated as PARTIAL.');

    // ------------------------------------------------------------------
    // 3. Explicit FULL close and legacy omitted closeType queue CLOSE normally
    // ------------------------------------------------------------------
    const fullExplicitRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-Token': parentToken,
        'X-Account-Number': '99110011',
      },
      body: JSON.stringify({
        account_number: '99110011',
        ticket: parentTicketFullExplicit,
        dealTicket: '9002',
        closePrice: 1.275,
        closeType: 'FULL',
        closedLots: 0.1,
        remainingLots: 0.0,
      }),
    });
    assert.strictEqual(fullExplicitRes.status, 200);
    const fullExplicitJson: any = await fullExplicitRes.json();
    assert.strictEqual(fullExplicitJson.success, true);
    assert.strictEqual(fullExplicitJson.parentTicket, parentTicketFullExplicit);
    assert.strictEqual(fullExplicitJson.closeInstructionsQueued, 1);
    assert.strictEqual(fullExplicitJson.instructions[0].childAccountId, childAccId);
    assert.strictEqual(fullExplicitJson.instructions[0].childTicket, '910002');
    assert.strictEqual(state.bridge_instructions[0].action, 'CLOSE');
    assert.strictEqual(state.bridge_instructions[0].parent_ticket, parentTicketFullExplicit);

    const fullLegacyRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-Token': parentToken,
        'X-Account-Number': '99110011',
      },
      body: JSON.stringify({
        account_number: '99110011',
        ticket: parentTicketFullLegacy,
        closePrice: 154.2,
      }),
    });
    assert.strictEqual(fullLegacyRes.status, 200);
    const fullLegacyJson: any = await fullLegacyRes.json();
    assert.strictEqual(fullLegacyJson.success, true);
    assert.strictEqual(fullLegacyJson.parentTicket, parentTicketFullLegacy);
    assert.strictEqual(fullLegacyJson.closeInstructionsQueued, 1);
    assert.strictEqual(fullLegacyJson.instructions[0].childAccountId, childAccId);
    assert.strictEqual(fullLegacyJson.instructions[0].childTicket, '910003');
    assert.strictEqual(state.bridge_instructions.length, 2);
    assert.strictEqual(state.bridge_instructions[1].action, 'CLOSE');
    assert.strictEqual(state.bridge_instructions[1].parent_ticket, parentTicketFullLegacy);
    console.log('[PASS] 3. Explicit FULL close and legacy omitted closeType queue child CLOSE instructions.');

    // ------------------------------------------------------------------
    // 4. MQL5 Broadcaster & Receiver Stage 4 Protocol + Demo Safety Verification
    // ------------------------------------------------------------------
    const broadcasterSrc = fs.readFileSync(
      path.join(process.cwd(), 'public/mql5/TradeSync_Broadcaster.mq5'),
      'utf-8'
    );
    const receiverSrc = fs.readFileSync(
      path.join(process.cwd(), 'public/mql5/TradeSync_Receiver.mq5'),
      'utf-8'
    );

    // Broadcaster checks
    assert.ok(broadcasterSrc.includes('ACCOUNT_TRADE_MODE_DEMO'), 'Broadcaster Demo guard intact');
    assert.ok(broadcasterSrc.includes('PositionSelectByTicket(position)'), 'Broadcaster checks remaining volume on close');
    assert.ok(broadcasterSrc.includes('PositionGetDouble(POSITION_VOLUME)'), 'Broadcaster reads remaining POSITION_VOLUME');
    assert.ok(broadcasterSrc.includes('closeType = "PARTIAL"'), 'Broadcaster classifies PARTIAL closes');
    assert.ok(broadcasterSrc.includes('\\"closeType\\":\\"%s\\"'), 'BroadcastTradeClose serializes closeType');
    assert.ok(broadcasterSrc.includes('\\"closedLots\\":%.2f'), 'BroadcastTradeClose serializes closedLots');
    assert.ok(broadcasterSrc.includes('\\"remainingLots\\":%.2f'), 'BroadcastTradeClose serializes remainingLots');
    assert.ok(broadcasterSrc.includes('\\"dealTicket\\":\\"%I64u\\"'), 'BroadcastTradeClose serializes dealTicket');
    assert.ok(broadcasterSrc.includes('TRADE_TRANSACTION_ORDER_ADD'), 'Broadcaster observes pending order placement');
    assert.ok(
      broadcasterSrc.includes('fill-based mirroring active; child copies execute when triggered (DEAL_ENTRY_IN)'),
      'Broadcaster documents fill-based pending-order mirroring without dispatching unverified pending order instructions'
    );

    // Receiver checks: strictly only executes BUY/SELL market fills and preserves Demo-only guard
    assert.ok(receiverSrc.includes('ACCOUNT_TRADE_MODE_DEMO'), 'Receiver Demo guard intact');
    assert.ok(
      receiverSrc.includes('(orderType != "BUY" && orderType != "SELL")'),
      'Receiver strictly rejects unsupported pending/non-market order types'
    );
    assert.ok(
      !receiverSrc.includes('ORDER_TYPE_BUY_LIMIT') && !receiverSrc.includes('ORDER_TYPE_SELL_LIMIT'),
      'Receiver must NOT contain unverified pending order execution logic'
    );
    console.log('[PASS] 4. MQL5 Broadcaster & Receiver Stage 4 partial-close/pending-order compatibility & Demo guards verified.');

    console.log('\nALL PHASE 2 STAGE 4 TESTS PASSED SUCCESSFULLY!');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('Stage 4 test failed:', err);
  process.exit(1);
});
