import type { Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingRelationError, writeAuditLog } from './billingService.ts';
import type { Day2RouteContext } from './day2Routes.ts';

export interface BrokerSymbolDTO {
  id: string;
  brokerId: string;
  symbolCode: string;
  assetClass: string;
  baseCurrency: string;
  quoteCurrency: string;
  isActive: boolean;
  isVerified: boolean;
  verificationNotes?: string;
}

export interface BrokerDTO {
  id: string;
  name: string;
  slug: string;
  serverPrefixes: string[];
  isActive: boolean;
  notes?: string;
  symbols: BrokerSymbolDTO[];
}

// Baseline unverified catalog returned ONLY as read-only fallback if Migration 10 is not yet executed.
// Marked strictly isVerified: false so users know terminal verification has not run yet.
export const UNVERIFIED_BASELINE_BROKERS: BrokerDTO[] = [
  {
    id: 'baseline-xm-global',
    name: 'XM Global',
    slug: 'xm_global',
    serverPrefixes: ['XMGlobal-MT5', 'xmglobal_mt5'],
    isActive: true,
    notes: 'Baseline unverified Gold symbols — confirm exact symbol spelling inside MetaTrader Market Watch.',
    symbols: [
      { id: 'sym-xm-gold', brokerId: 'baseline-xm-global', symbolCode: 'GOLD', assetClass: 'Metals', baseCurrency: 'XAU', quoteCurrency: 'USD', isActive: true, isVerified: false, verificationNotes: 'Baseline unverified — confirm in MT5 Market Watch.' },
      { id: 'sym-xm-xauusd', brokerId: 'baseline-xm-global', symbolCode: 'XAUUSD', assetClass: 'Metals', baseCurrency: 'XAU', quoteCurrency: 'USD', isActive: true, isVerified: false, verificationNotes: 'Baseline unverified — confirm in MT5 Market Watch.' },
    ],
  },
  {
    id: 'baseline-ic-markets',
    name: 'IC Markets',
    slug: 'ic_markets',
    serverPrefixes: ['ICMarketsSC-Demo', 'ICMarkets-Demo'],
    isActive: true,
    notes: 'Baseline unverified Gold symbols — confirm exact symbol spelling inside MetaTrader Market Watch.',
    symbols: [
      { id: 'sym-ic-xauusd', brokerId: 'baseline-ic-markets', symbolCode: 'XAUUSD', assetClass: 'Metals', baseCurrency: 'XAU', quoteCurrency: 'USD', isActive: true, isVerified: false, verificationNotes: 'Baseline unverified — confirm in MT5 Market Watch.' },
      { id: 'sym-ic-xauusd-a', brokerId: 'baseline-ic-markets', symbolCode: 'XAUUSD.a', assetClass: 'Metals', baseCurrency: 'XAU', quoteCurrency: 'USD', isActive: true, isVerified: false, verificationNotes: 'Baseline unverified — confirm in MT5 Market Watch.' },
    ],
  },
  {
    id: 'baseline-pepperstone',
    name: 'Pepperstone',
    slug: 'pepperstone',
    serverPrefixes: ['Pepperstone-Demo'],
    isActive: true,
    notes: 'Baseline unverified Gold symbols — confirm exact symbol spelling inside MetaTrader Market Watch.',
    symbols: [
      { id: 'sym-pep-xauusd', brokerId: 'baseline-pepperstone', symbolCode: 'XAUUSD', assetClass: 'Metals', baseCurrency: 'XAU', quoteCurrency: 'USD', isActive: true, isVerified: false, verificationNotes: 'Baseline unverified — confirm in MT5 Market Watch.' },
      { id: 'sym-pep-xauusd-p', brokerId: 'baseline-pepperstone', symbolCode: 'XAUUSD.p', assetClass: 'Metals', baseCurrency: 'XAU', quoteCurrency: 'USD', isActive: true, isVerified: false, verificationNotes: 'Baseline unverified — confirm in MT5 Market Watch.' },
    ],
  },
  {
    id: 'baseline-exness',
    name: 'Exness',
    slug: 'exness',
    serverPrefixes: ['Exness-MT5Trial'],
    isActive: true,
    notes: 'Baseline unverified Gold symbols — confirm exact symbol spelling inside MetaTrader Market Watch.',
    symbols: [
      { id: 'sym-ex-xauusd', brokerId: 'baseline-exness', symbolCode: 'XAUUSD', assetClass: 'Metals', baseCurrency: 'XAU', quoteCurrency: 'USD', isActive: true, isVerified: false, verificationNotes: 'Baseline unverified — confirm in MT5 Market Watch.' },
      { id: 'sym-ex-xauusdm', brokerId: 'baseline-exness', symbolCode: 'XAUUSDm', assetClass: 'Metals', baseCurrency: 'XAU', quoteCurrency: 'USD', isActive: true, isVerified: false, verificationNotes: 'Baseline unverified — confirm in MT5 Market Watch.' },
    ],
  },
  {
    id: 'baseline-metaquotes',
    name: 'MetaQuotes-Demo',
    slug: 'metaquotes_demo',
    serverPrefixes: ['MetaQuotes-Demo'],
    isActive: true,
    notes: 'Baseline unverified Gold symbol — confirm exact symbol spelling inside MetaTrader Market Watch.',
    symbols: [
      { id: 'sym-mq-xauusd', brokerId: 'baseline-metaquotes', symbolCode: 'XAUUSD', assetClass: 'Metals', baseCurrency: 'XAU', quoteCurrency: 'USD', isActive: true, isVerified: false, verificationNotes: 'Baseline unverified — confirm in MT5 Market Watch.' },
    ],
  },
];

