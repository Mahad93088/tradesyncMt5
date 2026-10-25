import express, { type Request, type Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export function createApiApp() {
  const app = express();
  app.use(express.json());

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

  return app;
}
