import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApiApp } from '../src/server/apiApp.js';
import { buildCsvContent } from '../src/components/common/exportHelpers.js';

interface Day2DbState {
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
  bridge_sync_logs: Record<string, any>[];
}

function createDay2MockSupabase(state: Day2DbState) {
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
            return false;
          });
        }
        return true;
      })
    );

  return {
    from(tableName: keyof Day2DbState) {
      const filters: Array<{ op: string; col?: string; val?: any; expr?: string }> = [];
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitNum: number | null = null;
      let mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
      let payload: any = null;
      let upsertOnConflict: string | null = null;

      const execute = async () => {
        const table = state[tableName];
        if (!table) return { data: null, error: { code: '42P01', message: `Table ${String(tableName)} does not exist` } };

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
  opts: { headers?: Record<string, string>; body?: any; rawBody?: string } = {}
) {
  const raw = opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
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
  console.log('=== TradeSync MT5 Day 2 SaaS Completion & Security Tests ===\n');
  let passed = 0;

  // --------------------------------------------------------------------------
  // 1. Migration 09 SQL Integrity & Security Hardening Verification
  // --------------------------------------------------------------------------
  const mig09Path = path.resolve(process.cwd(), 'supabase/migrations/09_day2_security_billing_hardening.sql');
  assert.strictEqual(fs.existsSync(mig09Path), true, 'Migration 09 SQL file must exist');
  const mig09Sql = fs.readFileSync(mig09Path, 'utf8');
  assert.strictEqual(mig09Sql.includes('REVOKE UPDATE ON TABLE public.notifications FROM authenticated'), true);
  assert.strictEqual(mig09Sql.includes('GRANT UPDATE (is_read) ON TABLE public.notifications TO authenticated'), true);
  assert.strictEqual(mig09Sql.includes('enforce_notifications_immutable_columns()'), true);
  assert.strictEqual(mig09Sql.includes('ON DELETE SET NULL'), true);
  assert.strictEqual(mig09Sql.includes('preserve_billing_history_before_profile_delete()'), true);
  assert.strictEqual(mig09Sql.includes("'starter_10'") && mig09Sql.includes("'pro_50'") && mig09Sql.includes("'business_200'"), true);
  assert.strictEqual(mig09Sql.includes('ADD COLUMN IF NOT EXISTS group_id UUID'), true);
  assert.strictEqual(mig09Sql.includes('validate_mentor_assignment_group()'), true);
  passed++;
  console.log('[PASS] 1. Migration 09 SQL hardening (notifications column RLS, archival FK preservation, plan seeds, group validation) verified.');

  // --------------------------------------------------------------------------
  // Setup Test Server & Seeded State
  // --------------------------------------------------------------------------
  const adminId = '11111111-1111-4111-8111-111111111111';
  const mentorId = '22222222-2222-4222-8222-222222222222';
  const trader1Id = '33333333-3333-4333-8333-333333333331';
  const trader2Id = '33333333-3333-4333-8333-333333333332';

  const parentAccId = 'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const child1AccId = 'bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const child2AccId = 'bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

  const starterPlanId = '99991111-9999-4999-8999-999999999901';
  const proPlanId = '99992222-9999-4999-8999-999999999902';

  const state: Day2DbState = {
    profiles: [
      { id: adminId, email: 'admin@tradesync.io', full_name: 'Super Admin', role: 'admin', status: 'active' },
      { id: mentorId, email: 'mentor@tradesync.io', full_name: 'Mentor Pro', role: 'mentor', status: 'active' },
      { id: trader1Id, email: 'trader1@tradesync.io', full_name: 'Trader One', role: 'trader', status: 'active' },
      { id: trader2Id, email: 'trader2@tradesync.io', full_name: 'Trader Two', role: 'trader', status: 'active' },
    ],
    mentor_profiles: [
      { id: 'mp_1', user_id: mentorId, strategy_name: 'Institutional FX', description: 'Trend follower', monthly_fee: 99, max_followers: 10, invite_code: `TS-${mentorId.slice(0, 8).toUpperCase()}` },
    ],
    mt5_accounts: [
      { id: parentAccId, user_id: mentorId, account_role: 'parent', account_number: '500101', broker_name: 'XM', broker_server: 'XMGlobal-MT5', account_type: 'demo', balance: 50000, equity: 50000, connection_status: 'connected' },
      { id: child1AccId, user_id: trader1Id, account_role: 'child', account_number: '600101', broker_name: 'XM', broker_server: 'XMGlobal-MT5', account_type: 'demo', balance: 10000, equity: 10000, connection_status: 'connected' },
      { id: child2AccId, user_id: trader2Id, account_role: 'child', account_number: '600102', broker_name: 'XM', broker_server: 'XMGlobal-MT5', account_type: 'demo', balance: 10000, equity: 10000, connection_status: 'connected' },
    ],
    mentor_assignments: [],
    mentor_groups: [],
    platform_settings: [
      { id: 'default', demo_only_enforced: true, default_slippage_max_pips: 3.0, default_max_lot_cap: 50.0, heartbeat_stale_seconds: 60, maintenance_mode: false },
    ],
    audit_logs: [],
    notifications: [],
    subscription_plans: [
      { id: starterPlanId, code: 'starter_10', name: 'Starter 10', tier: 'mentor_pro', monthly_price_usd: 49, yearly_price_usd: 490, max_followers: 1, max_child_accounts: 1, is_active: true, features: ['1 follower slot for quota test'] },
      { id: proPlanId, code: 'pro_50', name: 'Pro 50', tier: 'mentor_pro', monthly_price_usd: 149, yearly_price_usd: 1490, max_followers: 50, max_child_accounts: 50, is_active: true, features: ['50 follower slots'] },
    ],
    subscriptions: [
      {
        id: 'sub_mentor_1',
        user_id: mentorId,
        mentor_id: mentorId,
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
    payments: [
      { id: 'pay_seed_1', subscription_id: 'sub_mentor_1', user_id: mentorId, provider: 'stripe', provider_payment_id: 'pi_seed_1', amount_usd: 49, currency: 'USD', status: 'succeeded', paid_at: new Date().toISOString() },
    ],
    invoices: [
      { id: 'inv_seed_1', subscription_id: 'sub_mentor_1', payment_id: 'pay_seed_1', user_id: mentorId, invoice_number: 'INV-SEED-001', amount_usd: 49, currency: 'USD', status: 'paid', issued_at: new Date().toISOString(), paid_at: new Date().toISOString() },
    ],
    payment_webhooks: [],
    bridge_sync_logs: [],
  };

  // Clear payment env vars initially to prove honest 501 behavior
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  delete process.env.PAYPAL_WEBHOOK_ID;

  const mockDb = createDay2MockSupabase(state);
  const app = createApiApp({
    serviceRoleClientOverride: mockDb as any,
    supabaseUrlOverride: 'https://test.supabase.co',
    serviceRoleKeyOverride: 'service-role-test',
    allowedOriginsOverride: ['http://localhost:3000'],
    rateLimitOverrides: { webhook: 3, auth_sensitive: 50 },
    authUserResolverOverride: async (token: string) => {
      if (token === 'jwt-admin') return { user: { id: adminId, email: 'admin@tradesync.io' } };
      if (token === 'jwt-mentor') return { user: { id: mentorId, email: 'mentor@tradesync.io' } };
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
    // 2. Security Headers, CORS Allowlist & Non-Browser EA Origin Tolerance
    // ------------------------------------------------------------------------
    const blockedOriginRes = await httpReq(baseUrl, 'GET', '/api/health', {
      headers: { Origin: 'https://evil-attacker.example' },
    });
    assert.strictEqual(blockedOriginRes.status, 403);
    assert.strictEqual(blockedOriginRes.json.code, 'CORS_ORIGIN_FORBIDDEN');

    const allowedOriginRes = await httpReq(baseUrl, 'GET', '/api/health', {
      headers: { Origin: 'http://localhost:3000' },
    });
    assert.strictEqual(allowedOriginRes.status, 200);
    assert.strictEqual(allowedOriginRes.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(allowedOriginRes.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(allowedOriginRes.headers.get('access-control-allow-origin'), 'http://localhost:3000');

    const noOriginEaRes = await httpReq(baseUrl, 'GET', '/api/health');
    assert.strictEqual(noOriginEaRes.status, 200);
    passed++;
    console.log('[PASS] 2. CORS allowlist blocks untrusted origins (403), attaches security headers, and permits non-browser MT5 requests.');

    // ------------------------------------------------------------------------
    // 3. Platform Settings (Demo-Only Immutable) & Audit Logs
    // ------------------------------------------------------------------------
    const traderSettingsAttempt = await httpReq(baseUrl, 'PUT', '/api/admin/platform-settings', {
      headers: { Authorization: 'Bearer jwt-trader1' },
      body: { defaultSlippageMaxPips: 5 },
    });
    assert.strictEqual(traderSettingsAttempt.status, 403);

    const demoDisableAttempt = await httpReq(baseUrl, 'PUT', '/api/admin/platform-settings', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: { demoOnlyEnforced: false, defaultSlippageMaxPips: 2 },
    });
    assert.strictEqual(demoDisableAttempt.status, 403);
    assert.strictEqual(demoDisableAttempt.json.code, 'DEMO_ONLY_LOCK_IMMUTABLE');

    const validSettingsUpdate = await httpReq(baseUrl, 'PUT', '/api/admin/platform-settings', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: { demoOnlyEnforced: true, defaultSlippageMaxPips: 4.5, defaultMaxLotCap: 25, heartbeatStaleSeconds: 75, maintenanceMode: false },
    });
    assert.strictEqual(validSettingsUpdate.status, 200);
    assert.strictEqual(validSettingsUpdate.json.settings.demoOnlyEnforced, true);
    assert.strictEqual(validSettingsUpdate.json.settings.defaultSlippageMaxPips, 4.5);

    const auditFetch = await httpReq(baseUrl, 'GET', '/api/admin/audit-logs', {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(auditFetch.status, 200);
    assert.strictEqual(auditFetch.json.logs.some((l: any) => l.action === 'PLATFORM_DEMO_LOCK_BYPASS_ATTEMPT'), true);
    assert.strictEqual(auditFetch.json.logs.some((l: any) => l.action === 'PLATFORM_SETTINGS_UPDATED'), true);
    passed++;
    console.log('[PASS] 3. Platform settings enforce immutable demo_only_enforced=true lock and persist audit logs.');

    // ------------------------------------------------------------------------
    // 4. Plan Follower Quota Enforcement (Join & Admin Assignment)
    // ------------------------------------------------------------------------
    const join1 = await httpReq(baseUrl, 'POST', '/api/v1/bridge/assignments/join', {
      headers: { Authorization: 'Bearer jwt-trader1' },
      body: { inviteCodeOrMentorId: `TS-${mentorId.slice(0, 8).toUpperCase()}`, childAccountId: child1AccId },
    });
    assert.strictEqual(join1.status, 200);

    const join2Exceed = await httpReq(baseUrl, 'POST', '/api/v1/bridge/assignments/join', {
      headers: { Authorization: 'Bearer jwt-trader2' },
      body: { inviteCodeOrMentorId: `TS-${mentorId.slice(0, 8).toUpperCase()}`, childAccountId: child2AccId },
    });
    assert.strictEqual(join2Exceed.status, 403);
    assert.strictEqual(join2Exceed.json.code, 'PLAN_FOLLOWER_QUOTA_EXCEEDED');

    const adminAssignExceed = await httpReq(baseUrl, 'POST', '/api/v1/admin/assignments', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: { mentorId, traderId: trader2Id, parentAccountId: parentAccId, childAccountId: child2AccId },
    });
    assert.strictEqual(adminAssignExceed.status, 403);
    assert.strictEqual(adminAssignExceed.json.code, 'PLAN_FOLLOWER_QUOTA_EXCEEDED');
    passed++;
    console.log('[PASS] 4. Subscription plan follower quota enforced on both self-service join and admin assignment (403 PLAN_FOLLOWER_QUOTA_EXCEEDED).');

    // ------------------------------------------------------------------------
    // 5. Mentor Strategy Profile & Follower Strategy Groups CRUD + RBAC
    // ------------------------------------------------------------------------
    const profileUpd = await httpReq(baseUrl, 'PUT', '/api/v1/bridge/mentor/profile', {
      headers: { Authorization: 'Bearer jwt-mentor' },
      body: { strategyName: 'London Breakout Demo', description: 'Low drawdown breakout', monthlyFee: 120, maxFollowers: 25 },
    });
    assert.strictEqual(profileUpd.status, 200);
    assert.strictEqual(profileUpd.json.mentorProfile.strategyName, 'London Breakout Demo');

    const createGrp = await httpReq(baseUrl, 'POST', '/api/v1/bridge/mentor/groups', {
      headers: { Authorization: 'Bearer jwt-mentor' },
      body: { name: 'Conservative 0.5x', description: 'Half-size follower cohort' },
    });
    assert.strictEqual(createGrp.status, 201);
    const groupId = createGrp.json.group.id;

    const assignmentId = state.mentor_assignments[0].id;
    const traderForbiddenAssignGrp = await httpReq(baseUrl, 'POST', `/api/v1/bridge/mentor/groups/${groupId}/assign`, {
      headers: { Authorization: 'Bearer jwt-trader1' },
      body: { assignmentId },
    });
    assert.strictEqual(traderForbiddenAssignGrp.status, 403);

    const mentorAssignGrp = await httpReq(baseUrl, 'POST', `/api/v1/bridge/mentor/groups/${groupId}/assign`, {
      headers: { Authorization: 'Bearer jwt-mentor' },
      body: { assignmentId },
    });
    assert.strictEqual(mentorAssignGrp.status, 200);
    assert.strictEqual(state.mentor_assignments[0].group_id, groupId);

    const delGrp = await httpReq(baseUrl, 'DELETE', `/api/v1/bridge/mentor/groups/${groupId}`, {
      headers: { Authorization: 'Bearer jwt-mentor' },
    });
    assert.strictEqual(delGrp.status, 200);
    assert.strictEqual(state.mentor_assignments[0].group_id, null);
    passed++;
    console.log('[PASS] 5. Mentor strategy profile & follower groups CRUD, assignment group_id sync, and tenant RBAC verified.');

    // ------------------------------------------------------------------------
    // 6. Notifications Broadcast & Tenant Isolation
    // ------------------------------------------------------------------------
    const nonAdminBroadcast = await httpReq(baseUrl, 'POST', '/api/admin/notifications', {
      headers: { Authorization: 'Bearer jwt-mentor' },
      body: { targetRole: 'all', title: 'Spoof', message: 'Unauthorized' },
    });
    assert.strictEqual(nonAdminBroadcast.status, 403);

    const adminBroadcast = await httpReq(baseUrl, 'POST', '/api/admin/notifications', {
      headers: { Authorization: 'Bearer jwt-admin' },
      body: { targetRole: 'mentor', title: 'Maintenance Window', message: 'Bridge restart Sunday 00:00 UTC' },
    });
    assert.strictEqual(adminBroadcast.status, 201);
    const broadcastId = adminBroadcast.json.notification.id;

    const mentorNotifs = await httpReq(baseUrl, 'GET', '/api/v1/notifications', {
      headers: { Authorization: 'Bearer jwt-mentor' },
    });
    const traderNotifs = await httpReq(baseUrl, 'GET', '/api/v1/notifications', {
      headers: { Authorization: 'Bearer jwt-trader1' },
    });
    assert.strictEqual(mentorNotifs.json.notifications.some((n: any) => n.id === broadcastId), true);
    assert.strictEqual(traderNotifs.json.notifications.some((n: any) => n.id === broadcastId), false);

    // Mentor marking broadcast read does not flip shared server row for everyone
    const ackRes = await httpReq(baseUrl, 'POST', `/api/v1/notifications/${broadcastId}/read`, {
      headers: { Authorization: 'Bearer jwt-mentor' },
    });
    assert.strictEqual(ackRes.status, 200);
    assert.strictEqual(ackRes.json.persisted, false);
    passed++;
    console.log('[PASS] 6. Notifications role scoping and broadcast read isolation verified.');

    // ------------------------------------------------------------------------
    // 7. Honest 501 Checkout + Stripe/PayPal HMAC Webhooks + Idempotency + Rate Limit
    // ------------------------------------------------------------------------
    const checkoutMissingKeys = await httpReq(baseUrl, 'POST', '/api/v1/billing/checkout', {
      headers: { Authorization: 'Bearer jwt-mentor' },
      body: { planId: proPlanId, billingCycle: 'monthly', provider: 'stripe' },
    });
    assert.strictEqual(checkoutMissingKeys.status, 501);
    assert.strictEqual(checkoutMissingKeys.json.code, 'PAYMENT_PROVIDER_UNCONFIGURED');

    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_stripe_day2';
    process.env.PAYPAL_WEBHOOK_ID = 'WH-TEST-PAYPAL-DAY2';

    const stripeEventBody = JSON.stringify({
      id: 'evt_stripe_test_001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_001',
          payment_intent: 'pi_test_001',
          amount_total: 14900,
          currency: 'usd',
          metadata: { user_id: mentorId, plan_id: proPlanId, billing_cycle: 'monthly' },
        },
      },
    });

    const badStripeSig = await httpReq(baseUrl, 'POST', '/api/v1/billing/webhooks/stripe', {
      headers: { 'Stripe-Signature': 't=1700000000,v1=deadbeef' },
      rawBody: stripeEventBody,
    });
    assert.strictEqual(badStripeSig.status, 401);
    assert.strictEqual(badStripeSig.json.code, 'INVALID_WEBHOOK_SIGNATURE');

    const tsNow = Math.floor(Date.now() / 1000);
    const validStripeDigest = crypto
      .createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
      .update(`${tsNow}.${stripeEventBody}`, 'utf8')
      .digest('hex');

    const goodStripeWebhook = await httpReq(baseUrl, 'POST', '/api/v1/billing/webhooks/stripe', {
      headers: { 'Stripe-Signature': `t=${tsNow},v1=${validStripeDigest}` },
      rawBody: stripeEventBody,
    });
    assert.strictEqual(goodStripeWebhook.status, 200);
    assert.strictEqual(goodStripeWebhook.json.duplicate, false);

    // Replay same webhook event_id -> idempotent duplicate=true without double insertion
    const countPaymentsBeforeReplay = state.payments.length;
    const countInvoicesBeforeReplay = state.invoices.length;
    const replayStripeWebhook = await httpReq(baseUrl, 'POST', '/api/v1/billing/webhooks/stripe', {
      headers: { 'Stripe-Signature': `t=${tsNow},v1=${validStripeDigest}` },
      rawBody: stripeEventBody,
    });
    assert.strictEqual(replayStripeWebhook.status, 200);
    assert.strictEqual(replayStripeWebhook.json.duplicate, true);
    assert.strictEqual(state.payments.length, countPaymentsBeforeReplay);
    assert.strictEqual(state.invoices.length, countInvoicesBeforeReplay);

    // 4th webhook request hits sliding-window rate limiter (override limit=3) -> 429
    const rateLimitedWebhook = await httpReq(baseUrl, 'POST', '/api/v1/billing/webhooks/paypal', {
      headers: { 'PayPal-Transmission-Sig': 'bad-sig' },
      body: { id: 'evt_pp_1', event_type: 'PAYMENT.CAPTURE.COMPLETED' },
    });
    assert.strictEqual(rateLimitedWebhook.status, 429);
    assert.strictEqual(rateLimitedWebhook.json.code, 'RATE_LIMIT_EXCEEDED');
    passed++;
    console.log('[PASS] 7. Honest 501 checkout, Stripe HMAC verification, replay idempotency, and 429 webhook rate limit verified.');

    // ------------------------------------------------------------------------
    // 8. User Archival Preserves Financial History & Audits Action
    // ------------------------------------------------------------------------
    const selfArchive = await httpReq(baseUrl, 'POST', `/api/admin/users/${adminId}/archive`, {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(selfArchive.status, 400);

    const archiveMentor = await httpReq(baseUrl, 'POST', `/api/admin/users/${mentorId}/archive`, {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(archiveMentor.status, 200);
    assert.strictEqual(archiveMentor.json.success, true);

    const mentorProfAfter = state.profiles.find((p) => p.id === mentorId);
    assert.strictEqual(mentorProfAfter?.status, 'suspended');
    assert.strictEqual(Boolean(mentorProfAfter?.archived_at), true);
    assert.strictEqual(state.mentor_assignments.every((a) => a.status === 'inactive'), true);
    assert.strictEqual(state.mt5_accounts.find((a) => a.id === parentAccId)?.connection_status, 'disconnected');
    assert.strictEqual(state.subscriptions.every((s) => s.archived_user_id === mentorId && s.archived_user_email === 'mentor@tradesync.io'), true);
    assert.strictEqual(state.payments.every((p) => p.archived_user_id === mentorId), true);
    assert.strictEqual(state.invoices.every((i) => i.archived_user_id === mentorId), true);
    passed++;
    console.log('[PASS] 8. User archival suspends user, pauses assignments, disconnects MT5, and preserves subscriptions/payments/invoices.');

    // ------------------------------------------------------------------------
    // 9. CSV Export Sanitization & Static UI/EA Safeguard Verification
    // ------------------------------------------------------------------------
    const csv = buildCsvContent(
      ['User', 'Note', 'Amount'],
      [
        ['=CMD|test', 'quoted "value", ok', -42.5],
        ['+HYPERLINK()', 'safe', 100],
      ]
    );
    assert.strictEqual(csv.includes("'=CMD|test"), true);
    assert.strictEqual(csv.includes("'+HYPERLINK()"), true);
    assert.strictEqual(csv.includes(',-42.5'), true);
    assert.strictEqual(csv.includes('"quoted ""value"", ok"'), true);

    const broadcasterMq5 = fs.readFileSync(path.resolve(process.cwd(), 'public/mql5/TradeSync_Broadcaster.mq5'), 'utf8');
    const receiverMq5 = fs.readFileSync(path.resolve(process.cwd(), 'public/mql5/TradeSync_Receiver.mq5'), 'utf8');
    assert.strictEqual(broadcasterMq5.includes('ACCOUNT_TRADE_MODE_DEMO'), true);
    assert.strictEqual(receiverMq5.includes('ACCOUNT_TRADE_MODE_DEMO'), true);

    passed++;
    console.log('[PASS] 9. CSV formula injection escaping & MQL5 ACCOUNT_TRADE_MODE_DEMO guards verified.');

    console.log(`\nALL DAY 2 SAAS COMPLETION TESTS PASSED (${passed}/${passed} checks passed).`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('DAY 2 TEST FAILURE:', err);
  process.exit(1);
});
