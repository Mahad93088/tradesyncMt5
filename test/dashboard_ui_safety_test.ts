import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  getDeterministicInviteCode,
  formatLotRuleLabel,
  formatLinkProfitDisplay,
  formatTradeProfitDisplay,
  formatHeartbeatAge,
} from '../src/components/common/dashboardHelpers.js';
import type { LotSettings } from '../src/types/index.js';

function makeLotSettings(overrides: Partial<LotSettings> = {}): LotSettings {
  return {
    mode: 'custom_lot',
    customType: 'multiplier',
    fixedLot: 0.25,
    multiplier: 1.5,
    riskPercent: 2.0,
    maxLotCap: 2.0,
    minLotClamp: 0.01,
    maxDrawdownProtectionPercent: 10,
    copyPendingOrders: true,
    syncSlTp: true,
    slippageMaxPips: 3,
    ...overrides,
  };
}

function runTests() {
  console.log('=== TradeSync MT5 Dashboard UI Helper & Static Safety Tests ===\n');

  // 1. Deterministic invite code generation matches server /api/v1/bridge/assignments/join logic
  assert.strictEqual(getDeterministicInviteCode('a1b2c3d4-9999-8888-7777-000011112222'), 'TS-A1B2C3D4');
  assert.strictEqual(getDeterministicInviteCode(''), 'TS-UNASSIGNED');
  assert.strictEqual(getDeterministicInviteCode(null), 'TS-UNASSIGNED');
  console.log('[PASS] 1. getDeterministicInviteCode matches backend invite code convention.');

  // 2. formatLotRuleLabel formats all 5 lot copy modes cleanly
  assert.strictEqual(formatLotRuleLabel(makeLotSettings({ mode: 'parent_lot' })), '1:1 Direct');
  assert.strictEqual(formatLotRuleLabel(makeLotSettings({ mode: 'custom_lot', customType: 'fixed', fixedLot: 0.3 })), 'FIXED (0.30L)');
  assert.strictEqual(formatLotRuleLabel(makeLotSettings({ mode: 'custom_lot', customType: 'multiplier', multiplier: 0.5 })), 'MULTIPLIER (0.5x)');
  assert.strictEqual(formatLotRuleLabel(makeLotSettings({ mode: 'custom_lot', customType: 'equity_ratio' })), 'EQUITY RATIO');
  assert.strictEqual(formatLotRuleLabel(makeLotSettings({ mode: 'custom_lot', customType: 'risk_percent', riskPercent: 1.5 })), 'RISK % (1.5%)');
  console.log('[PASS] 2. formatLotRuleLabel supports all 5 copy modes (including equity_ratio).');

  // 3. formatLinkProfitDisplay never displays fake $0.00 in Cloud Mode when DB trades unavailable
  const cloudUnavailable = formatLinkProfitDisplay({ totalProfitUSD: 0, totalProfitAvailable: false }, true);
  assert.strictEqual(cloudUnavailable.available, false);
  assert.strictEqual(cloudUnavailable.text, 'Deal P&L awaiting EA sync');

  const cloudNegative = formatLinkProfitDisplay({ totalProfitUSD: -42.5, totalProfitAvailable: true }, true);
  assert.strictEqual(cloudNegative.available, true);
  assert.strictEqual(cloudNegative.isPositive, false);
  assert.strictEqual(cloudNegative.text, '-$42.50');

  const demoLink = formatLinkProfitDisplay({ totalProfitUSD: 0, totalProfitAvailable: false }, false);
  assert.strictEqual(demoLink.available, true);
  assert.strictEqual(demoLink.text, '+$0.00');
  console.log('[PASS] 3. formatLinkProfitDisplay separates unavailable Cloud EA sync from real/demo P&L.');

  // 4. formatTradeProfitDisplay distinguishes fallback mapping rows from real deal P&L
  const fallbackCloudTrade = formatTradeProfitDisplay({ profit: 0, isMappingFallback: true }, true);
  assert.strictEqual(fallbackCloudTrade.available, false);
  assert.strictEqual(fallbackCloudTrade.text, 'Awaiting EA sync');

  const realCloudTrade = formatTradeProfitDisplay({ profit: 18.75, isMappingFallback: false }, true);
  assert.strictEqual(realCloudTrade.available, true);
  assert.strictEqual(realCloudTrade.text, '+$18.75');
  console.log('[PASS] 4. formatTradeProfitDisplay labels mapping fallback rows as Awaiting EA sync.');

  // 5. formatHeartbeatAge handles invalid, recent, minutes, and hours cleanly
  assert.strictEqual(formatHeartbeatAge(null), 'No heartbeat');
  assert.strictEqual(formatHeartbeatAge('not-a-date'), 'No heartbeat');
  assert.strictEqual(formatHeartbeatAge(new Date(Date.now() - 3_000).toISOString()), 'Just now');
  assert.strictEqual(formatHeartbeatAge(new Date(Date.now() - 45_000).toISOString()), '45s ago');
  assert.strictEqual(formatHeartbeatAge(new Date(Date.now() - 5 * 60_000).toISOString()), '5m ago');
  console.log('[PASS] 5. formatHeartbeatAge handles null, invalid, and relative ages cleanly.');

  // 6. Static checks: no hardcoded legacy token leaks, FastAPI mock claims, or window.alert/confirm in components
  const bannedStrings = [
    'ts_bridge_live_sec_7a8f9b0c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7',
    'FastAPI WebSocket pipe',
    'FastAPI Billing Simulator',
    'ALPHA-XAU-2026',
    'SCALP-QUEEN-77',
    'window.alert(',
    'window.confirm(',
    'window.open(',
  ];

  const componentRoot = path.resolve(process.cwd(), 'src/components');
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) files.push(full);
    }
  }
  walk(componentRoot);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const banned of bannedStrings) {
      assert.strictEqual(
        content.includes(banned),
        false,
        `Found forbidden string "${banned}" in ${path.relative(process.cwd(), file)}`
      );
    }
  }
  console.log(`[PASS] 6. Scanned ${files.length} component files: zero hardcoded legacy secrets, FastAPI mock copy, mock invite codes, or window dialogs.`);

  console.log('\nALL DASHBOARD UI SAFETY TESTS PASSED.');
}

runTests();
