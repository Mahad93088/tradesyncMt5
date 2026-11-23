import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditLogInput {
  actorId?: string | null;
  actorRole: 'admin' | 'mentor' | 'trader' | 'system' | 'service_role';
  action: string;
  targetType: string;
  targetId?: string | null;
  result: 'success' | 'denied' | 'failed';
  details: string;
  metadata?: Record<string, any>;
}

export interface BillingProviderStatus {
  stripeConfigured: boolean;
  stripeWebhookConfigured: boolean;
  paypalConfigured: boolean;
  paypalWebhookConfigured: boolean;
}

export interface QuotaCheckResult {
  allowed: boolean;
  enforced: boolean;
  activeFollowers: number;
  maxFollowers: number | null;
  planName: string | null;
  code?: string;
  error?: string;
}

export function isMissingRelationError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || err.details || err.hint || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    (msg.includes('table') && msg.includes('not found')) ||
    msg.includes('missing table') ||
    msg.includes('does not exist') ||
    msg.includes('schema cache')
  );
}

export interface AuditLogWriteResult {
  persisted: boolean;
  error?: string;
  schemaMissing?: boolean;
}

const SENSITIVE_KEY_PATTERN = /pass(word)?|secret|token|api_?key|authorization|hash|private_?key|service_?role/i;

