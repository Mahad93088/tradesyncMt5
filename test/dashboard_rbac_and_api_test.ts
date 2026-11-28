import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApiApp } from '../src/server/apiApp.js';

interface DbState {
  profiles: Record<string, any>[];
  mt5_accounts: Record<string, any>[];
  mentor_assignments: Record<string, any>[];
  bridge_instructions: Record<string, any>[];
  trade_mappings: Record<string, any>[];
  bridge_sync_logs: Record<string, any>[];
  trades: Record<string, any>[];
  subscription_plans: Record<string, any>[];
  subscriptions: Record<string, any>[];
}

function createStage1RbacMockSupabase(state: DbState) {
  const applyFilters = (
    rows: Record<string, any>[],
    filters: Array<{ op: string; col?: string; val?: any; expr?: string }>
  ) =>
    rows.filter((row) =>
      filters.every((f) => {
        if (f.op === 'eq') return row[f.col!] === f.val;
        if (f.op === 'neq') return row[f.col!] !== f.val;
        if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(row[f.col!]);
        if (f.op === 'or' && f.expr) {
          // Handle simple PostgREST OR patterns used in apiApp.ts:
          // e.g. "mentor_id.eq.X,trader_id.eq.X" or "parent_account_id.in.(a,b),child_account_id.in.(a,b)"
          const parts = f.expr.split(/,(?=[a-z_]+\.)/i);
          return parts.some((part) => {
            const eqMatch = part.match(/^([a-z_]+)\.eq\.(.+)$/i);
            if (eqMatch) {
              return String(row[eqMatch[1]]) === eqMatch[2];
            }
            const inMatch = part.match(/^([a-z_]+)\.in\.\((.+)\)$/i);
            if (inMatch) {
              const vals = inMatch[2].split(',').map((s) => s.trim());
              return vals.includes(String(row[inMatch[1]]));
            }
            return false;
          });
        }
        return true;
      })
    );

  return {
    from(tableName: keyof DbState) {
      const filters: Array<{ op: string; col?: string; val?: any; expr?: string }> = [];
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitNum: number | null = null;
      let mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
      let payload: any = null;
      let upsertOnConflict: string | null = null;

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
            return { ...copy };
          });
          return { data: inserted, error: null };
        }

        if (mode === 'upsert') {
          const items = Array.isArray(payload) ? payload : [payload];
          const conflictCols = upsertOnConflict ? upsertOnConflict.split(',').map((s) => s.trim()) : [];
          const out: any[] = [];
          for (const item of items) {
            const existing = conflictCols.length > 0
              ? table.find((r) => conflictCols.every((c) => r[c] === item[c]))
              : null;
            if (existing) {
              Object.assign(existing, item);
              out.push({ ...existing });
            } else {
              const copy = {
                id: item.id || crypto.randomUUID(),
                created_at: item.created_at || new Date().toISOString(),
                ...item,
              };
              table.push(copy);
              out.push({ ...copy });
            }
          }
          return { data: out, error: null };
        }

        if (mode === 'update') {
          const matched = applyFilters(table, filters);
          for (const row of matched) {
            Object.assign(row, payload);
          }
          return { data: matched.map((r) => ({ ...r })), error: null };
        }

        if (mode === 'delete') {
          const matched = applyFilters(table, filters);
          const matchedSet = new Set(matched);
          const kept = table.filter((r) => !matchedSet.has(r));
          table.length = 0;
          table.push(...kept);
          return { data: matched.map((r) => ({ ...r })), error: null };
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
          if (mode !== 'insert' && mode !== 'update' && mode !== 'upsert' && mode !== 'delete') {
            mode = 'select';
          }
          return builder;
        },
        insert(vals: any) {
          mode = 'insert';
          payload = vals;
          return builder;
        },
        upsert(vals: any, opts?: { onConflict?: string }) {
          mode = 'upsert';
          payload = vals;
          upsertOnConflict = opts?.onConflict || null;
          return builder;
        },
        update(vals: any) {
          mode = 'update';
          payload = vals;
          return builder;
        },
        delete() {
          mode = 'delete';
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
        or(expr: string) {
          filters.push({ op: 'or', expr });
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
    async rpc() {
      return { data: [], error: null };
    },
  };
}

