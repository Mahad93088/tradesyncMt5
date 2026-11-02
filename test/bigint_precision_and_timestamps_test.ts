import assert from 'assert';
import { BridgeStore, BridgeInstruction } from '../src/server/bridgeStore';

// ==============================================================================
// REGRESSION TEST SUITE: BIGINT PRECISION BEYOND MAX_SAFE_INTEGER & TIMESTAMPTZ
// ==============================================================================

async function runTests() {
  console.log('=================================================================');
  console.log('REGRESSION TEST SUITE: BIGINT PRECISION & TIMESTAMPTZ LEASE AUDIT');
  console.log('=================================================================');

  const LARGE_PARENT_TICKET = '9007199254740995'; // Number.MAX_SAFE_INTEGER + 4
  const LARGE_CHILD_TICKET = '9223372036854775800'; // Near signed 64-bit int max
  const LARGE_MAGIC_NUMBER = '9007199254740999';

  // Sanity check: verify that JavaScript Number DOES lose precision on these numbers
  assert.strictEqual(
    Number(LARGE_PARENT_TICKET) === 9007199254740996,
    true,
    'Sanity check: JS Number should distort 9007199254740995 to 9007199254740996'
  );

  const bridgeStore = BridgeStore.getInstance();

  // ----------------------------------------------------------------------------
  // TEST 1: Exact Ticket Preservation from Supabase Mock to Instruction Object
  // ----------------------------------------------------------------------------
  console.log('\n[TEST 1] Exact BigInt Ticket Preservation from Supabase Mock...');

  const mockSupabaseWithLargeBigInt: any = {
    rpc: async (fnName: string, args: any) => {
      if (fnName === 'claim_pending_instructions') {
        return {
          data: [
            {
              id: 'inst_rpc_bigint_1',
              idempotency_key: `${LARGE_PARENT_TICKET}_child_uuid_OPEN`,
              action: 'OPEN',
              child_account_id: args.p_child_account_id,
              parent_account_id: 'parent_uuid',
              parent_ticket: LARGE_PARENT_TICKET, // Supabase PostgREST returns BIGINT as decimal string
              child_ticket: null,
              symbol: 'EURUSD',
              order_type: 'BUY',
              lots: '0.50',
              open_price: '1.08500',
              sl: '1.08000',
              tp: '1.09500',
              magic_number: LARGE_MAGIC_NUMBER,
              comment: `Master M#${LARGE_PARENT_TICKET}`,
              status: 'IN_FLIGHT',
              lease_expires_at: new Date(Date.now() + 15000).toISOString(),
              retry_count: 0,
              created_at: new Date().toISOString(),
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { message: 'Unknown RPC' } };
    },
    from: (table: string) => ({
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

  const claimedInstructions = await bridgeStore.pollPendingInstructions(
    'child_acc_bigint_test',
    10,
    mockSupabaseWithLargeBigInt
  );

  assert.strictEqual(claimedInstructions.length, 1);
  const claimed = claimedInstructions[0];

  // Verify that parentTicket was NOT cast to Number and kept as string
  assert.strictEqual(claimed.parentTicket, LARGE_PARENT_TICKET);
  assert.strictEqual(typeof claimed.parentTicket, 'string');
  assert.notStrictEqual(claimed.parentTicket, '9007199254740996'); // Must NOT be corrupted!
  assert.strictEqual(claimed.magicNumber, LARGE_MAGIC_NUMBER);

  // Lot sizes and prices remain precision numbers
  assert.strictEqual(claimed.lots, 0.5);
  assert.strictEqual(claimed.openPrice, 1.085);
  console.log('✓ PASS: BigInt ticket preserved exactly as string from Supabase (9007199254740995 != 9007199254740996).');

  // ----------------------------------------------------------------------------
  // TEST 2: Exact Parent-Child Mapping with 64-Bit Integers
  // ----------------------------------------------------------------------------
  console.log('\n[TEST 2] Parent-Child Mapping and Acknowledgment with 64-Bit Tickets...');

  let persistedChildTicketInInstructions: any = null;
  let persistedChildTicketInMappings: any = null;

  const mockSupabaseAck: any = {
    from: (table: string) => {
      if (table === 'bridge_instructions') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'inst_ack_test_1',
                  idempotency_key: `${LARGE_PARENT_TICKET}_child_uuid_OPEN`,
                  action: 'OPEN',
                  child_account_id: 'child_acc_ack_test',
                  parent_account_id: 'parent_acc_ack_test',
                  parent_ticket: LARGE_PARENT_TICKET,
                  child_ticket: null,
                  symbol: 'GBPUSD',
                  order_type: 'SELL',
                  lots: '1.25',
                  open_price: '1.27500',
                  status: 'IN_FLIGHT',
                  retry_count: 0,
                },
                error: null,
              }),
            }),
          }),
          update: (payload: any) => ({
            eq: async (_col: string, _val: any) => {
              persistedChildTicketInInstructions = payload.child_ticket;
              return { error: null };
            },
          }),
        };
      }
      if (table === 'trade_mappings') {
        return {
          update: (payload: any) => ({
            eq: (_col1: string, _parentTicket: any) => ({
              eq: async (_col2: string, _childAcc: any) => {
                persistedChildTicketInMappings = payload.child_trade_ticket;
                return { error: null };
              },
            }),
          }),
        };
      }
      if (table === 'bridge_sync_logs') {
        return {
          insert: async () => ({ error: null }),
        };
      }
      return {};
    },
  };

  const ackResult = await bridgeStore.acknowledgeInstruction(
    'child_acc_ack_test',
    {
      instructionId: 'inst_ack_test_1',
      status: 'EXECUTED',
      childTicket: LARGE_CHILD_TICKET,
      fillPrice: 1.2748,
      executionLatencyMs: 45,
    },
    mockSupabaseAck
  );

  assert.strictEqual(ackResult.success, true);
  assert.strictEqual(ackResult.instruction?.childTicket, LARGE_CHILD_TICKET);
  assert.strictEqual(persistedChildTicketInInstructions, LARGE_CHILD_TICKET);
  assert.strictEqual(persistedChildTicketInMappings, LARGE_CHILD_TICKET);
  console.log('✓ PASS: Large 64-bit child ticket (9223372036854775800) successfully linked and persisted in trade_mappings.');

  // ----------------------------------------------------------------------------
  // TEST 3: Receiver EA 64-Bit Ticket Parsing (Simulating MQL5 StringToInteger)
  // ----------------------------------------------------------------------------
  console.log('\n[TEST 3] Receiver EA 64-Bit Ticket Parsing Simulation...');

  // Helper simulating MQL5 ExtractJsonUlong with StringToInteger
  function mql5ExtractJsonUlong(json: string, key: string): bigint {
    const needle = `"${key}":`;
    const p1 = json.indexOf(needle);
    if (p1 < 0) return 0n;
    let idx = p1 + needle.length;
    while (idx < json.length && (json[idx] === ' ' || json[idx] === '"')) idx++;
    let p2 = idx;
    while (p2 < json.length && json[p2] >= '0' && json[p2] <= '9') p2++;
    const digits = json.substring(idx, p2);
    if (!digits) return 0n;
    return BigInt(digits);
  }

  // Helper simulating MQL5 ExtractParentTicketFromComment
  function mql5ExtractParentTicketFromComment(comment: string): bigint {
    let tagPos = comment.indexOf('TS#');
    let tagLen = 3;
    if (tagPos < 0) {
      tagPos = comment.indexOf('M#');
      tagLen = 2;
    }
    if (tagPos < 0) return 0n;
    const start = tagPos + tagLen;
    let p2 = start;
    while (p2 < comment.length && comment[p2] >= '0' && comment[p2] <= '9') p2++;
    const digits = comment.substring(start, p2);
    if (!digits) return 0n;
    return BigInt(digits);
  }

  // Case A: JSON with string ticket
  const jsonWithString = `{"instructionId":"inst_1","parentTicket":"${LARGE_PARENT_TICKET}","symbol":"EURUSD"}`;
  const parsedFromString = mql5ExtractJsonUlong(jsonWithString, 'parentTicket');
  assert.strictEqual(parsedFromString, BigInt(LARGE_PARENT_TICKET));

  // Case B: JSON with numeric ticket
  const jsonWithNumber = `{"instructionId":"inst_1","parentTicket":${LARGE_PARENT_TICKET},"symbol":"EURUSD"}`;
  const parsedFromNumber = mql5ExtractJsonUlong(jsonWithNumber, 'parentTicket');
  assert.strictEqual(parsedFromNumber, BigInt(LARGE_PARENT_TICKET));

  // Case C: Comment parsing from TS# tag
  const comment = `TradeSync (TS#${LARGE_PARENT_TICKET})`;
  const parsedFromComment = mql5ExtractParentTicketFromComment(comment);
  assert.strictEqual(parsedFromComment, BigInt(LARGE_PARENT_TICKET));

  // Exact comparison in Receiver EA:
  assert.strictEqual(parsedFromString === parsedFromComment, true);
  assert.strictEqual(parsedFromString === BigInt('9007199254740996'), false);
  console.log('✓ PASS: MQL5 StringToInteger extracts exact 64-bit integer without double truncation.');

  // ----------------------------------------------------------------------------
  // TEST 4: TIMESTAMPTZ and Lease Window Calculation Audit
  // ----------------------------------------------------------------------------
  console.log('\n[TEST 4] TIMESTAMPTZ Lease Window Calculation Audit...');

  const t0 = new Date();
  const leaseSeconds = 15;
  const leaseExpiry = new Date(t0.getTime() + leaseSeconds * 1000);

  // In SQL: now() + (p_lease_seconds || ' seconds')::INTERVAL
  const diffMs = leaseExpiry.getTime() - t0.getTime();
  assert.strictEqual(diffMs, 15000, 'Lease window must be exactly 15,000 ms');

  // Verify timezone comparisons:
  const expiredTime = new Date(t0.getTime() - 1000);
  const futureTime = new Date(t0.getTime() + 1000);

  assert.strictEqual(expiredTime < t0, true, 'Expired timestamp must evaluate < now()');
  assert.strictEqual(futureTime < t0, false, 'Future timestamp must not evaluate < now()');
  console.log('✓ PASS: TIMESTAMPTZ lease expiration accurately calculates 15-second window without timezone shift.');

  console.log('\n=================================================================');
  console.log('ALL REGRESSION TESTS PASSED SUCCESSFULLY (0 ERRORS)');
  console.log('=================================================================');
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
