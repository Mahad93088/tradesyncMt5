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
}

function createMockServiceRoleSupabase(state: DbState) {
  const applyFilters = (
    rows: Record<string, any>[],
    filters: Array<{ op: string; col: string; val: any }>
  ) => {
    return rows.filter((row) =>
      filters.every((f) => {
        if (f.op === 'eq') return row[f.col] === f.val;
        if (f.op === 'neq') return row[f.col] !== f.val;
        if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(row[f.col]);
        if (f.op === 'lt') return row[f.col] < f.val;
        return true;
      })
    );
  };

  return {
    from(tableName: keyof DbState) {
      const filters: Array<{ op: string; col: string; val: any }> = [];
      let selectedColumns = '*';
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitNum: number | null = null;
      let mode: 'select' | 'insert' | 'update' | 'upsert' = 'select';
      let payload: any = null;
      let conflictCol: string | null = null;

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
            return copy;
          });
          return { data: inserted, error: null };
        }

        if (mode === 'upsert') {
          const items = Array.isArray(payload) ? payload : [payload];
          const upserted: any[] = [];
          for (const item of items) {
            const keys = (conflictCol || 'id').split(',').map((k) => k.trim());
            const existingIdx = table.findIndex((row) => keys.every((k) => row[k] === item[k]));
            if (existingIdx >= 0) {
              table[existingIdx] = { ...table[existingIdx], ...item };
              upserted.push(table[existingIdx]);
            } else {
              const copy = {
                id: item.id || crypto.randomUUID(),
                created_at: item.created_at || new Date().toISOString(),
                ...item,
              };
              table.push(copy);
              upserted.push(copy);
            }
          }
          return { data: upserted, error: null };
        }

        if (mode === 'update') {
          const matched = applyFilters(table, filters);
          for (const row of matched) {
            Object.assign(row, payload);
          }
          return { data: matched, error: null };
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

        if (selectedColumns && selectedColumns !== '*') {
          const cols = selectedColumns.split(',').map((c) => c.trim());
          matched = matched.map((row) => {
            const projected: Record<string, any> = {};
            for (const c of cols) {
              projected[c] = row[c];
            }
            return projected;
          });
        }

        return { data: matched, error: null };
      };

      const builder: any = {
        select(cols = '*') {
          if (mode === 'select') {
            selectedColumns = cols;
          }
          return builder;
        },
        insert(data: any) {
          mode = 'insert';
          payload = data;
          return builder;
        },
        update(data: any) {
          mode = 'update';
          payload = data;
          return builder;
        },
        upsert(data: any, opts?: { onConflict?: string }) {
          mode = 'upsert';
          payload = data;
          conflictCol = opts?.onConflict || null;
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
        in(col: string, val: any) {
          filters.push({ op: 'in', col, val });
          return builder;
        },
        lt(col: string, val: any) {
          filters.push({ op: 'lt', col, val });
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
        async maybeSingle() {
          const res = await execute();
          if (res.error) return res;
          return { data: Array.isArray(res.data) ? res.data[0] || null : res.data, error: null };
        },
        async single() {
          const res = await execute();
          if (res.error) return res;
          const first = Array.isArray(res.data) ? res.data[0] : res.data;
          if (!first) return { data: null, error: { message: 'No rows found' } };
          return { data: first, error: null };
        },
        then(resolve: any, reject: any) {
          return execute().then(resolve, reject);
        },
      };

      return builder;
    },

    async rpc(fnName: string, params: Record<string, any>) {
      if (fnName !== 'claim_pending_instructions') {
        return { data: null, error: { message: `Unknown RPC ${fnName}` } };
      }

      const childId = params.p_child_account_id;
      const limit = Number(params.p_limit ?? 10);
      if (limit <= 0) {
        return { data: [], error: null };
      }

      const now = Date.now();
      const leaseIso = new Date(now + 15000).toISOString();

      // Replicate expired-retry failure transition & atomic lease claim
      for (const row of state.bridge_instructions) {
        if (
          row.child_account_id === childId &&
          row.status === 'IN_FLIGHT' &&
          row.lease_expires_at &&
          Date.parse(row.lease_expires_at) < now &&
          Number(row.retry_count || 0) >= 5
        ) {
          row.status = 'FAILED';
          row.error_message = 'Max execution retries (5) exceeded due to lease timeouts';
          row.completed_at = new Date().toISOString();
        }
      }

      const eligible = state.bridge_instructions
        .filter(
          (r) =>
            r.child_account_id === childId &&
            (r.status === 'QUEUED' ||
              (r.status === 'IN_FLIGHT' &&
                r.lease_expires_at &&
                Date.parse(r.lease_expires_at) < now &&
                Number(r.retry_count || 0) < 5))
        )
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .slice(0, limit);

      for (const row of eligible) {
        row.retry_count = row.status === 'IN_FLIGHT' ? Number(row.retry_count || 0) + 1 : 0;
        row.status = 'IN_FLIGHT';
        row.lease_expires_at = leaseIso;
        row.delivered_at = new Date().toISOString();
      }

      return { data: eligible, error: null };
    },
  };
}

