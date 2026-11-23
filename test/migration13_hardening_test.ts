import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

interface PlanRow {
  code: string;
  max_followers: number | null;
  max_child_accounts: number | null;
}

interface AssignmentRow {
  id: string;
  mentor_id: string;
  trader_id: string;
  parent_account_id: string;
  child_account_id: string;
  status: 'active' | 'paused' | 'suspended' | 'inactive';
  balance_pause_active: boolean;
  activated_at: string | null;
  activation_epoch: number | null;
}

interface InstructionRow {
  id: string;
  action: 'OPEN' | 'CLOSE' | 'MODIFY';
  child_account_id: string;
  parent_account_id: string;
  status: 'QUEUED' | 'IN_FLIGHT' | 'FAILED' | 'EXECUTED';
  activation_epoch: number | null;
  parent_event_timestamp: string | null;
  created_at: string;
}

/**
 * Mirrors Migration 13 validate_mentor_assignment() authoritative plan-limit CASE.
 */
function resolveMigration13PlanLimit(plan: PlanRow): number | null {
  const code = (plan.code || '').trim().toLowerCase();
  if (code === 'trial') return 2;
  if (code === 'silver') return 50;
  if (code === 'gold') return 100;
  return plan.max_followers ?? plan.max_child_accounts ?? null;
}

/**
 * Mirrors Migration 13 claim_pending_instructions() activation boundary + pause gating.
 */
function simulateMigration13ClaimPending(
  instructions: InstructionRow[],
  assignments: AssignmentRow[],
  childAccountId: string
): { claimedIds: string[]; failedIds: string[] } {
  const isAssignmentEligibleForInstruction = (inst: InstructionRow): boolean => {
    const instEventMs = Date.parse(inst.parent_event_timestamp ?? inst.created_at);
    return assignments.some((ma) => {
      if (ma.parent_account_id !== inst.parent_account_id) return false;
      if (ma.child_account_id !== inst.child_account_id) return false;
      if (ma.status !== 'active') return false;
      if (ma.balance_pause_active === true) return false;
      if (ma.activated_at != null && instEventMs < Date.parse(ma.activated_at)) return false;
      if (
        inst.activation_epoch != null &&
        ma.activation_epoch != null &&
        inst.activation_epoch < ma.activation_epoch
      ) {
        return false;
      }
      return true;
    });
  };

  // Step 1: Cancel queued OPENs failing activation/pause/epoch checks
  const failedIds: string[] = [];
  for (const bi of instructions) {
    if (bi.child_account_id === childAccountId && bi.action === 'OPEN' && bi.status === 'QUEUED') {
      if (!isAssignmentEligibleForInstruction(bi)) {
        bi.status = 'FAILED';
        failedIds.push(bi.id);
      }
    }
  }

  // Step 2: Claim eligible QUEUED instructions (CLOSE/MODIFY unaffected)
  const claimedIds: string[] = [];
  for (const q of instructions) {
    if (q.child_account_id !== childAccountId) continue;
    if (q.status !== 'QUEUED') continue;
    if (q.action === 'OPEN' && !isAssignmentEligibleForInstruction(q)) continue;
    q.status = 'IN_FLIGHT';
    claimedIds.push(q.id);
  }

  return { claimedIds, failedIds };
}

