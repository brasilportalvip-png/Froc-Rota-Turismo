import { GenerateContentParameters, GenerateContentResponse, GoogleGenAI } from '@google/genai';

/**
 * Gemini Anti-Outage & High-Availability Engine (v3.6 / 3.7 / 3.8 SDK Compatible)
 *
 * Implements:
 * - Multi-model resilient failover cascade (only verified active models from gemini_api skill)
 * - Optional multi-key rotation (GEMINI_API_KEY + optional GEMINI_API_KEY_BACKUP)
 * - Per-route circuit breaker (CLOSED -> OPEN -> HALF_OPEN)
 * - Exponential backoff with full jitter
 * - Per-attempt AbortController timeout guard
 * - Safe structured JSON extraction with automatic markdown fence stripping & validation retry
 */

export const GEMINI_SDK_COMPAT_LINE = '3.6+ (3.6 / 3.7 / 3.8 resilient cascade)';

// Verified active default text models (no deprecated 1.5/2.0, no paid-only default models)
export const DEFAULT_GEMINI_TEXT_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
] as const;

const DEPRECATED_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type GeminiErrorCategory =
  | 'missing_key'
  | 'invalid_key'
  | 'permission_denied'
  | 'quota_exhausted'
  | 'model_not_found'
  | 'timeout'
  | 'upstream_unavailable'
  | 'invalid_json'
  | 'all_routes_failed';

export class GeminiResilienceError extends Error {
  readonly code: GeminiErrorCategory;
  readonly httpStatus: number;
  readonly attemptedRoutes: string[];

  constructor(
    message: string,
    code: GeminiErrorCategory,
    httpStatus = 503,
    attemptedRoutes: string[] = []
  ) {
    super(message);
    this.name = 'GeminiResilienceError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.attemptedRoutes = attemptedRoutes;
  }
}

export interface RouteCircuitMetrics {
  routeId: string;
  model: string;
  keySlot: 'primary' | 'backup';
  state: CircuitState;
  consecutiveFailures: number;
  totalCalls: number;
  totalSuccesses: number;
  totalFailures: number;
  failoverRecoveries: number;
  lastErrorCategory: GeminiErrorCategory | null;
  lastErrorMessage: string | null;
  lastLatencyMs: number | null;
  openedUntil: number | null;
}

interface KeySlotEntry {
  slot: 'primary' | 'backup';
  apiKey: string;
}

const circuitMap = new Map<string, RouteCircuitMetrics>();
let globalFailoverCount = 0;
let globalTotalRequests = 0;

function isRealApiKey(raw?: string): raw is string {
  if (!raw) return false;
  const trimmed = raw.trim();
  return Boolean(trimmed && trimmed !== 'MY_GEMINI_API_KEY' && trimmed.length >= 12);
}

export function resolveGeminiKeySlots(): KeySlotEntry[] {
  const slots: KeySlotEntry[] = [];
  if (isRealApiKey(process.env.GEMINI_API_KEY)) {
    slots.push({ slot: 'primary', apiKey: process.env.GEMINI_API_KEY.trim() });
  }
  if (isRealApiKey(process.env.GEMINI_API_KEY_BACKUP)) {
    const backup = process.env.GEMINI_API_KEY_BACKUP.trim();
    if (!slots.some((s) => s.apiKey === backup)) {
      slots.push({ slot: 'backup', apiKey: backup });
    }
  }
  return slots;
}

