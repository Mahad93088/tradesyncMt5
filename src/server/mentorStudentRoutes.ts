import type { Request, Response } from 'express';
import {
  checkMentorFollowerQuota,
  isMissingRelationError,
  resolveMentorPlanLimit,
  writeAuditLog,
} from './billingService.ts';
import { CLIENT_PLAN_LIMITS } from '../config/policy.ts';
import { BridgeStore } from './bridgeStore.ts';
import type { Day2RouteContext } from './day2Routes.ts';

export function registerMentorStudentRoutes(ctx: Day2RouteContext): void {
  const { registerRoute, authenticateSupabaseCaller, requireServiceRoleClient, isValidUUID } = ctx;

  // ============================================================================
  // 1. SUPER ADMIN MENTOR & TRADER FULL CRUD UPDATES
  // ============================================================================
  registerRoute('put', '/api/admin/mentors/:mentorId', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { mentorId } = req.params;
      if (!isValidUUID(mentorId)) return res.status(400).json({ success: false, error: 'Invalid mentorId UUID.' });

      const { data: target, error: findErr } = await dbClient
        .from('profiles')
        .select('id, role, email, full_name, status')
        .eq('id', mentorId)
        .maybeSingle();

      if (findErr) return res.status(500).json({ success: false, error: findErr.message });
      if (!target) return res.status(404).json({ success: false, error: 'Mentor profile not found.' });
      if (target.role === 'admin') {
        return res.status(403).json({ success: false, error: 'Admin profiles cannot be edited via mentor endpoint.' });
      }

      const b = req.body || {};
      const nowIso = new Date().toISOString();
      const profilePatch: Record<string, any> = { updated_at: nowIso };
      if (b.fullName !== undefined) {
        const cleanName = String(b.fullName).trim();
        if (cleanName.length < 2) return res.status(400).json({ success: false, error: 'Full name must be at least 2 characters.' });
        profilePatch.full_name = cleanName;
      }
      if (b.status !== undefined) {
        const cleanStatus = String(b.status).trim().toLowerCase();
        if (!['active', 'pending', 'suspended'].includes(cleanStatus)) {
          return res.status(400).json({ success: false, error: 'Status must be active, pending, or suspended.' });
        }
        profilePatch.status = cleanStatus;
      }

      const { data: updatedProfile, error: profUpdErr } = await dbClient
        .from('profiles')
        .update(profilePatch)
        .eq('id', mentorId)
        .select('*')
        .single();

      if (profUpdErr) return res.status(500).json({ success: false, error: profUpdErr.message });

      if (
        b.strategyName !== undefined ||
        b.description !== undefined ||
        b.monthlyFee !== undefined ||
        b.maxFollowers !== undefined ||
        b.studentMonthlyFeeUsd !== undefined ||
        b.studentBillingPeriod !== undefined
      ) {
        const resolvedPlan = await resolveMentorPlanLimit(dbClient, mentorId);
        const authoritativeMaxFollowers = resolvedPlan.maxFollowers ?? CLIENT_PLAN_LIMITS.trial;
        const mpBase: Record<string, any> = {
          user_id: mentorId,
          strategy_name: String(b.strategyName || 'Master Strategy').trim() || 'Master Strategy',
          description: String(b.description || '').trim(),
          monthly_fee: Math.max(0, Number(b.monthlyFee ?? 0) || 0),
          max_followers: authoritativeMaxFollowers,
          invite_code: `TS-${mentorId.slice(0, 8).toUpperCase()}`,
          updated_at: nowIso,
        };
        const mpExt = {
          ...mpBase,
          student_monthly_fee_usd: Math.max(0, Number(b.studentMonthlyFeeUsd ?? b.monthlyFee ?? 0) || 0),
          student_billing_period: ['monthly', 'quarterly', 'yearly', 'free'].includes(String(b.studentBillingPeriod))
            ? String(b.studentBillingPeriod)
            : 'monthly',
        };
        const mpRes = await dbClient.from('mentor_profiles').upsert([mpExt], { onConflict: 'user_id' });
        if (mpRes.error && isMissingRelationError(mpRes.error)) {
          await dbClient.from('mentor_profiles').upsert([mpBase], { onConflict: 'user_id' });
        }
      }

      await writeAuditLog(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'ADMIN_MENTOR_UPDATED',
        targetType: 'profiles',
        targetId: mentorId,
        result: 'success',
        details: `Updated mentor ${updatedProfile.full_name || target.email} (status=${updatedProfile.status}).`,
      });

      return res.status(200).json({ success: true, profile: updatedProfile });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to update mentor' });
    }
  });

  registerRoute('put', '/api/admin/traders/:traderId', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireAdmin: true, requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { traderId } = req.params;
      if (!isValidUUID(traderId)) return res.status(400).json({ success: false, error: 'Invalid traderId UUID.' });

      const { data: target, error: findErr } = await dbClient
        .from('profiles')
        .select('id, role, email, full_name, status')
        .eq('id', traderId)
        .maybeSingle();

      if (findErr) return res.status(500).json({ success: false, error: findErr.message });
      if (!target) return res.status(404).json({ success: false, error: 'Trader profile not found.' });
      if (target.role === 'admin') {
        return res.status(403).json({ success: false, error: 'Admin profiles cannot be edited via trader endpoint.' });
      }

      const b = req.body || {};
      const nowIso = new Date().toISOString();
      const profilePatch: Record<string, any> = { updated_at: nowIso };
      if (b.fullName !== undefined) {
        const cleanName = String(b.fullName).trim();
        if (cleanName.length < 2) return res.status(400).json({ success: false, error: 'Full name must be at least 2 characters.' });
        profilePatch.full_name = cleanName;
      }
      if (b.status !== undefined) {
        const cleanStatus = String(b.status).trim().toLowerCase();
        if (!['active', 'pending', 'suspended'].includes(cleanStatus)) {
          return res.status(400).json({ success: false, error: 'Status must be active, pending, or suspended.' });
        }
        profilePatch.status = cleanStatus;
      }

      const { data: updatedProfile, error: profUpdErr } = await dbClient
        .from('profiles')
        .update(profilePatch)
        .eq('id', traderId)
        .select('*')
        .single();

      if (profUpdErr) return res.status(500).json({ success: false, error: profUpdErr.message });

      // Optional mentor assignment/reassignment
      if (b.mentorId !== undefined) {
        const cleanMentorId = String(b.mentorId || '').trim();
        if (!cleanMentorId) {
          const { data: deactivated } = await dbClient
            .from('mentor_assignments')
            .update({ status: 'inactive' })
            .eq('trader_id', traderId)
            .select('child_account_id, parent_account_id');
          for (const row of deactivated || []) {
            if (row?.child_account_id) {
              await BridgeStore.getInstance().cancelQueuedOpenInstructions(dbClient, {
                childAccountId: row.child_account_id,
                parentAccountId: row.parent_account_id || undefined,
                reason: 'Mentor assignment cleared by admin',
              });
            }
          }
        } else if (isValidUUID(cleanMentorId)) {
          const [{ data: parentAcc }, { data: childAcc }] = await Promise.all([
            dbClient
              .from('mt5_accounts')
              .select('id')
              .eq('user_id', cleanMentorId)
              .eq('account_role', 'parent')
              .limit(1)
              .maybeSingle(),
            dbClient
              .from('mt5_accounts')
              .select('id')
              .eq('user_id', traderId)
              .eq('account_role', 'child')
              .limit(1)
              .maybeSingle(),
          ]);

          if (parentAcc?.id && childAcc?.id) {
            const quotaCheck = await checkMentorFollowerQuota(dbClient, cleanMentorId, childAcc.id, traderId);
            if (!quotaCheck.allowed) {
              return res.status(403).json({
                success: false,
                code: quotaCheck.code || 'PLAN_FOLLOWER_QUOTA_EXCEEDED',
                error: quotaCheck.error,
              });
            }

            const { data: existingAssign } = await dbClient
              .from('mentor_assignments')
              .select('id, status, activation_epoch')
              .eq('child_account_id', childAcc.id)
              .maybeSingle();

            const nextStatus = updatedProfile.status === 'active' ? 'active' : 'inactive';
            if (existingAssign?.id) {
              if (nextStatus !== 'active') {
                await BridgeStore.getInstance().cancelQueuedOpenInstructions(dbClient, {
                  childAccountId: childAcc.id,
                  reason: 'Trader assignment set inactive by admin',
                });
              }
              await dbClient
                .from('mentor_assignments')
                .update({
                  mentor_id: cleanMentorId,
                  parent_account_id: parentAcc.id,
                  status: nextStatus,
                  assigned_at: nowIso,
                  ...(nextStatus === 'active'
                    ? {
                        activated_at: nowIso,
                        activation_epoch: (Number(existingAssign.activation_epoch) || 1) + 1,
                        resumed_at: nowIso,
                      }
                    : { paused_at: nowIso }),
                })
                .eq('id', existingAssign.id);
            } else {
              await dbClient.from('mentor_assignments').insert([
                {
                  mentor_id: cleanMentorId,
                  trader_id: traderId,
                  parent_account_id: parentAcc.id,
                  child_account_id: childAcc.id,
                  status: nextStatus,
                  lot_mode: 'parent_lot',
                  lot_multiplier: 1.0,
                  fixed_lot: 0.1,
                  copy_pending_orders: false,
                  assigned_at: nowIso,
                  activated_at: nextStatus === 'active' ? nowIso : null,
                  activation_epoch: 1,
                },
              ]);
            }
          }
        }
      }

      await writeAuditLog(dbClient, {
        actorId: caller.user.id,
        actorRole: 'admin',
        action: 'ADMIN_TRADER_UPDATED',
        targetType: 'profiles',
        targetId: traderId,
        result: 'success',
        details: `Updated trader ${updatedProfile.full_name || target.email} (status=${updatedProfile.status}).`,
      });

      return res.status(200).json({ success: true, profile: updatedProfile });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to update trader' });
    }
  });

  // ============================================================================
  // 2. MENTOR STUDENT MANAGEMENT, INVITATIONS, JOIN REQUESTS & MEMBERSHIP PRICING
  // Strict Tenant Isolation: Non-admin mentors ONLY access caller.user.id records.
  // ============================================================================
  registerRoute('get', '/api/v1/bridge/mentor/students', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    if (!caller.isVerifiedAdmin && caller.profile?.role !== 'mentor') {
      return res.status(403).json({ success: false, error: 'Forbidden: Mentor or Super Admin access required.' });
    }

    try {
      // Strictly prevent cross-mentor snooping: only admins can inspect another mentorId
      if (!caller.isVerifiedAdmin && req.query.mentorId && String(req.query.mentorId).trim() !== caller.user.id) {
        await writeAuditLog(dbClient, {
          actorId: caller.user.id,
          actorRole: 'mentor',
          action: 'CROSS_TENANT_MENTOR_READ_BLOCKED',
          targetType: 'mentor_assignments',
          targetId: String(req.query.mentorId),
          result: 'denied',
          details: `Blocked mentor ${caller.user.id} attempting to read students for mentor ${String(req.query.mentorId)}.`,
        });
        return res.status(403).json({
          success: false,
          code: 'TENANT_ISOLATION_FORBIDDEN',
          error: 'Forbidden: You cannot view another mentor\'s private trader roster.',
        });
      }

      const targetMentorId =
        caller.isVerifiedAdmin && typeof req.query.mentorId === 'string' && isValidUUID(req.query.mentorId)
          ? String(req.query.mentorId).trim()
          : caller.user.id;

      const [assignRes, invRes] = await Promise.all([
        dbClient.from('mentor_assignments').select('*').eq('mentor_id', targetMentorId).order('assigned_at', { ascending: false }),
        dbClient.from('mentor_trader_invitations').select('*').eq('mentor_id', targetMentorId).order('created_at', { ascending: false }),
      ]);

      if (assignRes.error) return res.status(500).json({ success: false, error: assignRes.error.message });
      const schemaMissing = Boolean(invRes.error && isMissingRelationError(invRes.error));
      if (invRes.error && !schemaMissing) {
        return res.status(500).json({ success: false, error: invRes.error.message });
      }

      const invitations = schemaMissing ? [] : invRes.data || [];
      const traderIds = Array.from(
        new Set<string>([
          ...(assignRes.data || []).map((a: any) => a.trader_id).filter(Boolean),
          ...invitations.map((i: any) => i.trader_id).filter(Boolean),
        ])
      );
      const childIds = Array.from(
        new Set<string>((assignRes.data || []).map((a: any) => a.child_account_id).filter(Boolean))
      );

      const [profRes, childRes] = await Promise.all([
        traderIds.length > 0
          ? dbClient.from('profiles').select('id, full_name, email, status, created_at').in('id', traderIds)
          : Promise.resolve({ data: [], error: null } as any),
        childIds.length > 0
          ? dbClient
              .from('mt5_accounts')
              .select('id, account_number, broker_name, broker_server, trading_symbol, balance, equity, connection_status, last_sync, auto_trading_enabled')
              .in('id', childIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      const profMap = new Map<string, any>();
      for (const p of profRes.data || []) profMap.set(p.id, p);
      const childMap = new Map<string, any>();
      for (const c of childRes.data || []) childMap.set(c.id, c);

      return res.status(200).json({
        success: true,
        mentorId: targetMentorId,
        schemaMissing,
        assignments: (assignRes.data || []).map((a: any) => {
          const prof = profMap.get(a.trader_id);
          const child = childMap.get(a.child_account_id);
          return {
            id: a.id,
            mentorId: a.mentor_id,
            traderId: a.trader_id,
            traderName: prof?.full_name || prof?.email || 'Trader',
            traderEmail: prof?.email || '',
            traderStatus: prof?.status || 'active',
            parentAccountId: a.parent_account_id,
            childAccountId: a.child_account_id,
            childAccountNumber: child?.account_number || null,
            childBrokerName: child?.broker_name || null,
            childTradingSymbol: child?.trading_symbol || null,
            childEquity: child?.equity != null ? Number(child.equity) : null,
            childConnectionStatus: child?.connection_status || 'disconnected',
            status: a.status,
            lotMode: a.lot_mode,
            membershipStatus: a.membership_status || 'active',
            membershipPriceUsd: Number(a.membership_price_usd ?? 0),
            billingPeriod: a.billing_period || 'monthly',
            assignedAt: a.assigned_at,
          };
        }),
        invitations: invitations.map((i: any) => {
          const prof = i.trader_id ? profMap.get(i.trader_id) : null;
          return {
            id: i.id,
            mentorId: i.mentor_id,
            traderId: i.trader_id || undefined,
            traderName: prof?.full_name || undefined,
            invitedEmail: i.invited_email,
            direction: i.direction,
            status: i.status,
            message: i.message || '',
            createdAt: i.created_at,
            respondedAt: i.responded_at || undefined,
          };
        }),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load mentor students' });
    }
  });

  // Mentor invites existing trader OR provisions new trader account + invitation
  registerRoute('post', '/api/v1/bridge/mentor/students/invite', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    if (!caller.isVerifiedAdmin && caller.profile?.role !== 'mentor') {
      return res.status(403).json({ success: false, error: 'Forbidden: Mentor or Super Admin role required.' });
    }

    try {
      const b = req.body || {};
      const mentorId =
        caller.isVerifiedAdmin && b.mentorId && isValidUUID(b.mentorId) ? String(b.mentorId).trim() : caller.user.id;
      const cleanEmail = String(b.email || '').trim().toLowerCase();
      const fullName = String(b.fullName || '').trim();
      const rawPassword = typeof b.password === 'string' ? b.password : '';
      const createAccount = Boolean(b.createAccount);
      const message = String(b.message || '').trim();

      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, error: 'A valid student email address is required.' });
      }

      // Check mentor follower quota first
      const quotaCheck = await checkMentorFollowerQuota(dbClient, mentorId);
      if (!quotaCheck.allowed) {
        await writeAuditLog(dbClient, {
          actorId: caller.user.id,
          actorRole: (caller.profile?.role as any) || 'mentor',
          action: 'PLAN_FOLLOWER_QUOTA_EXCEEDED',
          targetType: 'mentor_trader_invitations',
          targetId: mentorId,
          result: 'denied',
          details: quotaCheck.error || 'Follower quota exceeded while inviting student.',
        });
        return res.status(403).json({
          success: false,
          code: quotaCheck.code || 'PLAN_FOLLOWER_QUOTA_EXCEEDED',
          error: quotaCheck.error,
        });
      }

      // Check if trader exists
      let { data: existingProf } = await dbClient
        .from('profiles')
        .select('id, email, full_name, role, status')
        .eq('email', cleanEmail)
        .maybeSingle();

      if (existingProf && existingProf.id === mentorId) {
        return res.status(400).json({ success: false, error: 'You cannot invite yourself as a student trader.' });
      }
      if (existingProf && existingProf.role !== 'trader') {
        return res.status(400).json({
          success: false,
          error: `User ${cleanEmail} has role "${existingProf.role}". Only trader accounts can be invited as student followers.`,
        });
      }

      let provisionedNewAccount = false;
      if (!existingProf && createAccount) {
        if (!fullName || fullName.length < 2) {
          return res.status(400).json({ success: false, error: 'Student full name is required when creating an account.' });
        }
        if (!rawPassword || rawPassword.length < 6) {
          return res.status(400).json({ success: false, error: 'Temporary password (min 6 characters) is required when creating an account.' });
        }
        if (!dbClient.auth?.admin?.createUser) {
          return res.status(500).json({ success: false, error: 'Auth Admin API unavailable on server.' });
        }

        const { data: createdAuth, error: createAuthErr } = await dbClient.auth.admin.createUser({
          email: cleanEmail,
          password: rawPassword,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });
        if (createAuthErr || !createdAuth?.user?.id) {
          return res.status(400).json({
            success: false,
            error: createAuthErr?.message || 'Failed to create trader Auth account.',
          });
        }

        const nowIso = new Date().toISOString();
        const { data: newProf, error: newProfErr } = await dbClient
          .from('profiles')
          .upsert(
            [
              {
                id: createdAuth.user.id,
                email: cleanEmail,
                full_name: fullName,
                role: 'trader',
                status: 'active',
                updated_at: nowIso,
              },
            ],
            { onConflict: 'id' }
          )
          .select('id, email, full_name, role, status')
          .single();

        if (newProfErr) {
          return res.status(500).json({ success: false, error: newProfErr.message });
        }
        existingProf = newProf;
        provisionedNewAccount = true;
      }

      const { data: invRow, error: invErr } = await dbClient
        .from('mentor_trader_invitations')
        .insert([
          {
            mentor_id: mentorId,
            trader_id: existingProf?.id || null,
            invited_email: cleanEmail,
            direction: 'mentor_invite',
            status: 'pending',
            message,
          },
        ])
        .select('*')
        .single();

      if (invErr) {
        if (isMissingRelationError(invErr)) {
          return res.status(503).json({
            success: false,
            code: 'MIGRATION_10_REQUIRED',
            error: 'mentor_trader_invitations table is missing. Execute Migration 10 in Supabase.',
          });
        }
        return res.status(500).json({ success: false, error: invErr.message });
      }

      if (existingProf?.id) {
        await dbClient
          .from('notifications')
          .insert([
            {
              user_id: existingProf.id,
              target_role: 'trader',
              title: 'New Mentor Invitation',
              message: `${caller.profile?.full_name || 'A Verified Mentor'} invited you to link your Child MT5 account for trade copying.`,
              type: 'info',
            },
          ])
          .then(() => null, () => null);
      }

      await writeAuditLog(dbClient, {
        actorId: caller.user.id,
        actorRole: (caller.profile?.role as any) || 'mentor',
        action: provisionedNewAccount ? 'MENTOR_PROVISIONED_AND_INVITED_STUDENT' : 'MENTOR_INVITED_STUDENT',
        targetType: 'mentor_trader_invitations',
        targetId: invRow.id,
        result: 'success',
        details: `Mentor invited ${cleanEmail}${provisionedNewAccount ? ' (newly provisioned trader account)' : ''}.`,
      });

      return res.status(201).json({
        success: true,
        provisionedNewAccount,
        invitation: {
          id: invRow.id,
          mentorId: invRow.mentor_id,
          traderId: invRow.trader_id || undefined,
          invitedEmail: invRow.invited_email,
          direction: invRow.direction,
          status: invRow.status,
          message: invRow.message || '',
          createdAt: invRow.created_at,
        },
        inviteCode: `TS-${mentorId.slice(0, 8).toUpperCase()}`,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to send student invitation' });
    }
  });

  // Mentor approves or rejects a pending student join request (or cancels a pending invite)
  registerRoute('post', '/api/v1/bridge/mentor/requests/:invitationId/decide', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    if (!caller.isVerifiedAdmin && caller.profile?.role !== 'mentor') {
      return res.status(403).json({ success: false, error: 'Forbidden: Mentor or Admin access required.' });
    }

    try {
      const { invitationId } = req.params;
      if (!isValidUUID(invitationId)) return res.status(400).json({ success: false, error: 'Invalid invitationId UUID.' });

      const decision = String(req.body?.decision || '').trim().toLowerCase();
      if (!['approve', 'reject', 'cancel'].includes(decision)) {
        return res.status(400).json({ success: false, error: 'Decision must be approve, reject, or cancel.' });
      }

      const { data: inv, error: findErr } = await dbClient
        .from('mentor_trader_invitations')
        .select('*')
        .eq('id', invitationId)
        .maybeSingle();

      if (findErr) return res.status(500).json({ success: false, error: findErr.message });
      if (!inv) return res.status(404).json({ success: false, error: 'Invitation / request not found.' });

      if (!caller.isVerifiedAdmin && inv.mentor_id !== caller.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden: You can only manage invitations for your own mentor account.' });
      }

      let assignment: any = null;
      const nowIso = new Date().toISOString();

      if (decision === 'approve') {
        if (!inv.trader_id) {
          return res.status(400).json({ success: false, error: 'Target trader profile not found on request.' });
        }
        const [{ data: parentAcc }, { data: childAcc }] = await Promise.all([
          dbClient
            .from('mt5_accounts')
            .select('id')
            .eq('user_id', inv.mentor_id)
            .eq('account_role', 'parent')
            .limit(1)
            .maybeSingle(),
          dbClient
            .from('mt5_accounts')
            .select('id')
            .eq('user_id', inv.trader_id)
            .eq('account_role', 'child')
            .limit(1)
            .maybeSingle(),
        ]);

        if (!parentAcc?.id) {
          return res.status(400).json({ success: false, error: 'Connect a Parent MT5 Demo account first before approving students.' });
        }
        if (!childAcc?.id) {
          return res.status(400).json({ success: false, error: 'Student has not connected a Child MT5 Demo account yet.' });
        }

        const quotaCheck = await checkMentorFollowerQuota(dbClient, inv.mentor_id, childAcc.id, inv.trader_id);
        if (!quotaCheck.allowed) {
          return res.status(403).json({
            success: false,
            code: quotaCheck.code || 'PLAN_FOLLOWER_QUOTA_EXCEEDED',
            error: quotaCheck.error,
          });
        }

        const { data: existingAssign } = await dbClient
          .from('mentor_assignments')
          .select('id, activation_epoch')
          .eq('child_account_id', childAcc.id)
          .maybeSingle();

        if (existingAssign?.id) {
          const { data: updA, error: updAErr } = await dbClient
            .from('mentor_assignments')
            .update({
              mentor_id: inv.mentor_id,
              trader_id: inv.trader_id,
              parent_account_id: parentAcc.id,
              status: 'active',
              assigned_at: nowIso,
              activated_at: nowIso,
              activation_epoch: (Number(existingAssign.activation_epoch) || 1) + 1,
              resumed_at: nowIso,
              suspended_by: null,
              suspended_at: null,
              suspension_reason: null,
            })
            .eq('id', existingAssign.id)
            .select('*')
            .single();
          if (updAErr) return res.status(500).json({ success: false, error: updAErr.message });
          assignment = updA;
        } else {
          const { data: insA, error: insAErr } = await dbClient
            .from('mentor_assignments')
            .insert([
              {
                mentor_id: inv.mentor_id,
                trader_id: inv.trader_id,
                parent_account_id: parentAcc.id,
                child_account_id: childAcc.id,
                status: 'active',
                lot_mode: 'parent_lot',
                lot_multiplier: 1.0,
                fixed_lot: 0.1,
                copy_pending_orders: false,
                assigned_at: nowIso,
                activated_at: nowIso,
                activation_epoch: 1,
              },
            ])
            .select('*')
            .single();
          if (insAErr) return res.status(500).json({ success: false, error: insAErr.message });
          assignment = insA;
        }
      }

      const nextStatus = decision === 'approve' ? 'accepted' : decision === 'cancel' ? 'cancelled' : 'rejected';
      const { data: updatedInv, error: invUpdErr } = await dbClient
        .from('mentor_trader_invitations')
        .update({ status: nextStatus, responded_at: nowIso })
        .eq('id', invitationId)
        .select('*')
        .single();

      if (invUpdErr) return res.status(500).json({ success: false, error: invUpdErr.message });

      await writeAuditLog(dbClient, {
        actorId: caller.user.id,
        actorRole: (caller.profile?.role as any) || 'mentor',
        action: `MENTOR_REQUEST_${nextStatus.toUpperCase()}`,
        targetType: 'mentor_trader_invitations',
        targetId: invitationId,
        result: 'success',
        details: `Mentor marked student request ${invitationId} as ${nextStatus}.`,
      });

      return res.status(200).json({ success: true, invitation: updatedInv, assignment });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to process request decision' });
    }
  });

  // Mentor or Admin sets per-student membership pricing / status on an assignment
  registerRoute('put', '/api/v1/bridge/assignments/:assignmentId/membership', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { assignmentId } = req.params;
      if (!isValidUUID(assignmentId)) return res.status(400).json({ success: false, error: 'Invalid assignmentId UUID.' });

      const { data: existing, error: findErr } = await dbClient
        .from('mentor_assignments')
        .select('*')
        .eq('id', assignmentId)
        .maybeSingle();

      if (findErr) return res.status(500).json({ success: false, error: findErr.message });
      if (!existing) return res.status(404).json({ success: false, error: 'Assignment not found.' });

      if (!caller.isVerifiedAdmin && existing.mentor_id !== caller.user.id) {
        return res.status(403).json({ success: false, error: 'Forbidden: Only owning mentor or admin can manage membership pricing.' });
      }

      const b = req.body || {};
      const patch: Record<string, any> = {};
      if (b.membershipStatus !== undefined) {
        const cleanStatus = String(b.membershipStatus).trim().toLowerCase();
        if (!['trial', 'active', 'past_due', 'paused', 'cancelled'].includes(cleanStatus)) {
          return res.status(400).json({ success: false, error: 'Invalid membershipStatus.' });
        }
        patch.membership_status = cleanStatus;
      }
      if (b.membershipPriceUsd !== undefined) {
        const price = Number(b.membershipPriceUsd);
        if (!Number.isFinite(price) || price < 0) {
          return res.status(400).json({ success: false, error: 'membershipPriceUsd must be >= 0.' });
        }
        patch.membership_price_usd = price;
      }
      if (b.billingPeriod !== undefined) {
        const period = String(b.billingPeriod).trim().toLowerCase();
        if (!['monthly', 'quarterly', 'yearly', 'free'].includes(period)) {
          return res.status(400).json({ success: false, error: 'billingPeriod must be monthly, quarterly, yearly, or free.' });
        }
        patch.billing_period = period;
      }

      const { data: updated, error: updErr } = await dbClient
        .from('mentor_assignments')
        .update(patch)
        .eq('id', assignmentId)
        .select('*')
        .single();

      if (updErr) {
        if (isMissingRelationError(updErr)) {
          return res.status(503).json({
            success: false,
            code: 'MIGRATION_10_REQUIRED',
            error: 'Membership columns are not yet provisioned on mentor_assignments. Execute Migration 10 in Supabase.',
          });
        }
        return res.status(500).json({ success: false, error: updErr.message });
      }

      await writeAuditLog(dbClient, {
        actorId: caller.user.id,
        actorRole: (caller.profile?.role as any) || 'mentor',
        action: 'ASSIGNMENT_MEMBERSHIP_UPDATED',
        targetType: 'mentor_assignments',
        targetId: assignmentId,
        result: 'success',
        details: `Updated student membership pricing on assignment ${assignmentId}.`,
        metadata: patch,
      });

      return res.status(200).json({ success: true, assignment: updated });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to update assignment membership' });
    }
  });

  // Trader: view pending mentor invitations & outgoing join requests
  registerRoute('get', '/api/v1/bridge/trader/invitations', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const email = String(caller.profile?.email || '').toLowerCase();
      const { data, error } = await dbClient
        .from('mentor_trader_invitations')
        .select('*')
        .or(`trader_id.eq.${caller.user.id}${email ? `,invited_email.eq.${email}` : ''}`)
        .order('created_at', { ascending: false });

      if (error) {
        if (isMissingRelationError(error)) {
          return res.status(200).json({ success: true, invitations: [], schemaMissing: true });
        }
        return res.status(500).json({ success: false, error: error.message });
      }

      const mentorIds = Array.from(new Set<string>((data || []).map((i: any) => i.mentor_id).filter(Boolean)));
      const { data: mentors } =
        mentorIds.length > 0
          ? await dbClient.from('profiles').select('id, full_name, email').in('id', mentorIds)
          : { data: [] as any[] };
      const mentorMap = new Map<string, any>();
      for (const m of mentors || []) mentorMap.set(m.id, m);

      return res.status(200).json({
        success: true,
        invitations: (data || []).map((i: any) => ({
          id: i.id,
          mentorId: i.mentor_id,
          mentorName: mentorMap.get(i.mentor_id)?.full_name || mentorMap.get(i.mentor_id)?.email || 'Verified Mentor',
          invitedEmail: i.invited_email,
          direction: i.direction,
          status: i.status,
          message: i.message || '',
          createdAt: i.created_at,
          respondedAt: i.responded_at || undefined,
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to load trader invitations' });
    }
  });

  // Trader: accept or reject an invitation from a mentor
  registerRoute('post', '/api/v1/bridge/trader/invitations/:invitationId/respond', async (req: Request, res: Response) => {
    const caller = await authenticateSupabaseCaller(req, res, { requireServiceRole: true });
    if (!caller) return;
    const dbClient = requireServiceRoleClient(res);
    if (!dbClient) return;

    try {
      const { invitationId } = req.params;
      if (!isValidUUID(invitationId)) return res.status(400).json({ success: false, error: 'Invalid invitationId UUID.' });

      const decision = String(req.body?.decision || '').trim().toLowerCase();
      if (decision !== 'accept' && decision !== 'reject') {
        return res.status(400).json({ success: false, error: 'Decision must be accept or reject.' });
      }

      const { data: inv, error: findErr } = await dbClient
        .from('mentor_trader_invitations')
        .select('*')
        .eq('id', invitationId)
        .maybeSingle();

      if (findErr) return res.status(500).json({ success: false, error: findErr.message });
      if (!inv) return res.status(404).json({ success: false, error: 'Invitation not found.' });

      const callerEmail = String(caller.profile?.email || '').toLowerCase();
      const ownsInvite = inv.trader_id === caller.user.id || (callerEmail && inv.invited_email.toLowerCase() === callerEmail);
      if (!caller.isVerifiedAdmin && !ownsInvite) {
        return res.status(403).json({ success: false, error: 'Forbidden: This invitation is not addressed to your account.' });
      }

      const nowIso = new Date().toISOString();
      let assignment: any = null;

      if (decision === 'accept') {
        const [{ data: parentAcc }, { data: childAcc }] = await Promise.all([
          dbClient
            .from('mt5_accounts')
            .select('id')
            .eq('user_id', inv.mentor_id)
            .eq('account_role', 'parent')
            .limit(1)
            .maybeSingle(),
          req.body?.childAccountId && isValidUUID(req.body.childAccountId)
            ? dbClient
                .from('mt5_accounts')
                .select('id')
                .eq('id', req.body.childAccountId)
                .eq('user_id', caller.user.id)
                .eq('account_role', 'child')
                .maybeSingle()
            : dbClient
                .from('mt5_accounts')
                .select('id')
                .eq('user_id', caller.user.id)
                .eq('account_role', 'child')
                .limit(1)
                .maybeSingle(),
        ]);

        if (!parentAcc?.id) {
          return res.status(400).json({ success: false, error: 'Mentor has not connected a Parent MT5 Demo account yet.' });
        }
        if (!childAcc?.id) {
          return res.status(400).json({ success: false, error: 'Connect your Child MT5 Demo account before accepting this invitation.' });
        }

        const quotaCheck = await checkMentorFollowerQuota(dbClient, inv.mentor_id, childAcc.id, caller.user.id);
        if (!quotaCheck.allowed) {
          return res.status(403).json({
            success: false,
            code: quotaCheck.code || 'PLAN_FOLLOWER_QUOTA_EXCEEDED',
            error: quotaCheck.error,
          });
        }

        const { data: existingAssign } = await dbClient
          .from('mentor_assignments')
          .select('id, activation_epoch')
          .eq('child_account_id', childAcc.id)
          .maybeSingle();

        if (existingAssign?.id) {
          const { data: updA, error: updErr } = await dbClient
            .from('mentor_assignments')
            .update({
              mentor_id: inv.mentor_id,
              trader_id: caller.user.id,
              parent_account_id: parentAcc.id,
              status: 'active',
              assigned_at: nowIso,
              activated_at: nowIso,
              activation_epoch: (Number(existingAssign.activation_epoch) || 1) + 1,
              resumed_at: nowIso,
              suspended_by: null,
              suspended_at: null,
              suspension_reason: null,
            })
            .eq('id', existingAssign.id)
            .select('*')
            .single();
          if (updErr) return res.status(500).json({ success: false, error: updErr.message });
          assignment = updA;
        } else {
          const { data: insA, error: insErr } = await dbClient
            .from('mentor_assignments')
            .insert([
              {
                mentor_id: inv.mentor_id,
                trader_id: caller.user.id,
                parent_account_id: parentAcc.id,
                child_account_id: childAcc.id,
                status: 'active',
                lot_mode: 'parent_lot',
                lot_multiplier: 1.0,
                fixed_lot: 0.1,
                copy_pending_orders: false,
                assigned_at: nowIso,
                activated_at: nowIso,
                activation_epoch: 1,
              },
            ])
            .select('*')
            .single();
          if (insErr) return res.status(500).json({ success: false, error: insErr.message });
          assignment = insA;
        }
      }

      const nextStatus = decision === 'accept' ? 'accepted' : 'rejected';
      const { data: updatedInv, error: updInvErr } = await dbClient
        .from('mentor_trader_invitations')
        .update({ trader_id: caller.user.id, status: nextStatus, responded_at: nowIso })
        .eq('id', invitationId)
        .select('*')
        .single();

      if (updInvErr) return res.status(500).json({ success: false, error: updInvErr.message });

      await writeAuditLog(dbClient, {
        actorId: caller.user.id,
        actorRole: (caller.profile?.role as any) || 'trader',
        action: `TRADER_INVITATION_${nextStatus.toUpperCase()}`,
        targetType: 'mentor_trader_invitations',
        targetId: invitationId,
        result: 'success',
        details: `Trader responded "${nextStatus}" to mentor invitation ${invitationId}.`,
      });

      return res.status(200).json({ success: true, invitation: updatedInv, assignment });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || 'Failed to respond to invitation' });
    }
  });
}
