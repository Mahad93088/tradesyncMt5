import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApiApp } from '../src/server/apiApp.js';
import { buildCloudTrades, mapAssignmentsToLinks } from '../src/context/cloudStateUtils.js';

interface DbState {
  profiles: Record<string, any>[];
  mt5_accounts: Record<string, any>[];
  mentor_assignments: Record<string, any>[];
  bridge_instructions: Record<string, any>[];
  trade_mappings: Record<string, any>[];
  bridge_sync_logs: Record<string, any>[];
  trades: Record<string, any>[];
  audit_logs: Record<string, any>[];
}

function createMockSupabase(state: DbState) {
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
          const parts = f.expr.split(/,(?=[a-z_]+\.)/i);
          return parts.some((part) => {
            const eqMatch = part.match(/^([a-z_]+)\.eq\.(.+)$/i);
            if (eqMatch) return String(row[eqMatch[1]]) === eqMatch[2];
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
        if (!table) return { data: null, error: { message: `Table ${String(tableName)} not found` } };

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
            const existing =
              conflictCols.length > 0
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
          for (const row of matched) Object.assign(row, payload);
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
        if (limitNum !== null) matched = matched.slice(0, limitNum);
        return { data: matched.map((r) => ({ ...r })), error: null };
      };

      const builder: any = {
        select() {
          if (mode === 'select') mode = 'select';
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
          if (!res.data || res.data.length === 0) return { data: null, error: { message: 'Row not found' } };
          return { data: res.data[0], error: null };
        },
        then(resolve: any, reject: any) {
          return execute().then(resolve, reject);
        },
      };
      return builder;
    },
    auth: {
      async getUser(jwt: string) {
        if (jwt === 'jwt-admin') return { data: { user: { id: state.profiles[0].id, email: state.profiles[0].email } }, error: null };
        if (jwt === 'jwt-mentor') return { data: { user: { id: state.profiles[1].id, email: state.profiles[1].email } }, error: null };
        if (jwt === 'jwt-trader') return { data: { user: { id: state.profiles[2].id, email: state.profiles[2].email } }, error: null };
        if (jwt === 'jwt-other') return { data: { user: { id: state.profiles[3].id, email: state.profiles[3].email } }, error: null };
        return { data: { user: null }, error: { message: 'Invalid JWT' } };
      },
    },
  };
}