async function runTests() {
  console.log('=== TradeSync MT5 Dashboard Stage 1 RBAC & API Tests ===\n');

  const nowIso = new Date().toISOString();
  const adminId = '11111111-1111-4111-8111-111111111111';
  const mentorId = '22222222-2222-4222-8222-222222222222';
  const pendingMentorId = '22222222-2222-4222-8222-222222222229';
  const traderId = '33333333-3333-4333-8333-333333333333';
  const otherTraderId = '44444444-4444-4444-8444-444444444444';

  const parentAccId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const childAccId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const otherChildAccId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
  const assignId1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
  const assignId2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';

  const state: DbState = {
    profiles: [
      { id: adminId, email: 'admin@tradesync.io', full_name: 'Admin User', role: 'admin', status: 'active', created_at: nowIso },
      { id: mentorId, email: 'mentor@tradesync.io', full_name: 'Alpha Mentor', role: 'mentor', status: 'active', created_at: nowIso },
      { id: pendingMentorId, email: 'pending@tradesync.io', full_name: 'Pending Mentor', role: 'mentor', status: 'pending', created_at: nowIso },
      { id: traderId, email: 'trader@tradesync.io', full_name: 'Student One', role: 'trader', status: 'active', created_at: nowIso },
      { id: otherTraderId, email: 'other@tradesync.io', full_name: 'Student Two', role: 'trader', status: 'active', created_at: nowIso },
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
        equity: 51000,
        margin: 400,
        free_margin: 50600,
        currency: 'USD',
        leverage: 100,
        connection_status: 'connected',
        ping_ms: 14,
        auto_trading_enabled: true,
        last_sync: nowIso,
        terminal_token_hash: 'secret_parent_hash_must_never_leak',
        terminal_token_prefix: 'ts_parent_11...',
      },
      {
        id: childAccId,
        user_id: traderId,
        account_role: 'child',
        account_number: '88220022',
        broker_name: 'XM',
        broker_server: 'XMGlobal-MT5 7',
        account_type: 'demo',
        balance: 10000,
        equity: 10250,
        margin: 120,
        free_margin: 10130,
        currency: 'USD',
        leverage: 100,
        connection_status: 'connected',
        ping_ms: 21,
        auto_trading_enabled: true,
        last_sync: nowIso,
        assigned_parent_id: parentAccId,
        terminal_token_hash: 'secret_child_hash_must_never_leak',
        terminal_token_prefix: 'ts_child_22...',
      },
      {
        id: otherChildAccId,
        user_id: otherTraderId,
        account_role: 'child',
        account_number: '77330033',
        broker_name: 'ICMarkets',
        broker_server: 'ICMarketsSC-Demo',
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
        last_sync: nowIso,
        terminal_token_hash: 'secret_other_hash_must_never_leak',
        terminal_token_prefix: 'ts_child_33...',
      },
    ],
    mentor_assignments: [
      {
        id: assignId1,
        mentor_id: mentorId,
        trader_id: traderId,
        parent_account_id: parentAccId,
        child_account_id: childAccId,
        status: 'active',
        lot_mode: 'multiplier',
        lot_multiplier: 1.5,
        fixed_lot: 0.1,
        assigned_at: nowIso,
      },
      {
        id: assignId2,
        mentor_id: mentorId,
        trader_id: otherTraderId,
        parent_account_id: parentAccId,
        child_account_id: otherChildAccId,
        status: 'inactive',
        lot_mode: 'parent_lot',
        lot_multiplier: 1.0,
        fixed_lot: 0.1,
        assigned_at: nowIso,
      },
    ],
    bridge_instructions: [],
    trade_mappings: [
      {
        id: 'map-101',
        parent_trade_ticket: '1001',
        child_trade_ticket: '2001',
        parent_account_id: parentAccId,
        child_account_id: childAccId,
        symbol: 'EURUSD',
        order_type: 'BUY',
        parent_lots: 0.2,
        child_lots: 0.3,
        open_time: nowIso,
        latency_ms: 35,
        status: 'EXECUTED',
        retry_count: 0,
      },
    ],
    bridge_sync_logs: [
      { id: 'log-1', event_type: 'BRIDGE_OPEN_QUEUED', level: 'info', details: 'Copied #1001', ticket: '1001', created_at: nowIso },
      { id: 'log-2', event_type: 'ADMIN_AUDIT', level: 'warn', details: 'Secret admin event', ticket: null, created_at: nowIso },
      { id: 'log-3', event_type: 'BRIDGE_OPEN_QUEUED', level: 'info', details: 'Other tenant ticket', ticket: '9999', created_at: nowIso },
    ],
    subscription_plans: [
      { id: 'plan-silver-rbac', code: 'silver', name: 'Silver', max_followers: 50, max_child_accounts: 50, is_active: true },
    ],
    subscriptions: [
      {
        id: 'sub-rbac-m1',
        user_id: mentorId,
        mentor_id: mentorId,
        plan_id: 'plan-silver-rbac',
        status: 'active',
        current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString(),
        created_at: nowIso,
      },
    ],
    trades: [
      {
        id: 'trade-parent-1',
        account_id: parentAccId,
        user_id: mentorId,
        ticket: '1001',
        symbol: 'EURUSD',
        type: 'BUY',
        volume: 0.2,
        open_price: 1.085,
        profit: 45.2,
        status: 'OPEN',
        open_time: nowIso,
      },
      {
        id: 'trade-child-1',
        account_id: childAccId,
        user_id: traderId,
        ticket: '2001',
        symbol: 'EURUSD',
        type: 'BUY',
        volume: 0.3,
        open_price: 1.0851,
        profit: 66.8,
        status: 'OPEN',
        open_time: nowIso,
      },
      {
        id: 'trade-other-1',
        account_id: otherChildAccId,
        user_id: otherTraderId,
        ticket: '3001',
        symbol: 'GBPUSD',
        type: 'SELL',
        volume: 0.1,
        open_price: 1.27,
        profit: -12.0,
        status: 'CLOSED',
        open_time: nowIso,
      },
    ],
  };

  const mockSupabase = createStage1RbacMockSupabase(state);
  const tokenMap = new Map<string, string>([
    ['jwt-admin', adminId],
    ['jwt-mentor', mentorId],
    ['jwt-pending', pendingMentorId],
    ['jwt-trader', traderId],
    ['jwt-other', otherTraderId],
  ]);

  const app = createApiApp({
    supabaseUrlOverride: 'https://mock.supabase.co',
    serviceRoleKeyOverride: 'mock-service-role-key',
    serviceRoleClientOverride: mockSupabase as any,
    authUserResolverOverride: async (token: string) => {
      const uid = tokenMap.get(token);
      if (!uid) return { user: null, error: 'Invalid token' };
      const profile = state.profiles.find((p) => p.id === uid);
      return { user: { id: uid, email: profile?.email }, error: null };
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;

  try {
    // 1. Self-service registration RBAC
    const badRoleReg = await fetch(`${baseUrl}/api/v1/bridge/accounts/register`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-trader', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountRole: 'parent',
        brokerName: 'XM',
        brokerServer: 'XMGlobal-MT5 7',
        accountNumber: '55551111',
      }),
    });
    assert.strictEqual(badRoleReg.status, 403, 'Trader cannot register a Parent MT5 account');

    const hijackReg = await fetch(`${baseUrl}/api/v1/bridge/accounts/register`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-other', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountRole: 'child',
        brokerName: 'XM',
        brokerServer: 'XMGlobal-MT5 7',
        accountNumber: '88220022', // already owned by traderId
      }),
    });
    assert.strictEqual(hijackReg.status, 403, 'User cannot hijack an existing MT5 account belonging to another user');

    const validTraderReg = await fetch(`${baseUrl}/api/v1/bridge/accounts/register`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-trader', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountRole: 'child',
        brokerName: 'XM',
        brokerServer: 'XMGlobal-MT5 7',
        accountNumber: '88229999',
        accountType: 'demo',
      }),
    });
    assert.strictEqual(validTraderReg.status, 200);
    const validTraderRegJson: any = await validTraderReg.json();
    assert.ok(validTraderRegJson.terminalToken?.startsWith('ts_child_'));
    console.log('[PASS] 1. Self-service MT5 registration enforces role locking, anti-hijack, and returns one-time token.');

    // 2. Mentor sees assigned child accounts safely without token hash
    const mentorMyAccRes = await fetch(`${baseUrl}/api/v1/bridge/my-accounts`, {
      headers: { Authorization: 'Bearer jwt-mentor' },
    });
    assert.strictEqual(mentorMyAccRes.status, 200);
    const mentorMyAccJson: any = await mentorMyAccRes.json();
    assert.strictEqual(mentorMyAccJson.linkedAccounts.length, 2, 'Mentor sees both active and paused child accounts');
    const serialized = JSON.stringify(mentorMyAccJson);
    assert.ok(!serialized.includes('terminal_token_hash'), 'No terminal_token_hash may ever appear in my-accounts');
    assert.ok(!serialized.includes('secret_child_hash'), 'No hash secret may appear in my-accounts');
    console.log('[PASS] 2. Mentor receives sanitized linked child telemetry without any token hashes.');

    // 3. Tenant-scoped logs (/my-logs) & admin-only logs (/logs) & trades
    const forbiddenAdminLogsRes = await fetch(`${baseUrl}/api/v1/bridge/logs`, {
      headers: { Authorization: 'Bearer jwt-trader' },
    });
    assert.strictEqual(forbiddenAdminLogsRes.status, 403, 'Non-admin cannot access admin-only /api/v1/bridge/logs');

    const traderLogsRes = await fetch(`${baseUrl}/api/v1/bridge/my-logs`, {
      headers: { Authorization: 'Bearer jwt-trader' },
    });
    assert.strictEqual(traderLogsRes.status, 200);
    const traderLogsJson: any = await traderLogsRes.json();
    assert.strictEqual(traderLogsJson.logs.length, 1, 'Trader only sees sync logs for their own ticket 1001');
    assert.strictEqual(traderLogsJson.logs[0].ticket, '1001');

    const adminLogsRes = await fetch(`${baseUrl}/api/v1/bridge/logs`, {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(adminLogsRes.status, 200);
    const adminLogsJson: any = await adminLogsRes.json();
    assert.ok(adminLogsJson.logs.length >= 3, 'Admin sees all platform logs');

    const traderTradesRes = await fetch(`${baseUrl}/api/v1/bridge/trades`, {
      headers: { Authorization: 'Bearer jwt-trader' },
    });
    const traderTradesJson: any = await traderTradesRes.json();
    assert.strictEqual(traderTradesJson.trades.length, 1);
    assert.strictEqual(traderTradesJson.trades[0].id, 'trade-child-1');
    console.log('[PASS] 3. Sync logs & trades endpoints enforce strict tenant ownership.');

    // 4. Lot settings & status toggle & anti-cross-tenant access
    const crossLotRes = await fetch(`${baseUrl}/api/v1/bridge/assignments/${assignId1}/lot-settings`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-other', 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyMode: 'fixed', fixedLot: 0.5 }),
    });
    assert.strictEqual(crossLotRes.status, 403, 'Other trader cannot mutate another trader assignment lot settings');

    const restrictedTraderLotRes = await fetch(`${baseUrl}/api/v1/bridge/assignments/${assignId1}/lot-settings`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-trader', 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyMode: 'equity_ratio', multiplier: 2.0, fixedLot: 0.25 }),
    });
    assert.strictEqual(restrictedTraderLotRes.status, 400, 'Student must not be able to select equity_ratio');

    const validTraderLotRes = await fetch(`${baseUrl}/api/v1/bridge/assignments/${assignId1}/lot-settings`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-trader', 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyMode: 'multiplier', multiplier: 1.5, fixedLot: 0.25 }),
    });
    assert.strictEqual(validTraderLotRes.status, 200);
    const validTraderLotJson: any = await validTraderLotRes.json();
    assert.strictEqual(validTraderLotJson.assignment.lot_mode, 'multiplier');

    const validLotRes = await fetch(`${baseUrl}/api/v1/bridge/assignments/${assignId1}/lot-settings`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyMode: 'equity_ratio', multiplier: 2.0, fixedLot: 0.25 }),
    });
    assert.strictEqual(validLotRes.status, 200);
    const validLotJson: any = await validLotRes.json();
    assert.strictEqual(validLotJson.assignment.lot_mode, 'equity_ratio');
    assert.deepStrictEqual(validLotJson.persistedFields, [
      'lot_mode',
      'lot_multiplier',
      'fixed_lot',
      'risk_percent',
      'max_lot_cap',
      'min_lot_clamp',
      'slippage_max_pips',
      'max_drawdown_percent',
      'sync_sl_tp',
      'copy_pending_orders',
      'symbol_prefix',
      'symbol_suffix',
    ]);

    // Pause ('paused' stays distinct from 'inactive')
    const pauseRes = await fetch(`${baseUrl}/api/v1/bridge/assignments/${assignId1}/status`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-mentor', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    });
    assert.strictEqual(pauseRes.status, 200);
    assert.strictEqual(state.mentor_assignments.find((a) => a.id === assignId1)?.status, 'paused');

    // Resume back to active
    const resumeRes = await fetch(`${baseUrl}/api/v1/bridge/assignments/${assignId1}/status`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-trader', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    assert.strictEqual(resumeRes.status, 200);
    assert.strictEqual(state.mentor_assignments.find((a) => a.id === assignId1)?.status, 'active');
    console.log('[PASS] 4. Lot settings & pause/resume assignment endpoints preserve paused/active status cleanly.');

    // 5. Mentor directory & Join via invite code
    const dirRes = await fetch(`${baseUrl}/api/v1/bridge/mentors/directory`, {
      headers: { Authorization: 'Bearer jwt-other' },
    });
    assert.strictEqual(dirRes.status, 200);
    const dirJson: any = await dirRes.json();
    assert.strictEqual(dirJson.mentors.length, 1, 'Pending mentor must not appear in verified directory');
    assert.strictEqual(dirJson.mentors[0].inviteCode, `TS-${mentorId.slice(0, 8).toUpperCase()}`);

    const joinRes = await fetch(`${baseUrl}/api/v1/bridge/assignments/join`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-other', 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCodeOrMentorId: dirJson.mentors[0].inviteCode }),
    });
    assert.strictEqual(joinRes.status, 200);
    assert.strictEqual(state.mentor_assignments.find((a) => a.id === assignId2)?.status, 'active');
    console.log('[PASS] 5. Verified Mentor Directory & Invite Code joining work end-to-end.');

    // 6. Remote mentor emergency close is strictly disabled by policy (403 EMERGENCY_CLOSE_DISABLED)
    const blockedEmergencyClose = await fetch(`${baseUrl}/api/v1/bridge/mentor/emergency-close`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-mentor', 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentTicket: '1001', confirm: true }),
    });
    assert.strictEqual(blockedEmergencyClose.status, 403);
    const blockedEmergencyJson: any = await blockedEmergencyClose.json();
    assert.strictEqual(blockedEmergencyJson.code, 'EMERGENCY_CLOSE_DISABLED');
    console.log('[PASS] 6. Emergency close endpoint enforces ALLOW_MENTOR_EMERGENCY_CLOSE = false (403).');

    // 7. Admin user-status control
    const nonAdminStatusRes = await fetch(`${baseUrl}/api/admin/user-status`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-mentor', 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: traderId, status: 'suspended' }),
    });
    assert.strictEqual(nonAdminStatusRes.status, 403);

    const suspendMentorRes = await fetch(`${baseUrl}/api/admin/user-status`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: mentorId, status: 'suspended' }),
    });
    assert.strictEqual(suspendMentorRes.status, 200);
    const suspendMentorJson: any = await suspendMentorRes.json();
    assert.strictEqual(suspendMentorJson.profile.status, 'suspended');
    assert.strictEqual(suspendMentorJson.pausedAssignments, 2, 'Suspending mentor pauses their active assignments');
    console.log('[PASS] 7. Admin user-status persists status changes and automatically pauses active assignments.');

    console.log('\nALL DASHBOARD STAGE 1 RBAC & API TESTS PASSED.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('Stage 1 RBAC test failed:', err);
  process.exit(1);
});