async function startTestServer(app: any): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

async function httpJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json();
  return { status: res.status, json };
}

async function runPhase1SecurityAndPersistenceTests() {
  console.log('--- Starting Phase 1 Security, Persistence & Reliability Test Suite ---');

  // =========================================================================
  // PART A: Fail-closed behavior when SUPABASE_SERVICE_ROLE_KEY is missing
  // =========================================================================
  {
    console.log('Part A: Verifying fail-closed 503 behavior when SUPABASE_SERVICE_ROLE_KEY is missing...');
    const appNoServiceRole = createApiApp({
      serviceRoleKeyOverride: '',
      serviceRoleClientOverride: null,
      authUserResolverOverride: async (token) => {
        if (token === 'jwt-admin') {
          return { user: { id: '00000000-0000-4000-a000-000000000099', email: 'real-admin@tradesync.io' } };
        }
        return { user: null, error: { message: 'Invalid token' } };
      },
    });
    const srv = await startTestServer(appNoServiceRole);
    try {
      const health = await httpJson(`${srv.baseUrl}/api/health`);
      assert.strictEqual(health.status, 200);
      assert.strictEqual(health.json.hasServiceRole, false);
      assert.strictEqual(health.json.bridgePersistenceReady, false);
      assert.ok(health.json.missingServerEnv.includes('SUPABASE_SERVICE_ROLE_KEY'));

      // Every bridge terminal endpoint must return 503 instead of silently falling back to memory
      for (const ep of [
        { method: 'POST', path: '/api/v1/bridge/heartbeat', body: { account_number: '1001' } },
        { method: 'POST', path: '/api/v1/bridge/events/trade-open', body: { parentTicket: 123, symbol: 'EURUSD', orderType: 'BUY', lots: 0.1 } },
        { method: 'POST', path: '/api/v1/bridge/events/trade-close', body: { parentTicket: 123 } },
        { method: 'POST', path: '/api/v1/bridge/events/trade-modify', body: { parentTicket: 123, sl: 1.05 } },
        { method: 'GET', path: '/api/v1/bridge/instructions/pending' },
        { method: 'POST', path: '/api/v1/bridge/instructions/ack', body: { instructionId: 'x', status: 'EXECUTED' } },
      ]) {
        const res = await httpJson(`${srv.baseUrl}${ep.path}`, {
          method: ep.method,
          headers: {
            'Content-Type': 'application/json',
            'X-Terminal-Token': 'ts_dummy_token',
          },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        });
        assert.strictEqual(
          res.status,
          503,
          `${ep.method} ${ep.path} must return 503 when service role key is missing (got ${res.status})`
        );
        assert.strictEqual(res.json.code, 'SUPABASE_SERVICE_ROLE_MISSING');
      }

      // Admin/authenticated endpoints fail closed with 503 (even with admin JWT)
      const accountsRes = await httpJson(`${srv.baseUrl}/api/v1/admin/accounts`, {
        headers: { Authorization: 'Bearer jwt-admin' },
      });
      assert.strictEqual(accountsRes.status, 503);
      assert.strictEqual(accountsRes.json.code, 'SUPABASE_SERVICE_ROLE_MISSING');
    } finally {
      await srv.close();
    }
    console.log('✓ Part A passed: Zero silent in-memory fallbacks; all bridge & admin DB routes fail closed (503).');
  }

  // =========================================================================
  // PART B: API Security, RBAC, Tenant Isolation & End-to-End Persistence
  // =========================================================================
  {
    console.log('Part B: Verifying API Security, RBAC, Tenant Scoping, and Supabase Bridge Persistence...');

    const adminId = '11111111-1111-4111-a111-111111111111';
    const suspendedAdminId = '22222222-2222-4222-a222-222222222222';
    const spoofAdminEmailUserId = '33333333-3333-4333-a333-333333333333';
    const mentorId = '44444444-4444-4444-a444-444444444444';
    const traderId = '55555555-5555-4555-a555-555555555555';
    const otherTraderId = '66666666-6666-4666-a666-666666666666';

    const parentAccId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    const childAccId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const otherChildAccId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

    const parentPlainToken = 'ts_parent_secure_token_111111';
    const childPlainToken = 'ts_child_secure_token_222222';
    const otherChildPlainToken = 'ts_child_other_token_333333';
    const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

    const dbState: DbState = {
      profiles: [
        { id: adminId, email: 'ops-lead@company.io', full_name: 'Verified Admin', role: 'admin', status: 'active' },
        { id: suspendedAdminId, email: 'suspended@company.io', full_name: 'Suspended Admin', role: 'admin', status: 'suspended' },
        { id: spoofAdminEmailUserId, email: 'admin@attacker.com', full_name: 'Email Prefix Spoofer', role: 'trader', status: 'active' },
        { id: mentorId, email: 'mentor@company.io', full_name: 'Mentor Alpha', role: 'mentor', status: 'active' },
        { id: traderId, email: 'trader@company.io', full_name: 'Trader One', role: 'trader', status: 'active' },
        { id: otherTraderId, email: 'other-trader@company.io', full_name: 'Trader Two', role: 'trader', status: 'active' },
      ],
      mt5_accounts: [
        {
          id: parentAccId,
          user_id: mentorId,
          account_role: 'parent',
          account_number: '31120001',
          broker_name: 'XM',
          broker_server: 'XMGlobal-MT5 2',
          account_type: 'demo',
          balance: 50000,
          equity: 50000,
          connection_status: 'disconnected',
          auto_trading_enabled: true,
          terminal_token_hash: hash(parentPlainToken),
          terminal_token_prefix: 'ts_paren',
        },
        {
          id: childAccId,
          user_id: traderId,
          account_role: 'child',
          account_number: '31120002',
          broker_name: 'XM',
          broker_server: 'XMGlobal-MT5 2',
          account_type: 'demo',
          balance: 10000,
          equity: 10000,
          connection_status: 'disconnected',
          auto_trading_enabled: true,
          terminal_token_hash: hash(childPlainToken),
          terminal_token_prefix: 'ts_child',
        },
        {
          id: otherChildAccId,
          user_id: otherTraderId,
          account_role: 'child',
          account_number: '31120003',
          broker_name: 'XM',
          broker_server: 'XMGlobal-MT5 2',
          account_type: 'demo',
          balance: 10000,
          equity: 10000,
          connection_status: 'disconnected',
          auto_trading_enabled: true,
          terminal_token_hash: hash(otherChildPlainToken),
          terminal_token_prefix: 'ts_child',
        },
      ],
      mentor_assignments: [
        {
          id: 'dddddddd-dddd-4ddd-addd-dddddddddddd',
          mentor_id: mentorId,
          trader_id: traderId,
          parent_account_id: parentAccId,
          child_account_id: childAccId,
          status: 'active',
          lot_mode: 'multiplier',
          lot_multiplier: 1.5,
          fixed_lot: 0.1,
        },
      ],
      bridge_instructions: [],
      trade_mappings: [],
      bridge_sync_logs: [],
    };

    const mockSupabase = createMockServiceRoleSupabase(dbState) as any;

    const app = createApiApp({
      serviceRoleKeyOverride: 'test-service-role-key',
      serviceRoleClientOverride: mockSupabase,
      authUserResolverOverride: async (token) => {
        if (token === 'jwt-admin') return { user: { id: adminId, email: 'ops-lead@company.io' } };
        if (token === 'jwt-suspended-admin') return { user: { id: suspendedAdminId, email: 'suspended@company.io' } };
        if (token === 'jwt-spoof-email') {
          return {
            user: {
              id: spoofAdminEmailUserId,
              email: 'admin@attacker.com',
              user_metadata: { is_admin: true },
            },
          };
        }
        if (token === 'jwt-trader') return { user: { id: traderId, email: 'trader@company.io' } };
        if (token === 'jwt-other-trader') return { user: { id: otherTraderId, email: 'other-trader@company.io' } };
        return { user: null, error: { message: 'Invalid JWT' } };
      },
    });

    const srv = await startTestServer(app);
    try {
      // 1. Unauthenticated access rejected (401) across protected endpoints
      for (const ep of [
        { method: 'GET', path: '/api/admin/users' },
        { method: 'POST', path: '/api/admin/approve-user', body: { userId: traderId } },
        { method: 'POST', path: '/api/admin/promote-user', body: { userId: traderId } },
        { method: 'GET', path: '/api/admin/diagnostic/users' },
        { method: 'GET', path: '/api/v1/admin/accounts' },
        { method: 'POST', path: '/api/v1/admin/accounts/register', body: {} },
        { method: 'POST', path: '/api/v1/bridge/terminals/token', body: { accountId: childAccId } },
        { method: 'GET', path: '/api/v1/bridge/mappings' },
        { method: 'GET', path: '/api/v1/bridge/logs' },
        { method: 'GET', path: '/api/v1/bridge/status' },
      ]) {
        const res = await httpJson(`${srv.baseUrl}${ep.path}`, {
          method: ep.method,
          headers: { 'Content-Type': 'application/json' },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
        });
        assert.strictEqual(res.status, 401, `Unauthenticated ${ep.method} ${ep.path} must return 401`);
      }

      // 2. Email prefix (admin@*) + user_metadata.is_admin + suspended admin MUST be rejected (403)
      for (const badToken of ['jwt-spoof-email', 'jwt-suspended-admin', 'jwt-trader']) {
        const res1 = await httpJson(`${srv.baseUrl}/api/v1/admin/accounts`, {
          headers: { Authorization: `Bearer ${badToken}` },
        });
        assert.strictEqual(res1.status, 403, `${badToken} must get 403 on GET /api/v1/admin/accounts`);

        const res2 = await httpJson(`${srv.baseUrl}/api/v1/admin/accounts/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${badToken}` },
          body: JSON.stringify({
            accountRole: 'child',
            brokerName: 'XM',
            brokerServer: 'XMGlobal-MT5 2',
            accountNumber: '31129999',
          }),
        });
        assert.strictEqual(res2.status, 403, `${badToken} must get 403 on POST /api/v1/admin/accounts/register`);

        const res3 = await httpJson(`${srv.baseUrl}/api/v1/bridge/logs`, {
          headers: { Authorization: `Bearer ${badToken}` },
        });
        assert.strictEqual(res3.status, 403, `${badToken} must get 403 on GET /api/v1/bridge/logs`);
      }

      // 3. Cross-tenant token rotation MUST be denied (403); account owner & admin allowed (200)
      const crossTenantRotate = await httpJson(`${srv.baseUrl}/api/v1/bridge/terminals/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-other-trader' },
        body: JSON.stringify({ accountId: childAccId }),
      });
      assert.strictEqual(crossTenantRotate.status, 403, 'Other trader cannot rotate victim terminal token');

      const ownerRotate = await httpJson(`${srv.baseUrl}/api/v1/bridge/terminals/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-trader' },
        body: JSON.stringify({ accountId: childAccId }),
      });
      assert.strictEqual(ownerRotate.status, 200);
      assert.ok(ownerRotate.json.terminalToken.startsWith('ts_child_'));
      const rotatedChildToken = ownerRotate.json.terminalToken;

      // 4. Verified admin can list accounts, and terminal_token_hash is NEVER exposed
      const adminList = await httpJson(`${srv.baseUrl}/api/v1/admin/accounts`, {
        headers: { Authorization: 'Bearer jwt-admin' },
      });
      assert.strictEqual(adminList.status, 200);
      assert.strictEqual(adminList.json.accounts.length, 3);
      for (const acc of adminList.json.accounts) {
        assert.strictEqual('terminal_token_hash' in acc, false, 'terminal_token_hash must never be returned');
      }

      // 5. Query-string terminal token auth MUST be rejected (401)
      const queryAuthPending = await httpJson(
        `${srv.baseUrl}/api/v1/bridge/instructions/pending?token=${encodeURIComponent(rotatedChildToken)}`
      );
      assert.strictEqual(queryAuthPending.status, 401, 'Query-string terminal token auth must be rejected');

      // 6. Parent opens trade -> instruction persisted in bridge_instructions -> Child claims & ACKs
      const openRes = await httpJson(`${srv.baseUrl}/api/v1/bridge/events/trade-open`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Token': parentPlainToken,
        },
        body: JSON.stringify({
          ticket: '9001002003',
          symbol: 'EURUSD',
          type: 'BUY',
          lots: 0.2,
          openPrice: 1.085,
          sl: 1.08,
          tp: 1.095,
        }),
      });
      assert.strictEqual(openRes.status, 200);
      assert.strictEqual(openRes.json.childInstructionsQueued, 1);
      assert.strictEqual(dbState.bridge_instructions.length, 1);
      assert.strictEqual(dbState.bridge_instructions[0].lots, 0.3); // 0.2 * 1.5 multiplier

      const pendingRes = await httpJson(`${srv.baseUrl}/api/v1/bridge/instructions/pending`, {
        headers: { 'X-Terminal-Token': rotatedChildToken },
      });
      assert.strictEqual(pendingRes.status, 200);
      assert.strictEqual(pendingRes.json.instructions.length, 1);
      const claimedInst = pendingRes.json.instructions[0];

      // 7. Cross-child ACK MUST fail with 403 (Priority 3 ownership enforcement)
      const crossAck = await httpJson(`${srv.baseUrl}/api/v1/bridge/instructions/ack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Token': otherChildPlainToken,
        },
        body: JSON.stringify({
          instructionId: claimedInst.instructionId,
          status: 'EXECUTED',
          childTicket: '888000111',
        }),
      });
      assert.strictEqual(crossAck.status, 403, 'Another child terminal cannot ACK an instruction it does not own');

      // 8. Invalid ACK status MUST fail with 400
      const invalidAck = await httpJson(`${srv.baseUrl}/api/v1/bridge/instructions/ack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Token': rotatedChildToken,
        },
        body: JSON.stringify({
          instructionId: claimedInst.instructionId,
          status: 'INVALID_STATUS',
        }),
      });
      assert.strictEqual(invalidAck.status, 400);

      // 9. Legitimate Child ACK succeeds and saves trade_mappings
      const validAck = await httpJson(`${srv.baseUrl}/api/v1/bridge/instructions/ack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Token': rotatedChildToken,
        },
        body: JSON.stringify({
          instructionId: claimedInst.instructionId,
          status: 'EXECUTED',
          childTicket: '888000111',
          fillPrice: 1.0851,
        }),
      });
      assert.strictEqual(validAck.status, 200);
      assert.strictEqual(dbState.trade_mappings.length, 1);
      assert.strictEqual(dbState.trade_mappings[0].child_trade_ticket, '888000111');

      // 10. Duplicate ACK from retry loop succeeds idempotently
      const dupAck = await httpJson(`${srv.baseUrl}/api/v1/bridge/instructions/ack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Token': rotatedChildToken,
        },
        body: JSON.stringify({
          instructionId: claimedInst.instructionId,
          status: 'EXECUTED',
          childTicket: '888000111',
        }),
      });
      assert.strictEqual(dupAck.status, 200);
      assert.strictEqual(dupAck.json.duplicate, true);

      // 11. Tenant isolation on GET /api/v1/bridge/mappings
      const otherTraderMappings = await httpJson(`${srv.baseUrl}/api/v1/bridge/mappings`, {
        headers: { Authorization: 'Bearer jwt-other-trader' },
      });
      assert.strictEqual(otherTraderMappings.status, 200);
      assert.strictEqual(otherTraderMappings.json.mappings.length, 0, 'Unrelated trader must not see other mappings');

      const ownerMappings = await httpJson(`${srv.baseUrl}/api/v1/bridge/mappings`, {
        headers: { Authorization: 'Bearer jwt-trader' },
      });
      assert.strictEqual(ownerMappings.status, 200);
      assert.strictEqual(ownerMappings.json.mappings.length, 1);
    } finally {
      await srv.close();
    }
    console.log('✓ Part B passed: RBAC, tenant isolation, query-token removal, and durable bridge persistence verified.');
  }

  // =========================================================================
  // PART C: MQL5 Receiver EA Safety & Reliability Guards Verification
  // =========================================================================
  {
    console.log('Part C: Verifying TradeSync_Receiver.mq5 & TradeSync_Broadcaster.mq5 guards...');
    const receiverSrc = fs.readFileSync(path.join(process.cwd(), 'public/mql5/TradeSync_Receiver.mq5'), 'utf-8');
    const broadcasterSrc = fs.readFileSync(path.join(process.cwd(), 'public/mql5/TradeSync_Broadcaster.mq5'), 'utf-8');

    // Demo-only safety preserved intact in both EAs
    assert.ok(receiverSrc.includes('ACCOUNT_TRADE_MODE_DEMO'), 'Receiver must preserve ACCOUNT_TRADE_MODE_DEMO');
    assert.ok(receiverSrc.includes('EnsureDemoAccount("OnInit")'));
    assert.ok(receiverSrc.includes('EnsureDemoAccount("TrySendAckNow")'));
    assert.ok(broadcasterSrc.includes('ACCOUNT_TRADE_MODE_DEMO'), 'Broadcaster must preserve ACCOUNT_TRADE_MODE_DEMO');
    assert.ok(broadcasterSrc.includes('EnsureDemoAccount("OnInit")'));

    // Priority 3 Receiver EA reliability safeguards present
    assert.ok(receiverSrc.includes('FindProcessedInstructionIndex'), 'Receiver must deduplicate processed instructions');
    assert.ok(receiverSrc.includes('CountChildPositionsByParentTicket'), 'Receiver must guard against duplicate OPEN positions');
    assert.ok(receiverSrc.includes('FlushPendingAcks'), 'Receiver must flush queued ACKs in OnTimer');
    assert.ok(receiverSrc.includes('EnqueuePendingAck'), 'Receiver must enqueue retryable ACKs on transient failure');
    assert.ok(receiverSrc.includes('EscapeJsonString'), 'Receiver must escape JSON payload strings');

    console.log('✓ Part C passed: Demo-only EA guards intact and Receiver EA duplicate/ACK-retry logic verified.');
  }

  console.log('\nALL PHASE 1 SECURITY, PERSISTENCE & RELIABILITY TESTS PASSED SUCCESSFULLY!');
}

runPhase1SecurityAndPersistenceTests().catch((err) => {
  console.error('❌ Phase 1 Security & Persistence Test Suite Failed:', err);
  process.exit(1);
});
