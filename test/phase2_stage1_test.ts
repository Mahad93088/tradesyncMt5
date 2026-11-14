import assert from 'node:assert';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApiApp } from '../src/server/apiApp.js';
import { RiskEngine } from '../src/server/riskEngine.js';

interface DbState {
  profiles: Record<string, any>[];
  mt5_accounts: Record<string, any>[];
  mentor_assignments: Record<string, any>[];
  bridge_instructions: Record<string, any>[];
  trade_mappings: Record<string, any>[];
  bridge_sync_logs: Record<string, any>[];
}

function createStage1MockSupabase(
  state: DbState,
  opts?: { failMentorAssignmentsUpsert?: boolean }
) {
  const applyFilters = (
    rows: Record<string, any>[],
    filters: Array<{ op: string; col: string; val: any }>
  ) =>
    rows.filter((row) =>
      filters.every((f) => {
        if (f.op === 'eq') return row[f.col] === f.val;
        if (f.op === 'neq') return row[f.col] !== f.val;
        if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(row[f.col]);
        if (f.op === 'lt') return row[f.col] < f.val;
        return true;
      })
    );

  return {
    from(tableName: keyof DbState) {
      const filters: Array<{ op: string; col: string; val: any }> = [];
      let selectedColumns = '*';
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitNum: number | null = null;
      let mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
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
          if (tableName === 'mentor_assignments' && opts?.failMentorAssignmentsUpsert) {
            return {
              data: null,
              error: { message: 'Security error: simulated trigger/constraint rejection on mentor_assignments' },
            };
          }
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

        if (mode === 'delete') {
          const toKeep: any[] = [];
          const deleted: any[] = [];
          for (const row of table) {
            const isMatch = applyFilters([row], filters).length > 0;
            if (isMatch) deleted.push(row);
            else toKeep.push(row);
          }
          state[tableName] = toKeep as any;
          return { data: deleted, error: null };
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
            for (const c of cols) projected[c] = row[c];
            return projected;
          });
        }

        return { data: matched, error: null };
      };

      const builder: any = {
        select(cols = '*') {
          if (mode === 'select') selectedColumns = cols;
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
        upsert(data: any, uOpts?: { onConflict?: string }) {
          mode = 'upsert';
          payload = data;
          conflictCol = uOpts?.onConflict || null;
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
        in(col: string, val: any) {
          filters.push({ op: 'in', col, val });
          return builder;
        },
        lt(col: string, val: any) {
          filters.push({ op: 'lt', col, val });
          return builder;
        },
        order(col: string, oOpts?: { ascending?: boolean }) {
          orderCol = col;
          orderAsc = oOpts?.ascending !== false;
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

    async rpc() {
      return { data: [], error: null };
    },
  };
}

async function startServer(app: any): Promise<{ baseUrl: string; close: () => Promise<void> }> {
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

async function jsonReq(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json();
  return { status: res.status, json };
}

async function runStage1Tests() {
  console.log('=================================================================');
  console.log('PHASE 2 STAGE 1 TESTS: REGISTRATION, LOT MODES & RISK ENGINE');
  console.log('=================================================================');

  // -----------------------------------------------------------------------
  // 1. RiskEngine Unit Tests: Case-sensitive Symbols, Sizing & Validation
  // -----------------------------------------------------------------------
  {
    console.log('[TEST 1] RiskEngine symbol prefix/suffix & validation...');
    assert.strictEqual(RiskEngine.adjustSymbol('EURUSD', '', 'm'), 'EURUSDm', 'Lowercase broker suffix preserved');
    assert.strictEqual(RiskEngine.adjustSymbol('GBPUSD', '', '.r'), 'GBPUSD.r', 'Dot suffix preserved');
    assert.strictEqual(RiskEngine.adjustSymbol('XAUUSD', 'pro.', '.ecn'), 'pro.XAUUSD.ecn');
    assert.strictEqual(RiskEngine.adjustSymbol('EURUSDm', '', 'm'), 'EURUSDm', 'Does not duplicate suffix');
    assert.strictEqual(RiskEngine.adjustSymbol('pro.EURUSD', 'pro.', ''), 'pro.EURUSD', 'Does not duplicate prefix');
    assert.strictEqual(RiskEngine.adjustSymbol('   ', 'pro.', 'm'), '', 'Blank symbol yields empty');

    const baseLotSettings = {
      mode: 'custom_lot' as const,
      customType: 'multiplier' as const,
      fixedLot: 0.1,
      multiplier: 1.0,
      riskPercent: 1.0,
      maxLotCap: 50,
      minLotClamp: 0.01,
      maxDrawdownProtectionPercent: 20,
      copyPendingOrders: true,
      syncSlTp: true,
      slippageMaxPips: 3,
      symbolPrefix: '',
      symbolSuffix: 'm',
    };

    // Multiplier === 1.0 must calculate 0.35 * 1.0 = 0.35
    const multOne = RiskEngine.calculateChildLots({
      parentSymbol: 'EURUSD',
      parentLots: 0.35,
      lotSettings: baseLotSettings,
    });
    assert.strictEqual(multOne.valid, true);
    assert.strictEqual(multOne.childLots, 0.35);
    assert.strictEqual(multOne.childSymbol, 'EURUSDm');

    // Multiplier === 0.5
    const multHalf = RiskEngine.calculateChildLots({
      parentSymbol: 'USDJPY',
      parentLots: 0.4,
      lotSettings: { ...baseLotSettings, multiplier: 0.5 },
    });
    assert.strictEqual(multHalf.valid, true);
    assert.strictEqual(multHalf.childLots, 0.2);

    // Fixed lot
    const fixedRes = RiskEngine.calculateChildLots({
      parentSymbol: 'EURUSD',
      parentLots: 1.5,
      lotSettings: { ...baseLotSettings, customType: 'fixed', fixedLot: 0.25 },
    });
    assert.strictEqual(fixedRes.valid, true);
    assert.strictEqual(fixedRes.childLots, 0.25);

    // Equity ratio uses true balance/equity
    const eqRes = RiskEngine.calculateChildLots({
      parentSymbol: 'EURUSD',
      parentLots: 1.0,
      parentEquity: 50000,
      childEquity: 10000,
      lotSettings: { ...baseLotSettings, customType: 'equity_ratio' },
    });
    assert.strictEqual(eqRes.valid, true);
    assert.strictEqual(eqRes.childLots, 0.2);

    // Risk percent uses real childBalance
    const riskRes = RiskEngine.calculateChildLots({
      parentSymbol: 'EURUSD',
      parentLots: 1.0,
      childBalance: 20000,
      childEquity: 20000,
      lotSettings: { ...baseLotSettings, customType: 'risk_percent', riskPercent: 2.0 },
    });
    assert.strictEqual(riskRes.valid, true);
    assert.strictEqual(riskRes.childLots, 0.4); // (20000 * 0.02) / 1000 = 0.4

    // Drawdown guard triggers when child drawdown >= maxDrawdownProtectionPercent
    const ddBlocked = RiskEngine.calculateChildLots({
      parentSymbol: 'EURUSD',
      parentLots: 0.5,
      childBalance: 10000,
      childEquity: 7500, // 25% drawdown >= 20%
      lotSettings: baseLotSettings,
    });
    assert.strictEqual(ddBlocked.valid, false);
    assert.ok(ddBlocked.reason?.includes('Drawdown guard'));

    // Validation rejections
    assert.strictEqual(RiskEngine.validateLotSettings({ ...baseLotSettings, customType: 'fixed', fixedLot: 0 }).valid, false);
    assert.strictEqual(RiskEngine.validateLotSettings({ ...baseLotSettings, multiplier: 0 }).valid, false);
    assert.strictEqual(RiskEngine.validateLotSettings({ ...baseLotSettings, multiplier: 150 }).valid, false);
    assert.strictEqual(RiskEngine.validateLotSettings({ ...baseLotSettings, riskPercent: 120 }).valid, false);
    assert.strictEqual(RiskEngine.validateLotSettings({ ...baseLotSettings, minLotClamp: 1.0, maxLotCap: 0.5 }).valid, false);
    assert.strictEqual(RiskEngine.validateLotSettings({ ...baseLotSettings, maxDrawdownProtectionPercent: 100 }).valid, false);
    assert.strictEqual(RiskEngine.validateLotSettings({ ...baseLotSettings, symbolSuffix: 'invalid space' }).valid, false);
    assert.strictEqual(RiskEngine.validateLotSettings({ ...baseLotSettings, symbolPrefix: 'x'.repeat(17) }).valid, false);

    // Broker minLot > maxLotCap check
    const brokerIncompatible = RiskEngine.calculateChildLots({
      parentSymbol: 'EURUSD',
      parentLots: 0.5,
      lotSettings: { ...baseLotSettings, maxLotCap: 0.05 },
      brokerLimits: { minLot: 0.1, maxLot: 10, lotStep: 0.01 },
    });
    assert.strictEqual(brokerIncompatible.valid, false);
    console.log('✓ PASS: RiskEngine validation, sizing, equity_ratio, drawdown guard, and case-sensitive affixes verified.');
  }

  // -----------------------------------------------------------------------
  // 2. Account Registration Priority 1 Fixes
  // -----------------------------------------------------------------------
  {
    console.log('[TEST 2] Account registration mentor/trader & schema checks...');
    const adminId = '11111111-1111-4111-a111-111111111111';
    const mentorId = '22222222-2222-4222-a222-222222222222';
    const suspendedMentorId = '33333333-3333-4333-a333-333333333333';
    const traderId = '44444444-4444-4444-a444-444444444444';

    const stateNoMentor: DbState = {
      profiles: [
        { id: adminId, email: 'admin@tradesync.io', role: 'admin', status: 'active' },
        { id: suspendedMentorId, email: 'susp-mentor@tradesync.io', role: 'mentor', status: 'suspended' },
        { id: traderId, email: 'trader@tradesync.io', role: 'trader', status: 'active' },
      ],
      mt5_accounts: [],
      mentor_assignments: [],
      bridge_instructions: [],
      trade_mappings: [],
      bridge_sync_logs: [],
    };

    const appNoMentor = createApiApp({
      serviceRoleKeyOverride: 'test-sr',
      serviceRoleClientOverride: createStage1MockSupabase(stateNoMentor) as any,
      authUserResolverOverride: async (t) =>
        t === 'jwt-admin' ? { user: { id: adminId, email: 'admin@tradesync.io' } } : { user: null },
    });

    const srvNoMentor = await startServer(appNoMentor);
    try {
      // Omitting userId when NO active mentor exists must NEVER fall back to admin!
      const resNoMentor = await jsonReq(`${srvNoMentor.baseUrl}/api/v1/admin/accounts/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
        body: JSON.stringify({
          accountRole: 'parent',
          brokerName: 'XM',
          brokerServer: 'XMGlobal-MT5 7',
          accountNumber: '88001100',
        }),
      });
      assert.strictEqual(resNoMentor.status, 400);
      assert.strictEqual(resNoMentor.json.code, 'NO_ACTIVE_MENTOR');
      assert.strictEqual(stateNoMentor.mt5_accounts.length, 0);

      // Explicitly passing admin userId for parent account must be rejected (400 INVALID_MENTOR_ROLE)
      const resAdminAsMentor = await jsonReq(`${srvNoMentor.baseUrl}/api/v1/admin/accounts/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
        body: JSON.stringify({
          accountRole: 'parent',
          brokerName: 'XM',
          brokerServer: 'XMGlobal-MT5 7',
          accountNumber: '88001101',
          userId: adminId,
        }),
      });
      assert.strictEqual(resAdminAsMentor.status, 400);
      assert.strictEqual(resAdminAsMentor.json.code, 'INVALID_MENTOR_ROLE');

      // Passing trader userId for parent account must be rejected
      const resTraderAsMentor = await jsonReq(`${srvNoMentor.baseUrl}/api/v1/admin/accounts/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
        body: JSON.stringify({
          accountRole: 'parent',
          brokerName: 'XM',
          brokerServer: 'XMGlobal-MT5 7',
          accountNumber: '88001102',
          userId: traderId,
        }),
      });
      assert.strictEqual(resTraderAsMentor.status, 400);
      assert.strictEqual(resTraderAsMentor.json.code, 'INVALID_MENTOR_ROLE');

      // Passing suspended mentor userId must be rejected (403 TARGET_USER_INACTIVE)
      const resSuspMentor = await jsonReq(`${srvNoMentor.baseUrl}/api/v1/admin/accounts/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
        body: JSON.stringify({
          accountRole: 'parent',
          brokerName: 'XM',
          brokerServer: 'XMGlobal-MT5 7',
          accountNumber: '88001103',
          userId: suspendedMentorId,
        }),
      });
      assert.strictEqual(resSuspMentor.status, 403);
      assert.strictEqual(resSuspMentor.json.code, 'TARGET_USER_INACTIVE');
    } finally {
      await srvNoMentor.close();
    }

    // Active mentor present + child registration writing lot_mode & assigned_parent_id
    const stateValid: DbState = {
      profiles: [
        { id: adminId, email: 'admin@tradesync.io', role: 'admin', status: 'active' },
        { id: mentorId, email: 'mentor@tradesync.io', role: 'mentor', status: 'active' },
        { id: traderId, email: 'trader@tradesync.io', role: 'trader', status: 'active' },
      ],
      mt5_accounts: [],
      mentor_assignments: [],
      bridge_instructions: [],
      trade_mappings: [],
      bridge_sync_logs: [],
    };

    const appValid = createApiApp({
      serviceRoleKeyOverride: 'test-sr',
      serviceRoleClientOverride: createStage1MockSupabase(stateValid) as any,
      authUserResolverOverride: async (t) =>
        t === 'jwt-admin' ? { user: { id: adminId, email: 'admin@tradesync.io' } } : { user: null },
    });

    const srvValid = await startServer(appValid);
    let registeredParentId = '';
    try {
      const regParent = await jsonReq(`${srvValid.baseUrl}/api/v1/admin/accounts/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
        body: JSON.stringify({
          accountRole: 'parent',
          brokerName: 'XM',
          brokerServer: 'XMGlobal-MT5 7',
          accountNumber: '55110001',
          userId: mentorId,
          balance: 50000,
          equity: 50000,
        }),
      });
      assert.strictEqual(regParent.status, 200);
      assert.strictEqual(regParent.json.account.userId, mentorId);
      registeredParentId = regParent.json.account.id;

      // Register child with copyMode: 'fixed_lot' -> persisted as lot_mode: 'fixed'
      const regChild = await jsonReq(`${srvValid.baseUrl}/api/v1/admin/accounts/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
        body: JSON.stringify({
          accountRole: 'child',
          brokerName: 'XM',
          brokerServer: 'XMGlobal-MT5 7',
          accountNumber: '55110002',
          userId: traderId,
          parentAccountId: registeredParentId,
          balance: 10000,
          equity: 10000,
          lotSettings: {
            copyMode: 'fixed_lot',
            fixedLot: 0.25,
            multiplier: 1.0,
          },
        }),
      });
      assert.strictEqual(regChild.status, 200);
      assert.strictEqual(stateValid.mt5_accounts.length, 2);
      const childRow = stateValid.mt5_accounts.find((a) => a.account_number === '55110002')!;
      assert.strictEqual(childRow.assigned_parent_id, registeredParentId);

      assert.strictEqual(stateValid.mentor_assignments.length, 1);
      const assignRow = stateValid.mentor_assignments[0];
      assert.strictEqual(assignRow.lot_mode, 'fixed', 'Must persist lot_mode (not lot_copy_mode)');
      assert.strictEqual('lot_copy_mode' in assignRow, false, 'Must NOT write non-existent lot_copy_mode column');
      assert.strictEqual(assignRow.fixed_lot, 0.25);
      assert.strictEqual(assignRow.mentor_id, mentorId);
      assert.strictEqual(assignRow.trader_id, traderId);
    } finally {
      await srvValid.close();
    }

    // Rollback on mentor_assignments error
    const stateFailAssign: DbState = {
      profiles: [...stateValid.profiles],
      mt5_accounts: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
          user_id: mentorId,
          account_role: 'parent',
          account_number: '55110001',
          broker_server: 'XMGlobal-MT5 7',
          account_type: 'demo',
        },
      ],
      mentor_assignments: [],
      bridge_instructions: [],
      trade_mappings: [],
      bridge_sync_logs: [],
    };
    const appFailAssign = createApiApp({
      serviceRoleKeyOverride: 'test-sr',
      serviceRoleClientOverride: createStage1MockSupabase(stateFailAssign, { failMentorAssignmentsUpsert: true }) as any,
      authUserResolverOverride: async (t) =>
        t === 'jwt-admin' ? { user: { id: adminId, email: 'admin@tradesync.io' } } : { user: null },
    });
    const srvFail = await startServer(appFailAssign);
    try {
      const failRes = await jsonReq(`${srvFail.baseUrl}/api/v1/admin/accounts/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
        body: JSON.stringify({
          accountRole: 'child',
          brokerName: 'XM',
          brokerServer: 'XMGlobal-MT5 7',
          accountNumber: '55119999',
          userId: traderId,
          parentAccountId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
          lotSettings: { copyMode: 'multiplier', multiplier: 1.0 },
        }),
      });
      assert.strictEqual(failRes.status, 422);
      assert.strictEqual(failRes.json.code, 'MENTOR_ASSIGNMENT_FAILED');
      assert.strictEqual(
        stateFailAssign.mt5_accounts.some((a) => a.account_number === '55119999'),
        false,
        'Newly inserted child account must be rolled back when assignment fails'
      );
    } finally {
      await srvFail.close();
    }

    console.log('✓ PASS: Parent mentor validation, lot_mode column fix, assigned_parent_id & assignment rollback verified.');
  }

  // -----------------------------------------------------------------------
  // 3. Trade-Open Routing for All lot_mode Values & multiplier === 1.0
  // -----------------------------------------------------------------------
  {
    console.log('[TEST 3] Trade-open lot_mode routing (fixed, fixed_lot, multiplier=1.0, equity_ratio, drawdown)...');
    const mentorId = '10000000-0000-4000-a000-000000000001';
    const traderFixed = '20000000-0000-4000-a000-000000000001';
    const traderFixedAlias = '20000000-0000-4000-a000-000000000002';
    const traderMultOne = '20000000-0000-4000-a000-000000000003';
    const traderEqRatio = '20000000-0000-4000-a000-000000000004';
    const traderDrawdown = '20000000-0000-4000-a000-000000000005';

    const parentAccId = 'aaaaaaaa-0000-4000-a000-000000000001';
    const cFixed = 'bbbbbbbb-0000-4000-a000-000000000001';
    const cFixedAlias = 'bbbbbbbb-0000-4000-a000-000000000002';
    const cMultOne = 'bbbbbbbb-0000-4000-a000-000000000003';
    const cEqRatio = 'bbbbbbbb-0000-4000-a000-000000000004';
    const cDrawdown = 'bbbbbbbb-0000-4000-a000-000000000005';

    const parentToken = 'ts_parent_lot_modes_test';
    const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

    const dbState: DbState = {
      profiles: [
        { id: mentorId, email: 'm@t.io', role: 'mentor', status: 'active' },
        { id: traderFixed, email: 't1@t.io', role: 'trader', status: 'active' },
        { id: traderFixedAlias, email: 't2@t.io', role: 'trader', status: 'active' },
        { id: traderMultOne, email: 't3@t.io', role: 'trader', status: 'active' },
        { id: traderEqRatio, email: 't4@t.io', role: 'trader', status: 'active' },
        { id: traderDrawdown, email: 't5@t.io', role: 'trader', status: 'active' },
      ],
      mt5_accounts: [
        {
          id: parentAccId,
          user_id: mentorId,
          account_role: 'parent',
          account_number: '70001',
          broker_server: 'XMGlobal-MT5',
          account_type: 'demo',
          balance: 50000,
          equity: 50000,
          terminal_token_hash: hash(parentToken),
        },
        { id: cFixed, user_id: traderFixed, account_role: 'child', account_number: '80001', balance: 10000, equity: 10000 },
        { id: cFixedAlias, user_id: traderFixedAlias, account_role: 'child', account_number: '80002', balance: 10000, equity: 10000 },
        { id: cMultOne, user_id: traderMultOne, account_role: 'child', account_number: '80003', balance: 10000, equity: 10000 },
        { id: cEqRatio, user_id: traderEqRatio, account_role: 'child', account_number: '80004', balance: 10000, equity: 10000 },
        { id: cDrawdown, user_id: traderDrawdown, account_role: 'child', account_number: '80005', balance: 10000, equity: 7000 }, // 30% DD > 20%
      ],
      mentor_assignments: [
        { id: '1', mentor_id: mentorId, trader_id: traderFixed, parent_account_id: parentAccId, child_account_id: cFixed, status: 'active', lot_mode: 'fixed', lot_multiplier: 1.0, fixed_lot: 0.07 },
        { id: '2', mentor_id: mentorId, trader_id: traderFixedAlias, parent_account_id: parentAccId, child_account_id: cFixedAlias, status: 'active', lot_mode: 'fixed_lot', lot_multiplier: 1.0, fixed_lot: 0.13 },
        { id: '3', mentor_id: mentorId, trader_id: traderMultOne, parent_account_id: parentAccId, child_account_id: cMultOne, status: 'active', lot_mode: 'multiplier', lot_multiplier: 1.0, fixed_lot: 0.5 },
        { id: '4', mentor_id: mentorId, trader_id: traderEqRatio, parent_account_id: parentAccId, child_account_id: cEqRatio, status: 'active', lot_mode: 'equity_ratio', lot_multiplier: 1.0, fixed_lot: 0.1 },
        { id: '5', mentor_id: mentorId, trader_id: traderDrawdown, parent_account_id: parentAccId, child_account_id: cDrawdown, status: 'active', lot_mode: 'parent_lot', lot_multiplier: 1.0, fixed_lot: 0.1 },
      ],
      bridge_instructions: [],
      trade_mappings: [],
      bridge_sync_logs: [],
    };

    const app = createApiApp({
      serviceRoleKeyOverride: 'test-sr',
      serviceRoleClientOverride: createStage1MockSupabase(dbState) as any,
    });
    const srv = await startServer(app);
    try {
      const openRes = await jsonReq(`${srv.baseUrl}/api/v1/bridge/events/trade-open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken },
        body: JSON.stringify({ ticket: '445566', symbol: 'EURUSD', type: 'BUY', lots: 0.5, openPrice: 1.09 }),
      });
      assert.strictEqual(openRes.status, 200);
      // 4 queued (cDrawdown skipped due to 30% DD guard!)
      assert.strictEqual(openRes.json.childInstructionsQueued, 4);

      const byChild = new Map<string, any>(dbState.bridge_instructions.map((i) => [i.child_account_id, i]));
      assert.strictEqual(byChild.get(cFixed).lots, 0.07, 'lot_mode=fixed uses fixed_lot 0.07');
      assert.strictEqual(byChild.get(cFixedAlias).lots, 0.13, 'lot_mode=fixed_lot uses fixed_lot 0.13');
      assert.strictEqual(byChild.get(cMultOne).lots, 0.5, 'lot_mode=multiplier with 1.0 calculates 0.5 * 1.0 (not fallback to fixed_lot)');
      assert.strictEqual(byChild.get(cEqRatio).lots, 0.1, 'lot_mode=equity_ratio scales 0.5 * (10000/50000) = 0.1');
      assert.strictEqual(byChild.has(cDrawdown), false, 'Real DB child equity/balance drawdown guard blocks excessive drawdown child');
    } finally {
      await srv.close();
    }

    console.log('✓ PASS: Trade-open routing & real DB equity/drawdown integration verified.');
  }

  console.log('\nALL PHASE 2 STAGE 1 TESTS PASSED SUCCESSFULLY!');
}

runStage1Tests().catch((err) => {
  console.error('❌ Phase 2 Stage 1 Tests Failed:', err);
  process.exit(1);
});