export function sanitizeAuditText(input: string): string {
  return String(input || '')
    .replace(/\b(ts_parent|ts_child|ts_live)_[A-Za-z0-9_-]{6,}\b/g, '$1_[REDACTED]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]{8,}/gi, '$1 [REDACTED]')
    .replace(/\b(sk_live|sk_test|whsec|rk_live|rk_test)_[A-Za-z0-9]{6,}\b/g, '$1_[REDACTED]');
}

export function sanitizeAuditMetadata(value: unknown, depth = 0): any {
  if (depth > 4) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeAuditText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeAuditMetadata(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeAuditMetadata(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export async function writeAuditLog(
  dbClient: SupabaseClient | null | undefined,
  entry: AuditLogInput
): Promise<AuditLogWriteResult> {
  if (!dbClient || typeof (dbClient as any).from !== 'function') {
    const msg = 'Audit log persistence skipped: service-role Supabase client unavailable.';
    console.error(`[AuditLog] ${msg}`, { action: entry.action, targetType: entry.targetType });
    return { persisted: false, error: msg };
  }
  try {
    const cleanDetails = sanitizeAuditText(entry.details);
    const cleanMetadata = entry.metadata ? sanitizeAuditMetadata(entry.metadata) : {};
    const { error } = await dbClient.from('audit_logs').insert([
      {
        actor_id: entry.actorId || null,
        actor_role: entry.actorRole,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId ? String(entry.targetId) : null,
        result: entry.result,
        details: cleanDetails,
        metadata: cleanMetadata,
      },
    ]);
    if (error) {
      const schemaMissing = isMissingRelationError(error);
      if (schemaMissing) {
        console.warn('[AuditLog] public.audit_logs schema not provisioned:', error.message);
      } else {
        console.error('[AuditLog] Failed to record audit entry:', error.message, {
          action: entry.action,
          targetType: entry.targetType,
          result: entry.result,
        });
      }
      return { persisted: false, error: error.message, schemaMissing };
    }
    return { persisted: true };
  } catch (err: any) {
    const schemaMissing = isMissingRelationError(err);
    const errMsg = err?.message || String(err);
    if (!schemaMissing) {
      console.error('[AuditLog] Unexpected audit log error:', errMsg, {
        action: entry.action,
        targetType: entry.targetType,
      });
    }
    return { persisted: false, error: errMsg, schemaMissing };
  }
}

export function getBillingProviderStatus(): BillingProviderStatus {
  return {
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
    stripeWebhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
    paypalConfigured: Boolean(process.env.PAYPAL_CLIENT_ID?.trim() && process.env.PAYPAL_CLIENT_SECRET?.trim()),
    paypalWebhookConfigured: Boolean(process.env.PAYPAL_WEBHOOK_ID?.trim()),
  };
}

export function constantTimeHexCompare(aHex: string, bHex: string): boolean {
  const cleanA = aHex.trim().toLowerCase();
  const cleanB = bHex.trim().toLowerCase();
  if (!cleanA || cleanA.length !== cleanB.length || !/^[0-9a-f]+$/.test(cleanA) || !/^[0-9a-f]+$/.test(cleanB)) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(cleanA, 'hex'), Buffer.from(cleanB, 'hex'));
}

export function verifyStripeWebhookSignature(params: {
  rawBody: string;
  signatureHeader?: string;
  webhookSecret?: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): { valid: boolean; reason?: string; timestamp?: number } {
  const secret = (params.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    return { valid: false, reason: 'STRIPE_WEBHOOK_SECRET is not configured on the server.' };
  }

  const header = (params.signatureHeader || '').trim();
  if (!header) {
    return { valid: false, reason: 'Missing Stripe-Signature header.' };
  }

  let timestampStr = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    if (k === 't' && v) timestampStr = v;
    if (k === 'v1' && v) signatures.push(v);
  }

  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || signatures.length === 0) {
    return { valid: false, reason: 'Malformed Stripe-Signature header.' };
  }

  const nowSec = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = params.toleranceSeconds ?? 300;
  if (Math.abs(nowSec - timestamp) > tolerance) {
    return { valid: false, reason: 'Stripe webhook timestamp outside replay tolerance window.' };
  }

  const signedPayload = `${timestamp}.${params.rawBody}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');

  const matched = signatures.some((sig) => constantTimeHexCompare(sig, expectedSig));
  if (!matched) {
    return { valid: false, reason: 'Invalid Stripe-Signature HMAC digest.' };
  }

  return { valid: true, timestamp };
}

export function verifyPayPalWebhookSignature(params: {
  rawBody: string;
  transmissionSigHeader?: string;
  transmissionId?: string;
  transmissionTime?: string;
  webhookSecret?: string;
}): { valid: boolean; reason?: string } {
  const secret = (params.webhookSecret || process.env.PAYPAL_WEBHOOK_ID || '').trim();
  if (!secret) {
    return { valid: false, reason: 'PAYPAL_WEBHOOK_ID is not configured on the server.' };
  }

  const sig = (params.transmissionSigHeader || '').trim();
  if (!sig) {
    return { valid: false, reason: 'Missing PayPal-Transmission-Sig header.' };
  }

  const bodyDigest = crypto.createHash('sha256').update(params.rawBody, 'utf8').digest('hex');
  const envelope =
    params.transmissionId && params.transmissionTime
      ? `${params.transmissionId}|${params.transmissionTime}|${secret}|${bodyDigest}`
      : params.rawBody;

  const expectedHex = crypto.createHmac('sha256', secret).update(envelope, 'utf8').digest('hex');
  const expectedBase64 = crypto.createHmac('sha256', secret).update(envelope, 'utf8').digest('base64');

  if (constantTimeHexCompare(sig, expectedHex)) {
    return { valid: true };
  }

  const bufA = Buffer.from(sig, 'utf8');
  const bufB = Buffer.from(expectedBase64, 'utf8');
  if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
    return { valid: true };
  }

  return { valid: false, reason: 'Invalid PayPal webhook HMAC signature.' };
}

import { CLIENT_PLAN_LIMITS, LEGACY_PLAN_CODE_COMPAT } from '../config/policy.ts';

export interface ResolvedPlanLimit {
  enforced: boolean;
  maxFollowers: number | null;
  planName: string | null;
  planCode: string | null;
  subscriptionStatus?: string;
  code?: string;
  error?: string;
}

const LEGACY_PLAN_DEFAULT_LIMITS: Record<string, number> = {
  starter_10: 10,
  pro_50: 50,
  business_200: 200,
};

export function resolvePlanFollowerLimit(planRow: Record<string, any> | null | undefined): {
  valid: boolean;
  limit: number | null;
  planName: string | null;
  planCode: string | null;
  error?: string;
} {
  if (!planRow) {
    return { valid: false, limit: null, planName: null, planCode: null, error: 'Subscription plan record not found.' };
  }

  const rawCode = String(planRow.code || '').trim().toLowerCase();
  const planName = planRow.name ? String(planRow.name) : rawCode || null;

  if (rawCode === 'trial') {
    return { valid: true, limit: CLIENT_PLAN_LIMITS.trial, planName: planName || 'Trial', planCode: 'trial' };
  }
  if (rawCode === 'silver') {
    return { valid: true, limit: CLIENT_PLAN_LIMITS.silver, planName: planName || 'Silver', planCode: 'silver' };
  }
  if (rawCode === 'gold') {
    return { valid: true, limit: CLIENT_PLAN_LIMITS.gold, planName: planName || 'Gold', planCode: 'gold' };
  }

  if (Object.prototype.hasOwnProperty.call(LEGACY_PLAN_DEFAULT_LIMITS, rawCode)) {
    if (!LEGACY_PLAN_CODE_COMPAT) {
      return {
        valid: false,
        limit: null,
        planName,
        planCode: rawCode,
        error: `Legacy subscription plan code "${rawCode}" is disabled.`,
      };
    }
    const rowLimit = Number(planRow.max_followers ?? planRow.max_child_accounts);
    const resolved = Number.isFinite(rowLimit) && rowLimit > 0 ? Math.floor(rowLimit) : LEGACY_PLAN_DEFAULT_LIMITS[rawCode];
    return { valid: true, limit: resolved, planName, planCode: rawCode };
  }

  const customLimit = Number(planRow.max_followers ?? planRow.max_child_accounts);
  if (Number.isFinite(customLimit) && customLimit > 0) {
    return { valid: true, limit: Math.floor(customLimit), planName, planCode: rawCode || null };
  }

  return {
    valid: false,
    limit: null,
    planName,
    planCode: rawCode || null,
    error: `Invalid follower limit configured on plan "${planName || rawCode || 'unknown'}".`,
  };
}

export async function resolveMentorPlanLimit(
  dbClient: SupabaseClient,
  mentorId: string
): Promise<ResolvedPlanLimit> {
  try {
    const { data: subRows, error: subErr } = await dbClient
      .from('subscriptions')
      .select('id, plan_id, status, user_id, mentor_id, current_period_end, created_at')
      .in('status', ['active', 'trial']);

    if (subErr) {
      return {
        enforced: true,
        maxFollowers: null,
        planName: null,
        planCode: null,
        code: 'QUOTA_VALIDATION_FAILED',
        error: `Unable to validate mentor subscription: ${subErr.message}`,
      };
    }

    const nowMs = Date.now();
    const validSubs = (subRows || [])
      .filter((s: any) => {
        if (s.mentor_id !== mentorId && s.user_id !== mentorId) return false;
        const status = String(s.status || '').trim().toLowerCase();
        if (status !== 'active' && status !== 'trial') return false;
        if (s.current_period_end == null || s.current_period_end === '') return true;
        const endMs = Date.parse(String(s.current_period_end));
        return Number.isFinite(endMs) && endMs > nowMs;
      })
      .sort((a: any, b: any) => {
        const ta = a.created_at ? Date.parse(String(a.created_at)) : 0;
        const tb = b.created_at ? Date.parse(String(b.created_at)) : 0;
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      });

    const activeSub = validSubs[0];
    if (!activeSub || !activeSub.plan_id) {
      return {
        enforced: true,
        maxFollowers: null,
        planName: null,
        planCode: null,
        code: 'NO_ACTIVE_SUBSCRIPTION',
        error: 'Mentor does not have an active, unexpired subscription plan.',
      };
    }

    const { data: planRow, error: planErr } = await dbClient
      .from('subscription_plans')
      .select('id, code, name, max_followers, max_child_accounts')
      .eq('id', activeSub.plan_id)
      .maybeSingle();

    if (planErr || !planRow) {
      return {
        enforced: true,
        maxFollowers: null,
        planName: null,
        planCode: null,
        code: 'QUOTA_VALIDATION_FAILED',
        error: planErr ? `Failed to load subscription plan: ${planErr.message}` : 'Assigned subscription plan not found.',
      };
    }

    const resolved = resolvePlanFollowerLimit(planRow);
    if (!resolved.valid || resolved.limit === null || resolved.limit <= 0) {
      return {
        enforced: true,
        maxFollowers: null,
        planName: resolved.planName,
        planCode: resolved.planCode,
        code: 'QUOTA_VALIDATION_FAILED',
        error: resolved.error || 'Invalid subscription plan follower capacity.',
      };
    }

    return {
      enforced: true,
      maxFollowers: resolved.limit,
      planName: resolved.planName,
      planCode: resolved.planCode,
      subscriptionStatus: String(activeSub.status),
    };
  } catch (err: any) {
    return {
      enforced: true,
      maxFollowers: null,
      planName: null,
      planCode: null,
      code: 'QUOTA_VALIDATION_FAILED',
      error: err?.message || 'Unexpected error resolving mentor subscription quota.',
    };
  }
}

export async function checkMentorFollowerQuota(
  dbClient: SupabaseClient,
  mentorId: string,
  candidateChildAccountId?: string | null,
  candidateTraderId?: string | null
): Promise<QuotaCheckResult> {
  try {
    const planCheck = await resolveMentorPlanLimit(dbClient, mentorId);
    if (planCheck.maxFollowers === null || planCheck.maxFollowers <= 0) {
      return {
        allowed: false,
        enforced: true,
        activeFollowers: 0,
        maxFollowers: null,
        planName: planCheck.planName,
        code: planCheck.code || 'NO_ACTIVE_SUBSCRIPTION',
        error: planCheck.error || 'Mentor does not have an active, unexpired subscription plan.',
      };
    }

    const maxFollowers = planCheck.maxFollowers;
    const planName = planCheck.planName;

    // Resolve trader_id for candidate child account if not passed directly
    let resolvedTraderId = candidateTraderId ? String(candidateTraderId).trim() : '';
    if (!resolvedTraderId && candidateChildAccountId) {
      const { data: childAcc, error: childErr } = await dbClient
        .from('mt5_accounts')
        .select('user_id')
        .eq('id', candidateChildAccountId)
        .maybeSingle();

      if (childErr) {
        return {
          allowed: false,
          enforced: true,
          activeFollowers: 0,
          maxFollowers,
          planName,
          code: 'QUOTA_VALIDATION_FAILED',
          error: `Unable to resolve trader ownership for child account: ${childErr.message}`,
        };
      }
      if (childAcc?.user_id) {
        resolvedTraderId = String(childAcc.user_id).trim();
      }
    }

    // Count DISTINCT active trader_id assigned to this mentor
    const { data: activeAssigns, error: assignErr } = await dbClient
      .from('mentor_assignments')
      .select('id, trader_id, child_account_id')
      .eq('mentor_id', mentorId)
      .eq('status', 'active');

    if (assignErr) {
      return {
        allowed: false,
        enforced: true,
        activeFollowers: 0,
        maxFollowers,
        planName,
        code: 'QUOTA_VALIDATION_FAILED',
        error: `Unable to validate active student count: ${assignErr.message}`,
      };
    }

    const activeTraderIds = new Set<string>();
    const activeChildIds = new Set<string>();
    for (const a of activeAssigns || []) {
      if (a?.trader_id) {
        activeTraderIds.add(String(a.trader_id).trim());
      } else if (a?.id) {
        activeTraderIds.add(String(a.id));
      }
      if (a?.child_account_id) {
        activeChildIds.add(String(a.child_account_id).trim());
      }
    }

    const activeCount = activeTraderIds.size;

    // Adding/reactivating another child account for an already-active distinct student trader does not consume an extra slot
    if (resolvedTraderId && activeTraderIds.has(resolvedTraderId)) {
      return {
        allowed: true,
        enforced: true,
        activeFollowers: activeCount,
        maxFollowers,
        planName,
      };
    }

    if (candidateChildAccountId && activeChildIds.has(String(candidateChildAccountId).trim())) {
      return {
        allowed: true,
        enforced: true,
        activeFollowers: activeCount,
        maxFollowers,
        planName,
      };
    }

    if (activeCount >= maxFollowers) {
      return {
        allowed: false,
        enforced: true,
        activeFollowers: activeCount,
        maxFollowers,
        planName,
        code: 'PLAN_FOLLOWER_QUOTA_EXCEEDED',
        error: `Follower limit reached (${activeCount}/${maxFollowers} distinct student traders) on ${planName || 'current plan'}. Upgrade plan to link additional students.`,
      };
    }

    return {
      allowed: true,
      enforced: true,
      activeFollowers: activeCount,
      maxFollowers,
      planName,
    };
  } catch (err: any) {
    return {
      allowed: false,
      enforced: true,
      activeFollowers: 0,
      maxFollowers: null,
      planName: null,
      code: 'QUOTA_VALIDATION_FAILED',
      error: err?.message || 'Quota validation failed unexpectedly.',
    };
  }
}
