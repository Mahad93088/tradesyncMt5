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

export async function checkMentorFollowerQuota(
  dbClient: SupabaseClient,
  mentorId: string,
  candidateChildAccountId?: string | null
): Promise<QuotaCheckResult> {
  try {
    let maxFollowers: number | null = null;
    let planName: string | null = null;

    // 1. Check active/trial subscription for this mentor
    const { data: subRows, error: subErr } = await dbClient
      .from('subscriptions')
      .select('id, plan_id, status, user_id, mentor_id')
      .in('status', ['active', 'trial']);

    if (subErr) {
      if (isMissingRelationError(subErr)) {
        return { allowed: true, enforced: false, activeFollowers: 0, maxFollowers: null, planName: null };
      }
      return { allowed: true, enforced: false, activeFollowers: 0, maxFollowers: null, planName: null };
    }

    const activeSub = (subRows || []).find(
      (s: any) => s.mentor_id === mentorId || s.user_id === mentorId
    );

    if (activeSub?.plan_id) {
      const { data: planRow, error: planErr } = await dbClient
        .from('subscription_plans')
        .select('id, name, max_followers, max_child_accounts')
        .eq('id', activeSub.plan_id)
        .maybeSingle();

      if (!planErr && planRow) {
        maxFollowers = Number(planRow.max_followers || planRow.max_child_accounts) || null;
        planName = planRow.name || null;
      }
    }

    // 2. Fallback to mentor_profiles.max_followers if no active subscription overrides it
    if (maxFollowers == null) {
      const { data: mpRow, error: mpErr } = await dbClient
        .from('mentor_profiles')
        .select('max_followers')
        .eq('user_id', mentorId)
        .maybeSingle();
      if (!mpErr && mpRow && Number(mpRow.max_followers) > 0) {
        maxFollowers = Number(mpRow.max_followers);
        planName = 'Mentor Profile Cap';
      }
    }

    if (maxFollowers == null) {
      return { allowed: true, enforced: false, activeFollowers: 0, maxFollowers: null, planName: null };
    }

    // 3. Count active follower child accounts currently assigned to this mentor
    const { data: activeAssigns, error: assignErr } = await dbClient
      .from('mentor_assignments')
      .select('id, child_account_id')
      .eq('mentor_id', mentorId)
      .eq('status', 'active');

    if (assignErr) {
      return { allowed: true, enforced: false, activeFollowers: 0, maxFollowers, planName };
    }

    const activeChildIds = new Set<string>(
      (activeAssigns || []).map((a: any) => a.child_account_id).filter(Boolean)
    );

    if (candidateChildAccountId && activeChildIds.has(candidateChildAccountId)) {
      return {
        allowed: true,
        enforced: true,
        activeFollowers: activeChildIds.size,
        maxFollowers,
        planName,
      };
    }

    const activeCount = activeChildIds.size > 0 ? activeChildIds.size : (activeAssigns || []).length;
    if (activeCount >= maxFollowers) {
      return {
        allowed: false,
        enforced: true,
        activeFollowers: activeCount,
        maxFollowers,
        planName,
        code: 'PLAN_FOLLOWER_QUOTA_EXCEEDED',
        error: `Follower limit reached (${activeCount}/${maxFollowers}) on ${planName || 'current plan'}. Upgrade plan or raise maxFollowers limit to link additional students.`,
      };
    }

    return {
      allowed: true,
      enforced: true,
      activeFollowers: activeCount,
      maxFollowers,
      planName,
    };
  } catch {
    return { allowed: true, enforced: false, activeFollowers: 0, maxFollowers: null, planName: null };
  }
}
