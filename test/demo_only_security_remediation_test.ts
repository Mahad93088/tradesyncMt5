import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApiApp } from '../src/server/apiApp.js';
import { BridgeStore } from '../src/server/bridgeStore.js';

interface DbState {
  profiles: Record<string, any>[];
  mt5_accounts: Record<string, any>[];
  mentor_assignments: Record<string, any>[];
  bridge_instructions: Record<string, any>[];
  trade_mappings: Record<string, any>[];
  bridge_sync_logs: Record<string, any>[];
  trades: Record<string, any>[];
  audit_logs: Record<string, any>[];
  notifications: Record<string, any>[];
  brokers: Record<string, any>[];
  broker_symbols: Record<string, any>[];
}

/**
 * Simulates PostgreSQL Migration 12 enforcement on public.mt5_accounts:
 * - CHECK (account_type = 'demo')
 * - protect_mt5_account_security() with NO service_role exemption on account_type
 */
function enforceMigration12Mt5DemoOnly(row: Record<string, any>, callerRole: 'service_role' | 'postgres' | 'authenticated' | 'anon') {
  if (row.account_type !== 'demo') {
    throw new Error(
      `Security violation [${callerRole}]: Only Demo MT5 accounts (account_type = demo) may be created or updated; live/real accounts are strictly prohibited for all roles including service_role and postgres.`
    );
  }
}

function createDemoOnlyMockSupabase(
  state: DbState,
  callerRole: 'service_role' | 'postgres' | 'authenticated' | 'anon' = 'service_role'
) {
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
    async rpc(fnName: string, args: Record<string, any>) {
      if (fnName === 'claim_pending_instructions') {
        const childId = args.p_child_account_id;
        const limit = Number(args.p_limit ?? 20);
        if (limit === 0) return { data: [], error: null };
        const eligible = state.bridge_instructions
          .filter((bi) => bi.child_account_id === childId && bi.status === 'QUEUED')
          .slice(0, limit);
        const leaseExpiry = new Date(Date.now() + Number(args.p_lease_seconds ?? 15) * 1000).toISOString();
        for (const bi of eligible) {
          bi.status = 'IN_FLIGHT';
          bi.lease_expires_at = leaseExpiry;
        }
        return { data: eligible.map((r) => ({ ...r })), error: null };
      }
      return { data: null, error: { message: `RPC ${fnName} not implemented in mock` } };
    },
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
          return { data: null, error: { code: '42P01', message: `Table ${String(tableName)} not found` } };
        }

        try {
          if (mode === 'insert') {
            const items = Array.isArray(payload) ? payload : [payload];
            const inserted = items.map((item) => {
              const row = {
                id: item.id || crypto.randomUUID(),
                created_at: item.created_at || new Date().toISOString(),
                ...item,
              };
              if (tableName === 'mt5_accounts') {
                enforceMigration12Mt5DemoOnly(row, callerRole);
              }
              return row;
            });
            table.push(...inserted);
            return { data: inserted.map((r) => ({ ...r })), error: null };
          }

          if (mode === 'upsert') {
            const items = Array.isArray(payload) ? payload : [payload];
            const conflictCols = upsertOnConflict ? upsertOnConflict.split(',').map((s) => s.trim()) : ['id'];
            const out: any[] = [];
            for (const item of items) {
              const existing = table.find((r) => conflictCols.every((c) => r[c] === item[c]));
              if (existing) {
                const candidate = { ...existing, ...item };
                if (tableName === 'mt5_accounts') {
                  enforceMigration12Mt5DemoOnly(candidate, callerRole);
                }
                Object.assign(existing, item);
                out.push({ ...existing });
              } else {
                const row = {
                  id: item.id || crypto.randomUUID(),
                  created_at: item.created_at || new Date().toISOString(),
                  ...item,
                };
                if (tableName === 'mt5_accounts') {
                  enforceMigration12Mt5DemoOnly(row, callerRole);
                }
                table.push(row);
                out.push({ ...row });
              }
            }
            return { data: out, error: null };
          }

          if (mode === 'update') {
            const matched = applyFilters(table, filters);
            for (const row of matched) {
              const candidate = { ...row, ...payload };
              if (tableName === 'mt5_accounts') {
                enforceMigration12Mt5DemoOnly(candidate, callerRole);
              }
            }
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
        } catch (err: any) {
          return { data: null, error: { code: 'P0001', message: err.message } };
        }
      };

      const builder: any = {
        select(_cols?: string) {
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
            return { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
          }
          return { data: res.data[0], error: null };
        },
        then: (resolve: any, reject: any) => execute().then(resolve, reject),
      };
      return builder;
    },
  };
}

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

