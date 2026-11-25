import net from 'node:net';
import type { ApiRequest, ApiResponse } from './http.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_SANITIZE_DEPTH = 8;
const MAX_STRING_LENGTH = 20000;

export const ALLOWED_CORS_SUFFIXES = ['.vercel.app', '.run.app', '.aistudio.google.com'];

/**
 * Strips ASCII control chars (except \n, \r, \t) and null bytes while keeping accents/UTF-8 intact.
 */
export function sanitizeStringControlChars(value: string, maxLength = MAX_STRING_LENGTH): string {
  let cleaned = '';
  for (let i = 0; i < value.length && cleaned.length < maxLength; i++) {
    const code = value.charCodeAt(i);
    if (code === 0) continue;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
    if (code === 127) continue;
    cleaned += value[i];
  }
  return cleaned;
}

/**
 * Recursively strips prototype-pollution keys (__proto__, constructor, prototype)
 * and NoSQL operator keys ($gt, $where, etc.) from untrusted JSON payloads.
 */
export function sanitizeUntrustedValue<T>(value: T, depth = 0): T {
  if (depth > MAX_SANITIZE_DEPTH) {
    return null as unknown as T;
  }
  if (typeof value === 'string') {
    return sanitizeStringControlChars(value) as unknown as T;
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((item) => sanitizeUntrustedValue(item, depth + 1)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      if (key.startsWith('$')) continue;
      out[key] = sanitizeUntrustedValue(val, depth + 1);
    }
    return out as T;
  }
  return null as unknown as T;
}

/**
 * Checks whether an IPv4 or IPv6 host/literal is private, loopback, or link-local (SSRF guard).
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // Cloud metadata / link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  if (ipVersion === 6) {
    if (host === '::' || host === '::1') return true;
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
    if (host.startsWith('::ffff:')) {
      return isPrivateOrLoopbackHost(host.slice('::ffff:'.length));
    }
    return false;
  }

  return false;
}

/**
 * Validates external URLs safely against XSS schemes (javascript:, data:) and SSRF targets.
 */
export function isSafeExternalHttpsUrl(rawUrl: string): string | null {
  const clean = rawUrl.trim();
  if (!clean) return null;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (isPrivateOrLoopbackHost(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|system)\s+(instructions|prompt)/i,
  /(reveal|print|show|output|dump)\s+(your\s+)?(system\s+prompt|hidden\s+instructions|api\s+key|secrets?)/i,
  /you\s+are\s+now\s+(in\s+)?developer\s+mode/i,
  /jailbreak\s+mode/i,
];

/**
 * Sanitizes and guards user queries before sending to Gemini endpoints.
 */
export function sanitizeAiPrompt(rawQuery: string, maxLength = 1500): string {
  const strippedZeroWidth = rawQuery.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '');
  const normalized = sanitizeStringControlChars(strippedZeroWidth, maxLength).trim();
  if (!normalized) {
    throw new Error('PROMPT_EMPTY');
  }
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      throw new Error('PROMPT_POLICY_VIOLATION');
    }
  }
  return normalized;
}

export function isAllowedOrigin(origin: string, reqHost?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (reqHost && parsed.host.toLowerCase() === reqHost.toLowerCase()) return true;

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      const appOrigin = new URL(appUrl).origin;
      if (parsed.origin === appOrigin) return true;
    } catch {
      // ignore invalid APP_URL
    }
  }

  if (process.env.VERCEL_URL && host === process.env.VERCEL_URL.trim().toLowerCase()) {
    return true;
  }

  return ALLOWED_CORS_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Attaches strict security headers to every API response (compatible with iframe previews).
 */
export function applySecurityHeaders(req: ApiRequest, res: ApiResponse): void {
  if (res.headersSent) return;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=()');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (proto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

/**
 * Enforces explicit allowlisted CORS origin handling (no wildcard * on API endpoints).
 * Returns false if request was terminated (either preflight 204 or rejected 403).
 */
export function applyCorsAndOriginGuard(
  req: ApiRequest,
  res: ApiResponse,
  options?: { allowThirdPartyWebhook?: boolean }
): boolean {
  applySecurityHeaders(req, res);

  if (options?.allowThirdPartyWebhook) {
    return true;
  }

  const originHeader = req.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  const rawHost = req.headers['x-forwarded-host'] || req.headers.host;
  const reqHost = Array.isArray(rawHost) ? rawHost[0] : rawHost;

  if (origin) {
    if (!isAllowedOrigin(origin, reqHost)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Origem da requisição não autorizada.' }));
      return false;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return false;
  }

  return true;
}

export function getSecurityPostureSnapshot() {
  return {
    httpsStrictHeaders: true,
    noStoreApiCache: true,
    strictCorsOriginAllowlist: true,
    maxJsonBodyBytes: 1_048_576,
    prototypeAndNoSqlSanitizer: true,
    ssrfUrlFilter: true,
    aiPromptInjectionGuard: true,
    webhookHmacAndReplayWindowSec: 900,
    oauthHmacSignedState: true,
    rbacVerifiedEmailRequired: true,
    mercadoPagoWebhookSecretConfigured: Boolean(
      process.env.MERCADOPAGO_WEBHOOK_SECRET &&
        process.env.MERCADOPAGO_WEBHOOK_SECRET.trim().length > 10
    ),
    oauthCustomSecretConfigured: Boolean(
      process.env.OAUTH_STATE_SECRET && process.env.OAUTH_STATE_SECRET.trim().length >= 16
    ),
  };
}
