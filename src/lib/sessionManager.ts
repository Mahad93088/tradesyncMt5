import { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';

export interface SessionCheckResult {
  valid: boolean;
  refreshed: boolean;
  session: Session | null;
  error?: string;
  needsReauth?: boolean;
}

/**
 * Custom error class for expired or missing JWT sessions.
 */
export class SessionExpiredError extends Error {
  public needsReauth: boolean;
  public code: string;

  constructor(message = 'Your authentication session has expired. Please sign in again.') {
    super(message);
    this.name = 'SessionExpiredError';
    this.needsReauth = true;
    this.code = 'JWT_EXPIRED';
  }
}

/**
 * Parses the payload from a standard JWT token string without external libraries.
 */
export const parseJwtPayload = (token?: string): { exp?: number; sub?: string; role?: string; email?: string; [key: string]: any } | null => {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
};

/**
 * Extracts expiration timestamp (in seconds since epoch) from a JWT access token.
 */
export const getJwtExpirationSeconds = (token?: string): number | null => {
  const payload = parseJwtPayload(token);
  if (payload && typeof payload.exp === 'number') {
    return payload.exp;
  }
  return null;
};

/**
 * Checks whether an error from Supabase, PostgREST, or network indicates an expired or invalid JWT token.
 */
export const isJwtExpiredError = (err: any): boolean => {
  if (!err) return false;
  if (err instanceof SessionExpiredError) return true;
  if (err.name === 'SessionExpiredError' || err.code === 'JWT_EXPIRED') return true;

  const msg = typeof err === 'string'
    ? err
    : (err.message || err.error_description || err.details || err.hint || '');
  const code = String(err.code || err.statusCode || err.status || '');

  return (
    code === 'PGRST301' ||
    code === '401' ||
    /jwt expired/i.test(msg) ||
    /token is expired/i.test(msg) ||
    /invalid jwt/i.test(msg) ||
    /jwt claim/i.test(msg) ||
    /invalid claim/i.test(msg) ||
    /token has expired/i.test(msg) ||
    /session expired/i.test(msg) ||
    /expired token/i.test(msg) ||
    /invalid refresh token/i.test(msg) ||
    /refresh token not found/i.test(msg) ||
    /refresh_token_not_found/i.test(msg)
  );
};

/**
 * Verifies the current Supabase authentication session.
 * If the current access token is expired or expiring within `refreshThresholdSeconds` (default 90s),
 * it proactively invokes the supported Supabase client session-refresh flow (`supabase.auth.refreshSession()`)
 * to exchange the refresh token for a fresh access token.
 */
export const ensureValidSession = async (options?: {
  forceRefresh?: boolean;
  refreshThresholdSeconds?: number;
}): Promise<SessionCheckResult> => {
  if (!isSupabaseConfigured()) {
    return {
      valid: false,
      refreshed: false,
      session: null,
      error: 'Supabase credentials are not configured.',
      needsReauth: false,
    };
  }

  const thresholdSeconds = options?.refreshThresholdSeconds ?? 90;

  try {
    // 1. Fetch current cached session from Supabase client
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.warn('[sessionManager] getSession notice:', sessionError.message);
    }

    if (!session || !session.access_token) {
      return {
        valid: false,
        refreshed: false,
        session: null,
        error: 'No active authentication session found. Please sign in to continue.',
        needsReauth: true,
      };
    }

    // 2. Check token expiration directly from JWT payload or session metadata
    const jwtExp = getJwtExpirationSeconds(session.access_token);
    const expiresAtSec = jwtExp ?? session.expires_at ?? 0;
    const nowSec = Math.floor(Date.now() / 1000);

    const isExpiredOrExpiringSoon = options?.forceRefresh || !expiresAtSec || (expiresAtSec - nowSec <= thresholdSeconds);

    if (isExpiredOrExpiringSoon) {
      console.info(
        `[sessionManager] Token is expired or expiring soon (exp: ${expiresAtSec}, now: ${nowSec}, diff: ${expiresAtSec - nowSec}s). Invoking Supabase client refreshSession flow...`
      );

      // Supported Supabase client session-refresh flow
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession(
        session.refresh_token ? { refresh_token: session.refresh_token } : undefined
      );

      if (refreshError || !refreshData.session) {
        console.warn('[sessionManager] Token refresh flow failed:', refreshError?.message);
        return {
          valid: false,
          refreshed: false,
          session: null,
          error: 'Your authentication session has expired. Please sign in again to continue.',
          needsReauth: true,
        };
      }

      // Explicitly synchronize client session
      await supabase.auth.setSession({
        access_token: refreshData.session.access_token,
        refresh_token: refreshData.session.refresh_token,
      });

      console.info('[sessionManager] Session refreshed successfully. Fresh access token granted.');
      return {
        valid: true,
        refreshed: true,
        session: refreshData.session,
      };
    }

    // Session is currently valid and non-expired
    return {
      valid: true,
      refreshed: false,
      session,
    };
  } catch (err: any) {
    console.error('[sessionManager] Error during session validation:', err);
    return {
      valid: false,
      refreshed: false,
      session: null,
      error: err.message || 'Session verification failure.',
      needsReauth: true,
    };
  }
};

/**
 * Executes a Supabase database operation with automatic session validation and retry.
 * If the operation fails with a "JWT expired" error, it refreshes the session via Supabase
 * and retries the operation once.
 */
export const executeWithAuthRetry = async <T>(
  operation: (session: Session) => Promise<T>
): Promise<T> => {
  // 1. Ensure token is non-expired before making the request
  const check = await ensureValidSession();
  if (!check.valid || !check.session) {
    throw new SessionExpiredError(
      check.error || 'Your authentication session has expired. Please sign in again.'
    );
  }

  // Ensure client session is synced
  await supabase.auth.setSession({
    access_token: check.session.access_token,
    refresh_token: check.session.refresh_token,
  });

  try {
    return await operation(check.session);
  } catch (err: any) {
    // 2. If PostgREST responds with JWT expired, attempt an explicit refresh and single retry
    if (isJwtExpiredError(err)) {
      console.warn('[executeWithAuthRetry] JWT expired error intercepted. Refreshing session and retrying operation...');

      const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession(
        check.session.refresh_token ? { refresh_token: check.session.refresh_token } : undefined
      );

      if (refreshErr || !refreshData.session) {
        console.error('[executeWithAuthRetry] Session refresh attempt failed:', refreshErr?.message);
        throw new SessionExpiredError('Your authentication session has expired. Please sign in again to continue.');
      }

      // Explicitly update Supabase client session before retry
      await supabase.auth.setSession({
        access_token: refreshData.session.access_token,
        refresh_token: refreshData.session.refresh_token,
      });

      console.info('[executeWithAuthRetry] Retrying database operation with refreshed session token...');
      return await operation(refreshData.session);
    }

    throw err;
  }
};
