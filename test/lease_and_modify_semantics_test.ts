import assert from 'assert';
import { BridgeStore, BridgeInstruction } from '../src/server/bridgeStore';

// ==============================================================================
// TEST SUITE: DATABASE-AUTHORITATIVE LEASE & SL/TP MODIFY SEMANTICS
// ==============================================================================

async function runTests() {
  console.log('=================================================================');
  console.log('TEST SUITE: DATABASE LEASE & SL/TP MODIFY SEMANTICS');
  console.log('=================================================================');

  const bridgeStore = BridgeStore.getInstance();

  // ----------------------------------------------------------------------------
  // TEST 1: Database SL/TP Value 0 Remains Numeric Zero & Database NULL is undefined
  // ----------------------------------------------------------------------------
  console.log('\n[TEST 1] Testing Database SL/TP Value 0 Preservation & NULL Handling...');

  const dbAuthoritativeLeaseDate = '2026-11-02T12:05:30.500Z';
  const expectedLeaseMs = new Date(dbAuthoritativeLeaseDate).getTime();

  const mockSupabaseClaim: any = {
    rpc: async (fnName: string, args: any) => {
      if (fnName === 'claim_pending_instructions') {
        return {
          data: [
            {
              id: 'inst_zero_sltp',
              idempotency_key: 'test_zero_1',
              action: 'MODIFY',
              child_account_id: args.p_child_account_id,
              parent_account_id: 'parent_1',
              parent_ticket: '1001',
              child_ticket: '2001',
              symbol: 'EURUSD',
              order_type: 'BUY',
              lots: '0.10',
              open_price: '1.08500',
              sl: 0, // EXPLICIT ZERO IN POSTGRESQL (or '0')
              tp: null, // NULL IN POSTGRESQL
              magic_number: '888999',
              comment: 'Test SL Clear',
              status: 'IN_FLIGHT',
              lease_expires_at: dbAuthoritativeLeaseDate,
              retry_count: 0,
              created_at: new Date().toISOString(),
            },
            {
              id: 'inst_positive_sltp',
              idempotency_key: 'test_positive_1',
              action: 'MODIFY',
              child_account_id: args.p_child_account_id,
              parent_account_id: 'parent_1',
              parent_ticket: '1002',
              child_ticket: '2002',
              symbol: 'GBPUSD',
              order_type: 'SELL',
              lots: '0.20',
              open_price: '1.27500',
              sl: '1.28000', // POSITIVE NUMERIC STRING FROM POSTGRESQL
              tp: 0, // EXPLICIT ZERO TP
              magic_number: '888999',
              comment: 'Test Positive SL and Zero TP',
              status: 'IN_FLIGHT',
              lease_expires_at: dbAuthoritativeLeaseDate,
              retry_count: 0,
              created_at: new Date().toISOString(),
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { message: 'Unknown RPC' } };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => null,
          or: () => ({
            order: () => ({
              limit: async () => ({ data: [] }),
            }),
          }),
        }),
      }),
    }),
  };

  const claimed = await bridgeStore.pollPendingInstructions('child_acc_test', 10, mockSupabaseClaim);
  assert.strictEqual(claimed.length, 2);

  // Row 1: SL is 0, TP is NULL
  const row1 = claimed[0];
  assert.strictEqual(row1.sl, 0, 'Database SL value 0 must remain exact numeric 0, not undefined or null');
  assert.strictEqual(row1.hasSL, true, 'hasSL must be true when SL is 0');
  assert.strictEqual(row1.tp, undefined, 'Database TP NULL must be mapped to undefined');
  assert.strictEqual(row1.hasTP, false, 'hasTP must be false when TP is NULL');

  // Row 2: SL is 1.28000, TP is 0
  const row2 = claimed[1];
  assert.strictEqual(row2.sl, 1.28, 'Database SL positive value must be mapped to 1.28');
  assert.strictEqual(row2.hasSL, true, 'hasSL must be true when SL is positive');
  assert.strictEqual(row2.tp, 0, 'Database TP value 0 must remain exact numeric 0');
  assert.strictEqual(row2.hasTP, true, 'hasTP must be true when TP is 0');

  console.log('✓ PASS: Database SL/TP 0 remains numeric zero and NULL remains undefined.');

  // ----------------------------------------------------------------------------
  // TEST 2: Database Lease Timestamp Used Instead of Local Clock Calculation
  // ----------------------------------------------------------------------------
  console.log('\n[TEST 2] Testing Database Lease Timestamp Authority...');

  assert.strictEqual(
    row1.leaseExpiresAt,
    expectedLeaseMs,
    `leaseExpiresAt must match database timestamp (${expectedLeaseMs}), not local clock`
  );
  assert.strictEqual(
    row2.leaseExpiresAt,
    expectedLeaseMs,
    `leaseExpiresAt must match database timestamp (${expectedLeaseMs}), not local clock`
  );

  // Test fallback when database lease is missing or invalid:
  const mockSupabaseMissingLease: any = {
    rpc: async () => ({
      data: [
        {
          id: 'inst_fallback_lease',
          idempotency_key: 'test_fallback_1',
          action: 'OPEN',
          child_account_id: 'child_1',
          parent_account_id: 'parent_1',
          parent_ticket: '1003',
          symbol: 'EURUSD',
          order_type: 'BUY',
          lots: '0.1',
          lease_expires_at: null, // MISSING DATABASE LEASE
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    }),
  };

  const beforePoll = Date.now();
  const fallbackClaimed = await bridgeStore.pollPendingInstructions('child_1', 10, mockSupabaseMissingLease);
  const afterPoll = Date.now();

  assert.strictEqual(fallbackClaimed.length, 1);
  assert(
    fallbackClaimed[0].leaseExpiresAt! >= beforePoll + 15000 &&
      fallbackClaimed[0].leaseExpiresAt! <= afterPoll + 15000,
    'Missing DB lease timestamp should safely fallback to now + 15000'
  );

  console.log('✓ PASS: Database lease timestamp is authoritative; fallback activates only on missing/invalid timestamps.');

  // ----------------------------------------------------------------------------
  // TEST 3: JSON Serialization & Receiver EA Parsing Semantics
  // ----------------------------------------------------------------------------
  console.log('\n[TEST 3] Testing Receiver EA Parsing Semantics for MODIFY...');

  // MQL5 Receiver EA logic simulation functions
  function mql5HasJsonKey(json: string, key: string): boolean {
    const needle = `"${key}":`;
    const p1 = json.indexOf(needle);
    if (p1 < 0) return false;
    let idx = p1 + needle.length;
    while (idx < json.length && json[idx] === ' ') idx++;
    if (json.startsWith('null', idx)) return false;
    return true;
  }

  function mql5ExtractJsonBool(json: string, key: string, defaultVal: boolean = false): boolean {
    const needle = `"${key}":`;
    const p1 = json.indexOf(needle);
    if (p1 < 0) return defaultVal;
    let idx = p1 + needle.length;
    while (idx < json.length && (json[idx] === ' ' || json[idx] === '"')) idx++;
    if (json.startsWith('true', idx) || json.startsWith('1', idx)) return true;
    if (json.startsWith('false', idx) || json.startsWith('0', idx)) return false;
    return defaultVal;
  }

  function mql5ExtractJsonDouble(json: string, key: string): double {
    const needle = `"${key}":`;
    const p1 = json.indexOf(needle);
    if (p1 < 0) return 0.0;
    let idx = p1 + needle.length;
    while (idx < json.length && (json[idx] === ' ' || json[idx] === '"')) idx++;
    let p2 = idx;
    while (p2 < json.length) {
      const c = json[p2];
      if ((c >= '0' && c <= '9') || c === '.' || c === '-') p2++;
      else break;
    }
    if (p2 === idx) return 0.0;
    return parseFloat(json.substring(idx, p2));
  }

  type double = number;

  function simulateReceiverModify(
    instructionJson: string,
    currentPosition: { sl: double; tp: double }
  ): { targetSL: double; targetTP: double; modified: boolean } {
    let hasSL = false;
    if (mql5HasJsonKey(instructionJson, 'hasSL')) {
      hasSL = mql5ExtractJsonBool(instructionJson, 'hasSL', false);
    } else if (mql5HasJsonKey(instructionJson, 'hasSl')) {
      hasSL = mql5ExtractJsonBool(instructionJson, 'hasSl', false);
    } else if (mql5HasJsonKey(instructionJson, 'sl')) {
      hasSL = true;
    }

    let hasTP = false;
    if (mql5HasJsonKey(instructionJson, 'hasTP')) {
      hasTP = mql5ExtractJsonBool(instructionJson, 'hasTP', false);
    } else if (mql5HasJsonKey(instructionJson, 'hasTp')) {
      hasTP = mql5ExtractJsonBool(instructionJson, 'hasTp', false);
    } else if (mql5HasJsonKey(instructionJson, 'tp')) {
      hasTP = true;
    }

    const sl = hasSL ? mql5ExtractJsonDouble(instructionJson, 'sl') : 0.0;
    const tp = hasTP ? mql5ExtractJsonDouble(instructionJson, 'tp') : 0.0;

    // Receiver EA decision logic:
    // - Field omitted: keep existing position setting
    // - Field explicit zero: clear setting (0.0)
    // - Field positive: update to new setting
    const targetSL = hasSL ? sl : currentPosition.sl;
    const targetTP = hasTP ? tp : currentPosition.tp;

    const modified = targetSL !== currentPosition.sl || targetTP !== currentPosition.tp;
    return { targetSL, targetTP, modified };
  }

  // Position state on child terminal before instruction:
  const initialPosition = { sl: 1.08250, tp: 1.09100 };

  // SCENARIO A: MODIFY with SL/TP fields omitted (e.g. neither modified or not in payload)
  const jsonOmitted = JSON.stringify({
    instructionId: 'inst_mod_omitted',
    action: 'MODIFY',
    childTicket: '2001',
    hasSL: false,
    hasTP: false,
  });
  const outcomeA = simulateReceiverModify(jsonOmitted, initialPosition);
  assert.strictEqual(outcomeA.targetSL, 1.08250, 'Omitted SL must leave position SL unchanged');
  assert.strictEqual(outcomeA.targetTP, 1.09100, 'Omitted TP must leave position TP unchanged');
  assert.strictEqual(outcomeA.modified, false, 'No broker modification needed when target matches current');
  console.log('✓ PASS: MODIFY with omitted SL/TP leaves existing settings unchanged (1.08250 / 1.09100).');

  // SCENARIO B: MODIFY with explicit zero SL (clearing Stop Loss) and omitted TP
  const jsonZeroSL = JSON.stringify({
    instructionId: 'inst_mod_clear_sl',
    action: 'MODIFY',
    childTicket: '2001',
    sl: 0,
    hasSL: true,
    hasTP: false,
  });
  const outcomeB = simulateReceiverModify(jsonZeroSL, initialPosition);
  assert.strictEqual(outcomeB.targetSL, 0.0, 'Explicit zero SL must clear setting to 0.0');
  assert.strictEqual(outcomeB.targetTP, 1.09100, 'Omitted TP must remain unchanged at 1.09100');
  assert.strictEqual(outcomeB.modified, true, 'Modification required to clear SL');
  console.log('✓ PASS: MODIFY with explicit zero SL clears the stop loss (0.0) while preserving existing TP (1.09100).');

  // SCENARIO C: MODIFY with positive value updates both SL and TP
  const jsonUpdateBoth = JSON.stringify({
    instructionId: 'inst_mod_positive',
    action: 'MODIFY',
    childTicket: '2001',
    sl: 1.08400,
    tp: 1.09500,
    hasSL: true,
    hasTP: true,
  });
  const outcomeC = simulateReceiverModify(jsonUpdateBoth, initialPosition);
  assert.strictEqual(outcomeC.targetSL, 1.08400, 'Positive SL updates to 1.08400');
  assert.strictEqual(outcomeC.targetTP, 1.09500, 'Positive TP updates to 1.09500');
  assert.strictEqual(outcomeC.modified, true, 'Modification required to update SL and TP');
  console.log('✓ PASS: MODIFY with positive values updates both SL (1.08400) and TP (1.09500).');

  // SCENARIO D: MODIFY with explicit zero TP (clearing Take Profit) and positive SL
  const jsonClearTP = JSON.stringify({
    instructionId: 'inst_mod_clear_tp',
    action: 'MODIFY',
    childTicket: '2001',
    sl: 1.08500,
    tp: 0,
    hasSL: true,
    hasTP: true,
  });
  const outcomeD = simulateReceiverModify(jsonClearTP, initialPosition);
  assert.strictEqual(outcomeD.targetSL, 1.08500, 'Positive SL updates to 1.08500');
  assert.strictEqual(outcomeD.targetTP, 0.0, 'Explicit zero TP clears setting to 0.0');
  assert.strictEqual(outcomeD.modified, true, 'Modification required');
  console.log('✓ PASS: MODIFY with positive SL and explicit zero TP updates SL and clears TP.');

  console.log('\n=================================================================');
  console.log('ALL TESTS PASSED SUCCESSFULLY (0 ERRORS)');
  console.log('=================================================================');
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
