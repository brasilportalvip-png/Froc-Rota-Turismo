import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ApiRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export interface ApiResponse extends ServerResponse {
  status?: (code: number) => ApiResponse;
  json?: (data: unknown) => void;
  send?: (body: string) => void;
}

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

export async function parseJsonBody<T = Record<string, unknown>>(req: ApiRequest): Promise<T> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      return (req.body.trim() ? JSON.parse(req.body) : {}) as T;
    }
    return req.body as T;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

export function sendJson(res: ApiResponse, statusCode: number, data: unknown): void {
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

// Simple sliding-window rate limiter per IP + route
const rateBuckets: Record<string, { count: number; resetAt: number }> = {};

export function checkRateLimit(
  req: ApiRequest,
  res: ApiResponse,
  scope: string,
  maxRequests: number,
  windowMs: number
): boolean {
  const key = `${getClientIp(req)}:${scope}`;
  const now = Date.now();
  const bucket = rateBuckets[key];
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets[key] = { count: 1, resetAt: now + windowMs };
    return true;
  }
  if (bucket.count >= maxRequests) {
    sendJson(res, 429, { error: 'Too many requests. Please slow down.' });
    return false;
  }
  bucket.count += 1;
  return true;
}

export function sanitizeAssetOrSafeHttpUrl(url: string): string | null {
  const clean = url.trim();
  if (clean.startsWith('/src/assets/images/')) return clean;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // invalid URL
  }
  return null;
}