function mapSymbolRow(s: any): BrokerSymbolDTO {
  return {
    id: s.id,
    brokerId: s.broker_id,
    symbolCode: s.symbol_code,
    assetClass: s.asset_class || 'Metals',
    baseCurrency: s.base_currency || 'XAU',
    quoteCurrency: s.quote_currency || 'USD',
    isActive: s.is_active !== false,
    isVerified: Boolean(s.is_verified),
    verificationNotes: s.verification_notes || '',
  };
}

function mapBrokerRow(b: any, symbols: BrokerSymbolDTO[]): BrokerDTO {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    serverPrefixes: Array.isArray(b.server_prefixes) ? b.server_prefixes : [],
    isActive: b.is_active !== false,
    notes: b.notes || '',
    symbols,
  };
}

async function fetchBrokersFromDb(
  dbClient: SupabaseClient,
  includeInactive: boolean
): Promise<{ brokers: BrokerDTO[]; schemaMissing: boolean; error?: string }> {
  const brokersQuery = dbClient.from('brokers').select('*').order('name', { ascending: true });
  const symbolsQuery = dbClient.from('broker_symbols').select('*').order('symbol_code', { ascending: true });

  const [bRes, sRes] = await Promise.all([
    includeInactive ? brokersQuery : brokersQuery.eq('is_active', true),
    includeInactive ? symbolsQuery : symbolsQuery.eq('is_active', true),
  ]);

  if (bRes.error) {
    if (isMissingRelationError(bRes.error)) {
      return { brokers: UNVERIFIED_BASELINE_BROKERS, schemaMissing: true };
    }
    return { brokers: [], schemaMissing: false, error: bRes.error.message };
  }

  if (sRes.error && !isMissingRelationError(sRes.error)) {
    return { brokers: [], schemaMissing: false, error: sRes.error.message };
  }

  const symByBroker = new Map<string, BrokerSymbolDTO[]>();
  for (const raw of sRes.data || []) {
    const mapped = mapSymbolRow(raw);
    const list = symByBroker.get(mapped.brokerId) || [];
    list.push(mapped);
    symByBroker.set(mapped.brokerId, list);
  }

  return {
    brokers: (bRes.data || []).map((b: any) => mapBrokerRow(b, symByBroker.get(b.id) || [])),
    schemaMissing: false,
  };
}

