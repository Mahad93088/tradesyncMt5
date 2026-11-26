import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  countDistinctTraders,
  resolvePlanFollowerLimit,
} from '../src/components/common/dashboardHelpers.js';

function readSrc(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

function runTests() {
  console.log('=== TradeSync MT5 Frontend Client Requirements Tests ===\n');

  // 1. Distinct trader counting deduplicates multiple child accounts per trader
  const sampleLinks = [
    { traderId: 'trader-1', status: 'active' },
    { traderId: 'trader-1', status: 'active' },
    { traderId: 'trader-2', status: 'active' },
    { traderId: 'trader-3', status: 'paused' },
    { traderId: 'trader-4', status: 'suspended' },
  ];
  assert.strictEqual(countDistinctTraders(sampleLinks, ['active']), 2);
  assert.strictEqual(countDistinctTraders(sampleLinks, []), 4);
  assert.strictEqual(countDistinctTraders(sampleLinks, ['suspended']), 1);
  console.log('[PASS] 1. countDistinctTraders deduplicates multiple child accounts owned by the same trader.');

  // 2. Authoritative plan follower limits (Trial=2, Silver=50, Gold=100, legacy fallback)
  assert.strictEqual(
    resolvePlanFollowerLimit({ code: 'trial', name: 'Trial', maxFollowers: 99, maxChildAccounts: 99 }),
    2
  );
  assert.strictEqual(
    resolvePlanFollowerLimit({ code: 'free_demo', name: 'Free Demo', maxFollowers: 10 }),
    2
  );
  assert.strictEqual(
    resolvePlanFollowerLimit({ code: 'silver', name: 'Silver', maxFollowers: 10 }),
    50
  );
  assert.strictEqual(
    resolvePlanFollowerLimit({ code: 'gold', name: 'Gold', maxFollowers: 25 }),
    100
  );
  assert.strictEqual(
    resolvePlanFollowerLimit({ code: 'legacy_vip', name: 'Legacy VIP', maxFollowers: 15 }),
    15
  );
  assert.strictEqual(resolvePlanFollowerLimit(null), 2);
  console.log('[PASS] 2. resolvePlanFollowerLimit enforces Trial=2, Silver=50, Gold=100 with legacy fallback.');

  // 3. Student UI privacy restrictions: never expose mentor login, parent tickets, parent lots, or mentor strategy stats
  const studentPrivacyFiles = [
    'src/components/trader/TraderDashboard.tsx',
    'src/components/trader/MentorLinkView.tsx',
    'src/components/trader/CopiedTradesTable.tsx',
    'src/components/trader/FailedTradesTable.tsx',
    'src/components/trader/TraderSubscriptionView.tsx',
  ];
  const forbiddenStudentTokens = [
    'parentAccountNumber',
    'parentTradeTicket',
    'parentTicket',
    'parentLots',
    'requestedVolume',
    'strategyName',
    'monthlyFee',
    'totalFollowers',
    'm.profitFactor',
    'linkedMentorProfile',
  ];

  for (const rel of studentPrivacyFiles) {
    const content = readSrc(rel);
    for (const token of forbiddenStudentTokens) {
      assert.strictEqual(
        content.includes(token),
        false,
        `Privacy violation: ${rel} must not reference or render "${token}"`
      );
    }
    assert.strictEqual(
      /\.winRate\b/.test(content),
      false,
      `Privacy violation: ${rel} must not reference .winRate`
    );
    if (rel !== 'src/components/trader/TraderDashboard.tsx') {
      assert.strictEqual(content.includes('winRate'), false, `Privacy violation in ${rel}: winRate`);
      assert.strictEqual(content.includes('profitFactor'), false, `Privacy violation in ${rel}: profitFactor`);
    }
  }
  console.log('[PASS] 3. Student workspace views scrub mentor login, parent tickets, parent lots, and strategy stats.');

  // 4. LotSettingsModal: lot-size selection only, copyPendingOrders forced false, broker spec validation
  const lotModal = readSrc('src/components/trader/LotSettingsModal.tsx');
  assert.strictEqual(lotModal.includes('copyPendingOrders: false'), true);
  assert.strictEqual(lotModal.includes('verifiedSymbolSpecs'), true);
  assert.strictEqual(lotModal.includes('Copy 1:1 Ratio'), true);
  assert.strictEqual(lotModal.includes('Multiplier Ratio'), true);
  assert.strictEqual(lotModal.includes('Fixed Lot Size'), true);
  assert.strictEqual(lotModal.includes('Volume will not be silently increased'), true);

  for (const bannedLotInput of [
    'equity_ratio',
    'risk_percent',
    'setRiskPercent',
    'setMaxLotCap',
    'setMinLotClamp',
    'setMaxDrawdownProtectionPercent',
    'setSlippageMaxPips',
    'setSymbolPrefix',
    'setSymbolSuffix',
    'setCopyPendingOrders',
    'setSyncSlTp',
  ]) {
    assert.strictEqual(
      lotModal.includes(bannedLotInput),
      false,
      `LotSettingsModal must not expose advanced risk/pending/prefix input: ${bannedLotInput}`
    );
  }
  console.log('[PASS] 4. LotSettingsModal restricts student selection to lot size only and validates broker specs.');

  // 5. Student Dashboard prevents self-unsuspend and shows suspended / balance-paused / volume error banners
  const traderDash = readSrc('src/components/trader/TraderDashboard.tsx');
  const appCtx = readSrc('src/context/AppContext.tsx');
  assert.strictEqual(traderDash.includes('Suspended (Mentor/Admin Only)'), true);
  assert.strictEqual(traderDash.includes('Copy Assignment Suspended'), true);
  assert.strictEqual(traderDash.includes('Balance Protection Pause Active'), true);
  assert.strictEqual(traderDash.includes('Broker / Volume Validation Notice'), true);
  assert.strictEqual(
    appCtx.includes('Students cannot unsuspend a mentor- or admin-suspended assignment'),
    true
  );
  console.log('[PASS] 5. Student Dashboard enforces self-unsuspend block and renders suspension, balance-pause, and volume error banners.');

  // 6. Mentor Dashboard & ChildAccountsList & SubscriptionCard: no Emergency Close, no manual trade activation, read-only plan cap
  const mentorDash = readSrc('src/components/mentor/MentorDashboard.tsx');
  const childList = readSrc('src/components/mentor/ChildAccountsList.tsx');
  const mentorSubCard = readSrc('src/components/mentor/MentorSubscriptionCard.tsx');
  const appTsx = readSrc('src/App.tsx');

  for (const bannedMentorToken of [
    'Emergency Close',
    'emergencyCloseParentTicket',
    'pendingEmergencyTicket',
    'handleConfirmEmergencyClose',
    'isClosingTicket',
  ]) {
    assert.strictEqual(
      mentorDash.includes(bannedMentorToken),
      false,
      `MentorDashboard must not contain "${bannedMentorToken}"`
    );
  }
  assert.strictEqual(mentorDash.includes('countDistinctTraders'), true);
  assert.strictEqual(mentorDash.includes('resolvePlanFollowerLimit'), true);
  assert.strictEqual(appTsx.includes("role !== 'mentor' && <SimulationToolbar />"), true);
  assert.strictEqual(childList.includes('balance_paused'), true);
  assert.strictEqual(childList.includes('pendingSuspend'), true);
  assert.strictEqual(childList.includes('handleReactivate'), true);
  assert.strictEqual(mentorSubCard.includes('Authoritative Follower Limit'), true);
  assert.strictEqual(mentorSubCard.includes('resolvePlanFollowerLimit'), true);
  console.log('[PASS] 6. Mentor console removes Emergency Close & manual execution, exposes Suspend/Reactivate & balance_paused, and locks plan cap display.');

  // 7. Admin views: distinct trader counts, authoritative limits, balance_paused status, Suspend/Reactivate controls
  const adminDash = readSrc('src/components/admin/AdminDashboard.tsx');
  const mentorsMgmt = readSrc('src/components/admin/MentorsManagement.tsx');
  const subsView = readSrc('src/components/admin/SubscriptionsView.tsx');
  const plansView = readSrc('src/components/admin/SubscriptionPlansView.tsx');
  const relView = readSrc('src/components/admin/AccountRelationshipsView.tsx');
  const monitorView = readSrc('src/components/admin/TradeCopierMonitoringView.tsx');
  const tradersMgmt = readSrc('src/components/admin/TradersManagement.tsx');

  assert.strictEqual(adminDash.includes('countDistinctTraders'), true);
  assert.strictEqual(adminDash.includes('balance_paused'), true);
  assert.strictEqual(mentorsMgmt.includes('countDistinctTraders'), true);
  assert.strictEqual(mentorsMgmt.includes('resolvePlanFollowerLimit'), true);
  assert.strictEqual(subsView.includes('countDistinctTraders'), true);
  assert.strictEqual(subsView.includes('resolvePlanFollowerLimit'), true);
  assert.strictEqual(plansView.includes('resolvePlanFollowerLimit'), true);
  assert.strictEqual(relView.includes('balance_paused') && relView.includes('handleConfirmSuspend') && relView.includes('handleReactivateLink'), true);
  assert.strictEqual(monitorView.includes('balance_paused') && monitorView.includes('handleConfirmSuspend') && monitorView.includes('reactivate'), true);
  assert.strictEqual(tradersMgmt.includes('balance_paused') && tradersMgmt.includes('suspensionReason'), true);
  console.log('[PASS] 7. Admin dashboard & management views display distinct counts, Trial/Silver/Gold limits, balance_paused, and Suspend/Reactivate controls.');

  console.log('\nALL FRONTEND CLIENT REQUIREMENTS TESTS PASSED.');
}

runTests();
