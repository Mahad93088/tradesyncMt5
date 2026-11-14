import express, { type Request, type Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { RiskEngine } from './riskEngine.ts';
import { BridgeStore, RegisteredTerminal } from './bridgeStore.ts';
import type { MappingExecutionStatus } from '../types';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const STALE_HEARTBEAT_THRESHOLD_MS = 90_000;

export function computeEffectiveConnectionStatus(
  connectionStatus: string | null | undefined,
  lastSync: string | null | undefined,
  errorMessage?: string | null,
  nowMs: number = Date.now(),
  staleThresholdMs: number = STALE_HEARTBEAT_THRESHOLD_MS
): { effectiveStatus: 'connected' | 'disconnected' | 'connecting' | 'error'; isStale: boolean; errorMessage?: string } {
  const normalized = (connectionStatus || 'disconnected').toLowerCase();
  if (normalized === 'connected') {
    const parsed = lastSync ? Date.parse(lastSync) : NaN;
    if (!Number.isFinite(parsed) || nowMs - parsed > staleThresholdMs) {
      const ageSeconds = Number.isFinite(parsed) ? Math.max(1, Math.round((nowMs - parsed) / 1000)) : null;
      return {
        effectiveStatus: 'disconnected',
        isStale: true,
        errorMessage:
          errorMessage ||
          (ageSeconds !== null ? `Heartbeat stale (${ageSeconds}s since last EA sync)` : 'Heartbeat stale (>90s offline)'),
      };
    }
    return {
      effectiveStatus: 'connected',
      isStale: false,
      errorMessage: errorMessage || undefined,
    };
  }

  const mappedStatus =
    normalized === 'error' || normalized === 'connecting' ? normalized : 'disconnected';
  return {
    effectiveStatus: mappedStatus,
    isStale: false,
    errorMessage: errorMessage || undefined,
  };
}

export interface ApiAppDependencies {
  serviceRoleClientOverride?: SupabaseClient | null;
  authUserResolverOverride?: (token: string) => Promise<{ user: any; error?: any }>;
  supabaseUrlOverride?: string;
  serviceRoleKeyOverride?: string;
}

export function createApiApp(deps?: ApiAppDependencies) {
  const app = express();
  app.use(express.json());

  // Defensive body-parser error handler to prevent unhandled 'SyntaxError: Unexpected end of JSON input'
  app.use((err: any, _req: Request, res: Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or incomplete JSON payload received in request body.',
      });
    }
    next(err);
  });

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

  const effectiveServerUrl = deps?.supabaseUrlOverride !== undefined
    ? deps.supabaseUrlOverride
    : (!isPlaceholderValue(rawSupabaseUrl) ? rawSupabaseUrl : FALLBACK_PROJECT_REF);
  const effectivePublishableKey = !isPlaceholderValue(rawPublishableKey) ? rawPublishableKey : FALLBACK_PUBLISHABLE_KEY;

  const supabaseUrl = normalizeSupabaseUrl(effectiveServerUrl);
  const publishableKey = effectivePublishableKey;
  const rawServiceRoleKey = cleanEnvValue(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SERVICE_ROLE_KEY
  );
  const serviceRoleKey = deps?.serviceRoleKeyOverride !== undefined
    ? deps.serviceRoleKeyOverride
    : (!isPlaceholderValue(rawServiceRoleKey) ? rawServiceRoleKey : '');

  const hasServiceRoleAccess = Boolean(deps?.serviceRoleClientOverride) || Boolean(supabaseUrl && serviceRoleKey);

  if (!hasServiceRoleAccess && process.env.NODE_ENV !== 'test') {
    console.warn(
      '[TradeSync API] WARNING: SUPABASE_SERVICE_ROLE_KEY is missing. MT5 bridge persistence & admin operations requiring service-role access will reject requests until configured.'
    );
  }

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

  /**
   * Authoritative server-side Supabase service-role client.
   * Returns null if SUPABASE_SERVICE_ROLE_KEY is not configured.
   */
  const getServiceRoleClient = (): SupabaseClient | null => {
    if (deps?.serviceRoleClientOverride !== undefined) {
      return deps.serviceRoleClientOverride;
    }
    if (!supabaseUrl || !serviceRoleKey) {
      return null;
    }
    return createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  };

  const requireServiceRoleClient = (res: Response): SupabaseClient | null => {
    const client = getServiceRoleClient();
    if (!client) {
      res.status(503).json({
        success: false,
        code: 'SUPABASE_SERVICE_ROLE_MISSING',
        error:
          'Server Configuration Error: SUPABASE_SERVICE_ROLE_KEY is not configured on the server. Durable Supabase persistence is required and silent in-memory fallback is disabled.',
      });
      return null;
    }
    return client;
  };

  interface AuthenticatedCaller {
    user: { id: string; email?: string; app_metadata?: Record<string, any> };
    profile: { id: string; email?: string; full_name?: string; role: string; status: string } | null;
    isVerifiedAdmin: boolean;
    token: string;
    authClient: SupabaseClient;
  }

  /**
   * Authenticates browser/API callers via Supabase Auth JWT and validates active profile role.
   * Strictly prohibits email-prefix (e.g. admin@*), hardcoded email, or user_metadata admin elevation.
   */
  const authenticateSupabaseCaller = async (
    req: Request,
    res: Response,
    options: { requireAdmin?: boolean; requireServiceRole?: boolean } = {}
  ): Promise<AuthenticatedCaller | null> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Unauthorized: Missing or malformed Authorization Bearer token.' });
      return null;
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token || token.startsWith('ts_')) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized: Endpoint requires a Supabase user JWT, not an MT5 terminal token.',
      });
      return null;
    }

    if (!supabaseUrl || !publishableKey) {
      res.status(503).json({ success: false, error: 'Supabase configuration is unavailable on the server.' });
      return null;
    }

    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    let callerUser: any = null;
    let authError: any = null;
    if (deps?.authUserResolverOverride) {
      const resolved = await deps.authUserResolverOverride(token);
      callerUser = resolved.user;
      authError = resolved.error;
    } else {
      const userRes = await authClient.auth.getUser(token);
      callerUser = userRes.data?.user;
      authError = userRes.error;
    }

    if (authError || !callerUser) {
      res.status(401).json({ success: false, error: 'Unauthorized: Invalid or expired authentication token.' });
      return null;
    }

    const serviceClient = getServiceRoleClient();
    if (options.requireServiceRole && !serviceClient) {
      requireServiceRoleClient(res);
      return null;
    }

    const queryClient = serviceClient || authClient;
    const { data: callerProfile, error: profErr } = await queryClient
      .from('profiles')
      .select('id, email, full_name, role, status')
      .eq('id', callerUser.id)
      .maybeSingle();

    if (profErr) {
      console.error('[Auth] Failed to query caller profile:', profErr.message);
      res.status(500).json({ success: false, error: 'Failed to verify caller profile authorization.' });
      return null;
    }

    if (!callerProfile) {
      res.status(403).json({
        success: false,
        error: 'Forbidden: No active user profile found in public.profiles.',
      });
      return null;
    }

    if (callerProfile.status !== 'active') {
      res.status(403).json({
        success: false,
        error: `Forbidden: Account status is '${callerProfile.status}'. Active status required.`,
      });
      return null;
    }

    const isVerifiedAdmin = callerProfile.role === 'admin' && callerProfile.status === 'active';

    if (options.requireAdmin && !isVerifiedAdmin) {
      res.status(403).json({
        success: false,
        error: 'Forbidden: Verified active administrator privileges required.',
      });
      return null;
    }

    return {
      user: callerUser,
      profile: callerProfile,
      isVerifiedAdmin,
      token,
      authClient,
    };
  };

  // System Health Endpoint
  registerRoute('get', '/api/health', (_req: Request, res: Response) => {
    const serviceReady = hasServiceRoleAccess;
    res.json({
      status: 'ok',
      service: 'TradeSync MT5 Server Bridge',
      environment: process.env.NODE_ENV || 'development',
      platform: process.env.VERCEL ? 'vercel' : 'node_express',
      supabaseConfigured: Boolean(supabaseUrl && publishableKey),
      supabaseUrl: supabaseUrl || null,
      hasPublishableKey: Boolean(publishableKey),
      hasServiceRole: serviceReady,
      bridgePersistenceReady: serviceReady,
      serviceRoleRequiredForClient: false,
      missingServerEnv: serviceReady ? [] : ['SUPABASE_SERVICE_ROLE_KEY'],
      timestamp: new Date().toISOString(),
    });
  });

  // Live Supabase Schema, Bridge Tables & RPC Verification Endpoint
  registerRoute('get', '/api/supabase/verify', async (_req: Request, res: Response) => {
    const configured = Boolean(supabaseUrl && publishableKey);
    const serviceClient = getServiceRoleClient();

    if (!configured) {
      return res.status(503).json({
        configured: false,
        projectUrl: null,
        hasServiceRole: false,
        authentication: { ok: false, version: 'GoTrue v2' },
        tables: {},
        rpcs: {},
        error: 'Supabase URL or publishable key missing.',
      });
    }

    const probeClient =
      serviceClient ||
      createClient(supabaseUrl, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

    const checkTable = async (tableName: string, columns = 'id') => {
      try {
        const { error } = await probeClient.from(tableName).select(columns).limit(1);
        if (!error) return { exists: true, accessible: true };
        const msg = error.message || '';
        const missing =
          msg.toLowerCase().includes('does not exist') ||
          msg.toLowerCase().includes('could not find the table') ||
          error.code === '42P01';
        return {
          exists: !missing,
          accessible: false,
          error: msg,
        };
      } catch (e: any) {
        return { exists: false, accessible: false, error: e.message };
      }
    };

    const [
      profilesStatus,
      mt5AccountsStatus,
      tradesStatus,
      assignmentsStatus,
      bridgeInstructionsStatus,
      tradeMappingsStatus,
      bridgeSyncLogsStatus,
    ] = await Promise.all([
      checkTable('profiles'),
      checkTable('mt5_accounts', serviceClient ? 'id, terminal_token_hash' : 'id'),
      checkTable('trades'),
      checkTable('mentor_assignments'),
      checkTable('bridge_instructions'),
      checkTable('trade_mappings'),
      checkTable('bridge_sync_logs'),
    ]);

    let rpcClaimStatus: { exists: boolean; verified: boolean; error?: string } = {
      exists: false,
      verified: false,
      error: serviceClient ? undefined : 'SUPABASE_SERVICE_ROLE_KEY required to verify claim_pending_instructions RPC',
    };

    if (serviceClient) {
      try {
        const { error: rpcErr } = await serviceClient.rpc('claim_pending_instructions', {
          p_child_account_id: '00000000-0000-0000-0000-000000000000',
          p_limit: 0,
          p_lease_seconds: 15,
        });
        if (!rpcErr) {
          rpcClaimStatus = { exists: true, verified: true };
        } else {
          const notFound =
            rpcErr.message.toLowerCase().includes('could not find the function') ||
            rpcErr.code === '42883';
          rpcClaimStatus = {
            exists: !notFound,
            verified: false,
            error: rpcErr.message,
          };
        }
      } catch (e: any) {
        rpcClaimStatus = { exists: false, verified: false, error: e.message };
      }
    }

    return res.json({
      configured: true,
      projectUrl: supabaseUrl,
      hasServiceRole: Boolean(serviceClient),
      authentication: { ok: true, version: 'GoTrue v2' },
      tables: {
        profiles: profilesStatus,
        mt5_accounts: mt5AccountsStatus,
        trades: tradesStatus,
        mentor_assignments: assignmentsStatus,
        bridge_instructions: bridgeInstructionsStatus,
        trade_mappings: tradeMappingsStatus,
        bridge_sync_logs: bridgeSyncLogsStatus,
      },
      rpcs: {
        claim_pending_instructions: rpcClaimStatus,
      },
    });
  });

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

  // Protected diagnostic endpoint (Active Super Admin only)
  registerRoute('get', '/api/admin/diagnostic/users', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true });
    if (!caller) return;

    res.json({
      status: 'ok',
      hasDiagnostic: Boolean(lastAdminUsersDiagnostic),
      lastEvaluation: lastAdminUsersDiagnostic,
      config: {
        supabaseConfigured: Boolean(supabaseUrl && publishableKey),
        hasPublishableKey: Boolean(publishableKey),
        hasServiceRole: hasServiceRoleAccess,
        platform: process.env.VERCEL ? 'vercel' : 'node_express',
        url: supabaseUrl ? 'configured' : 'missing',
      },
    });
  });

  // Directory of Registered Users for Authorized Super Admin Approval
  registerRoute('get', '/api/admin/users', async (req: Request, res: Response) => {
    try {
      const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true });
      if (!caller) return;

      const serviceClient = getServiceRoleClient();
      const clientForQueries = serviceClient || caller.authClient;
      const callerEmail = (caller.profile?.email || caller.user.email || '').toLowerCase().trim();

      // Fetch registered profiles
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
            id: caller.user.id,
            email: callerEmail,
            roleInDb: caller.profile?.role,
            statusInDb: caller.profile?.status,
            isOwner: false,
            isVerifiedAdmin: caller.isVerifiedAdmin,
          },
          clientMode: serviceClient ? 'service_role' : 'authenticated_jwt',
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

      lastAdminUsersDiagnostic = {
        timestamp: new Date().toISOString(),
        httpStatus: 200,
        contentType: 'application/json',
        caller: {
          id: caller.user.id,
          email: callerEmail,
          roleInDb: caller.profile?.role,
          statusInDb: caller.profile?.status,
          isOwner: false,
          isVerifiedAdmin: caller.isVerifiedAdmin,
        },
        clientMode: serviceClient ? 'service_role' : 'authenticated_jwt',
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

  // Dedicated Approval Endpoint: Updates ONLY status = 'active' while preserving existing role
  registerRoute('post', '/api/admin/approve-user', async (req: Request, res: Response) => {
    try {
      const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true });
      if (!caller) return;

      const clientForQueries = getServiceRoleClient() || caller.authClient;

      const { targetUserId } = req.body;
      if (!targetUserId || !isValidUUID(targetUserId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request: targetUserId must be a valid profile UUID (RFC 4122).',
        });
      }

      // Anti-self-approval protection
      if (targetUserId === caller.user.id) {
        return res.status(400).json({
          success: false,
          error: 'Security constraint violation: Administrators cannot approve their own account.',
        });
      }

      // Verify target user profile exists in public.profiles
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

      // Approval updates ONLY status = 'active'
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
      const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true });
      if (!caller) return;

      const clientForQueries = getServiceRoleClient() || caller.authClient;

      const { targetUserId, newRole } = req.body;
      if (!targetUserId || !isValidUUID(targetUserId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request: targetUserId must be a valid profile UUID (RFC 4122). Sandbox demo IDs are not allowed in Cloud Mode.',
        });
      }

      // Anti-self-promotion protection
      if (targetUserId === caller.user.id) {
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

      // Verify target user profile exists in public.profiles
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

      // Elevate target user role to requested role and ensure status is active
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
  // MT5 Expert Advisor Bridge Architecture Endpoints (Durable Persistence Required)
  // ==============================================================================
  const bridgeStore = BridgeStore.getInstance();

  /**
  /**
   * Terminal Authentication Middleware / Helper
   * Validates device/terminal token strictly via headers (X-Terminal-Token or Authorization: Bearer ts_...).
   * Query-string token authentication is strictly forbidden.
   * Requires server-side SUPABASE_SERVICE_ROLE_KEY for durable database validation.
   */
  const authenticateTerminal = async (
    req: Request
  ): Promise<{ terminal: RegisteredTerminal | null; dbClient?: SupabaseClient; error?: string; code?: string; status?: number }> => {
    if (typeof req.query?.token === 'string' && req.query.token.trim().length > 0 && !req.headers['x-terminal-token']) {
      return {
        terminal: null,
        error: 'Unauthorized: Query-string terminal tokens are disabled. Pass token via X-Terminal-Token header.',
        status: 401,
      };
    }

    const rawToken = (
      req.headers['x-terminal-token'] ||
      (typeof req.headers['authorization'] === 'string' && req.headers['authorization'].startsWith('Bearer ts_')
        ? req.headers['authorization'].replace(/^Bearer\s+/i, '')
        : undefined)
    )?.toString().trim();

    if (!rawToken) {
      return {
        terminal: null,
        error: 'Unauthorized: Missing terminal token in X-Terminal-Token header.',
        status: 401,
      };
    }

    const dbClient = getServiceRoleClient();
    if (!dbClient) {
      return {
        terminal: null,
        code: 'SUPABASE_SERVICE_ROLE_MISSING',
        error: 'Server Configuration Error: SUPABASE_SERVICE_ROLE_KEY is required for durable MT5 bridge authentication and persistence.',
        status: 503,
      };
    }

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

    // Ensure authoritative database record is marked connected and synced
    if (terminal.accountId) {
      const { error: syncErr } = await dbClient
        .from('mt5_accounts')
        .update({
          connection_status: 'connected',
          last_sync: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', terminal.accountId);

      if (syncErr) {
        console.warn('[Bridge] Sync status update notice:', syncErr.message);
      }
    }

    return { terminal, dbClient };
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
   * Protected: Requires either a valid MT5 terminal token OR a verified Admin JWT.
   */
  registerRoute('get', '/api/v1/bridge/status', async (req: Request, res: Response) => {
    const hasTerminalAuth = Boolean(
      req.headers['x-terminal-token'] ||
      (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ts_'))
    );

    let authResult: { terminal: RegisteredTerminal | null; dbClient?: SupabaseClient; error?: string; code?: string; status?: number } = { terminal: null };
    if (hasTerminalAuth) {
      authResult = await authenticateTerminal(req);
      if (!authResult.terminal) {
        return res.status(authResult.status || 401).json({
          success: false,
          ...(authResult.code ? { code: authResult.code } : {}),
          error: authResult.error,
        });
      }
    } else {
      const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
      if (!caller) return;
    }

    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    const mappings = await bridgeStore.getTradeMappings(dbClient);

    let dbOperational = false;
    let dbLatencyMs: number | null = null;
    let dbError: string | null = null;
    const tableVerification = {
      bridgeInstructions: false,
      tradeMappings: false,
      bridgeSyncLogs: false,
      mt5Accounts: false,
      claimPendingRpc: false,
    };

    const pingStart = Date.now();
    let activeTerminalsCount = 0;
    let staleTerminalsCount = 0;
    let disconnectedTerminalsCount = 0;
    let totalTerminalsCount = 0;
    let pendingInstructionsCount = 0;
    const failedMappingsCount = mappings.filter(
      (m) => m.status !== 'EXECUTED' && m.status !== 'CLOSED' && m.status !== 'PENDING'
    ).length;
    const executedLatencies = mappings
      .filter((m) => (m.status === 'EXECUTED' || m.status === 'CLOSED') && m.latencyMs > 0)
      .map((m) => m.latencyMs);
    const averageCopyLatencyMs =
      executedLatencies.length > 0
        ? Math.round(executedLatencies.reduce((sum, v) => sum + v, 0) / executedLatencies.length)
        : 0;

    try {
      const [instRes, mapRes, logRes, accRes, rpcRes, allAccsRes, pendingInstRes] = await Promise.all([
        dbClient.from('bridge_instructions').select('id').limit(1),
        dbClient.from('trade_mappings').select('id').limit(1),
        dbClient.from('bridge_sync_logs').select('id').limit(1),
        dbClient.from('mt5_accounts').select('id, terminal_token_hash').limit(1),
        dbClient.rpc('claim_pending_instructions', {
          p_child_account_id: '00000000-0000-0000-0000-000000000000',
          p_limit: 0,
          p_lease_seconds: 15,
        }),
        dbClient.from('mt5_accounts').select('id, connection_status, last_sync, error_message'),
        dbClient.from('bridge_instructions').select('id, status').in('status', ['QUEUED', 'IN_FLIGHT']),
      ]);

      dbLatencyMs = Date.now() - pingStart;
      tableVerification.bridgeInstructions = !instRes.error;
      tableVerification.tradeMappings = !mapRes.error;
      tableVerification.bridgeSyncLogs = !logRes.error;
      tableVerification.mt5Accounts = !accRes.error;
      tableVerification.claimPendingRpc = !rpcRes.error;

      if (!allAccsRes.error && Array.isArray(allAccsRes.data)) {
        totalTerminalsCount = allAccsRes.data.length;
        const nowMs = Date.now();
        for (const acc of allAccsRes.data) {
          const eff = computeEffectiveConnectionStatus(
            acc.connection_status,
            acc.last_sync,
            acc.error_message,
            nowMs
          );
          if (eff.effectiveStatus === 'connected') {
            activeTerminalsCount += 1;
          } else {
            disconnectedTerminalsCount += 1;
            if (eff.isStale) staleTerminalsCount += 1;
          }
        }
      }

      if (!pendingInstRes.error && Array.isArray(pendingInstRes.data)) {
        pendingInstructionsCount = pendingInstRes.data.length;
      }

      if (!instRes.error && !mapRes.error && !rpcRes.error) {
        dbOperational = true;
      } else {
        dbError =
          instRes.error?.message ||
          mapRes.error?.message ||
          rpcRes.error?.message ||
          'Database schema tables or RPC not found';
      }
    } catch (err: any) {
      dbError = err.message || 'Database ping exception';
    }

    res.json({
      status: 'ok',
      service: 'TradeSync MT5 Bridge Server',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      databasePersistence: dbOperational,
      databaseDiagnostics: {
        configured: Boolean(supabaseUrl),
        hasServiceRole: true,
        connected: Boolean(dbLatencyMs !== null && !dbError),
        latencyMs: dbLatencyMs,
        tablesVerified: tableVerification,
        error: dbError,
      },
      bridgeTelemetry: {
        totalTerminalsCount,
        activeTerminalsCount,
        staleTerminalsCount,
        disconnectedTerminalsCount,
        pendingInstructionsCount,
        failedMappingsCount,
        averageCopyLatencyMs,
      },
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
   * 1b. Authenticated Terminal Heartbeat
   * POST /api/v1/bridge/heartbeat
   * Enforces terminal-token authentication and updates connection_status = 'connected' + last_sync.
   */
  registerRoute('post', '/api/v1/bridge/heartbeat', async (req: Request, res: Response) => {
    const auth = await authenticateTerminal(req);
    if (!auth.terminal) {
      return res.status(auth.status || 401).json({
        success: false,
        ...(auth.code ? { code: auth.code } : {}),
        error: auth.error || 'Unauthorized: Invalid or unverified terminal authentication token.',
      });
    }

    return res.status(200).json({
      success: true,
      accountId: auth.terminal.accountId,
      accountRole: auth.terminal.accountRole,
      accountNumber: auth.terminal.accountNumber,
      brokerServer: auth.terminal.brokerServer,
      connectionStatus: 'connected',
      lastSync: new Date().toISOString(),
    });
  });

  /**
   * 2. Provision or Refresh Terminal Authentication Token
   * POST /api/v1/bridge/terminals/token
   * Protected: Requires active Admin or owning tenant user + durable service-role DB.
   */
  registerRoute('post', '/api/v1/bridge/terminals/token', async (req: Request, res: Response) => {
    try {
      const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
      if (!caller) return;

      const dbClient = requireServiceRoleClient(res);
      if (!dbClient) return;

      const { accountId } = req.body;
      if (!accountId || !isValidUUID(accountId)) {
        return res.status(400).json({ success: false, error: 'Invalid or missing accountId UUID in request body.' });
      }

      const { data: dbAcc, error: accErr } = await dbClient
        .from('mt5_accounts')
        .select('id, user_id, account_role, account_number, broker_server, broker_name')
        .eq('id', accountId)
        .maybeSingle();

      if (accErr) {
        return res.status(500).json({ success: false, error: `Failed to verify target account: ${accErr.message}` });
      }

      if (!dbAcc) {
        return res.status(404).json({ success: false, error: 'MT5 account not found in database.' });
      }

      // Enforce Admin or Tenant Ownership
      if (!caller.isVerifiedAdmin && dbAcc.user_id !== caller.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Only an administrator or the owning account holder may provision or rotate terminal tokens.',
        });
      }

      const targetRole: 'parent' | 'child' = dbAcc.account_role === 'parent' ? 'parent' : 'child';
      const rawToken = BridgeStore.generateSecureToken(targetRole === 'parent' ? 'ts_parent' : 'ts_child');

      const terminal = await bridgeStore.registerTerminal(
        rawToken,
        {
          accountId: dbAcc.id,
          userId: dbAcc.user_id,
          accountRole: targetRole,
          accountNumber: String(dbAcc.account_number),
          brokerServer: String(dbAcc.broker_server || ''),
          brokerName: String(dbAcc.broker_name || 'MetaTrader 5'),
        },
        dbClient
      );

      if (!terminal.isDurableDb) {
        return res.status(500).json({
          success: false,
          error: 'Failed to persist terminal token hash to Supabase mt5_accounts.',
        });
      }

      return res.status(200).json({
        success: true,
        terminalToken: rawToken,
        tokenPrefix: terminal.rawTokenPrefix,
        accountId: terminal.accountId,
        accountRole: terminal.accountRole,
        accountNumber: terminal.accountNumber,
        brokerServer: terminal.brokerServer,
        brokerName: terminal.brokerName,
        isDurableDb: terminal.isDurableDb,
        instructions: `Paste this token into the 'InpTerminalToken' parameter in your MT5 Expert Advisor.`,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Token generation failed' });
    }
  });

  /**
   * 2b. Admin MT5 Account Registration Endpoint
   * POST /api/v1/admin/accounts/register
   * Protected: Verified active Super Admin + durable service-role DB required.
   */
  registerRoute('post', '/api/v1/admin/accounts/register', async (req: Request, res: Response) => {
    try {
      const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
      if (!caller) return;

      const dbClient = requireServiceRoleClient(res);
      if (!dbClient) return;

      const {
        accountRole = 'parent',
        brokerName = 'XM',
        brokerServer,
        accountNumber,
        accountType = 'demo',
        balance = 10000,
        equity = 10000,
        currency = 'USD',
        leverage = 100,
        userId,
        parentAccountId,
        lotSettings,
      } = req.body;

      if (!accountNumber || !String(accountNumber).trim()) {
        return res.status(400).json({ success: false, error: 'Account number is required' });
      }

      if (!brokerServer || !String(brokerServer).trim()) {
        return res.status(400).json({ success: false, error: 'MT5 Broker Server name is required (e.g. xmglobal_mt5 7)' });
      }

      if (!['demo', 'live'].includes(String(accountType))) {
        return res.status(400).json({ success: false, error: 'Invalid accountType: must be demo or live' });
      }

      const role: 'parent' | 'child' = accountRole === 'parent' ? 'parent' : 'child';
      const cleanAccNumber = String(accountNumber).trim();
      const cleanBrokerServer = String(brokerServer).trim();
      const cleanBrokerName = String(brokerName || 'XM').trim();

      let targetUserId: string | null = null;
      if (userId !== undefined && userId !== null && String(userId).trim() !== '') {
        if (!isValidUUID(userId)) {
          return res.status(400).json({ success: false, error: 'Invalid userId: must be a valid RFC 4122 UUID.' });
        }
        const { data: explicitProf, error: explicitErr } = await dbClient
          .from('profiles')
          .select('id, role, status')
          .eq('id', String(userId).trim())
          .maybeSingle();

        if (explicitErr) {
          return res.status(500).json({ success: false, error: `Failed to verify target userId: ${explicitErr.message}` });
        }
        if (!explicitProf) {
          return res.status(404).json({ success: false, error: 'Target userId profile not found in public.profiles.' });
        }
        if (explicitProf.status !== 'active') {
          return res.status(403).json({
            success: false,
            code: 'TARGET_USER_INACTIVE',
            error: `Target user profile is ${explicitProf.status}. Only active profiles can own MT5 accounts.`,
          });
        }
        if (role === 'parent' && explicitProf.role !== 'mentor') {
          return res.status(400).json({
            success: false,
            code: 'INVALID_MENTOR_ROLE',
            error: `Parent accounts can only be assigned to a verified active mentor profile (role = "mentor"). Provided profile has role "${explicitProf.role}".`,
          });
        }
        if (role === 'child' && explicitProf.role !== 'trader') {
          return res.status(400).json({
            success: false,
            code: 'INVALID_TRADER_ROLE',
            error: `Child accounts must belong to a verified active trader profile (role = "trader"). Provided profile has role "${explicitProf.role}".`,
          });
        }
        targetUserId = explicitProf.id;
      } else {
        const requiredProfileRole = role === 'parent' ? 'mentor' : 'trader';
        const { data: matchedProfiles, error: profQueryErr } = await dbClient
          .from('profiles')
          .select('id, role, status')
          .eq('status', 'active')
          .eq('role', requiredProfileRole)
          .limit(1);

        if (profQueryErr) {
          return res.status(500).json({
            success: false,
            error: `Failed to query verified ${requiredProfileRole} profiles: ${profQueryErr.message}`,
          });
        }

        if (!matchedProfiles || matchedProfiles.length === 0) {
          return res.status(400).json({
            success: false,
            code: role === 'parent' ? 'NO_ACTIVE_MENTOR' : 'NO_ACTIVE_TRADER',
            error:
              role === 'parent'
                ? 'No verified active mentor profile found. Please provision or approve a mentor (role = "mentor") before registering a Parent account.'
                : 'No active trader profile found. Please approve an active trader (role = "trader") before registering a Child account.',
          });
        }

        targetUserId = matchedProfiles[0].id;
      }

      // Normalize and validate child lot configuration + parent linkage upfront before database writes
      let normalizedLotMode: 'parent_lot' | 'multiplier' | 'fixed' = 'parent_lot';
      let validatedMultiplier = 1.0;
      let validatedFixedLot = 0.1;

      if (role === 'child' && lotSettings) {
        const rawCopyMode = String(lotSettings.copyMode || 'parent_lot').trim().toLowerCase();
        if (rawCopyMode === 'fixed' || rawCopyMode === 'fixed_lot') {
          normalizedLotMode = 'fixed';
        } else if (rawCopyMode === 'multiplier') {
          normalizedLotMode = 'multiplier';
        } else if (rawCopyMode === 'parent_lot') {
          normalizedLotMode = 'parent_lot';
        } else {
          return res.status(400).json({
            success: false,
            code: 'INVALID_LOT_MODE',
            error: `Invalid lotSettings.copyMode "${lotSettings.copyMode}". Supported values: parent_lot, multiplier, fixed, fixed_lot.`,
          });
        }

        if (lotSettings.multiplier !== undefined) {
          const mult = Number(lotSettings.multiplier);
          if (!Number.isFinite(mult) || mult <= 0 || mult > 100) {
            return res.status(400).json({
              success: false,
              code: 'INVALID_LOT_MULTIPLIER',
              error: 'Lot multiplier must be greater than 0 and at most 100.',
            });
          }
          validatedMultiplier = mult;
        }

        if (lotSettings.fixedLot !== undefined) {
          const fixed = Number(lotSettings.fixedLot);
          if (!Number.isFinite(fixed) || fixed < 0.01 || fixed > 100) {
            return res.status(400).json({
              success: false,
              code: 'INVALID_FIXED_LOT',
              error: 'Fixed lot size must be between 0.01 and 100 lots.',
            });
          }
          validatedFixedLot = fixed;
        }
      }

      let verifiedParentAcc: { id: string; user_id: string; account_role: string } | null = null;
      const hasParentLinkRequest =
        role === 'child' && parentAccountId !== undefined && parentAccountId !== null && String(parentAccountId).trim() !== '';

      if (hasParentLinkRequest) {
        const cleanParentId = String(parentAccountId).trim();
        if (!isValidUUID(cleanParentId)) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_PARENT_ACCOUNT_ID',
            error: 'Invalid parentAccountId: must be a valid RFC 4122 UUID.',
          });
        }

        const { data: parentAcc, error: parentLookupErr } = await dbClient
          .from('mt5_accounts')
          .select('id, user_id, account_role')
          .eq('id', cleanParentId)
          .maybeSingle();

        if (parentLookupErr) {
          return res.status(500).json({
            success: false,
            error: `Failed to verify parent MT5 account: ${parentLookupErr.message}`,
          });
        }

        if (!parentAcc) {
          return res.status(404).json({
            success: false,
            code: 'PARENT_ACCOUNT_NOT_FOUND',
            error: `Parent MT5 account "${cleanParentId}" was not found.`,
          });
        }

        if (parentAcc.account_role !== 'parent') {
          return res.status(400).json({
            success: false,
            code: 'INVALID_PARENT_ACCOUNT_ROLE',
            error: `Target MT5 account "${cleanParentId}" has role "${parentAcc.account_role}", not "parent".`,
          });
        }

        const { data: parentOwnerProf, error: parentOwnerErr } = await dbClient
          .from('profiles')
          .select('id, role, status')
          .eq('id', parentAcc.user_id)
          .maybeSingle();

        if (parentOwnerErr) {
          return res.status(500).json({
            success: false,
            error: `Failed to verify parent account mentor profile: ${parentOwnerErr.message}`,
          });
        }

        if (!parentOwnerProf || parentOwnerProf.role !== 'mentor' || parentOwnerProf.status !== 'active') {
          return res.status(400).json({
            success: false,
            code: 'PARENT_MENTOR_NOT_VERIFIED',
            error: `Parent MT5 account "${cleanParentId}" is not owned by a verified active mentor (role = "mentor", status = "active").`,
          });
        }

        if (parentAcc.user_id === targetUserId) {
          return res.status(400).json({
            success: false,
            code: 'SELF_ASSIGNMENT_FORBIDDEN',
            error: 'Security error: A user cannot be assigned as their own mentor.',
          });
        }

        verifiedParentAcc = parentAcc;
      }

      const rawToken = BridgeStore.generateSecureToken(role === 'parent' ? 'ts_parent' : 'ts_child');
      const tokenHash = BridgeStore.hashToken(rawToken);
      const tokenPrefix = rawToken.substring(0, 12) + '...';

      let accountId = crypto.randomUUID();

      const { data: existingAcc, error: existErr } = await dbClient
        .from('mt5_accounts')
        .select('id, user_id')
        .eq('account_number', cleanAccNumber)
        .eq('broker_server', cleanBrokerServer)
        .maybeSingle();

      if (existErr) {
        return res.status(500).json({ success: false, error: `Database lookup error: ${existErr.message}` });
      }

      if (verifiedParentAcc && existingAcc && verifiedParentAcc.id === existingAcc.id) {
        return res.status(400).json({
          success: false,
          code: 'SELF_ASSIGNMENT_FORBIDDEN',
          error: 'Security error: An MT5 account cannot be assigned as its own parent.',
        });
      }

      const accountPayload: Record<string, any> = {
        id: accountId,
        user_id: targetUserId,
        account_number: cleanAccNumber,
        broker_server: cleanBrokerServer,
        broker_name: cleanBrokerName,
        account_role: role,
        account_type: accountType,
        balance: Number(balance) || 10000,
        equity: Number(equity || balance) || 10000,
        margin: 0,
        free_margin: Number(balance) || 10000,
        currency: currency || 'USD',
        leverage: Number(leverage) || 100,
        connection_status: 'disconnected',
        is_investor_password: true,
        auto_trading_enabled: true,
        assigned_parent_id: verifiedParentAcc ? verifiedParentAcc.id : null,
      };

      if (existingAcc) {
        accountId = existingAcc.id;
        const { error: updateErr } = await dbClient
          .from('mt5_accounts')
          .update({
            user_id: targetUserId,
            broker_name: cleanBrokerName,
            account_role: role,
            account_type: accountType,
            balance: Number(balance) || 10000,
            equity: Number(equity || balance) || 10000,
            currency: currency || 'USD',
            leverage: Number(leverage) || 100,
            connection_status: 'disconnected',
            assigned_parent_id: verifiedParentAcc ? verifiedParentAcc.id : null,
            terminal_token_hash: tokenHash,
            terminal_token_prefix: tokenPrefix,
            terminal_token_created_at: new Date().toISOString(),
          })
          .eq('id', accountId);

        if (updateErr) {
          return res.status(500).json({
            success: false,
            error: `Failed to update MT5 account in Supabase: ${updateErr.message}`,
          });
        }
      } else {
        const { error: insertErr } = await dbClient
          .from('mt5_accounts')
          .insert([
            {
              ...accountPayload,
              terminal_token_hash: tokenHash,
              terminal_token_prefix: tokenPrefix,
              terminal_token_created_at: new Date().toISOString(),
            },
          ]);

        if (insertErr) {
          return res.status(500).json({
            success: false,
            error: `Failed to insert MT5 account in Supabase: ${insertErr.message}`,
          });
        }
      }

      // If child account and verified parentAccountId provided, establish link in mentor_assignments
      if (role === 'child' && verifiedParentAcc) {
        const { error: assignErr } = await dbClient
          .from('mentor_assignments')
          .upsert(
            [
              {
                mentor_id: verifiedParentAcc.user_id,
                trader_id: targetUserId,
                parent_account_id: verifiedParentAcc.id,
                child_account_id: accountId,
                status: 'active',
                lot_mode: normalizedLotMode,
                lot_multiplier: validatedMultiplier,
                fixed_lot: validatedFixedLot,
                assigned_at: new Date().toISOString(),
              },
            ],
            { onConflict: 'mentor_id,trader_id' }
          );

        if (assignErr) {
          if (!existingAcc) {
            await dbClient.from('mt5_accounts').delete().eq('id', accountId);
          }
          return res.status(422).json({
            success: false,
            code: 'MENTOR_ASSIGNMENT_FAILED',
            error: `Account assignment to mentor failed: ${assignErr.message}`,
          });
        }
      }

      // Refresh L1 terminal registry cache
      await bridgeStore.registerTerminal(
        rawToken,
        {
          accountId,
          userId: targetUserId!,
          accountRole: role,
          accountNumber: cleanAccNumber,
          brokerServer: cleanBrokerServer,
          brokerName: cleanBrokerName,
        },
        dbClient
      );

      const serverHost = `${req.protocol}://${req.get('host')}`;

      return res.status(200).json({
        success: true,
        account: {
          id: accountId,
          userId: targetUserId,
          accountNumber: cleanAccNumber,
          brokerName: cleanBrokerName,
          brokerServer: cleanBrokerServer,
          accountRole: role,
          accountType,
          balance: Number(balance) || 10000,
          equity: Number(equity || balance) || 10000,
          currency,
          leverage: Number(leverage) || 100,
          connectionStatus: 'disconnected',
          isDurableDb: true,
          dbError: null,
        },
        terminalToken: rawToken, // Displayed strictly once!
        tokenPrefix,
        instructions: {
          serverUrl: serverHost,
          eaFileName: role === 'parent' ? 'TradeSync_Broadcaster.mq5' : 'TradeSync_Receiver.mq5',
          eaDownloadUrl: role === 'parent' ? '/api/mql5/download/broadcaster' : '/api/mql5/download/receiver',
          serverParam: cleanBrokerServer,
          tokenParam: rawToken,
        },
      });
    } catch (err: any) {
      console.error('[AdminAPI] Account registration error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Account registration failed' });
    }
  });

  /**
   * 2c. Authoritative Admin MT5 Accounts Retrieval Endpoint
   * GET /api/v1/admin/accounts
   * Protected: Verified active Super Admin + durable service-role DB required.
   * Explicitly excludes terminal_token_hash from projection.
   */
  registerRoute('get', '/api/v1/admin/accounts', async (req: Request, res: Response) => {
    try {
      const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
      if (!caller) return;

      const dbClient = requireServiceRoleClient(res);
      if (!dbClient) return;

      const safeAccountColumns =
        'id, user_id, account_number, broker_server, broker_name, account_role, account_type, balance, equity, margin, free_margin, currency, leverage, connection_status, ping_ms, is_investor_password, auto_trading_enabled, last_sync, error_message, created_at, terminal_token_prefix, terminal_token_created_at, assigned_parent_id';

      const [accResult, assignResult, profilesResult] = await Promise.all([
        dbClient.from('mt5_accounts').select(safeAccountColumns).order('created_at', { ascending: false }),
        dbClient.from('mentor_assignments').select('*').eq('status', 'active'),
        dbClient.from('profiles').select('id, full_name, email, role, avatar_url, status'),
      ]);

      if (accResult.error) {
        return res.status(500).json({ success: false, error: accResult.error.message });
      }
      if (assignResult.error) {
        return res.status(500).json({ success: false, error: assignResult.error.message });
      }
      if (profilesResult.error) {
        return res.status(500).json({ success: false, error: profilesResult.error.message });
      }

      const nowMs = Date.now();
      const enrichedAccounts = (accResult.data || []).map((acc: any) => {
        const eff = computeEffectiveConnectionStatus(
          acc.connection_status,
          acc.last_sync,
          acc.error_message,
          nowMs
        );
        return {
          ...acc,
          connection_status: eff.effectiveStatus,
          is_stale: eff.isStale,
          error_message: eff.errorMessage || null,
        };
      });

      return res.status(200).json({
        success: true,
        source: 'supabase',
        accounts: enrichedAccounts,
        assignments: assignResult.data || [],
        profiles: profilesResult.data || [],
      });
    } catch (err: any) {
      console.error('[AdminAPI] Failed to get accounts:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to get accounts' });
    }
  });

  /**
   * 2d. Tenant-Scoped Authenticated User Accounts & Links Endpoint
   * GET /api/v1/bridge/my-accounts
   * Protected: Verified active Supabase user + durable service-role DB required.
   */
  registerRoute('get', '/api/v1/bridge/my-accounts', async (req: Request, res: Response) => {
    try {
      const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
      if (!caller) return;

      const dbClient = requireServiceRoleClient(res);
      if (!dbClient) return;

      const safeAccountColumns =
        'id, user_id, account_number, broker_server, broker_name, account_role, account_type, balance, equity, margin, free_margin, currency, leverage, connection_status, ping_ms, is_investor_password, auto_trading_enabled, last_sync, error_message, created_at, terminal_token_prefix, terminal_token_created_at, assigned_parent_id';

      const [accRes, asMentorRes, asTraderRes] = await Promise.all([
        dbClient
          .from('mt5_accounts')
          .select(safeAccountColumns)
          .eq('user_id', caller.user.id)
          .order('created_at', { ascending: false }),
        dbClient
          .from('mentor_assignments')
          .select('*')
          .eq('mentor_id', caller.user.id)
          .eq('status', 'active'),
        dbClient
          .from('mentor_assignments')
          .select('*')
          .eq('trader_id', caller.user.id)
          .eq('status', 'active'),
      ]);

      if (accRes.error) {
        return res.status(500).json({ success: false, error: accRes.error.message });
      }

      const assignmentsMap = new Map<string, any>();
      for (const row of [...(asMentorRes.data || []), ...(asTraderRes.data || [])]) {
        assignmentsMap.set(row.id, row);
      }
      const assignments = Array.from(assignmentsMap.values());

      // Load peer profile names strictly for users linked in the caller's own assignments
      const peerIds = new Set<string>([caller.user.id]);
      for (const a of assignments) {
        if (a.mentor_id) peerIds.add(a.mentor_id);
        if (a.trader_id) peerIds.add(a.trader_id);
      }

      const { data: peerProfiles } = await dbClient
        .from('profiles')
        .select('id, full_name, email, role, status, avatar_url')
        .in('id', Array.from(peerIds));

      const nowMs = Date.now();
      const enrichedAccounts = (accRes.data || []).map((acc: any) => {
        const eff = computeEffectiveConnectionStatus(
          acc.connection_status,
          acc.last_sync,
          acc.error_message,
          nowMs
        );
        return {
          ...acc,
          connection_status: eff.effectiveStatus,
          is_stale: eff.isStale,
          error_message: eff.errorMessage || null,
        };
      });

      return res.status(200).json({
        success: true,
        source: 'supabase',
        accounts: enrichedAccounts,
        assignments,
        profiles: peerProfiles || [],
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load user MT5 accounts' });
    }
  });

  /**
   * 2e. Persist MT5 Account Connection Toggle (Admin or Account Owner)
   * POST /api/v1/bridge/accounts/:accountId/connection
   */
  registerRoute('post', '/api/v1/bridge/accounts/:accountId/connection', async (req: Request, res: Response) => {
    try {
      const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
      if (!caller) return;

      const dbClient = requireServiceRoleClient(res);
      if (!dbClient) return;

      const { accountId } = req.params;
      if (!isValidUUID(accountId)) {
        return res.status(400).json({ success: false, error: 'Invalid accountId UUID.' });
      }

      const status = String(req.body?.connectionStatus || '').trim().toLowerCase();
      if (status !== 'connected' && status !== 'disconnected') {
        return res.status(400).json({ success: false, error: 'connectionStatus must be connected or disconnected.' });
      }

      const { data: acc, error: accErr } = await dbClient
        .from('mt5_accounts')
        .select('id, user_id')
        .eq('id', accountId)
        .maybeSingle();

      if (accErr) return res.status(500).json({ success: false, error: accErr.message });
      if (!acc) return res.status(404).json({ success: false, error: 'MT5 account not found.' });
      if (!caller.isVerifiedAdmin && acc.user_id !== caller.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden: Only admin or account owner can change connection state.' });
      }

      const updatePayload: Record<string, any> =
        status === 'connected'
          ? { connection_status: 'connected', last_sync: new Date().toISOString(), error_message: null }
          : { connection_status: 'disconnected', error_message: 'Manually disconnected via dashboard' };

      const { error: updErr } = await dbClient.from('mt5_accounts').update(updatePayload).eq('id', accountId);
      if (updErr) return res.status(500).json({ success: false, error: updErr.message });

      return res.status(200).json({ success: true, accountId, connectionStatus: status });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to update connection state' });
    }
  });

  /**
   * 2f. Persist MT5 Auto-Trading Toggle (Admin or Account Owner)
   * POST /api/v1/bridge/accounts/:accountId/auto-trading
   */
  registerRoute('post', '/api/v1/bridge/accounts/:accountId/auto-trading', async (req: Request, res: Response) => {
    try {
      const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
      if (!caller) return;

      const dbClient = requireServiceRoleClient(res);
      if (!dbClient) return;

      const { accountId } = req.params;
      if (!isValidUUID(accountId)) {
        return res.status(400).json({ success: false, error: 'Invalid accountId UUID.' });
      }

      const { data: acc, error: accErr } = await dbClient
        .from('mt5_accounts')
        .select('id, user_id, auto_trading_enabled')
        .eq('id', accountId)
        .maybeSingle();

      if (accErr) return res.status(500).json({ success: false, error: accErr.message });
      if (!acc) return res.status(404).json({ success: false, error: 'MT5 account not found.' });
      if (!caller.isVerifiedAdmin && acc.user_id !== caller.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden: Only admin or account owner can toggle auto-trading.' });
      }

      const nextEnabled =
        typeof req.body?.enabled === 'boolean' ? req.body.enabled : !Boolean(acc.auto_trading_enabled);

      const { error: updErr } = await dbClient
        .from('mt5_accounts')
        .update({ auto_trading_enabled: nextEnabled })
        .eq('id', accountId);

      if (updErr) return res.status(500).json({ success: false, error: updErr.message });

      return res.status(200).json({ success: true, accountId, autoTradingEnabled: nextEnabled });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to update auto-trading' });
    }
  });

  /**
   * 3. Parent Trade Open Event (Broadcaster EA hook)
   * POST /api/v1/bridge/events/trade-open
   */
  registerRoute('post', '/api/v1/bridge/events/trade-open', async (req: Request, res: Response) => {
    const auth = await authenticateTerminal(req);
    if (!auth.terminal) {
      return res.status(auth.status || 401).json({
        success: false,
        ...(auth.code ? { code: auth.code } : {}),
        error: auth.error,
      });
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
      magicNumber = 888999,
      comment = 'TradeSync Master',
    } = req.body;

    if (ticket == null || !symbol || !type || lots == null) {
      return res.status(400).json({
        success: false,
        error: 'Missing required trade parameters: ticket, symbol, type, lots',
      });
    }

    const parentTicketStr = String(ticket).trim();
    const parentLotsNum = Number(lots);
    if (!Number.isFinite(parentLotsNum) || parentLotsNum <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid trade volume: lots must be a positive finite number.',
      });
    }

    const magicNumStr = magicNumber != null ? String(magicNumber).trim() : '888999';
    const dbClient = auth.dbClient || requireServiceRoleClient(res);
    if (!dbClient) return;

    // Resolve assigned active child accounts from PostgreSQL
    interface ChildCandidate {
      childAccountId: string;
      lotMode: 'parent_lot' | 'custom_lot';
      customType: 'fixed' | 'multiplier' | 'equity_ratio' | 'risk_percent';
      lotMultiplier: number;
      fixedLot: number;
      childBalance: number;
      childEquity: number;
    }

    let assignedChildren: ChildCandidate[] = [];
    let parentBalance = 10000;
    let parentEquity = 10000;

    try {
      // 1. Authoritative check on Parent MT5 account & profile
      const { data: parentAcc, error: parentAccErr } = await dbClient
        .from('mt5_accounts')
        .select('id, user_id, account_role, connection_status, balance, equity')
        .eq('id', auth.terminal.accountId)
        .maybeSingle();

      if (parentAccErr) {
        return res.status(500).json({
          success: false,
          error: `Database error verifying parent account: ${parentAccErr.message}`,
        });
      }

      if (!parentAcc || parentAcc.account_role !== 'parent') {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Authenticated terminal is not a registered Parent/Mentor account in database.',
        });
      }

      parentBalance = Number(parentAcc.balance) || 10000;
      parentEquity = Number(parentAcc.equity) || parentBalance;

      const { data: mentorProfile, error: mentorProfErr } = await dbClient
        .from('profiles')
        .select('id, role, status')
        .eq('id', parentAcc.user_id)
        .maybeSingle();

      if (mentorProfErr) {
        return res.status(500).json({
          success: false,
          error: `Database error verifying mentor profile: ${mentorProfErr.message}`,
        });
      }

      if (!mentorProfile || mentorProfile.role !== 'mentor' || mentorProfile.status !== 'active') {
        return res.status(403).json({
          success: false,
          error: `Forbidden: Parent account owner must be an active verified mentor (role: ${mentorProfile?.role || 'none'}, status: ${mentorProfile?.status || 'inactive'}). Broadcasting disabled.`,
        });
      }

      // 2. Query active mentor assignments specifically paired with this parent account
      const { data: assignments, error: assignErr } = await dbClient
        .from('mentor_assignments')
        .select('id, mentor_id, trader_id, child_account_id, lot_mode, lot_multiplier, fixed_lot, status')
        .eq('parent_account_id', auth.terminal.accountId)
        .eq('status', 'active');

      if (assignErr) {
        console.error('[Bridge] Error querying active assignments:', assignErr.message);
        return res.status(500).json({
          success: false,
          error: `Failed to query mentor assignments: ${assignErr.message}`,
        });
      }

      if (assignments && assignments.length > 0) {
        for (const a of assignments) {
          if (!a.child_account_id) continue;

          // 3. Verify Child account exists and is assigned role 'child'
          const { data: childAcc } = await dbClient
            .from('mt5_accounts')
            .select('id, user_id, account_role, connection_status, balance, equity')
            .eq('id', a.child_account_id)
            .maybeSingle();

          if (!childAcc || childAcc.account_role !== 'child') {
            bridgeStore.addSyncLog(
              {
                eventType: 'ASSIGNMENT_REJECTED',
                level: 'warn',
                details: `Skipped copy for child account ${a.child_account_id}: not found or role is not child`,
                ticket: parentTicketStr,
              },
              dbClient
            );
            continue;
          }

          // 4. Verify Trader user profile is active and not suspended
          const { data: traderProf } = await dbClient
            .from('profiles')
            .select('id, status')
            .eq('id', childAcc.user_id)
            .maybeSingle();

          if (!traderProf || traderProf.status !== 'active') {
            bridgeStore.addSyncLog(
              {
                eventType: 'TRADER_INACTIVE_SKIPPED',
                level: 'warn',
                details: `Skipped copy for child ${a.child_account_id}: trader profile is ${traderProf?.status || 'unknown'}.`,
                ticket: parentTicketStr,
              },
              dbClient
            );
            continue;
          }

          const rawLotMode = String(a.lot_mode || 'parent_lot').trim().toLowerCase();
          let resolvedMode: 'parent_lot' | 'custom_lot' = 'parent_lot';
          let resolvedCustomType: 'fixed' | 'multiplier' | 'equity_ratio' | 'risk_percent' = 'multiplier';

          if (rawLotMode === 'fixed' || rawLotMode === 'fixed_lot') {
            resolvedMode = 'custom_lot';
            resolvedCustomType = 'fixed';
          } else if (rawLotMode === 'multiplier') {
            resolvedMode = 'custom_lot';
            resolvedCustomType = 'multiplier';
          } else if (rawLotMode === 'equity_ratio') {
            resolvedMode = 'custom_lot';
            resolvedCustomType = 'equity_ratio';
          } else if (rawLotMode === 'risk_percent') {
            resolvedMode = 'custom_lot';
            resolvedCustomType = 'risk_percent';
          } else {
            resolvedMode = 'parent_lot';
            resolvedCustomType = 'multiplier';
          }

          const parsedMultiplier = a.lot_multiplier != null ? Number(a.lot_multiplier) : 1.0;
          const parsedFixedLot = a.fixed_lot != null ? Number(a.fixed_lot) : 0.1;

          assignedChildren.push({
            childAccountId: a.child_account_id,
            lotMode: resolvedMode,
            customType: resolvedCustomType,
            lotMultiplier: Number.isFinite(parsedMultiplier) ? parsedMultiplier : 1.0,
            fixedLot: Number.isFinite(parsedFixedLot) ? parsedFixedLot : 0.1,
            childBalance: Number(childAcc.balance) || 10000,
            childEquity: Number(childAcc.equity) || Number(childAcc.balance) || 10000,
          });
        }
      }
    } catch (dbErr: any) {
      console.error('[Bridge] Supabase assignments query failure:', dbErr.message);
      return res.status(500).json({
        success: false,
        error: `Bridge persistence error while resolving child assignments: ${dbErr.message}`,
      });
    }

    if (assignedChildren.length === 0) {
      bridgeStore.addSyncLog(
        {
          eventType: 'NO_ACTIVE_CHILDREN',
          level: 'info',
          details: `Parent trade #${parentTicketStr} received, but no active, verified child accounts are currently assigned to parent ${auth.terminal.accountId}.`,
          ticket: parentTicketStr,
        },
        dbClient
      );

      return res.status(200).json({
        success: true,
        parentTicket: parentTicketStr,
        childInstructionsQueued: 0,
        message: 'No active, verified child account assignments found for this parent account.',
        instructions: [],
      });
    }

    const queuedInstructions = [];

    for (const child of assignedChildren) {
      const sizing = RiskEngine.calculateChildLots({
        parentSymbol: symbol,
        parentLots: parentLotsNum,
        parentEquity,
        parentBalance,
        childEquity: child.childEquity,
        childBalance: child.childBalance,
        lotSettings: {
          mode: child.lotMode,
          customType: child.customType,
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
        bridgeStore.addSyncLog(
          {
            eventType: 'RISK_ENGINE_REJECTED',
            level: 'warn',
            details: `Skipped copy for child ${child.childAccountId}: ${sizing.reason}`,
            ticket: parentTicketStr,
          },
          dbClient
        );
        continue;
      }

      // Durable idempotent queueing
      const idempotencyKey = `${parentTicketStr}_${child.childAccountId}_OPEN`;
      const { instruction, isDuplicate } = await bridgeStore.queueInstruction(
        {
          idempotencyKey,
          action: 'OPEN',
          childAccountId: child.childAccountId,
          parentAccountId: auth.terminal.accountId,
          parentTicket: parentTicketStr,
          symbol: sizing.childSymbol,
          orderType: type,
          lots: sizing.childLots,
          openPrice: openPrice != null && openPrice !== '' ? Number(openPrice) : undefined,
          sl: sl != null && sl !== '' ? Number(sl) : undefined,
          tp: tp != null && tp !== '' ? Number(tp) : undefined,
          hasSL: sl != null && sl !== '',
          hasTP: tp != null && tp !== '',
          hasSl: sl != null && sl !== '',
          hasTp: tp != null && tp !== '',
          magicNumber: magicNumStr,
          comment: `${comment} (M#${parentTicketStr})`,
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
      parentTicket: parentTicketStr,
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
      return res.status(auth.status || 401).json({
        success: false,
        ...(auth.code ? { code: auth.code } : {}),
        error: auth.error,
      });
    }
    const terminal = auth.terminal;

    if (terminal.accountRole !== 'parent') {
      return res.status(403).json({ success: false, error: 'Forbidden: Only Parent terminals may broadcast trade closures.' });
    }

    const { ticket } = req.body;
    if (ticket == null) {
      return res.status(400).json({ success: false, error: 'Missing ticket parameter' });
    }

    const parentTicketStr = String(ticket).trim();
    const dbClient = auth.dbClient || requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      // 1. Primary lookup: targeted query on trade_mappings for this parent account + ticket
      const { data: mapRows, error: mapErr } = await dbClient
        .from('trade_mappings')
        .select('*')
        .eq('parent_trade_ticket', parentTicketStr)
        .eq('parent_account_id', terminal.accountId);

      if (mapErr) {
        return res.status(500).json({ success: false, error: `Failed to query trade_mappings: ${mapErr.message}` });
      }

      let mappings = (mapRows || []).map((r: any) => ({
        id: r.id,
        parentTradeTicket: String(r.parent_trade_ticket),
        childTradeTicket: r.child_trade_ticket != null ? String(r.child_trade_ticket) : '0',
        mentorId: '',
        traderId: '',
        parentAccountId: r.parent_account_id,
        childAccountId: r.child_account_id,
        symbol: r.symbol,
        orderType: r.order_type as any,
        parentLots: Number(r.parent_lots),
        childLots: Number(r.child_lots),
        openTime: r.open_time,
        latencyMs: Number(r.latency_ms) || 0,
        status: r.status as any,
        retryCount: Number(r.retry_count) || 0,
      }));

      // 2. Resilient fallback for delayed acknowledgments
      if (mappings.length === 0) {
        const { data: openInstructions, error: oiErr } = await dbClient
          .from('bridge_instructions')
          .select('child_account_id, symbol, order_type, lots, child_ticket')
          .eq('parent_account_id', terminal.accountId)
          .eq('parent_ticket', parentTicketStr)
          .eq('action', 'OPEN');

        if (oiErr) {
          console.warn('[TradeClose] Fallback instruction lookup notice:', oiErr.message);
        } else if (openInstructions && openInstructions.length > 0) {
          mappings = openInstructions.map((oi) => ({
            id: `map_fallback_${parentTicketStr}_${oi.child_account_id}`,
            parentTradeTicket: parentTicketStr,
            childTradeTicket: oi.child_ticket != null ? String(oi.child_ticket) : '0',
            mentorId: '',
            traderId: '',
            parentAccountId: terminal.accountId,
            childAccountId: oi.child_account_id,
            symbol: oi.symbol,
            orderType: oi.order_type as any,
            parentLots: Number(oi.lots),
            childLots: Number(oi.lots),
            openTime: new Date().toISOString(),
            latencyMs: 0,
            status: 'PENDING' as any,
            retryCount: 0,
          }));
        }
      }

      const queuedClose = [];
      for (const map of mappings) {
        const idempotencyKey = `${parentTicketStr}_${map.childAccountId}_CLOSE`;
        const childTicketVal = map.childTradeTicket && String(map.childTradeTicket) !== '0' ? String(map.childTradeTicket) : undefined;
        const { instruction, isDuplicate } = await bridgeStore.queueInstruction(
          {
            idempotencyKey,
            action: 'CLOSE',
            childAccountId: map.childAccountId,
            parentAccountId: terminal.accountId,
            parentTicket: parentTicketStr,
            childTicket: childTicketVal,
            symbol: map.symbol,
            orderType: map.orderType,
            lots: map.childLots,
            magicNumber: '888999',
            comment: `Close Parent #${parentTicketStr}`,
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
        parentTicket: parentTicketStr,
        closeInstructionsQueued: queuedClose.length,
        instructions: queuedClose,
      });
    } catch (err: any) {
      console.error('[TradeClose] Execution error:', err.message);
      return res.status(500).json({ success: false, error: err.message || 'Failed to queue close instructions' });
    }
  });

  /**
   * 5. Parent Trade Modify Event (Broadcaster EA hook)
   * POST /api/v1/bridge/events/trade-modify
   */
  registerRoute('post', '/api/v1/bridge/events/trade-modify', async (req: Request, res: Response) => {
    const auth = await authenticateTerminal(req);
    if (!auth.terminal) {
      return res.status(auth.status || 401).json({
        success: false,
        ...(auth.code ? { code: auth.code } : {}),
        error: auth.error,
      });
    }
    const terminal = auth.terminal;

    if (terminal.accountRole !== 'parent') {
      return res.status(403).json({ success: false, error: 'Forbidden: Only Parent terminals may broadcast trade modifications.' });
    }

    const { ticket, sl, tp } = req.body;
    if (ticket == null) {
      return res.status(400).json({ success: false, error: 'Missing ticket parameter' });
    }

    const parentTicketStr = String(ticket).trim();
    const dbClient = auth.dbClient || requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { data: mapRows, error: mapErr } = await dbClient
        .from('trade_mappings')
        .select('*')
        .eq('parent_trade_ticket', parentTicketStr)
        .eq('parent_account_id', terminal.accountId);

      if (mapErr) {
        return res.status(500).json({ success: false, error: `Failed to query trade_mappings: ${mapErr.message}` });
      }

      let mappings = (mapRows || []).map((r: any) => ({
        id: r.id,
        parentTradeTicket: String(r.parent_trade_ticket),
        childTradeTicket: r.child_trade_ticket != null ? String(r.child_trade_ticket) : '0',
        mentorId: '',
        traderId: '',
        parentAccountId: r.parent_account_id,
        childAccountId: r.child_account_id,
        symbol: r.symbol,
        orderType: r.order_type as any,
        parentLots: Number(r.parent_lots),
        childLots: Number(r.child_lots),
        openTime: r.open_time,
        latencyMs: Number(r.latency_ms) || 0,
        status: r.status as any,
        retryCount: Number(r.retry_count) || 0,
      }));

      if (mappings.length === 0) {
        const { data: openInstructions, error: oiErr } = await dbClient
          .from('bridge_instructions')
          .select('child_account_id, symbol, order_type, lots, child_ticket')
          .eq('parent_account_id', terminal.accountId)
          .eq('parent_ticket', parentTicketStr)
          .eq('action', 'OPEN');

        if (oiErr) {
          console.warn('[TradeModify] Fallback lookup notice:', oiErr.message);
        } else if (openInstructions && openInstructions.length > 0) {
          mappings = openInstructions.map((oi) => ({
            id: `map_mod_${parentTicketStr}_${oi.child_account_id}`,
            parentTradeTicket: parentTicketStr,
            childTradeTicket: oi.child_ticket != null ? String(oi.child_ticket) : '0',
            mentorId: '',
            traderId: '',
            parentAccountId: terminal.accountId,
            childAccountId: oi.child_account_id,
            symbol: oi.symbol,
            orderType: oi.order_type as any,
            parentLots: Number(oi.lots),
            childLots: Number(oi.lots),
            openTime: new Date().toISOString(),
            latencyMs: 0,
            status: 'PENDING' as any,
            retryCount: 0,
          }));
        }
      }

      for (const map of mappings) {
        const idempotencyKey = `${parentTicketStr}_${map.childAccountId}_MODIFY_${sl}_${tp}`;
        const childTicketVal = map.childTradeTicket && String(map.childTradeTicket) !== '0' ? String(map.childTradeTicket) : undefined;
        await bridgeStore.queueInstruction(
          {
            idempotencyKey,
            action: 'MODIFY',
            childAccountId: map.childAccountId,
            parentAccountId: terminal.accountId,
            parentTicket: parentTicketStr,
            childTicket: childTicketVal,
            symbol: map.symbol,
            orderType: map.orderType,
            lots: map.childLots,
            sl: sl != null && sl !== '' ? Number(sl) : undefined,
            tp: tp != null && tp !== '' ? Number(tp) : undefined,
            hasSL: sl != null && sl !== '',
            hasTP: tp != null && tp !== '',
            hasSl: sl != null && sl !== '',
            hasTp: tp != null && tp !== '',
            magicNumber: '888999',
            comment: `Modify Parent #${parentTicketStr}`,
          },
          dbClient
        );
      }

      return res.status(200).json({ success: true, parentTicket: parentTicketStr, modifiedCount: mappings.length });
    } catch (err: any) {
      console.error('[TradeModify] Execution error:', err.message);
      return res.status(500).json({ success: false, error: err.message || 'Failed to queue modify instructions' });
    }
  });

  /**
   * 6. Child Pending Instructions Polling (Receiver EA hook)
   * GET /api/v1/bridge/instructions/pending
   */
  registerRoute('get', '/api/v1/bridge/instructions/pending', async (req: Request, res: Response) => {
    const auth = await authenticateTerminal(req);
    if (!auth.terminal) {
      return res.status(auth.status || 401).json({
        success: false,
        ...(auth.code ? { code: auth.code } : {}),
        error: auth.error,
      });
    }

    if (auth.terminal.accountRole !== 'child') {
      return res.status(403).json({ success: false, error: 'Forbidden: Only Child terminals may poll copy instructions.' });
    }

    const dbClient = auth.dbClient || requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const pending = await bridgeStore.pollPendingInstructions(auth.terminal.accountId, 20, dbClient);
      return res.status(200).json({
        success: true,
        count: pending.length,
        instructions: pending,
      });
    } catch (err: any) {
      console.error('[BridgePoll] Failed to poll pending instructions:', err.message);
      return res.status(500).json({ success: false, error: err.message || 'Failed to poll pending instructions' });
    }
  });

  /**
   * 7. Child Execution Acknowledgment & Broker Results (Receiver EA hook)
   * POST /api/v1/bridge/instructions/ack
   */
  const VALID_ACK_STATUSES = new Set<MappingExecutionStatus>([
    'EXECUTED',
    'FAILED',
    'REJECTED_MARGIN',
    'REJECTED_OFF_QUOTES',
    'SLIPPAGE_EXCEEDED',
    'RETRIED',
    'SKIPPED_LOT_LIMIT',
  ]);

  registerRoute('post', '/api/v1/bridge/instructions/ack', async (req: Request, res: Response) => {
    const auth = await authenticateTerminal(req);
    if (!auth.terminal) {
      return res.status(auth.status || 401).json({
        success: false,
        ...(auth.code ? { code: auth.code } : {}),
        error: auth.error,
      });
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

    if (!VALID_ACK_STATUSES.has(status)) {
      return res.status(400).json({ success: false, error: `Invalid execution acknowledgment status: ${status}` });
    }

    const dbClient = auth.dbClient || requireServiceRoleClient(res);
    if (!dbClient) return;

    const childTicketStr = childTicket != null ? String(childTicket).trim() : undefined;
    const ackResult = await bridgeStore.acknowledgeInstruction(
      auth.terminal.accountId,
      {
        instructionId: String(instructionId).trim(),
        status,
        childTicket: childTicketStr,
        fillPrice: fillPrice != null && fillPrice !== '' ? Number(fillPrice) : undefined,
        brokerErrorCode: brokerErrorCode != null && brokerErrorCode !== '' ? Number(brokerErrorCode) : undefined,
        brokerErrorMessage: brokerErrorMessage != null ? String(brokerErrorMessage) : undefined,
        executionLatencyMs: executionLatencyMs != null && executionLatencyMs !== '' ? Number(executionLatencyMs) : undefined,
      },
      dbClient
    );

    if (!ackResult.success) {
      return res.status(ackResult.statusCode || 404).json({ success: false, error: ackResult.error });
    }

    return res.status(200).json({
      success: true,
      acknowledged: true,
      duplicate: Boolean(ackResult.duplicate),
    });
  });

  /**
   * 8. Bridge Diagnostic Mappings & Real Logs (Authenticated & Tenant-Scoped / Admin)
   * GET /api/v1/bridge/mappings
   */
  registerRoute('get', '/api/v1/bridge/mappings', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;

    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const mappings = await bridgeStore.getTradeMappings(dbClient);
      if (caller.isVerifiedAdmin) {
        return res.status(200).json({ success: true, mappings });
      }

      // Tenant isolation: non-admin callers may only inspect mappings for their own MT5 accounts
      const { data: ownedAccounts, error: ownedErr } = await dbClient
        .from('mt5_accounts')
        .select('id')
        .eq('user_id', caller.user.id);

      if (ownedErr) {
        return res.status(500).json({ success: false, error: `Failed to verify account ownership: ${ownedErr.message}` });
      }

      const ownedIds = new Set((ownedAccounts || []).map((a: any) => a.id));
      const scopedMappings = mappings.filter(
        (m) => (m.parentAccountId && ownedIds.has(m.parentAccountId)) || (m.childAccountId && ownedIds.has(m.childAccountId))
      );

      return res.status(200).json({ success: true, mappings: scopedMappings });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load bridge mappings' });
    }
  });

  registerRoute('get', '/api/v1/bridge/logs', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;

    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const logs = await bridgeStore.getSyncLogs(dbClient);
      return res.status(200).json({ success: true, logs });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load bridge logs' });
    }
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
