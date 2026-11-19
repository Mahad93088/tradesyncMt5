import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApiApp } from '../src/server/apiApp.js';
import { BridgeStore } from '../src/server/bridgeStore.js';
import { writeAuditLog } from '../src/server/billingService.js';

interface TestDbState {
  profiles: Record<string, any>[];
  mentor_profiles: Record<string, any>[];
  mt5_accounts: Record<string, any>[];
  mentor_assignments: Record<string, any>[];
  mentor_groups: Record<string, any>[];
  platform_settings: Record<string, any>[];
  audit_logs: Record<string, any>[];
  notifications: Record<string, any>[];
  subscription_plans: Record<string, any>[];
  subscriptions: Record<string, any>[];
  payments: Record<string, any>[];
  invoices: Record<string, any>[];
  payment_webhooks: Record<string, any>[];
  bridge_instructions: Record<string, any>[];
  trade_mappings: Record<string, any>[];
  bridge_sync_logs: Record<string, any>[];
  trades: Record<string, any>[];
}

function createPersistenceMockSupabase(
  state: TestDbState,
  flags: {
    failTradeMappingsInsert?: boolean;
    failAuditLogsSelect?: boolean;
    failSyncLogsSelect?: boolean;
    failTradeMappingsSelect?: boolean;
  } = {}
) {
  const applyFilters = (
    rows: Record<string, any>[],
    filters: Array<{ op: string; col?: string; val?: any; expr?: string }>
  ) =>
    rows.filter((row) =>
      filters.every((f) => {
        if (f.op === 'eq') return row[f.col!] === f.val;
        if (f.op === 'neq') return row[f.col!] !== f.val;
        if (f.op === 'lt') return String(row[f.col!] ?? '') < String(f.val ?? '');
        if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(row[f.col!]);
        if (f.op === 'or' && f.expr) {
          if (f.expr.includes('status.eq.QUEUED')) {
            const nowIso = new Date().toISOString();
            return (
              row.status === 'QUEUED' ||
              (row.status === 'IN_FLIGHT' && String(row.lease_expires_at || '') < nowIso)
            );
          }
          const parts = f.expr.split(/,(?=[a-z_]+\.)/i);
          return parts.some((part) => {
            const eqMatch = part.match(/^([a-z_]+)\.eq\.(.+)$/i);
            if (eqMatch) return String(row[eqMatch[1]]) === eqMatch[2];
            return false;
          });
        }
        return true;
      })
    );

  return {
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
          if (tableName === 'trade_mappings' && flags.failTradeMappingsInsert) {
            return { data: null, error: { message: 'Simulated trade_mappings insert failure' } };
          }
          const items = Array.isArray(payload) ? payload : [payload];
          const inserted = items.map((item) => {
            const nowIso = new Date().toISOString();
            const row = {
              id: item.id || crypto.randomUUID(),
              created_at: item.created_at || nowIso,
              open_time: tableName === 'trade_mappings' ? item.open_time || nowIso : item.open_time,
              ...item,
            };
            if (tableName === 'trade_mappings') {
              const dup = table.find(
                (r) =>
                  r.parent_trade_ticket === row.parent_trade_ticket &&
                  r.child_account_id === row.child_account_id
              );
              if (dup) {
                throw { code: '23505', message: 'duplicate key value violates unique constraint trade_mappings' };
              }
            }
            if (tableName === 'bridge_instructions') {
              const dup = table.find((r) => r.idempotency_key && r.idempotency_key === row.idempotency_key);
              if (dup) {
                throw { code: '23505', message: 'duplicate key value violates unique constraint bridge_instructions' };
              }
            }
            table.push(row);
            return { ...row };
          });
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
              out.push({ ...table[idx] });
            } else {
              const row = {
                id: item.id || crypto.randomUUID(),
                created_at: item.created_at || new Date().toISOString(),
                ...item,
              };
              table.push(row);
              out.push({ ...row });
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
          const matchedIds = new Set(applyFilters(table, filters).map((r) => r.id));
          const deleted = table.filter((r) => matchedIds.has(r.id));
          state[tableName] = table.filter((r) => !matchedIds.has(r.id)) as any;
          return { data: deleted, error: null };
        }

        if (tableName === 'audit_logs' && flags.failAuditLogsSelect) {
          return { data: null, error: { message: 'Simulated audit_logs select error' } };
        }
        if (tableName === 'bridge_sync_logs' && flags.failSyncLogsSelect) {
          return { data: null, error: { message: 'Simulated bridge_sync_logs select error' } };
        }
        if (tableName === 'trade_mappings' && flags.failTradeMappingsSelect) {
          return { data: null, error: { message: 'Simulated trade_mappings select error' } };
        }

        let res = applyFilters(table, filters).map((r) => ({ ...r }));
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

      const safeExecute = async () => {
        try {
          return await execute();
        } catch (err: any) {
          return { data: null, error: err };
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
        lt: (col: string, val: any) => {
          filters.push({ op: 'lt', col, val });
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
          const r = await safeExecute();
          if (r.error) return { data: null, error: r.error };
          if (!r.data || r.data.length === 0) return { data: null, error: { message: 'No rows found' } };
          return { data: r.data[0], error: null };
        },
        maybeSingle: async () => {
          const r = await safeExecute();
          if (r.error) return { data: null, error: r.error };
          return { data: r.data && r.data.length > 0 ? r.data[0] : null, error: null };
        },
        then: (resolve: any, reject: any) => safeExecute().then(resolve, reject),
      };
      return builder;
    },

    async rpc(fnName: string, args: any) {
      if (fnName === 'claim_pending_instructions') {
        const now = Date.now();
        const leaseExpiresAt = new Date(now + (args.p_lease_seconds || 15) * 1000).toISOString();
        const claimed: any[] = [];
        for (const row of state.bridge_instructions) {
          if (row.child_account_id !== args.p_child_account_id) continue;
          const isQueued = row.status === 'QUEUED';
          const isExpired = row.status === 'IN_FLIGHT' && String(row.lease_expires_at || '') < new Date(now).toISOString();
          if (isQueued || isExpired) {
            row.status = 'IN_FLIGHT';
            row.lease_expires_at = leaseExpiresAt;
            if (isExpired) row.retry_count = (Number(row.retry_count) || 0) + 1;
            claimed.push({ ...row });
            if (claimed.length >= (args.p_limit || 20)) break;
          }
        }
        return { data: claimed, error: null };
      }
      return { data: [], error: null };
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
  console.log('=== TradeSync MT5 Persistent Global Logs & Ticket Mapping Tests ===\n');
  let passed = 0;

  // --------------------------------------------------------------------------
  // 1. writeAuditLog() unit tests: persistence, secret redaction, non-silent errors
  // --------------------------------------------------------------------------
  const missingClientRes = await writeAuditLog(null, {
    actorRole: 'admin',
    action: 'TEST_NO_CLIENT',
    targetType: 'platform_settings',
    result: 'failed',
    details: 'No client provided',
  });
  assert.strictEqual(missingClientRes.persisted, false);
  assert.ok(missingClientRes.error);

  const failingInsertDb = {
    from: () => ({
      insert: async () => ({ error: { message: 'permission denied for table audit_logs' } }),
    }),
  } as any;
  const insertErrRes = await writeAuditLog(failingInsertDb, {
    actorRole: 'admin',
    action: 'TEST_DB_ERROR',
    targetType: 'platform_settings',
    result: 'failed',
    details: 'DB refused insert',
  });
  assert.strictEqual(insertErrRes.persisted, false);
  assert.strictEqual(insertErrRes.error, 'permission denied for table audit_logs');

  const unitAuditState: any[] = [];
  const captureDb = {
    from: () => ({
      insert: async (rows: any[]) => {
        unitAuditState.push(...rows);
        return { error: null };
      },
    }),
  } as any;

  const secretRes = await writeAuditLog(captureDb, {
    actorId: 'admin-1',
    actorRole: 'admin',
    action: 'SECRET_REDACTION_CHECK',
    targetType: 'mt5_accounts',
    targetId: 'acc-1',
    result: 'success',
    details: 'Rotated ts_parent_abc123456789 and Bearer mysecrettokenvalue123 and sk_live_topsecret999',
    metadata: {
      password: 'plain-password-123',
      terminalToken: 'ts_child_secretvalue999',
      apiKey: 'key_value_xyz',
      safeField: 'visible-value',
    },
  });
  assert.strictEqual(secretRes.persisted, true);
  assert.strictEqual(unitAuditState.length, 1);
  assert.strictEqual(unitAuditState[0].details.includes('abc123456789'), false);
  assert.strictEqual(unitAuditState[0].details.includes('mysecrettokenvalue123'), false);
  assert.strictEqual(unitAuditState[0].details.includes('topsecret999'), false);
  assert.strictEqual(unitAuditState[0].metadata.password, '[REDACTED]');
  assert.strictEqual(unitAuditState[0].metadata.terminalToken, '[REDACTED]');
  assert.strictEqual(unitAuditState[0].metadata.apiKey, '[REDACTED]');
  assert.strictEqual(unitAuditState[0].metadata.safeField, 'visible-value');
  passed++;
  console.log('[PASS] 1. writeAuditLog() redacts secrets/tokens and reports DB failures without throwing or swallowing.');

  // --------------------------------------------------------------------------
  // Setup API server with clean empty audit_logs, bridge_sync_logs, trade_mappings
  // --------------------------------------------------------------------------
  const adminId = '11111111-1111-4111-8111-111111111111';
  const mentorId = '22222222-2222-4222-8222-222222222222';
  const traderId = '33333333-3333-4333-8333-333333333333';
  const parentAccId = 'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const childAccId = 'bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const liveBlockedAccId = 'cccc1111-cccc-4ccc-8ccc-ccccccccccc1';
  const proPlanId = '99992222-9999-4999-8999-999999999902';

  const parentToken = BridgeStore.generateSecureToken('ts_parent');
  const childToken = BridgeStore.generateSecureToken('ts_child');
  const liveToken = BridgeStore.generateSecureToken('ts_child');

  const state: TestDbState = {
    profiles: [
      { id: adminId, email: 'admin@tradesync.io', full_name: 'Super Admin', role: 'admin', status: 'active' },
      { id: mentorId, email: 'mentor@tradesync.io', full_name: 'Mentor Pro', role: 'mentor', status: 'active' },
      { id: traderId, email: 'trader@tradesync.io', full_name: 'Trader One', role: 'trader', status: 'pending' },
    ],
    mentor_profiles: [
      { id: 'mp_1', user_id: mentorId, strategy_name: 'London FX', description: 'Demo master', monthly_fee: 99, max_followers: 50, invite_code: 'TS-LONDON' },
    ],
    mt5_accounts: [
      {
        id: parentAccId,
        user_id: mentorId,
        account_role: 'parent',
        account_number: '500101',
        broker_name: 'XM',
        broker_server: 'XMGlobal-MT5 7',
        account_type: 'demo',
        balance: 50000,
        equity: 50000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        auto_trading_enabled: true,
        terminal_token_hash: BridgeStore.hashToken(parentToken),
      },
      {
        id: childAccId,
        user_id: traderId,
        account_role: 'child',
        account_number: '600101',
        broker_name: 'XM',
        broker_server: 'XMGlobal-MT5 2',
        account_type: 'demo',
        balance: 10000,
        equity: 10000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        auto_trading_enabled: true,
        terminal_token_hash: BridgeStore.hashToken(childToken),
      },
      {
        id: liveBlockedAccId,
        user_id: traderId,
        account_role: 'child',
        account_number: '700999',
        broker_name: 'XM',
        broker_server: 'XMGlobal-Live',
        account_type: 'live',
        balance: 25000,
        equity: 25000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        auto_trading_enabled: true,
        terminal_token_hash: BridgeStore.hashToken(liveToken),
      },
    ],
    mentor_assignments: [],
    mentor_groups: [],
    platform_settings: [
      { id: 'default', demo_only_enforced: true, default_slippage_max_pips: 3.0, default_max_lot_cap: 50.0, heartbeat_stale_seconds: 60, maintenance_mode: false },
    ],
    audit_logs: [],
    notifications: [],
    subscription_plans: [
      { id: proPlanId, code: 'pro_50', name: 'Pro 50', tier: 'mentor_pro', monthly_price_usd: 149, yearly_price_usd: 1490, max_followers: 50, max_child_accounts: 50, is_active: true, features: ['50 followers'] },
    ],
    subscriptions: [
      {
        id: 'sub_1',
        user_id: mentorId,
        mentor_id: mentorId,
        plan_id: proPlanId,
        status: 'active',
        billing_cycle: 'monthly',
        amount_usd: 149,
        currency: 'USD',
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString(),
        cancel_at_period_end: false,
      },
    ],
    payments: [],
    invoices: [],
    payment_webhooks: [],
    bridge_instructions: [],
    trade_mappings: [],
    bridge_sync_logs: [],
    trades: [],
  };

  const flags = {
    failTradeMappingsInsert: false,
    failAuditLogsSelect: false,
    failSyncLogsSelect: false,
    failTradeMappingsSelect: false,
  };

  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;

  const mockDb = createPersistenceMockSupabase(state, flags);
  const app = createApiApp({
    serviceRoleClientOverride: mockDb as any,
    supabaseUrlOverride: 'https://test.supabase.co',
    serviceRoleKeyOverride: 'service-role-test',
    allowedOriginsOverride: ['http://localhost:3000'],
    rateLimitOverrides: { webhook: 10, auth_sensitive: 100 },
    authUserResolverOverride: async (token: string) => {
      if (token === 'jwt-admin') return { user: { id: adminId, email: 'admin@tradesync.io' } };
      if (token === 'jwt-mentor') return { user: { id: mentorId, email: 'mentor@tradesync.io' } };
      if (token === 'jwt-trader') return { user: { id: traderId, email: 'trader@tradesync.io' } };
      return { user: null, error: { message: 'Invalid token' } };
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // ------------------------------------------------------------------------
    // 2. Global Logs RBAC, Empty DB Transparency, and Non-Silent DB Errors
    // ------------------------------------------------------------------------
    const unauthAudit = await httpReq(baseUrl, 'GET', '/api/admin/audit-logs');
    assert.strictEqual(unauthAudit.status, 401);

    const nonAdminAudit = await httpReq(baseUrl, 'GET', '/api/admin/audit-logs', {
      headers: { Authorization: 'Bearer jwt-mentor' },
    });
    assert.strictEqual(nonAdminAudit.status, 403);

    const emptyAudit = await httpReq(baseUrl, 'GET', '/api/admin/audit-logs', {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(emptyAudit.status, 200);
    assert.deepStrictEqual(emptyAudit.json.logs, []);

    const emptySync = await httpReq(baseUrl, 'GET', '/api/v1/bridge/logs', {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(emptySync.status, 200);
    assert.deepStrictEqual(emptySync.json.logs, []);

    const emptyMappings = await httpReq(baseUrl, 'GET', '/api/v1/bridge/mappings', {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(emptyMappings.status, 200);
    assert.deepStrictEqual(emptyMappings.json.mappings, []);

    // Verify DB read errors surface HTTP 500 instead of pretending empty []
    flags.failAuditLogsSelect = true;
    const errAudit = await httpReq(baseUrl, 'GET', '/api/admin/audit-logs', {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(errAudit.status, 500);
    flags.failAuditLogsSelect = false;

    flags.failSyncLogsSelect = true;
    const errSync = await httpReq(baseUrl, 'GET', '/api/v1/bridge/logs', {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(errSync.status, 500);
    flags.failSyncLogsSelect = false;

    flags.failTradeMappingsSelect = true;
    const errMap = await httpReq(baseUrl, 'GET', '/api/v1/bridge/mappings', {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(errMap.status, 500);
    flags.failTradeMappingsSelect = false;
    passed++;
    console.log('[PASS] 2. Global Logs GET routes enforce 401/403 RBAC, return true empty [] on 0 DB rows, and surface 500 on query failures.');

    // ------------------------------------------------------------------------
    // 3. Authoritative Admin & Billing Operations -> Real audit_logs Persistence
    // ------------------------------------------------------------------------
    // Approve pending trader
    const approveRes = await httpReq(baseUrl, 'POST', '/api/admin/approve-user', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: { targetUserId: traderId },
    });
    assert.strictEqual(approveRes.status, 200);

    // Failed live account registration should fail 403 AND audit the denied action
    const regLiveRes = await httpReq(baseUrl, 'POST', '/api/v1/admin/accounts/register', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: {
        userId: traderId,
        accountRole: 'child',
        brokerName: 'XM',
        brokerServer: 'XMGlobal-Live',
        accountNumber: '99887766',
        accountType: 'live',
      },
    });
    assert.strictEqual(regLiveRes.status, 403);

    // Valid Demo account registration should audit AND NEVER expose raw terminal token in audit_logs/bridge_sync_logs
    const regDemoRes = await httpReq(baseUrl, 'POST', '/api/v1/admin/accounts/register', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: {
        userId: traderId,
        accountRole: 'child',
        brokerName: 'XM',
        brokerServer: 'XMGlobal-MT5 2',
        accountNumber: '600202',
        accountType: 'demo',
      },
    });
    assert.ok(regDemoRes.status === 200 || regDemoRes.status === 201, `Expected 200/201, got ${regDemoRes.status}`);
    const createdToken = regDemoRes.json.terminalToken;
    assert.ok(createdToken && createdToken.startsWith('ts_child_'));

    // Admin assignment creation
    const assignRes = await httpReq(baseUrl, 'POST', '/api/v1/admin/assignments', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: {
        mentorId,
        traderId,
        parentAccountId: parentAccId,
        childAccountId: childAccId,
        lotSettings: {
          copyMode: 'multiplier',
          multiplier: 1.5,
        },
      },
    });
    assert.strictEqual(assignRes.status, 200);

    // Unconfigured Stripe checkout attempt -> 501 + failed/denied audit log
    const checkoutRes = await httpReq(baseUrl, 'POST', '/api/v1/billing/checkout', {
      headers: { Authorization: 'Bearer jwt-mentor' },
      body: { planId: proPlanId, billingCycle: 'monthly', provider: 'stripe' },
    });
    assert.strictEqual(checkoutRes.status, 501);

    // Mentor strategy group create + delete
    const grpCreateRes = await httpReq(baseUrl, 'POST', '/api/v1/bridge/mentor/groups', {
      headers: { Authorization: 'Bearer jwt-mentor' },
      body: { name: 'Alpha VIP', description: 'Group test' },
    });
    assert.ok(grpCreateRes.status === 200 || grpCreateRes.status === 201, `Expected 200/201, got ${grpCreateRes.status}`);
    const grpDelRes = await httpReq(baseUrl, 'DELETE', `/api/v1/bridge/mentor/groups/${grpCreateRes.json.group.id}`, {
      headers: { Authorization: 'Bearer jwt-mentor' },
    });
    assert.strictEqual(grpDelRes.status, 200);

    const auditAfterAdmin = await httpReq(baseUrl, 'GET', '/api/admin/audit-logs', {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(auditAfterAdmin.status, 200);
    const logs = auditAfterAdmin.json.logs;
    assert.ok(logs.some((l: any) => l.action === 'ADMIN_USER_APPROVED' && l.result === 'success'));
    assert.ok(logs.some((l: any) => l.action === 'ADMIN_MT5_ACCOUNT_REGISTERED' && l.result === 'warning'));
    assert.ok(state.audit_logs.some((l) => l.action === 'ADMIN_MT5_ACCOUNT_REGISTERED' && l.result === 'denied'));
    assert.ok(logs.some((l: any) => l.action === 'ADMIN_MT5_ACCOUNT_REGISTERED' && l.result === 'success'));
    assert.ok(logs.some((l: any) => l.action === 'ADMIN_ASSIGNMENT_CREATED' && l.result === 'success'));
    assert.ok(logs.some((l: any) => l.action === 'BILLING_CHECKOUT_INITIATED' && l.result === 'failure'));
    assert.ok(logs.some((l: any) => l.action === 'MENTOR_GROUP_CREATED'));
    assert.ok(logs.some((l: any) => l.action === 'MENTOR_GROUP_DELETED'));

    const allLogsSerialized = JSON.stringify(state.audit_logs) + JSON.stringify(state.bridge_sync_logs);
    assert.strictEqual(allLogsSerialized.includes(createdToken), false, 'Plaintext terminal token must never be logged');
    passed++;
    console.log('[PASS] 3. Admin, bridge-admin, billing, and mentor-group actions persist to audit_logs (success & failure) with zero token leaks.');

    // ------------------------------------------------------------------------
    // 4. Bridge Lifecycle Logs (Transition Only, No Heartbeat/Poll Spam) & BIGINT Sanitization
    // ------------------------------------------------------------------------
    const hbParent1 = await httpReq(baseUrl, 'POST', '/api/v1/bridge/heartbeat', {
      headers: { 'X-Terminal-Token': parentToken, 'X-Account-Number': '500101' },
      body: { accountNumber: '500101', accountType: 'demo', balance: 50000, equity: 50000, pingMs: 22 },
    });
    assert.strictEqual(hbParent1.status, 200);

    const hbChild1 = await httpReq(baseUrl, 'POST', '/api/v1/bridge/heartbeat', {
      headers: { 'X-Terminal-Token': childToken, 'X-Account-Number': '600101' },
      body: { accountNumber: '600101', accountType: 'demo', balance: 10000, equity: 10000, pingMs: 28 },
    });
    assert.strictEqual(hbChild1.status, 200);

    const logsCountAfterConnect = state.bridge_sync_logs.length;
    assert.ok(state.bridge_sync_logs.some((l) => l.event_type === 'BRIDGE_TERMINAL_CONNECTED'));

    // Subsequent steady-state heartbeats & idle polls must NOT flood bridge_sync_logs
    await httpReq(baseUrl, 'POST', '/api/v1/bridge/heartbeat', {
      headers: { 'X-Terminal-Token': childToken, 'X-Account-Number': '600101' },
      body: { accountNumber: '600101', accountType: 'demo', balance: 10000, equity: 10000, pingMs: 30 },
    });
    await httpReq(baseUrl, 'GET', '/api/v1/bridge/instructions/pending', {
      headers: { 'X-Terminal-Token': childToken, 'X-Account-Number': '600101' },
    });
    await httpReq(baseUrl, 'GET', '/api/v1/bridge/instructions/pending', {
      headers: { 'X-Terminal-Token': childToken, 'X-Account-Number': '600101' },
    });
    assert.strictEqual(state.bridge_sync_logs.length, logsCountAfterConnect, 'Idle polls & steady-state heartbeats must not spam bridge_sync_logs');

    // Non-DEMO safety block must reject (403) and log DEMO_ONLY_SAFETY_BLOCK
    const liveBlockRes = await httpReq(baseUrl, 'POST', '/api/v1/bridge/heartbeat', {
      headers: { 'X-Terminal-Token': liveToken, 'X-Account-Number': '700999' },
      body: { accountNumber: '700999', tradeMode: 'live', balance: 25000, equity: 25000 },
    });
    assert.strictEqual(liveBlockRes.status, 403);
    assert.ok(state.bridge_sync_logs.some((l) => l.event_type === 'DEMO_ONLY_SAFETY_BLOCK'));

    // Sanitize non-numeric ticket into null for BIGINT safety
    assert.strictEqual(BridgeStore.sanitizeBigintTicket('not-a-ticket'), null);
    assert.strictEqual(BridgeStore.sanitizeBigintTicket('0'), null);
    assert.strictEqual(BridgeStore.sanitizeBigintTicket('9876543210123'), '9876543210123');

    const store = BridgeStore.getInstance();
    await store.addSyncLog(
      {
        eventType: 'SANITIZE_TEST',
        level: 'warn',
        details: 'Attempted with ts_child_rawsecretvalue999',
        ticket: 'acc-uuid-not-bigint',
      },
      mockDb as any
    );
    const sanLog = state.bridge_sync_logs.find((l) => l.event_type === 'SANITIZE_TEST');
    assert.ok(sanLog);
    assert.strictEqual(sanLog.ticket, null);
    assert.strictEqual(sanLog.details.includes('rawsecretvalue999'), false);
    passed++;
    console.log('[PASS] 4. Bridge terminal transitions, idle poll non-spam, Demo-only safety log, and BIGINT ticket sanitization verified.');

    // ------------------------------------------------------------------------
    // 5. End-to-End trade_mappings Lifecycle & Rollback on Mapping DB Failure
    // ------------------------------------------------------------------------
    // 5a. Simulate trade_mappings insert failure -> bridge_instructions must roll back and fail loudly
    flags.failTradeMappingsInsert = true;
    const failedOpenRes = await httpReq(baseUrl, 'POST', '/api/v1/bridge/events/trade-open', {
      headers: { 'X-Terminal-Token': parentToken, 'X-Account-Number': '500101' },
      body: {
        ticket: '11223344',
        symbol: 'EURUSD',
        type: 'BUY',
        lots: 1.0,
        openPrice: 1.095,
      },
    });
    assert.strictEqual(failedOpenRes.status, 500, 'Mapping write failure must fail loudly with HTTP 500');
    assert.strictEqual(
      state.bridge_instructions.some((i) => i.parent_ticket === '11223344'),
      false,
      'Orphaned bridge_instructions row must be rolled back if trade_mappings insert fails'
    );
    flags.failTradeMappingsInsert = false;

    // 5b. Real Parent Trade OPEN -> instruction + PENDING trade_mapping
    const parentTicket = '5566778899';
    const openRes = await httpReq(baseUrl, 'POST', '/api/v1/bridge/events/trade-open', {
      headers: { 'X-Terminal-Token': parentToken, 'X-Account-Number': '500101' },
      body: {
        ticket: parentTicket,
        symbol: 'XAUUSD',
        type: 'BUY',
        lots: 1.0,
        openPrice: 2450.5,
        sl: 2440.0,
        tp: 2475.0,
      },
    });
    assert.strictEqual(openRes.status, 200);
    assert.strictEqual(state.trade_mappings.length, 1);
    const originalMappingId = state.trade_mappings[0].id;
    assert.strictEqual(state.trade_mappings[0].status, 'PENDING');
    assert.strictEqual(state.trade_mappings[0].child_lots, 1.5); // 1.0 * 1.5 multiplier

    // 5c. Child polls pending instructions (IN_FLIGHT lease)
    const pollRes = await httpReq(baseUrl, 'GET', '/api/v1/bridge/instructions/pending', {
      headers: { 'X-Terminal-Token': childToken, 'X-Account-Number': '600101' },
    });
    assert.strictEqual(pollRes.status, 200);
    assert.strictEqual(pollRes.json.instructions.length, 1);
    const openInst = pollRes.json.instructions[0];
    assert.strictEqual(openInst.action, 'OPEN');
    assert.strictEqual(openInst.parentTicket, parentTicket);

    // 5d. Child ACKs EXECUTED -> trade_mappings updates status + child_trade_ticket & preserves PK id
    const childTicket = '9988776655';
    const ackOpenRes = await httpReq(baseUrl, 'POST', '/api/v1/bridge/instructions/ack', {
      headers: { 'X-Terminal-Token': childToken, 'X-Account-Number': '600101' },
      body: {
        instructionId: openInst.instructionId,
        status: 'EXECUTED',
        childTicket,
        executedPrice: 2450.7,
        executedLots: 1.5,
        executionLatencyMs: 84,
      },
    });
    assert.strictEqual(ackOpenRes.status, 200);
    assert.strictEqual(state.trade_mappings.length, 1);
    assert.strictEqual(state.trade_mappings[0].id, originalMappingId, 'trade_mappings PK id must remain stable after ACK');
    assert.strictEqual(state.trade_mappings[0].status, 'EXECUTED');
    assert.strictEqual(String(state.trade_mappings[0].child_trade_ticket), childTicket);

    // 5e. Parent closes trade -> Child polls CLOSE -> Child ACKs CLOSE EXECUTED -> CLOSED mapping with same PK id
    const closeReq = await httpReq(baseUrl, 'POST', '/api/v1/bridge/events/trade-close', {
      headers: { 'X-Terminal-Token': parentToken, 'X-Account-Number': '500101' },
      body: { ticket: parentTicket, closeType: 'FULL', closePrice: 2465.0 },
    });
    assert.strictEqual(closeReq.status, 200);

    const pollCloseRes = await httpReq(baseUrl, 'GET', '/api/v1/bridge/instructions/pending', {
      headers: { 'X-Terminal-Token': childToken, 'X-Account-Number': '600101' },
    });
    assert.strictEqual(pollCloseRes.status, 200);
    assert.strictEqual(pollCloseRes.json.instructions.length, 1);
    const closeInst = pollCloseRes.json.instructions[0];
    assert.strictEqual(closeInst.action, 'CLOSE');

    const ackCloseRes = await httpReq(baseUrl, 'POST', '/api/v1/bridge/instructions/ack', {
      headers: { 'X-Terminal-Token': childToken, 'X-Account-Number': '600101' },
      body: {
        instructionId: closeInst.instructionId,
        status: 'EXECUTED',
        childTicket,
        executedPrice: 2465.0,
        executionLatencyMs: 65,
      },
    });
    assert.strictEqual(ackCloseRes.status, 200);

    // Verify Global Logs HTTP endpoints return real persisted rows
    const finalMappingsRes = await httpReq(baseUrl, 'GET', '/api/v1/bridge/mappings', {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(finalMappingsRes.status, 200);
    assert.strictEqual(finalMappingsRes.json.mappings.length, 1);
    assert.strictEqual(finalMappingsRes.json.mappings[0].id, originalMappingId);
    assert.strictEqual(finalMappingsRes.json.mappings[0].status, 'CLOSED');
    assert.strictEqual(finalMappingsRes.json.mappings[0].childTradeTicket, childTicket);

    const finalSyncLogsRes = await httpReq(baseUrl, 'GET', '/api/v1/bridge/logs', {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(finalSyncLogsRes.status, 200);
    const syncEvents = finalSyncLogsRes.json.logs.map((l: any) => l.eventType);
    assert.ok(syncEvents.includes('BRIDGE_OPEN_QUEUED'));
    assert.ok(syncEvents.includes('BROKER_ACK_EXECUTED'));
    assert.ok(syncEvents.includes('BRIDGE_CLOSE_QUEUED'));
    passed++;
    console.log('[PASS] 5. Full trade_mappings OPEN->POLL->ACK->CLOSE->CLOSED lifecycle, PK id preservation, rollback on error, and Global Logs API visibility verified.');

    console.log(`\nALL ${passed}/5 PERSISTENCE & LOGGING TEST SUITES PASSED.`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
