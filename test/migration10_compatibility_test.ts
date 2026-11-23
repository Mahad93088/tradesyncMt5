import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApiApp } from '../src/server/apiApp.js';

interface Mig10DbState {
  profiles: Record<string, any>[];
  mentor_profiles: Record<string, any>[];
  mt5_accounts: Record<string, any>[];
  mentor_assignments: Record<string, any>[];
  mentor_groups: Record<string, any>[];
  mentor_trader_invitations: Record<string, any>[];
  brokers: Record<string, any>[];
  broker_symbols: Record<string, any>[];
  subscription_plans: Record<string, any>[];
  subscriptions: Record<string, any>[];
  platform_settings: Record<string, any>[];
  audit_logs: Record<string, any>[];
  notifications: Record<string, any>[];
  bridge_sync_logs: Record<string, any>[];
}

function createMig10MockSupabase(state: Mig10DbState) {
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

  // Column registries matching Migration 10 exact PostgreSQL columns
  const allowedCols: Record<string, Set<string>> = {
    brokers: new Set(['id', 'name', 'slug', 'server_prefixes', 'is_active', 'notes', 'created_at', 'updated_at']),
    broker_symbols: new Set([
      'id',
      'broker_id',
      'symbol_code',
      'asset_class',
      'base_currency',
      'quote_currency',
      'is_active',
      'is_verified',
      'verification_notes',
      'created_at',
      'updated_at',
    ]),
    mentor_trader_invitations: new Set([
      'id',
      'mentor_id',
      'trader_id',
      'invited_email',
      'direction',
      'status',
      'message',
      'group_id',
      'monthly_price_usd',
      'billing_period',
      'child_account_id',
      'responded_at',
      'created_at',
      'updated_at',
    ]),
  };

  const assertKnownCols = (tableName: string, row: Record<string, any>) => {
    const schemaCols = allowedCols[tableName];
    if (!schemaCols) return;
    for (const k of Object.keys(row)) {
      if (!schemaCols.has(k)) {
        throw new Error(`PostgreSQL 42703: column "${k}" of relation "${tableName}" does not exist`);
      }
    }
  };

  return {
    from(tableName: keyof Mig10DbState) {
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

        try {
          if (mode === 'insert') {
            const items = Array.isArray(payload) ? payload : [payload];
            const inserted = items.map((item) => {
              assertKnownCols(String(tableName), item);
              if (tableName === 'mentor_trader_invitations') {
                const status = item.status ?? 'pending';
                if (!['pending', 'accepted', 'rejected', 'revoked', 'expired', 'cancelled'].includes(status)) {
                  throw new Error(`Check constraint violation on mentor_trader_invitations.status: ${status}`);
                }
              }
              return {
                id: item.id || crypto.randomUUID(),
                created_at: item.created_at || new Date().toISOString(),
                updated_at: item.updated_at || new Date().toISOString(),
                ...item,
              };
            });
            table.push(...inserted);
            return { data: inserted, error: null };
          }

          if (mode === 'upsert') {
            const items = Array.isArray(payload) ? payload : [payload];
            const conflictCols = upsertOnConflict ? upsertOnConflict.split(',').map((s) => s.trim()) : ['id'];
            const out: any[] = [];
            for (const item of items) {
              assertKnownCols(String(tableName), item);
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
            assertKnownCols(String(tableName), payload || {});
            const matched = applyFilters(table, filters);
            for (const row of matched) {
              if (tableName === 'mentor_assignments' && payload.membership_status !== undefined) {
                if (!['trial', 'active', 'past_due', 'paused', 'cancelled'].includes(payload.membership_status)) {
                  throw new Error(`Check constraint violation on membership_status: ${payload.membership_status}`);
                }
              }
              if (tableName === 'mentor_trader_invitations' && payload.status !== undefined) {
                if (!['pending', 'accepted', 'rejected', 'revoked', 'expired', 'cancelled'].includes(payload.status)) {
                  throw new Error(`Check constraint violation on mentor_trader_invitations.status: ${payload.status}`);
                }
              }
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
            if (allowedCols[String(tableName)] && !allowedCols[String(tableName)].has(orderCol)) {
              throw new Error(`PostgreSQL 42703: order column "${orderCol}" does not exist on "${String(tableName)}"`);
            }
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
        } catch (err: any) {
          return { data: null, error: { code: '42703', message: err.message } };
        }
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
  return { status: res.status, json };
}

async function runTests() {
  console.log('=== Migration 10 Production Schema Compatibility & Security Audit Tests ===\n');
  let passed = 0;

  const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
  const mig10 = read('supabase/migrations/10_client_repair_saas_completion.sql');
  const mig09 = read('supabase/migrations/09_day2_security_billing_hardening.sql');
  const mig06 = read('supabase/migrations/06_harden_mt5_accounts_rls.sql');

  // --------------------------------------------------------------------------
  // 1. Transaction Safety, Non-Destructive DDL & PostgREST Reload
  // --------------------------------------------------------------------------
  assert.strictEqual(/^\s*(--.*\n)*\s*BEGIN;/m.test(mig10), true, 'Migration 10 must begin with BEGIN;');
  assert.strictEqual(/COMMIT;\s*$/m.test(mig10), true, 'Migration 10 must end with COMMIT;');
  assert.strictEqual(mig10.includes("NOTIFY pgrst, 'reload schema';"), true, 'Migration 10 must notify PostgREST');
  assert.strictEqual(/\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(mig10), false, 'Must have zero destructive DDL/DML');
  assert.strictEqual(mig10.includes('```'), false, 'Must not contain markdown fences');
  passed++;
  console.log('[PASS] 1. Transaction wrapper (BEGIN/COMMIT), PostgREST reload, and non-destructive DDL verified.');

  // --------------------------------------------------------------------------
  // 2. Broker & Broker Symbol Schema Exact Parity with Backend Queries
  // --------------------------------------------------------------------------
  for (const required of [
    'slug TEXT NOT NULL UNIQUE',
    "server_prefixes TEXT[] NOT NULL DEFAULT '{}'",
    'symbol_code TEXT NOT NULL',
    "base_currency TEXT NOT NULL DEFAULT 'XAU'",
    "quote_currency TEXT NOT NULL DEFAULT 'USD'",
    "verification_notes TEXT NOT NULL DEFAULT ''",
    'UNIQUE (broker_id, symbol_code)',
    "ON CONFLICT (slug) DO NOTHING",
    "ON CONFLICT (broker_id, symbol_code) DO NOTHING",
  ]) {
    assert.strictEqual(mig10.includes(required), true, `Missing required broker DDL fragment: ${required}`);
  }
  // Ensure wrong legacy column names are completely gone
  for (const stale of ['mt5_server_examples', 'symbol_name', 'trader_user_id', 'invite_code']) {
    assert.strictEqual(mig10.includes(stale), false, `Obsolete/mismatched column "${stale}" must not exist in Migration 10`);
  }
  // Honest baseline verification state
  assert.strictEqual(mig10.includes("FALSE,\n    'Baseline unverified"), true, 'Seeded baseline symbols must remain unverified');
  passed++;
  console.log('[PASS] 2. Brokers & broker_symbols schema matches brokerRoutes.ts / apiApp.ts 100% with honest unverified seeds.');

  // --------------------------------------------------------------------------
  // 3. Mentor Invitation Schema & RLS Exact Parity
  // --------------------------------------------------------------------------
  for (const required of [
    'trader_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL',
    'invited_email TEXT NOT NULL',
    "message TEXT NOT NULL DEFAULT ''",
    'group_id UUID REFERENCES public.mentor_groups(id) ON DELETE SET NULL',
    'monthly_price_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00',
    "billing_period TEXT NOT NULL DEFAULT 'monthly'",
    'child_account_id UUID REFERENCES public.mt5_accounts(id) ON DELETE SET NULL',
    'responded_at TIMESTAMPTZ',
    "'pending', 'accepted', 'rejected', 'revoked', 'expired', 'cancelled'",
    'idx_mentor_invitations_email',
    "ON public.mentor_trader_invitations(lower(invited_email), status)",
    'NULLIF(TRIM(lower(invited_email)), \'\') IS NOT NULL',
    'OR (mentor_id = auth.uid() AND public.is_mentor())',
    'REVOKE ALL ON TABLE public.mentor_trader_invitations FROM PUBLIC, anon, authenticated;',
    'GRANT SELECT ON TABLE public.mentor_trader_invitations TO authenticated;',
  ]) {
    assert.strictEqual(mig10.includes(required), true, `Missing required invitation DDL/RLS fragment: ${required}`);
  }
  passed++;
  console.log('[PASS] 3. mentor_trader_invitations schema, cancelled status, NULL-safe RLS & grants verified.');

  // --------------------------------------------------------------------------
  // 4. Membership Status & Anti-Tamper Billing Trigger
  // --------------------------------------------------------------------------
  assert.strictEqual(
    mig10.includes("CHECK (membership_status IN ('trial', 'active', 'past_due', 'paused', 'cancelled'))"),
    true,
    'membership_status CHECK must match TypeScript/backend values'
  );
  assert.strictEqual(
    mig10.includes("CHECK (billing_period IN ('monthly', 'quarterly', 'yearly', 'free'))"),
    true
  );
  assert.strictEqual(
    mig10.includes("CHECK (student_billing_period IN ('monthly', 'quarterly', 'yearly', 'free'))"),
    true
  );
  assert.strictEqual(
    mig10.includes('protect_mentor_assignment_membership_billing()') &&
      mig10.includes('NEW.membership_status IS DISTINCT FROM OLD.membership_status') &&
      mig10.includes('NEW.membership_price_usd IS DISTINCT FROM OLD.membership_price_usd') &&
      mig10.includes('NEW.billing_period IS DISTINCT FROM OLD.billing_period'),
    true,
    'Billing anti-tamper trigger must protect membership_status, membership_price_usd, and billing_period'
  );
  passed++;
  console.log('[PASS] 4. mentor_assignments membership constraints & billing anti-tamper trigger verified.');

  // --------------------------------------------------------------------------
  // 5. MT5 Accounts Token Hash Preservation & symbol_verified Guard
  // --------------------------------------------------------------------------
  assert.strictEqual(
    mig10.includes('GRANT SELECT (broker_id, trading_symbol, symbol_verified)\n    ON public.mt5_accounts TO authenticated;'),
    true,
    'Must grant column-level SELECT only for the 3 new non-secret columns'
  );
  assert.strictEqual(
    /GRANT\s+(SELECT|ALL)\s+ON\s+(TABLE\s+)?public\.mt5_accounts\s+TO\s+(PUBLIC|anon|authenticated)/i.test(mig10),
    false,
    'Must NEVER restore blanket table-level SELECT on mt5_accounts to authenticated/anon/PUBLIC'
  );
  assert.strictEqual(mig10.includes('terminal_token_hash'), true, 'protect_mt5_account_security must keep terminal_token_hash guard');
  assert.strictEqual(mig10.includes('symbol_verified IS DISTINCT FROM OLD.symbol_verified'), true);
  assert.strictEqual(mig10.includes('symbol_verified IS NOT FALSE'), true);
  assert.strictEqual(mig06.includes('ACCOUNT_TRADE_MODE_DEMO') || mig06.includes("account_type IS DISTINCT FROM 'demo'"), true);
  assert.strictEqual(mig10.includes("account_type IS DISTINCT FROM 'demo'"), true);
  passed++;
  console.log('[PASS] 5. Migration 06 terminal_token_hash column security, Demo-only guard & symbol_verified protection verified.');

  // --------------------------------------------------------------------------
  // 6. Subscription Plan Seed Pricing Consistency & Non-Destructive Merge
  // --------------------------------------------------------------------------
  // Verify exact match with Migration 09 Starter 10 ($49/$490), Pro 50 ($149/$1490), Business 200 ($399/$3990)
  assert.strictEqual(mig09.includes('49.00') && mig09.includes('490.00'), true);
  assert.strictEqual(mig09.includes('149.00') && mig09.includes('1490.00'), true);
  assert.strictEqual(mig09.includes('399.00') && mig09.includes('3990.00'), true);
  assert.strictEqual(mig10.includes('49.00') && mig10.includes('490.00'), true);
  assert.strictEqual(mig10.includes('149.00') && mig10.includes('1490.00'), true);
  assert.strictEqual(mig10.includes('399.00') && mig10.includes('3990.00'), true);
  const conflictBlock = mig10.slice(mig10.indexOf('ON CONFLICT (code) DO UPDATE'), mig10.indexOf('UPDATE public.subscription_plans'));
  for (const protectedCol of ['monthly_price_usd =', 'yearly_price_usd =', 'max_followers =', 'max_child_accounts =', 'is_active =', 'is_archived =', 'features =']) {
    assert.strictEqual(conflictBlock.includes(protectedCol), false, `Seed merge must not overwrite ${protectedCol}`);
  }
  passed++;
  console.log('[PASS] 6. Subscription plan seeds match Migration 09 prices and never overwrite admin-edited prices/limits.');

  // --------------------------------------------------------------------------
  // 7. Strict Schema Runtime Test (Rejects Unknown Columns 42703)
  // --------------------------------------------------------------------------
  const adminId = '11111111-1111-4111-8111-111111111111';
  const mentorId = '22222222-2222-4222-8222-222222222221';
  const traderId = '33333333-3333-4333-8333-333333333331';
  const parentAccId = 'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const childAccId = 'bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

  const assign1Id = 'cccc1111-cccc-4ccc-8ccc-ccccccccccc1';

  const state: Mig10DbState = {
    profiles: [
      { id: adminId, email: 'admin@tradesync.io', full_name: 'Admin', role: 'admin', status: 'active' },
      { id: mentorId, email: 'mentor@tradesync.io', full_name: 'Mentor', role: 'mentor', status: 'active' },
      { id: traderId, email: 'trader@tradesync.io', full_name: 'Trader', role: 'trader', status: 'active' },
    ],
    mentor_profiles: [
      { id: 'mp_1', user_id: mentorId, strategy_name: 'Gold Core', description: '', monthly_fee: 49, max_followers: 10, invite_code: `TS-${mentorId.slice(0, 8).toUpperCase()}` },
    ],
    mt5_accounts: [
      { id: parentAccId, user_id: mentorId, account_role: 'parent', account_number: '11111', broker_name: 'XM Global', broker_server: 'xmglobal_mt5 7', account_type: 'demo', balance: 50000, equity: 50000, connection_status: 'connected' },
      { id: childAccId, user_id: traderId, account_role: 'child', account_number: '22222', broker_name: 'XM Global', broker_server: 'xmglobal_mt5 7', account_type: 'demo', balance: 10000, equity: 10000, connection_status: 'connected' },
    ],
    mentor_assignments: [
      {
        id: assign1Id,
        mentor_id: mentorId,
        trader_id: traderId,
        parent_account_id: parentAccId,
        child_account_id: childAccId,
        status: 'active',
        lot_mode: 'parent_lot',
        lot_multiplier: 1.0,
        fixed_lot: 0.1,
        membership_status: 'active',
        membership_price_usd: 49,
        billing_period: 'monthly',
      },
    ],
    mentor_groups: [],
    mentor_trader_invitations: [],
    brokers: [],
    broker_symbols: [],
    subscription_plans: [
      { id: 'plan-silver-10', code: 'silver', name: 'Silver', max_followers: 50, max_child_accounts: 50, is_active: true },
    ],
    subscriptions: [
      {
        id: 'sub-m10',
        user_id: mentorId,
        mentor_id: mentorId,
        plan_id: 'plan-silver-10',
        status: 'active',
        current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString(),
        created_at: new Date().toISOString(),
      },
    ],
    platform_settings: [{ id: 'default', demo_only_enforced: true }],
    audit_logs: [],
    notifications: [],
    bridge_sync_logs: [],
  };

  const strictDb = createMig10MockSupabase(state);
  const app = createApiApp({
    serviceRoleClientOverride: strictDb as any,
    supabaseUrlOverride: 'https://test.supabase.co',
    serviceRoleKeyOverride: 'service-role-test',
    authUserResolverOverride: async (token: string) => {
      if (token === 'jwt-admin') return { user: { id: adminId, email: 'admin@tradesync.io' } };
      if (token === 'jwt-mentor') return { user: { id: mentorId, email: 'mentor@tradesync.io' } };
      if (token === 'jwt-trader') return { user: { id: traderId, email: 'trader@tradesync.io' } };
      return { user: null, error: { message: 'Invalid token' } };
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Broker CRUD + Symbol CRUD under strict PostgreSQL column checker
    const bCreate = await httpReq(baseUrl, 'POST', '/api/admin/brokers', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: {
        name: 'XM Global',
        slug: 'xm_global',
        serverPrefixes: ['xmglobal_mt5 7'],
        symbols: [{ symbolCode: 'GOLD', isVerified: false }],
      },
    });
    assert.strictEqual(bCreate.status, 201);
    const brokerId = bCreate.json.broker.id;

    const bList = await httpReq(baseUrl, 'GET', '/api/v1/brokers', {
      headers: { Authorization: 'Bearer jwt-trader' },
    });
    assert.strictEqual(bList.status, 200);
    assert.strictEqual(bList.json.brokers[0].symbols[0].symbolCode, 'GOLD');

    // Invitation + cancel status ('cancelled' check constraint)
    const invCreate = await httpReq(baseUrl, 'POST', '/api/v1/bridge/mentor/students/invite', {
      headers: { Authorization: 'Bearer jwt-mentor' },
      body: { email: 'trader@tradesync.io', message: 'Join XM Gold Desk' },
    });
    assert.strictEqual(invCreate.status, 201);
    const invId = invCreate.json.invitation.id;

    const invCancel = await httpReq(baseUrl, 'POST', `/api/v1/bridge/mentor/requests/${invId}/decide`, {
      headers: { Authorization: 'Bearer jwt-mentor' },
      body: { decision: 'cancel' },
    });
    assert.strictEqual(invCancel.status, 200);
    assert.strictEqual(invCancel.json.invitation.status, 'cancelled');

    // Membership status ('past_due' / 'paused') via authorized mentor API succeeds; trader rejected (403)
    const traderTamper = await httpReq(baseUrl, 'PUT', `/api/v1/bridge/assignments/${assign1Id}/membership`, {
      headers: { Authorization: 'Bearer jwt-trader' },
      body: { membershipStatus: 'active', membershipPriceUsd: 0 },
    });
    assert.strictEqual(traderTamper.status, 403);

    const mentorPastDue = await httpReq(baseUrl, 'PUT', `/api/v1/bridge/assignments/${assign1Id}/membership`, {
      headers: { Authorization: 'Bearer jwt-mentor' },
      body: { membershipStatus: 'past_due', membershipPriceUsd: 79, billingPeriod: 'quarterly' },
    });
    assert.strictEqual(mentorPastDue.status, 200);
    assert.strictEqual(mentorPastDue.json.assignment.membership_status, 'past_due');

    const mentorPaused = await httpReq(baseUrl, 'PUT', `/api/v1/bridge/assignments/${assign1Id}/membership`, {
      headers: { Authorization: 'Bearer jwt-mentor' },
      body: { membershipStatus: 'paused' },
    });
    assert.strictEqual(mentorPaused.status, 200);
    assert.strictEqual(mentorPaused.json.assignment.membership_status, 'paused');

    // Suppress unused helper warning cleanly
    assert.ok(brokerId);
    passed++;
    console.log('[PASS] 7. Strict column-validated runtime checks (Broker CRUD, Invitation cancel, Membership past_due/paused & 403 tamper guard) verified.');

    console.log(`\nALL MIGRATION 10 COMPATIBILITY CHECKS PASSED (${passed}/${passed}).`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('\n[FAIL]', err);
  process.exit(1);
});
