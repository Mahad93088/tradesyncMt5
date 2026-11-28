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
  subscription_plans: Record<string, any>[];
  subscriptions: Record<string, any>[];
}

const ACCEPTED_LOT_MODES = new Set([
  'parent_lot',
  'multiplier',
  'fixed',
  'fixed_lot',
  'equity_ratio',
  'risk_percent',
]);

/**
 * Simulates Migration 07 constraints, partial unique indexes, RLS policies,
 * FK ON DELETE SET NULL referential action, and validate_mentor_assignment() trigger.
 */
function applyMigration07ConstraintsAndTrigger(
  state: DbState,
  op: 'INSERT' | 'UPDATE',
  oldRow: Record<string, any> | null,
  newRow: Record<string, any>,
  callerContext: { role: 'service_role' | 'authenticated'; authUid?: string | null },
  options: { isFkCleanup?: boolean } = {}
): Record<string, any> {
  const row: Record<string, any> = {
    lot_mode: 'parent_lot',
    lot_multiplier: 1.0,
    fixed_lot: 0.1,
    status: 'active',
    assigned_at: new Date().toISOString(),
    ...newRow,
  };

  const callerProfile = callerContext.authUid
    ? state.profiles.find((p) => p.id === callerContext.authUid)
    : null;
  const isAdmin =
    callerContext.role === 'authenticated' &&
    callerProfile?.role === 'admin' &&
    callerProfile?.status === 'active';
  const isPrivileged = callerContext.role === 'service_role' || isAdmin;

  // 1. FK ON DELETE SET NULL cleanup path
  if (op === 'UPDATE' && options.isFkCleanup && oldRow) {
    const parentDeleted =
      oldRow.parent_account_id != null &&
      row.parent_account_id == null &&
      !state.mt5_accounts.some((a) => a.id === oldRow.parent_account_id);
    const childDeleted =
      oldRow.child_account_id != null &&
      row.child_account_id == null &&
      !state.mt5_accounts.some((a) => a.id === oldRow.child_account_id);

    if (
      (parentDeleted || childDeleted) &&
      row.mentor_id === oldRow.mentor_id &&
      row.trader_id === oldRow.trader_id &&
      row.assigned_at === oldRow.assigned_at &&
      row.lot_mode === oldRow.lot_mode &&
      row.lot_multiplier === oldRow.lot_multiplier &&
      row.fixed_lot === oldRow.fixed_lot
    ) {
      row.status = 'inactive';
      return row;
    }
  }

  // Simulated RLS policy checks for authenticated callers (independent of trigger)
  if (callerContext.role === 'authenticated') {
    if (!callerContext.authUid || !callerProfile) {
      throw new Error('RLS error: Authenticated session required');
    }
    if (row.status === 'active' && (!row.parent_account_id || !row.child_account_id)) {
      throw new Error('RLS error: Active assignment requires both parent_account_id and child_account_id');
    }
    if (row.parent_account_id && row.child_account_id && row.parent_account_id === row.child_account_id) {
      throw new Error('RLS error: parent_account_id cannot equal child_account_id');
    }
    if (row.mentor_id === row.trader_id) {
      throw new Error('RLS error: mentor_id cannot equal trader_id');
    }
    if (!isAdmin) {
      if (op === 'INSERT') {
        if (row.trader_id !== callerContext.authUid || callerProfile.role !== 'trader' || callerProfile.status !== 'active') {
          throw new Error('RLS INSERT denied: Caller must be active trader owning trader_id');
        }
        const mentorVisible = state.profiles.find(
          (p) => p.id === row.mentor_id && p.role === 'mentor' && p.status === 'active'
        );
        if (!mentorVisible) {
          throw new Error('RLS INSERT denied: Target mentor not active in mentor_directory');
        }
        if (row.child_account_id != null) {
          const ownChild = state.mt5_accounts.find(
            (a) =>
              a.id === row.child_account_id &&
              a.user_id === callerContext.authUid &&
              a.account_role === 'child' &&
              a.account_type === 'demo'
          );
          if (!ownChild) {
            throw new Error('RLS INSERT denied: child_account_id must be owned Demo child account');
          }
        }
      } else if (op === 'UPDATE' && oldRow) {
        if (
          callerProfile.status !== 'active' ||
          (oldRow.mentor_id !== callerContext.authUid && oldRow.trader_id !== callerContext.authUid) ||
          (row.mentor_id !== callerContext.authUid && row.trader_id !== callerContext.authUid)
        ) {
          throw new Error('RLS UPDATE denied: Caller must be active party');
        }
      }
    }
  }

  // 2. Trigger: Active assignments & reactivations require complete pairing
  if (row.status === 'active' && (!row.parent_account_id || !row.child_account_id)) {
    throw new Error('Security error: Active mentor assignments require both parent_account_id and child_account_id.');
  }

  // 3. Anti-self-assignment checks
  if (row.mentor_id === row.trader_id) {
    throw new Error('Security error: A user cannot assign themselves as their own mentor.');
  }
  if (row.parent_account_id && row.child_account_id && row.parent_account_id === row.child_account_id) {
    throw new Error('Security error: An MT5 account cannot be assigned as its own parent copy master.');
  }

  // 4. Profile verification (allows deactivation to 'inactive' on suspended users)
  const mentorProf = state.profiles.find((p) => p.id === row.mentor_id);
  if (!mentorProf || mentorProf.role !== 'mentor') {
    throw new Error('Security error: Target mentor_id is not a verified mentor profile.');
  }
  if ((op === 'INSERT' || row.status === 'active') && mentorProf.status !== 'active') {
    throw new Error('Security error: Target mentor_id is not a verified active mentor.');
  }

  const traderProf = state.profiles.find((p) => p.id === row.trader_id);
  if (!traderProf || traderProf.role !== 'trader') {
    throw new Error('Security error: Target trader_id is not a valid trader profile.');
  }
  if ((op === 'INSERT' || row.status === 'active') && traderProf.status !== 'active') {
    throw new Error('Security error: Trader account must be active to create or activate an assignment.');
  }

  // 5. Account existence, role parity, Demo-only, ownership
  if (row.parent_account_id != null) {
    const pAcc = state.mt5_accounts.find((a) => a.id === row.parent_account_id);
    if (!pAcc) throw new Error('Security error: Parent MT5 account does not exist.');
    if (pAcc.account_role !== 'parent') throw new Error('Security error: Parent account must have account_role = parent.');
    if (pAcc.account_type !== 'demo') throw new Error('Security error: Only Demo MT5 parent accounts may be assigned.');
    if (pAcc.user_id !== row.mentor_id) throw new Error('Security error: Parent MT5 account is not owned by mentor_id.');
  }

  if (row.child_account_id != null) {
    const cAcc = state.mt5_accounts.find((a) => a.id === row.child_account_id);
    if (!cAcc) throw new Error('Security error: Child MT5 account does not exist.');
    if (cAcc.account_role !== 'child') throw new Error('Security error: Child account must have account_role = child.');
    if (cAcc.account_type !== 'demo') throw new Error('Security error: Only Demo MT5 child accounts may be assigned.');
    if (cAcc.user_id !== row.trader_id) throw new Error('Security error: Child MT5 account is not owned by trader_id.');
  }

  // 6. Lot configuration validation
  if (!row.lot_mode || !ACCEPTED_LOT_MODES.has(row.lot_mode)) {
    throw new Error(`Validation error: Invalid lot_mode (${row.lot_mode}).`);
  }
  if (typeof row.lot_multiplier !== 'number' || row.lot_multiplier <= 0 || row.lot_multiplier > 100) {
    throw new Error('Validation error: lot_multiplier must be > 0 and <= 100.');
  }
  if (typeof row.fixed_lot !== 'number' || row.fixed_lot < 0.01 || row.fixed_lot > 100) {
    throw new Error('Validation error: fixed_lot must be between 0.01 and 100.');
  }

  // 7. Non-privileged anti-hijack & mentor tamper checks
  if (!isPrivileged) {
    if (op === 'INSERT') {
      if (row.trader_id !== callerContext.authUid) {
        throw new Error('Security error: Users can only create assignments for their own trader profile.');
      }
    } else if (op === 'UPDATE' && oldRow) {
      if (callerContext.authUid !== oldRow.mentor_id && callerContext.authUid !== oldRow.trader_id) {
        throw new Error('Security error: Caller is not a party to this mentor assignment.');
      }
      if (
        oldRow.mentor_id !== row.mentor_id ||
        oldRow.trader_id !== row.trader_id ||
        oldRow.assigned_at !== row.assigned_at
      ) {
        throw new Error('Security error: Assignment ownership and creation timestamp cannot be transferred.');
      }
      if (callerContext.authUid === oldRow.mentor_id && callerContext.authUid !== oldRow.trader_id) {
        if (
          row.lot_mode !== oldRow.lot_mode ||
          row.lot_multiplier !== oldRow.lot_multiplier ||
          row.fixed_lot !== oldRow.fixed_lot ||
          row.parent_account_id !== oldRow.parent_account_id ||
          row.child_account_id !== oldRow.child_account_id
        ) {
          throw new Error('Security error: Only the assigned trader or an administrator may modify lot sizing or account pairing.');
        }
      }
    }
  }

  // 8. Partial unique indexes & UNIQUE(mentor_id, trader_id)
  const otherRows = state.mentor_assignments.filter((r) => r.id !== row.id);
  if (otherRows.some((r) => r.mentor_id === row.mentor_id && r.trader_id === row.trader_id)) {
    throw new Error('Unique violation: mentor_assignments_mentor_id_trader_id_key');
  }
  if (
    row.status === 'active' &&
    row.child_account_id != null &&
    otherRows.some((r) => r.status === 'active' && r.child_account_id === row.child_account_id)
  ) {
    throw new Error('Unique violation: idx_mentor_assignments_active_child_unique');
  }
  if (
    row.status === 'active' &&
    row.parent_account_id != null &&
    row.child_account_id != null &&
    otherRows.some(
      (r) =>
        r.status === 'active' &&
        r.parent_account_id === row.parent_account_id &&
        r.child_account_id === row.child_account_id
    )
  ) {
    throw new Error('Unique violation: idx_mentor_assignments_active_pair_unique');
  }

  return row;
}

