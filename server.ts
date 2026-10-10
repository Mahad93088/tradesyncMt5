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

  // Supabase Configuration
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // System Health Endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'TradeSync MT5 Server Bridge',
      environment: process.env.NODE_ENV || 'development',
      supabaseConfigured: Boolean(supabaseUrl && serviceRoleKey),
      hasServiceRole: Boolean(serviceRoleKey),
      timestamp: new Date().toISOString(),
    });
  });

  // System Status Endpoint
  app.get('/api/admin/system-status', (_req: Request, res: Response) => {
    res.json({
      configured: Boolean(supabaseUrl && serviceRoleKey),
      hasServiceRole: Boolean(serviceRoleKey),
      publicUrl: Boolean(supabaseUrl),
      mode: supabaseUrl && serviceRoleKey ? 'cloud' : 'demo-fallback',
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
