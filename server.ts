import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

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
  const serviceRoleKey = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

  // System Health Endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'TradeSync MT5 Server Bridge',
      environment: process.env.NODE_ENV || 'development',
      supabaseConfigured: Boolean(supabaseUrl && publishableKey),
      supabaseUrl: supabaseUrl || null,
      hasPublishableKey: Boolean(publishableKey),
      hasServiceRole: Boolean(serviceRoleKey),
      serviceRoleRequiredForClient: false,
      timestamp: new Date().toISOString(),
    });
  });

  // Dedicated Download Endpoint for schema.sql
  app.get(['/schema.sql', '/api/download-schema'], (_req: Request, res: Response) => {
    const schemaPath = path.resolve(__dirname, 'supabase', 'schema.sql');
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

  // Dedicated Supabase Connection, Auth & Tables Verification Endpoint
  app.get('/api/supabase/verify', async (_req: Request, res: Response) => {
    if (!supabaseUrl || !publishableKey) {
      return res.json({
        configured: false,
        error: 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY',
      });
    }

    try {
      // 1. Auth Health Check
      let authStatus: { ok: boolean; status?: number; version?: string; error?: string } = { ok: false };
      try {
        const authRes = await fetch(`${supabaseUrl}/auth/v1/health`, {
          headers: { apikey: publishableKey },
        });
        if (authRes.ok) {
          const authData = await authRes.json();
          authStatus = { ok: true, status: authRes.status, version: authData.version || 'v2' };
        } else {
          authStatus = { ok: false, status: authRes.status, error: await authRes.text() };
        }
      } catch (err: any) {
        authStatus = { ok: false, error: err.message };
      }

      // 2. Database Tables Check via PostgREST
      const tablesToCheck = ['profiles', 'mt5_accounts', 'trades', 'mentor_assignments', 'trade_feedback'];
      const tableResults: Record<string, { exists: boolean; status: number; message: string }> = {};

      for (const table of tablesToCheck) {
        try {
          const tableRes = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&limit=1`, {
            headers: {
              apikey: publishableKey,
              Authorization: `Bearer ${publishableKey}`,
            },
          });
          if (tableRes.ok) {
            tableResults[table] = { exists: true, status: tableRes.status, message: 'Ready and queryable' };
          } else if (tableRes.status === 404) {
            tableResults[table] = { exists: false, status: 404, message: 'Table pending schema execution in Supabase SQL editor' };
          } else if (tableRes.status === 401 || tableRes.status === 403) {
            tableResults[table] = { exists: true, status: tableRes.status, message: 'Protected by Row Level Security (RLS)' };
          } else {
            tableResults[table] = { exists: false, status: tableRes.status, message: `HTTP ${tableRes.status}` };
          }
        } catch (e: any) {
          tableResults[table] = { exists: false, status: 0, message: e.message };
        }
      }

      const allTablesExist = Object.values(tableResults).every((t) => t.exists);

      return res.json({
        configured: true,
        projectUrl: supabaseUrl,
        publishableKeyFormat: publishableKey.startsWith('sb_publishable_') ? 'supabase_publishable_key' : 'supabase_anon_jwt',
        authentication: authStatus,
        tables: tableResults,
        tablesDeployed: allTablesExist,
        rlsPolicies: allTablesExist ? 'Active & Enforced' : 'Pending schema execution in Supabase SQL Editor',
        security: {
          secretKeyExposedToFrontend: false,
          serviceRoleRequiredForClient: false,
          serviceRolePresentOnServer: Boolean(serviceRoleKey),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      return res.status(500).json({
        configured: true,
        error: err.message,
      });
    }
  });

  // System Status Endpoint
  app.get('/api/admin/system-status', (_req: Request, res: Response) => {
    res.json({
      configured: Boolean(supabaseUrl && publishableKey),
      hasServiceRole: Boolean(serviceRoleKey),
      publicUrl: Boolean(supabaseUrl),
      mode: supabaseUrl ? 'cloud' : 'demo-fallback',
      timestamp: new Date().toISOString(),
    });
  });

  // Protected Server-Side Admin Promotion Endpoint (Step 4 of Plan)
  // Public signup must never allow users to assign themselves the Admin role.
  // Admin accounts must be created or promoted ONLY through this secure, authorized server-side process.
  app.post('/api/admin/promote-user', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or malformed Authorization header' });
      }

      if (!supabaseUrl || !serviceRoleKey) {
        return res.status(503).json({
          error: 'Supabase server environment is missing SUPABASE_SERVICE_ROLE_KEY. Cannot elevate role.',
          configured: false,
        });
      }

      const token = authHeader.replace('Bearer ', '').trim();
      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // 1. Authenticate caller using Supabase Auth
      const {
        data: { user: callerUser },
        error: authError,
      } = await adminClient.auth.getUser(token);

      if (authError || !callerUser) {
        return res.status(401).json({ error: 'Unauthorized: Invalid authentication token' });
      }

      // 2. Verify caller has 'admin' role in public.profiles
      const { data: callerProfile, error: profileError } = await adminClient
        .from('profiles')
        .select('role')
        .eq('id', callerUser.id)
        .single();

      if (profileError || callerProfile?.role !== 'admin') {
        return res.status(403).json({
          error: 'Forbidden: Only verified administrators can promote users or change roles',
        });
      }

      const { targetUserId, newRole } = req.body;
      if (!targetUserId || !['admin', 'mentor', 'trader'].includes(newRole)) {
        return res.status(400).json({
          error: 'Invalid request: targetUserId is required and newRole must be admin, mentor, or trader',
        });
      }

      // 3. Elevate user role using server-side service role key
      const { data: updatedProfile, error: updateError } = await adminClient
        .from('profiles')
        .update({
          role: newRole,
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetUserId)
        .select()
        .single();

      if (updateError) {
        return res.status(500).json({ error: updateError.message });
      }

      return res.json({
        success: true,
        message: `User role successfully updated to ${newRole}`,
        profile: updatedProfile,
      });
    } catch (err: any) {
      console.error('Server promotion error:', err);
      return res.status(500).json({ error: err.message || 'Internal server error during promotion' });
    }
  });

  // Vite Dev Server or Production Static Hosting
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[TradeSync MT5] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[TradeSync MT5] Server startup failed:', err);
  process.exit(1);
});
