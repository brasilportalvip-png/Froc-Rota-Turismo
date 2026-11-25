import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  applyCorsAndOriginGuard,
  applySecurityHeaders,
  isSafeExternalHttpsUrl,
  sanitizeUntrustedValue,
} from './security.ts';

export interface ApiRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export interface ApiResponse extends ServerResponse {
  status?: (code: number) => ApiResponse;
  json?: (data: unknown) => void;
  send?: (body: string) => void;
}

export class PayloadTooLargeError extends Error {
  constructor(message = 'Payload JSON excede o limite de segurança de 1MB.') {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

export const MAX_JSON_BODY_BYTES = 1_048_576; // 1 MB

export function getHeader(req: ApiRequest, name: string): string | undefined {
  const val = req.headers[name.toLowerCase()];
  if (Array.isArray(val)) return val[0];
  return typeof val === 'string' ? val : undefined;
}

export function getClientIp(req: ApiRequest): string {
  const fwd = getHeader(req, 'x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function getQuery(req: ApiRequest): Record<string, string> {
  const result: Record<string, string> = {};
  if (req.query) {
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === 'string') result[k] = v;
      else if (Array.isArray(v) && v.length > 0) result[k] = String(v[0]);
    }
  }
  const rawUrl = req.url || '/';
  const qIdx = rawUrl.indexOf('?');
  if (qIdx >= 0) {
    const sp = new URLSearchParams(rawUrl.slice(qIdx + 1));
    for (const [k, v] of sp.entries()) {
      if (!(k in result)) result[k] = v;
    }
  }
  return result;
}

export function getRoutePath(req: ApiRequest): string {
  const query = getQuery(req);
  if (query.route) {
    const r = query.route.startsWith('/') ? query.route : `/${query.route}`;
    return r.length > 1 ? r.replace(/\/+$/, '') : r;
  }
  const rawUrl = req.url || '/';
  const pathname = rawUrl.split('?')[0] || '/';
  const stripped = pathname.startsWith('/api') ? pathname.slice(4) || '/' : pathname;
  return stripped.length > 1 ? stripped.replace(/\/+$/, '') : stripped;
}

export function enforceApiSecurity(
  req: ApiRequest,
  res: ApiResponse,
  options?: { allowThirdPartyWebhook?: boolean }
): boolean {
  return applyCorsAndOriginGuard(req, res, options);
}

export async function parseJsonBody<T = Record<string, unknown>>(req: ApiRequest): Promise<T> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body, 'utf8') > MAX_JSON_BODY_BYTES) {
        throw new PayloadTooLargeError();
      }
      const parsed = req.body.trim() ? JSON.parse(req.body) : {};
      return sanitizeUntrustedValue(parsed) as T;
    }
    return sanitizeUntrustedValue(req.body) as T;
  }

  let totalBytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buf.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  try {
    return sanitizeUntrustedValue(JSON.parse(raw)) as T;
  } catch {
    return {} as T;
  }
}

export function sendJson(res: ApiResponse, statusCode: number, data: unknown): void {
  if (!res.headersSent) {
    applySecurityHeaders({ headers: {} } as ApiRequest, res);
  }
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    const r = res.status(statusCode);
    if (r && typeof r.json === 'function') {
      r.json(data);
      return;
    }
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function sendHtml(res: ApiResponse, statusCode: number, html: string): void {
  if (!res.headersSent) {
    applySecurityHeaders({ headers: {} } as ApiRequest, res);
  }
  if (typeof res.status === 'function' && typeof res.send === 'function') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const r = res.status(statusCode);
    if (r && typeof r.send === 'function') {
      r.send(html);
      return;
    }
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

// Bounded sliding-window rate limiter per IP + route
const MAX_RATE_BUCKETS = 5000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  req: ApiRequest,
  res: ApiResponse,
  scope: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const key = `${getClientIp(req)}:${scope}`;
  const now = Date.now();

  if (rateBuckets.size >= MAX_RATE_BUCKETS) {
    for (const [k, v] of rateBuckets.entries()) {
      if (v.resetAt <= now) rateBuckets.delete(k);
    }
    if (rateBuckets.size >= MAX_RATE_BUCKETS) {
      const oldestKey = rateBuckets.keys().next().value;
      if (oldestKey) rateBuckets.delete(oldestKey);
    }
  }

  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    if (!res.headersSent) {
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - 1)));
    }
    return true;
  }
  if (bucket.count >= maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    if (!res.headersSent) {
      res.setHeader('Retry-After', String(retryAfterSec));
      res.setHeader('X-RateLimit-Remaining', '0');
    }
    sendJson(res, 429, { error: 'Muitas solicitações. Aguarde alguns segundos e tente novamente.' });
    return false;
  }
  bucket.count += 1;
  if (!res.headersSent) {
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - bucket.count)));
  }
  return true;
}

export function sanitizeAssetOrSafeHttpUrl(url: string): string | null {
  const clean = url.trim();
  if (clean.startsWith('/src/assets/images/') && !clean.includes('..')) {
    return clean;
  }
  return isSafeExternalHttpsUrl(clean);
}
