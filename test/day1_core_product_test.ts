import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApiApp } from '../src/server/apiApp.js';
import { RiskEngine } from '../src/server/riskEngine.js';
import {
  buildCloudTrades,
  computeReportingSummary,
  mapAssignmentsToLinks,
} from '../src/context/cloudStateUtils.js';

interface DbState {
  profiles: Record<string, any>[];
  mentor_profiles: Record<string, any>[];
  mt5_accounts: Record<string, any>[];
  mentor_assignments: Record<string, any>[];
  bridge_instructions: Record<string, any>[];
  trade_mappings: Record<string, any>[];
  bridge_sync_logs: Record<string, any>[];
  trades: Record<string, any>[];
  subscription_plans: Record<string, any>[];
  subscriptions: Record<string, any>[];
}

function createDay1MockSupabase(state: DbState) {
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
          if (f.expr.includes('status.eq.QUEUED')) {
            if (row.status === 'QUEUED') return true;
            if (row.status === 'IN_FLIGHT' && row.lease_expires_at) {
              return new Date(row.lease_expires_at).getTime() < Date.now();
            }
            return false;
          }
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
          const inserted = items.map((item) => ({
            id: item.id || crypto.randomUUID(),
            created_at: item.created_at || new Date().toISOString(),
            ...item,
          }));
          table.push(...inserted);
          return { data: inserted, error: null };
        }

        if (mode === 'upsert') {
          const items = Array.isArray(payload) ? payload : [payload];
          const conflictCols = upsertOnConflict ? upsertOnConflict.split(',').map((s) => s.trim()) : ['id'];
          const out: any[] = [];
          for (const item of items) {
            const idx = table.findIndex((r) => conflictCols.every((c) => r[c] === item[c]));
            if (idx >= 0) {
              table[idx] = { ...table[idx], ...item, updated_at: new Date().toISOString() };
              out.push(table[idx]);
            } else {
              const row = {
                id: item.id || crypto.randomUUID(),
                created_at: item.created_at || new Date().toISOString(),
                ...item,
              };
              table.push(row);
              out.push(row);
            }
          }
          return { data: out, error: null };
        }

        if (mode === 'update') {
          const matched = applyFilters(table, filters);
          for (const row of matched) {
            Object.assign(row, payload);
          }
          return { data: matched, error: null };
        }

        if (mode === 'delete') {
          const matchedIds = new Set(applyFilters(table, filters).map((r) => r.id));
          const deleted = table.filter((r) => matchedIds.has(r.id));
          state[tableName] = table.filter((r) => !matchedIds.has(r.id)) as any;
          return { data: deleted, error: null };
        }

        let res = [...applyFilters(table, filters)];
        if (orderCol) {
          res.sort((a, b) => {
            const av = a[orderCol!] ?? '';
            const bv = b[orderCol!] ?? '';
            if (av < bv) return orderAsc ? -1 : 1;
            if (av > bv) return orderAsc ? 1 : -1;
            return 0;
          });
        }
        if (limitNum != null) res = res.slice(0, limitNum);
        return { data: res, error: null };
      };

      const builder: any = {
        select: () => builder,
        insert: (data: any) => {
          mode = 'insert';
          payload = data;
          return builder;
        },
        update: (data: any) => {
          mode = 'update';
          payload = data;
          return builder;
        },
        upsert: (data: any, opts?: { onConflict?: string }) => {
          mode = 'upsert';
          payload = data;
          upsertOnConflict = opts?.onConflict || null;
          return builder;
        },
        delete: () => {
          mode = 'delete';
          return builder;
        },
        eq: (col: string, val: any) => {
          filters.push({ op: 'eq', col, val });
          return builder;
        },
        neq: (col: string, val: any) => {
          filters.push({ op: 'neq', col, val });
          return builder;
        },
        in: (col: string, val: any[]) => {
          filters.push({ op: 'in', col, val });
          return builder;
        },
        or: (expr: string) => {
          filters.push({ op: 'or', expr });
          return builder;
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          orderCol = col;
          orderAsc = opts?.ascending !== false;
          return builder;
        },
        limit: (n: number) => {
          limitNum = n;
          return builder;
        },
        single: async () => {
          const r = await execute();
          if (r.error) return { data: null, error: r.error };
          if (!r.data || r.data.length === 0) return { data: null, error: { message: 'No rows found' } };
          return { data: r.data[0], error: null };
        },
        maybeSingle: async () => {
          const r = await execute();
          if (r.error) return { data: null, error: r.error };
          return { data: r.data && r.data.length > 0 ? r.data[0] : null, error: null };
        },
        then: (resolve: any, reject: any) => execute().then(resolve, reject),
      };

      return builder;
    },
  };
}