export function registerBrokerRoutes(ctx: Day2RouteContext): void {
  const { registerRoute, authenticateSupabaseCaller, requireServiceRoleClient, isValidUUID } = ctx;

  // Authenticated read endpoint for registration modals (all roles)
  registerRoute('get', '/api/v1/brokers', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const result = await fetchBrokersFromDb(dbClient, false);
      if (result.error) return res.status(500).json({ success: false, error: result.error });
      return res.status(200).json({
        success: true,
        brokers: result.brokers,
        schemaMissing: result.schemaMissing,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load brokers directory' });
    }
  });

  // Super Admin full broker list (including inactive)
  registerRoute('get', '/api/admin/brokers', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const result = await fetchBrokersFromDb(dbClient, true);
      if (result.error) return res.status(500).json({ success: false, error: result.error });
      return res.status(200).json({
        success: true,
        brokers: result.brokers,
        schemaMissing: result.schemaMissing,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load admin brokers directory' });
    }
  });

  // Create broker
  registerRoute('post', '/api/admin/brokers', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const b = req.body || {};
      const name = String(b.name || '').trim();
      const slug = String(b.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).trim();
      const serverPrefixes = Array.isArray(b.serverPrefixes)
        ? b.serverPrefixes.map((s: any) => String(s).trim()).filter(Boolean)
        : typeof b.serverPrefixes === 'string'
        ? b.serverPrefixes.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      const notes = typeof b.notes === 'string' ? b.notes.trim() : '';
      const isActive = b.isActive !== false;

      if (!name || !slug) {
        return res.status(400).json({ success: false, error: 'Broker name and slug are required.' });
      }

      const { data: inserted, error } = await dbClient
        .from('brokers')
        .insert([
          {
            name,
            slug,
            server_prefixes: serverPrefixes,
            notes,
            is_active: isActive,
          },
        ])
        .select('*')
        .single();

      if (error) {
        if (isMissingRelationError(error)) {
          return res.status(503).json({
            success: false,
            code: 'MIGRATION_10_REQUIRED',
            error: 'Brokers directory tables are not provisioned yet. Execute Migration 10 in Supabase first.',
          });
        }
        const isDuplicate = String(error.code || '') === '23505' || String(error.message || '').toLowerCase().includes('unique');
        return res.status(isDuplicate ? 409 : 500).json({
          success: false,
          code: isDuplicate ? 'DUPLICATE_BROKER' : undefined,
          error: isDuplicate ? `Broker "${name}" (${slug}) already exists.` : error.message,
        });
      }

      // Optionally create initial symbols if provided
      const createdSymbols: BrokerSymbolDTO[] = [];
      if (Array.isArray(b.symbols) && b.symbols.length > 0) {
        for (const sym of b.symbols) {
          const code = String(sym?.symbolCode || sym || '').trim();
          if (!code) continue;
          const { data: sRow } = await dbClient
            .from('broker_symbols')
            .insert([
              {
                broker_id: inserted.id,
                symbol_code: code,
                asset_class: String(sym?.assetClass || 'Metals'),
                base_currency: String(sym?.baseCurrency || 'XAU'),
                quote_currency: String(sym?.quoteCurrency || 'USD'),
                is_active: sym?.isActive !== false,
                is_verified: Boolean(sym?.isVerified),
                verification_notes: String(sym?.verificationNotes || '').trim(),
              },
            ])
            .select('*')
            .single();
          if (sRow) createdSymbols.push(mapSymbolRow(sRow));
        }
      }

      await writeAuditLog(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'BROKER_CREATED',
        targetType: 'brokers',
        targetId: inserted.id,
        result: 'success',
        details: `Created broker "${name}" (${slug}) with ${createdSymbols.length} symbol(s).`,
      });

      return res.status(201).json({
        success: true,
        broker: mapBrokerRow(inserted, createdSymbols),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to create broker' });
    }
  });

  // Update broker
  registerRoute('put', '/api/admin/brokers/:brokerId', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { brokerId } = req.params;
      if (!isValidUUID(brokerId)) return res.status(400).json({ success: false, error: 'Invalid brokerId UUID.' });

      const b = req.body || {};
      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      if (b.name !== undefined) {
        const clean = String(b.name).trim();
        if (!clean) return res.status(400).json({ success: false, error: 'Broker name cannot be empty.' });
        patch.name = clean;
      }
      if (b.serverPrefixes !== undefined) {
        patch.server_prefixes = Array.isArray(b.serverPrefixes)
          ? b.serverPrefixes.map((s: any) => String(s).trim()).filter(Boolean)
          : String(b.serverPrefixes).split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      if (b.notes !== undefined) patch.notes = String(b.notes || '').trim();
      if (typeof b.isActive === 'boolean') patch.is_active = b.isActive;

      const { data: updated, error } = await dbClient
        .from('brokers')
        .update(patch)
        .eq('id', brokerId)
        .select('*')
        .single();

      if (error) return res.status(500).json({ success: false, error: error.message });

      const { data: symRows } = await dbClient
        .from('broker_symbols')
        .select('*')
        .eq('broker_id', brokerId)
        .order('symbol_code', { ascending: true });

      await writeAuditLog(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'BROKER_UPDATED',
        targetType: 'brokers',
        targetId: brokerId,
        result: 'success',
        details: `Updated broker "${updated.name}".`,
      });

      return res.status(200).json({
        success: true,
        broker: mapBrokerRow(updated, (symRows || []).map(mapSymbolRow)),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to update broker' });
    }
  });

  // Deactivate / Delete broker
  registerRoute('delete', '/api/admin/brokers/:brokerId', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { brokerId } = req.params;
      if (!isValidUUID(brokerId)) return res.status(400).json({ success: false, error: 'Invalid brokerId UUID.' });

      const { data: updated, error } = await dbClient
        .from('brokers')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', brokerId)
        .select('*')
        .single();

      if (error) return res.status(500).json({ success: false, error: error.message });

      await writeAuditLog(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'BROKER_DEACTIVATED',
        targetType: 'brokers',
        targetId: brokerId,
        result: 'success',
        details: `Deactivated broker "${updated.name}" cleanly.`,
      });

      return res.status(200).json({ success: true, brokerId, isActive: false });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to deactivate broker' });
    }
  });

  // Add symbol to broker
  registerRoute('post', '/api/admin/brokers/:brokerId/symbols', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { brokerId } = req.params;
      if (!isValidUUID(brokerId)) return res.status(400).json({ success: false, error: 'Invalid brokerId UUID.' });

      const b = req.body || {};
      const symbolCode = String(b.symbolCode || '').trim();
      if (!symbolCode) return res.status(400).json({ success: false, error: 'symbolCode is required.' });

      const { data: brokerRow, error: bErr } = await dbClient
        .from('brokers')
        .select('id, name')
        .eq('id', brokerId)
        .maybeSingle();

      if (bErr) return res.status(500).json({ success: false, error: bErr.message });
      if (!brokerRow) return res.status(404).json({ success: false, error: 'Broker not found.' });

      const { data: inserted, error } = await dbClient
        .from('broker_symbols')
        .insert([
          {
            broker_id: brokerId,
            symbol_code: symbolCode,
            asset_class: String(b.assetClass || 'Metals').trim() || 'Metals',
            base_currency: String(b.baseCurrency || 'XAU').trim() || 'XAU',
            quote_currency: String(b.quoteCurrency || 'USD').trim() || 'USD',
            is_active: b.isActive !== false,
            is_verified: Boolean(b.isVerified),
            verification_notes: String(b.verificationNotes || '').trim(),
          },
        ])
        .select('*')
        .single();

      if (error) {
        const isDuplicate = String(error.code || '') === '23505' || String(error.message || '').toLowerCase().includes('unique');
        return res.status(isDuplicate ? 409 : 500).json({
          success: false,
          code: isDuplicate ? 'DUPLICATE_BROKER_SYMBOL' : undefined,
          error: isDuplicate ? `Symbol "${symbolCode}" already exists for ${brokerRow.name}.` : error.message,
        });
      }

      await writeAuditLog(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'BROKER_SYMBOL_ADDED',
        targetType: 'broker_symbols',
        targetId: inserted.id,
        result: 'success',
        details: `Added symbol "${symbolCode}" to broker ${brokerRow.name} (verified=${Boolean(inserted.is_verified)}).`,
      });

      return res.status(201).json({ success: true, symbol: mapSymbolRow(inserted) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to add broker symbol' });
    }
  });

  // Update symbol
  registerRoute('put', '/api/admin/brokers/:brokerId/symbols/:symbolId', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { brokerId, symbolId } = req.params;
      if (!isValidUUID(brokerId) || !isValidUUID(symbolId)) {
        return res.status(400).json({ success: false, error: 'Valid brokerId and symbolId UUIDs are required.' });
      }

      const b = req.body || {};
      const patch: Record<string, any> = {};
      if (b.symbolCode !== undefined) {
        const clean = String(b.symbolCode).trim();
        if (!clean) return res.status(400).json({ success: false, error: 'symbolCode cannot be empty.' });
        patch.symbol_code = clean;
      }
      if (typeof b.isActive === 'boolean') patch.is_active = b.isActive;
      if (typeof b.isVerified === 'boolean') patch.is_verified = b.isVerified;
      if (b.verificationNotes !== undefined) patch.verification_notes = String(b.verificationNotes || '').trim();

      const { data: updated, error } = await dbClient
        .from('broker_symbols')
        .update(patch)
        .eq('id', symbolId)
        .eq('broker_id', brokerId)
        .select('*')
        .single();

      if (error) return res.status(500).json({ success: false, error: error.message });

      await writeAuditLog(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'BROKER_SYMBOL_UPDATED',
        targetType: 'broker_symbols',
        targetId: symbolId,
        result: 'success',
        details: `Updated broker symbol ${updated.symbol_code} (active=${updated.is_active}, verified=${updated.is_verified}).`,
      });

      return res.status(200).json({ success: true, symbol: mapSymbolRow(updated) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to update broker symbol' });
    }
  });

  // Delete symbol
  registerRoute('delete', '/api/admin/brokers/:brokerId/symbols/:symbolId', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { brokerId, symbolId } = req.params;
      if (!isValidUUID(brokerId) || !isValidUUID(symbolId)) {
        return res.status(400).json({ success: false, error: 'Valid brokerId and symbolId UUIDs are required.' });
      }

      const { error } = await dbClient
        .from('broker_symbols')
        .delete()
        .eq('id', symbolId)
        .eq('broker_id', brokerId);

      if (error) return res.status(500).json({ success: false, error: error.message });

      await writeAuditLog(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'BROKER_SYMBOL_DELETED',
        targetType: 'broker_symbols',
        targetId: symbolId,
        result: 'success',
        details: `Removed symbol ${symbolId} from broker ${brokerId}.`,
      });

      return res.status(200).json({ success: true, symbolId });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to delete broker symbol' });
    }
  });
}