function runTests() {
  console.log('=== Migration 13 Hardening & Remediation Verification Tests ===');

  const mig13Path = path.resolve(process.cwd(), 'supabase/migrations/13_client_requirements_hardening.sql');
  const sql = fs.readFileSync(mig13Path, 'utf8');

  // -------------------------------------------------------------------------
  // 1. Transactional, Idempotent & Timezone Safety Verification
  // -------------------------------------------------------------------------
  assert.ok(sql.includes('BEGIN;'), 'Migration 13 must open a transaction');
  assert.ok(sql.includes('COMMIT;'), 'Migration 13 must commit transaction');
  assert.ok(sql.includes("NOTIFY pgrst, 'reload schema';"), 'Migration 13 must reload PostgREST schema cache');
  assert.strictEqual(sql.includes('```'), false, 'Migration 13 must not contain markdown backticks');
  assert.strictEqual(
    /\btimezone\s*\(/i.test(sql),
    false,
    'Migration 13 must use plain now() instead of timezone(..., now()) for TIMESTAMPTZ expressions'
  );
  assert.ok(sql.includes('v_now TIMESTAMPTZ := now();'), 'validate_mentor_assignment() must initialize v_now using now()');
  assert.ok(
    sql.includes('SET activated_at = COALESCE(activated_at, assigned_at, now())'),
    'mentor_assignments backfill must use now()'
  );
  assert.ok(sql.includes('archived_at = COALESCE(archived_at, now())'), 'Plan archival must use now()');
  console.log('[PASS] 1. Transaction wrapper, schema reload, and TIMESTAMPTZ now() usage verified.');

  // -------------------------------------------------------------------------
  // 2. Authoritative Plan Limits in validate_mentor_assignment()
  // -------------------------------------------------------------------------
  assert.ok(
    sql.includes("SELECT CASE lower(btrim(COALESCE(sp.code, '')))"),
    'validate_mentor_assignment() must switch authoritatively on sp.code'
  );
  assert.ok(sql.includes("WHEN 'trial' THEN 2"), 'Trial authoritative DB trigger limit must be 2');
  assert.ok(sql.includes("WHEN 'silver' THEN 50"), 'Silver authoritative DB trigger limit must be 50');
  assert.ok(sql.includes("WHEN 'gold' THEN 100"), 'Gold authoritative DB trigger limit must be 100');
  assert.ok(
    sql.includes('ELSE COALESCE(sp.max_followers, sp.max_child_accounts)'),
    'Legacy plan codes must fall back to DB columns'
  );
  assert.ok(
    sql.includes("pg_advisory_xact_lock(hashtext('mentor_quota_' || NEW.mentor_id::text))"),
    'Atomic advisory lock per mentor required'
  );
  assert.ok(sql.includes('COUNT(DISTINCT ma.trader_id)'), 'Trigger quota check must count DISTINCT trader_id');

  // Behavioral simulation: tampered DB plan limits must still yield 2/50/100 for trial/silver/gold
  assert.strictEqual(resolveMigration13PlanLimit({ code: 'trial', max_followers: 99, max_child_accounts: 99 }), 2);
  assert.strictEqual(resolveMigration13PlanLimit({ code: 'Silver', max_followers: 10, max_child_accounts: 10 }), 50);
  assert.strictEqual(resolveMigration13PlanLimit({ code: ' GOLD ', max_followers: 25, max_child_accounts: 25 }), 100);
  assert.strictEqual(resolveMigration13PlanLimit({ code: 'starter_10', max_followers: 10, max_child_accounts: 10 }), 10);
  assert.strictEqual(resolveMigration13PlanLimit({ code: 'pro_50', max_followers: null, max_child_accounts: 50 }), 50);
  console.log('[PASS] 2. Authoritative Trial=2/Silver=50/Gold=100 limits & legacy fallback verified.');

  // -------------------------------------------------------------------------
  // 3. claim_pending_instructions() Activation Boundary & Epoch Verification
  // -------------------------------------------------------------------------
  assert.ok(
    sql.includes('AND (ma.activated_at IS NULL OR COALESCE(bi.parent_event_timestamp, bi.created_at) >= ma.activated_at)'),
    'claim_pending_instructions() cancel step must check COALESCE(bi.parent_event_timestamp, bi.created_at) >= ma.activated_at'
  );
  assert.ok(
    sql.includes('AND (ma.activated_at IS NULL OR COALESCE(q.parent_event_timestamp, q.created_at) >= ma.activated_at)'),
    'claim_pending_instructions() eligible CTE must check COALESCE(q.parent_event_timestamp, q.created_at) >= ma.activated_at'
  );
  assert.ok(sql.includes('bi.activation_epoch >= ma.activation_epoch'), 'Cancel step must validate activation_epoch');
  assert.ok(sql.includes('q.activation_epoch >= ma.activation_epoch'), 'Eligible CTE must validate activation_epoch');
  assert.ok(sql.includes("q.action <> 'OPEN'"), 'CLOSE and MODIFY instructions must remain claimable');

  // Behavioral simulation: same epoch + later created_at, but parent_event_timestamp < activated_at MUST fail
  const baseMs = Date.now();
  const assignment: AssignmentRow = {
    id: 'assign-1',
    mentor_id: 'mentor-1',
    trader_id: 'trader-1',
    parent_account_id: 'parent-1',
    child_account_id: 'child-1',
    status: 'active',
    balance_pause_active: false,
    activated_at: new Date(baseMs).toISOString(),
    activation_epoch: 2,
  };
  const simInstructions: InstructionRow[] = [
    {
      id: 'open-backdated-same-epoch',
      action: 'OPEN',
      child_account_id: 'child-1',
      parent_account_id: 'parent-1',
      status: 'QUEUED',
      activation_epoch: 2,
      parent_event_timestamp: new Date(baseMs - 15_000).toISOString(),
      created_at: new Date(baseMs + 2_000).toISOString(),
    },
    {
      id: 'open-valid-post-activation',
      action: 'OPEN',
      child_account_id: 'child-1',
      parent_account_id: 'parent-1',
      status: 'QUEUED',
      activation_epoch: 2,
      parent_event_timestamp: new Date(baseMs + 5_000).toISOString(),
      created_at: new Date(baseMs + 6_000).toISOString(),
    },
    {
      id: 'close-existing-position',
      action: 'CLOSE',
      child_account_id: 'child-1',
      parent_account_id: 'parent-1',
      status: 'QUEUED',
      activation_epoch: 1,
      parent_event_timestamp: new Date(baseMs - 60_000).toISOString(),
      created_at: new Date(baseMs + 7_000).toISOString(),
    },
  ];

  const simResult = simulateMigration13ClaimPending(simInstructions, [assignment], 'child-1');
  assert.deepStrictEqual(simResult.failedIds, ['open-backdated-same-epoch']);
  assert.deepStrictEqual(simResult.claimedIds, ['open-valid-post-activation', 'close-existing-position']);
  console.log('[PASS] 3. claim_pending_instructions() COALESCE(parent_event_timestamp, created_at) & epoch gating verified.');

  // -------------------------------------------------------------------------
  // 4. Migration 11 ACLs, Migration 12 Demo-Only & RLS Preservation
  // -------------------------------------------------------------------------
  assert.ok(
    sql.includes('IF NEW.account_type IS DISTINCT FROM \'demo\' THEN'),
    'Unconditional Demo-only check must remain enforced for all callers'
  );
  assert.ok(
    sql.includes('CHECK (account_type = \'demo\')'),
    'mt5_accounts_account_type_demo_only_check must be preserved'
  );
  assert.ok(
    sql.includes('REVOKE SELECT (terminal_token_hash) ON TABLE public.mt5_accounts\n    FROM PUBLIC, anon, authenticated;'),
    'terminal_token_hash must stay revoked from PUBLIC, anon, and authenticated'
  );
  assert.ok(
    sql.includes('GRANT SELECT (terminal_token_hash) ON TABLE public.mt5_accounts TO postgres, service_role;'),
    'service_role/postgres must retain SELECT on terminal_token_hash'
  );
  assert.ok(
    sql.includes('USING (user_id = auth.uid() OR public.is_admin());'),
    'mentor_profiles SELECT RLS policy must restrict direct reads to owner/admin'
  );
  console.log('[PASS] 4. Migration 11 ACLs, Migration 12 unconditional demo-only enforcement, and RLS verified.');

  console.log('\nALL MIGRATION 13 HARDENING & REMEDIATION TESTS PASSED (4/4 groups).');
}

runTests();