export function resolveGeminiModelCascade(preferredModels?: string[]): string[] {
  const rawExtra = (process.env.GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const candidates = [
    ...(preferredModels || []),
    ...DEFAULT_GEMINI_TEXT_MODELS,
    ...rawExtra,
  ];

  const unique: string[] = [];
  for (const m of candidates) {
    const clean = m.trim();
    if (!clean) continue;
    if (DEPRECATED_MODELS.has(clean.toLowerCase())) continue;
    if (!unique.includes(clean)) {
      unique.push(clean);
    }
  }
  return unique.length > 0 ? unique : [...DEFAULT_GEMINI_TEXT_MODELS];
}

function getOrCreateCircuit(model: string, keySlot: 'primary' | 'backup'): RouteCircuitMetrics {
  const routeId = `${keySlot}:${model}`;
  let existing = circuitMap.get(routeId);
  if (!existing) {
    existing = {
      routeId,
      model,
      keySlot,
      state: 'CLOSED',
      consecutiveFailures: 0,
      totalCalls: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      failoverRecoveries: 0,
      lastErrorCategory: null,
      lastErrorMessage: null,
      lastLatencyMs: null,
      openedUntil: null,
    };
    circuitMap.set(routeId, existing);
  }
  return existing;
}

function getEffectiveCircuitState(circuit: RouteCircuitMetrics, now = Date.now()): CircuitState {
  if (circuit.state === 'OPEN' && circuit.openedUntil !== null) {
    if (now >= circuit.openedUntil) {
      circuit.state = 'HALF_OPEN';
      return 'HALF_OPEN';
    }
    return 'OPEN';
  }
  return circuit.state;
}

export function classifyGeminiError(err: unknown): {
  category: GeminiErrorCategory;
  retryable: boolean;
  cooldownMs: number;
  httpStatus: number;
} {
  const msg = err instanceof Error ? err.message : String(err || '');
  const lower = msg.toLowerCase();
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: number }).status)
      : undefined;

  if (lower.includes('api_key_invalid') || lower.includes('api key not valid') || status === 400) {
    return { category: 'invalid_key', retryable: false, cooldownMs: 120_000, httpStatus: 400 };
  }
  if (lower.includes('permission_denied') || status === 403) {
    return { category: 'permission_denied', retryable: false, cooldownMs: 120_000, httpStatus: 403 };
  }
  if (lower.includes('not_found') || status === 404) {
    return { category: 'model_not_found', retryable: false, cooldownMs: 300_000, httpStatus: 404 };
  }
  if (
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    status === 429
  ) {
    return { category: 'quota_exhausted', retryable: true, cooldownMs: 90_000, httpStatus: 429 };
  }
  if (
    lower.includes('abort') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('deadline')
  ) {
    return { category: 'timeout', retryable: true, cooldownMs: 45_000, httpStatus: 504 };
  }
  if (lower.includes('invalid_json')) {
    return { category: 'invalid_json', retryable: true, cooldownMs: 20_000, httpStatus: 502 };
  }
  return {
    category: 'upstream_unavailable',
    retryable: true,
    cooldownMs: 60_000,
    httpStatus: 503,
  };
}

function recordCircuitSuccess(circuit: RouteCircuitMetrics, latencyMs: number, viaFailover: boolean) {
  circuit.state = 'CLOSED';
  circuit.consecutiveFailures = 0;
  circuit.openedUntil = null;
  circuit.totalCalls += 1;
  circuit.totalSuccesses += 1;
  circuit.lastLatencyMs = latencyMs;
  if (viaFailover) {
    circuit.failoverRecoveries += 1;
  }
}

function recordCircuitFailure(
  circuit: RouteCircuitMetrics,
  err: unknown,
  latencyMs: number,
  failureThreshold = 2
) {
  const info = classifyGeminiError(err);
  circuit.totalCalls += 1;
  circuit.totalFailures += 1;
  circuit.consecutiveFailures += 1;
  circuit.lastErrorCategory = info.category;
  circuit.lastErrorMessage =
    err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
  circuit.lastLatencyMs = latencyMs;

  if (
    info.category === 'model_not_found' ||
    info.category === 'invalid_key' ||
    circuit.consecutiveFailures >= failureThreshold ||
    circuit.state === 'HALF_OPEN'
  ) {
    circuit.state = 'OPEN';
    circuit.openedUntil = Date.now() + info.cooldownMs;
  }
  return info;
}

export function resetGeminiCircuitBreakers(): void {
  for (const circuit of circuitMap.values()) {
    circuit.state = 'CLOSED';
    circuit.consecutiveFailures = 0;
    circuit.openedUntil = null;
    circuit.lastErrorCategory = null;
    circuit.lastErrorMessage = null;
  }
  globalFailoverCount = 0;
}

