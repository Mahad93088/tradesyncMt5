import type { NextFunction, Request, Response } from 'express';

export interface CorsConfigOptions {
  allowedOrigins?: string[];
}

export interface RateLimitPolicy {
  bucket: string;
  limit: number;
  windowMs: number;
}

export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

export function parseAllowedOrigins(extraOrigins?: string[]): {
  explicitlyConfigured: boolean;
  origins: Set<string>;
} {
  const configured = new Set<string>();
  const rawEnv = process.env.ALLOWED_ORIGINS || '';
  const hasExplicitList = rawEnv.trim().length > 0 || (Array.isArray(extraOrigins) && extraOrigins.length > 0);

  for (const item of rawEnv.split(',')) {
    const clean = item.trim();
    if (clean) configured.add(normalizeOrigin(clean));
  }

  for (const item of extraOrigins || []) {
    const clean = String(item || '').trim();
    if (clean) configured.add(normalizeOrigin(clean));
  }

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && /^https?:\/\//i.test(appUrl)) {
    try {
      configured.add(normalizeOrigin(new URL(appUrl).origin));
    } catch {
      // Ignore malformed APP_URL
    }
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    const formatted = /^https?:\/\//i.test(vercelUrl) ? vercelUrl : `https://${vercelUrl}`;
    try {
      configured.add(normalizeOrigin(new URL(formatted).origin));
    } catch {
      // Ignore malformed VERCEL_URL
    }
  }

  // Always allow local Vite/Node dev origins when running outside strict production override
  if (process.env.NODE_ENV !== 'production' || !hasExplicitList) {
    configured.add('http://localhost:3000');
    configured.add('http://127.0.0.1:3000');
    configured.add('http://localhost:5173');
    configured.add('http://127.0.0.1:5173');
  }

  return {
    explicitlyConfigured: hasExplicitList,
    origins: configured,
  };
}

export function isSameHostOrigin(originHeader: string, hostHeader?: string): boolean {
  if (!hostHeader) return false;
  try {
    const parsed = new URL(originHeader);
    return parsed.host.toLowerCase() === hostHeader.trim().toLowerCase();
  } catch {
    return false;
  }
}

export function applySecurityHeaders(req: Request, res: Response): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-XSS-Protection', '0');

  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '').toLowerCase();
  if (proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

export function createCorsAndSecurityMiddleware(options?: CorsConfigOptions) {
  const { explicitlyConfigured, origins } = parseAllowedOrigins(options?.allowedOrigins);

  return (req: Request, res: Response, next: NextFunction) => {
    applySecurityHeaders(req, res);

    const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : undefined;

    if (requestOrigin) {
      const normalized = normalizeOrigin(requestOrigin);
      const allowed =
        origins.has(normalized) ||
        isSameHostOrigin(requestOrigin, hostHeader) ||
        (!explicitlyConfigured && process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized));

      if (!allowed) {
        if (req.method === 'OPTIONS') {
          return res.status(403).json({
            success: false,
            code: 'CORS_ORIGIN_FORBIDDEN',
            error: 'Cross-origin request blocked by server CORS allowlist.',
          });
        }
        return res.status(403).json({
          success: false,
          code: 'CORS_ORIGIN_FORBIDDEN',
          error: 'Cross-origin request blocked by server CORS allowlist.',
        });
      }

      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Terminal-Token, Stripe-Signature, PayPal-Transmission-Sig, PayPal-Transmission-Id, PayPal-Transmission-Time'
      );
    } else {
      // Non-browser clients (MT5 EAs, backend health probes, server-to-server webhooks) omit Origin.
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Terminal-Token, Stripe-Signature, PayPal-Transmission-Sig'
      );
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    next();
  };
}

export class SlidingWindowRateLimiter {
  private buckets = new Map<string, number[]>();

  constructor(private readonly maxOverrides?: Partial<Record<'ea_bridge' | 'webhook' | 'auth_sensitive' | 'default_api', number>>) {}

  public classifyRequest(req: Request): RateLimitPolicy {
    const p = req.path || '';
    const windowMs = 60_000;

    if (p.includes('/billing/webhooks/')) {
      return {
        bucket: 'webhook',
        limit: this.maxOverrides?.webhook ?? 60,
        windowMs,
      };
    }

    if (
      p.startsWith('/api/v1/bridge/heartbeat') ||
      p.startsWith('/api/v1/bridge/instructions/') ||
      p.startsWith('/api/v1/bridge/events/') ||
      p.startsWith('/api/v1/bridge/positions/')
    ) {
      return {
        bucket: 'ea_bridge',
        limit: this.maxOverrides?.ea_bridge ?? 600,
        windowMs,
      };
    }

    if (
      p.startsWith('/api/admin/') ||
      p.startsWith('/api/v1/billing/checkout') ||
      p.startsWith('/api/v1/bridge/terminals/')
    ) {
      return {
        bucket: 'auth_sensitive',
        limit: this.maxOverrides?.auth_sensitive ?? 60,
        windowMs,
      };
    }

    return {
      bucket: 'default_api',
      limit: this.maxOverrides?.default_api ?? 240,
      windowMs,
    };
  }

  public getClientIp(req: Request): string {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.trim()) {
      return fwd.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }

  public middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.path.startsWith('/api/')) {
        return next();
      }
      const policy = this.classifyRequest(req);
      const ip = this.getClientIp(req);
      const key = `${policy.bucket}:${ip}`;
      const now = Date.now();
      const cutoff = now - policy.windowMs;

      const existing = (this.buckets.get(key) || []).filter((ts) => ts > cutoff);
      if (existing.length >= policy.limit) {
        const retryAfterSec = Math.max(1, Math.ceil((existing[0] + policy.windowMs - now) / 1000));
        res.setHeader('Retry-After', String(retryAfterSec));
        res.setHeader('X-RateLimit-Limit', String(policy.limit));
        res.setHeader('X-RateLimit-Remaining', '0');
        return res.status(429).json({
          success: false,
          code: 'RATE_LIMIT_EXCEEDED',
          error: `Too many requests on ${policy.bucket}. Retry after ${retryAfterSec}s.`,
        });
      }

      existing.push(now);
      this.buckets.set(key, existing);

      // Periodic GC if buckets map grows large
      if (this.buckets.size > 2000) {
        for (const [k, timestamps] of this.buckets.entries()) {
          if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
            this.buckets.delete(k);
          }
        }
      }

      res.setHeader('X-RateLimit-Limit', String(policy.limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, policy.limit - existing.length)));
      next();
    };
  }
}