function createMigration07MockSupabase(state: DbState) {
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
            return eqMatch ? String(row[eqMatch[1]]) === eqMatch[2] : false;
          });
        }
        return true;
      })
    );

  return {
    from(tableName: keyof DbState) {
      const filters: Array<{ op: string; col?: string; val?: any; expr?: string }> = [];
      let mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
      let payload: any = null;
      let upsertOnConflict: string | null = null;
      let limitNum: number | null = null;

      const execute = async (): Promise<{ data: any; error: any }> => {
        const table = state[tableName];
        if (!table) return { data: null, error: { message: `Missing table ${String(tableName)}` } };

        try {
          if (mode === 'insert') {
            const items = Array.isArray(payload) ? payload : [payload];
            const inserted: any[] = [];
            for (const item of items) {
              let rec = { id: item.id || crypto.randomUUID(), created_at: new Date().toISOString(), ...item };
              if (tableName === 'mentor_assignments') {
                rec = applyMigration07ConstraintsAndTrigger(state, 'INSERT', null, rec, { role: 'service_role' });
              }
              table.push(rec);
              inserted.push({ ...rec });
            }
            return { data: inserted, error: null };
          }

          if (mode === 'upsert') {
            const items = Array.isArray(payload) ? payload : [payload];
            const conflictCols = upsertOnConflict ? upsertOnConflict.split(',').map((s) => s.trim()) : ['id'];
            const out: any[] = [];
            for (const item of items) {
              const existing = table.find((r) => conflictCols.every((c) => r[c] === item[c]));
              if (existing) {
                const candidate = { ...existing, ...item };
                const validated =
                  tableName === 'mentor_assignments'
                    ? applyMigration07ConstraintsAndTrigger(state, 'UPDATE', existing, candidate, { role: 'service_role' })
                    : candidate;
                Object.assign(existing, validated);
                out.push({ ...existing });
              } else {
                let rec = { id: item.id || crypto.randomUUID(), ...item };
                if (tableName === 'mentor_assignments') {
                  rec = applyMigration07ConstraintsAndTrigger(state, 'INSERT', null, rec, { role: 'service_role' });
                }
                table.push(rec);
                out.push({ ...rec });
              }
            }
            return { data: out, error: null };
          }

          if (mode === 'update') {
            const matched = applyFilters(table, filters);
            const updated: any[] = [];
            for (const row of matched) {
              const candidate = { ...row, ...payload };
              const validated =
                tableName === 'mentor_assignments'
                  ? applyMigration07ConstraintsAndTrigger(state, 'UPDATE', row, candidate, { role: 'service_role' })
                  : candidate;
              Object.assign(row, validated);
              updated.push({ ...row });
            }
            return { data: updated, error: null };
          }

          if (mode === 'delete') {
            const matched = applyFilters(table, filters);
            const matchedSet = new Set(matched);
            const kept = table.filter((r) => !matchedSet.has(r));
            table.length = 0;
            table.push(...kept);

            // Simulate FK ON DELETE SET NULL from mt5_accounts -> mentor_assignments
            if (tableName === 'mt5_accounts') {
              const deletedIds = new Set(matched.map((m) => m.id));
              for (const assignRow of state.mentor_assignments) {
                if (
                  deletedIds.has(assignRow.parent_account_id) ||
                  deletedIds.has(assignRow.child_account_id)
                ) {
                  const candidate = {
                    ...assignRow,
                    parent_account_id: deletedIds.has(assignRow.parent_account_id)
                      ? null
                      : assignRow.parent_account_id,
                    child_account_id: deletedIds.has(assignRow.child_account_id)
                      ? null
                      : assignRow.child_account_id,
                  };
                  const cleaned = applyMigration07ConstraintsAndTrigger(
                    state,
                    'UPDATE',
                    assignRow,
                    candidate,
                    { role: 'service_role' },
                    { isFkCleanup: true }
                  );
                  Object.assign(assignRow, cleaned);
                }
              }
            }
            return { data: matched.map((r) => ({ ...r })), error: null };
          }

          let matched = applyFilters(table, filters);
          if (limitNum !== null) matched = matched.slice(0, limitNum);
          return { data: matched.map((r) => ({ ...r })), error: null };
        } catch (err: any) {
          return { data: null, error: { message: err.message } };
        }
      };

      const builder: any = {
        select() {
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
        order() {
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
  console.log('--- Running Migration 07 Mentor Assignments Security & Integrity Tests ---');

  const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
  const mig06 = read('supabase/migrations/06_harden_mt5_accounts_rls.sql');
  const mig07 = read('supabase/migrations/07_add_mentor_assignments_account_columns.sql');

  // -------------------------------------------------------------------------
  // 1. Static SQL Audit on Migration 07 & Compatibility with Migration 06
  // -------------------------------------------------------------------------
  assert.strictEqual(mig07.includes('```'), false, 'Migration 07 must not contain stray markdown backticks');
  assert.strictEqual(mig06.includes('```'), false, 'Migration 06 must not contain stray markdown backticks');
  assert.strictEqual(mig06.includes('assigned_parent_id'), false, 'Migration 06 must stay free of assigned_parent_id');
  assert.strictEqual(mig06.includes('SECURITY INVOKER'), true, 'Migration 06 trigger must stay SECURITY INVOKER');
  assert.strictEqual(
    /ALTER\s+TABLE\s+public\.mt5_accounts/i.test(mig07),
    false,
    'Migration 07 must never alter public.mt5_accounts'
  );
  assert.strictEqual(mig07.includes('ON DELETE SET NULL'), true);
  assert.strictEqual(mig07.includes("NEW.status := 'inactive'"), true, 'FK cleanup must safely deactivate assignment');
  assert.strictEqual(
    mig07.includes("IF NOT v_is_fk_cleanup AND NEW.status = 'active' THEN"),
    true,
    'Trigger must require complete account pairing for active assignments'
  );
  assert.strictEqual(
    mig07.includes("CHECK (lot_mode IN ('parent_lot', 'multiplier', 'fixed', 'fixed_lot', 'equity_ratio', 'risk_percent'))"),
    true,
    'All 6 lot_mode values must be permitted in check constraint'
  );
  assert.strictEqual(
    mig07.includes('REVOKE ALL ON FUNCTION public.validate_mentor_assignment() FROM PUBLIC, anon, authenticated;'),
    true
  );
  assert.strictEqual(
    mig07.includes('GRANT EXECUTE ON FUNCTION public.validate_mentor_assignment() TO postgres, service_role;'),
    true
  );
  assert.strictEqual(
    mig07.includes('REVOKE ALL ON TABLE public.mentor_assignments FROM PUBLIC, anon, authenticated;'),
    true
  );
  assert.strictEqual(
    mig07.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mentor_assignments TO authenticated;'),
    true
  );
  assert.strictEqual(
    mig07.includes('GRANT ALL ON TABLE public.mentor_assignments TO postgres, service_role;'),
    true
  );
  assert.strictEqual(mig07.includes('FROM public.mentor_directory md'), true, 'INSERT RLS must use safe mentor_directory view');
  assert.strictEqual(
    /current_user\s+(?:IN|=|IS)/i.test(mig07),
    false,
    'SECURITY DEFINER trigger must never check current_user for privileges'
  );
  console.log('[PASS] 1. Migration 07 static SQL, grants, RLS policies, and Migration 06 compatibility verified.');

  // -------------------------------------------------------------------------
  // 2. DB Trigger, Constraints, Partial Unique Indexes & RLS Behavior Tests
  // -------------------------------------------------------------------------
  const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const mentorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const mentor2Id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02';
  const traderId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const trader2Id = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
  const parentAccId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const parent2AccId = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02';
  const childAccId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const child2AccId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02';
  const liveChildAccId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee99';

  const historicalInactiveId = 'ffffffff-ffff-4fff-8fff-ffffffffff01';

  const state: DbState = {
    profiles: [
      { id: adminId, email: 'admin@tradesync.test', full_name: 'Admin', role: 'admin', status: 'active' },
      { id: mentorId, email: 'mentor1@tradesync.test', full_name: 'Mentor One', role: 'mentor', status: 'active' },
      { id: mentor2Id, email: 'mentor2@tradesync.test', full_name: 'Mentor Two', role: 'mentor', status: 'active' },
      { id: traderId, email: 'trader1@tradesync.test', full_name: 'Trader One', role: 'trader', status: 'active' },
      { id: trader2Id, email: 'trader2@tradesync.test', full_name: 'Trader Two', role: 'trader', status: 'active' },
    ],
    mt5_accounts: [
      { id: parentAccId, user_id: mentorId, account_role: 'parent', account_type: 'demo', account_number: '1001' },
      { id: parent2AccId, user_id: mentor2Id, account_role: 'parent', account_type: 'demo', account_number: '1002' },
      { id: childAccId, user_id: traderId, account_role: 'child', account_type: 'demo', account_number: '2001' },
      { id: child2AccId, user_id: trader2Id, account_role: 'child', account_type: 'demo', account_number: '2002' },
      { id: liveChildAccId, user_id: traderId, account_role: 'child', account_type: 'live', account_number: '9999' },
    ],
    mentor_assignments: [
      // Pre-existing historical inactive record (missing parent_account_id & child_account_id)
      {
        id: historicalInactiveId,
        mentor_id: mentor2Id,
        trader_id: trader2Id,
        parent_account_id: null,
        child_account_id: null,
        status: 'inactive',
        lot_mode: 'parent_lot',
        lot_multiplier: 1.0,
        fixed_lot: 0.1,
        assigned_at: '2025-01-01T00:00:00.000Z',
      },
    ],
    bridge_instructions: [],
    trade_mappings: [],
    bridge_sync_logs: [],
    trades: [],
    subscription_plans: [
      { id: 'plan-silver', code: 'silver', name: 'Silver', max_followers: 50, max_child_accounts: 50, is_active: true },
    ],
    subscriptions: [
      {
        id: crypto.randomUUID(),
        mentor_id: mentorId,
        plan_id: 'plan-silver',
        status: 'active',
        current_period_end: new Date(Date.now() + 86400_000).toISOString(),
        created_at: new Date().toISOString(),
      },
    ],
  };

  // (a) Active assignment missing parent_account_id or child_account_id MUST fail
  assert.throws(() =>
    applyMigration07ConstraintsAndTrigger(
      state,
      'INSERT',
      null,
      {
        id: crypto.randomUUID(),
        mentor_id: mentorId,
        trader_id: traderId,
        parent_account_id: null,
        child_account_id: childAccId,
        status: 'active',
      },
      { role: 'authenticated', authUid: traderId }
    )
  );
  assert.throws(() =>
    applyMigration07ConstraintsAndTrigger(
      state,
      'INSERT',
      null,
      {
        id: crypto.randomUUID(),
        mentor_id: mentorId,
        trader_id: traderId,
        parent_account_id: parentAccId,
        child_account_id: null,
        status: 'active',
      },
      { role: 'service_role' }
    )
  );

  // (b) Historical inactive record preserved; updating lot_mode while remaining inactive succeeds
  const histRow = state.mentor_assignments[0];
  const updatedHist = applyMigration07ConstraintsAndTrigger(
    state,
    'UPDATE',
    histRow,
    { ...histRow, lot_mode: 'equity_ratio' },
    { role: 'authenticated', authUid: trader2Id }
  );
  assert.strictEqual(updatedHist.status, 'inactive');
  assert.strictEqual(updatedHist.parent_account_id, null);

  // (c) Reactivating inactive historical row WITHOUT both account IDs MUST fail
  assert.throws(() =>
    applyMigration07ConstraintsAndTrigger(
      state,
      'UPDATE',
      histRow,
      { ...histRow, status: 'active' },
      { role: 'authenticated', authUid: adminId }
    )
  );
  assert.throws(() =>
    applyMigration07ConstraintsAndTrigger(
      state,
      'UPDATE',
      histRow,
      { ...histRow, parent_account_id: parent2AccId, status: 'active' },
      { role: 'service_role' }
    )
  );

  // Reactivating WITH both valid Demo accounts succeeds
  const reactivatedHist = applyMigration07ConstraintsAndTrigger(
    state,
    'UPDATE',
    histRow,
    { ...histRow, parent_account_id: parent2AccId, child_account_id: child2AccId, status: 'active' },
    { role: 'authenticated', authUid: trader2Id }
  );
  Object.assign(histRow, reactivatedHist);
  assert.strictEqual(histRow.status, 'active');

  // (d) Duplicate active child & duplicate (parent_account_id, child_account_id) prevented
  assert.throws(
    () =>
      applyMigration07ConstraintsAndTrigger(
        state,
        'INSERT',
        null,
        {
          id: crypto.randomUUID(),
          mentor_id: mentorId,
          trader_id: trader2Id,
          parent_account_id: parentAccId,
          child_account_id: child2AccId, // already active in histRow!
          status: 'active',
        },
        { role: 'service_role' }
      ),
    /idx_mentor_assignments_active_child_unique/
  );

  // (e) Role, ownership, Demo-only, all 6 lot modes & bounds
  assert.throws(() =>
    applyMigration07ConstraintsAndTrigger(
      state,
      'INSERT',
      null,
      {
        id: crypto.randomUUID(),
        mentor_id: mentorId,
        trader_id: traderId,
        parent_account_id: parentAccId,
        child_account_id: liveChildAccId,
        status: 'active',
      },
      { role: 'service_role' }
    )
  );
  assert.throws(() =>
    applyMigration07ConstraintsAndTrigger(
      state,
      'INSERT',
      null,
      {
        id: crypto.randomUUID(),
        mentor_id: mentor2Id,
        trader_id: traderId,
        parent_account_id: parentAccId, // belongs to mentorId
        child_account_id: childAccId,
        status: 'active',
      },
      { role: 'service_role' }
    )
  );
  assert.throws(() =>
    applyMigration07ConstraintsAndTrigger(
      state,
      'INSERT',
      null,
      {
        id: crypto.randomUUID(),
        mentor_id: mentorId,
        trader_id: traderId,
        parent_account_id: parentAccId,
        child_account_id: childAccId,
        lot_mode: 'risk_percent',
        lot_multiplier: 101, // > 100 invalid
        fixed_lot: 0.1,
        status: 'active',
      },
      { role: 'service_role' }
    )
  );

  for (const mode of ['parent_lot', 'multiplier', 'fixed', 'fixed_lot', 'equity_ratio', 'risk_percent']) {
    const valid = applyMigration07ConstraintsAndTrigger(
      state,
      'INSERT',
      null,
      {
        id: crypto.randomUUID(),
        mentor_id: mentorId,
        trader_id: traderId,
        parent_account_id: parentAccId,
        child_account_id: childAccId,
        lot_mode: mode,
        lot_multiplier: 1.5,
        fixed_lot: 0.25,
        status: 'active',
      },
      { role: 'authenticated', authUid: traderId }
    );
    assert.strictEqual(valid.lot_mode, mode);
  }

  // Mentor cannot tamper with follower lot settings on UPDATE, but CAN pause/resume status
  const activeAssign = applyMigration07ConstraintsAndTrigger(
    state,
    'INSERT',
    null,
    {
      id: crypto.randomUUID(),
      mentor_id: mentorId,
      trader_id: traderId,
      parent_account_id: parentAccId,
      child_account_id: childAccId,
      status: 'active',
    },
    { role: 'authenticated', authUid: traderId }
  );
  state.mentor_assignments.push(activeAssign);

  assert.throws(
    () =>
      applyMigration07ConstraintsAndTrigger(
        state,
        'UPDATE',
        activeAssign,
        { ...activeAssign, lot_multiplier: 5.0 },
        { role: 'authenticated', authUid: mentorId }
      ),
    /Only the assigned trader or an administrator/
  );
  const pausedByMentor = applyMigration07ConstraintsAndTrigger(
    state,
    'UPDATE',
    activeAssign,
    { ...activeAssign, status: 'inactive' },
    { role: 'authenticated', authUid: mentorId }
  );
  assert.strictEqual(pausedByMentor.status, 'inactive');

  // (f) ON DELETE SET NULL automatically transitions active assignment to status = 'inactive'
  const mockDb = createMigration07MockSupabase(state);
  const { error: delAccErr } = await mockDb.from('mt5_accounts').delete().eq('id', parent2AccId);
  assert.strictEqual(delAccErr, null);
  assert.strictEqual(histRow.parent_account_id, null);
  assert.strictEqual(histRow.status, 'inactive', 'ON DELETE SET NULL must deactivate assignment instead of leaving active orphan');

  // Restore parent2AccId for API tests
  state.mt5_accounts.push({
    id: parent2AccId,
    user_id: mentor2Id,
    account_role: 'parent',
    account_type: 'demo',
    account_number: '1002',
  });
  console.log('[PASS] 2. Trigger, RLS, historical inactive preservation, reactivation, unique pair, and ON DELETE SET NULL verified.');

  // -------------------------------------------------------------------------
  // 3. Express API Runtime Verification with Migration-07 Mock DB Enforcement
  // -------------------------------------------------------------------------
  const app = createApiApp({
    serviceRoleClientOverride: mockDb as any,
    supabaseUrlOverride: 'https://example.supabase.co',
    serviceRoleKeyOverride: 'service-role-test-key',
    authUserResolverOverride: async (token: string) => {
      if (token === 'jwt-admin') return { user: { id: adminId, email: 'admin@tradesync.test' }, error: null };
      if (token === 'jwt-mentor') return { user: { id: mentorId, email: 'mentor1@tradesync.test' }, error: null };
      if (token === 'jwt-trader') return { user: { id: traderId, email: 'trader1@tradesync.test' }, error: null };
      return { user: null, error: { message: 'Invalid JWT' } };
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Rejects missing parent/child account IDs on admin assignment
    const missingAccRes = await fetch(`${baseUrl}/api/v1/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ mentorId, traderId, parentAccountId: parentAccId }),
    });
    assert.strictEqual(missingAccRes.status, 400);

    // Rejects duplicate active assignment unless replaceExisting: true
    const dupRes = await fetch(`${baseUrl}/api/v1/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        mentorId,
        traderId,
        parentAccountId: parentAccId,
        childAccountId: childAccId,
      }),
    });
    assert.strictEqual(dupRes.status, 409);

    // Lot settings API: mentor rejected (403), trader rejected for risk_percent (400) & accepted for fixed (200), admin accepted for risk_percent (200)
    const mentorLotAttempt = await fetch(`${baseUrl}/api/v1/bridge/assignments/${activeAssign.id}/lot-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-mentor' },
      body: JSON.stringify({ copyMode: 'multiplier', multiplier: 3.0 }),
    });
    assert.strictEqual(mentorLotAttempt.status, 403);

    const traderRestrictedLot = await fetch(`${baseUrl}/api/v1/bridge/assignments/${activeAssign.id}/lot-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-trader' },
      body: JSON.stringify({ copyMode: 'risk_percent', multiplier: 2.5, fixedLot: 0.2 }),
    });
    assert.strictEqual(traderRestrictedLot.status, 400);

    const traderLotOk = await fetch(`${baseUrl}/api/v1/bridge/assignments/${activeAssign.id}/lot-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-trader' },
      body: JSON.stringify({ copyMode: 'fixed', fixedLot: 0.2 }),
    });
    assert.strictEqual(traderLotOk.status, 200);
    assert.strictEqual(activeAssign.lot_mode, 'fixed');

    const adminLotOk = await fetch(`${baseUrl}/api/v1/bridge/assignments/${activeAssign.id}/lot-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ copyMode: 'risk_percent', multiplier: 2.5, fixedLot: 0.2 }),
    });
    assert.strictEqual(adminLotOk.status, 200);
    assert.strictEqual(activeAssign.lot_mode, 'risk_percent');

    // Suspending trader via admin status API deactivates active assignment cleanly without trigger rejection
    const suspendRes = await fetch(`${baseUrl}/api/admin/user-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ targetUserId: traderId, status: 'suspended' }),
    });
    assert.strictEqual(suspendRes.status, 200);
    const suspendJson = await suspendRes.json();
    assert.strictEqual(suspendJson.pausedAssignments, 1);
    assert.strictEqual(activeAssign.status, 'suspended');

    // Reactivating assignment while trader is suspended MUST fail
    const reactivateWhileSuspended = await fetch(`${baseUrl}/api/v1/bridge/assignments/${activeAssign.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ status: 'active' }),
    });
    assert.strictEqual(reactivateWhileSuspended.status, 403);

    // Assigning to a suspended user MUST fail
    const assignSuspended = await fetch(`${baseUrl}/api/v1/admin/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({
        mentorId,
        traderId,
        parentAccountId: parentAccId,
        childAccountId: childAccId,
      }),
    });
    assert.strictEqual(assignSuspended.status, 400);

    // Re-activating trader profile allows reactivating assignment with complete parent+child pairing
    const restoreTrader = await fetch(`${baseUrl}/api/admin/user-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ targetUserId: traderId, status: 'active' }),
    });
    assert.strictEqual(restoreTrader.status, 200);

    const traderUnsuspendBlocked = await fetch(`${baseUrl}/api/v1/bridge/assignments/${activeAssign.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-trader' },
      body: JSON.stringify({ status: 'active' }),
    });
    assert.strictEqual(traderUnsuspendBlocked.status, 403);

    const reactivateOk = await fetch(`${baseUrl}/api/v1/bridge/assignments/${activeAssign.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-admin' },
      body: JSON.stringify({ status: 'active' }),
    });
    assert.strictEqual(reactivateOk.status, 200);
    assert.strictEqual(activeAssign.status, 'active');

    console.log('[PASS] 3. Express assignment, lot-settings, suspension deactivation, and reactivation flows verified.');
    console.log('\nALL MIGRATION 07 SECURITY & INTEGRITY TESTS PASSED.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
