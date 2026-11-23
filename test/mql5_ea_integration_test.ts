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
  audit_logs: Record<string, any>[];
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function checkBalancedDelimiters(src: string): { braces: number; parens: number } {
  let braces = 0;
  let parens = 0;
  let inString = false;
  let inChar = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1] || '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (inChar) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === "'") {
        inChar = false;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "'") {
      inChar = true;
      continue;
    }
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '(') parens++;
    else if (ch === ')') parens--;
  }
  return { braces, parens };
}

function splitTopLevelCommas(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      parts.push(expr.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(expr.slice(start).trim());
  return parts.filter(Boolean);
}

function evalFilterAtom(row: Record<string, any>, atom: string): boolean {
  if (atom.startsWith('and(') && atom.endsWith(')')) {
    return splitTopLevelCommas(atom.slice(4, -1)).every((sub) => evalFilterAtom(row, sub));
  }
  const eqMatch = atom.match(/^([a-z_]+)\.eq\.(.+)$/i);
  if (eqMatch) return String(row[eqMatch[1]]) === eqMatch[2];
  const ltMatch = atom.match(/^([a-z_]+)\.lt\.(.+)$/i);
  if (ltMatch) return row[ltMatch[1]] != null && String(row[ltMatch[1]]) < ltMatch[2];
  return false;
}

function createMockSupabase(state: DbState) {
  const applyFilters = (
    rows: Record<string, any>[],
    filters: Array<{ op: string; col?: string; val?: any; expr?: string }>
  ) =>
    rows.filter((row) =>
      filters.every((f) => {
        if (f.op === 'eq') return row[f.col!] === f.val;
        if (f.op === 'neq') return row[f.col!] !== f.val;
        if (f.op === 'lt') return row[f.col!] != null && row[f.col!] < f.val;
        if (f.op === 'is') return row[f.col!] === f.val;
        if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(row[f.col!]);
        if (f.op === 'or' && f.expr) {
          return splitTopLevelCommas(f.expr).some((part) => evalFilterAtom(row, part));
        }
        return true;
      })
    );

  return {
    from(tableName: keyof DbState) {
      const filters: Array<{ op: string; col?: string; val?: any; expr?: string }> = [];
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitNum: number | null = null;
      let mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
      let payload: any = null;
      let upsertOnConflict: string | null = null;

      const execute = async () => {
        const table = state[tableName];
        if (!table) return { data: null, error: { message: `Table ${String(tableName)} not found` } };

        if (mode === 'insert') {
          const items = Array.isArray(payload) ? payload : [payload];
          const inserted = items.map((item) => {
            const copy = { id: item.id || crypto.randomUUID(), created_at: new Date().toISOString(), ...item };
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
              const copy = { id: item.id || crypto.randomUUID(), created_at: new Date().toISOString(), ...item };
              table.push(copy);
              out.push({ ...copy });
            }
          }
          return { data: out, error: null };
        }
        if (mode === 'update') {
          const matched = applyFilters(table, filters);
          for (const row of matched) Object.assign(row, payload);
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
        if (limitNum !== null) matched = matched.slice(0, limitNum);
        return { data: matched.map((r) => ({ ...r })), error: null };
      };

      const builder: any = {
        select() {
          if (!['insert', 'update', 'upsert', 'delete'].includes(mode)) mode = 'select';
          return builder;
        },
        insert(v: any) { mode = 'insert'; payload = v; return builder; },
        upsert(v: any, o?: { onConflict?: string }) { mode = 'upsert'; payload = v; upsertOnConflict = o?.onConflict || null; return builder; },
        update(v: any) { mode = 'update'; payload = v; return builder; },
        delete() { mode = 'delete'; return builder; },
        eq(col: string, val: any) { filters.push({ op: 'eq', col, val }); return builder; },
        neq(col: string, val: any) { filters.push({ op: 'neq', col, val }); return builder; },
        lt(col: string, val: any) { filters.push({ op: 'lt', col, val }); return builder; },
        is(col: string, val: any) { filters.push({ op: 'is', col, val }); return builder; },
        in(col: string, val: any[]) { filters.push({ op: 'in', col, val }); return builder; },
        or(expr: string) { filters.push({ op: 'or', expr }); return builder; },
        order(col: string, o?: { ascending?: boolean }) { orderCol = col; orderAsc = o?.ascending !== false; return builder; },
        limit(n: number) { limitNum = n; return builder; },
        maybeSingle: async () => { const r = await execute(); return r.error ? r : { data: r.data?.[0] || null, error: null }; },
        single: async () => {
          const r = await execute();
          if (r.error) return r;
          if (!r.data || r.data.length === 0) return { data: null, error: { message: 'Row not found' } };
          return { data: r.data[0], error: null };
        },
        then(resolve: any, reject: any) { return execute().then(resolve, reject); },
      };
      return builder;
    },
  };
}

async function runTests() {
  console.log('=== MQL5 EA Integration, Payload & Safety Verification Tests ===');

  const broadcasterSrc = fs.readFileSync(path.resolve(process.cwd(), 'public/mql5/TradeSync_Broadcaster.mq5'), 'utf8');
  const receiverSrc = fs.readFileSync(path.resolve(process.cwd(), 'public/mql5/TradeSync_Receiver.mq5'), 'utf8');

  // -------------------------------------------------------------------------
  // 1. Structural & Static Contract Verification for Both EAs
  // -------------------------------------------------------------------------
  const bDelims = checkBalancedDelimiters(broadcasterSrc);
  assert.strictEqual(bDelims.braces, 0, `Broadcaster braces unbalanced: ${bDelims.braces}`);
  assert.strictEqual(bDelims.parens, 0, `Broadcaster parens unbalanced: ${bDelims.parens}`);

  const rDelims = checkBalancedDelimiters(receiverSrc);
  assert.strictEqual(rDelims.braces, 0, `Receiver braces unbalanced: ${rDelims.braces}`);
  assert.strictEqual(rDelims.parens, 0, `Receiver parens unbalanced: ${rDelims.parens}`);

  // Broadcaster requirements
  assert.ok(broadcasterSrc.includes('EnsureDemoAccount("OnTradeTransaction")'));
  assert.ok(broadcasterSrc.includes('ACCOUNT_TRADE_MODE_DEMO'));
  assert.ok(broadcasterSrc.includes('BuildSymbolSpecsJson()'));
  assert.ok(broadcasterSrc.includes('SYMBOL_VOLUME_MIN'));
  assert.ok(broadcasterSrc.includes('SYMBOL_VOLUME_MAX'));
  assert.ok(broadcasterSrc.includes('SYMBOL_VOLUME_STEP'));
  assert.ok(broadcasterSrc.includes('FormatUtcIso8601(TimeGMT())'));
  assert.ok(broadcasterSrc.includes('NextEventSeq()'));
  assert.ok(broadcasterSrc.includes('TS_BCAST_SEQ_'));
  assert.ok(broadcasterSrc.includes('\\"eventTimestamp\\":\\"%s\\"'));
  assert.ok(broadcasterSrc.includes('\\"eventSeq\\":%I64u'));
  assert.ok(broadcasterSrc.includes('\\"symbolSpecs\\":%s'));

  // Verify OnInit never scans/backfills historical deals
  const bInitStart = broadcasterSrc.indexOf('int OnInit()');
  const bInitEnd = broadcasterSrc.indexOf('void OnDeinit(');
  const bOnInitBody = broadcasterSrc.slice(bInitStart, bInitEnd);
  assert.strictEqual(bOnInitBody.includes('HistoryDealsTotal'), false, 'Broadcaster OnInit must not backfill historical deals');
  assert.strictEqual(bOnInitBody.includes('HistorySelect'), false, 'Broadcaster OnInit must not replay deal history');

  // Receiver requirements
  assert.ok(receiverSrc.includes('ACCOUNT_TRADE_MODE_DEMO'));
  assert.ok(receiverSrc.includes('#define RECEIVER_HEARTBEAT_INTERVAL_SEC 30'));
  assert.ok(receiverSrc.includes('BuildSymbolSpecsJson()'));
  assert.ok(receiverSrc.includes('SYMBOL_VOLUME_MIN'));
  assert.ok(receiverSrc.includes('SYMBOL_VOLUME_MAX'));
  assert.ok(receiverSrc.includes('SYMBOL_VOLUME_STEP'));
  assert.ok(receiverSrc.includes('PositionClosePartial(childTicket, closeVol, maxSlipPoints)'));
  assert.ok(receiverSrc.includes('PositionClose(childTicket, maxSlipPoints)'));
  assert.ok(receiverSrc.includes('MapBrokerRejectStatus'));
  assert.ok(receiverSrc.includes('LoadProcessedCacheFromDisk()'));
  assert.ok(receiverSrc.includes('PersistProcessedCacheToDisk()'));
  assert.ok(receiverSrc.includes('if(reconnectedAfterError)'));
  assert.ok(receiverSrc.includes('(orderType != "BUY" && orderType != "SELL")'));
  assert.strictEqual(receiverSrc.includes('ORDER_TYPE_BUY_LIMIT'), false);
  assert.strictEqual(receiverSrc.includes('lots = minLot'), false);

  console.log('[PASS] 1. Static MQL5 syntax balance, demo-only guards, symbolSpecs, partial close & reconnect persistence verified.');

  // -------------------------------------------------------------------------
  // 2. End-to-End Backend API Contract Simulation Using Exact EA JSON Formats
  // -------------------------------------------------------------------------
  const mentorId = '22222222-0000-4000-8000-000000000001';
  const traderId = '33333333-0000-4000-8000-000000000001';
  const parentAccId = '44444444-0000-4000-8000-000000000001';
  const childAccId = '55555555-0000-4000-8000-000000000001';
  const parentToken = 'ts_parent_mql5_contract_001';
  const childToken = 'ts_child_mql5_contract_001';
  const nowIso = new Date().toISOString();

  const state: DbState = {
    profiles: [
      { id: mentorId, email: 'mentor@ea.test', full_name: 'Mentor EA', role: 'mentor', status: 'active' },
      { id: traderId, email: 'trader@ea.test', full_name: 'Trader EA', role: 'trader', status: 'active' },
    ],
    mt5_accounts: [
      {
        id: parentAccId,
        user_id: mentorId,
        account_number: '880011',
        broker_server: 'Demo-MT5',
        broker_name: 'MetaQuotes',
        account_role: 'parent',
        account_type: 'demo',
        connection_status: 'disconnected',
        terminal_token_hash: hashToken(parentToken),
      },
      {
        id: childAccId,
        user_id: traderId,
        account_number: '880022',
        broker_server: 'Demo-MT5',
        broker_name: 'MetaQuotes',
        account_role: 'child',
        account_type: 'demo',
        connection_status: 'disconnected',
        verified_symbol_specs: {},
        terminal_token_hash: hashToken(childToken),
      },
    ],
    mentor_assignments: [
      {
        id: crypto.randomUUID(),
        mentor_id: mentorId,
        trader_id: traderId,
        parent_account_id: parentAccId,
        child_account_id: childAccId,
        status: 'active',
        balance_pause_active: false,
        lot_mode: 'multiplier',
        lot_multiplier: 0.5,
        fixed_lot: 0.1,
        risk_percent: 1.0,
        max_lot_cap: 100,
        min_lot_clamp: 0.01,
        slippage_max_pips: 3,
        max_drawdown_percent: 0,
        sync_sl_tp: true,
        copy_pending_orders: false,
        activated_at: new Date(Date.now() - 10_000).toISOString(),
        activation_epoch: 1,
      },
    ],
    subscription_plans: [{ id: 'plan-trial', code: 'trial', name: 'Trial', max_followers: 2 }],
    subscriptions: [{ id: 'sub-1', mentor_id: mentorId, user_id: mentorId, plan_id: 'plan-trial', status: 'trial', current_period_end: new Date(Date.now() + 86400_000).toISOString() }],
    bridge_instructions: [],
    trade_mappings: [],
    bridge_sync_logs: [],
    trades: [],
    audit_logs: [],
  };

  const mockDb = createMockSupabase(state);
  const app = createApiApp({
    serviceRoleClientOverride: mockDb as any,
    supabaseUrlOverride: 'https://example.supabase.co',
    serviceRoleKeyOverride: 'service-role-test-key',
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    // 2a. Exact Broadcaster Heartbeat JSON payload
    const bHbJson = JSON.stringify({
      account_number: '880011',
      tradeMode: 'DEMO',
      balance: 10000.00,
      equity: 10000.00,
      margin: 0.00,
      freeMargin: 10000.00,
      autoTradingEnabled: true,
      eventTimestamp: nowIso.replace(/\.\d{3}Z$/, 'Z'),
      eventSeq: 1795430000001,
      symbolSpecs: {
        EURUSD: { minLot: 0.0100, maxLot: 100.0000, lotStep: 0.0100, contractSize: 100000.00, digits: 5 },
      },
    });
    const bHbRes = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-Token': parentToken,
        'X-Account-Number': '880011',
      },
      body: bHbJson,
    });
    assert.strictEqual(bHbRes.status, 200);
    assert.strictEqual(state.mt5_accounts[0].verified_symbol_specs.EURUSD.lotStep, 0.01);

    // 2b. Exact Receiver Heartbeat JSON payload (with symbolSpecs + verified balance/equity)
    const rHbJson = JSON.stringify({
      account_number: '880022',
      tradeMode: 'DEMO',
      balance: 2500.00,
      equity: 2500.00,
      margin: 0.00,
      freeMargin: 2500.00,
      autoTradingEnabled: true,
      eventTimestamp: nowIso.replace(/\.\d{3}Z$/, 'Z'),
      symbolSpecs: {
        EURUSD: { minLot: 0.0100, maxLot: 100.0000, lotStep: 0.0100, contractSize: 100000.00, digits: 5 },
      },
    });
    const rHbRes = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Terminal-Token': childToken,
        'X-Account-Number': '880022',
      },
      body: rHbJson,
    });
    assert.strictEqual(rHbRes.status, 200);
    assert.strictEqual(state.mt5_accounts[1].verified_balance, 2500);
    assert.strictEqual(state.mt5_accounts[1].verified_symbol_specs.EURUSD.minLot, 0.01);

    // 2c. Pre-activation eventTimestamp from Broadcaster is safely filtered out
    const preActOpenRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken, 'X-Account-Number': '880011' },
      body: JSON.stringify({
        account_number: '880011',
        ticket: '500001',
        symbol: 'EURUSD',
        type: 'BUY',
        lots: 1.00,
        openPrice: 1.10000,
        sl: 1.09500,
        tp: 1.11000,
        magicNumber: '0',
        comment: 'TradeSync Broadcaster',
        eventTimestamp: new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        eventSeq: 1795430000002,
      }),
    });
    assert.strictEqual(preActOpenRes.status, 200);
    assert.strictEqual((await preActOpenRes.json()).childInstructionsQueued, 0);

    // 2d. Valid post-activation Trade Open -> Receiver polls & ACKs -> Partial Close -> Modify -> Full Close
    const validOpenRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken, 'X-Account-Number': '880011' },
      body: JSON.stringify({
        account_number: '880011',
        ticket: '500002',
        symbol: 'EURUSD',
        type: 'BUY',
        lots: 1.00,
        openPrice: 1.10000,
        sl: 1.09500,
        tp: 1.11000,
        magicNumber: '0',
        comment: 'TradeSync Broadcaster',
        eventTimestamp: new Date(Date.now() + 5_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        eventSeq: 1795430000003,
      }),
    });
    assert.strictEqual(validOpenRes.status, 200);
    const openJson: any = await validOpenRes.json();
    assert.strictEqual(openJson.childInstructionsQueued, 1);
    assert.strictEqual(openJson.instructions[0].lots, 0.5);

    const pollOpenRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/pending`, {
      headers: { 'X-Terminal-Token': childToken, 'X-Account-Number': '880022' },
    });
    const pollOpenJson: any = await pollOpenRes.json();
    assert.strictEqual(pollOpenJson.instructions.length, 1);
    const openInstId = pollOpenJson.instructions[0].instructionId;

    // Receiver ACKs OPEN
    const ackOpenRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childToken, 'X-Account-Number': '880022' },
      body: JSON.stringify({
        account_number: '880022',
        instructionId: openInstId,
        status: 'EXECUTED',
        childTicket: '990002',
        fillPrice: 1.10010,
        brokerErrorCode: 10009,
        brokerErrorMessage: 'OK',
        executionLatencyMs: 14,
        executedLots: 0.50,
      }),
    });
    assert.strictEqual(ackOpenRes.status, 200);

    // Duplicate ACK after simulated reconnect must return duplicate: true safely
    const dupAckRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childToken, 'X-Account-Number': '880022' },
      body: JSON.stringify({
        account_number: '880022',
        instructionId: openInstId,
        status: 'EXECUTED',
        childTicket: '990002',
        fillPrice: 1.10010,
        brokerErrorCode: 10009,
        brokerErrorMessage: 'OK',
        executionLatencyMs: 14,
        executedLots: 0.50,
      }),
    });
    assert.strictEqual(dupAckRes.status, 200);
    assert.strictEqual((await dupAckRes.json()).duplicate, true);

    // Broadcaster sends SL/TP modification -> Receiver polls MODIFY & ACKs
    const modifyRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-modify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken, 'X-Account-Number': '880011' },
      body: JSON.stringify({
        account_number: '880011',
        ticket: '500002',
        sl: 1.09800,
        tp: 1.11200,
        eventTimestamp: new Date(Date.now() + 7_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        eventSeq: 1795430000004,
      }),
    });
    assert.strictEqual(modifyRes.status, 200);
    const pollModRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/pending`, {
      headers: { 'X-Terminal-Token': childToken, 'X-Account-Number': '880022' },
    });
    const modInst = (await pollModRes.json()).instructions[0];
    assert.strictEqual(modInst.action, 'MODIFY');
    assert.strictEqual(modInst.sl, 1.098);
    assert.strictEqual(modInst.tp, 1.112);

    const ackModRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childToken, 'X-Account-Number': '880022' },
      body: JSON.stringify({
        account_number: '880022',
        instructionId: modInst.instructionId,
        status: 'EXECUTED',
        childTicket: '990002',
        fillPrice: 0.0,
        brokerErrorCode: 10009,
        brokerErrorMessage: 'SL/TP modified',
        executionLatencyMs: 6,
      }),
    });
    assert.strictEqual(ackModRes.status, 200);

    // Broadcaster sends PARTIAL close (0.50 closed / 0.50 remaining) -> Child gets 0.25 partial close
    const partialCloseRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken, 'X-Account-Number': '880011' },
      body: JSON.stringify({
        account_number: '880011',
        ticket: '500002',
        dealTicket: '777111',
        closePrice: 1.10250,
        closeType: 'PARTIAL',
        closedLots: 0.50,
        remainingLots: 0.50,
        totalLots: 1.00,
        realizedProfit: 125.00,
        commission: -3.50,
        swap: 0.00,
        eventTimestamp: new Date(Date.now() + 8_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        eventSeq: 1795430000005,
      }),
    });
    assert.strictEqual(partialCloseRes.status, 200);
    const partialJson: any = await partialCloseRes.json();
    assert.strictEqual(partialJson.closeType, 'PARTIAL');
    assert.strictEqual(partialJson.instructions[0].lots, 0.25);

    const pollPartialRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/pending`, {
      headers: { 'X-Terminal-Token': childToken, 'X-Account-Number': '880022' },
    });
    const partialInst = (await pollPartialRes.json()).instructions[0];
    assert.strictEqual(partialInst.action, 'CLOSE');
    assert.strictEqual(partialInst.lots, 0.25);

    // Receiver ACKs partial close (PositionClosePartial executed 0.25 lots)
    const ackPartialRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childToken, 'X-Account-Number': '880022' },
      body: JSON.stringify({
        account_number: '880022',
        instructionId: partialInst.instructionId,
        status: 'EXECUTED',
        childTicket: '990002',
        fillPrice: 1.10250,
        brokerErrorCode: 10009,
        brokerErrorMessage: 'Partial close executed',
        executionLatencyMs: 11,
        executedLots: 0.25,
        closePrice: 1.10250,
        realizedProfit: 62.50,
        commission: -1.75,
        swap: 0.00,
      }),
    });
    assert.strictEqual(ackPartialRes.status, 200);
    assert.strictEqual(state.trade_mappings[0].child_remaining_lots, 0.25);
    assert.strictEqual(state.trade_mappings[0].status, 'EXECUTED');

    // Broadcaster sends FULL close for remaining 0.50 -> Receiver gets 0.25 FULL close & ACKs
    const fullCloseRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken, 'X-Account-Number': '880011' },
      body: JSON.stringify({
        account_number: '880011',
        ticket: '500002',
        dealTicket: '777112',
        closePrice: 1.10400,
        closeType: 'FULL',
        closedLots: 0.50,
        remainingLots: 0.00,
        totalLots: 0.50,
        realizedProfit: 200.00,
        commission: -3.50,
        swap: 0.00,
        eventTimestamp: new Date(Date.now() + 10_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        eventSeq: 1795430000006,
      }),
    });
    assert.strictEqual(fullCloseRes.status, 200);
    const fullInst = (await (await fetch(`${baseUrl}/api/v1/bridge/instructions/pending`, {
      headers: { 'X-Terminal-Token': childToken, 'X-Account-Number': '880022' },
    })).json()).instructions[0];
    assert.strictEqual(fullInst.lots, 0.25);

    const ackFullRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childToken, 'X-Account-Number': '880022' },
      body: JSON.stringify({
        account_number: '880022',
        instructionId: fullInst.instructionId,
        status: 'EXECUTED',
        childTicket: '990002',
        fillPrice: 1.10400,
        brokerErrorCode: 10009,
        brokerErrorMessage: 'Closed successfully',
        executionLatencyMs: 9,
        executedLots: 0.25,
        closePrice: 1.10400,
        realizedProfit: 100.00,
        commission: -1.75,
        swap: 0.00,
      }),
    });
    assert.strictEqual(ackFullRes.status, 200);
    assert.strictEqual(state.trade_mappings[0].status, 'CLOSED');

    // Pending orders must not be copied
    const pendingOrderRejectRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken, 'X-Account-Number': '880011' },
      body: JSON.stringify({
        account_number: '880011',
        ticket: '500003',
        symbol: 'EURUSD',
        type: 'BUY_LIMIT',
        lots: 1.00,
        openPrice: 1.09000,
        eventTimestamp: new Date(Date.now() + 11_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        eventSeq: 1795430000007,
      }),
    });
    assert.strictEqual(pendingOrderRejectRes.status, 200);
    const pendingOrderJson: any = await pendingOrderRejectRes.json();
    assert.strictEqual(pendingOrderJson.childInstructionsQueued, 0);

    // Below-minLot trade-open does not silently increase volume
    const belowMinOpenRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken, 'X-Account-Number': '880011' },
      body: JSON.stringify({
        account_number: '880011',
        ticket: '500004',
        symbol: 'EURUSD',
        type: 'SELL',
        lots: 0.01,
        openPrice: 1.10000,
        eventTimestamp: new Date(Date.now() + 12_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        eventSeq: 1795430000008,
      }),
    });
    assert.strictEqual(belowMinOpenRes.status, 200);
    const belowMinJson: any = await belowMinOpenRes.json();
    assert.strictEqual(belowMinJson.childInstructionsQueued, 0);

    // Receiver broker rejection ACK (REJECTED_MARGIN) updates instruction/mapping accurately
    const marginOpenRes = await fetch(`${baseUrl}/api/v1/bridge/events/trade-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': parentToken, 'X-Account-Number': '880011' },
      body: JSON.stringify({
        account_number: '880011',
        ticket: '500005',
        symbol: 'EURUSD',
        type: 'SELL',
        lots: 0.50,
        openPrice: 1.10000,
        eventTimestamp: new Date(Date.now() + 13_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        eventSeq: 1795430000009,
      }),
    });
    assert.strictEqual(marginOpenRes.status, 200);
    const marginInst = (await (await fetch(`${baseUrl}/api/v1/bridge/instructions/pending`, {
      headers: { 'X-Terminal-Token': childToken, 'X-Account-Number': '880022' },
    })).json()).instructions[0];
    assert.strictEqual(marginInst.lots, 0.25);

    const rejectAckRes = await fetch(`${baseUrl}/api/v1/bridge/instructions/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Terminal-Token': childToken, 'X-Account-Number': '880022' },
      body: JSON.stringify({
        account_number: '880022',
        instructionId: marginInst.instructionId,
        status: 'REJECTED_MARGIN',
        childTicket: '0',
        fillPrice: 0.0,
        brokerErrorCode: 10019,
        brokerErrorMessage: 'No money',
        executionLatencyMs: 5,
      }),
    });
    assert.strictEqual(rejectAckRes.status, 200);
    const rejectedInstRow = state.bridge_instructions.find((i) => i.id === marginInst.instructionId);
    const rejectedMapRow = state.trade_mappings.find((m) => m.parent_trade_ticket === '500005');
    assert.strictEqual(rejectedInstRow?.status, 'FAILED');
    assert.strictEqual(rejectedMapRow?.status, 'REJECTED_MARGIN');
    assert.strictEqual(rejectedMapRow?.error_message, 'No money');

    console.log('[PASS] 2. End-to-end Broadcaster & Receiver JSON contracts (heartbeat, modify, partial/full close, pending-order block, volume limit, broker reject ACK, reconnect ACK) verified.');
    console.log('\nALL MQL5 EA INTEGRATION & CONTRACT TESTS PASSED (2/2 groups).');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