async function runTests() {
  console.log('Running Day 1 Core Product Integration & Static Tests...\n');

  const sha256 = (val: string) => crypto.createHash('sha256').update(val).digest('hex');

  const adminId = '11111111-1111-4111-8111-111111111111';
  const mentor1Id = '22222222-2222-4222-8222-222222222222';
  const mentor2Id = '22222222-2222-4222-8222-222222222223';
  const traderId = '33333333-3333-4333-8333-333333333333';

  const parent1AccId = 'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const parent2AccId = 'aaaa2222-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const child1AccId = 'bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const child2AccId = 'bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

  const parent1Token = 'ts_parent1_token';
  const parent2Token = 'ts_parent2_token';
  const child1Token = 'ts_child1_token';
  const child2Token = 'ts_child2_token';

  const nowIso = new Date().toISOString();

  const state: DbState = {
    profiles: [
      { id: adminId, email: 'admin@tradesync.io', full_name: 'Admin', role: 'admin', status: 'active' },
      { id: mentor1Id, email: 'mentor1@tradesync.io', full_name: 'Mentor Alpha', role: 'mentor', status: 'active' },
      { id: mentor2Id, email: 'mentor2@tradesync.io', full_name: 'Mentor Beta', role: 'mentor', status: 'active' },
      { id: traderId, email: 'trader@tradesync.io', full_name: 'Multi Child Trader', role: 'trader', status: 'active' },
    ],
    mentor_profiles: [
      { user_id: mentor1Id, strategy_name: 'Alpha Macro', monthly_fee: 99, invite_code: 'TS-ALPHA', is_verified: true },
      { user_id: mentor2Id, strategy_name: 'Beta Scalper', monthly_fee: 149, invite_code: 'TS-BETA', is_verified: true },
    ],
    mt5_accounts: [
      {
        id: parent1AccId,
        user_id: mentor1Id,
        account_role: 'parent',
        account_number: '5001001',
        broker_name: 'XM',
        broker_server: 'xmglobal_mt5 7',
        account_type: 'demo',
        balance: 50000,
        equity: 50000,
        margin: 0,
        free_margin: 50000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        ping_ms: 0,
        auto_trading_enabled: true,
        terminal_token_hash: sha256(parent1Token),
        last_sync: nowIso,
        created_at: nowIso,
      },
      {
        id: parent2AccId,
        user_id: mentor2Id,
        account_role: 'parent',
        account_number: '5002002',
        broker_name: 'XM',
        broker_server: 'xmglobal_mt5 7',
        account_type: 'demo',
        balance: 25000,
        equity: 25000,
        margin: 0,
        free_margin: 25000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'connected',
        ping_ms: 15,
        auto_trading_enabled: true,
        terminal_token_hash: sha256(parent2Token),
        last_sync: nowIso,
        created_at: nowIso,
      },
      {
        id: child1AccId,
        user_id: traderId,
        account_role: 'child',
        account_number: '6001001',
        broker_name: 'XM',
        broker_server: 'xmglobal_mt5 2',
        account_type: 'demo',
        balance: 10000,
        equity: 10000,
        verified_balance: 10000,
        verified_equity: 10000,
        balance_verified_at: nowIso,
        verified_symbol_specs: {
          'EURUSD.pro': { minLot: 0.01, maxLot: 100, lotStep: 0.01 },
        },
        margin: 0,
        free_margin: 10000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        ping_ms: 0,
        auto_trading_enabled: true,
        terminal_token_hash: sha256(child1Token),
        last_sync: nowIso,
        created_at: nowIso,
      },
      {
        id: child2AccId,
        user_id: traderId,
        account_role: 'child',
        account_number: '6002002',
        broker_name: 'ICMarkets',
        broker_server: 'ICMarketsSC-Demo',
        account_type: 'demo',
        balance: 10000,
        equity: 10000,
        verified_balance: 10000,
        verified_equity: 10000,
        balance_verified_at: nowIso,
        verified_symbol_specs: {
          EURUSD: { minLot: 0.01, maxLot: 100, lotStep: 0.01 },
        },
        margin: 0,
        free_margin: 10000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'connected',
        ping_ms: 18,
        auto_trading_enabled: true,
        terminal_token_hash: sha256(child2Token),
        last_sync: nowIso,
        created_at: nowIso,
      },
    ],
    mentor_assignments: [],
    bridge_instructions: [],
    trade_mappings: [],
    bridge_sync_logs: [],
    trades: [],
    subscription_plans: [
      { id: 'plan-silver', code: 'silver', name: 'Silver', max_followers: 50, max_child_accounts: 50, is_active: true },
    ],
    subscriptions: [
      {
        id: 'sub-m1',
        user_id: mentor1Id,
        mentor_id: mentor1Id,
        plan_id: 'plan-silver',
        status: 'active',
        current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString(),
        created_at: nowIso,
      },
      {
        id: 'sub-m2',
        user_id: mentor2Id,
        mentor_id: mentor2Id,
        plan_id: 'plan-silver',
        status: 'active',
        current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString(),
        created_at: nowIso,
      },
    ],
  };

  const mockSupabase = createDay1MockSupabase(state);
  const tokenMap: Record<string, any> = {
    'jwt-admin': { id: adminId, email: 'admin@tradesync.io' },
    'jwt-mentor1': { id: mentor1Id, email: 'mentor1@tradesync.io' },
    'jwt-mentor2': { id: mentor2Id, email: 'mentor2@tradesync.io' },
    'jwt-trader': { id: traderId, email: 'trader@tradesync.io' },
  };

  const app = createApiApp({
    serviceRoleClientOverride: mockSupabase as any,
    supabaseUrlOverride: 'https://example.supabase.co',
    serviceRoleKeyOverride: 'service-role-test-key',
    authUserResolverOverride: async (token: string) => {
      const user = tokenMap[token];
      if (!user) return { user: null, error: { message: 'Invalid JWT' } };
      return { user, error: null };
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // -----------------------------------------------------------------------
    // 1. Migration 08 SQL static schema integrity verification
    // -----------------------------------------------------------------------
    const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    const mig08Src = read('supabase/migrations/08_day1_core_product_schema.sql');
    assert.strictEqual(mig08Src.includes("ARRAY['mentor_id', 'trader_id']"), true);
    assert.strictEqual(mig08Src.includes('DROP CONSTRAINT %I'), true);
    assert.strictEqual(mig08Src.includes('idx_mentor_assignments_active_child_unique'), true);
    for (const col of [
      'risk_percent',
      'max_lot_cap',
      'min_lot_clamp',
      'slippage_max_pips',
      'max_drawdown_percent',
      'sync_sl_tp',
      'copy_pending_orders',
      'symbol_prefix',
      'symbol_suffix',
    ]) {
      assert.strictEqual(mig08Src.includes(col), true, `Migration 08 must define ${col}`);
    }
    assert.strictEqual(mig08Src.includes('CREATE TABLE IF NOT EXISTS public.mentor_profiles'), true);
    assert.strictEqual(mig08Src.includes('is_realized'), true);
    assert.strictEqual(mig08Src.includes('idx_trades_account_ticket_unique'), true);
    assert.strictEqual(mig08Src.includes("IS DISTINCT FROM 'demo'"), true);
    console.log('[PASS] 1. Migration 08 SQL static schema verification passed.');

    // -----------------------------------------------------------------------
    // 2. Heartbeat-only connected status vs Dashboard disconnect
    // -----------------------------------------------------------------------
    const spoofConnRes = await fetch(`${baseUrl}/api/v1/bridge/accounts/${child1AccId}/connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ connectionStatus: 'connected' }),
    });
    assert.strictEqual(spoofConnRes.status, 403);
    const spoofConnJson: any = await spoofConnRes.json();
    assert.strictEqual(spoofConnJson.code, 'EA_HEARTBEAT_REQUIRED');

    const hbParentRes = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parent1Token },
      body: JSON.stringify({
        accountId: parent1AccId,
        accountNumber: '5001001',
        brokerName: 'XM',
        brokerServer: 'xmglobal_mt5 7',
        accountType: 'demo',
        balance: 50000,
        equity: 50000,
        margin: 0,
        freeMargin: 50000,
        pingMs: 11,
        autoTradingEnabled: true,
      }),
    });
    assert.strictEqual(hbParentRes.status, 200);
    assert.strictEqual(state.mt5_accounts.find((a) => a.id === parent1AccId)?.connection_status, 'connected');

    const hbChild1Res = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': child1Token },
      body: JSON.stringify({
        accountId: child1AccId,
        accountNumber: '6001001',
        brokerName: 'XM',
        brokerServer: 'xmglobal_mt5 2',
        accountType: 'demo',
        balance: 10000,
        equity: 10000,
        margin: 0,
        freeMargin: 10000,
        pingMs: 12,
        autoTradingEnabled: true,
      }),
    });
    assert.strictEqual(hbChild1Res.status, 200);
    assert.strictEqual(state.mt5_accounts.find((a) => a.id === child1AccId)?.connection_status, 'connected');

    const discChild1Res = await fetch(`${baseUrl}/api/v1/bridge/accounts/${child1AccId}/connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-trader' },
      body: JSON.stringify({ connectionStatus: 'disconnected' }),
    });
    assert.strictEqual(discChild1Res.status, 200);
    assert.strictEqual(state.mt5_accounts.find((a) => a.id === child1AccId)?.connection_status, 'disconnected');

    // Reconnect child1 via EA heartbeat for trade flow tests
    await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': child1Token },
      body: JSON.stringify({
        accountId: child1AccId,
        accountNumber: '6001001',
        brokerName: 'XM',
        brokerServer: 'xmglobal_mt5 2',
        accountType: 'demo',
        balance: 10000,
        equity: 10000,
        margin: 0,
        freeMargin: 10000,
        pingMs: 9,
        autoTradingEnabled: true,
      }),
    });
    console.log('[PASS] 2. Dashboard cannot spoof connected status; EA heartbeat sets connected and dashboard disconnect works.');

    // -----------------------------------------------------------------------
    // 3. Multi-child-account support & Full 12-control persistence
    // -----------------------------------------------------------------------
    const assign1Res = await fetch(`${baseUrl}/api/v1/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        mentorId: mentor1Id,
        traderId,
        parentAccountId: parent1AccId,
        childAccountId: child1AccId,
        lotSettings: {
          mode: 'custom_lot',
          customType: 'multiplier',
          multiplier: 0.5,
          fixedLot: 0.25,
          riskPercent: 1.5,
          maxLotCap: 2.0,
          minLotClamp: 0.05,
          maxDrawdownProtectionPercent: 15,
          copyPendingOrders: false,
          syncSlTp: false,
          slippageMaxPips: 12,
          symbolPrefix: 'fx.',
          symbolSuffix: '.m',
        },
      }),
    });
    assert.strictEqual(assign1Res.status, 200);
    const assign1Json: any = await assign1Res.json();
    const assign1Id = assign1Json.assignment.id;
    assert.strictEqual(assign1Json.persistedFields.length, 12);

    // Student attempt to enable copyPendingOrders / unsupported risk fields via join must be rejected (400)
    const blockedJoin2Res = await fetch(`${baseUrl}/api/v1/bridge/assignments/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-trader' },
      body: JSON.stringify({
        inviteCodeOrMentorId: mentor2Id,
        childAccountId: child2AccId,
        lotSettings: {
          mode: 'parent_lot',
          copyPendingOrders: true,
          riskPercent: 1.0,
        },
      }),
    });
    assert.strictEqual(blockedJoin2Res.status, 400);

    // Same trader links second child demo account to second mentor via invite join with permitted student settings
    const join2Res = await fetch(`${baseUrl}/api/v1/bridge/assignments/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-trader' },
      body: JSON.stringify({
        inviteCodeOrMentorId: mentor2Id,
        childAccountId: child2AccId,
        lotSettings: {
          mode: 'parent_lot',
          multiplier: 1.0,
          fixedLot: 0.1,
          copyPendingOrders: false,
          syncSlTp: true,
        },
      }),
    });
    assert.strictEqual(join2Res.status, 200);
    assert.strictEqual(state.mentor_assignments.filter((a) => a.status === 'active').length, 2);

    // Student attempt to disable syncSlTp or set symbolSuffix/riskPercent must be rejected (400)
    const blockedTraderUpdRes = await fetch(`${baseUrl}/api/v1/bridge/assignments/${assign1Id}/lot-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-trader' },
      body: JSON.stringify({
        mode: 'custom_lot',
        customType: 'multiplier',
        multiplier: 0.5,
        syncSlTp: false,
        symbolSuffix: '.pro',
      }),
    });
    assert.strictEqual(blockedTraderUpdRes.status, 400);

    // Admin updates all 12 controls on assign1
    const updLotRes = await fetch(`${baseUrl}/api/v1/bridge/assignments/${assign1Id}/lot-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        mode: 'custom_lot',
        customType: 'multiplier',
        multiplier: 0.5,
        fixedLot: 0.25,
        riskPercent: 2.0,
        maxLotCap: 2.0,
        minLotClamp: 0.05,
        maxDrawdownProtectionPercent: 15,
        copyPendingOrders: false,
        syncSlTp: false,
        slippageMaxPips: 15,
        symbolPrefix: '',
        symbolSuffix: '.pro',
      }),
    });
    assert.strictEqual(updLotRes.status, 200);
    const updLotJson: any = await updLotRes.json();
    assert.strictEqual(updLotJson.assignment.copy_pending_orders, false);
    assert.strictEqual(updLotJson.assignment.sync_sl_tp, false);
    assert.strictEqual(updLotJson.assignment.symbol_suffix, '.pro');
    assert.strictEqual(updLotJson.assignment.min_lot_clamp, 0.05);

    const mappedLinks = mapAssignmentsToLinks(state.mentor_assignments, state.profiles);
    assert.strictEqual(mappedLinks.length, 2);
    const link1 = mappedLinks.find((l) => l.childAccountId === child1AccId)!;
    assert.strictEqual(link1.lotSettings.copyPendingOrders, false);
    assert.strictEqual(link1.lotSettings.syncSlTp, false);
    assert.strictEqual(link1.lotSettings.symbolSuffix, '.pro');
    assert.strictEqual(link1.lotSettings.slippageMaxPips, 15);
    console.log('[PASS] 3. Multi-child-account isolation & all 12 risk controls persist and map cleanly.');

    // -----------------------------------------------------------------------
    // 4. RiskEngine unit validation (pending filter, minLotClamp reject, drawdown halt, maxLotCap, symbol affix)
    // -----------------------------------------------------------------------
    const baseSettings = RiskEngine.normalizeLotSettingsFromRow(state.mentor_assignments.find((a) => a.id === assign1Id));
    const pendingRes = RiskEngine.calculateChildLots({
      parentSymbol: 'EURUSD',
      parentLots: 1.0,
      orderType: 'BUY_LIMIT',
      lotSettings: baseSettings,
    });
    assert.strictEqual(pendingRes.valid, false);
    assert.ok(pendingRes.reason?.includes('copyPendingOrders'));

    // 0.06 * 0.5 = 0.03 < minLotClamp(0.05) -> must REJECT, never bump up!
    const belowMinRes = RiskEngine.calculateChildLots({
      parentSymbol: 'EURUSD',
      parentLots: 0.06,
      orderType: 'BUY',
      lotSettings: baseSettings,
    });
    assert.strictEqual(belowMinRes.valid, false);
    assert.ok(belowMinRes.reason?.includes('below minimum allowed lot'));

    // 10 * 0.5 = 5.0 > maxLotCap(2.0) -> clamps down to 2.0, plus applies .pro suffix
    const cappedRes = RiskEngine.calculateChildLots({
      parentSymbol: 'EURUSD',
      parentLots: 10.0,
      orderType: 'BUY',
      lotSettings: baseSettings,
    });
    assert.strictEqual(cappedRes.valid, true);
    assert.strictEqual(cappedRes.childLots, 2.0);
    assert.strictEqual(cappedRes.childSymbol, 'EURUSD.pro');

    // Drawdown halt: balance 10000, equity 8000 => 20% >= 15% max drawdown
    const ddRes = RiskEngine.calculateChildLots({
      parentSymbol: 'EURUSD',
      parentLots: 1.0,
      orderType: 'BUY',
      childBalance: 10000,
      childEquity: 8000,
      lotSettings: baseSettings,
    });
    assert.strictEqual(ddRes.valid, false);
    assert.ok(ddRes.reason?.toLowerCase().includes('drawdown'));
    console.log('[PASS] 4. RiskEngine enforces copyPendingOrders, strict min-lot rejection, max-lot cap, symbol affix, and drawdown halt.');

    // -----------------------------------------------------------------------
    // 5. Trade Sync + Risk Filtering + Durable public.trades Lifecycle
    // -----------------------------------------------------------------------
    // Pending order when copyPendingOrders=false on child1 -> SKIPPED
    const pendingOpenRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parent1Token },
      body: JSON.stringify({
        ticket: '1001',
        symbol: 'EURUSD',
        type: 'BUY_LIMIT',
        lots: 1.0,
        openPrice: 1.08,
      }),
    });
    assert.strictEqual(pendingOpenRes.status, 200);
    const pendingOpenJson: any = await pendingOpenRes.json();
    assert.strictEqual(pendingOpenJson.childInstructionsQueued, 0);
    assert.ok(state.bridge_sync_logs.some((l) => l.event_type === 'RISK_ENGINE_REJECTED'));

    // Volume below minLotClamp (0.06 * 0.5 = 0.03 < 0.05) -> SKIPPED
    const lowLotOpenRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parent1Token },
      body: JSON.stringify({
        ticket: '1002',
        symbol: 'EURUSD',
        type: 'BUY',
        lots: 0.06,
        openPrice: 1.085,
      }),
    });
    assert.strictEqual(lowLotOpenRes.status, 200);
    const lowLotOpenJson: any = await lowLotOpenRes.json();
    assert.strictEqual(lowLotOpenJson.childInstructionsQueued, 0);

    // Valid market OPEN with syncSlTp=false -> SL/TP stripped, symbol EURUSD.pro, slippageMaxPips=15
    const validOpenRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parent1Token },
      body: JSON.stringify({
        ticket: '1003',
        symbol: 'EURUSD',
        type: 'BUY',
        lots: 1.0,
        openPrice: 1.09,
        sl: 1.085,
        tp: 1.1,
      }),
    });
    assert.strictEqual(validOpenRes.status, 200);
    const validOpenJson: any = await validOpenRes.json();
    assert.strictEqual(validOpenJson.childInstructionsQueued, 1);

    // Verify parent trade persisted in public.trades (is_realized = false while open)
    const parentTradeRow = state.trades.find((t) => t.account_id === parent1AccId && t.ticket === '1003');
    assert.ok(parentTradeRow, 'Parent trade row should persist in public.trades on open');
    assert.strictEqual(parentTradeRow.status, 'OPEN');
    assert.strictEqual(parentTradeRow.is_realized, false);

    // Child polls pending instruction
    const pollRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/pending`, {
      headers: { 'X-Terminal-Token': child1Token },
    });
    assert.strictEqual(pollRes.status, 200);
    const pollJson: any = await pollRes.json();
    assert.strictEqual(pollJson.instructions.length, 1);
    const openInst = pollJson.instructions[0];
    assert.strictEqual(openInst.symbol, 'EURUSD.pro');
    assert.strictEqual(openInst.lots, 0.5);
    assert.strictEqual(openInst.hasSL, false, 'syncSlTp=false must strip SL');
    assert.strictEqual(openInst.hasTP, false, 'syncSlTp=false must strip TP');
    assert.strictEqual(openInst.slippageMaxPips, 15);

    // Modify parent -> skipped because syncSlTp=false
    const modSkipRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-modify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parent1Token },
      body: JSON.stringify({
        ticket: '1003',
        sl: 1.086,
        tp: 1.105,
      }),
    });
    assert.strictEqual(modSkipRes.status, 200);
    const modSkipJson: any = await modSkipRes.json();
    assert.strictEqual(modSkipJson.modifiedCount, 0);

    // Child ACKs OPEN with fillPrice and executedLots
    const ackOpenRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': child1Token },
      body: JSON.stringify({
        instructionId: openInst.instructionId,
        status: 'EXECUTED',
        childTicket: '9001003',
        fillPrice: 1.0901,
        executedLots: 0.5,
        executionLatencyMs: 42,
      }),
    });
    assert.strictEqual(ackOpenRes.status, 200);

    const childOpenTradeRow = state.trades.find((t) => t.account_id === child1AccId && t.ticket === '9001003');
    assert.ok(childOpenTradeRow, 'Child OPEN ACK must persist trade row in public.trades');
    assert.strictEqual(childOpenTradeRow.status, 'OPEN');
    assert.strictEqual(childOpenTradeRow.is_realized, false);

    // Proportional partial close on parent queues proportional partial CLOSE on child (0.25/1.0 * 0.5 = 0.12)
    const partialCloseRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parent1Token },
      body: JSON.stringify({
        ticket: '1003',
        closePrice: 1.092,
        closeType: 'PARTIAL',
        closedLots: 0.25,
        remainingLots: 0.75,
        realizedProfit: 50,
      }),
    });
    assert.strictEqual(partialCloseRes.status, 200);
    const partialCloseJson: any = await partialCloseRes.json();
    assert.strictEqual(partialCloseJson.partialCloseHandled, 'queued');
    assert.strictEqual(partialCloseJson.closeInstructionsQueued, 1);
    assert.strictEqual(partialCloseJson.instructions[0].lots, 0.12);
    assert.ok(state.bridge_sync_logs.some((l) => l.event_type === 'BRIDGE_PARENT_TRADE_PARTIAL_CLOSE'));

    // Child polls and ACKs partial close while keeping position OPEN at 0.38 lots remaining
    const pollPartialRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/pending`, {
      headers: { 'X-Terminal-Token': child1Token },
    });
    const pollPartialJson: any = await pollPartialRes.json();
    assert.strictEqual(pollPartialJson.instructions.length, 1);
    const partialInst = pollPartialJson.instructions[0];
    assert.strictEqual(partialInst.lots, 0.12);

    const ackPartialRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': child1Token },
      body: JSON.stringify({
        instructionId: partialInst.instructionId,
        status: 'EXECUTED',
        childTicket: '9001003',
        executedLots: 0.12,
        executionLatencyMs: 25,
      }),
    });
    assert.strictEqual(ackPartialRes.status, 200);
    assert.strictEqual(childOpenTradeRow.status, 'OPEN');
    assert.strictEqual(childOpenTradeRow.volume, 0.38);

    // Full close on parent with broker deal profit/commission/swap
    const fullCloseRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parent1Token },
      body: JSON.stringify({
        ticket: '1003',
        closeType: 'FULL',
        closePrice: 1.095,
        realizedProfit: 500,
        commission: -7,
        swap: -1.5,
      }),
    });
    assert.strictEqual(fullCloseRes.status, 200);
    const fullCloseJson: any = await fullCloseRes.json();
    assert.strictEqual(fullCloseJson.closeInstructionsQueued, 1);
    assert.strictEqual(parentTradeRow.status, 'CLOSED');
    assert.strictEqual(parentTradeRow.is_realized, true);
    assert.strictEqual(parentTradeRow.profit, 500);

    // Child polls CLOSE and ACKs with broker realizedProfit/commission/swap
    const pollCloseRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/pending`, {
      headers: { 'X-Terminal-Token': child1Token },
    });
    const pollCloseJson: any = await pollCloseRes.json();
    assert.strictEqual(pollCloseJson.instructions.length, 1);
    const closeInst = pollCloseJson.instructions[0];
    assert.strictEqual(closeInst.action, 'CLOSE');

    const ackCloseRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': child1Token },
      body: JSON.stringify({
        instructionId: closeInst.instructionId,
        status: 'EXECUTED',
        childTicket: '9001003',
        closePrice: 1.0949,
        realizedProfit: 245,
        commission: -3.5,
        swap: -0.75,
        executionLatencyMs: 38,
      }),
    });
    assert.strictEqual(ackCloseRes.status, 200);
    assert.strictEqual(childOpenTradeRow.status, 'CLOSED');
    assert.strictEqual(childOpenTradeRow.is_realized, true);
    assert.strictEqual(childOpenTradeRow.profit, 245);
    assert.strictEqual(childOpenTradeRow.commission, -3.5);
    assert.strictEqual(childOpenTradeRow.swap, -0.75);
    console.log('[PASS] 5. Full trade lifecycle persisted in public.trades with real deal profit/commission/swap & partial-close safety.');

    // -----------------------------------------------------------------------
    // 6. Reporting computation & missing-realized honesty
    // -----------------------------------------------------------------------
    const builtTrades = buildCloudTrades(state.trades, []);
    const childOnlyTrades = builtTrades.filter((t) => t.accountId === child1AccId);
    const childMappings = state.trade_mappings.map((m) => ({
      id: m.id,
      parentTradeTicket: m.parent_trade_ticket,
      childTradeTicket: m.child_trade_ticket || '0',
      mentorId: mentor1Id,
      traderId,
      parentAccountId: m.parent_account_id,
      childAccountId: m.child_account_id,
      symbol: m.symbol,
      orderType: m.order_type,
      parentLots: m.parent_lots,
      childLots: m.child_lots,
      openTime: m.open_time || nowIso,
      closeTime: m.close_time,
      latencyMs: m.latency_ms || 0,
      status: m.status,
    }));

    const report = computeReportingSummary({
      trades: childOnlyTrades,
      mappings: childMappings as any,
      accounts: [{ id: child1AccId, balance: 10245, equity: 10245, freeMargin: 10245 } as any],
      isCloudMode: true,
    });
    assert.strictEqual(report.realizedPnlAvailable, true);
    assert.strictEqual(report.realizedPnlUSD, 245);
    assert.strictEqual(report.winRatePercent, 100);
    assert.strictEqual(report.dailyRealizedUSD, 245);
    assert.strictEqual(report.avgCopyLatencyMs, 42);

    // Unsettled closed trade with no realized profit must NOT fabricate profit from balance/equity delta
    const unsettledReport = computeReportingSummary({
      trades: [
        {
          id: 't-unsettled',
          ticket: '777',
          accountId: child2AccId,
          symbol: 'GBPUSD',
          type: 'BUY',
          lots: 0.1,
          openPrice: 1.25,
          currentPrice: 1.26,
          profit: 0,
          openTime: nowIso,
          closeTime: nowIso,
          status: 'CLOSED',
          isRealized: false,
        },
      ],
      mappings: [],
      accounts: [{ id: child2AccId, balance: 15000, equity: 15500, freeMargin: 15500 } as any],
      isCloudMode: true,
    });
    assert.strictEqual(unsettledReport.realizedPnlAvailable, false);
    assert.strictEqual(unsettledReport.winRatePercent, null);
    assert.strictEqual(unsettledReport.dailyRealizedUSD, null);
    console.log('[PASS] 6. Reporting computation computes win rate/PF/period realized P&L accurately and refuses balance-delta fabrication.');

    // -----------------------------------------------------------------------
    // 7. MQL5 Broadcaster & Receiver & Frontend static safety/feature checks
    // -----------------------------------------------------------------------
    const broadcasterSrc = read('public/mql5/TradeSync_Broadcaster.mq5');
    assert.strictEqual(broadcasterSrc.includes('ACCOUNT_TRADE_MODE_DEMO'), true);
    assert.strictEqual(broadcasterSrc.includes('EnsureDemoAccount'), true);
    assert.strictEqual(broadcasterSrc.includes('DEAL_PROFIT'), true);
    assert.strictEqual(broadcasterSrc.includes('realizedProfit'), true);

    const receiverSrc = read('public/mql5/TradeSync_Receiver.mq5');
    assert.strictEqual(receiverSrc.includes('ACCOUNT_TRADE_MODE_DEMO'), true);
    assert.strictEqual(receiverSrc.includes('EnsureDemoAccount'), true);
    assert.strictEqual(receiverSrc.includes('slippageMaxPips'), true);
    assert.strictEqual(receiverSrc.includes('realizedProfit'), true);
    assert.strictEqual(receiverSrc.includes('if(lots < minLot - 1e-9)'), true);
    assert.strictEqual(receiverSrc.includes('lots = minLot'), false, 'Receiver must reject below minLot rather than bumping volume up');

    const appCtxSrc = read('src/context/AppContext.tsx');
    assert.strictEqual(appCtxSrc.includes('EA Heartbeat Required'), true);
    assert.strictEqual(appCtxSrc.includes("updateAccountConnection(accountId, 'connected')"), false);

    const lotModalSrc = read('src/components/trader/LotSettingsModal.tsx');
    for (const field of ['maxDrawdownProtectionPercent', 'copyPendingOrders', 'symbolPrefix', 'symbolSuffix']) {
      assert.strictEqual(lotModalSrc.includes(field), true, `LotSettingsModal must expose ${field}`);
    }
    console.log('[PASS] 7. MQL5 EAs & frontend static checks verified.');

    console.log('\nALL DAY 1 CORE PRODUCT TESTS PASSED (7/7 groups).');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('DAY 1 TEST FAILED:', err);
  process.exit(1);
});
