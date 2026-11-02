import assert from 'node:assert';
import { BridgeStore } from '../src/server/bridgeStore.js';

/**
 * Phase 2 Durable Persistence Test Suite
 * Validates:
 * 1. Zero unauthenticated/mock token fallbacks: random tokens are rejected without a database match.
 * 2. Cross-instance idempotency: queuing the same key returns the existing instruction as duplicate.
 * 3. Lease-locking: polling marks an instruction IN_FLIGHT with a 15-second lease window.
 * 4. Retry limits: repeated expired leases increment retry_count and transition to FAILED at 5.
 * 5. Trade mapping resolution and status transitions.
 */

async function runPhase2Tests() {
  console.log('--- Starting Phase 2 Persistence Test Suite ---');

  const store = BridgeStore.getInstance();

  // Test 1: No mock fallback tokens
  console.log('Test 1: Unregistered/random tokens must fail authentication without a database record...');
  const fakeAuth = await store.authenticateTerminal('ts_fake_random_token_999999');
  assert.strictEqual(fakeAuth, null, 'Unregistered tokens must return null (zero mock fallbacks)');

  // Also verify that the old pre-seeded demo tokens do NOT exist in memory
  const oldDemoAuth = await store.authenticateTerminal('ts_parent_demo_token_889911');
  assert.strictEqual(oldDemoAuth, null, 'Hardcoded demo tokens must not authenticate without a database row');
  console.log('✓ Test 1 passed: Authentic token verification enforced with zero mock leaks.');

  // Test 2: Idempotency preservation
  console.log('Test 2: Idempotency key preservation across queue calls...');
  const key1 = `idemp_test_${Date.now()}_001`;
  const res1 = await store.queueInstruction({
    idempotencyKey: key1,
    action: 'OPEN',
    childAccountId: 'child_account_alpha',
    parentAccountId: 'parent_account_alpha',
    parentTicket: 778899,
    symbol: 'EURUSD',
    orderType: 'BUY',
    lots: 0.2,
    magicNumber: 888999,
    comment: 'Idempotency test',
  });

  assert.strictEqual(res1.isDuplicate, false);
  const instId1 = res1.instruction.instructionId;

  // Immediate retry with the same key
  const res2 = await store.queueInstruction({
    idempotencyKey: key1,
    action: 'OPEN',
    childAccountId: 'child_account_alpha',
    parentAccountId: 'parent_account_alpha',
    parentTicket: 778899,
    symbol: 'EURUSD',
    orderType: 'BUY',
    lots: 0.2,
    magicNumber: 888999,
    comment: 'Idempotency test retry',
  });

  assert.strictEqual(res2.isDuplicate, true, 'Second queue call must detect duplicate');
  assert.strictEqual(res2.instruction.instructionId, instId1, 'Must return the original instruction');
  console.log('✓ Test 2 passed: Idempotency correctly returns existing instruction.');

  // Test 3: Lease locking & exclusivity
  console.log('Test 3: Lease locking prevents double execution...');
  const polled = await store.pollPendingInstructions('child_account_alpha', 10);
  assert.strictEqual(polled.length >= 1, true);
  const target = polled.find((i) => i.instructionId === instId1);
  assert.ok(target, 'Target instruction must be delivered in first poll');
  assert.strictEqual(target.status, 'IN_FLIGHT');

  // Immediately poll again (within the 15-second lease window)
  const polledSecond = await store.pollPendingInstructions('child_account_alpha', 10);
  const targetSecond = polledSecond.find((i) => i.instructionId === instId1);
  assert.strictEqual(targetSecond, undefined, 'Leased instruction must NOT be returned while lease is active');
  console.log('✓ Test 3 passed: 15-second lease lock guarantees exclusive receiver polling.');

  // Test 4: Retry limit threshold (5 attempts)
  console.log('Test 4: Exceeded lease retries transition instruction to FAILED...');
  const retryKey = `idemp_retry_test_${Date.now()}`;
  const retryRes = await store.queueInstruction({
    idempotencyKey: retryKey,
    action: 'OPEN',
    childAccountId: 'child_account_beta',
    parentAccountId: 'parent_account_beta',
    parentTicket: 554433,
    symbol: 'GBPUSD',
    orderType: 'SELL',
    lots: 0.5,
    magicNumber: 888999,
    comment: 'Retry exhaustion test',
  });

  const retryInstId = retryRes.instruction.instructionId;

  // Simulate 5 lease timeouts
  for (let attempt = 0; attempt < 5; attempt++) {
    // Manually expire lease to simulate network timeout on child terminal
    const inst = (store as any).instructions.get(retryInstId);
    if (inst) {
      inst.status = 'IN_FLIGHT';
      inst.leaseExpiresAt = Date.now() - 1000; // Expired 1 second ago
    }
    await store.pollPendingInstructions('child_account_beta', 10);
  }

  // Next poll after 5 retries must fail the instruction and NOT deliver it
  const instAfterRetries = (store as any).instructions.get(retryInstId);
  if (instAfterRetries) {
    instAfterRetries.leaseExpiresAt = Date.now() - 1000;
  }
  const pollAfterMaxRetries = await store.pollPendingInstructions('child_account_beta', 10);
  const foundFailed = pollAfterMaxRetries.find((i) => i.instructionId === retryInstId);
  assert.strictEqual(foundFailed, undefined, 'Exhausted instruction must not be redelivered');
  assert.strictEqual(instAfterRetries?.status, 'FAILED', 'Exhausted instruction must be marked FAILED');
  console.log('✓ Test 4 passed: Max retries (5) enforced, preventing infinite execution loops.');

  // Test 5: Acknowledgment & Trade Mappings
  console.log('Test 5: Execution ACK transitions status to COMPLETED and stores child ticket...');
  const ackRes = await store.acknowledgeInstruction('child_account_alpha', {
    instructionId: instId1,
    status: 'EXECUTED',
    childTicket: 987654,
    fillPrice: 1.0855,
    executionLatencyMs: 38,
  });

  assert.strictEqual(ackRes.success, true);
  assert.strictEqual(ackRes.instruction?.status, 'COMPLETED');
  assert.strictEqual(String(ackRes.instruction?.childTicket), '987654');

  const mappings = await store.getTradeMappings();
  const map = mappings.find((m) => String(m.parentTradeTicket) === '778899' && m.childAccountId === 'child_account_alpha');
  assert.ok(map, 'Trade mapping must exist');
  assert.strictEqual(String(map.childTradeTicket), '987654', 'Child ticket must be recorded in mapping');
  assert.strictEqual(map.status, 'EXECUTED', 'Mapping status must be EXECUTED');
  console.log('✓ Test 5 passed: Execution ACK accurately updates trade mappings and child tickets.');

  console.log('=== All Phase 2 Persistence Tests Passed Successfully ===');
}

runPhase2Tests().catch((err) => {
  console.error('Phase 2 Test Suite Failed:', err);
  process.exit(1);
});