async function runTests() {
  console.log('=== P0 Student Privacy, Lot-Settings Enforcement & Registration UI Tests ===');

  const adminId = crypto.randomUUID();
  const mentorId = crypto.randomUUID();
  const traderId = crypto.randomUUID();
  const otherTraderId = crypto.randomUUID();

  const parentAccId = crypto.randomUUID();
  const childAccId = crypto.randomUUID();
  const otherChildAccId = crypto.randomUUID();
  const assignId = crypto.randomUUID();

  const state: DbState = {
    profiles: [
      { id: adminId, email: 'admin@tradesync.local', full_name: 'Admin', role: 'admin', status: 'active' },
      { id: mentorId, email: 'mentor-secret@tradesync.local', full_name: 'Gold Master Mentor', role: 'mentor', status: 'active' },
      { id: traderId, email: 'student1@tradesync.local', full_name: 'Student One', role: 'trader', status: 'active' },
      { id: otherTraderId, email: 'student2@tradesync.local', full_name: 'Student Two', role: 'trader', status: 'active' },
    ],
    mt5_accounts: [
      {
        id: parentAccId,
        user_id: mentorId,
        account_number: '99001122',
        broker_name: 'XM Global',
        broker_server: 'XMGlobal-MT5 7',
        account_role: 'parent',
        account_type: 'demo',
        balance: 100000,
        equity: 101500,
        margin: 0,
        free_margin: 101500,
        currency: 'USD',
        leverage: 500,
        connection_status: 'connected',
        last_sync: new Date().toISOString(),
        auto_trading_enabled: true,
      },
      {
        id: childAccId,
        user_id: traderId,
        account_number: '77001122',
        broker_name: 'IC Markets',
        broker_server: 'ICMarketsSC-Demo',
        account_role: 'child',
        account_type: 'demo',
        trading_symbol: 'XAUUSD',
        balance: 5000,
        equity: 5120,
        verified_balance: 5000,
        verified_equity: 5120,
        verified_symbol_specs: {
          XAUUSD: { minLot: 0.1, maxLot: 5.0, lotStep: 0.1 },
        },
        margin: 250,
        free_margin: 4870,
        currency: 'USD',
        leverage: 200,
        connection_status: 'connected',
        last_sync: new Date().toISOString(),
        auto_trading_enabled: true,
      },
      {
        id: otherChildAccId,
        user_id: otherTraderId,
        account_number: '77009999',
        broker_name: 'XM Global',
        broker_server: 'XMGlobal-MT5 2',
        account_role: 'child',
        account_type: 'demo',
        trading_symbol: 'GOLD',
        balance: 2500,
        equity: 2500,
        margin: 0,
        free_margin: 2500,
        currency: 'USD',
        leverage: 100,
        connection_status: 'connected',
        last_sync: new Date().toISOString(),
        auto_trading_enabled: true,
      },
    ],
    mentor_assignments: [
      {
        id: assignId,
        mentor_id: mentorId,
        trader_id: traderId,
        parent_account_id: parentAccId,
        child_account_id: childAccId,
        status: 'active',
        lot_mode: 'parent_lot',
        lot_multiplier: 1.0,
        fixed_lot: 0.2,
        risk_percent: 1.0,
        max_lot_cap: 50.0,
        min_lot_clamp: 0.01,
        slippage_max_pips: 3.0,
        max_drawdown_percent: 20.0,
        sync_sl_tp: true,
        copy_pending_orders: false,
        symbol_prefix: '',
        symbol_suffix: '',
        suspended_by: adminId,
        assigned_at: new Date().toISOString(),
      },
    ],
    bridge_instructions: [],
    trade_mappings: [
      {
        id: crypto.randomUUID(),
        parent_trade_ticket: '88112233',
        child_trade_ticket: '55112233',
        parent_account_id: parentAccId,
        child_account_id: childAccId,
        symbol: 'XAUUSD',
        order_type: 'BUY',
        parent_lots: 2.5,
        child_lots: 0.2,
        open_time: new Date().toISOString(),
        latency_ms: 42,
        status: 'EXECUTED',
        retry_count: 0,
        parent_profit_usd: 450.25,
        child_profit_usd: 36.02,
      },
    ],
    bridge_sync_logs: [],
    trades: [
      {
        id: crypto.randomUUID(),
        ticket: '88112233',
        account_id: parentAccId,
        symbol: 'XAUUSD',
        type: 'BUY',
        volume: 2.5,
        open_price: 2650.5,
        profit: 450.25,
        status: 'OPEN',
        open_time: new Date().toISOString(),
      },
      {
        id: crypto.randomUUID(),
        ticket: '55112233',
        account_id: childAccId,
        parent_ticket: '88112233',
        symbol: 'XAUUSD',
        type: 'BUY',
        volume: 0.2,
        open_price: 2650.7,
        profit: 36.02,
        status: 'OPEN',
        open_time: new Date().toISOString(),
      },
    ],
    audit_logs: [],
  };

  const mockSupabase = createMockSupabase(state) as any;
  const tokenMap = new Map<string, string>([
    ['jwt-admin', adminId],
    ['jwt-mentor', mentorId],
    ['jwt-trader', traderId],
    ['jwt-other', otherTraderId],
  ]);
  const app = createApiApp({
    supabaseUrlOverride: 'https://mock.supabase.co',
    serviceRoleKeyOverride: 'mock-service-role-key',
    serviceRoleClientOverride: mockSupabase,
    authUserResolverOverride: async (token: string) => {
      const uid = tokenMap.get(token);
      if (!uid) return { user: null, error: 'Invalid token' };
      const profile = state.profiles.find((p) => p.id === uid);
      return { user: { id: uid, email: profile?.email }, error: null };
    },
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // =========================================================================
    // FIX 1: Student API Privacy across 4 endpoints
    // =========================================================================

    // 1a. GET /api/v1/bridge/mentors/directory
    const stuDirRes = await fetch(`${baseUrl}/api/v1/bridge/mentors/directory`, {
      headers: { Authorization: 'Bearer jwt-trader' },
    });
    assert.strictEqual(stuDirRes.status, 200);
    const stuDirText = await stuDirRes.text();
    const stuDirJson = JSON.parse(stuDirText);
    assert.strictEqual(stuDirJson.mentors.length, 1);
    const stuMentor = stuDirJson.mentors[0];
    assert.strictEqual(stuMentor.fullName, 'Gold Master Mentor');
    assert.strictEqual(stuMentor.inviteCode, `TS-${mentorId.slice(0, 8).toUpperCase()}`);
    assert.strictEqual(stuMentor.connectionStatus, 'connected');
    assert.strictEqual(stuMentor.parentAccountNumber, undefined);
    assert.strictEqual(stuMentor.parentAccountId, undefined);
    assert.strictEqual(stuMentor.brokerName, undefined);
    assert.strictEqual(stuMentor.brokerServer, undefined);
    assert.strictEqual(stuMentor.activeFollowersCount, undefined);
    assert.ok(!stuDirText.includes('99001122'), 'Parent MT5 login must never appear in student directory');
    assert.ok(!stuDirText.includes(parentAccId), 'Parent account UUID must never appear in student directory');

    const mentorDirRes = await fetch(`${baseUrl}/api/v1/bridge/mentors/directory`, {
      headers: { Authorization: 'Bearer jwt-mentor' },
    });
    assert.strictEqual(mentorDirRes.status, 200);
    const mentorDirJson = await mentorDirRes.json();
    assert.strictEqual(mentorDirJson.mentors[0].parentAccountNumber, '99001122');
    assert.strictEqual(mentorDirJson.mentors[0].parentAccountId, parentAccId);
    assert.strictEqual(mentorDirJson.mentors[0].activeFollowersCount, 1);

    // 1b. GET /api/v1/bridge/my-accounts
    const stuMyAccRes = await fetch(`${baseUrl}/api/v1/bridge/my-accounts`, {
      headers: { Authorization: 'Bearer jwt-trader' },
    });
    assert.strictEqual(stuMyAccRes.status, 200);
    const stuMyAccText = await stuMyAccRes.text();
    const stuMyAccJson = JSON.parse(stuMyAccText);
    assert.strictEqual(stuMyAccJson.accounts.length, 1);
    assert.strictEqual(stuMyAccJson.accounts[0].account_number, '77001122');
    assert.strictEqual(stuMyAccJson.accounts[0].assigned_parent_id, undefined);
    assert.deepStrictEqual(stuMyAccJson.accounts[0].verified_symbol_specs, {
      XAUUSD: { minLot: 0.1, maxLot: 5.0, lotStep: 0.1 },
    });
    assert.strictEqual(stuMyAccJson.linkedAccounts.length, 0);
    assert.strictEqual(stuMyAccJson.assignments.length, 1);
    assert.strictEqual(stuMyAccJson.assignments[0].parent_account_id, undefined);
    assert.strictEqual(stuMyAccJson.assignments[0].suspended_by, undefined);
    assert.strictEqual(stuMyAccJson.trades.length, 1);
    assert.strictEqual(stuMyAccJson.trades[0].ticket, '55112233');
    assert.strictEqual(stuMyAccJson.trades[0].parent_ticket, undefined);
    const mentorPeerProfile = stuMyAccJson.profiles.find((p: any) => p.id === mentorId);
    assert.strictEqual(mentorPeerProfile?.email, undefined, 'Peer mentor email must not leak to student');
    assert.ok(!stuMyAccText.includes('99001122'), 'Parent account number must never leak in student my-accounts');
    assert.ok(!stuMyAccText.includes(parentAccId), 'Parent account ID must never leak in student my-accounts');
    assert.ok(!stuMyAccText.includes('88112233'), 'Parent ticket must never leak in student my-accounts');
    assert.ok(!stuMyAccText.includes('mentor-secret@tradesync.local'));

    const mentorMyAccRes = await fetch(`${baseUrl}/api/v1/bridge/my-accounts`, {
      headers: { Authorization: 'Bearer jwt-mentor' },
    });
    assert.strictEqual(mentorMyAccRes.status, 200);
    const mentorMyAccJson = await mentorMyAccRes.json();
    assert.strictEqual(mentorMyAccJson.linkedAccounts.length, 1);
    assert.strictEqual(mentorMyAccJson.assignments[0].parent_account_id, parentAccId);

    // 1c. GET /api/v1/bridge/mappings
    const stuMapRes = await fetch(`${baseUrl}/api/v1/bridge/mappings`, {
      headers: { Authorization: 'Bearer jwt-trader' },
    });
    assert.strictEqual(stuMapRes.status, 200);
    const stuMapText = await stuMapRes.text();
    const stuMapJson = JSON.parse(stuMapText);
    assert.strictEqual(stuMapJson.mappings.length, 1);
    const m0 = stuMapJson.mappings[0];
    assert.strictEqual(m0.childTradeTicket, '55112233');
    assert.strictEqual(m0.childLots, 0.2);
    assert.strictEqual(m0.childProfitUSD, 36.02);
    assert.strictEqual(m0.parentTradeTicket, undefined);
    assert.strictEqual(m0.parentLots, undefined);
    assert.strictEqual(m0.parentProfitUSD, undefined);
    assert.strictEqual(m0.parentAccountId, undefined);
    assert.strictEqual(m0.parent_ticket, undefined);
    assert.ok(!stuMapText.includes('88112233'), 'Parent ticket must never appear in student mappings');
    assert.ok(!stuMapText.includes(parentAccId), 'Parent account ID must never appear in student mappings');
    assert.ok(!stuMapText.includes('450.25'), 'Parent profit must never appear in student mappings');

    const mentorMapRes = await fetch(`${baseUrl}/api/v1/bridge/mappings`, {
      headers: { Authorization: 'Bearer jwt-mentor' },
    });
    assert.strictEqual(mentorMapRes.status, 200);
    const mentorMapJson = await mentorMapRes.json();
    assert.strictEqual(mentorMapJson.mappings[0].parentTradeTicket, '88112233');
    assert.strictEqual(mentorMapJson.mappings[0].parentLots, 2.5);
    assert.strictEqual(mentorMapJson.mappings[0].parentProfitUSD, 450.25);

    // 1d. GET /api/v1/bridge/trades
    const stuTradesRes = await fetch(`${baseUrl}/api/v1/bridge/trades`, {
      headers: { Authorization: 'Bearer jwt-trader' },
    });
    assert.strictEqual(stuTradesRes.status, 200);
    const stuTradesText = await stuTradesRes.text();
    const stuTradesJson = JSON.parse(stuTradesText);
    assert.strictEqual(stuTradesJson.trades.length, 1);
    assert.strictEqual(stuTradesJson.trades[0].ticket, '55112233');
    assert.strictEqual(stuTradesJson.trades[0].parent_ticket, undefined);
    assert.ok(!stuTradesText.includes('88112233'), 'Parent ticket must never leak in student trades');

    // Verify client helpers handle redacted student responses cleanly without 'undefined' strings
    const rebuilt = buildCloudTrades([], stuMapJson.mappings);
    assert.strictEqual(rebuilt.length, 1);
    assert.strictEqual(rebuilt[0].ticket, '55112233');
    const redactedPendingMap = { ...stuMapJson.mappings[0], childTradeTicket: '0' };
    const rebuiltPending = buildCloudTrades([], [redactedPendingMap]);
    assert.ok(!String(rebuiltPending[0].ticket).includes('undefined'));
    const mappedLinks = mapAssignmentsToLinks(stuMyAccJson.assignments, stuMyAccJson.profiles, stuMapJson.mappings, []);
    assert.strictEqual(mappedLinks[0].totalTradesCopied, 1);

    console.log('[PASS] FIX 1: Student API privacy enforced across all 4 bridge endpoints & preserved for Mentor/Admin.');

    // =========================================================================
    // FIX 2: Student Lot-Settings Backend Enforcement
    // =========================================================================
    const lotUrl = `${baseUrl}/api/v1/bridge/assignments/${assignId}/lot-settings`;
    const studentDirectAttacks: Array<{ name: string; body: Record<string, any>; expectedCode: string }> = [
      { name: 'equity_ratio mode', body: { copyMode: 'equity_ratio', multiplier: 1.0 }, expectedCode: 'STUDENT_LOT_MODE_RESTRICTED' },
      { name: 'risk_percent mode', body: { copyMode: 'risk_percent', multiplier: 1.0 }, expectedCode: 'STUDENT_LOT_MODE_RESTRICTED' },
      { name: 'customType risk_percent bypass', body: { mode: 'parent_lot', customType: 'risk_percent' }, expectedCode: 'STUDENT_LOT_MODE_RESTRICTED' },
      { name: 'copyPendingOrders true', body: { copyMode: 'parent_lot', copyPendingOrders: true }, expectedCode: 'STUDENT_PENDING_ORDERS_FORBIDDEN' },
      { name: 'syncSlTp false', body: { copyMode: 'parent_lot', syncSlTp: false }, expectedCode: 'STUDENT_SL_TP_SYNC_REQUIRED' },
      { name: 'non-empty symbolPrefix', body: { copyMode: 'parent_lot', symbolPrefix: 'fx.' }, expectedCode: 'STUDENT_SYMBOL_AFFIX_FORBIDDEN' },
      { name: 'non-empty symbolSuffix', body: { copyMode: 'parent_lot', symbolSuffix: '.m' }, expectedCode: 'STUDENT_SYMBOL_AFFIX_FORBIDDEN' },
      { name: 'riskPercent field', body: { copyMode: 'parent_lot', riskPercent: 2.5 }, expectedCode: 'UNSUPPORTED_STUDENT_LOT_FIELD' },
      { name: 'maxLotCap field', body: { copyMode: 'parent_lot', maxLotCap: 10 }, expectedCode: 'UNSUPPORTED_STUDENT_LOT_FIELD' },
      { name: 'minLotClamp field', body: { copyMode: 'parent_lot', minLotClamp: 0.05 }, expectedCode: 'UNSUPPORTED_STUDENT_LOT_FIELD' },
      { name: 'maxDrawdownProtectionPercent field', body: { copyMode: 'parent_lot', maxDrawdownProtectionPercent: 5 }, expectedCode: 'UNSUPPORTED_STUDENT_LOT_FIELD' },
      { name: 'maxDrawdownPercent field', body: { copyMode: 'parent_lot', maxDrawdownPercent: 5 }, expectedCode: 'UNSUPPORTED_STUDENT_LOT_FIELD' },
      { name: 'slippageMaxPips field', body: { copyMode: 'parent_lot', slippageMaxPips: 15 }, expectedCode: 'UNSUPPORTED_STUDENT_LOT_FIELD' },
      { name: 'unknown key', body: { copyMode: 'parent_lot', adminOverride: true }, expectedCode: 'UNSUPPORTED_STUDENT_LOT_FIELD' },
    ];

    for (const atk of studentDirectAttacks) {
      const r = await fetch(lotUrl, {
        method: 'POST',
        headers: { Authorization: 'Bearer jwt-trader', 'Content-Type': 'application/json' },
        body: JSON.stringify(atk.body),
      });
      assert.strictEqual(r.status, 400, `Expected 400 for student attack "${atk.name}", got ${r.status}`);
      const j = await r.json();
      assert.strictEqual(j.code, atk.expectedCode, `Expected code ${atk.expectedCode} for "${atk.name}", got ${j.code}`);
    }

    // Verified broker volume validation without silently increasing lot size (minLot=0.10, maxLot=5.0, lotStep=0.10)
    const belowBrokerMinRes = await fetch(lotUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-trader', 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyMode: 'fixed', fixedLot: 0.05 }),
    });
    assert.strictEqual(belowBrokerMinRes.status, 400);
    const belowMinJson = await belowBrokerMinRes.json();
    assert.strictEqual(belowMinJson.code, 'BROKER_VOLUME_BELOW_MIN');
    assert.ok(String(belowMinJson.error).includes('silently increased'));

    const aboveBrokerMaxRes = await fetch(lotUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-trader', 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyMode: 'fixed', fixedLot: 6.0 }),
    });
    assert.strictEqual(aboveBrokerMaxRes.status, 400);
    const aboveMaxJson = await aboveBrokerMaxRes.json();
    assert.strictEqual(aboveMaxJson.code, 'BROKER_VOLUME_ABOVE_MAX');

    const stepMismatchRes = await fetch(lotUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-trader', 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyMode: 'fixed', fixedLot: 0.15 }),
    });
    assert.strictEqual(stepMismatchRes.status, 400);
    const stepJson = await stepMismatchRes.json();
    assert.strictEqual(stepJson.code, 'BROKER_VOLUME_STEP_MISMATCH');

    // Valid student lot modes: fixed (aligned to broker step), multiplier, parent_lot
    for (const validBody of [
      { copyMode: 'fixed', fixedLot: 0.3, syncSlTp: true, copyPendingOrders: false },
      { copyMode: 'multiplier', multiplier: 0.5 },
      { copyMode: 'parent_lot' },
    ]) {
      const okRes = await fetch(lotUrl, {
        method: 'POST',
        headers: { Authorization: 'Bearer jwt-trader', 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      assert.strictEqual(okRes.status, 200);
      const okJson = await okRes.json();
      assert.strictEqual(okJson.assignment.copy_pending_orders, false);
      assert.strictEqual(okJson.assignment.sync_sl_tp, true);
      assert.strictEqual(okJson.assignment.symbol_prefix, '');
      assert.strictEqual(okJson.assignment.symbol_suffix, '');
    }

    // Also verify /api/v1/bridge/accounts/register and /api/v1/bridge/assignments/join enforce student restrictions
    const regAttack = await fetch(`${baseUrl}/api/v1/bridge/accounts/register`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-other', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountRole: 'child',
        brokerName: 'XM Global',
        brokerServer: 'XMGlobal-MT5 2',
        accountNumber: '77008888',
        accountType: 'demo',
        lotSettings: { copyMode: 'equity_ratio', maxLotCap: 5 },
      }),
    });
    assert.strictEqual(regAttack.status, 400);

    const joinAttack = await fetch(`${baseUrl}/api/v1/bridge/assignments/join`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-other', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteCodeOrMentorId: `TS-${mentorId.slice(0, 8).toUpperCase()}`,
        childAccountId: otherChildAccId,
        lotSettings: { copyMode: 'multiplier', multiplier: 1.0, slippageMaxPips: 15 },
      }),
    });
    assert.strictEqual(joinAttack.status, 400);

    // Admin retains unrestricted full 12-control access
    const adminLotRes = await fetch(lotUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        copyMode: 'risk_percent',
        riskPercent: 2.0,
        maxLotCap: 10.0,
        minLotClamp: 0.1,
        maxDrawdownProtectionPercent: 12.0,
        slippageMaxPips: 25.0,
        copyPendingOrders: true,
        syncSlTp: false,
        symbolPrefix: 'fx.',
        symbolSuffix: '.pro',
      }),
    });
    assert.strictEqual(adminLotRes.status, 200);
    const adminLotJson = await adminLotRes.json();
    assert.strictEqual(adminLotJson.assignment.lot_mode, 'risk_percent');
    assert.strictEqual(adminLotJson.assignment.copy_pending_orders, true);
    assert.strictEqual(adminLotJson.assignment.sync_sl_tp, false);
    assert.strictEqual(adminLotJson.assignment.symbol_prefix, 'fx.');
    assert.strictEqual(adminLotJson.assignment.symbol_suffix, '.pro');

    console.log('[PASS] FIX 2: Student lot-settings direct API bypasses blocked (400), broker volume limits enforced, Admin access preserved.');

    // =========================================================================
    // FIX 3: Student Registration UI & Client Payload Guards
    // =========================================================================
    const registerModalSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/admin/RegisterMT5AccountModal.tsx'),
      'utf-8'
    );
    const connectChildSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/trader/ConnectChildAccountModal.tsx'),
      'utf-8'
    );
    const appCtxSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/context/AppContext.tsx'),
      'utf-8'
    );

    assert.ok(connectChildSrc.includes('RegisterMT5AccountModal'), 'ConnectChildAccountModal wraps RegisterMT5AccountModal');
    assert.ok(connectChildSrc.includes('defaultRole="child"'));
    assert.ok(
      registerModalSrc.includes("accountRole === 'child' && isAdminCaller"),
      'Parent Mentor Account & Lot Copy Mode block must be strictly Admin-only'
    );
    assert.ok(
      !registerModalSrc.includes('followerAccounts'),
      'RegisterMT5AccountModal must not read followerAccounts for parent dropdowns'
    );
    assert.ok(
      registerModalSrc.includes("accountRole === 'child' && !isAdminCaller"),
      'Student child registration renders student-only lot size control'
    );
    assert.ok(
      registerModalSrc.includes('Default Copied Lot Size'),
      'Student registration renders Default Copied Lot Size control'
    );
    assert.ok(
      appCtxSrc.includes("currentUser.role === 'admin' ? adminPayload : studentPayload"),
      'AppContext must send only student-permitted lot payload for non-admin callers'
    );

    console.log('[PASS] FIX 3: Student registration UI removes Parent Mentor dropdown and Lot Copy Mode selector while preserving Admin/Mentor flows.');
    console.log('\nALL P0 STUDENT PRIVACY & LOT ENFORCEMENT TESTS PASSED.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
