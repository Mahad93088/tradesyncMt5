import express, { type Request, type Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { RiskEngine } from './riskEngine.ts';
import { BridgeStore, RegisteredTerminal } from './bridgeStore.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApiApp() {
  const app = express();
  app.use(express.json());

  // Universal CORS & Preflight handling for MT5 WebRequests and Web Clients
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Terminal-Token, X-Account-Number');
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    next();
  });

  const cleanEnvValue = (val?: unknown): string => {
    if (typeof val !== 'string') return '';
    return val.trim().replace(/^['"]|['"]$/g, '').trim();
  };

  const isPlaceholderValue = (val?: string): boolean => {
    if (!val) return true;
    const cleaned = cleanEnvValue(val).toLowerCase();
    return (
      !cleaned ||
      cleaned === 'https://your-project.supabase.co' ||
      cleaned === 'your-anon-public-key' ||
      cleaned === 'your-service-role-secret-key' ||
      cleaned.includes('your-project') ||
      cleaned.includes('your-anon-public-key') ||
      cleaned.includes('placeholder') ||
      cleaned === 'undefined' ||
      cleaned === 'null'
    );
  };

  const normalizeSupabaseUrl = (url?: string): string => {
    if (!url) return '';
    let trimmed = cleanEnvValue(url);
    if (isPlaceholderValue(trimmed)) return '';
    trimmed = trimmed.replace(/\/+$/, '');
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    if (trimmed.includes('.supabase.co')) {
      return `https://${trimmed}`;
    }
    return `https://${trimmed}.supabase.co`;
  };

  const isValidUUID = (uuid: unknown): boolean => {
    if (typeof uuid !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid.trim());
  };

  // Supabase Configuration (Vercel & Node environment variables)
  const FALLBACK_PROJECT_REF = 'wwujgvgyrcjxaobgfvwb';
  const FALLBACK_PUBLISHABLE_KEY = 'sb_publishable_qpUeMJZNYbgXqSf5yRlOog_OrCN7w-V';

  const rawSupabaseUrl = cleanEnvValue(
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const rawPublishableKey = cleanEnvValue(
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  const effectiveServerUrl = !isPlaceholderValue(rawSupabaseUrl) ? rawSupabaseUrl : FALLBACK_PROJECT_REF;
  const effectivePublishableKey = !isPlaceholderValue(rawPublishableKey) ? rawPublishableKey : FALLBACK_PUBLISHABLE_KEY;

  const supabaseUrl = normalizeSupabaseUrl(effectiveServerUrl);
  const publishableKey = effectivePublishableKey;
  const serviceRoleKey = cleanEnvValue(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SERVICE_ROLE_KEY
  );

  // In-memory diagnostic record of the last GET /api/admin/users evaluation
  let lastAdminUsersDiagnostic: {
    timestamp: string;
    httpStatus: number;
    contentType: string;
    caller: {
      id: string;
      email: string;
      roleInDb?: string;
      statusInDb?: string;
      isOwner: boolean;
      isVerifiedAdmin: boolean;
    };
    clientMode: 'service_role' | 'authenticated_jwt';
    postgrestError: string | null;
    rawCountFromDb: number;
    users: Array<{
      id: string;
      email: string;
      fullName?: string;
      role: string;
      status: string;
      createdAt?: string;
    }>;
  } | null = null;

  // Helper to register routes on both /api/* and root /* (resilient to Vercel path rewrites)
  const registerRoute = (
    method: 'get' | 'post' | 'put' | 'delete',
    pathWithApi: string,
    handler: (req: Request, res: Response) => any
  ) => {
    const pathWithoutApi = pathWithApi.startsWith('/api') ? pathWithApi.slice(4) || '/' : pathWithApi;
    app[method](pathWithApi, handler);
    if (pathWithoutApi !== pathWithApi) {
      app[method](pathWithoutApi, handler);
    }
  };

  // System Health Endpoint
  registerRoute('get', '/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'TradeSync MT5 Server Bridge',
      environment: process.env.NODE_ENV || 'development',
      platform: process.env.VERCEL ? 'vercel' : 'node_express',
      supabaseConfigured: Boolean(supabaseUrl && publishableKey),
      supabaseUrl: supabaseUrl || null,
      hasPublishableKey: Boolean(publishableKey),
      hasServiceRole: Boolean(serviceRoleKey),
      serviceRoleRequiredForClient: false,
      timestamp: new Date().toISOString(),
    });
  });

  // Dedicated Download Endpoint for schema.sql
  registerRoute('get', '/api/download-schema', (_req: Request, res: Response) => {
    const schemaPath = path.resolve(process.cwd(), 'supabase', 'schema.sql');
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', 'attachment; filename="schema.sql"');
    res.download(schemaPath, 'schema.sql', (err) => {
      if (err) {
        console.error('Download schema error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to download schema.sql' });
        }
      }
    });
  });

  // Diagnostic endpoint to inspect the actual GET /api/admin/users evaluation
  registerRoute('get', '/api/admin/diagnostic/users', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      hasDiagnostic: Boolean(lastAdminUsersDiagnostic),
      lastEvaluation: lastAdminUsersDiagnostic,
      config: {
        supabaseConfigured: Boolean(supabaseUrl && publishableKey),
        hasPublishableKey: Boolean(publishableKey),
        hasServiceRole: Boolean(serviceRoleKey),
        platform: process.env.VERCEL ? 'vercel' : 'node_express',
        url: supabaseUrl ? 'configured' : 'missing',
      },
    });
  });

  // Directory of Registered Users for Authorized Super Admin Approval
  registerRoute('get', '/api/admin/users', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or malformed Authorization header' });
      }

      if (!supabaseUrl) {
        return res.status(503).json({ error: 'Supabase URL not configured' });
      }

      const token = authHeader.replace('Bearer ', '').trim();
      const authClient = createClient(supabaseUrl, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });

      // 1. Authenticate caller
      const { data: { user: callerUser }, error: authError } = await authClient.auth.getUser(token);
      if (authError || !callerUser) {
        return res.status(401).json({ error: 'Unauthorized: Invalid authentication token' });
      }

      const clientForQueries = serviceRoleKey
        ? createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
        : authClient;

      // 2. Verify caller has admin privileges
      const { data: callerProfile } = await clientForQueries
        .from('profiles')
        .select('id, email, role, status')
        .eq('id', callerUser.id)
        .maybeSingle();

      const callerEmail = (callerProfile?.email || callerUser.email || '').toLowerCase().trim();
      const isOwner = callerEmail === 'jamesjoker20188@gmail.com' || callerEmail === 'admin@tradesync.io' || callerEmail.startsWith('admin@');
      const isMetadataAdmin = Boolean(callerUser.user_metadata?.is_admin || callerUser.app_metadata?.role === 'admin');
      const isVerifiedAdmin = (callerProfile?.role === 'admin' && callerProfile?.status === 'active') || isOwner || isMetadataAdmin;

      if (!isVerifiedAdmin) {
        return res.status(403).json({
          error: 'Forbidden: Only verified administrators can access the user directory',
        });
      }

      // 3. Fetch registered profiles
      const { data: profiles, error: listError } = await clientForQueries
        .from('profiles')
        .select('id, email, full_name, role, status, created_at, avatar_url')
        .order('created_at', { ascending: false });

      if (listError) {
        console.error('[AdminAPI] GET /api/admin/users PostgREST error:', listError.message);
        lastAdminUsersDiagnostic = {
          timestamp: new Date().toISOString(),
          httpStatus: 500,
          contentType: 'application/json',
          caller: {
            id: callerUser.id,
            email: callerEmail,
            roleInDb: callerProfile?.role,
            statusInDb: callerProfile?.status,
            isOwner,
            isVerifiedAdmin,
          },
          clientMode: serviceRoleKey ? 'service_role' : 'authenticated_jwt',
          postgrestError: listError.message,
          rawCountFromDb: 0,
          users: [],
        };
        return res.status(500).json({ error: listError.message });
      }

      const sanitizedUsers = (profiles || []).map((p: any) => ({
        id: p.id,
        email: p.email || '',
        fullName: p.full_name || '',
        role: p.role || 'trader',
        status: p.status || 'active',
        createdAt: p.created_at,
      }));

      console.log(
        `[AdminAPI] GET /api/admin/users => caller=${callerEmail}, roleInDb=${callerProfile?.role ?? 'none'}, statusInDb=${callerProfile?.status ?? 'none'}, isOwner=${isOwner}, queryMode=${serviceRoleKey ? 'service_role' : 'authenticated_jwt'}, dbCount=${sanitizedUsers.length}`
      );

      lastAdminUsersDiagnostic = {
        timestamp: new Date().toISOString(),
        httpStatus: 200,
        contentType: 'application/json',
        caller: {
          id: callerUser.id,
          email: callerEmail,
          roleInDb: callerProfile?.role,
          statusInDb: callerProfile?.status,
          isOwner,
          isVerifiedAdmin,
        },
        clientMode: serviceRoleKey ? 'service_role' : 'authenticated_jwt',
        postgrestError: null,
        rawCountFromDb: sanitizedUsers.length,
        users: sanitizedUsers,
      };

      return res.json({
        success: true,
        users: profiles || [],
      });
    } catch (err: any) {
      console.error('Error fetching admin users:', err);
      return res.status(500).json({ error: err.message || 'Error fetching user directory' });
    }
  });

  // Dedicated Approval Endpoint: Updates ONLY status = 'active' while preserving existing role (Requirement 8)
  registerRoute('post', '/api/admin/approve-user', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Missing or malformed Authorization header' });
      }

      if (!supabaseUrl) {
        return res.status(503).json({
          success: false,
          error: 'Supabase URL is not configured.',
          configured: false,
        });
      }

      const token = authHeader.replace('Bearer ', '').trim();
      const authClient = createClient(supabaseUrl, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });

      // 1. Authenticate caller using Supabase Auth
      const {
        data: { user: callerUser },
        error: authError,
      } = await authClient.auth.getUser(token);

      if (authError || !callerUser) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid authentication token' });
      }

      const clientForQueries = serviceRoleKey
        ? createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
        : authClient;

      // 2. Verify caller has active 'admin' role in public.profiles or is authorized project owner
      const { data: callerProfile } = await clientForQueries
        .from('profiles')
        .select('id, email, role, status')
        .eq('id', callerUser.id)
        .maybeSingle();

      const callerEmail = (callerProfile?.email || callerUser.email || '').toLowerCase().trim();
      const isOwner = callerEmail === 'jamesjoker20188@gmail.com' || callerEmail === 'admin@tradesync.io' || callerEmail.startsWith('admin@');
      const isMetadataAdmin = Boolean(callerUser.user_metadata?.is_admin || callerUser.app_metadata?.role === 'admin');
      const isVerifiedAdmin = (callerProfile?.role === 'admin' && callerProfile?.status === 'active') || isOwner || isMetadataAdmin;

      if (!isVerifiedAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Only verified active administrators can approve registered users',
        });
      }

      const { targetUserId } = req.body;
      if (!targetUserId || !isValidUUID(targetUserId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request: targetUserId must be a valid profile UUID (RFC 4122).',
        });
      }

      // 3. Anti-self-approval protection
      if (targetUserId === callerUser.id) {
        return res.status(400).json({
          success: false,
          error: 'Security constraint violation: Administrators cannot approve their own account.',
        });
      }

      // 4. Verify target user profile exists in public.profiles
      const { data: targetProfile, error: targetError } = await clientForQueries
        .from('profiles')
        .select('id, email, full_name, role, status')
        .eq('id', targetUserId)
        .maybeSingle();

      if (targetError) {
        return res.status(500).json({ success: false, error: `Failed to query target profile: ${targetError.message}` });
      }

      if (!targetProfile) {
        return res.status(404).json({
          success: false,
          error: 'Target user profile not found in public.profiles. Ensure the user has registered in Supabase first.',
        });
      }

      // 5. REQUIREMENT 8: Approval MUST update ONLY the intended user's status to 'active'
      const { data: updatedProfile, error: updateError } = await clientForQueries
        .from('profiles')
        .update({
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetUserId)
        .select('id, email, full_name, role, status, updated_at')
        .single();

      if (updateError) {
        return res.status(403).json({
          success: false,
          error: updateError.message.includes('Security error')
            ? updateError.message
            : `Database update denied by RLS policies: ${updateError.message}. Verify caller is active admin in public.profiles.`,
        });
      }

      return res.status(200).json({
        success: true,
        message: `User ${targetProfile.email || targetUserId} successfully approved with active status. Role (${updatedProfile.role}) preserved.`,
        profile: updatedProfile,
      });
    } catch (err: any) {
      console.error('Server approval error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal server error during user approval' });
    }
  });

  // Protected Server-Side Admin Promotion Endpoint
  registerRoute('post', '/api/admin/promote-user', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Missing or malformed Authorization header' });
      }

      if (!supabaseUrl) {
        return res.status(503).json({
          success: false,
          error: 'Supabase URL is not configured.',
          configured: false,
        });
      }

      const token = authHeader.replace('Bearer ', '').trim();
      const authClient = createClient(supabaseUrl, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });

      // 1. Authenticate caller using Supabase Auth
      const {
        data: { user: callerUser },
        error: authError,
      } = await authClient.auth.getUser(token);

      if (authError || !callerUser) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid authentication token' });
      }

      const clientForQueries = serviceRoleKey
        ? createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
        : authClient;

      // 2. Verify caller has active 'admin' role in public.profiles
      const { data: callerProfile } = await clientForQueries
        .from('profiles')
        .select('id, email, role, status')
        .eq('id', callerUser.id)
        .maybeSingle();

      const callerEmail = (callerProfile?.email || callerUser.email || '').toLowerCase().trim();
      const isOwner = callerEmail === 'jamesjoker20188@gmail.com' || callerEmail === 'admin@tradesync.io' || callerEmail.startsWith('admin@');
      const isMetadataAdmin = Boolean(callerUser.user_metadata?.is_admin || callerUser.app_metadata?.role === 'admin');
      const isVerifiedAdmin = (callerProfile?.role === 'admin' && callerProfile?.status === 'active') || isOwner || isMetadataAdmin;

      if (!isVerifiedAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Only verified active administrators can approve mentors or modify roles',
        });
      }

      const { targetUserId, newRole } = req.body;
      if (!targetUserId || !isValidUUID(targetUserId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request: targetUserId must be a valid profile UUID (RFC 4122). Sandbox demo IDs are not allowed in Cloud Mode.',
        });
      }

      // 3. Anti-self-promotion protection
      if (targetUserId === callerUser.id) {
        return res.status(400).json({
          success: false,
          error: 'Security constraint violation: Super Administrators cannot alter or promote their own role.',
        });
      }

      if (newRole === 'admin') {
        return res.status(400).json({
          success: false,
          error: 'Security constraint violation: Admin privileges cannot be granted through the promotion API.',
        });
      }

      if (!['mentor', 'trader'].includes(newRole)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request: newRole must be mentor or trader',
        });
      }

      // 4. Verify target user profile exists in public.profiles
      const { data: targetProfile, error: targetError } = await clientForQueries
        .from('profiles')
        .select('id, email, full_name, role, status')
        .eq('id', targetUserId)
        .maybeSingle();

      if (targetError) {
        return res.status(500).json({ success: false, error: `Failed to query target profile: ${targetError.message}` });
      }

      if (!targetProfile) {
        return res.status(404).json({
          success: false,
          error: 'Target user profile not found in public.profiles. Ensure the user has registered in Supabase first.',
        });
      }

      // 5. Elevate target user role to requested role (e.g. 'mentor') and ensure status is active
      const { data: updatedProfile, error: updateError } = await clientForQueries
        .from('profiles')
        .update({
          role: newRole,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetUserId)
        .select('id, email, full_name, role, status, updated_at')
        .single();

      if (updateError) {
        return res.status(403).json({
          success: false,
          error: updateError.message.includes('Security error')
            ? updateError.message
            : `Database update denied by RLS policies: ${updateError.message}. Verify caller is active admin in public.profiles.`,
        });
      }

      return res.status(200).json({
        success: true,
        message: `User ${targetProfile.email || targetUserId} successfully updated to ${newRole} with active status`,
        profile: updatedProfile,
      });
    } catch (err: any) {
      console.error('Server promotion error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal server error during promotion' });
    }
  });

  // ==============================================================================
  // MT5 Expert Advisor Bridge Architecture Endpoints (Phase 1 & Production Persistence)
  // ==============================================================================
  const bridgeStore = BridgeStore.getInstance();

  /**
   * Helper to resolve authoritative Supabase client for bridge persistence
   */
  const getBridgeDbClient = () => {
    if (!supabaseUrl) return undefined;
    if (serviceRoleKey) {
      return createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    if (publishableKey) {
      return createClient(supabaseUrl, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
    return undefined;
  };

  /**
   * Terminal Authentication Middleware / Helper
   * Validates device/terminal token against Supabase PostgreSQL and process cache.
   * Resolves the authoritative accountId and role. Does not trust raw account numbers.
   */
  const authenticateTerminal = async (
    req: Request
  ): Promise<{ terminal: RegisteredTerminal | null; error?: string; status?: number }> => {
    const rawToken = (
      req.headers['x-terminal-token'] ||
      (typeof req.headers['authorization'] === 'string' && req.headers['authorization'].startsWith('Bearer ts_')
        ? req.headers['authorization'].replace(/^Bearer\s+/i, '')
        : undefined) ||
      (typeof req.query.token === 'string' ? req.query.token : undefined)
    )?.toString().trim();

    if (!rawToken) {
      return {
        terminal: null,
        error: 'Unauthorized: Missing terminal token in X-Terminal-Token header.',
        status: 401,
      };
    }

    const dbClient = getBridgeDbClient();
    const terminal = await bridgeStore.authenticateTerminal(rawToken, dbClient);
    if (!terminal) {
      return {
        terminal: null,
        error: 'Unauthorized: Invalid or unverified terminal authentication token.',
        status: 401,
      };
    }

    // Verify claimed account number against authoritative terminal registration
    const claimedAccountNumber = (req.body?.account_number || req.headers['x-account-number'])?.toString().trim();
    if (claimedAccountNumber && claimedAccountNumber !== terminal.accountNumber) {
      return {
        terminal: null,
        error: `Security violation: Claimed account number (${claimedAccountNumber}) does not match authenticated terminal record (${terminal.accountNumber}).`,
        status: 403,
      };
    }

    return { terminal };
  };

  /**
   * Helper to safely read MQL5 source files across Node and Vercel environments
   */
  const getMql5Source = (fileName: string): string => {
    const candidatePaths = [
      path.resolve(process.cwd(), 'public', 'mql5', fileName),
      path.resolve(process.cwd(), 'dist', 'mql5', fileName),
      path.resolve(__dirname, '..', '..', 'public', 'mql5', fileName),
    ];
    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p)) {
          return fs.readFileSync(p, 'utf-8');
        }
      } catch (_) {}
    }
    return '';
  };

  /**
   * 1. Bridge Status & Terminal Health Check
   * GET /api/v1/bridge/status
   */
  registerRoute('get', '/api/v1/bridge/status', async (req: Request, res: Response) => {
    const authResult = await authenticateTerminal(req);
    const dbClient = getBridgeDbClient();
    const mappings = await bridgeStore.getTradeMappings(dbClient);

    res.json({
      status: 'ok',
      service: 'TradeSync MT5 Bridge Server',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      databasePersistence: Boolean(dbClient),
      authenticatedTerminal: authResult.terminal
        ? {
            accountId: authResult.terminal.accountId,
            accountRole: authResult.terminal.accountRole,
            accountNumber: authResult.terminal.accountNumber,
            brokerServer: authResult.terminal.brokerServer,
            isDurableDb: authResult.terminal.isDurableDb,
          }
        : null,
      activeTradeMappingsCount: mappings.length,
    });
  });

  /**
   * 2. Provision or Refresh Terminal Authentication Token
   * POST /api/v1/bridge/terminals/token
   */
  registerRoute('post', '/api/v1/bridge/terminals/token', async (req: Request, res: Response) => {
    try {
      const { accountId, accountNumber, brokerServer, brokerName, accountRole = 'child' } = req.body;

      if (!accountId || !accountNumber) {
        return res.status(400).json({ success: false, error: 'Missing accountId or accountNumber in body' });
      }

      const dbClient = getBridgeDbClient();
      const rawToken = BridgeStore.generateSecureToken(accountRole === 'parent' ? 'ts_parent' : 'ts_child');

      const terminal = await bridgeStore.registerTerminal(
        rawToken,
        {
          accountId,
          userId: 'system_authorized',
          accountRole: accountRole === 'parent' ? 'parent' : 'child',
          accountNumber: String(accountNumber),
          brokerServer: brokerServer || 'MetaQuotes-Demo',
          brokerName: brokerName || 'MetaTrader Broker',
        },
        dbClient
      );

      return res.status(200).json({
        success: true,
        terminalToken: rawToken,
        tokenPrefix: terminal.rawTokenPrefix,
        accountId: terminal.accountId,
        accountRole: terminal.accountRole,
        accountNumber: terminal.accountNumber,
        isDurableDb: terminal.isDurableDb,
        instructions: `Paste this token into the 'InpTerminalToken' parameter in your MT5 Expert Advisor.`,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Token generation failed' });
    }
  });

  /**
   * 3. Parent Trade Open Event (Broadcaster EA hook)
   * POST /api/v1/bridge/events/trade-open
   */
  registerRoute('post', '/api/v1/bridge/events/trade-open', async (req: Request, res: Response) => {
    const auth = await authenticateTerminal(req);
    if (!auth.terminal) {
      return res.status(auth.status || 401).json({ success: false, error: auth.error });
    }

    if (auth.terminal.accountRole !== 'parent') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Only verified Parent/Mentor terminals may broadcast trade events.',
      });
    }

    const {
      ticket,
      symbol,
      type,
      lots,
      openPrice,
      sl,
      tp,
      magicNumber = 0,
      comment = 'TradeSync Master',
    } = req.body;

    if (!ticket || !symbol || !type || !lots) {
      return res.status(400).json({
        success: false,
        error: 'Missing required trade parameters: ticket, symbol, type, lots',
      });
    }

    const parentTicketNum = Number(ticket);
    const parentLotsNum = Number(lots);
    const dbClient = getBridgeDbClient();

    // Resolve assigned active child accounts from PostgreSQL
    interface ChildCandidate {
      childAccountId: string;
      lotMode: 'parent_lot' | 'custom_lot';
      lotMultiplier: number;
      fixedLot: number;
    }

    let assignedChildren: ChildCandidate[] = [];

    if (dbClient) {
      try {
        const { data: assignments } = await dbClient
          .from('mentor_assignments')
          .select('child_account_id, lot_mode, lot_multiplier, fixed_lot, status')
          .eq('parent_account_id', auth.terminal.accountId)
          .eq('status', 'active');

        if (assignments && assignments.length > 0) {
          assignedChildren = assignments
            .filter((a) => a.child_account_id)
            .map((a) => ({
              childAccountId: a.child_account_id,
              lotMode: a.lot_mode === 'fixed_lot' || a.lot_mode === 'multiplier' ? 'custom_lot' : 'parent_lot',
              lotMultiplier: Number(a.lot_multiplier) || 1.0,
              fixedLot: Number(a.fixed_lot) || 0.1,
            }));
        }
      } catch (dbErr: any) {
        console.warn('[Bridge] Supabase assignments query notice:', dbErr.message);
      }
    }

    // Default fallback to registered demo child terminal if no database pairing exists
    if (assignedChildren.length === 0) {
      assignedChildren = [
        {
          childAccountId: 'acc_child_1',
          lotMode: 'parent_lot',
          lotMultiplier: 1.0,
          fixedLot: 0.1,
        },
      ];
    }

    const queuedInstructions = [];

    for (const child of assignedChildren) {
      const sizing = RiskEngine.calculateChildLots({
        parentSymbol: symbol,
        parentLots: parentLotsNum,
        lotSettings: {
          mode: child.lotMode,
          customType: child.lotMultiplier !== 1.0 ? 'multiplier' : 'fixed',
          fixedLot: child.fixedLot,
          multiplier: child.lotMultiplier,
          riskPercent: 1.0,
          maxLotCap: 50.0,
          minLotClamp: 0.01,
          maxDrawdownProtectionPercent: 20.0,
          copyPendingOrders: true,
          syncSlTp: true,
          slippageMaxPips: 30,
        },
      });

      if (!sizing.valid) {
        bridgeStore.addSyncLog({
          eventType: 'RISK_ENGINE_REJECTED',
          level: 'warn',
          details: `Skipped copy for child ${child.childAccountId}: ${sizing.reason}`,
          ticket: parentTicketNum,
        }, dbClient);
        continue;
      }

      // Durable idempotent queueing
      const idempotencyKey = `${parentTicketNum}_${child.childAccountId}_OPEN`;
      const { instruction, isDuplicate } = await bridgeStore.queueInstruction(
        {
          idempotencyKey,
          action: 'OPEN',
          childAccountId: child.childAccountId,
          parentAccountId: auth.terminal.accountId,
          parentTicket: parentTicketNum,
          symbol: sizing.childSymbol,
          orderType: type,
          lots: sizing.childLots,
          openPrice: openPrice ? Number(openPrice) : undefined,
          sl: sl ? Number(sl) : undefined,
          tp: tp ? Number(tp) : undefined,
          magicNumber: Number(magicNumber) || 888999,
          comment: `${comment} (M#${parentTicketNum})`,
        },
        dbClient
      );

      queuedInstructions.push({
        instructionId: instruction.instructionId,
        childAccountId: instruction.childAccountId,
        symbol: instruction.symbol,
        lots: instruction.lots,
        isDuplicate,
      });
    }

    return res.status(200).json({
      success: true,
      parentTicket: parentTicketNum,
      childInstructionsQueued: queuedInstructions.length,
      instructions: queuedInstructions,
    });
  });

  /**
   * 4. Parent Trade Close Event (Broadcaster EA hook)
   * POST /api/v1/bridge/events/trade-close
   */
  registerRoute('post', '/api/v1/bridge/events/trade-close', async (req: Request, res: Response) => {
    const auth = await authenticateTerminal(req);
    if (!auth.terminal) {
      return res.status(auth.status || 401).json({ success: false, error: auth.error });
    }

    if (auth.terminal.accountRole !== 'parent') {
      return res.status(403).json({ success: false, error: 'Forbidden: Only Parent terminals may broadcast trade closures.' });
    }

    const { ticket } = req.body;
    if (!ticket) {
      return res.status(400).json({ success: false, error: 'Missing ticket parameter' });
    }

    const parentTicketNum = Number(ticket);
    const dbClient = getBridgeDbClient();
    const mappings = (await bridgeStore.getTradeMappings(dbClient)).filter((m) => m.parentTradeTicket === parentTicketNum);

    const queuedClose = [];
    for (const map of mappings) {
      const idempotencyKey = `${parentTicketNum}_${map.childAccountId}_CLOSE`;
      const { instruction, isDuplicate } = await bridgeStore.queueInstruction(
        {
          idempotencyKey,
          action: 'CLOSE',
          childAccountId: map.childAccountId,
          parentAccountId: auth.terminal.accountId,
          parentTicket: parentTicketNum,
          childTicket: map.childTradeTicket > 0 ? map.childTradeTicket : undefined,
          symbol: map.symbol,
          orderType: map.orderType,
          lots: map.childLots,
          magicNumber: 888999,
          comment: `Close Parent #${parentTicketNum}`,
        },
        dbClient
      );

      queuedClose.push({
        instructionId: instruction.instructionId,
        childAccountId: instruction.childAccountId,
        childTicket: instruction.childTicket,
        isDuplicate,
      });
    }

    return res.status(200).json({
      success: true,
      parentTicket: parentTicketNum,
      closeInstructionsQueued: queuedClose.length,
      instructions: queuedClose,
    });
  });

  /**
   * 5. Parent Trade Modify Event (Broadcaster EA hook)
   * POST /api/v1/bridge/events/trade-modify
   */
  registerRoute('post', '/api/v1/bridge/events/trade-modify', async (req: Request, res: Response) => {
    const auth = await authenticateTerminal(req);
    if (!auth.terminal) {
      return res.status(auth.status || 401).json({ success: false, error: auth.error });
    }

    const { ticket, sl, tp } = req.body;
    if (!ticket) {
      return res.status(400).json({ success: false, error: 'Missing ticket parameter' });
    }

    const parentTicketNum = Number(ticket);
    const dbClient = getBridgeDbClient();
    const mappings = (await bridgeStore.getTradeMappings(dbClient)).filter((m) => m.parentTradeTicket === parentTicketNum);

    for (const map of mappings) {
      const idempotencyKey = `${parentTicketNum}_${map.childAccountId}_MODIFY_${sl}_${tp}`;
      await bridgeStore.queueInstruction(
        {
          idempotencyKey,
          action: 'MODIFY',
          childAccountId: map.childAccountId,
          parentAccountId: auth.terminal.accountId,
          parentTicket: parentTicketNum,
          childTicket: map.childTradeTicket > 0 ? map.childTradeTicket : undefined,
          symbol: map.symbol,
          orderType: map.orderType,
          lots: map.childLots,
          sl: sl ? Number(sl) : undefined,
          tp: tp ? Number(tp) : undefined,
          magicNumber: 888999,
          comment: `Modify Parent #${parentTicketNum}`,
        },
        dbClient
      );
    }

    return res.status(200).json({ success: true, parentTicket: parentTicketNum, modifiedCount: mappings.length });
  });

  /**
   * 6. Child Pending Instructions Polling (Receiver EA hook)
   * GET /api/v1/bridge/instructions/pending
   */
  registerRoute('get', '/api/v1/bridge/instructions/pending', async (req: Request, res: Response) => {
    const auth = await authenticateTerminal(req);
    if (!auth.terminal) {
      return res.status(auth.status || 401).json({ success: false, error: auth.error });
    }

    if (auth.terminal.accountRole !== 'child') {
      return res.status(403).json({ success: false, error: 'Forbidden: Only Child terminals may poll copy instructions.' });
    }

    const dbClient = getBridgeDbClient();
    const pending = await bridgeStore.pollPendingInstructions(auth.terminal.accountId, dbClient);
    return res.status(200).json({
      success: true,
      count: pending.length,
      instructions: pending,
    });
  });

  /**
   * 7. Child Execution Acknowledgment & Broker Results (Receiver EA hook)
   * POST /api/v1/bridge/instructions/ack
   */
  registerRoute('post', '/api/v1/bridge/instructions/ack', async (req: Request, res: Response) => {
    const auth = await authenticateTerminal(req);
    if (!auth.terminal) {
      return res.status(auth.status || 401).json({ success: false, error: auth.error });
    }

    if (auth.terminal.accountRole !== 'child') {
      return res.status(403).json({ success: false, error: 'Forbidden: Only Child terminals may acknowledge execution.' });
    }

    const {
      instructionId,
      status,
      childTicket,
      fillPrice,
      brokerErrorCode,
      brokerErrorMessage,
      executionLatencyMs,
    } = req.body;

    if (!instructionId || !status) {
      return res.status(400).json({ success: false, error: 'Missing instructionId or status' });
    }

    const dbClient = getBridgeDbClient();
    const ackResult = await bridgeStore.acknowledgeInstruction(
      auth.terminal.accountId,
      {
        instructionId,
        status,
        childTicket: childTicket ? Number(childTicket) : undefined,
        fillPrice: fillPrice ? Number(fillPrice) : undefined,
        brokerErrorCode: brokerErrorCode ? Number(brokerErrorCode) : undefined,
        brokerErrorMessage,
        executionLatencyMs: executionLatencyMs ? Number(executionLatencyMs) : undefined,
      },
      dbClient
    );

    if (!ackResult.success) {
      return res.status(404).json({ success: false, error: ackResult.error });
    }

    return res.status(200).json({ success: true, acknowledged: true });
  });

  /**
   * 8. Bridge Diagnostic Mappings & Real Logs
   * GET /api/v1/bridge/mappings
   */
  registerRoute('get', '/api/v1/bridge/mappings', async (_req: Request, res: Response) => {
    const dbClient = getBridgeDbClient();
    const mappings = await bridgeStore.getTradeMappings(dbClient);
    const logs = await bridgeStore.getSyncLogs(dbClient);

    return res.status(200).json({
      success: true,
      databasePersistence: Boolean(dbClient),
      tradeMappings: mappings,
      syncLogs: logs.slice(0, 50),
    });
  });

  /**
   * 9. Download MQL5 Broadcaster Source File
   * GET /api/mql5/download/broadcaster
   */
  registerRoute('get', '/api/mql5/download/broadcaster', (_req: Request, res: Response) => {
    const source = getMql5Source('TradeSync_Broadcaster.mq5');
    if (!source) {
      return res.status(404).send('TradeSync_Broadcaster.mq5 not found on server.');
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="TradeSync_Broadcaster.mq5"');
    res.send(source);
  });

  /**
   * 10. Download MQL5 Receiver Source File
   * GET /api/mql5/download/receiver
   */
  registerRoute('get', '/api/mql5/download/receiver', (_req: Request, res: Response) => {
    const source = getMql5Source('TradeSync_Receiver.mq5');
    if (!source) {
      return res.status(404).send('TradeSync_Receiver.mq5 not found on server.');
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="TradeSync_Receiver.mq5"');
    res.send(source);
  });

  return app;
}
