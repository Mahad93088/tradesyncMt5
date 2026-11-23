import crypto from 'crypto';
import type { Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  checkMentorFollowerQuota,
  getBillingProviderStatus,
  isMissingRelationError,
  resolveMentorPlanLimit,
  verifyPayPalWebhookSignature,
  verifyStripeWebhookSignature,
  writeAuditLog,
  type AuditLogInput,
} from './billingService.ts';
import { CLIENT_PLAN_LIMITS, LEGACY_PLAN_CODE_COMPAT } from '../config/policy.ts';

export interface Day2RouteContext {
  registerRoute: (
    method: 'get' | 'post' | 'put' | 'delete',
    pathWithApi: string,
    handler: (req: Request, res: Response) => any
  ) => void;
  authenticateSupabaseCaller: (
    req: Request,
    res: Response,
    options?: { requireAdmin?: boolean; requireServiceRole?: boolean }
  ) => Promise<any>;
  requireServiceRoleClient: (res: Response) => SupabaseClient | null;
  getServiceRoleClient: () => SupabaseClient | null;
  isValidUUID: (uuid: unknown) => boolean;
}

export function registerDay2Routes(ctx: Day2RouteContext): void {
  const {
    registerRoute,
    authenticateSupabaseCaller,
    requireServiceRoleClient,
    isValidUUID,
  } = ctx;

  const audit = async (dbClient: SupabaseClient | null | undefined, entry: AuditLogInput) => {
    await writeAuditLog(dbClient, entry);
  };

  // ============================================================================
  // 1. PLATFORM SETTINGS (Super Admin Only Mutation, Demo-Only Lock Immutable)
  // ============================================================================
  registerRoute('get', '/api/admin/platform-settings', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { data, error } = await dbClient
        .from('platform_settings')
        .select('*')
        .eq('id', 'default')
        .maybeSingle();

      if (error && !isMissingRelationError(error)) {
        return res.status(500).json({ success: false, error: error.message });
      }

      const row = data || {
        id: 'default',
        demo_only_enforced: true,
        default_slippage_max_pips: 3.0,
        default_max_lot_cap: 50.0,
        heartbeat_stale_seconds: 60,
        maintenance_mode: false,
        updated_at: new Date().toISOString(),
      };

      return res.status(200).json({
        success: true,
        schemaProvisioned: !error,
        settings: {
          id: row.id || 'default',
          demoOnlyEnforced: true as const,
          defaultSlippageMaxPips: Number(row.default_slippage_max_pips ?? 3.0),
          defaultMaxLotCap: Number(row.default_max_lot_cap ?? 50.0),
          heartbeatStaleSeconds: Number(row.heartbeat_stale_seconds ?? 60),
          maintenanceMode: Boolean(row.maintenance_mode),
          updatedAt: row.updated_at || new Date().toISOString(),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load platform settings' });
    }
  });

  registerRoute('put', '/api/admin/platform-settings', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const body = req.body || {};
      if (body.demoOnlyEnforced === false || body.demo_only_enforced === false) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'PLATFORM_DEMO_LOCK_BYPASS_ATTEMPT',
          targetType: 'platform_settings',
          targetId: 'default',
          result: 'denied',
          details: `Admin ${caller.profile?.email || caller.user.id} attempted to disable demo_only_enforced.`,
        });
        return res.status(403).json({
          success: false,
          code: 'DEMO_ONLY_LOCK_IMMUTABLE',
          error: 'Safety block: Demo-Only enforcement cannot be disabled.',
        });
      }

      const slippage = Number(body.defaultSlippageMaxPips ?? 3.0);
      const maxLotCap = Number(body.defaultMaxLotCap ?? 50.0);
      const staleSec = Number(body.heartbeatStaleSeconds ?? 60);
      const maintenanceMode = Boolean(body.maintenanceMode);

      if (!Number.isFinite(slippage) || slippage < 0 || slippage > 100) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'PLATFORM_SETTINGS_UPDATED',
          targetType: 'platform_settings',
          targetId: 'default',
          result: 'failed',
          details: `Validation failed: invalid defaultSlippageMaxPips (${body.defaultSlippageMaxPips}).`,
        });
        return res.status(400).json({ success: false, error: 'defaultSlippageMaxPips must be between 0 and 100.' });
      }
      if (!Number.isFinite(maxLotCap) || maxLotCap < 0.01 || maxLotCap > 100) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'PLATFORM_SETTINGS_UPDATED',
          targetType: 'platform_settings',
          targetId: 'default',
          result: 'failed',
          details: `Validation failed: invalid defaultMaxLotCap (${body.defaultMaxLotCap}).`,
        });
        return res.status(400).json({ success: false, error: 'defaultMaxLotCap must be between 0.01 and 100.' });
      }
      if (!Number.isFinite(staleSec) || staleSec < 10 || staleSec > 3600) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'PLATFORM_SETTINGS_UPDATED',
          targetType: 'platform_settings',
          targetId: 'default',
          result: 'failed',
          details: `Validation failed: invalid heartbeatStaleSeconds (${body.heartbeatStaleSeconds}).`,
        });
        return res.status(400).json({ success: false, error: 'heartbeatStaleSeconds must be between 10 and 3600.' });
      }

      const payload = {
        id: 'default',
        demo_only_enforced: true,
        default_slippage_max_pips: slippage,
        default_max_lot_cap: maxLotCap,
        heartbeat_stale_seconds: Math.round(staleSec),
        maintenance_mode: maintenanceMode,
        updated_by: caller.user.id,
        updated_at: new Date().toISOString(),
      };

      const { data: saved, error } = await dbClient
        .from('platform_settings')
        .upsert([payload], { onConflict: 'id' })
        .select('*')
        .single();

      if (error) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'PLATFORM_SETTINGS_UPDATED',
          targetType: 'platform_settings',
          targetId: 'default',
          result: 'failed',
          details: `Platform settings save error: ${error.message}`,
        });
        return res.status(500).json({ success: false, error: error.message });
      }

      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'PLATFORM_SETTINGS_UPDATED',
        targetType: 'platform_settings',
        targetId: 'default',
        result: 'success',
        details: `Updated defaultSlippageMaxPips=${slippage}, defaultMaxLotCap=${maxLotCap}, heartbeatStaleSeconds=${Math.round(staleSec)}, maintenanceMode=${maintenanceMode}.`,
        metadata: payload,
      });

      return res.status(200).json({
        success: true,
        settings: {
          id: saved.id,
          demoOnlyEnforced: true as const,
          defaultSlippageMaxPips: Number(saved.default_slippage_max_pips),
          defaultMaxLotCap: Number(saved.default_max_lot_cap),
          heartbeatStaleSeconds: Number(saved.heartbeat_stale_seconds),
          maintenanceMode: Boolean(saved.maintenance_mode),
          updatedAt: saved.updated_at,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to update platform settings' });
    }
  });

  // ============================================================================
  // 2. AUDIT LOGS (Super Admin Read Only)
  // ============================================================================
  registerRoute('get', '/api/admin/audit-logs', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const [logsRes, profRes] = await Promise.all([
        dbClient.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(300),
        dbClient.from('profiles').select('id, full_name, email, role'),
      ]);

      if (logsRes.error) {
        if (isMissingRelationError(logsRes.error)) {
          return res.status(200).json({ success: true, logs: [], schemaMissing: true });
        }
        return res.status(500).json({ success: false, error: logsRes.error.message });
      }

      const profMap = new Map<string, any>();
      for (const p of profRes.data || []) profMap.set(p.id, p);

      const logs = (logsRes.data || []).map((row: any) => {
        const actor = row.actor_id ? profMap.get(row.actor_id) : null;
        return {
          id: row.id,
          timestamp: row.created_at,
          actorId: row.actor_id || 'system',
          actorName: actor?.full_name || actor?.email || (row.actor_role === 'system' ? 'TradeSync Engine' : row.actor_role),
          actorRole: row.actor_role || 'admin',
          action: row.action,
          targetResource: row.target_type || 'system',
          targetId: row.target_id || undefined,
          result: row.result === 'success' ? 'success' : row.result === 'denied' ? 'warning' : 'failure',
          details: row.details || '',
        };
      });

      return res.status(200).json({ success: true, logs });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load audit logs' });
    }
  });

  // ============================================================================
  // 3. NOTIFICATIONS & BROADCASTS (Tenant-Scoped Read + Admin Broadcast)
  // ============================================================================
  registerRoute('get', '/api/admin/notifications', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { data, error } = await dbClient
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) {
        if (isMissingRelationError(error)) return res.status(200).json({ success: true, notifications: [] });
        return res.status(500).json({ success: false, error: error.message });
      }

      const notifications = (data || []).map((n: any) => ({
        id: n.id,
        targetRole: n.target_role || 'all',
        targetUserId: n.user_id || undefined,
        title: n.title,
        message: n.message,
        type: n.type || 'info',
        timestamp: n.created_at,
        read: Boolean(n.is_read),
      }));

      return res.status(200).json({ success: true, notifications });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load admin notifications' });
    }
  });

  registerRoute('post', '/api/admin/notifications', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { targetRole = 'all', targetUserId, type = 'info', title, message } = req.body || {};
      const cleanTitle = String(title || '').trim();
      const cleanMessage = String(message || '').trim();
      const normalizedRole = String(targetRole || 'all').trim().toLowerCase();
      const normalizedType = String(type || 'info').trim().toLowerCase();

      if (!cleanTitle || !cleanMessage) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'NOTIFICATION_BROADCAST',
          targetType: 'notifications',
          result: 'failed',
          details: 'Notification broadcast failed: title and message are required.',
        });
        return res.status(400).json({ success: false, error: 'Title and message are required.' });
      }
      if (!['all', 'admin', 'mentor', 'trader'].includes(normalizedRole)) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'NOTIFICATION_BROADCAST',
          targetType: 'notifications',
          result: 'failed',
          details: `Notification broadcast failed: invalid targetRole "${normalizedRole}".`,
        });
        return res.status(400).json({ success: false, error: 'targetRole must be all, admin, mentor, or trader.' });
      }
      if (!['info', 'success', 'warning', 'error'].includes(normalizedType)) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'NOTIFICATION_BROADCAST',
          targetType: 'notifications',
          result: 'failed',
          details: `Notification broadcast failed: invalid type "${normalizedType}".`,
        });
        return res.status(400).json({ success: false, error: 'type must be info, success, warning, or error.' });
      }
      if (targetUserId && !isValidUUID(targetUserId)) {
        return res.status(400).json({ success: false, error: 'targetUserId must be a valid UUID.' });
      }

      const { data: inserted, error } = await dbClient
        .from('notifications')
        .insert([
          {
            user_id: targetUserId ? String(targetUserId).trim() : null,
            target_role: normalizedRole,
            type: normalizedType,
            title: cleanTitle,
            message: cleanMessage,
            is_read: false,
          },
        ])
        .select('*')
        .single();

      if (error) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'NOTIFICATION_BROADCAST',
          targetType: 'notifications',
          result: 'failed',
          details: `Notification insert failed: ${error.message}`,
        });
        return res.status(500).json({ success: false, error: error.message });
      }

      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'NOTIFICATION_BROADCAST',
        targetType: 'notifications',
        targetId: inserted.id,
        result: 'success',
        details: `Broadcast "${cleanTitle}" sent to target_role=${normalizedRole}${targetUserId ? ` user=${targetUserId}` : ''}.`,
      });

      return res.status(201).json({
        success: true,
        notification: {
          id: inserted.id,
          targetRole: inserted.target_role,
          targetUserId: inserted.user_id || undefined,
          title: inserted.title,
          message: inserted.message,
          type: inserted.type,
          timestamp: inserted.created_at,
          read: Boolean(inserted.is_read),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to publish notification' });
    }
  });

  registerRoute('get', '/api/v1/notifications', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { data, error } = await dbClient
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        if (isMissingRelationError(error)) return res.status(200).json({ success: true, notifications: [] });
        return res.status(500).json({ success: false, error: error.message });
      }

      const role = caller.profile?.role || 'trader';
      const visible = (data || []).filter((n: any) => {
        if (caller.isVerifiedAdmin) return true;
        if (n.user_id === caller.user.id) return true;
        if (n.user_id == null && (n.target_role === 'all' || n.target_role === role)) return true;
        return false;
      });

      return res.status(200).json({
        success: true,
        notifications: visible.map((n: any) => ({
          id: n.id,
          targetRole: n.target_role || 'all',
          targetUserId: n.user_id || undefined,
          title: n.title,
          message: n.message,
          type: n.type || 'info',
          timestamp: n.created_at,
          read: Boolean(n.is_read),
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load notifications' });
    }
  });

  registerRoute('post', '/api/v1/notifications/:notificationId/read', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { notificationId } = req.params;
      if (!isValidUUID(notificationId)) {
        return res.status(400).json({ success: false, error: 'Invalid notificationId UUID.' });
      }

      const { data: existing, error: findErr } = await dbClient
        .from('notifications')
        .select('*')
        .eq('id', notificationId)
        .maybeSingle();

      if (findErr) return res.status(500).json({ success: false, error: findErr.message });
      if (!existing) return res.status(404).json({ success: false, error: 'Notification not found.' });

      if (!caller.isVerifiedAdmin && existing.user_id !== caller.user.id) {
        if (
          existing.user_id == null &&
          (existing.target_role === 'all' || existing.target_role === caller.profile?.role)
        ) {
          // Do not let non-admin mutate global broadcast flag for all tenants
          return res.status(200).json({ success: true, persisted: false, scope: 'client_broadcast_ack' });
        }
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: (caller.profile?.role as any) || 'trader',
          action: 'NOTIFICATION_READ_DENIED',
          targetType: 'notifications',
          targetId: notificationId,
          result: 'denied',
          details: `Blocked attempt to mark another user's notification (${notificationId}) as read.`,
        });
        return res.status(403).json({ success: false, error: 'Forbidden: Cannot modify another user notification.' });
      }

      const { error: updErr } = await dbClient
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      if (updErr) return res.status(500).json({ success: false, error: updErr.message });
      return res.status(200).json({ success: true, persisted: true, notificationId });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to mark notification read' });
    }
  });

  // ============================================================================
  // 4. USER ARCHIVAL WITH FINANCIAL HISTORY RETENTION (Super Admin Only)
  // ============================================================================
  registerRoute('post', '/api/admin/users/:userId/archive', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { userId } = req.params;
      if (!isValidUUID(userId)) {
        return res.status(400).json({ success: false, error: 'Invalid userId UUID.' });
      }
      if (userId === caller.user.id) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'USER_ARCHIVED_HISTORY_PRESERVED',
          targetType: 'profiles',
          targetId: userId,
          result: 'denied',
          details: 'Blocked self-archival attempt by Super Admin.',
        });
        return res.status(400).json({ success: false, error: 'Administrators cannot archive their own account.' });
      }

      const { data: targetProfile, error: profErr } = await dbClient
        .from('profiles')
        .select('id, email, full_name, role, status')
        .eq('id', userId)
        .maybeSingle();

      if (profErr) return res.status(500).json({ success: false, error: profErr.message });
      if (!targetProfile) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'USER_ARCHIVED_HISTORY_PRESERVED',
          targetType: 'profiles',
          targetId: userId,
          result: 'failed',
          details: `User archival failed: target profile ${userId} not found.`,
        });
        return res.status(404).json({ success: false, error: 'Target user profile not found.' });
      }
      if (targetProfile.role === 'admin') {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'USER_ARCHIVED_HISTORY_PRESERVED',
          targetType: 'profiles',
          targetId: userId,
          result: 'denied',
          details: `Blocked archival attempt targeting Super Admin ${targetProfile.email}.`,
        });
        return res.status(403).json({ success: false, error: 'Super Administrator profiles cannot be archived via API.' });
      }

      const nowIso = new Date().toISOString();

      // 1. Stamp archival user identity onto financial tables so history survives even full user removal
      let subscriptionsPreserved = 0;
      let paymentsPreserved = 0;
      let invoicesPreserved = 0;

      const stampFinancialHistory = async (table: 'subscriptions' | 'payments' | 'invoices') => {
        const { data: rows, error: selErr } = await dbClient
          .from(table)
          .select('id')
          .eq('user_id', userId);
        if (selErr || !rows || rows.length === 0) return 0;

        await dbClient
          .from(table)
          .update({
            archived_user_id: userId,
            archived_user_email: targetProfile.email,
            ...(table === 'subscriptions' ? { status: 'cancelled', cancel_at_period_end: false, updated_at: nowIso } : {}),
          })
          .eq('user_id', userId);

        return rows.length;
      };

      subscriptionsPreserved = await stampFinancialHistory('subscriptions').catch(() => 0);
      paymentsPreserved = await stampFinancialHistory('payments').catch(() => 0);
      invoicesPreserved = await stampFinancialHistory('invoices').catch(() => 0);

      // 2. Suspend profile & mark archived_at (fallback without archival cols if Migration 09 not yet applied)
      const { error: archErr } = await dbClient
        .from('profiles')
        .update({
          status: 'suspended',
          archived_at: nowIso,
          archived_email: targetProfile.email,
          updated_at: nowIso,
        })
        .eq('id', userId);

      if (archErr) {
        if (isMissingRelationError(archErr)) {
          const { error: fallbackErr } = await dbClient
            .from('profiles')
            .update({ status: 'suspended', updated_at: nowIso })
            .eq('id', userId);
          if (fallbackErr) return res.status(500).json({ success: false, error: fallbackErr.message });
        } else {
          return res.status(500).json({ success: false, error: archErr.message });
        }
      }

      // 3. Deactivate active assignments & disconnect terminals
      const { data: pausedAssignRows } = await dbClient
        .from('mentor_assignments')
        .update({ status: 'inactive' })
        .or(`mentor_id.eq.${userId},trader_id.eq.${userId}`)
        .eq('status', 'active')
        .select('id');

      await dbClient
        .from('mt5_accounts')
        .update({
          connection_status: 'disconnected',
          ping_ms: 0,
          error_message: 'Account suspended/archived by Super Admin',
        })
        .eq('user_id', userId);

      // 4. Disable Auth login if admin API available
      let authBanned = false;
      if (dbClient.auth?.admin?.updateUserById) {
        const banRes = await dbClient.auth.admin.updateUserById(userId, { ban_duration: '876000h' }).catch(() => null);
        if (banRes && !banRes.error) authBanned = true;
      }

      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'USER_ARCHIVED_HISTORY_PRESERVED',
        targetType: 'profiles',
        targetId: userId,
        result: 'success',
        details: `Archived user ${targetProfile.email} (${targetProfile.role}). Preserved ${subscriptionsPreserved} subscriptions, ${paymentsPreserved} payments, ${invoicesPreserved} invoices.`,
        metadata: { subscriptionsPreserved, paymentsPreserved, invoicesPreserved, authBanned },
      });

      return res.status(200).json({
        success: true,
        archivedUserId: userId,
        pausedAssignments: Array.isArray(pausedAssignRows) ? pausedAssignRows.length : 0,
        preservedRecords: {
          subscriptions: subscriptionsPreserved,
          payments: paymentsPreserved,
          invoices: invoicesPreserved,
        },
        authBanned,
        message: `User ${targetProfile.email} archived cleanly. Financial history preserved.`,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to archive user' });
    }
  });

  // ============================================================================
  // 5. SUBSCRIPTION PLANS, SUBSCRIPTIONS, PAYMENTS, INVOICES & WEBHOOKS
  // ============================================================================
  const mapPlanRow = (p: any) => ({
    id: p.id,
    code: p.code,
    tier: p.tier,
    name: p.name,
    description: p.description || '',
    billingCycle: 'monthly' as const,
    price: Number(p.monthly_price_usd ?? 0),
    monthlyPrice: Number(p.monthly_price_usd ?? 0),
    yearlyPrice: Number(p.yearly_price_usd ?? 0),
    trialDays: Number(p.trial_days ?? 0),
    maxFollowers: Number(p.max_followers ?? CLIENT_PLAN_LIMITS.trial),
    maxChildAccounts: Number(p.max_followers ?? p.max_child_accounts ?? CLIENT_PLAN_LIMITS.trial),
    maxLotSize: 50,
    isActive: p.is_active !== false && p.is_archived !== true,
    isArchived: Boolean(p.is_archived),
    archivedAt: p.archived_at || undefined,
    features: Array.isArray(p.features) ? p.features : [],
    priorityExecution: p.tier === 'enterprise' || Number(p.max_followers) >= 50,
    slTpSync: true,
    isPopular: p.code === 'silver' || (LEGACY_PLAN_CODE_COMPAT && p.code === 'pro_50'),
  });

  registerRoute('get', '/api/v1/billing/plans', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { data, error } = await dbClient
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true)
        .order('monthly_price_usd', { ascending: true });

      if (error) {
        if (isMissingRelationError(error)) {
          return res.status(200).json({ success: true, plans: [], providerStatus: getBillingProviderStatus(), schemaMissing: true });
        }
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(200).json({
        success: true,
        plans: (data || []).filter((p: any) => p.is_archived !== true).map(mapPlanRow),
        providerStatus: getBillingProviderStatus(),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load billing plans' });
    }
  });

  registerRoute('get', '/api/admin/subscription-plans', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { data, error } = await dbClient
        .from('subscription_plans')
        .select('*')
        .order('monthly_price_usd', { ascending: true });

      if (error) {
        if (isMissingRelationError(error)) {
          return res.status(200).json({ success: true, plans: [], providerStatus: getBillingProviderStatus(), schemaMissing: true });
        }
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(200).json({
        success: true,
        plans: (data || []).map(mapPlanRow),
        providerStatus: getBillingProviderStatus(),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load subscription plans' });
    }
  });

  registerRoute('post', '/api/admin/subscription-plans', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const b = req.body || {};
      const name = String(b.name || '').trim();
      const rawCode = String(b.code || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).trim();
      const code = rawCode;
      const description = typeof b.description === 'string' ? b.description.trim() : '';
      const tier = ['free_demo', 'trader_pro', 'mentor_pro', 'enterprise'].includes(String(b.tier))
        ? String(b.tier)
        : 'mentor_pro';
      const monthlyPrice = Number(b.monthlyPrice ?? b.price ?? 0);
      const yearlyPrice = Number(b.yearlyPrice ?? monthlyPrice * 10);
      const trialDays = b.trialDays !== undefined ? Math.max(0, Math.min(365, Math.round(Number(b.trialDays)))) : 0;
      const maxFollowers = Math.max(1, Math.round(Number(b.maxFollowers ?? b.maxChildAccounts ?? 10)));
      const maxChildAccounts = Math.max(1, Math.round(Number(b.maxChildAccounts ?? maxFollowers)));
      const isActive = b.isActive !== false;
      const features = Array.isArray(b.features) ? b.features.map(String).filter((s: string) => s.trim().length > 0) : [];

      if (!name || !code) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'SUBSCRIPTION_PLAN_CREATED',
          targetType: 'subscription_plans',
          result: 'failed',
          details: 'Plan creation failed: plan name and code are required.',
        });
        return res.status(400).json({ success: false, error: 'Plan name and code are required.' });
      }
      if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0 || !Number.isFinite(yearlyPrice) || yearlyPrice < 0) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'SUBSCRIPTION_PLAN_CREATED',
          targetType: 'subscription_plans',
          result: 'failed',
          details: `Plan creation failed for ${name}: negative or invalid pricing.`,
        });
        return res.status(400).json({ success: false, error: 'Prices must be non-negative finite numbers.' });
      }
      if (!Number.isFinite(trialDays) || trialDays < 0 || trialDays > 365) {
        return res.status(400).json({ success: false, error: 'trialDays must be between 0 and 365.' });
      }

      const corePayload = {
        code,
        name,
        tier,
        monthly_price_usd: monthlyPrice,
        yearly_price_usd: yearlyPrice,
        max_followers: maxFollowers,
        max_child_accounts: maxChildAccounts,
        is_active: isActive,
        features,
      };
      const extendedPayload = {
        ...corePayload,
        description,
        trial_days: trialDays,
        is_archived: false,
      };

      let insertedRes = await dbClient
        .from('subscription_plans')
        .insert([extendedPayload])
        .select('*')
        .single();

      if (insertedRes.error && isMissingRelationError(insertedRes.error)) {
        insertedRes = await dbClient
          .from('subscription_plans')
          .insert([corePayload])
          .select('*')
          .single();
      }

      const { data: inserted, error } = insertedRes;

      if (error) {
        const isDuplicate =
          String(error.code || '') === '23505' ||
          String(error.message || '').toLowerCase().includes('duplicate') ||
          String(error.message || '').toLowerCase().includes('unique');
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'SUBSCRIPTION_PLAN_CREATED',
          targetType: 'subscription_plans',
          result: 'failed',
          details: `Plan creation failed for ${name} (${code}): ${error.message}`,
        });
        return res.status(isDuplicate ? 409 : 500).json({
          success: false,
          code: isDuplicate ? 'DUPLICATE_PLAN_CODE' : undefined,
          error: isDuplicate
            ? `A subscription plan with code "${code}" already exists. Use a different plan code or edit the existing plan.`
            : error.message,
        });
      }

      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'SUBSCRIPTION_PLAN_CREATED',
        targetType: 'subscription_plans',
        targetId: inserted.id,
        result: 'success',
        details: `Created subscription plan ${name} (${code}) with max_followers=${maxFollowers}, monthly=$${monthlyPrice}, trialDays=${trialDays}.`,
      });

      return res.status(201).json({ success: true, plan: mapPlanRow(inserted) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to create subscription plan' });
    }
  });

  registerRoute('put', '/api/admin/subscription-plans/:planId', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { planId } = req.params;
      if (!isValidUUID(planId)) return res.status(400).json({ success: false, error: 'Invalid planId UUID.' });

      const b = req.body || {};
      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      if (b.name !== undefined) {
        const cleanName = String(b.name).trim();
        if (!cleanName) return res.status(400).json({ success: false, error: 'Plan name cannot be empty.' });
        patch.name = cleanName;
      }
      if (b.tier !== undefined && ['free_demo', 'trader_pro', 'mentor_pro', 'enterprise'].includes(String(b.tier))) {
        patch.tier = String(b.tier);
      }
      if (b.monthlyPrice !== undefined || b.price !== undefined) {
        const m = Number(b.monthlyPrice ?? b.price);
        if (!Number.isFinite(m) || m < 0) return res.status(400).json({ success: false, error: 'Invalid monthlyPrice.' });
        patch.monthly_price_usd = m;
      }
      if (b.yearlyPrice !== undefined) {
        const y = Number(b.yearlyPrice);
        if (!Number.isFinite(y) || y < 0) return res.status(400).json({ success: false, error: 'Invalid yearlyPrice.' });
        patch.yearly_price_usd = y;
      }
      if (b.maxFollowers !== undefined || b.maxChildAccounts !== undefined) {
        const mf = Math.round(Number(b.maxFollowers ?? b.maxChildAccounts));
        if (!Number.isFinite(mf) || mf < 1) return res.status(400).json({ success: false, error: 'maxFollowers must be >= 1.' });
        patch.max_followers = mf;
        patch.max_child_accounts = Math.round(Number(b.maxChildAccounts ?? mf));
      }
      if (typeof b.isActive === 'boolean') patch.is_active = b.isActive;
      if (Array.isArray(b.features)) patch.features = b.features.map(String);

      const extendedPatch: Record<string, any> = { ...patch };
      if (b.description !== undefined) extendedPatch.description = String(b.description || '').trim();
      if (b.trialDays !== undefined) {
        const td = Math.round(Number(b.trialDays));
        if (!Number.isFinite(td) || td < 0 || td > 365) {
          return res.status(400).json({ success: false, error: 'trialDays must be between 0 and 365.' });
        }
        extendedPatch.trial_days = td;
      }
      if (typeof b.isArchived === 'boolean') {
        extendedPatch.is_archived = b.isArchived;
        extendedPatch.archived_at = b.isArchived ? new Date().toISOString() : null;
        if (b.isArchived) extendedPatch.is_active = false;
      }

      let updateRes = await dbClient
        .from('subscription_plans')
        .update(extendedPatch)
        .eq('id', planId)
        .select('*')
        .single();

      if (updateRes.error && isMissingRelationError(updateRes.error)) {
        updateRes = await dbClient
          .from('subscription_plans')
          .update(patch)
          .eq('id', planId)
          .select('*')
          .single();
      }

      const { data: updated, error } = updateRes;

      if (error) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'SUBSCRIPTION_PLAN_UPDATED',
          targetType: 'subscription_plans',
          targetId: planId,
          result: 'failed',
          details: `Failed updating subscription plan ${planId}: ${error.message}`,
        });
        return res.status(500).json({ success: false, error: error.message });
      }

      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'SUBSCRIPTION_PLAN_UPDATED',
        targetType: 'subscription_plans',
        targetId: planId,
        result: 'success',
        details: `Updated subscription plan ${updated.name} (${updated.code}).`,
        metadata: extendedPatch,
      });

      return res.status(200).json({ success: true, plan: mapPlanRow(updated) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to update subscription plan' });
    }
  });

  registerRoute('delete', '/api/admin/subscription-plans/:planId', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { planId } = req.params;
      if (!isValidUUID(planId)) return res.status(400).json({ success: false, error: 'Invalid planId UUID.' });

      const { data: existing, error: findErr } = await dbClient
        .from('subscription_plans')
        .select('*')
        .eq('id', planId)
        .maybeSingle();

      if (findErr) return res.status(500).json({ success: false, error: findErr.message });
      if (!existing) return res.status(404).json({ success: false, error: 'Subscription plan not found.' });

      const nowIso = new Date().toISOString();
      let archRes = await dbClient
        .from('subscription_plans')
        .update({
          is_active: false,
          is_archived: true,
          archived_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', planId)
        .select('*')
        .single();

      if (archRes.error && isMissingRelationError(archRes.error)) {
        archRes = await dbClient
          .from('subscription_plans')
          .update({
            is_active: false,
            updated_at: nowIso,
          })
          .eq('id', planId)
          .select('*')
          .single();
      }

      if (archRes.error) {
        return res.status(500).json({ success: false, error: archRes.error.message });
      }

      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'SUBSCRIPTION_PLAN_ARCHIVED',
        targetType: 'subscription_plans',
        targetId: planId,
        result: 'success',
        details: `Safely archived subscription plan ${existing.name} (${existing.code}) while preserving historical subscription & payment records.`,
      });

      return res.status(200).json({
        success: true,
        archived: true,
        preservesSubscriptions: true,
        plan: mapPlanRow(archRes.data),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to archive subscription plan' });
    }
  });

  registerRoute('get', '/api/admin/subscriptions', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const [subRes, planRes, profRes, assignRes] = await Promise.all([
        dbClient.from('subscriptions').select('*').order('created_at', { ascending: false }),
        dbClient.from('subscription_plans').select('*'),
        dbClient.from('profiles').select('id, full_name, email, role'),
        dbClient.from('mentor_assignments').select('mentor_id, trader_id, status').eq('status', 'active'),
      ]);

      if (subRes.error) {
        if (isMissingRelationError(subRes.error)) return res.status(200).json({ success: true, subscriptions: [], schemaMissing: true });
        return res.status(500).json({ success: false, error: subRes.error.message });
      }

      const planMap = new Map<string, any>();
      for (const p of planRes.data || []) planMap.set(p.id, p);
      const profMap = new Map<string, any>();
      for (const p of profRes.data || []) profMap.set(p.id, p);
      const followerTraderSets = new Map<string, Set<string>>();
      for (const a of assignRes.data || []) {
        if (!a?.mentor_id) continue;
        if (!followerTraderSets.has(a.mentor_id)) followerTraderSets.set(a.mentor_id, new Set<string>());
        if (a.trader_id) followerTraderSets.get(a.mentor_id)!.add(String(a.trader_id));
      }
      const followerCount = new Map<string, number>();
      for (const [mId, tSet] of followerTraderSets.entries()) {
        followerCount.set(mId, tSet.size);
      }

      const subscriptions = (subRes.data || []).map((s: any) => {
        const prof = profMap.get(s.mentor_id || s.user_id) || profMap.get(s.user_id);
        const plan = s.plan_id ? planMap.get(s.plan_id) : null;
        const mentorKey = s.mentor_id || s.user_id;
        return {
          id: s.id,
          userId: s.user_id || s.archived_user_id || undefined,
          mentorId: mentorKey || '',
          mentorName: prof?.full_name || prof?.email || s.archived_user_email || 'Archived Account',
          userEmail: prof?.email || s.archived_user_email || undefined,
          planId: s.plan_id || '',
          planName: plan?.name || 'Custom Plan',
          status: s.status === 'past_due' ? 'suspended' : s.status,
          billingCycle: s.billing_cycle || 'monthly',
          price: Number(s.amount_usd ?? 0),
          currency: s.currency || 'USD',
          startedAt: s.current_period_start || s.created_at,
          expiresAt: s.current_period_end || s.created_at,
          usedChildAccounts: mentorKey ? followerCount.get(mentorKey) || 0 : 0,
          maxFollowers: plan?.max_followers != null ? Number(plan.max_followers) : undefined,
          autoRenew: !s.cancel_at_period_end,
        };
      });

      return res.status(200).json({ success: true, subscriptions });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load subscriptions' });
    }
  });

  registerRoute('post', '/api/admin/subscriptions', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { userId, mentorId, planId, billingCycle = 'monthly', status = 'active', autoRenew = true } = req.body || {};
      const cleanUserId = String(userId || mentorId || '').trim();
      if (!isValidUUID(cleanUserId) || !isValidUUID(planId)) {
        return res.status(400).json({ success: false, error: 'Valid userId and planId UUIDs are required.' });
      }

      const [profRes, planRes] = await Promise.all([
        dbClient.from('profiles').select('id, role, email').eq('id', cleanUserId).maybeSingle(),
        dbClient.from('subscription_plans').select('*').eq('id', planId).maybeSingle(),
      ]);

      if (!profRes.data) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'ADMIN_SUBSCRIPTION_ASSIGNED',
          targetType: 'subscriptions',
          targetId: cleanUserId,
          result: 'failed',
          details: `Subscription assignment failed: target user profile ${cleanUserId} not found.`,
        });
        return res.status(404).json({ success: false, error: 'Target user profile not found.' });
      }
      if (!planRes.data) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'ADMIN_SUBSCRIPTION_ASSIGNED',
          targetType: 'subscriptions',
          targetId: planId,
          result: 'failed',
          details: `Subscription assignment failed: plan ${planId} not found.`,
        });
        return res.status(404).json({ success: false, error: 'Target subscription plan not found.' });
      }

      const cycle = billingCycle === 'yearly' ? 'yearly' : 'monthly';
      const amount = Number(cycle === 'yearly' ? planRes.data.yearly_price_usd : planRes.data.monthly_price_usd);
      const dbStatus = ['trial', 'active', 'past_due', 'cancelled', 'expired'].includes(status) ? status : 'active';
      const now = new Date();
      const end = new Date(now.getTime() + (cycle === 'yearly' ? 365 : 30) * 86400_000);

      const { data: inserted, error } = await dbClient
        .from('subscriptions')
        .insert([
          {
            user_id: cleanUserId,
            mentor_id: profRes.data.role === 'mentor' ? cleanUserId : mentorId && isValidUUID(mentorId) ? mentorId : null,
            plan_id: planId,
            status: dbStatus,
            billing_cycle: cycle,
            amount_usd: amount,
            currency: 'USD',
            current_period_start: now.toISOString(),
            current_period_end: end.toISOString(),
            cancel_at_period_end: !autoRenew,
          },
        ])
        .select('*')
        .single();

      if (error) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'ADMIN_SUBSCRIPTION_ASSIGNED',
          targetType: 'subscriptions',
          targetId: cleanUserId,
          result: 'failed',
          details: `Subscription assignment DB error for ${profRes.data.email}: ${error.message}`,
        });
        return res.status(500).json({ success: false, error: error.message });
      }

      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'ADMIN_SUBSCRIPTION_ASSIGNED',
        targetType: 'subscriptions',
        targetId: inserted.id,
        result: 'success',
        details: `Assigned plan ${planRes.data.name} (${cycle}, $${amount}) to ${profRes.data.email} with status=${dbStatus}.`,
      });

      return res.status(201).json({ success: true, subscription: inserted });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to assign subscription' });
    }
  });

  registerRoute('put', '/api/admin/subscriptions/:subscriptionId', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { subscriptionId } = req.params;
      if (!isValidUUID(subscriptionId)) {
        return res.status(400).json({ success: false, error: 'Invalid subscriptionId UUID.' });
      }

      const b = req.body || {};
      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      if (b.status !== undefined) {
        const s = b.status === 'suspended' ? 'past_due' : String(b.status);
        if (!['trial', 'active', 'past_due', 'cancelled', 'expired'].includes(s)) {
          return res.status(400).json({ success: false, error: 'Invalid subscription status.' });
        }
        patch.status = s;
      }
      if (typeof b.autoRenew === 'boolean') patch.cancel_at_period_end = !b.autoRenew;
      if (b.planId && isValidUUID(b.planId)) patch.plan_id = b.planId;
      if (b.billingCycle === 'monthly' || b.billingCycle === 'yearly') patch.billing_cycle = b.billingCycle;
      if (b.expiresAt) patch.current_period_end = new Date(b.expiresAt).toISOString();

      const { data: updated, error } = await dbClient
        .from('subscriptions')
        .update(patch)
        .eq('id', subscriptionId)
        .select('*')
        .single();

      if (error) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: 'admin',
          action: 'ADMIN_SUBSCRIPTION_UPDATED',
          targetType: 'subscriptions',
          targetId: subscriptionId,
          result: 'failed',
          details: `Subscription update failed for ${subscriptionId}: ${error.message}`,
        });
        return res.status(500).json({ success: false, error: error.message });
      }

      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'ADMIN_SUBSCRIPTION_UPDATED',
        targetType: 'subscriptions',
        targetId: subscriptionId,
        result: 'success',
        details: `Updated subscription ${subscriptionId} (${Object.keys(patch).join(', ')}).`,
        metadata: patch,
      });

      return res.status(200).json({ success: true, subscription: updated });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to update subscription' });
    }
  });

  registerRoute('get', '/api/admin/payments', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const [payRes, profRes] = await Promise.all([
        dbClient.from('payments').select('*').order('created_at', { ascending: false }).limit(300),
        dbClient.from('profiles').select('id, full_name, email'),
      ]);

      if (payRes.error) {
        if (isMissingRelationError(payRes.error)) return res.status(200).json({ success: true, payments: [] });
        return res.status(500).json({ success: false, error: payRes.error.message });
      }

      const profMap = new Map<string, any>();
      for (const p of profRes.data || []) profMap.set(p.id, p);

      const payments = (payRes.data || []).map((row: any) => {
        const prof = row.user_id ? profMap.get(row.user_id) : null;
        return {
          id: row.id,
          subscriptionId: row.subscription_id || null,
          userId: row.user_id || row.archived_user_id || null,
          userName: prof?.full_name || prof?.email || row.archived_user_email || 'Archived User',
          userEmail: prof?.email || row.archived_user_email || undefined,
          provider: row.provider || 'manual',
          providerPaymentId: row.provider_payment_id || null,
          amountUsd: Number(row.amount_usd ?? 0),
          currency: row.currency || 'USD',
          status: row.status || 'pending',
          paidAt: row.paid_at || null,
          createdAt: row.created_at,
        };
      });

      return res.status(200).json({ success: true, payments, providerStatus: getBillingProviderStatus() });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load payments' });
    }
  });

  registerRoute('get', '/api/admin/invoices', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const [invRes, profRes] = await Promise.all([
        dbClient.from('invoices').select('*').order('issued_at', { ascending: false }).limit(300),
        dbClient.from('profiles').select('id, full_name, email'),
      ]);

      if (invRes.error) {
        if (isMissingRelationError(invRes.error)) return res.status(200).json({ success: true, invoices: [] });
        return res.status(500).json({ success: false, error: invRes.error.message });
      }

      const profMap = new Map<string, any>();
      for (const p of profRes.data || []) profMap.set(p.id, p);

      const invoices = (invRes.data || []).map((row: any) => {
        const prof = row.user_id ? profMap.get(row.user_id) : null;
        return {
          id: row.id,
          subscriptionId: row.subscription_id || null,
          paymentId: row.payment_id || null,
          userId: row.user_id || row.archived_user_id || null,
          userName: prof?.full_name || prof?.email || row.archived_user_email || 'Archived User',
          userEmail: prof?.email || row.archived_user_email || undefined,
          invoiceNumber: row.invoice_number,
          amountUsd: Number(row.amount_usd ?? 0),
          currency: row.currency || 'USD',
          status: row.status || 'open',
          issuedAt: row.issued_at,
          dueAt: row.due_at || null,
          paidAt: row.paid_at || null,
        };
      });

      return res.status(200).json({ success: true, invoices });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load invoices' });
    }
  });

  registerRoute('get', '/api/v1/billing/me', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const [subRes, payRes, invRes, quota] = await Promise.all([
        dbClient.from('subscriptions').select('*').or(`user_id.eq.${caller.user.id},mentor_id.eq.${caller.user.id}`).order('created_at', { ascending: false }),
        dbClient.from('payments').select('*').eq('user_id', caller.user.id).order('created_at', { ascending: false }).limit(50),
        dbClient.from('invoices').select('*').eq('user_id', caller.user.id).order('issued_at', { ascending: false }).limit(50),
        caller.profile?.role === 'mentor'
          ? checkMentorFollowerQuota(dbClient, caller.user.id)
          : Promise.resolve(null),
      ]);

      const subRows = subRes.error && isMissingRelationError(subRes.error) ? [] : subRes.data || [];
      const payRows = payRes.error && isMissingRelationError(payRes.error) ? [] : payRes.data || [];
      const invRows = invRes.error && isMissingRelationError(invRes.error) ? [] : invRes.data || [];

      return res.status(200).json({
        success: true,
        providerStatus: getBillingProviderStatus(),
        quota,
        subscriptions: subRows.map((s: any) => ({
          id: s.id,
          userId: s.user_id,
          mentorId: s.mentor_id || s.user_id,
          mentorName: caller.profile?.full_name || caller.profile?.email || 'Account',
          planId: s.plan_id || '',
          planName: 'Active Plan',
          status: s.status === 'past_due' ? 'suspended' : s.status,
          billingCycle: s.billing_cycle || 'monthly',
          price: Number(s.amount_usd ?? 0),
          currency: s.currency || 'USD',
          startedAt: s.current_period_start || s.created_at,
          expiresAt: s.current_period_end || s.created_at,
          autoRenew: !s.cancel_at_period_end,
        })),
        payments: payRows.map((row: any) => ({
          id: row.id,
          subscriptionId: row.subscription_id || null,
          userId: row.user_id,
          provider: row.provider,
          providerPaymentId: row.provider_payment_id || null,
          amountUsd: Number(row.amount_usd ?? 0),
          currency: row.currency || 'USD',
          status: row.status,
          paidAt: row.paid_at || null,
          createdAt: row.created_at,
        })),
        invoices: invRows.map((row: any) => ({
          id: row.id,
          subscriptionId: row.subscription_id || null,
          paymentId: row.payment_id || null,
          userId: row.user_id,
          invoiceNumber: row.invoice_number,
          amountUsd: Number(row.amount_usd ?? 0),
          currency: row.currency || 'USD',
          status: row.status,
          issuedAt: row.issued_at,
          dueAt: row.due_at || null,
          paidAt: row.paid_at || null,
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load billing summary' });
    }
  });

  // Honest Real-Gateway Checkout (Never Fakes Success When Keys Are Missing)
  registerRoute('post', '/api/v1/billing/checkout', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { provider = 'stripe', planId, billingCycle = 'monthly', successUrl, cancelUrl } = req.body || {};
      const cleanProvider = String(provider).trim().toLowerCase();
      if (cleanProvider !== 'stripe' && cleanProvider !== 'paypal') {
        return res.status(400).json({ success: false, error: 'Unsupported payment provider. Use stripe or paypal.' });
      }
      if (!isValidUUID(planId)) {
        return res.status(400).json({ success: false, error: 'Valid planId UUID is required.' });
      }

      const { data: plan, error: planErr } = await dbClient
        .from('subscription_plans')
        .select('*')
        .eq('id', planId)
        .eq('is_active', true)
        .maybeSingle();

      if (planErr) return res.status(500).json({ success: false, error: planErr.message });
      if (!plan) return res.status(404).json({ success: false, error: 'Selected subscription plan not found or inactive.' });

      const status = getBillingProviderStatus();
      if (cleanProvider === 'stripe' && !status.stripeConfigured) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: (caller.profile?.role as any) || 'trader',
          action: 'BILLING_CHECKOUT_INITIATED',
          targetType: 'subscription_plans',
          targetId: plan.id,
          result: 'failed',
          details: `Stripe checkout unavailable for plan ${plan.name}: provider unconfigured.`,
        });
        return res.status(501).json({
          success: false,
          code: 'PAYMENT_PROVIDER_UNCONFIGURED',
          provider: 'stripe',
          error:
            'Stripe checkout is not configured on this server (missing STRIPE_SECRET_KEY). No charge was processed and your subscription was not altered.',
        });
      }
      if (cleanProvider === 'paypal' && !status.paypalConfigured) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: (caller.profile?.role as any) || 'trader',
          action: 'BILLING_CHECKOUT_INITIATED',
          targetType: 'subscription_plans',
          targetId: plan.id,
          result: 'failed',
          details: `PayPal checkout unavailable for plan ${plan.name}: provider unconfigured.`,
        });
        return res.status(501).json({
          success: false,
          code: 'PAYMENT_PROVIDER_UNCONFIGURED',
          provider: 'paypal',
          error:
            'PayPal checkout is not configured on this server (missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET). No charge was processed and your subscription was not altered.',
        });
      }

      const cycle = billingCycle === 'yearly' ? 'yearly' : 'monthly';
      const amountUsd = Number(cycle === 'yearly' ? plan.yearly_price_usd : plan.monthly_price_usd);

      if (cleanProvider === 'stripe') {
        const stripeSecret = process.env.STRIPE_SECRET_KEY!.trim();
        const originFallback = `${req.protocol}://${req.get('host')}`;
        const form = new URLSearchParams({
          mode: 'subscription',
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][unit_amount]': String(Math.round(amountUsd * 100)),
          'line_items[0][price_data][recurring][interval]': cycle === 'yearly' ? 'year' : 'month',
          'line_items[0][price_data][product_data][name]': `TradeSync MT5 — ${plan.name}`,
          'line_items[0][quantity]': '1',
          success_url: String(successUrl || `${originFallback}/?checkout=success`),
          cancel_url: String(cancelUrl || `${originFallback}/?checkout=cancelled`),
          'metadata[user_id]': caller.user.id,
          'metadata[plan_id]': plan.id,
          'metadata[billing_cycle]': cycle,
        });

        const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${stripeSecret}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        });
        const stripeJson = await stripeRes.json().catch(() => null);
        if (!stripeRes.ok || !stripeJson?.url) {
          await audit(dbClient, {
            actorId: caller.user.id,
            actorRole: (caller.profile?.role as any) || 'trader',
            action: 'BILLING_CHECKOUT_INITIATED',
            targetType: 'subscription_plans',
            targetId: plan.id,
            result: 'failed',
            details: `Stripe Checkout session creation failed for ${plan.name}: ${stripeJson?.error?.message || stripeRes.status}`,
          });
          return res.status(502).json({
            success: false,
            code: 'STRIPE_SESSION_FAILED',
            error: stripeJson?.error?.message || 'Stripe Checkout session creation failed.',
          });
        }

        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: (caller.profile?.role as any) || 'trader',
          action: 'BILLING_CHECKOUT_INITIATED',
          targetType: 'subscription_plans',
          targetId: plan.id,
          result: 'success',
          details: `Created Stripe checkout session ${stripeJson.id} for plan ${plan.name} (${cycle}).`,
        });

        return res.status(200).json({
          success: true,
          provider: 'stripe',
          sessionId: stripeJson.id,
          checkoutUrl: stripeJson.url,
        });
      }

      // PayPal Orders v2 checkout
      const ppClientId = process.env.PAYPAL_CLIENT_ID!.trim();
      const ppSecret = process.env.PAYPAL_CLIENT_SECRET!.trim();
      const ppBase =
        process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

      const tokenRes = await fetch(`${ppBase}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${ppClientId}:${ppSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      const tokenJson = await tokenRes.json().catch(() => null);
      if (!tokenRes.ok || !tokenJson?.access_token) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: (caller.profile?.role as any) || 'trader',
          action: 'BILLING_CHECKOUT_INITIATED',
          targetType: 'subscription_plans',
          targetId: plan.id,
          result: 'failed',
          details: `PayPal OAuth failed during checkout for plan ${plan.name}.`,
        });
        return res.status(502).json({
          success: false,
          code: 'PAYPAL_AUTH_FAILED',
          error: 'Failed to authenticate with PayPal OAuth server.',
        });
      }

      const orderRes = await fetch(`${ppBase}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [
            {
              custom_id: `${caller.user.id}:${plan.id}:${cycle}`,
              description: `TradeSync MT5 — ${plan.name} (${cycle})`,
              amount: { currency_code: 'USD', value: amountUsd.toFixed(2) },
            },
          ],
        }),
      });
      const orderJson = await orderRes.json().catch(() => null);
      const approveUrl = Array.isArray(orderJson?.links)
        ? orderJson.links.find((l: any) => l.rel === 'approve')?.href
        : null;

      if (!orderRes.ok || !approveUrl) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: (caller.profile?.role as any) || 'trader',
          action: 'BILLING_CHECKOUT_INITIATED',
          targetType: 'subscription_plans',
          targetId: plan.id,
          result: 'failed',
          details: `PayPal order creation failed for ${plan.name}: ${orderJson?.message || orderRes.status}`,
        });
        return res.status(502).json({
          success: false,
          code: 'PAYPAL_ORDER_FAILED',
          error: orderJson?.message || 'PayPal order creation failed.',
        });
      }

      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: (caller.profile?.role as any) || 'trader',
        action: 'BILLING_CHECKOUT_INITIATED',
        targetType: 'subscription_plans',
        targetId: plan.id,
        result: 'success',
        details: `Created PayPal checkout order ${orderJson.id} for plan ${plan.name} (${cycle}).`,
      });

      return res.status(200).json({
        success: true,
        provider: 'paypal',
        sessionId: orderJson.id,
        checkoutUrl: approveUrl,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Checkout initiation error' });
    }
  });

  // Stripe Webhook with HMAC-SHA256 verification + replay idempotency
  registerRoute('post', '/api/v1/billing/webhooks/stripe', async (req: Request, res: Response) => {
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    const rawBody = typeof (req as any).rawBody === 'string' ? (req as any).rawBody : JSON.stringify(req.body || {});
    const sigCheck = verifyStripeWebhookSignature({
      rawBody,
      signatureHeader: req.headers['stripe-signature'] as string | undefined,
    });

    if (!sigCheck.valid) {
      await audit(dbClient, {
        actorId: null,
        actorRole: 'system',
        action: 'STRIPE_WEBHOOK_REJECTED',
        targetType: 'payment_webhooks',
        result: 'denied',
        details: sigCheck.reason || 'Invalid Stripe webhook signature.',
      });
      return res.status(401).json({
        success: false,
        code: 'INVALID_WEBHOOK_SIGNATURE',
        error: sigCheck.reason || 'Invalid Stripe webhook signature.',
      });
    }

    try {
      const event = req.body || {};
      const eventId = String(event.id || '').trim();
      const eventType = String(event.type || '').trim();
      if (!eventId || !eventType) {
        return res.status(400).json({ success: false, error: 'Missing Stripe event id or type.' });
      }

      const { data: existingWebhook } = await dbClient
        .from('payment_webhooks')
        .select('id, processed')
        .eq('event_id', eventId)
        .maybeSingle();

      if (existingWebhook?.processed) {
        return res.status(200).json({ success: true, duplicate: true, eventId });
      }

      if (!existingWebhook) {
        await dbClient.from('payment_webhooks').insert([
          {
            provider: 'stripe',
            event_id: eventId,
            event_type: eventType,
            payload: event,
            processed: false,
          },
        ]);
      }

      const obj = event.data?.object || {};
      const meta = obj.metadata || {};
      const targetUserId = isValidUUID(meta.user_id) ? String(meta.user_id) : null;
      const targetPlanId = isValidUUID(meta.plan_id) ? String(meta.plan_id) : null;
      const cycle = meta.billing_cycle === 'yearly' ? 'yearly' : 'monthly';
      const amountTotal = Number(obj.amount_total ?? obj.amount_paid ?? 0) / 100;

      if (
        targetUserId &&
        (eventType === 'checkout.session.completed' || eventType === 'invoice.payment_succeeded')
      ) {
        const now = new Date();
        const periodEnd = new Date(now.getTime() + (cycle === 'yearly' ? 365 : 30) * 86400_000);
        const { data: subRow } = await dbClient
          .from('subscriptions')
          .insert([
            {
              user_id: targetUserId,
              mentor_id: targetUserId,
              plan_id: targetPlanId,
              status: 'active',
              billing_cycle: cycle,
              amount_usd: Number.isFinite(amountTotal) && amountTotal >= 0 ? amountTotal : 0,
              currency: String(obj.currency || 'USD').toUpperCase(),
              current_period_start: now.toISOString(),
              current_period_end: periodEnd.toISOString(),
              cancel_at_period_end: false,
            },
          ])
          .select('*')
          .single();

        const { data: payRow } = await dbClient
          .from('payments')
          .insert([
            {
              subscription_id: subRow?.id || null,
              user_id: targetUserId,
              provider: 'stripe',
              provider_payment_id: String(obj.payment_intent || obj.id || eventId),
              amount_usd: Number.isFinite(amountTotal) && amountTotal >= 0 ? amountTotal : 0,
              currency: String(obj.currency || 'USD').toUpperCase(),
              status: 'succeeded',
              paid_at: now.toISOString(),
            },
          ])
          .select('*')
          .single();

        await dbClient.from('invoices').insert([
          {
            subscription_id: subRow?.id || null,
            payment_id: payRow?.id || null,
            user_id: targetUserId,
            invoice_number: `INV-STR-${eventId.slice(-8).toUpperCase()}`,
            amount_usd: Number.isFinite(amountTotal) && amountTotal >= 0 ? amountTotal : 0,
            currency: String(obj.currency || 'USD').toUpperCase(),
            status: 'paid',
            issued_at: now.toISOString(),
            paid_at: now.toISOString(),
          },
        ]);
      } else if (targetUserId && eventType === 'invoice.payment_failed') {
        await dbClient
          .from('subscriptions')
          .update({ status: 'past_due', updated_at: new Date().toISOString() })
          .eq('user_id', targetUserId)
          .eq('status', 'active');
      } else if (targetUserId && eventType === 'customer.subscription.deleted') {
        await dbClient
          .from('subscriptions')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('user_id', targetUserId)
          .in('status', ['active', 'trial', 'past_due']);
      }

      await dbClient
        .from('payment_webhooks')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('event_id', eventId);

      await audit(dbClient, {
        actorId: targetUserId,
        actorRole: 'system',
        action: 'STRIPE_WEBHOOK_PROCESSED',
        targetType: 'payment_webhooks',
        targetId: eventId,
        result: 'success',
        details: `Processed verified Stripe event ${eventType} (${eventId}).`,
      });

      return res.status(200).json({ success: true, duplicate: false, eventId, eventType });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Stripe webhook processing error' });
    }
  });

  // PayPal Webhook with HMAC-SHA256 verification + replay idempotency
  registerRoute('post', '/api/v1/billing/webhooks/paypal', async (req: Request, res: Response) => {
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    const rawBody = typeof (req as any).rawBody === 'string' ? (req as any).rawBody : JSON.stringify(req.body || {});
    const sigCheck = verifyPayPalWebhookSignature({
      rawBody,
      transmissionSigHeader: req.headers['paypal-transmission-sig'] as string | undefined,
      transmissionId: req.headers['paypal-transmission-id'] as string | undefined,
      transmissionTime: req.headers['paypal-transmission-time'] as string | undefined,
    });

    if (!sigCheck.valid) {
      await audit(dbClient, {
        actorId: null,
        actorRole: 'system',
        action: 'PAYPAL_WEBHOOK_REJECTED',
        targetType: 'payment_webhooks',
        result: 'denied',
        details: sigCheck.reason || 'Invalid PayPal webhook signature.',
      });
      return res.status(401).json({
        success: false,
        code: 'INVALID_WEBHOOK_SIGNATURE',
        error: sigCheck.reason || 'Invalid PayPal webhook signature.',
      });
    }

    try {
      const event = req.body || {};
      const eventId = String(event.id || '').trim();
      const eventType = String(event.event_type || '').trim();
      if (!eventId || !eventType) {
        return res.status(400).json({ success: false, error: 'Missing PayPal event id or event_type.' });
      }

      const { data: existingWebhook } = await dbClient
        .from('payment_webhooks')
        .select('id, processed')
        .eq('event_id', eventId)
        .maybeSingle();

      if (existingWebhook?.processed) {
        return res.status(200).json({ success: true, duplicate: true, eventId });
      }

      if (!existingWebhook) {
        await dbClient.from('payment_webhooks').insert([
          {
            provider: 'paypal',
            event_id: eventId,
            event_type: eventType,
            payload: event,
            processed: false,
          },
        ]);
      }

      await dbClient
        .from('payment_webhooks')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('event_id', eventId);

      await audit(dbClient, {
        actorId: null,
        actorRole: 'system',
        action: 'PAYPAL_WEBHOOK_PROCESSED',
        targetType: 'payment_webhooks',
        targetId: eventId,
        result: 'success',
        details: `Processed verified PayPal event ${eventType} (${eventId}).`,
      });

      return res.status(200).json({ success: true, duplicate: false, eventId, eventType });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'PayPal webhook processing error' });
    }
  });

  // ============================================================================
  // 6. MENTOR STRATEGY PROFILE & MENTOR GROUPS
  // ============================================================================
  registerRoute('get', '/api/v1/bridge/mentor/profile', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    if (!caller.isVerifiedAdmin && caller.profile?.role !== 'mentor') {
      return res.status(403).json({ success: false, error: 'Forbidden: Mentor or Super Admin role required.' });
    }

    try {
      const targetMentorId =
        caller.isVerifiedAdmin && typeof req.query.mentorId === 'string' && isValidUUID(req.query.mentorId)
          ? String(req.query.mentorId).trim()
          : caller.user.id;

      const [mpRes, resolvedPlan] = await Promise.all([
        dbClient.from('mentor_profiles').select('*').eq('user_id', targetMentorId).maybeSingle(),
        resolveMentorPlanLimit(dbClient, targetMentorId),
      ]);
      const { data: existing, error } = mpRes;
      const authoritativeMaxFollowers = resolvedPlan.maxFollowers ?? CLIENT_PLAN_LIMITS.trial;

      if (error) {
        if (isMissingRelationError(error)) {
          return res.status(200).json({
            success: true,
            mentorProfile: {
              userId: targetMentorId,
              strategyName: 'Master Strategy',
              description: '',
              monthlyFee: 0,
              maxFollowers: authoritativeMaxFollowers,
              planName: resolvedPlan.planName || 'Trial',
              inviteCode: `TS-${targetMentorId.slice(0, 8).toUpperCase()}`,
              isPublic: true,
            },
          });
        }
        return res.status(500).json({ success: false, error: error.message });
      }

      if (!existing) {
        return res.status(200).json({
          success: true,
          mentorProfile: {
            userId: targetMentorId,
            strategyName: 'Master Strategy',
            description: '',
            monthlyFee: 0,
            maxFollowers: authoritativeMaxFollowers,
            planName: resolvedPlan.planName || 'Trial',
            inviteCode: `TS-${targetMentorId.slice(0, 8).toUpperCase()}`,
            isPublic: true,
          },
        });
      }

      return res.status(200).json({
        success: true,
        mentorProfile: {
          id: existing.id,
          userId: existing.user_id,
          strategyName: existing.strategy_name,
          description: existing.description || '',
          monthlyFee: Number(existing.monthly_fee ?? 0),
          studentMonthlyFeeUsd: Number(existing.student_monthly_fee_usd ?? existing.monthly_fee ?? 0),
          studentBillingPeriod: existing.student_billing_period || 'monthly',
          maxFollowers: authoritativeMaxFollowers,
          planName: resolvedPlan.planName || 'Trial',
          inviteCode: existing.invite_code,
          isPublic: existing.is_public !== false,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load mentor profile' });
    }
  });

  registerRoute('put', '/api/v1/bridge/mentor/profile', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    if (!caller.isVerifiedAdmin && caller.profile?.role !== 'mentor') {
      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: (caller.profile?.role as any) || 'trader',
        action: 'MENTOR_PROFILE_UPDATED',
        targetType: 'mentor_profiles',
        result: 'denied',
        details: 'Blocked unauthorized mentor profile update attempt.',
      });
      return res.status(403).json({ success: false, error: 'Forbidden: Only mentors or admins can update mentor strategy profile.' });
    }

    try {
      const b = req.body || {};
      const targetMentorId =
        caller.isVerifiedAdmin && b.mentorId && isValidUUID(b.mentorId) ? String(b.mentorId).trim() : caller.user.id;
      const strategyName = String(b.strategyName || 'Master Strategy').trim();
      const description = String(b.description || '').trim();
      const monthlyFee = Number(b.monthlyFee ?? 0);
      const studentMonthlyFeeUsd = Number(b.studentMonthlyFeeUsd ?? monthlyFee);
      const studentBillingPeriod = ['monthly', 'quarterly', 'yearly', 'free'].includes(String(b.studentBillingPeriod))
        ? String(b.studentBillingPeriod)
        : 'monthly';
      const resolvedPlan = await resolveMentorPlanLimit(dbClient, targetMentorId);
      const maxFollowers = resolvedPlan.maxFollowers ?? CLIENT_PLAN_LIMITS.trial;
      const isPublic = b.isPublic !== false;
      const inviteCode = `TS-${targetMentorId.slice(0, 8).toUpperCase()}`;

      if (!strategyName) return res.status(400).json({ success: false, error: 'strategyName is required.' });
      if (!Number.isFinite(monthlyFee) || monthlyFee < 0 || !Number.isFinite(studentMonthlyFeeUsd) || studentMonthlyFeeUsd < 0) {
        return res.status(400).json({ success: false, error: 'Fees must be >= 0.' });
      }

      const basePayload = {
        user_id: targetMentorId,
        strategy_name: strategyName,
        description,
        monthly_fee: monthlyFee,
        max_followers: maxFollowers,
        invite_code: inviteCode,
        is_public: isPublic,
        updated_at: new Date().toISOString(),
      };
      const extendedPayload = {
        ...basePayload,
        student_monthly_fee_usd: studentMonthlyFeeUsd,
        student_billing_period: studentBillingPeriod,
      };

      let upsertRes = await dbClient
        .from('mentor_profiles')
        .upsert([extendedPayload], { onConflict: 'user_id' })
        .select('*')
        .single();

      if (upsertRes.error && isMissingRelationError(upsertRes.error)) {
        upsertRes = await dbClient
          .from('mentor_profiles')
          .upsert([basePayload], { onConflict: 'user_id' })
          .select('*')
          .single();
      }

      const { data: saved, error } = upsertRes;

      if (error) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: (caller.profile?.role as any) || 'mentor',
          action: 'MENTOR_PROFILE_UPDATED',
          targetType: 'mentor_profiles',
          targetId: targetMentorId,
          result: 'failed',
          details: `Mentor profile update DB error: ${error.message}`,
        });
        return res.status(500).json({ success: false, error: error.message });
      }

      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: (caller.profile?.role as any) || 'mentor',
        action: 'MENTOR_PROFILE_UPDATED',
        targetType: 'mentor_profiles',
        targetId: saved.id,
        result: 'success',
        details: `Updated mentor strategy "${strategyName}" (fee=$${monthlyFee}, studentFee=$${studentMonthlyFeeUsd}/${studentBillingPeriod}, planMaxFollowers=${maxFollowers}).`,
      });

      return res.status(200).json({
        success: true,
        mentorProfile: {
          id: saved.id,
          userId: saved.user_id,
          strategyName: saved.strategy_name,
          description: saved.description || '',
          monthlyFee: Number(saved.monthly_fee ?? 0),
          studentMonthlyFeeUsd: Number(saved.student_monthly_fee_usd ?? saved.monthly_fee ?? 0),
          studentBillingPeriod: saved.student_billing_period || 'monthly',
          maxFollowers,
          planName: resolvedPlan.planName || 'Trial',
          inviteCode: saved.invite_code,
          isPublic: saved.is_public !== false,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to update mentor profile' });
    }
  });

  registerRoute('get', '/api/v1/bridge/mentor/groups', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    if (!caller.isVerifiedAdmin && caller.profile?.role !== 'mentor') {
      return res.status(403).json({ success: false, error: 'Forbidden: Mentor or Admin access required.' });
    }

    try {
      let query = dbClient.from('mentor_groups').select('*').order('created_at', { ascending: false });
      if (!caller.isVerifiedAdmin) {
        query = query.eq('mentor_id', caller.user.id);
      }

      const { data, error } = await query;
      if (error) {
        if (isMissingRelationError(error)) return res.status(200).json({ success: true, groups: [] });
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(200).json({
        success: true,
        groups: (data || []).map((g: any) => ({
          id: g.id,
          mentorId: g.mentor_id,
          name: g.name,
          description: g.description || '',
          status: g.status || 'active',
          createdAt: g.created_at,
          updatedAt: g.updated_at,
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load mentor groups' });
    }
  });

  registerRoute('post', '/api/v1/bridge/mentor/groups', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    if (!caller.isVerifiedAdmin && caller.profile?.role !== 'mentor') {
      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: (caller.profile?.role as any) || 'trader',
        action: 'MENTOR_GROUP_CREATED',
        targetType: 'mentor_groups',
        result: 'denied',
        details: 'Blocked unauthorized mentor group creation attempt.',
      });
      return res.status(403).json({ success: false, error: 'Forbidden: Only mentors or admins can create follower groups.' });
    }

    try {
      const b = req.body || {};
      const name = String(b.name || '').trim();
      const description = String(b.description || '').trim();
      const mentorId = caller.isVerifiedAdmin && b.mentorId && isValidUUID(b.mentorId) ? String(b.mentorId).trim() : caller.user.id;
      if (!name) return res.status(400).json({ success: false, error: 'Group name is required.' });

      const { data: created, error } = await dbClient
        .from('mentor_groups')
        .insert([
          {
            id: crypto.randomUUID(),
            mentor_id: mentorId,
            name,
            description,
            status: 'active',
          },
        ])
        .select('*')
        .single();

      if (error) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: (caller.profile?.role as any) || 'mentor',
          action: 'MENTOR_GROUP_CREATED',
          targetType: 'mentor_groups',
          result: 'failed',
          details: `Mentor group creation failed for "${name}": ${error.message}`,
        });
        return res.status(500).json({ success: false, error: error.message });
      }

      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: (caller.profile?.role as any) || 'mentor',
        action: 'MENTOR_GROUP_CREATED',
        targetType: 'mentor_groups',
        targetId: created.id,
        result: 'success',
        details: `Created mentor strategy group "${name}".`,
      });

      return res.status(201).json({
        success: true,
        group: {
          id: created.id,
          mentorId: created.mentor_id,
          name: created.name,
          description: created.description || '',
          status: created.status,
          createdAt: created.created_at,
          updatedAt: created.updated_at,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to create mentor group' });
    }
  });

  registerRoute('delete', '/api/v1/bridge/mentor/groups/:groupId', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { groupId } = req.params;
      if (!isValidUUID(groupId)) return res.status(400).json({ success: false, error: 'Invalid groupId UUID.' });

      const { data: existing } = await dbClient.from('mentor_groups').select('*').eq('id', groupId).maybeSingle();
      if (!existing) return res.status(404).json({ success: false, error: 'Mentor group not found.' });
      if (!caller.isVerifiedAdmin && existing.mentor_id !== caller.user.id) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: (caller.profile?.role as any) || 'mentor',
          action: 'MENTOR_GROUP_DELETED',
          targetType: 'mentor_groups',
          targetId: groupId,
          result: 'denied',
          details: `Blocked unauthorized deletion of mentor group ${groupId}.`,
        });
        return res.status(403).json({ success: false, error: 'Forbidden: Only owning mentor or admin can delete this group.' });
      }

      await dbClient.from('mentor_assignments').update({ group_id: null }).eq('group_id', groupId);
      const { error: delErr } = await dbClient.from('mentor_groups').delete().eq('id', groupId);
      if (delErr) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: (caller.profile?.role as any) || 'mentor',
          action: 'MENTOR_GROUP_DELETED',
          targetType: 'mentor_groups',
          targetId: groupId,
          result: 'failed',
          details: `Failed deleting mentor group ${existing.name || groupId}: ${delErr.message}`,
        });
        return res.status(500).json({ success: false, error: delErr.message });
      }

      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: (caller.profile?.role as any) || 'mentor',
        action: 'MENTOR_GROUP_DELETED',
        targetType: 'mentor_groups',
        targetId: groupId,
        result: 'success',
        details: `Deleted mentor strategy group "${existing.name || groupId}".`,
      });

      return res.status(200).json({ success: true, groupId });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to delete mentor group' });
    }
  });

  registerRoute('post', '/api/v1/bridge/mentor/groups/:groupId/assign', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { groupId } = req.params;
      const { assignmentId, unassign = false } = req.body || {};
      if (!isValidUUID(assignmentId)) return res.status(400).json({ success: false, error: 'Valid assignmentId UUID is required.' });
      if (!unassign && !isValidUUID(groupId)) return res.status(400).json({ success: false, error: 'Valid groupId UUID is required.' });

      const { data: assignRow } = await dbClient
        .from('mentor_assignments')
        .select('*')
        .eq('id', assignmentId)
        .maybeSingle();

      if (!assignRow) return res.status(404).json({ success: false, error: 'Mentor assignment not found.' });
      if (!caller.isVerifiedAdmin && assignRow.mentor_id !== caller.user.id) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: (caller.profile?.role as any) || 'mentor',
          action: 'MENTOR_GROUP_ASSIGNED',
          targetType: 'mentor_assignments',
          targetId: assignmentId,
          result: 'denied',
          details: `Blocked unauthorized group organization attempt on assignment ${assignmentId}.`,
        });
        return res.status(403).json({ success: false, error: 'Forbidden: Only owning mentor or admin can organize follower group.' });
      }

      let nextGroupId: string | null = null;
      if (!unassign) {
        const { data: grp } = await dbClient.from('mentor_groups').select('*').eq('id', groupId).maybeSingle();
        if (!grp) return res.status(404).json({ success: false, error: 'Target mentor group not found.' });
        if (grp.mentor_id !== assignRow.mentor_id) {
          await audit(dbClient, {
            actorId: caller.user.id,
            actorRole: (caller.profile?.role as any) || 'mentor',
            action: 'MENTOR_GROUP_ASSIGNED',
            targetType: 'mentor_assignments',
            targetId: assignmentId,
            result: 'denied',
            details: `Blocked cross-mentor group assignment (${groupId} -> ${assignmentId}).`,
          });
          return res.status(403).json({ success: false, error: 'Security error: Group belongs to a different mentor.' });
        }
        nextGroupId = grp.id;
      }

      const { data: updated, error: updErr } = await dbClient
        .from('mentor_assignments')
        .update({ group_id: nextGroupId })
        .eq('id', assignmentId)
        .select('*')
        .single();

      if (updErr) {
        await audit(dbClient, {
          actorId: caller.user.id,
          actorRole: (caller.profile?.role as any) || 'mentor',
          action: 'MENTOR_GROUP_ASSIGNED',
          targetType: 'mentor_assignments',
          targetId: assignmentId,
          result: 'failed',
          details: `Failed assigning follower ${assignmentId} to group ${nextGroupId || 'none'}: ${updErr.message}`,
        });
        return res.status(500).json({ success: false, error: updErr.message });
      }

      await audit(dbClient, {
        actorId: caller.user.id,
        actorRole: (caller.profile?.role as any) || 'mentor',
        action: 'MENTOR_GROUP_ASSIGNED',
        targetType: 'mentor_assignments',
        targetId: assignmentId,
        result: 'success',
        details: unassign
          ? `Removed assignment ${assignmentId} from mentor group.`
          : `Assigned follower ${assignmentId} to mentor group ${nextGroupId}.`,
      });

      return res.status(200).json({ success: true, assignment: updated });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to update assignment group' });
    }
  });
}
