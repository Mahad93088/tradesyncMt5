import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApiApp } from '../src/server/apiApp.js';
import { BridgeStore } from '../src/server/bridgeStore.js';
import { RiskEngine } from '../src/server/riskEngine.js';
import {
  checkMentorFollowerQuota,
  resolvePlanFollowerLimit,
} from '../src/server/billingService.js';

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
  audit_logs: Record<string, any>[];
  mentor_trader_invitations: Record<string, any>[];
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function createComprehensiveMockSupabase(
  state: DbState,
  options: { failTable?: keyof DbState | null; useClaimRpc?: boolean } = {}
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
        if (f.op === 'gt') return row[f.col!] > f.val;
        if (f.op === 'lt') return row[f.col!] < f.val;
        if (f.op === 'lte') return row[f.col!] <= f.val;
        if (f.op === 'is') return f.val === null ? row[f.col!] == null : row[f.col!] === f.val;
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
    auth: {
      admin: {
        createUser: async ({ email }: { email: string }) => {
          const existing = state.profiles.find((p) => String(p.email).toLowerCase() === String(email).toLowerCase());
          if (existing) {
            return { data: null, error: { message: 'User already registered' } };
          }
          const newId = crypto.randomUUID();
          return { data: { user: { id: newId, email } }, error: null };
        },
      },
    },
    rpc: async (fnName: string, args: Record<string, any>) => {
      if (fnName === 'claim_pending_instructions' && options.useClaimRpc) {
        const childId = args.p_child_account_id;
        const limit = Number(args.p_limit || 20);
        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();
        const leaseUntilIso = new Date(nowMs + Number(args.p_lease_seconds || 30) * 1000).toISOString();

        const claimed: any[] = [];
        for (const inst of state.bridge_instructions) {
          if (claimed.length >= limit) break;
          if (inst.child_account_id !== childId) continue;
          const isClaimable =
            inst.status === 'QUEUED' ||
            (inst.status === 'SENT' && (!inst.lease_until || Date.parse(inst.lease_until) < nowMs));
          if (!isClaimable) continue;

          if (inst.action === 'OPEN') {
            const assign = state.mentor_assignments.find(
              (a) =>
                a.child_account_id === childId &&
                a.parent_account_id === inst.parent_account_id &&
                a.status === 'active' &&
                !a.balance_pause_active
            );
            const preActivation =
              !assign ||
              (assign.activation_epoch && inst.activation_epoch && Number(inst.activation_epoch) < Number(assign.activation_epoch)) ||
              (assign.activated_at &&
                inst.parent_event_timestamp &&
                Date.parse(inst.parent_event_timestamp) < Date.parse(assign.activated_at));
            if (preActivation) {
              inst.status = 'FAILED';
              continue;
            }
          }

          inst.status = 'SENT';
          inst.claimed_at = nowIso;
          inst.lease_until = leaseUntilIso;
          inst.attempt_count = (Number(inst.attempt_count) || 0) + 1;
          claimed.push({ ...inst });
        }
        return { data: claimed, error: null };
      }
      return { data: null, error: { message: `RPC ${fnName} not enabled in mock` } };
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
        if (options.failTable && tableName === options.failTable) {
          return { data: null, error: { message: `Simulated DB outage on ${String(tableName)}` } };
        }
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
          const conflictCols = upsertOnConflict ? upsertOnConflict.split(',').map((s) => s.trim()) : ['id'];
          const out: any[] = [];
          for (const item of items) {
            const existing = table.find((r) => conflictCols.every((c) => r[c] === item[c]));
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
        if (limitNum !== null) matched = matched.slice(0, limitNum);
        return { data: matched.map((r) => ({ ...r })), error: null };
      };

      const builder: any = {
        select() {
          if (!['insert', 'update', 'upsert', 'delete'].includes(mode)) mode = 'select';
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
        gt(col: string, val: any) {
          filters.push({ op: 'gt', col, val });
          return builder;
        },
        lt(col: string, val: any) {
          filters.push({ op: 'lt', col, val });
          return builder;
        },
        lte(col: string, val: any) {
          filters.push({ op: 'lte', col, val });
          return builder;
        },
        is(col: string, val: any) {
          filters.push({ op: 'is', col, val });
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
  };
}

async function runTests() {
  console.log('=== TradeSync MT5 Consolidated Client Backend Requirements Tests ===');

  const adminId = '10000000-0000-4000-8000-000000000001';
  const mentorId = '20000000-0000-4000-8000-000000000001';
  const studentAId = '30000000-0000-4000-8000-000000000001';
  const studentBId = '30000000-0000-4000-8000-000000000002';
  const studentCId = '30000000-0000-4000-8000-000000000003';

  const parentAccId = '40000000-0000-4000-8000-000000000001';
  const childA1AccId = '50000000-0000-4000-8000-000000000001';
  const childA2AccId = '50000000-0000-4000-8000-000000000002';
  const childBAccId = '50000000-0000-4000-8000-000000000003';
  const childCAccId = '50000000-0000-4000-8000-000000000004';

  const trialPlanId = '60000000-0000-4000-8000-000000000001';
  const silverPlanId = '60000000-0000-4000-8000-000000000002';
  const goldPlanId = '60000000-0000-4000-8000-000000000003';

  const parentToken = 'ts_parent_req_parent_token_001';
  const childA1Token = 'ts_child_req_childA1_token_001';
  const childA2Token = 'ts_child_req_childA2_token_002';
  const childBToken = 'ts_child_req_childB_token_003';

  const futureEnd = new Date(Date.now() + 30 * 86400_000).toISOString();
  const pastEnd = new Date(Date.now() - 86400_000).toISOString();

  const state: DbState = {
    profiles: [
      { id: adminId, email: 'admin@tradesync.test', full_name: 'Admin', role: 'admin', status: 'active' },
      { id: mentorId, email: 'mentor@tradesync.test', full_name: 'Mentor Alpha', role: 'mentor', status: 'active' },
      { id: studentAId, email: 'studenta@tradesync.test', full_name: 'Student A', role: 'trader', status: 'active' },
      { id: studentBId, email: 'studentb@tradesync.test', full_name: 'Student B', role: 'trader', status: 'active' },
      { id: studentCId, email: 'studentc@tradesync.test', full_name: 'Student C', role: 'trader', status: 'active' },
    ],
    mentor_profiles: [
      {
        user_id: mentorId,
        strategy_name: 'Alpha Desk',
        // Intentionally poisoned max_followers: billingService must NEVER trust this
        max_followers: 999,
        invite_code: `TS-${mentorId.slice(0, 8).toUpperCase()}`,
      },
    ],
    subscription_plans: [
      { id: trialPlanId, code: 'trial', name: 'Trial', max_followers: 2, max_child_accounts: 2, monthly_price_usd: 0, yearly_price_usd: 0, trial_days: 7, is_active: true },
      { id: silverPlanId, code: 'silver', name: 'Silver', max_followers: 50, max_child_accounts: 50, monthly_price_usd: 49, yearly_price_usd: 490, trial_days: 0, is_active: true },
      { id: goldPlanId, code: 'gold', name: 'Gold', max_followers: 100, max_child_accounts: 100, monthly_price_usd: 99, yearly_price_usd: 990, trial_days: 0, is_active: true },
    ],
    subscriptions: [
      {
        id: crypto.randomUUID(),
        mentor_id: mentorId,
        user_id: mentorId,
        plan_id: trialPlanId,
        status: 'trial',
        current_period_end: futureEnd,
        created_at: new Date().toISOString(),
      },
    ],
    mt5_accounts: [
      {
        id: parentAccId,
        user_id: mentorId,
        account_number: '900100',
        broker_server: 'Demo-MT5',
        broker_name: 'MetaQuotes',
        account_role: 'parent',
        account_type: 'demo',
        balance: 10000,
        equity: 10000,
        verified_balance: 10000,
        verified_equity: 10000,
        balance_verified_at: new Date().toISOString(),
        connection_status: 'connected',
        terminal_token_hash: hashToken(parentToken),
      },
      {
        id: childA1AccId,
        user_id: studentAId,
        account_number: '900201',
        broker_server: 'Demo-MT5',
        broker_name: 'MetaQuotes',
        account_role: 'child',
        account_type: 'demo',
        balance: 500,
        equity: 500,
        verified_balance: null,
        verified_equity: null,
        balance_verified_at: null,
        verified_symbol_specs: {},
        connection_status: 'disconnected',
        terminal_token_hash: hashToken(childA1Token),
      },
      {
        id: childA2AccId,
        user_id: studentAId,
        account_number: '900202',
        broker_server: 'Demo-MT5',
        broker_name: 'MetaQuotes',
        account_role: 'child',
        account_type: 'demo',
        balance: 500,
        equity: 500,
        verified_balance: 500,
        verified_equity: 500,
        balance_verified_at: new Date().toISOString(),
        verified_symbol_specs: { EURUSD: { minLot: 0.01, maxLot: 100, lotStep: 0.01 } },
        connection_status: 'connected',
        terminal_token_hash: hashToken(childA2Token),
      },
      {
        id: childBAccId,
        user_id: studentBId,
        account_number: '900203',
        broker_server: 'Demo-MT5',
        broker_name: 'MetaQuotes',
        account_role: 'child',
        account_type: 'demo',
        balance: 1000,
        equity: 1000,
        verified_balance: 1000,
        verified_equity: 1000,
        balance_verified_at: new Date().toISOString(),
        verified_symbol_specs: { EURUSD: { minLot: 0.01, maxLot: 100, lotStep: 0.01 } },
        connection_status: 'connected',
        terminal_token_hash: hashToken(childBToken),
      },
      {
        id: childCAccId,
        user_id: studentCId,
        account_number: '900204',
        broker_server: 'Demo-MT5',
        broker_name: 'MetaQuotes',
        account_role: 'child',
        account_type: 'demo',
        balance: 1000,
        equity: 1000,
        verified_balance: 1000,
        verified_equity: 1000,
        balance_verified_at: new Date().toISOString(),
        verified_symbol_specs: { EURUSD: { minLot: 0.01, maxLot: 100, lotStep: 0.01 } },
        connection_status: 'connected',
      },
    ],
    mentor_assignments: [],
    bridge_instructions: [],
    trade_mappings: [],
    bridge_sync_logs: [],
    trades: [],
    audit_logs: [],
    mentor_trader_invitations: [],
  };

  const mockDb = createComprehensiveMockSupabase(state);
  const app = createApiApp({
    serviceRoleClientOverride: mockDb as any,
    supabaseUrlOverride: 'https://example.supabase.co',
    serviceRoleKeyOverride: 'service-role-test-key',
    authUserResolverOverride: async (token: string) => {
      if (token === 'jwt-admin') return { user: { id: adminId, email: 'admin@tradesync.test' }, error: null };
      if (token === 'jwt-mentor') return { user: { id: mentorId, email: 'mentor@tradesync.test' }, error: null };
      if (token === 'jwt-studentA') return { user: { id: studentAId, email: 'studenta@tradesync.test' }, error: null };
      if (token === 'jwt-studentB') return { user: { id: studentBId, email: 'studentb@tradesync.test' }, error: null };
      if (token === 'jwt-studentC') return { user: { id: studentCId, email: 'studentc@tradesync.test' }, error: null };
      return { user: null, error: { message: 'Invalid JWT' } };
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // -----------------------------------------------------------------------
    // 1. Billing Plan Limits & DISTINCT trader_id Enforcement
    // -----------------------------------------------------------------------
    assert.strictEqual(resolvePlanFollowerLimit(state.subscription_plans[0]).limit, 2);
    assert.strictEqual(resolvePlanFollowerLimit(state.subscription_plans[1]).limit, 50);
    assert.strictEqual(resolvePlanFollowerLimit(state.subscription_plans[2]).limit, 100);

    // Fail closed on DB failure
    const failDb = createComprehensiveMockSupabase(state, { failTable: 'subscriptions' });
    const failQuota = await checkMentorFollowerQuota(failDb as any, mentorId, childA1AccId, studentAId);
    assert.strictEqual(failQuota.allowed, false);
    assert.strictEqual(failQuota.code, 'QUOTA_VALIDATION_FAILED');

    // Admin creates a new Silver mentor -> gets authoritative max_followers = 50 (never 25 or object)
    const createMentorRes = await fetch(`${baseUrl}/api/admin/users/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        email: 'silvermentor@tradesync.test',
        password: 'StrongPassword!123',
        fullName: 'Silver Mentor',
        role: 'mentor',
        planId: silverPlanId,
        maxFollowers: 9999,
      }),
    });
    assert.strictEqual(createMentorRes.status, 201);
    const createdMentorJson: any = await createMentorRes.json();
    const createdMentorRow = state.mentor_profiles.find((mp) => mp.user_id === createdMentorJson.profile.id);
    assert.strictEqual(createdMentorRow?.max_followers, 50);

    // Mentor profile update ignores client maxFollowers=999 and returns authoritative plan limit (2 on Trial)
    const updProfileRes = await fetch(`${baseUrl}/api/v1/bridge/mentor/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-mentor' },
      body: JSON.stringify({ strategyName: 'Alpha Desk v2', maxFollowers: 999 }),
    });
    assert.strictEqual(updProfileRes.status, 200);
    const updProfileJson: any = await updProfileRes.json();
    assert.strictEqual(updProfileJson.mentorProfile.maxFollowers, 2);

    // Student A joins with TWO child accounts -> consumes ONLY 1/2 Trial slots!
    const joinA1Res = await fetch(`${baseUrl}/api/v1/bridge/assignments/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-studentA' },
      body: JSON.stringify({
        inviteCodeOrMentorId: mentorId,
        childAccountId: childA1AccId,
        lotSettings: { copyMode: 'multiplier', multiplier: 0.5 },
      }),
    });
    assert.strictEqual(joinA1Res.status, 200);
    const joinA1Json: any = await joinA1Res.json();
    const assignA1Id = joinA1Json.assignment.id;
    // Also check Requirement #5: copyPendingOrders defaults to false
    assert.strictEqual(joinA1Json.assignment.copy_pending_orders, false);

    const joinA2Res = await fetch(`${baseUrl}/api/v1/bridge/assignments/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-studentA' },
      body: JSON.stringify({
        inviteCodeOrMentorId: mentorId,
        childAccountId: childA2AccId,
        lotSettings: { copyMode: 'parent_lot' },
      }),
    });
    assert.strictEqual(joinA2Res.status, 200);
    const joinA2Json: any = await joinA2Res.json();
    const assignA2Id = joinA2Json.assignment.id;

    // Student B joins -> fills 2/2 distinct student traders
    const joinBRes = await fetch(`${baseUrl}/api/v1/bridge/assignments/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-studentB' },
      body: JSON.stringify({
        inviteCodeOrMentorId: mentorId,
        childAccountId: childBAccId,
        lotSettings: { copyMode: 'parent_lot' },
      }),
    });
    assert.strictEqual(joinBRes.status, 200);
    const joinBJson: any = await joinBRes.json();

    // Student C MUST be blocked with 403 PLAN_FOLLOWER_QUOTA_EXCEEDED
    const joinCRes = await fetch(`${baseUrl}/api/v1/bridge/assignments/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-studentC' },
      body: JSON.stringify({
        inviteCodeOrMentorId: mentorId,
        childAccountId: childCAccId,
        lotSettings: { copyMode: 'parent_lot' },
      }),
    });
    assert.strictEqual(joinCRes.status, 403);
    const joinCJson: any = await joinCRes.json();
    assert.strictEqual(joinCJson.code, 'PLAN_FOLLOWER_QUOTA_EXCEEDED');

    // Expired subscription period -> fail closed even if only 0 active students
    state.subscriptions[0].current_period_end = pastEnd;
    const expiredQuota = await checkMentorFollowerQuota(mockDb as any, mentorId, childCAccId, studentCId);
    assert.strictEqual(expiredQuota.allowed, false);
    assert.strictEqual(expiredQuota.code, 'NO_ACTIVE_SUBSCRIPTION');
    state.subscriptions[0].current_period_end = futureEnd;

    console.log('[PASS] 1. Trial=2/Silver=50/Gold=100, DISTINCT trader_id quota, expiry & fail-closed DB checks verified.');

    // Deactivate A2 so tests below cleanly focus on Child A1 + Child B
    await fetch(`${baseUrl}/api/v1/bridge/assignments/${assignA2Id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-studentA' },
      body: JSON.stringify({ status: 'inactive' }),
    });

    // -----------------------------------------------------------------------
    // 2. Verified Telemetry Validation & Fail-Closed Missing/Stale Checks
    // -----------------------------------------------------------------------
    // Negative balance rejected 400
    const badBalHb = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childA1Token },
      body: JSON.stringify({ tradeMode: 'demo', balance: -10, equity: 100 }),
    });
    assert.strictEqual(badBalHb.status, 400);

    // Invalid symbolSpecs rejected 400
    const badSpecsHb = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childA1Token },
      body: JSON.stringify({
        tradeMode: 'demo',
        balance: 500,
        equity: 500,
        symbolSpecs: { EURUSD: { minLot: 0, maxLot: 100, lotStep: 0.01 } },
      }),
    });
    assert.strictEqual(badSpecsHb.status, 400);

    // Live tradeMode blocked 403
    const liveHb = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childA1Token },
      body: JSON.stringify({ tradeMode: 'live', balance: 500, equity: 500 }),
    });
    assert.strictEqual(liveHb.status, 403);

    // Child A1 still has verified_balance = null -> trade-open MUST skip A1 (fail closed), only B copies!
    const openMissingTelRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
      body: JSON.stringify({
        ticket: '700100',
        symbol: 'EURUSD',
        type: 'BUY',
        lots: 1.0,
        openPrice: 1.1,
        eventTimestamp: new Date(Date.now() + 2000).toISOString(),
      }),
    });
    assert.strictEqual(openMissingTelRes.status, 200);
    const openMissingTelJson: any = await openMissingTelRes.json();
    assert.strictEqual(openMissingTelJson.childInstructionsQueued, 1);
    assert.strictEqual(openMissingTelJson.instructions[0].childAccountId, childBAccId);
    assert.ok(state.bridge_sync_logs.some((l) => l.event_type === 'UNVERIFIED_OR_STALE_TELEMETRY'));

    // Also verify stale (>90s) balance_verified_at fails closed
    const childA1Row = state.mt5_accounts.find((a) => a.id === childA1AccId)!;
    childA1Row.verified_balance = 500;
    childA1Row.verified_equity = 500;
    childA1Row.balance_verified_at = new Date(Date.now() - 120_000).toISOString();

    const openStaleRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
      body: JSON.stringify({
        ticket: '700101',
        symbol: 'EURUSD',
        type: 'BUY',
        lots: 1.0,
        openPrice: 1.1,
        eventTimestamp: new Date(Date.now() + 2500).toISOString(),
      }),
    });
    assert.strictEqual(openStaleRes.status, 200);
    const openStaleJson: any = await openStaleRes.json();
    assert.strictEqual(openStaleJson.childInstructionsQueued, 1);
    assert.strictEqual(openStaleJson.instructions[0].childAccountId, childBAccId);

    // Valid authenticated EA heartbeat sets fresh verified_balance + verified_symbol_specs on Child A1
    const goodHbRes = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childA1Token },
      body: JSON.stringify({
        tradeMode: 'demo',
        balance: 500,
        equity: 500,
        symbolSpecs: { EURUSD: { minLot: 0.01, maxLot: 100, lotStep: 0.01 } },
      }),
    });
    assert.strictEqual(goodHbRes.status, 200);
    assert.strictEqual(childA1Row.verified_balance, 500);
    assert.ok(childA1Row.balance_verified_at);
    assert.strictEqual(childA1Row.verified_symbol_specs.EURUSD.lotStep, 0.01);

    console.log('[PASS] 2. Heartbeat telemetry validation, demo-only block, and missing/stale fail-closed checks verified.');

    // -----------------------------------------------------------------------
    // 3. Pending Orders Default false
    // -----------------------------------------------------------------------
    assert.strictEqual(RiskEngine.normalizeLotSettingsFromRow({}).copyPendingOrders, false);
    const pendingOrderRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
      body: JSON.stringify({
        ticket: '700102',
        symbol: 'EURUSD',
        type: 'BUY_LIMIT',
        lots: 1.0,
        openPrice: 1.09,
        eventTimestamp: new Date(Date.now() + 3000).toISOString(),
      }),
    });
    assert.strictEqual(pendingOrderRes.status, 200);
    const pendingOrderJson: any = await pendingOrderRes.json();
    assert.strictEqual(pendingOrderJson.childInstructionsQueued, 0);
    console.log('[PASS] 3. copyPendingOrders defaults to false and BUY_LIMIT is skipped.');

    // -----------------------------------------------------------------------
    // 4. $50 / $100 Balance Hysteresis + Queued OPEN Cancel (CLOSE/OPEN trades safe)
    // -----------------------------------------------------------------------
    // Open trade #700200 cleanly on both A1 (0.50 lots) and B (1.00 lot)
    const openForBothRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
      body: JSON.stringify({
        ticket: '700200',
        symbol: 'EURUSD',
        type: 'BUY',
        lots: 1.0,
        openPrice: 1.1,
        eventTimestamp: new Date(Date.now() + 3500).toISOString(),
      }),
    });
    assert.strictEqual(openForBothRes.status, 200);
    const openForBothJson: any = await openForBothRes.json();
    assert.strictEqual(openForBothJson.childInstructionsQueued, 2);

    const instOpenA1 = openForBothJson.instructions.find((i: any) => i.childAccountId === childA1AccId);
    assert.strictEqual(instOpenA1.lots, 0.5);

    // Acknowledge A1 OPEN instruction -> creates EXECUTED mapping & OPEN child trade #770001
    const ackOpenA1Res = await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childA1Token },
      body: JSON.stringify({
        instructionId: instOpenA1.instructionId,
        status: 'EXECUTED',
        childTicket: '770001',
        fillPrice: 1.1002,
        executedLots: 0.5,
      }),
    });
    assert.strictEqual(ackOpenA1Res.status, 200);

    // Queue another OPEN (#700201) for A1 (still QUEUED, not polled yet) AND a queued CLOSE on A1's mapping
    const openQueuedA1Res = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
      body: JSON.stringify({
        ticket: '700201',
        symbol: 'EURUSD',
        type: 'SELL',
        lots: 1.0,
        openPrice: 1.1,
        eventTimestamp: new Date(Date.now() + 4000).toISOString(),
      }),
    });
    assert.strictEqual(openQueuedA1Res.status, 200);
    const queuedOpenId = (await openQueuedA1Res.json()).instructions.find(
      (i: any) => i.childAccountId === childA1AccId
    ).instructionId;

    // Now drop A1 balance to $45 (< $50) via heartbeat!
    const lowBalHbRes = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childA1Token },
      body: JSON.stringify({ tradeMode: 'demo', balance: 45, equity: 45 }),
    });
    assert.strictEqual(lowBalHbRes.status, 200);

    const assignA1Row = state.mentor_assignments.find((a) => a.id === assignA1Id)!;
    assert.strictEqual(assignA1Row.balance_pause_active, true);
    assert.strictEqual(assignA1Row.pause_reason, 'LOW_BALANCE_UNDER_50');

    // Queued OPEN #700201 MUST be cancelled (FAILED) while Child A1's open trade #770001 stays OPEN & no CLOSE generated!
    const cancelledOpenInst = state.bridge_instructions.find((i) => i.id === queuedOpenId)!;
    assert.strictEqual(cancelledOpenInst.status, 'FAILED');
    const openChildTradeA1 = state.trades.find((t) => t.account_id === childA1AccId && t.ticket === '770001')!;
    assert.strictEqual(openChildTradeA1.status, 'OPEN');
    assert.strictEqual(
      state.bridge_instructions.filter((i) => i.child_account_id === childA1AccId && i.action === 'CLOSE').length,
      0
    );

    // Heartbeat at $75 (>= $50, < $100) MUST remain paused!
    await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childA1Token },
      body: JSON.stringify({ tradeMode: 'demo', balance: 75, equity: 75 }),
    });
    assert.strictEqual(assignA1Row.balance_pause_active, true);

    const blockedWhile75 = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
      body: JSON.stringify({
        ticket: '700202',
        symbol: 'EURUSD',
        type: 'BUY',
        lots: 1.0,
        openPrice: 1.1,
        eventTimestamp: new Date(Date.now() + 4500).toISOString(),
      }),
    });
    const blocked75Json: any = await blockedWhile75.json();
    assert.strictEqual(
      blocked75Json.instructions.some((i: any) => i.childAccountId === childA1AccId),
      false
    );

    // Heartbeat at $105 (>= $100) MUST auto-resume because status === 'active' & not suspended
    const prevEpoch = Number(assignA1Row.activation_epoch || 1);
    await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childA1Token },
      body: JSON.stringify({ tradeMode: 'demo', balance: 105, equity: 105 }),
    });
    assert.strictEqual(assignA1Row.balance_pause_active, false);
    assert.strictEqual(Number(assignA1Row.activation_epoch), prevEpoch + 1);

    console.log('[PASS] 4. $50/$100 balance hysteresis, queued OPEN cancel, and open-position preservation verified.');

    // -----------------------------------------------------------------------
    // 5. Manual Suspension Independence + Student Unsuspend Block + Activation Isolation
    // -----------------------------------------------------------------------
    // Student trying to suspend receives 403
    const studentSuspendAttempt = await fetch(`${baseUrl}/api/v1/bridge/assignments/${assignA1Id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-studentA' },
      body: JSON.stringify({ status: 'suspended' }),
    });
    assert.strictEqual(studentSuspendAttempt.status, 403);

    // Mentor suspends Student A's assignment
    const mentorSuspendRes = await fetch(`${baseUrl}/api/v1/bridge/assignments/${assignA1Id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-mentor' },
      body: JSON.stringify({ status: 'suspended', reason: 'Manual review' }),
    });
    assert.strictEqual(mentorSuspendRes.status, 200);
    assert.strictEqual(assignA1Row.status, 'suspended');

    // Child A1 sends $250 (>= $100) heartbeat -> MUST NOT override mentor suspension!
    await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childA1Token },
      body: JSON.stringify({ tradeMode: 'demo', balance: 250, equity: 250 }),
    });
    assert.strictEqual(assignA1Row.status, 'suspended');

    // Student A trying to unsuspend receives 403 FORBIDDEN_UNSUSPEND_BY_STUDENT
    const studentUnsuspendAttempt = await fetch(`${baseUrl}/api/v1/bridge/assignments/${assignA1Id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-studentA' },
      body: JSON.stringify({ status: 'active' }),
    });
    assert.strictEqual(studentUnsuspendAttempt.status, 403);
    assert.strictEqual((await studentUnsuspendAttempt.json()).code, 'FORBIDDEN_UNSUSPEND_BY_STUDENT');

    // Mentor reactivates Student A -> advances activated_at + epoch; Student B remains unaffected
    const reactivateA1Res = await fetch(`${baseUrl}/api/v1/bridge/assignments/${assignA1Id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-mentor' },
      body: JSON.stringify({ status: 'active' }),
    });
    assert.strictEqual(reactivateA1Res.status, 200);
    const a1ActivatedMs = Date.parse(assignA1Row.activated_at);
    const assignBRow = state.mentor_assignments.find((a) => a.child_account_id === childBAccId)!;
    assignBRow.activated_at = new Date(a1ActivatedMs - 120_000).toISOString();

    // Trade with eventTimestamp BEFORE Student A's reactivation is skipped for A1 ONLY, while Student B copies!
    const oldTsRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
      body: JSON.stringify({
        ticket: '700203',
        symbol: 'EURUSD',
        type: 'BUY',
        lots: 1.0,
        openPrice: 1.1,
        eventTimestamp: new Date(a1ActivatedMs - 60_000).toISOString(),
      }),
    });
    const oldTsJson: any = await oldTsRes.json();
    assert.strictEqual(oldTsJson.instructions.some((i: any) => i.childAccountId === childA1AccId), false);
    assert.strictEqual(oldTsJson.instructions.some((i: any) => i.childAccountId === childBAccId), true);

    console.log('[PASS] 5. Manual suspension isolation, 403 student unsuspend block, and per-student activation boundaries verified.');

    // -----------------------------------------------------------------------
    // 6. Proportional Partial Close + Sub-MinLot Rejection + Subsequent Full Close
    // -----------------------------------------------------------------------
    // Trade #700200 had parentLots=1.0, child A1 open=0.50 (childTicket='770001').
    // Parent partial-closes 0.25 lots (remaining 0.75, 25%) -> Child A1 expects 0.50 * 0.25 = 0.125 -> floor(0.01) = 0.12
    const partialRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
      body: JSON.stringify({
        ticket: '700200',
        closeType: 'PARTIAL',
        closedLots: 0.25,
        remainingLots: 0.75,
        dealTicket: 'deal_901',
      }),
    });
    assert.strictEqual(partialRes.status, 200);
    const partialJson: any = await partialRes.json();
    assert.strictEqual(partialJson.closeType, 'PARTIAL');
    const a1PartialInst = partialJson.instructions.find((i: any) => i.childAccountId === childA1AccId);
    assert.strictEqual(a1PartialInst.lots, 0.12);
    assert.strictEqual(a1PartialInst.childRemainingAfterLots, 0.38);

    // Parent trade stays OPEN with remaining volume 0.75
    const parentTradeRow = state.trades.find((t) => t.account_id === parentAccId && t.ticket === '700200')!;
    assert.strictEqual(parentTradeRow.status, 'OPEN');
    assert.strictEqual(parentTradeRow.volume, 0.75);

    // Acknowledge partial close on Child A1 -> keeps trade_mappings EXECUTED & child trade OPEN at 0.38 lots
    const ackPartialRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childA1Token },
      body: JSON.stringify({
        instructionId: a1PartialInst.instructionId,
        status: 'EXECUTED',
        childTicket: '770001',
        executedLots: 0.12,
        realizedProfit: 18.5,
      }),
    });
    assert.strictEqual(ackPartialRes.status, 200);

    const a1Mapping = state.trade_mappings.find(
      (m) => m.parent_trade_ticket === '700200' && m.child_account_id === childA1AccId
    )!;
    assert.strictEqual(a1Mapping.status, 'EXECUTED');
    assert.strictEqual(a1Mapping.child_remaining_lots, 0.38);
    assert.strictEqual(a1Mapping.partial_close_count, 1);
    assert.strictEqual(openChildTradeA1.status, 'OPEN');
    assert.strictEqual(openChildTradeA1.volume, 0.38);

    // Tiny partial close below minLot (0.01 / 0.75 -> child 0.005 < 0.01) MUST reject cleanly without rounding up
    const tinyPartialRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
      body: JSON.stringify({
        ticket: '700200',
        closeType: 'PARTIAL',
        closedLots: 0.01,
        remainingLots: 0.74,
        dealTicket: 'deal_902',
      }),
    });
    assert.strictEqual(tinyPartialRes.status, 200);
    const tinyPartialJson: any = await tinyPartialRes.json();
    assert.strictEqual(
      tinyPartialJson.rejectedChildren.some((r: any) => r.childAccountId === childA1AccId),
      true
    );

    // Final FULL close -> queues exact remaining 0.38 lots on Child A1 & closes everything on ACK
    const fullCloseRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
      body: JSON.stringify({
        ticket: '700200',
        closeType: 'FULL',
        closedLots: 0.75,
        remainingLots: 0,
        closePrice: 1.105,
        realizedProfit: 120,
      }),
    });
    const fullCloseJson: any = await fullCloseRes.json();
    const a1FullCloseInst = fullCloseJson.instructions.find((i: any) => i.childAccountId === childA1AccId);
    assert.strictEqual(a1FullCloseInst.lots, 0.38);

    await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childA1Token },
      body: JSON.stringify({
        instructionId: a1FullCloseInst.instructionId,
        status: 'EXECUTED',
        childTicket: '770001',
        closePrice: 1.105,
        realizedProfit: 65,
      }),
    });
    assert.strictEqual(a1Mapping.status, 'CLOSED');
    assert.strictEqual(openChildTradeA1.status, 'CLOSED');

    console.log('[PASS] 6. Proportional partial close, sub-minLot rejection, and final full-close remainder verified.');

    // -----------------------------------------------------------------------
    // 7. Emergency Close Disabled (403 EMERGENCY_CLOSE_DISABLED)
    // -----------------------------------------------------------------------
    const instrBeforeEmergency = state.bridge_instructions.length;
    const emergRes = await fetch(`${baseUrl}/api/v1/bridge/mentor/emergency-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-mentor' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(emergRes.status, 403);
    assert.strictEqual((await emergRes.json()).code, 'EMERGENCY_CLOSE_DISABLED');
    assert.strictEqual(state.bridge_instructions.length, instrBeforeEmergency);
    console.log('[PASS] 7. ALLOW_MENTOR_EMERGENCY_CLOSE = false enforced (403, 0 instructions).');

    // -----------------------------------------------------------------------
    // 8. Concurrent Poll Single-Delivery & Pre-Activation Filter
    // -----------------------------------------------------------------------
    const claimDb = createComprehensiveMockSupabase(state, { useClaimRpc: true });
    const store = BridgeStore.getInstance();
    const raceInstId = `inst_race_${Date.now()}`;
    state.bridge_instructions.push({
      id: raceInstId,
      idempotency_key: `700999_${childBAccId}_OPEN`,
      action: 'OPEN',
      child_account_id: childBAccId,
      parent_account_id: parentAccId,
      parent_ticket: '700999',
      symbol: 'EURUSD',
      order_type: 'BUY',
      lots: 0.1,
      status: 'QUEUED',
      retry_count: 0,
      activation_epoch: 1,
      parent_event_timestamp: new Date(Date.now() + 10_000).toISOString(),
      created_at: new Date().toISOString(),
    });
    // Also inject a stale pre-activation QUEUED OPEN for Child A1 that must be auto-cancelled during poll
    const staleEpochInstId = `inst_stale_epoch_${Date.now()}`;
    state.bridge_instructions.push({
      id: staleEpochInstId,
      idempotency_key: `700998_${childA1AccId}_OPEN`,
      action: 'OPEN',
      child_account_id: childA1AccId,
      parent_account_id: parentAccId,
      parent_ticket: '700998',
      symbol: 'EURUSD',
      order_type: 'BUY',
      lots: 0.1,
      status: 'QUEUED',
      retry_count: 0,
      activation_epoch: 0, // stale before A1's current epoch
      parent_event_timestamp: new Date(Date.now() - 120_000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const [poll1, poll2] = await Promise.all([
      store.pollPendingInstructions(childBAccId, 20, claimDb as any),
      store.pollPendingInstructions(childBAccId, 20, claimDb as any),
    ]);
    const deliveredToB = [...poll1, ...poll2].filter((i) => i.instructionId === raceInstId);
    assert.strictEqual(deliveredToB.length, 1, 'Queued OPEN instruction must be claimed at most once under concurrent polls');

    const pollA1 = await store.pollPendingInstructions(childA1AccId, 20, claimDb as any);
    assert.strictEqual(pollA1.some((i) => i.instructionId === staleEpochInstId), false);
    assert.strictEqual(state.bridge_instructions.find((i) => i.id === staleEpochInstId)?.status, 'FAILED');

    console.log('[PASS] 8. Concurrent single-delivery claim RPC & pre-activation poll cancellation verified.');
    console.log('\nALL CONSOLIDATED CLIENT BACKEND REQUIREMENTS TESTS PASSED (8/8 groups).');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
