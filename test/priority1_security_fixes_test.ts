import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
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
  auth_users: Record<string, any>[];
}

function createPriority1MockSupabase(state: DbState) {
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
    auth: {
      admin: {
        async createUser(params: {
          email: string;
          password: string;
          email_confirm?: boolean;
          user_metadata?: Record<string, any>;
        }) {
          const emailLower = params.email.trim().toLowerCase();
          if (state.auth_users.some((u) => u.email.toLowerCase() === emailLower)) {
            return { data: { user: null }, error: { message: 'User already registered' } };
          }
          const user = {
            id: crypto.randomUUID(),
            email: emailLower,
            email_confirmed_at: params.email_confirm ? new Date().toISOString() : null,
            user_metadata: params.user_metadata || {},
          };
          state.auth_users.push(user);
          // Simulate handle_new_user() trigger initializing public.profiles as 'trader'
          state.profiles.push({
            id: user.id,
            email: emailLower,
            full_name: params.user_metadata?.full_name || emailLower.split('@')[0],
            role: 'trader',
            status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          return { data: { user }, error: null };
        },
        async deleteUser(userId: string) {
          state.auth_users = state.auth_users.filter((u) => u.id !== userId);
          return { data: {}, error: null };
        },
      },
    },
    from(tableName: keyof DbState) {
      const filters: Array<{ op: string; col?: string; val?: any; expr?: string }> = [];
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitNum: number | null = null;
      let mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
      let payload: any = null;
      let upsertOnConflict: string | null = null;
      let selectCols: string | null = null;

      const execute = async () => {
        const table = state[tableName];
        if (!table) {
          return { data: null, error: { message: `Table ${String(tableName)} not found` } };
        }

        // Simulate live Supabase schema where mt5_accounts does NOT have assigned_parent_id
        if (tableName === 'mt5_accounts') {
          if (selectCols && selectCols.includes('assigned_parent_id')) {
            return {
              data: null,
              error: { code: '42703', message: 'column mt5_accounts.assigned_parent_id does not exist' },
            };
          }
          if (payload) {
            const items = Array.isArray(payload) ? payload : [payload];
            if (items.some((it) => it && typeof it === 'object' && 'assigned_parent_id' in it)) {
              return {
                data: null,
                error: { code: '42703', message: 'column "assigned_parent_id" of relation "mt5_accounts" does not exist' },
              };
            }
          }
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
        if (limitNum !== null) {
          matched = matched.slice(0, limitNum);
        }
        return { data: matched.map((r) => ({ ...r })), error: null };
      };

      const builder: any = {
        select(cols?: string) {
          if (typeof cols === 'string') {
            selectCols = cols;
          }
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
  console.log('=== TradeSync MT5 Priority 1 Critical Security & DB Integrity Tests ===\n');

  const nowIso = new Date().toISOString();
  const adminId = '11111111-1111-4111-8111-111111111111';
  const suspendedAdminId = '11111111-1111-4111-8111-111111111119';
  const mentorId = '22222222-2222-4222-8222-222222222222';
  const mentor2Id = '22222222-2222-4222-8222-222222222228';
  const pendingMentorId = '22222222-2222-4222-8222-222222222229';
  const traderId = '33333333-3333-4333-8333-333333333333';
  const suspendedTraderId = '33333333-3333-4333-8333-333333333339';

  const parentAccId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const parent2AccId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const childAccId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const liveChildAccId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
  const suspendedOwnerAccId = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4';

  const state: DbState = {
    auth_users: [
      { id: adminId, email: 'admin@tradesync.io' },
      { id: mentorId, email: 'mentor@tradesync.io' },
      { id: traderId, email: 'trader@tradesync.io' },
    ],
    profiles: [
      { id: adminId, email: 'admin@tradesync.io', full_name: 'Admin User', role: 'admin', status: 'active', created_at: nowIso },
      { id: suspendedAdminId, email: 'badadmin@tradesync.io', full_name: 'Suspended Admin', role: 'admin', status: 'suspended', created_at: nowIso },
      { id: mentorId, email: 'mentor@tradesync.io', full_name: 'Alpha Mentor', role: 'mentor', status: 'active', created_at: nowIso },
      { id: mentor2Id, email: 'mentor2@tradesync.io', full_name: 'Beta Mentor', role: 'mentor', status: 'active', created_at: nowIso },
      { id: pendingMentorId, email: 'pending@tradesync.io', full_name: 'Pending Mentor', role: 'mentor', status: 'pending', created_at: nowIso },
      { id: traderId, email: 'trader@tradesync.io', full_name: 'Follower Trader', role: 'trader', status: 'active', created_at: nowIso },
      { id: suspendedTraderId, email: 'suspended@tradesync.io', full_name: 'Suspended Trader', role: 'trader', status: 'suspended', created_at: nowIso },
    ],
    mt5_accounts: [
      {
        id: parentAccId,
        user_id: mentorId,
        account_role: 'parent',
        account_number: '5100001',
        broker_name: 'XM',
        broker_server: 'xmglobal_mt5 7',
        account_type: 'demo',
        balance: 50000,
        equity: 50000,
        margin: 0,
        free_margin: 50000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'connected',
        ping_ms: 14,
        auto_trading_enabled: true,
        last_sync: nowIso,
        created_at: nowIso,
      },
      {
        id: parent2AccId,
        user_id: mentor2Id,
        account_role: 'parent',
        account_number: '5100002',
        broker_name: 'XM',
        broker_server: 'xmglobal_mt5 7',
        account_type: 'demo',
        balance: 25000,
        equity: 25000,
        margin: 0,
        free_margin: 25000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        ping_ms: 0,
        auto_trading_enabled: true,
        last_sync: nowIso,
        created_at: nowIso,
      },
      {
        id: childAccId,
        user_id: traderId,
        account_role: 'child',
        account_number: '6100001',
        broker_name: 'XM',
        broker_server: 'xmglobal_mt5 2',
        account_type: 'demo',
        balance: 10000,
        equity: 10000,
        margin: 0,
        free_margin: 10000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        ping_ms: 0,
        auto_trading_enabled: true,
        last_sync: nowIso,
        created_at: nowIso,
      },
      {
        id: liveChildAccId,
        user_id: traderId,
        account_role: 'child',
        account_number: '6999999',
        broker_name: 'BlockedLiveBroker',
        broker_server: 'Live-01',
        account_type: 'live',
        balance: 1000,
        equity: 1000,
        margin: 0,
        free_margin: 1000,
        currency: 'USD',
        leverage: 100,
        connection_status: 'disconnected',
        ping_ms: 0,
        auto_trading_enabled: false,
        last_sync: nowIso,
        created_at: nowIso,
      },
      {
        id: suspendedOwnerAccId,
        user_id: suspendedTraderId,
        account_role: 'child',
        account_number: '6200002',
        broker_name: 'XM',
        broker_server: 'xmglobal_mt5 2',
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
        created_at: nowIso,
      },
    ],
    mentor_assignments: [],
    bridge_instructions: [],
    trade_mappings: [],
    bridge_sync_logs: [],
    trades: [],
  };

  const mockSupabase = createPriority1MockSupabase(state);
  const tokenMap: Record<string, any> = {
    'jwt-admin': { id: adminId, email: 'admin@tradesync.io' },
    'jwt-suspended-admin': { id: suspendedAdminId, email: 'badadmin@tradesync.io' },
    'jwt-mentor': { id: mentorId, email: 'mentor@tradesync.io' },
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
    // FIX 1: Server-side Admin User Creation (POST /api/admin/users/create)
    // -----------------------------------------------------------------------
    const unauthCreate = await fetch(`${baseUrl}/api/admin/users/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: 'Test Mentor', email: 'new@tradesync.io', password: 'password123' }),
    });
    assert.strictEqual(unauthCreate.status, 401);

    const nonAdminCreate = await fetch(`${baseUrl}/api/admin/users/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-mentor' },
      body: JSON.stringify({ fullName: 'Test Mentor', email: 'new@tradesync.io', password: 'password123' }),
    });
    assert.strictEqual(nonAdminCreate.status, 403);

    const suspendedAdminCreate = await fetch(`${baseUrl}/api/admin/users/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-suspended-admin' },
      body: JSON.stringify({ fullName: 'Test Mentor', email: 'new@tradesync.io', password: 'password123' }),
    });
    assert.strictEqual(suspendedAdminCreate.status, 403);

    const adminRoleCreate = await fetch(`${baseUrl}/api/admin/users/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        fullName: 'Privilege Escalate',
        email: 'escalate@tradesync.io',
        password: 'password123',
        role: 'admin',
      }),
    });
    assert.strictEqual(adminRoleCreate.status, 403);

    const duplicateCreate = await fetch(`${baseUrl}/api/admin/users/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        fullName: 'Existing Mentor',
        email: 'MENTOR@TRADESYNC.IO',
        password: 'password123',
        role: 'mentor',
      }),
    });
    assert.strictEqual(duplicateCreate.status, 409);

    const okCreate = await fetch(`${baseUrl}/api/admin/users/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        fullName: 'Marcus Vance',
        email: 'Marcus.Vance@Firm.com',
        password: 'tempPassword99',
        role: 'mentor',
        status: 'active',
        strategyName: 'Alpha Flow',
        monthlyFee: 149,
      }),
    });
    assert.strictEqual(okCreate.status, 201);
    const okCreateJson = await okCreate.json();
    assert.strictEqual(okCreateJson.success, true);
    assert.strictEqual(okCreateJson.profile.email, 'marcus.vance@firm.com');
    assert.strictEqual(okCreateJson.profile.role, 'mentor');
    assert.strictEqual(okCreateJson.profile.status, 'active');
    assert.strictEqual(okCreateJson.strategyProfilePersisted, false);
    assert.strictEqual(okCreateJson.missingSchemaTable, 'mentor_profiles');
    assert.ok(String(okCreateJson.warning).includes('mentor_profiles'));
    assert.ok(state.bridge_sync_logs.some((l) => l.event_type === 'ADMIN_USER_CREATED'));
    console.log('[PASS] 1. POST /api/admin/users/create enforces RBAC, duplicate check, admin-role block, and honest strategy metadata notice.');

    // -----------------------------------------------------------------------
    // FIX 2 & 3: Secure Assignments & Owner Association (No missing-account fabrication)
    // -----------------------------------------------------------------------
    const accountsBefore = state.mt5_accounts.length;

    const missingParentAssign = await fetch(`${baseUrl}/api/v1/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        mentorId,
        traderId,
        parentAccountId: '99999999-9999-4999-8999-999999999999',
        childAccountId: childAccId,
      }),
    });
    assert.strictEqual(missingParentAssign.status, 404);
    assert.strictEqual(state.mt5_accounts.length, accountsBefore, 'Must never fabricate missing MT5 accounts');

    const identityConfusion = await fetch(`${baseUrl}/api/v1/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        mentorId: parentAccId,
        traderId,
        parentAccountId: parentAccId,
        childAccountId: childAccId,
      }),
    });
    assert.strictEqual(identityConfusion.status, 400);

    const selfAssign = await fetch(`${baseUrl}/api/v1/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        mentorId,
        traderId: mentorId,
        parentAccountId: parentAccId,
        childAccountId: childAccId,
      }),
    });
    assert.strictEqual(selfAssign.status, 400);

    const pendingMentorAssign = await fetch(`${baseUrl}/api/v1/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        mentorId: pendingMentorId,
        traderId,
        parentAccountId: parentAccId,
        childAccountId: childAccId,
      }),
    });
    assert.strictEqual(pendingMentorAssign.status, 400);

    const liveAssign = await fetch(`${baseUrl}/api/v1/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        mentorId,
        traderId,
        parentAccountId: parentAccId,
        childAccountId: liveChildAccId,
      }),
    });
    assert.strictEqual(liveAssign.status, 403);
    const liveAssignJson = await liveAssign.json();
    assert.strictEqual(liveAssignJson.code, 'DEMO_ONLY_SAFETY_BLOCK');

    const ownershipMismatch = await fetch(`${baseUrl}/api/v1/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        mentorId: mentor2Id,
        traderId,
        parentAccountId: parentAccId, // belongs to mentorId
        childAccountId: childAccId,
      }),
    });
    assert.strictEqual(ownershipMismatch.status, 403);

    const okAssign = await fetch(`${baseUrl}/api/v1/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        mentorId,
        traderId,
        parentAccountId: parentAccId,
        childAccountId: childAccId,
        lotSettings: { copyMode: 'fixed_lot', multiplier: 1.0, fixedLot: 0.25 },
      }),
    });
    assert.strictEqual(okAssign.status, 200);
    const okAssignJson = await okAssign.json();
    assert.strictEqual(okAssignJson.success, true);
    assert.strictEqual(okAssignJson.assignment.lot_mode, 'fixed');
    assert.strictEqual(okAssignJson.assignment.parent_account_id, parentAccId);
    assert.strictEqual(okAssignJson.assignment.child_account_id, childAccId);

    // Verify GET /api/v1/admin/accounts and GET /api/v1/bridge/my-accounts work without mt5_accounts.assigned_parent_id
    const adminAccsRes = await fetch(`${baseUrl}/api/v1/admin/accounts`, {
      headers: { Authorization: 'Bearer jwt-admin' },
    });
    assert.strictEqual(adminAccsRes.status, 200);
    const adminAccsJson = await adminAccsRes.json();
    assert.strictEqual(
      adminAccsJson.accounts.find((a: any) => a.id === childAccId)?.assigned_parent_id,
      parentAccId
    );

    const myAccsRes = await fetch(`${baseUrl}/api/v1/bridge/my-accounts`, {
      headers: { Authorization: 'Bearer jwt-trader' },
    });
    assert.strictEqual(myAccsRes.status, 200);
    const myAccsJson = await myAccsRes.json();
    assert.strictEqual(
      myAccsJson.accounts.find((a: any) => a.id === childAccId)?.assigned_parent_id,
      parentAccId
    );

    const dupAssign = await fetch(`${baseUrl}/api/v1/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        mentorId,
        traderId,
        parentAccountId: parentAccId,
        childAccountId: childAccId,
        lotSettings: { copyMode: 'multiplier', multiplier: 2.0 },
      }),
    });
    assert.strictEqual(dupAssign.status, 409);

    const replaceAssign = await fetch(`${baseUrl}/api/v1/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        mentorId,
        traderId,
        parentAccountId: parentAccId,
        childAccountId: childAccId,
        replaceExisting: true,
        lotSettings: { copyMode: 'multiplier', multiplier: 2.0 },
      }),
    });
    assert.strictEqual(replaceAssign.status, 200);
    const replaceAssignJson = await replaceAssign.json();
    assert.strictEqual(replaceAssignJson.assignment.lot_mode, 'multiplier');
    assert.strictEqual(replaceAssignJson.assignment.lot_multiplier, 2.0);
    console.log('[PASS] 2. POST /api/v1/admin/assignments enforces zero fabrication, anti-self/identity checks, Demo-only, ownership, and duplicate protection.');

    // Owner association endpoint checks
    const missingOwnerAcc = await fetch(`${baseUrl}/api/v1/admin/accounts/99999999-9999-4999-8999-999999999999/owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ profileId: mentorId }),
    });
    assert.strictEqual(missingOwnerAcc.status, 404);
    assert.strictEqual(state.mt5_accounts.length, accountsBefore);

    const liveOwnerAcc = await fetch(`${baseUrl}/api/v1/admin/accounts/${liveChildAccId}/owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ profileId: traderId }),
    });
    assert.strictEqual(liveOwnerAcc.status, 403);

    const wrongRoleOwner = await fetch(`${baseUrl}/api/v1/admin/accounts/${parentAccId}/owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ profileId: traderId }),
    });
    assert.strictEqual(wrongRoleOwner.status, 400);

    const validOwnerUpdate = await fetch(`${baseUrl}/api/v1/admin/accounts/${parent2AccId}/owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ profileId: mentorId }),
    });
    assert.strictEqual(validOwnerUpdate.status, 200);
    assert.strictEqual(state.mt5_accounts.find((a) => a.id === parent2AccId)?.user_id, mentorId);

    const unassignRes = await fetch(`${baseUrl}/api/v1/admin/assignments/unassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ childAccountId: childAccId }),
    });
    assert.strictEqual(unassignRes.status, 200);
    assert.strictEqual(state.mentor_assignments.length, 0);
    console.log('[PASS] 3. POST /api/v1/admin/accounts/:id/owner & /assignments/unassign validate existence, Demo-only, and role parity.');

    // -----------------------------------------------------------------------
    // FIX 5 & 6: Registration & Terminal Connection Demo-Only Enforcement
    // -----------------------------------------------------------------------
    const liveSelfRegister = await fetch(`${baseUrl}/api/v1/bridge/accounts/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-trader' },
      body: JSON.stringify({
        accountRole: 'child',
        accountNumber: '7777777',
        brokerName: 'XM',
        brokerServer: 'xmglobal_mt5 2',
        accountType: 'live',
      }),
    });
    assert.strictEqual(liveSelfRegister.status, 403);
    const liveSelfJson = await liveSelfRegister.json();
    assert.strictEqual(liveSelfJson.code, 'DEMO_ONLY_SAFETY_BLOCK');

    const liveAdminRegister = await fetch(`${baseUrl}/api/v1/admin/accounts/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        userId: mentorId,
        accountRole: 'parent',
        accountNumber: '7777778',
        brokerName: 'XM',
        brokerServer: 'xmglobal_mt5 7',
        accountType: 'live',
      }),
    });
    assert.strictEqual(liveAdminRegister.status, 403);

    const liveConnActivate = await fetch(`${baseUrl}/api/v1/bridge/accounts/${liveChildAccId}/connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ connectionStatus: 'connected' }),
    });
    assert.strictEqual(liveConnActivate.status, 403);

    const suspendedOwnerActivate = await fetch(`${baseUrl}/api/v1/bridge/accounts/${suspendedOwnerAccId}/connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ connectionStatus: 'connected' }),
    });
    assert.strictEqual(suspendedOwnerActivate.status, 403);

    const validConnActivate = await fetch(`${baseUrl}/api/v1/bridge/accounts/${childAccId}/connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-trader' },
      body: JSON.stringify({ connectionStatus: 'connected' }),
    });
    assert.strictEqual(validConnActivate.status, 200);
    assert.strictEqual(state.mt5_accounts.find((a) => a.id === childAccId)?.connection_status, 'connected');
    assert.ok(state.bridge_sync_logs.some((l) => l.event_type === 'TERMINAL_ACTIVATED'));

    const validConnSuspend = await fetch(`${baseUrl}/api/v1/bridge/accounts/${childAccId}/connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-trader' },
      body: JSON.stringify({ connectionStatus: 'disconnected' }),
    });
    assert.strictEqual(validConnSuspend.status, 200);
    assert.strictEqual(state.mt5_accounts.find((a) => a.id === childAccId)?.connection_status, 'disconnected');
    assert.strictEqual(state.mt5_accounts.find((a) => a.id === childAccId)?.ping_ms, 0);
    assert.ok(state.bridge_sync_logs.some((l) => l.event_type === 'TERMINAL_SUSPENDED'));
    console.log('[PASS] 4. Demo-Only & active-owner checks enforced across register and connection endpoints.');

    // -----------------------------------------------------------------------
    // Static Security Regression & Migration 06 Checks
    // -----------------------------------------------------------------------
    const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

    const provisionSrc = read('src/components/admin/ProvisionMentorModal.tsx');
    assert.strictEqual(provisionSrc.includes('supabase.auth.signUp'), false, 'Client signUp must be removed');
    assert.strictEqual(provisionSrc.includes("../../lib/supabase"), false, 'Direct supabase import must be removed');
    assert.strictEqual(provisionSrc.includes('mt5AdminService.createAdminUser'), true);
    assert.strictEqual(provisionSrc.includes('!isCloudMode && ('), true);

    const adminSvcSrc = read('src/services/mt5AdminService.ts');
    assert.strictEqual(adminSvcSrc.includes('ICMarketsSC-Live04'), false);
    assert.strictEqual(adminSvcSrc.includes('Eightcap-Real03'), false);
    assert.strictEqual(adminSvcSrc.includes("supabase.from('mt5_accounts')"), false);
    assert.strictEqual(adminSvcSrc.includes("supabase.from('mentor_assignments')"), false);
    assert.strictEqual(adminSvcSrc.includes("supabase.from('profiles')"), false);
    assert.strictEqual(adminSvcSrc.includes('parsed.status === 404'), false);

    const regModalSrc = read('src/components/admin/RegisterMT5AccountModal.tsx');
    assert.strictEqual(regModalSrc.includes('value="live"'), false, 'Live account option must be removed');

    const assignModalSrc = read('src/components/admin/AssignParentModal.tsx');
    assert.strictEqual(assignModalSrc.includes('replaceExisting:'), true);
    assert.strictEqual(assignModalSrc.includes('!isCloudMode && !hasParents'), true);
    assert.strictEqual(assignModalSrc.includes('currentUser?.role === \'admin\' || user?.role === \'admin\''), true);

    const mt5MgmtSrc = read('src/components/admin/MT5AccountsManagementView.tsx');
    assert.strictEqual(mt5MgmtSrc.includes('updateAccountConnection'), false, 'Duplicate mutation call must be removed');
    assert.strictEqual(mt5MgmtSrc.includes('terminalToken'), false, 'terminalToken string must not appear');

    const appCtxSrc = read('src/context/AppContext.tsx');
    assert.strictEqual(appCtxSrc.includes('supabaseDataService.addAccount'), false, 'Direct browser insert must be removed');
    assert.strictEqual(appCtxSrc.includes('mt5AdminService.registerMT5Account'), true);

    const dataSvcSrc = read('src/services/supabaseDataService.ts');
    assert.strictEqual(dataSvcSrc.includes("from('mt5_accounts')\n        .insert"), false);
    assert.strictEqual(dataSvcSrc.includes('.select(\n          \'id, user_id'), true);
    assert.strictEqual(dataSvcSrc.includes('terminal_token_hash'), false, 'Client query must never select terminal_token_hash');

    const mig06Src = read('supabase/migrations/06_harden_mt5_accounts_rls.sql');
    assert.strictEqual(mig06Src.includes('protect_mt5_account_security'), true);
    assert.strictEqual(mig06Src.includes('SECURITY INVOKER'), true, 'Trigger must use SECURITY INVOKER');
    assert.strictEqual(mig06Src.includes('SECURITY DEFINER'), false, 'Trigger must not use SECURITY DEFINER');
    assert.strictEqual(mig06Src.includes('trg_protect_mt5_account_security'), true);
    assert.strictEqual(mig06Src.includes('REVOKE SELECT (terminal_token_hash) ON public.mt5_accounts'), true);
    assert.strictEqual(mig06Src.includes('mt5_accounts_insert_policy'), true);
    assert.strictEqual(mig06Src.includes('mt5_accounts_update_policy'), true);
    assert.strictEqual(mig06Src.includes("v_caller_role = 'trader' AND NEW.account_role = 'child'"), true);
    assert.strictEqual(mig06Src.includes("v_caller_role = 'mentor' AND NEW.account_role = 'parent'"), true);
    assert.strictEqual(mig06Src.includes("NEW.connection_status IS DISTINCT FROM 'disconnected'"), true);
    assert.strictEqual(mig06Src.includes('NEW.balance IS DISTINCT FROM OLD.balance'), true);
    assert.strictEqual(mig06Src.includes('NEW.equity IS DISTINCT FROM OLD.equity'), true);
    assert.strictEqual(mig06Src.includes('NEW.margin IS DISTINCT FROM OLD.margin'), true);
    assert.strictEqual(mig06Src.includes('NEW.free_margin IS DISTINCT FROM OLD.free_margin'), true);
    assert.strictEqual(mig06Src.includes('NEW.ping_ms IS DISTINCT FROM OLD.ping_ms'), true);
    assert.strictEqual(mig06Src.includes('NEW.last_sync IS DISTINCT FROM OLD.last_sync'), true);
    assert.strictEqual(mig06Src.includes('NEW.error_message IS DISTINCT FROM OLD.error_message'), true);
    assert.strictEqual(mig06Src.includes("ALTER COLUMN connection_status SET DEFAULT 'disconnected'"), true);
    assert.strictEqual(mig06Src.includes('assigned_parent_id'), false, 'Migration 06 must not reference non-existent assigned_parent_id column');
    assert.strictEqual(mig06Src.includes('v_is_backend_service'), true, 'Trigger must separate backend service_role from authenticated admin');
    assert.strictEqual(
      mig06Src.includes("IF NOT v_is_backend_service AND NEW.account_type IS DISTINCT FROM 'demo' THEN"),
      true,
      'Trigger must block authenticated admins from inserting/updating live accounts'
    );
    assert.strictEqual(
      /CREATE POLICY "mt5_accounts_insert_policy"[\s\S]*?WITH CHECK \(\s*account_type = 'demo'\s*AND \(\s*public\.is_admin\(\)/m.test(mig06Src),
      true,
      'INSERT RLS policy must enforce account_type = demo even for authenticated admins'
    );
    assert.strictEqual(
      /CREATE POLICY "mt5_accounts_update_policy"[\s\S]*?WITH CHECK \(\s*account_type = 'demo'\s*AND \(\s*public\.is_admin\(\)/m.test(mig06Src),
      true,
      'UPDATE RLS policy must enforce account_type = demo even for authenticated admins'
    );

    const apiAppSrc = read('src/server/apiApp.ts');
    assert.strictEqual(dataSvcSrc.includes('assigned_parent_id'), false, 'supabaseDataService must not query assigned_parent_id');
    assert.strictEqual(
      /from\('mt5_accounts'\)[\s\S]{0,400}assigned_parent_id/.test(apiAppSrc),
      false,
      'apiApp must not read or write mt5_accounts.assigned_parent_id directly'
    );

    console.log('[PASS] 5. Static security regression & Migration 06 checks all verified.');
    console.log('\nALL PRIORITY 1 SECURITY & DB INTEGRITY TESTS PASSED.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