export function getGeminiResilienceSnapshot() {
  const keys = resolveGeminiKeySlots();
  const models = resolveGeminiModelCascade();
  const now = Date.now();

  const routes = models.flatMap((model) =>
    (keys.length > 0 ? keys : [{ slot: 'primary' as const, apiKey: '' }]).map((k) => {
      const c = getOrCreateCircuit(model, k.slot);
      const effectiveState = getEffectiveCircuitState(c, now);
      return {
        routeId: c.routeId,
        model: c.model,
        keySlot: c.keySlot,
        state: effectiveState,
        consecutiveFailures: c.consecutiveFailures,
        totalCalls: c.totalCalls,
        totalSuccesses: c.totalSuccesses,
        totalFailures: c.totalFailures,
        failoverRecoveries: c.failoverRecoveries,
        lastErrorCategory: c.lastErrorCategory,
        lastLatencyMs: c.lastLatencyMs,
        cooldownRemainingSec:
          effectiveState === 'OPEN' && c.openedUntil
            ? Math.max(0, Math.ceil((c.openedUntil - now) / 1000))
            : 0,
      };
    })
  );

  const openCircuits = routes.filter((r) => r.state === 'OPEN').length;

  return {
    configured: keys.length > 0,
    primaryKeyConfigured: keys.some((k) => k.slot === 'primary'),
    backupKeyConfigured: keys.some((k) => k.slot === 'backup'),
    sdkCompatLine: GEMINI_SDK_COMPAT_LINE,
    cascadeModels: models,
    totalRequests: globalTotalRequests,
    totalFailovers: globalFailoverCount,
    healthyRoutesCount: routes.length - openCircuits,
    totalRoutesCount: routes.length,
    overallStatus:
      keys.length === 0
        ? 'awaiting_api_key'
        : openCircuits === routes.length
        ? 'degraded_all_open'
        : openCircuits > 0
        ? 'failover_active'
        : 'healthy',
    routes,
  };
}