async function runTests() {
  console.log('=== Demo-Only Security Remediation Tests ===');

  // ------------------------------------------------------------------
  // 1. Static Migration 12 SQL Verification
  // ------------------------------------------------------------------
  const mig12 = readRepoFile('supabase/migrations/12_enforce_demo_only_mt5_accounts.sql');
  assert.strictEqual(/BEGIN;/i.test(mig12) && /COMMIT;/i.test(mig12), true, 'Migration 12 must be transactional');
  assert.strictEqual(
    mig12.includes("WHERE account_type IS DISTINCT FROM 'demo'"),
    true,
    'Migration 12 must check for existing non-demo rows before tightening constraint'
  );
  assert.strictEqual(
    /RAISE EXCEPTION[\s\S]*No records were deleted or modified/i.test(mig12),
    true,
    'Migration 12 must stop and report non-demo rows without deleting or mutating data'
  );
  assert.strictEqual(
    /\bDELETE\s+FROM\s+public\.mt5_accounts\b/i.test(mig12) || /\bUPDATE\s+public\.mt5_accounts\b/i.test(mig12),
    false,
    'Migration 12 must NEVER delete or silently update mt5_accounts rows'
  );
  assert.strictEqual(
    mig12.includes("CHECK (account_type = 'demo')"),
    true,
    "Migration 12 must tighten account_type CHECK constraint strictly to 'demo'"
  );
  assert.strictEqual(
    mig12.includes("IF NOT v_is_backend_service AND NEW.account_type IS DISTINCT FROM 'demo'"),
    false,
    'Migration 12 must remove the backend-service exemption from the Demo-only check'
  );
  assert.strictEqual(
    /IF\s+NEW\.account_type\s+IS\s+DISTINCT\s+FROM\s+'demo'\s+THEN/m.test(mig12),
    true,
    'protect_mt5_account_security() must enforce account_type = demo unconditionally for all roles'
  );
  assert.strictEqual(
    mig12.includes("NOTIFY pgrst, 'reload schema';"),
    true,
    'Migration 12 must reload PostgREST schema metadata'
  );
  console.log('[PASS] 1. Migration 12 static SQL enforcement, pre-check, and idempotency verified.');

  // ------------------------------------------------------------------
  // 2. Service-Role & Postgres DB Enforcement (Create & Convert Blocked)
  // ------------------------------------------------------------------
  const adminId = '11111111-1111-4111-8111-111111111111';
  const mentorId = '22222222-2222-4222-8222-222222222222';
  const traderId = '33333333-3333-4333-8333-333333333333';
  const otherTraderId = '44444444-4444-4444-8444-444444444444';

  const demoParentAccId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const demoChildAccId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const legacyLiveAccId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

  const parentToken = 'ts_parent_demo_remediation_111111111111';
  const childToken = 'ts_child_demo_remediation_2222222222222';
  const liveToken = 'ts_child_live_remediation_33333333333333';

  const state: DbState = {
    profiles: [
      { id: adminId, email: 'admin@tradesync.test', full_name: 'Admin', role: 'admin', status: 'active' },
      { id: mentorId, email: 'mentor@tradesync.test', full_name: 'Mentor', role: 'mentor', status: 'active' },
      { id: traderId, email: 'trader@tradesync.test', full_name: 'Trader', role: 'trader', status: 'active' },
      { id: otherTraderId, email: 'other@tradesync.test', full_name: 'Other Trader', role: 'trader', status: 'active' },
    ],
    mt5_accounts: [
      {
        id: demoParentAccId,
        user_id: mentorId,
        account_number: '5001001',
        broker_server: 'XMGlobal-MT5',
        broker_name: 'XM Global',
        account_role: 'parent',
        account_type: 'demo',
        balance: 50000,
        equity: 50000,
        margin: 0,
        free_margin: 50000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        auto_trading_enabled: true,
        terminal_token_hash: BridgeStore.hashToken(parentToken),
        terminal_token_prefix: parentToken.slice(0, 12) + '...',
        last_sync: new Date().toISOString(),
      },
      {
        id: demoChildAccId,
        user_id: traderId,
        account_number: '6001001',
        broker_server: 'XMGlobal-MT5',
        broker_name: 'XM Global',
        account_role: 'child',
        account_type: 'demo',
        balance: 10000,
        equity: 10000,
        margin: 0,
        free_margin: 10000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        auto_trading_enabled: true,
        terminal_token_hash: BridgeStore.hashToken(childToken),
        terminal_token_prefix: childToken.slice(0, 12) + '...',
        last_sync: new Date().toISOString(),
      },
      // Legacy non-demo row simulated directly in storage to prove backend routes reject it
      {
        id: legacyLiveAccId,
        user_id: traderId,
        account_number: '9999001',
        broker_server: 'XMGlobal-Real 1',
        broker_name: 'XM Global',
        account_role: 'child',
        account_type: 'live',
        balance: 25000,
        equity: 25000,
        margin: 0,
        free_margin: 25000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        auto_trading_enabled: true,
        terminal_token_hash: BridgeStore.hashToken(liveToken),
        terminal_token_prefix: liveToken.slice(0, 12) + '...',
        last_sync: new Date().toISOString(),
      },
    ],
    mentor_assignments: [
      {
        id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
        mentor_id: mentorId,
        trader_id: traderId,
        parent_account_id: demoParentAccId,
        child_account_id: demoChildAccId,
        status: 'active',
        lot_mode: 'parent_lot',
        lot_multiplier: 1,
        fixed_lot: 0.1,
        sync_sl_tp: true,
      },
    ],
    bridge_instructions: [],
    trade_mappings: [],
    bridge_sync_logs: [],
    trades: [],
    audit_logs: [],
    notifications: [],
    brokers: [],
    broker_symbols: [],
  };

  const serviceDb = createDemoOnlyMockSupabase(state, 'service_role');
  const postgresDb = createDemoOnlyMockSupabase(state, 'postgres');

  // 2a. service_role cannot create a live account
  const svcLiveIns = await serviceDb.from('mt5_accounts').insert([
    {
      id: crypto.randomUUID(),
      user_id: traderId,
      account_number: '7777001',
      broker_server: 'Real-Server',
      broker_name: 'Broker',
      account_role: 'child',
      account_type: 'live',
    },
  ]);
  assert.ok(svcLiveIns.error, 'service_role insert with account_type=live MUST fail');
  assert.match(svcLiveIns.error.message, /Only Demo MT5 accounts/i);

  // 2b. postgres cannot create a live account
  const pgLiveIns = await postgresDb.from('mt5_accounts').insert([
    {
      id: crypto.randomUUID(),
      user_id: traderId,
      account_number: '7777002',
      broker_server: 'Real-Server',
      broker_name: 'Broker',
      account_role: 'child',
      account_type: 'real',
    },
  ]);
  assert.ok(pgLiveIns.error, 'postgres insert with account_type=real MUST fail');

  // 2c. service_role cannot convert an existing demo account to live
  const svcConvert = await serviceDb
    .from('mt5_accounts')
    .update({ account_type: 'live' })
    .eq('id', demoChildAccId);
  assert.ok(svcConvert.error, 'service_role update converting demo -> live MUST fail');
  assert.strictEqual(state.mt5_accounts.find((a) => a.id === demoChildAccId)?.account_type, 'demo');

  // 2d. service_role CAN perform legitimate demo telemetry updates
  const svcDemoTelemetry = await serviceDb
    .from('mt5_accounts')
    .update({ connection_status: 'connected', balance: 10150 })
    .eq('id', demoChildAccId);
  assert.strictEqual(svcDemoTelemetry.error, null, 'service_role demo telemetry update must succeed');
  await serviceDb.from('mt5_accounts').update({ connection_status: 'disconnected' }).eq('id', demoChildAccId);
  console.log('[PASS] 2. service_role & postgres cannot create or convert live accounts while demo telemetry succeeds.');

  // ------------------------------------------------------------------
  // Start Express API Server for Route-Level Tests
  // ------------------------------------------------------------------
  const app = createApiApp({
    supabaseUrlOverride: 'https://mock.supabase.co',
    serviceRoleKeyOverride: 'mock-service-role-key',
    serviceRoleClientOverride: serviceDb as any,
    authUserResolverOverride: async (token: string) => {
      const prof = state.profiles.find((p) => p.id === token);
      if (!prof) return { user: null, error: { message: 'Invalid test token' } };
      return { user: { id: prof.id, email: prof.email }, error: null };
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // ------------------------------------------------------------------
    // 3. Admin & Self-Service Live Registration Blocked + Normalization ('DEMO' / ' demo ')
    // ------------------------------------------------------------------
    const adminLiveRes = await fetch(`${baseUrl}/api/v1/admin/accounts/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminId}` },
      body: JSON.stringify({
        accountRole: 'child',
        userId: traderId,
        accountNumber: '8888001',
        brokerServer: 'XMGlobal-Real',
        accountType: 'live',
      }),
    });
    assert.strictEqual(adminLiveRes.status, 403, 'Admin cannot register a live account');
    assert.strictEqual((await adminLiveRes.json() as any).code, 'DEMO_ONLY_SAFETY_BLOCK');

    // Admin registers with 'DEMO' -> normalized to lowercase 'demo'
    const adminNormRes = await fetch(`${baseUrl}/api/v1/admin/accounts/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminId}` },
      body: JSON.stringify({
        accountRole: 'child',
        userId: traderId,
        accountNumber: '6002001',
        brokerServer: 'XMGlobal-MT5',
        accountType: 'DEMO',
      }),
    });
    assert.strictEqual(adminNormRes.status, 200, 'Admin registration with DEMO must normalize and succeed');
    const adminNormJson: any = await adminNormRes.json();
    assert.strictEqual(adminNormJson.account.accountType, 'demo');
    assert.strictEqual(
      state.mt5_accounts.find((a) => a.account_number === '6002001')?.account_type,
      'demo',
      "Admin registration must persist literal 'demo' for 'DEMO'"
    );

    // Self-service trader registers with ' demo ' -> normalized to lowercase 'demo'
    const traderNormRes = await fetch(`${baseUrl}/api/v1/bridge/accounts/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${traderId}` },
      body: JSON.stringify({
        accountRole: 'child',
        accountNumber: '6002002',
        brokerServer: 'XMGlobal-MT5',
        accountType: ' demo ',
      }),
    });
    assert.strictEqual(traderNormRes.status, 200, "Self-service registration with ' demo ' must normalize and succeed");
    const traderNormJson: any = await traderNormRes.json();
    assert.strictEqual(traderNormJson.account.accountType, 'demo');
    assert.strictEqual(
      state.mt5_accounts.find((a) => a.account_number === '6002002')?.account_type,
      'demo',
      "Self-service registration must persist literal 'demo' for ' demo '"
    );

    // Self-service live/real blocked
    const traderLiveRes = await fetch(`${baseUrl}/api/v1/bridge/accounts/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${traderId}` },
      body: JSON.stringify({
        accountRole: 'child',
        accountNumber: '8888002',
        brokerServer: 'XMGlobal-Real',
        accountType: 'real',
      }),
    });
    assert.strictEqual(traderLiveRes.status, 403, 'Trader cannot register a real/live account');
    console.log("[PASS] 3. Admin & self-service live registration blocked; 'DEMO' and ' demo ' normalized to 'demo'.");

    // ------------------------------------------------------------------
    // 4. Heartbeat & All Terminal-Authenticated Routes Reject Non-Demo Account
    //    (INCLUDING when tradeMode is omitted!)
    // ------------------------------------------------------------------
    const hbLiveOmittedMode = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-Token': liveToken,
        'X-Account-Number': '9999001',
      },
      body: JSON.stringify({ balance: 25000, equity: 25000 }), // tradeMode intentionally omitted
    });
    assert.strictEqual(hbLiveOmittedMode.status, 401, 'Heartbeat MUST reject non-demo account even when tradeMode is omitted');
    assert.strictEqual(
      state.mt5_accounts.find((a) => a.id === legacyLiveAccId)?.connection_status,
      'disconnected',
      'Non-demo account connection_status must remain disconnected'
    );

    const pollLiveRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/pending`, {
      headers: { 'X-Terminal-Token': liveToken },
    });
    assert.strictEqual(pollLiveRes.status, 401, 'instructions/pending must reject non-demo account');

    const ackLiveRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': liveToken },
      body: JSON.stringify({ instructionId: 'inst_1', status: 'EXECUTED' }),
    });
    assert.strictEqual(ackLiveRes.status, 401, 'instructions/ack must reject non-demo account');

    const closeLiveRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': liveToken },
      body: JSON.stringify({ ticket: 12345 }),
    });
    assert.strictEqual(closeLiveRes.status, 401, 'trade-close must reject non-demo account');

    const modLiveRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-modify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': liveToken },
      body: JSON.stringify({ ticket: 12345, sl: 2000 }),
    });
    assert.strictEqual(modLiveRes.status, 401, 'trade-modify must reject non-demo account');

    const dealLiveRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-deal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': liveToken },
      body: JSON.stringify({ ticket: 12345, realizedProfit: 50 }),
    });
    assert.strictEqual(dealLiveRes.status, 401, 'trade-deal must reject non-demo account');
    console.log('[PASS] 4. Heartbeat (with omitted tradeMode) and all EA terminal routes reject non-demo accounts.');

    // ------------------------------------------------------------------
    // 5. Terminal Token Registration Rejects Non-Demo Accounts & Preserves Ownership
    // ------------------------------------------------------------------
    // 5a. Unauthorized user rejected before token rotation
    const tokOtherRes = await fetch(`${baseUrl}/api/v1/bridge/terminals/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherTraderId}` },
      body: JSON.stringify({ accountId: demoChildAccId }),
    });
    assert.strictEqual(tokOtherRes.status, 403, 'Non-owner cannot rotate token');

    // 5b. Owner blocked from rotating token on non-demo account
    const tokLiveOwnerRes = await fetch(`${baseUrl}/api/v1/bridge/terminals/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${traderId}` },
      body: JSON.stringify({ accountId: legacyLiveAccId }),
    });
    assert.strictEqual(tokLiveOwnerRes.status, 403);
    assert.strictEqual((await tokLiveOwnerRes.json() as any).code, 'DEMO_ONLY_SAFETY_BLOCK');

    // 5c. Admin also blocked from rotating token on non-demo account
    const tokLiveAdminRes = await fetch(`${baseUrl}/api/v1/bridge/terminals/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminId}` },
      body: JSON.stringify({ accountId: legacyLiveAccId }),
    });
    assert.strictEqual(tokLiveAdminRes.status, 403);
    assert.strictEqual((await tokLiveAdminRes.json() as any).code, 'DEMO_ONLY_SAFETY_BLOCK');

    // 5d. Owner CAN rotate token on valid demo account
    const tokDemoRes = await fetch(`${baseUrl}/api/v1/bridge/terminals/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${traderId}` },
      body: JSON.stringify({ accountId: demoChildAccId }),
    });
    assert.strictEqual(tokDemoRes.status, 200);
    const tokDemoJson: any = await tokDemoRes.json();
    assert.ok(tokDemoJson.terminalToken, 'Valid demo account receives rotated terminal token');
    const rotatedChildToken = tokDemoJson.terminalToken as string;
    console.log('[PASS] 5. Terminal token registration rejects non-demo accounts (owner & admin) while preserving ownership & demo rotation.');

    // ------------------------------------------------------------------
    // 6. Legitimate Demo EA Lifecycle End-to-End Still Works
    // ------------------------------------------------------------------
    const hbParentRes = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-Token': parentToken,
        'X-Account-Number': '5001001',
      },
      body: JSON.stringify({ tradeMode: 'DEMO', balance: 50500, equity: 50500, pingMs: 14 }),
    });
    assert.strictEqual(hbParentRes.status, 200);
    assert.strictEqual(state.mt5_accounts.find((a) => a.id === demoParentAccId)?.connection_status, 'connected');

    const hbChildRes = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-Token': rotatedChildToken,
        'X-Account-Number': '6001001',
      },
      body: JSON.stringify({ balance: 10200, equity: 10200, pingMs: 19 }),
    });
    assert.strictEqual(hbChildRes.status, 200);
    assert.strictEqual(state.mt5_accounts.find((a) => a.id === demoChildAccId)?.connection_status, 'connected');

    const openRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
      body: JSON.stringify({
        ticket: 90001,
        symbol: 'XAUUSD',
        type: 'BUY',
        lots: 0.2,
        openPrice: 2650.5,
      }),
    });
    assert.strictEqual(openRes.status, 200);
    const openJson: any = await openRes.json();
    assert.strictEqual(openJson.childInstructionsQueued, 1);

    const pollDemoRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/pending`, {
      headers: { 'X-Terminal-Token': rotatedChildToken },
    });
    assert.strictEqual(pollDemoRes.status, 200);
    const pollDemoJson: any = await pollDemoRes.json();
    assert.strictEqual(pollDemoJson.count, 1);
    const instId = pollDemoJson.instructions[0].instructionId;

    const ackDemoRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': rotatedChildToken },
      body: JSON.stringify({
        instructionId: instId,
        status: 'EXECUTED',
        childTicket: 90002,
        fillPrice: 2650.6,
        executedLots: 0.2,
      }),
    });
    assert.strictEqual(ackDemoRes.status, 200);

    const modDemoRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-modify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
      body: JSON.stringify({ ticket: 90001, sl: 2640, tp: 2675 }),
    });
    assert.strictEqual(modDemoRes.status, 200);

    const closeDemoRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
      body: JSON.stringify({ ticket: 90001, closePrice: 2665, realizedProfit: 290 }),
    });
    assert.strictEqual(closeDemoRes.status, 200);

    const dealDemoRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-deal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': rotatedChildToken },
      body: JSON.stringify({ ticket: 90002, closePrice: 2665, realizedProfit: 288 }),
    });
    assert.strictEqual(dealDemoRes.status, 200);
    console.log('[PASS] 6. Full legitimate Demo registration, token rotation, heartbeat, and EA lifecycle verified.');
    console.log('=== ALL 6 DEMO-ONLY REMEDIATION TEST SUITES PASSED ===');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('Demo-Only Security Remediation Test Failed:', err);
  process.exit(1);
});
