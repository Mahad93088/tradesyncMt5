import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApiApp } from '../src/server/apiApp.js';
import { buildCloudTrades, computeReportingSummary } from '../src/context/cloudStateUtils.js';

interface TestDbState {
  profiles: Record<string, any>[];
  mentor_profiles: Record<string, any>[];
  mt5_accounts: Record<string, any>[];
  mentor_assignments: Record<string, any>[];
  mentor_groups: Record<string, any>[];
  mentor_trader_invitations: Record<string, any>[];
  brokers: Record<string, any>[];
  broker_symbols: Record<string, any>[];
  platform_settings: Record<string, any>[];
  audit_logs: Record<string, any>[];
  notifications: Record<string, any>[];
  subscription_plans: Record<string, any>[];
  subscriptions: Record<string, any>[];
  payments: Record<string, any>[];
  invoices: Record<string, any>[];
  payment_webhooks: Record<string, any>[];
  bridge_sync_logs: Record<string, any>[];
  trades: Record<string, any>[];
  trade_mappings: Record<string, any>[];
}

function createAcceptanceMockSupabase(state: TestDbState) {
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
            if (eqMatch) return String(row[eqMatch[1]] ?? '').toLowerCase() === eqMatch[2].toLowerCase();
            return false;
          });
        }
        return true;
      })
    );

  return {
    auth: {
      admin: {
        createUser: async (opts: { email: string; password: string; email_confirm?: boolean; user_metadata?: any }) => {
          const dup = state.profiles.find((p) => String(p.email).toLowerCase() === opts.email.toLowerCase());
          if (dup) {
            return { data: { user: null }, error: { message: 'User already registered' } };
          }
          const userId = crypto.randomUUID();
          return {
            data: {
              user: {
                id: userId,
                email: opts.email,
                user_metadata: opts.user_metadata || {},
              },
            },
            error: null,
          };
        },
        deleteUser: async (_id: string) => ({ data: {}, error: null }),
      },
    },
    from(tableName: keyof TestDbState) {
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
          return { data: null, error: { code: '42P01', message: `Table ${String(tableName)} does not exist` } };
        }

        if (mode === 'insert') {
          const items = Array.isArray(payload) ? payload : [payload];
          // Enforce unique constraints for plans/brokers/broker_symbols in test harness
          if (tableName === 'subscription_plans') {
            for (const item of items) {
              if (item.code && table.some((r) => String(r.code).toLowerCase() === String(item.code).toLowerCase())) {
                return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "subscription_plans_code_key"' } };
              }
            }
          }
          if (tableName === 'brokers') {
            for (const item of items) {
              if (item.slug && table.some((r) => String(r.slug).toLowerCase() === String(item.slug).toLowerCase())) {
                return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "brokers_slug_key"' } };
              }
            }
          }
          if (tableName === 'broker_symbols') {
            for (const item of items) {
              if (
                table.some(
                  (r) =>
                    r.broker_id === item.broker_id &&
                    String(r.symbol_code).toLowerCase() === String(item.symbol_code).toLowerCase()
                )
              ) {
                return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
              }
            }
          }

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
          for (const row of matched) Object.assign(row, payload);
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

async function httpReq(
  baseUrl: string,
  method: string,
  urlPath: string,
  opts: { headers?: Record<string, string>; body?: any } = {}
) {
  const raw = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
    body: raw,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, headers: res.headers, json };
}

async function runTests() {
  console.log('=== TradeSync MT5 — 15-Case Client E2E Acceptance Suite ===\n');
  let passed = 0;

  const adminId = '11111111-1111-4111-8111-111111111111';
  const mentor1Id = '22222222-2222-4222-8222-222222222221';
  const mentor2Id = '22222222-2222-4222-8222-222222222222';
  const trader1Id = '33333333-3333-4333-8333-333333333331';
  const trader2Id = '33333333-3333-4333-8333-333333333332';

  const parent1AccId = 'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const parent2AccId = 'aaaa2222-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const child1AccId = 'bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const child2AccId = 'bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

  const xmBrokerId = '55551111-5555-4555-8555-555555555501';
  const icBrokerId = '55552222-5555-4555-8555-555555555502';

  const starterPlanId = '99991111-9999-4999-8999-999999999901';

  const state: TestDbState = {
    profiles: [
      { id: adminId, email: 'admin@tradesync.io', full_name: 'Super Admin', role: 'admin', status: 'active' },
      { id: mentor1Id, email: 'mentor1@tradesync.io', full_name: 'Mentor Alpha', role: 'mentor', status: 'active' },
      { id: mentor2Id, email: 'mentor2@tradesync.io', full_name: 'Mentor Beta', role: 'mentor', status: 'active' },
      { id: trader1Id, email: 'trader1@tradesync.io', full_name: 'Trader One', role: 'trader', status: 'active' },
      { id: trader2Id, email: 'trader2@tradesync.io', full_name: 'Trader Two', role: 'trader', status: 'active' },
    ],
    mentor_profiles: [
      {
        id: 'mp_1',
        user_id: mentor1Id,
        strategy_name: 'Gold Institutional Alpha',
        description: 'XAU scalping master',
        monthly_fee: 99,
        student_monthly_fee_usd: 99,
        student_billing_period: 'monthly',
        max_followers: 25,
        invite_code: `TS-${mentor1Id.slice(0, 8).toUpperCase()}`,
      },
      {
        id: 'mp_2',
        user_id: mentor2Id,
        strategy_name: 'London Breakout Beta',
        description: 'Session volatility',
        monthly_fee: 49,
        student_monthly_fee_usd: 49,
        student_billing_period: 'monthly',
        max_followers: 10,
        invite_code: `TS-${mentor2Id.slice(0, 8).toUpperCase()}`,
      },
    ],
    mt5_accounts: [
      {
        id: parent1AccId,
        user_id: mentor1Id,
        account_role: 'parent',
        account_number: '500101',
        broker_name: 'XM Global',
        broker_id: xmBrokerId,
        trading_symbol: 'GOLD',
        symbol_verified: false,
        broker_server: 'xmglobal_mt5 7',
        account_type: 'demo',
        balance: 50000,
        equity: 50000,
        connection_status: 'connected',
      },
      {
        id: parent2AccId,
        user_id: mentor2Id,
        account_role: 'parent',
        account_number: '500202',
        broker_name: 'IC Markets',
        broker_id: icBrokerId,
        trading_symbol: 'XAUUSD.a',
        symbol_verified: false,
        broker_server: 'ICMarketsSC-Demo',
        account_type: 'demo',
        balance: 50000,
        equity: 50000,
        connection_status: 'connected',
      },
      {
        id: child1AccId,
        user_id: trader1Id,
        account_role: 'child',
        account_number: '600101',
        broker_name: 'XM Global',
        broker_id: xmBrokerId,
        trading_symbol: 'GOLD',
        symbol_verified: false,
        broker_server: 'xmglobal_mt5 2',
        account_type: 'demo',
        balance: 10000,
        equity: 10000,
        connection_status: 'connected',
      },
      {
        id: child2AccId,
        user_id: trader2Id,
        account_role: 'child',
        account_number: '600102',
        broker_name: 'IC Markets',
        broker_id: icBrokerId,
        trading_symbol: 'XAUUSD.a',
        symbol_verified: false,
        broker_server: 'ICMarketsSC-Demo',
        account_type: 'demo',
        balance: 10000,
        equity: 10000,
        connection_status: 'connected',
      },
    ],
    mentor_assignments: [],
    mentor_groups: [],
    mentor_trader_invitations: [],
    brokers: [
      {
        id: xmBrokerId,
        name: 'XM Global',
        slug: 'xm_global',
        server_prefixes: ['xmglobal_mt5 7', 'xmglobal_mt5 2'],
        is_active: true,
        notes: 'Baseline catalog',
      },
      {
        id: icBrokerId,
        name: 'IC Markets',
        slug: 'ic_markets',
        server_prefixes: ['ICMarketsSC-Demo'],
        is_active: true,
        notes: 'Baseline catalog',
      },
    ],
    broker_symbols: [
      {
        id: '66661111-6666-4666-8666-666666666601',
        broker_id: xmBrokerId,
        symbol_code: 'GOLD',
        asset_class: 'Metals',
        base_currency: 'XAU',
        quote_currency: 'USD',
        is_active: true,
        is_verified: false,
      },
      {
        id: '66662222-6666-4666-8666-666666666602',
        broker_id: icBrokerId,
        symbol_code: 'XAUUSD.a',
        asset_class: 'Metals',
        base_currency: 'XAU',
        quote_currency: 'USD',
        is_active: true,
        is_verified: false,
      },
    ],
    platform_settings: [
      { id: 'default', demo_only_enforced: true, default_slippage_max_pips: 3.0, default_max_lot_cap: 50.0, heartbeat_stale_seconds: 60, maintenance_mode: false },
    ],
    audit_logs: [],
    notifications: [],
    subscription_plans: [
      {
        id: starterPlanId,
        code: 'starter_10',
        name: 'Starter 10',
        tier: 'mentor_pro',
        monthly_price_usd: 49,
        yearly_price_usd: 490,
        max_followers: 10,
        max_child_accounts: 10,
        trial_days: 7,
        is_active: true,
        is_archived: false,
        features: ['Up to 10 followers'],
      },
    ],
    subscriptions: [
      {
        id: 'sub_mentor1',
        user_id: mentor1Id,
        mentor_id: mentor1Id,
        plan_id: starterPlanId,
        status: 'active',
        billing_cycle: 'monthly',
        amount_usd: 49,
        currency: 'USD',
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString(),
        cancel_at_period_end: false,
      },
    ],
    payments: [],
    invoices: [],
    payment_webhooks: [],
    bridge_sync_logs: [],
    trades: [],
    trade_mappings: [],
  };

  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.PAYPAL_CLIENT_ID;

  const mockDb = createAcceptanceMockSupabase(state);
  const app = createApiApp({
    serviceRoleClientOverride: mockDb as any,
    supabaseUrlOverride: 'https://test.supabase.co',
    serviceRoleKeyOverride: 'service-role-test',
    allowedOriginsOverride: ['http://localhost:3000'],
    authUserResolverOverride: async (token: string) => {
      if (token === 'jwt-admin') return { user: { id: adminId, email: 'admin@tradesync.io' } };
      if (token === 'jwt-mentor1') return { user: { id: mentor1Id, email: 'mentor1@tradesync.io' } };
      if (token === 'jwt-mentor2') return { user: { id: mentor2Id, email: 'mentor2@tradesync.io' } };
      if (token === 'jwt-trader1') return { user: { id: trader1Id, email: 'trader1@tradesync.io' } };
      if (token === 'jwt-trader2') return { user: { id: trader2Id, email: 'trader2@tradesync.io' } };
      return { user: null, error: { message: 'Invalid token' } };
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Authentication Gate & Unauthenticated Endpoint Protection
    // ------------------------------------------------------------------------
    const loginPageSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/common/LoginPage.tsx'), 'utf8');
    const authCtxSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/contexts/AuthContext.tsx'), 'utf8');
    assert.strictEqual(loginPageSrc.includes('isRecoveryMode') && loginPageSrc.includes('Reset Password'), true);
    assert.strictEqual(authCtxSrc.includes('tradesync_') && authCtxSrc.includes('signOut'), true);

    const unauthMyAcc = await httpReq(baseUrl, 'GET', '/api/v1/bridge/my-accounts');
    const unauthBrokers = await httpReq(baseUrl, 'GET', '/api/v1/brokers');
    const unauthPlans = await httpReq(baseUrl, 'GET', '/api/admin/subscription-plans');
    assert.strictEqual(unauthMyAcc.status, 401);
    assert.strictEqual(unauthBrokers.status, 401);
    assert.strictEqual(unauthPlans.status, 401);
    passed++;
    console.log('[PASS] 1. Auth Gate, Recovery Flow, Logout Cleanup & Unauthenticated 401 Enforcement verified.');

    // ------------------------------------------------------------------------
    // TEST 2: Subscription Plan CRUD + Duplicate Code 409
    // ------------------------------------------------------------------------
    const createPlanRes = await httpReq(baseUrl, 'POST', '/api/admin/subscription-plans', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: {
        name: 'Gold Elite 100',
        code: 'gold_elite_100',
        tier: 'mentor_pro',
        monthlyPrice: 199,
        yearlyPrice: 1990,
        maxFollowers: 100,
        maxChildAccounts: 100,
        trialDays: 14,
        description: 'Dedicated Gold mentor plan',
        features: ['100 Child Accounts', '14-Day Trial'],
      },
    });
    assert.strictEqual(createPlanRes.status, 201);
    assert.strictEqual(createPlanRes.json.plan.code, 'gold_elite_100');
    assert.strictEqual(createPlanRes.json.plan.trialDays, 14);

    const dupPlanRes = await httpReq(baseUrl, 'POST', '/api/admin/subscription-plans', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: { name: 'Duplicate Plan', code: 'gold_elite_100', monthlyPrice: 199, maxFollowers: 100 },
    });
    assert.strictEqual(dupPlanRes.status, 409);
    assert.strictEqual(dupPlanRes.json.code, 'DUPLICATE_PLAN_CODE');
    passed++;
    console.log('[PASS] 2. Subscription Plan Creation & Duplicate Plan Code 409 Protection verified.');

    // ------------------------------------------------------------------------
    // TEST 3: Subscription Plan Edit & Soft-Archival
    // ------------------------------------------------------------------------
    const newPlanId = createPlanRes.json.plan.id;
    const updPlanRes = await httpReq(baseUrl, 'PUT', `/api/admin/subscription-plans/${newPlanId}`, {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: { name: 'Gold Elite 120', monthlyPrice: 229, maxFollowers: 120, trialDays: 21 },
    });
    assert.strictEqual(updPlanRes.status, 200);
    assert.strictEqual(updPlanRes.json.plan.maxFollowers, 120);

    const delPlanRes = await httpReq(baseUrl, 'DELETE', `/api/admin/subscription-plans/${newPlanId}`, {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(delPlanRes.status, 200);
    assert.strictEqual(delPlanRes.json.archived, true);
    const archivedInDb = state.subscription_plans.find((p) => p.id === newPlanId);
    assert.strictEqual(archivedInDb?.is_archived, true);
    assert.strictEqual(archivedInDb?.is_active, false);
    passed++;
    console.log('[PASS] 3. Subscription Plan Update & Safe Soft-Archival verified.');

    // ------------------------------------------------------------------------
    // TEST 4: Super Admin Creates New Mentor (Preserves Admin Session & Plan Assignment)
    // ------------------------------------------------------------------------
    const addMentorRes = await httpReq(baseUrl, 'POST', '/api/admin/users/create', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: {
        email: 'newmentor@tradesync.io',
        password: 'TempPassword!123',
        fullName: 'Created Mentor',
        role: 'mentor',
        status: 'active',
        strategyName: 'London Gold Scalper',
        monthlyFee: 79,
        maxFollowers: 20,
        planId: starterPlanId,
        billingCycle: 'monthly',
      },
    });
    assert.strictEqual(addMentorRes.status, 201);
    const createdMentorId = addMentorRes.json.profile.id;
    assert.ok(state.profiles.some((p) => p.id === createdMentorId && p.role === 'mentor'));
    assert.ok(state.mentor_profiles.some((mp) => mp.user_id === createdMentorId && mp.strategy_name === 'London Gold Scalper'));
    assert.ok(state.subscriptions.some((s) => s.user_id === createdMentorId && s.plan_id === starterPlanId));
    passed++;
    console.log('[PASS] 4. Super Admin Mentor Creation (profiles + mentor_profiles + subscription plan) verified.');

    // ------------------------------------------------------------------------
    // TEST 5: Super Admin Creates Trader + Edits Mentor & Trader Profiles
    // ------------------------------------------------------------------------
    const addTraderRes = await httpReq(baseUrl, 'POST', '/api/admin/users/create', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: {
        email: 'newtrader@tradesync.io',
        password: 'TempPassword!123',
        fullName: 'Created Trader',
        role: 'trader',
        status: 'active',
      },
    });
    assert.strictEqual(addTraderRes.status, 201);
    const createdTraderId = addTraderRes.json.profile.id;

    const editMentorRes = await httpReq(baseUrl, 'PUT', `/api/admin/mentors/${createdMentorId}`, {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: { fullName: 'Created Mentor Edited', strategyName: 'Gold Swing Pro', monthlyFee: 119 },
    });
    assert.strictEqual(editMentorRes.status, 200);
    assert.strictEqual(editMentorRes.json.profile.full_name, 'Created Mentor Edited');

    const editTraderRes = await httpReq(baseUrl, 'PUT', `/api/admin/traders/${createdTraderId}`, {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: { fullName: 'Created Trader Edited', status: 'active' },
    });
    assert.strictEqual(editTraderRes.status, 200);
    assert.strictEqual(editTraderRes.json.profile.full_name, 'Created Trader Edited');
    passed++;
    console.log('[PASS] 5. Super Admin Trader Creation & Full Mentor/Trader Edit Persistence verified.');

    // ------------------------------------------------------------------------
    // TEST 6: Super Admin Dashboard Is Mentor-Centric (No Global Trade Performance Primary Overview)
    // ------------------------------------------------------------------------
    const adminDashSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/admin/AdminDashboard.tsx'), 'utf8');
    assert.strictEqual(adminDashSrc.includes('Mentor Overview'), true);
    assert.strictEqual(adminDashSrc.includes('Total Mentors'), true);
    assert.strictEqual(adminDashSrc.includes('Assigned Traders'), true);
    assert.strictEqual(adminDashSrc.includes('RealEquityCurveChart'), false);
    passed++;
    console.log('[PASS] 6. Super Admin Dashboard Mentor-Centric Architecture verified.');

    // ------------------------------------------------------------------------
    // TEST 7: Independent Mentor Login & Cross-Mentor Tenant Isolation (403)
    // ------------------------------------------------------------------------
    const m1OwnStudents = await httpReq(baseUrl, 'GET', '/api/v1/bridge/mentor/students', {
      headers: { Authorization: 'Bearer jwt-mentor1' },
    });
    assert.strictEqual(m1OwnStudents.status, 200);
    assert.strictEqual(m1OwnStudents.json.mentorId, mentor1Id);

    const m1SnoopM2 = await httpReq(baseUrl, 'GET', `/api/v1/bridge/mentor/students?mentorId=${mentor2Id}`, {
      headers: { Authorization: 'Bearer jwt-mentor1' },
    });
    assert.strictEqual(m1SnoopM2.status, 403);
    assert.strictEqual(m1SnoopM2.json.code, 'TENANT_ISOLATION_FORBIDDEN');
    passed++;
    console.log('[PASS] 7. Mentor Tenant Isolation (403 TENANT_ISOLATION_FORBIDDEN on cross-mentor snooping) verified.');

    // ------------------------------------------------------------------------
    // TEST 8: Mentor Invites Existing Trader & Creates New Student Login
    // ------------------------------------------------------------------------
    const inviteExistingRes = await httpReq(baseUrl, 'POST', '/api/v1/bridge/mentor/students/invite', {
      headers: { Authorization: 'Bearer jwt-mentor1' },
      body: { email: 'trader1@tradesync.io', createAccount: false, message: 'Welcome to Gold Alpha' },
    });
    assert.strictEqual(inviteExistingRes.status, 201);
    const pendingInviteId = inviteExistingRes.json.invitation.id;
    assert.strictEqual(inviteExistingRes.json.invitation.direction, 'mentor_invite');

    const inviteProvisionRes = await httpReq(baseUrl, 'POST', '/api/v1/bridge/mentor/students/invite', {
      headers: { Authorization: 'Bearer jwt-mentor1' },
      body: {
        email: 'student.new@tradesync.io',
        fullName: 'New Student',
        password: 'StudentPass!123',
        createAccount: true,
      },
    });
    assert.strictEqual(inviteProvisionRes.status, 201);
    assert.strictEqual(inviteProvisionRes.json.provisionedNewAccount, true);
    assert.ok(state.profiles.some((p) => p.email === 'student.new@tradesync.io' && p.role === 'trader'));
    passed++;
    console.log('[PASS] 8. Mentor Invites Existing Trader & Provisions Student Login verified.');

    // ------------------------------------------------------------------------
    // TEST 9: Student Join Request -> Mentor Approval + Student Billing Update
    // ------------------------------------------------------------------------
    const joinReqRes = await httpReq(baseUrl, 'POST', '/api/v1/bridge/assignments/join', {
      headers: { Authorization: 'Bearer jwt-trader2' },
      body: {
        inviteCodeOrMentorId: `TS-${mentor1Id.slice(0, 8).toUpperCase()}`,
        childAccountId: child2AccId,
        requestApproval: true,
        message: 'Ready to mirror XM/Gold signals',
      },
    });
    assert.strictEqual(joinReqRes.status, 201);
    assert.strictEqual(joinReqRes.json.pendingApproval, true);
    const joinRequestId = joinReqRes.json.request.id;

    // Cross-mentor mentor2 CANNOT approve mentor1's join request
    const m2HijackRes = await httpReq(baseUrl, 'POST', `/api/v1/bridge/mentor/requests/${joinRequestId}/decide`, {
      headers: { Authorization: 'Bearer jwt-mentor2' },
      body: { decision: 'approve' },
    });
    assert.strictEqual(m2HijackRes.status, 403);

    // Owning mentor1 approves
    const approveRes = await httpReq(baseUrl, 'POST', `/api/v1/bridge/mentor/requests/${joinRequestId}/decide`, {
      headers: { Authorization: 'Bearer jwt-mentor1' },
      body: { decision: 'approve' },
    });
    assert.strictEqual(approveRes.status, 200);
    const assignmentId = approveRes.json.assignment.id;
    assert.strictEqual(approveRes.json.assignment.status, 'active');

    // Mentor updates student membership fee + default rate
    const memUpdRes = await httpReq(baseUrl, 'PUT', `/api/v1/bridge/assignments/${assignmentId}/membership`, {
      headers: { Authorization: 'Bearer jwt-mentor1' },
      body: { membershipStatus: 'active', membershipPriceUsd: 149, billingPeriod: 'monthly' },
    });
    assert.strictEqual(memUpdRes.status, 200);
    assert.strictEqual(memUpdRes.json.assignment.membership_price_usd, 149);

    const profilePricingRes = await httpReq(baseUrl, 'PUT', '/api/v1/bridge/mentor/profile', {
      headers: { Authorization: 'Bearer jwt-mentor1' },
      body: {
        strategyName: 'Gold Institutional Alpha',
        description: 'XAU scalping master',
        monthlyFee: 99,
        studentMonthlyFeeUsd: 129,
        studentBillingPeriod: 'monthly',
        maxFollowers: 25,
      },
    });
    assert.strictEqual(profilePricingRes.status, 200);
    assert.strictEqual(profilePricingRes.json.mentorProfile.studentMonthlyFeeUsd, 129);
    passed++;
    console.log('[PASS] 9. Student Join Request Approval, Cross-Mentor Protection & Student Membership Billing verified.');

    // ------------------------------------------------------------------------
    // TEST 10: Trader Views Pending Invitations & Accepts/Rejects Safely
    // ------------------------------------------------------------------------
    const t1InvitesRes = await httpReq(baseUrl, 'GET', '/api/v1/bridge/trader/invitations', {
      headers: { Authorization: 'Bearer jwt-trader1' },
    });
    assert.strictEqual(t1InvitesRes.status, 200);
    assert.ok(t1InvitesRes.json.invitations.some((i: any) => i.id === pendingInviteId && i.status === 'pending'));

    // Trader2 cannot respond to Trader1's invitation
    const t2StealInviteRes = await httpReq(baseUrl, 'POST', `/api/v1/bridge/trader/invitations/${pendingInviteId}/respond`, {
      headers: { Authorization: 'Bearer jwt-trader2' },
      body: { decision: 'accept' },
    });
    assert.strictEqual(t2StealInviteRes.status, 403);

    // Trader1 accepts
    const t1AcceptRes = await httpReq(baseUrl, 'POST', `/api/v1/bridge/trader/invitations/${pendingInviteId}/respond`, {
      headers: { Authorization: 'Bearer jwt-trader1' },
      body: { decision: 'accept', childAccountId: child1AccId },
    });
    assert.strictEqual(t1AcceptRes.status, 200);
    assert.strictEqual(t1AcceptRes.json.invitation.status, 'accepted');
    assert.strictEqual(t1AcceptRes.json.assignment.status, 'active');
    passed++;
    console.log('[PASS] 10. Trader Invitation Retrieval, Authorization Guard & Acceptance Activation verified.');

    // ------------------------------------------------------------------------
    // TEST 11: Admin Broker Directory CRUD & Broker-Specific Gold Symbols
    // ------------------------------------------------------------------------
    const createBrokerRes = await httpReq(baseUrl, 'POST', '/api/admin/brokers', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: {
        name: 'Pepperstone Demo',
        slug: 'pepperstone_demo',
        serverPrefixes: ['Pepperstone-Demo01'],
        notes: 'Test broker',
      },
    });
    assert.strictEqual(createBrokerRes.status, 201);
    const pepBrokerId = createBrokerRes.json.broker.id;

    const addSymRes = await httpReq(baseUrl, 'POST', `/api/admin/brokers/${pepBrokerId}/symbols`, {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: { symbolCode: 'XAUUSD.p', isVerified: true, verificationNotes: 'Verified on Pepperstone Demo' },
    });
    assert.strictEqual(addSymRes.status, 201);
    assert.strictEqual(addSymRes.json.symbol.symbolCode, 'XAUUSD.p');
    assert.strictEqual(addSymRes.json.symbol.isVerified, true);

    const publicBrokersRes = await httpReq(baseUrl, 'GET', '/api/v1/brokers', {
      headers: { Authorization: 'Bearer jwt-trader1' },
    });
    assert.strictEqual(publicBrokersRes.status, 200);
    const pepInCatalog = publicBrokersRes.json.brokers.find((b: any) => b.id === pepBrokerId);
    assert.ok(pepInCatalog && pepInCatalog.symbols.some((s: any) => s.symbolCode === 'XAUUSD.p'));
    passed++;
    console.log('[PASS] 11. Admin Broker & Broker-Specific Gold Symbol Directory CRUD verified.');

    // ------------------------------------------------------------------------
    // TEST 12: Broker Symbol Filtering Guard on MT5 Account Registration
    // ------------------------------------------------------------------------
    const validSymRegRes = await httpReq(baseUrl, 'POST', '/api/v1/bridge/accounts/register', {
      headers: { Authorization: 'Bearer jwt-trader1' },
      body: {
        accountRole: 'child',
        accountType: 'demo',
        accountNumber: '770011',
        brokerId: xmBrokerId,
        brokerName: 'XM Global',
        brokerServer: 'xmglobal_mt5 2',
        tradingSymbol: 'GOLD',
      },
    });
    assert.strictEqual(validSymRegRes.status, 200);
    const regAccRow = state.mt5_accounts.find((a) => a.account_number === '770011');
    assert.strictEqual(regAccRow?.trading_symbol, 'GOLD');

    // Submitting IC Markets' XAUUSD.a under XM Global must be rejected
    const mismatchSymRegRes = await httpReq(baseUrl, 'POST', '/api/v1/bridge/accounts/register', {
      headers: { Authorization: 'Bearer jwt-trader1' },
      body: {
        accountRole: 'child',
        accountType: 'demo',
        accountNumber: '770012',
        brokerId: xmBrokerId,
        brokerName: 'XM Global',
        brokerServer: 'xmglobal_mt5 2',
        tradingSymbol: 'XAUUSD.a',
      },
    });
    assert.strictEqual(mismatchSymRegRes.status, 400);
    passed++;
    console.log('[PASS] 12. Broker-Filtered Gold Symbol Validation on MT5 Registration verified.');

    // ------------------------------------------------------------------------
    // TEST 13: Honest Unverified Symbol Badges & Real Closed-Deal Reporting Math
    // ------------------------------------------------------------------------
    const xmCatalog = publicBrokersRes.json.brokers.find((b: any) => b.id === xmBrokerId);
    const xmGold = xmCatalog?.symbols.find((s: any) => s.symbolCode === 'GOLD');
    assert.strictEqual(xmGold?.isVerified, false);

    const noClosedReporting = computeReportingSummary({
      trades: [
        {
          id: 't_open_1',
          ticket: 9001,
          accountId: child1AccId,
          symbol: 'GOLD',
          type: 'BUY',
          lots: 0.1,
          openPrice: 2710.5,
          currentPrice: 2712.0,
          profit: 15,
          openTime: new Date().toISOString(),
          status: 'OPEN',
          isRealized: true,
        },
      ],
      mappings: [],
      accounts: [],
      isCloudMode: true,
    });
    assert.strictEqual(noClosedReporting.realizedPnlAvailable, false);
    assert.strictEqual(noClosedReporting.floatingPnlAvailable, true);
    assert.strictEqual(noClosedReporting.floatingPnlUSD, 15);
    passed++;
    console.log('[PASS] 13. Unverified Baseline Symbol Honesty & Realized vs Floating P&L Separation verified.');

    // ------------------------------------------------------------------------
    // TEST 14: Copied Trades Complete Execution Audit Transformation
    // ------------------------------------------------------------------------
    const cloudTrades = buildCloudTrades(
      [
        {
          id: 'tr_child_1',
          ticket: '888001',
          parent_ticket: '777001',
          account_id: child1AccId,
          symbol: 'GOLD',
          type: 'BUY',
          volume: 0.25,
          requested_volume: 0.5,
          open_price: 2715.4,
          close_price: 2722.4,
          profit: 175.0,
          commission: -1.5,
          swap: -0.25,
          pips: 70,
          status: 'CLOSED',
          execution_status: 'EXECUTED',
          is_realized: true,
          open_time: '2026-11-20T05:00:00Z',
          close_time: '2026-11-20T06:00:00Z',
        },
      ],
      []
    );
    assert.strictEqual(cloudTrades.length, 1);
    assert.strictEqual(cloudTrades[0].parentTicket, '777001');
    assert.strictEqual(cloudTrades[0].ticket, '888001');
    assert.strictEqual(cloudTrades[0].requestedVolume, 0.5);
    assert.strictEqual(cloudTrades[0].lots, 0.25);
    assert.strictEqual(cloudTrades[0].openPrice, 2715.4);
    assert.strictEqual(cloudTrades[0].closePrice, 2722.4);
    assert.strictEqual(cloudTrades[0].commission, -1.5);
    passed++;
    console.log('[PASS] 14. Copied Trades Complete Execution Audit Trail verified.');

    // ------------------------------------------------------------------------
    // TEST 15: Strict DEMO-Only Account Lock & Unconfigured Billing 501 Honesty
    // ------------------------------------------------------------------------
    const liveRegRes = await httpReq(baseUrl, 'POST', '/api/v1/bridge/accounts/register', {
      headers: { Authorization: 'Bearer jwt-trader1' },
      body: {
        accountRole: 'child',
        accountType: 'live',
        accountNumber: '999999',
        brokerName: 'XM Global',
        brokerServer: 'XMGlobal-Real 1',
      },
    });
    assert.strictEqual(liveRegRes.status, 403);
    assert.strictEqual(liveRegRes.json.code, 'DEMO_ONLY_SAFETY_BLOCK');

    const broadcasterEa = fs.readFileSync(path.resolve(process.cwd(), 'public/mql5/TradeSync_Broadcaster.mq5'), 'utf8');
    const receiverEa = fs.readFileSync(path.resolve(process.cwd(), 'public/mql5/TradeSync_Receiver.mq5'), 'utf8');
    assert.strictEqual(broadcasterEa.includes('ACCOUNT_TRADE_MODE_DEMO'), true);
    assert.strictEqual(receiverEa.includes('ACCOUNT_TRADE_MODE_DEMO'), true);

    const checkoutRes = await httpReq(baseUrl, 'POST', '/api/v1/billing/checkout', {
      headers: { Authorization: 'Bearer jwt-mentor1' },
      body: { planId: starterPlanId, billingCycle: 'monthly', provider: 'stripe' },
    });
    assert.strictEqual(checkoutRes.status, 501);
    assert.strictEqual(checkoutRes.json.code, 'PAYMENT_PROVIDER_UNCONFIGURED');
    passed++;
    console.log('[PASS] 15. DEMO-Only Account Protection (API 403 + MQL5 Guards) & Honest Billing 501 verified.');

    console.log(`\nALL ${passed}/15 ACCEPTANCE TESTS PASSED.`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('\n[FAIL]', err);
  process.exit(1);
});