function defaultClientFactory(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function computeBackoffWithJitterMs(attemptIndex: number, baseMs = 240): number {
  const exp = baseMs * Math.pow(2, attemptIndex);
  return Math.round(exp * (0.65 + Math.random() * 0.7));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ResilientGeminiOptions {
  contents: GenerateContentParameters['contents'];
  config?: GenerateContentParameters['config'];
  preferredModels?: string[];
  timeoutMs?: number;
  retriesPerRoute?: number;
  // Injectable for unit tests; never exposed to HTTP inputs
  _clientFactory?: (apiKey: string) => {
    models: {
      generateContent: (params: GenerateContentParameters) => Promise<GenerateContentResponse>;
    };
  };
  _sleepFn?: (ms: number) => Promise<void>;
}

export interface ResilientGeminiOutput {
  response: GenerateContentResponse;
  text: string;
  modelUsed: string;
  keySlotUsed: 'primary' | 'backup';
  attempts: number;
  usedFailover: boolean;
  latencyMs: number;
}

async function runWithTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Gemini timeout exceeded (${timeoutMs}ms)`));
      }, timeoutMs);
    });
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function generateResilientContent(
  opts: ResilientGeminiOptions
): Promise<ResilientGeminiOutput> {
  const keys = resolveGeminiKeySlots();
  if (keys.length === 0) {
    throw new GeminiResilienceError(
      'GEMINI_API_KEY não configurada no servidor.',
      'missing_key',
      503
    );
  }

  globalTotalRequests += 1;
  const models = resolveGeminiModelCascade(opts.preferredModels);
  const timeoutMs = Math.max(2000, Math.min(30_000, opts.timeoutMs ?? 12_000));
  const retriesPerRoute = Math.max(0, Math.min(2, opts.retriesPerRoute ?? 1));
  const clientFactory = opts._clientFactory || defaultClientFactory;
  const sleepFn = opts._sleepFn || sleep;

  const routePlan: Array<{ model: string; key: KeySlotEntry }> = [];
  for (const model of models) {
    for (const key of keys) {
      routePlan.push({ model, key });
    }
  }

  const now = Date.now();
  const eligible = routePlan.filter(
    (r) => getEffectiveCircuitState(getOrCreateCircuit(r.model, r.key.slot), now) !== 'OPEN'
  );
  // If all circuits are OPEN, allow half-open probe on the cascade rather than starving completely
  const candidates = eligible.length > 0 ? eligible : routePlan;

  const attemptedRoutes: string[] = [];
  let attempts = 0;
  let lastErr: unknown = null;
  let lastCategory: GeminiErrorCategory = 'all_routes_failed';

  for (let routeIdx = 0; routeIdx < candidates.length; routeIdx++) {
    const { model, key } = candidates[routeIdx];
    const circuit = getOrCreateCircuit(model, key.slot);
    const ai = clientFactory(key.apiKey);

    for (let retry = 0; retry <= retriesPerRoute; retry++) {
      attempts += 1;
      attemptedRoutes.push(circuit.routeId);
      const started = Date.now();

      try {
        const response = await runWithTimeout(
          (signal) =>
            ai.models.generateContent({
              model,
              contents: opts.contents,
              config: {
                ...(opts.config || {}),
                abortSignal: signal,
              },
            }),
          timeoutMs
        );

        const text = (response.text ?? '').trim();
        if (!text) {
          throw new Error('Upstream returned empty response');
        }

        const latencyMs = Date.now() - started;
        const usedFailover = routeIdx > 0 || retry > 0;
        if (usedFailover) globalFailoverCount += 1;
        recordCircuitSuccess(circuit, latencyMs, usedFailover);

        return {
          response,
          text,
          modelUsed: model,
          keySlotUsed: key.slot,
          attempts,
          usedFailover,
          latencyMs,
        };
      } catch (err) {
        lastErr = err;
        const latencyMs = Date.now() - started;
        const info = recordCircuitFailure(circuit, err, latencyMs);
        lastCategory = info.category;

        if (!info.retryable || retry >= retriesPerRoute) {
          break;
        }
        await sleepFn(computeBackoffWithJitterMs(retry));
      }
    }
  }

  const finalStatus =
    lastCategory === 'quota_exhausted'
      ? 429
      : lastCategory === 'invalid_key' || lastCategory === 'permission_denied'
      ? 503
      : 503;

  throw new GeminiResilienceError(
    `Motor Gemini indisponível após ${attempts} tentativa(s) em failover (${lastCategory}). ${
      lastErr instanceof Error ? lastErr.message : ''
    }`.trim(),
    lastCategory,
    finalStatus,
    attemptedRoutes
  );
}

export function stripJsonMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

export async function generateResilientJson<T>(
  opts: ResilientGeminiOptions & {
    validate?: (parsed: T) => boolean;
  }
): Promise<Omit<ResilientGeminiOutput, 'text' | 'response'> & { data: T }> {
  const keys = resolveGeminiKeySlots();
  if (keys.length === 0) {
    throw new GeminiResilienceError(
      'GEMINI_API_KEY não configurada no servidor.',
      'missing_key',
      503
    );
  }

  const models = resolveGeminiModelCascade(opts.preferredModels);
  const attempted: string[] = [];
  let totalAttempts = 0;

  // Try each model tier cleanly so invalid/truncated JSON on one tier seamlessly fails over to the next
  for (let idx = 0; idx < models.length; idx++) {
    const model = models[idx];
    try {
      const result = await generateResilientContent({
        ...opts,
        preferredModels: [model],
        retriesPerRoute: 1,
      });
      totalAttempts += result.attempts;
      attempted.push(`${result.keySlotUsed}:${result.modelUsed}`);

      const cleaned = stripJsonMarkdownFence(result.text);
      const parsed = JSON.parse(cleaned) as T;
      if (opts.validate && !opts.validate(parsed)) {
        throw new Error('INVALID_JSON_SCHEMA');
      }

      return {
        data: parsed,
        modelUsed: result.modelUsed,
        keySlotUsed: result.keySlotUsed,
        attempts: totalAttempts,
        usedFailover: idx > 0 || result.usedFailover,
        latencyMs: result.latencyMs,
      };
    } catch (err) {
      if (idx === models.length - 1) {
        if (err instanceof GeminiResilienceError) throw err;
        throw new GeminiResilienceError(
          `Falha ao obter resposta JSON válida após failover (${
            err instanceof Error ? err.message : 'erro desconhecido'
          }).`,
          'invalid_json',
          503,
          attempted
        );
      }
      // Continue to next model tier
    }
  }

  throw new GeminiResilienceError(
    'Nenhuma rota Gemini respondeu com JSON válido.',
    'all_routes_failed',
    503,
    attempted
  );
}
