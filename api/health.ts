import { getGeminiResilienceSnapshot } from './_lib/gemini-resilience.ts';
import { ApiRequest, ApiResponse, enforceApiSecurity, sendJson } from './_lib/http.ts';
import { getSecurityPostureSnapshot } from './_lib/security.ts';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!enforceApiSecurity(req, res)) return;
  if (req.method && req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const aiSnapshot = getGeminiResilienceSnapshot();
  const secSnapshot = getSecurityPostureSnapshot();
  sendJson(res, 200, {
    ok: true,
    service: 'Froc Rota Turismo API',
    gemini: {
      status: aiSnapshot.overallStatus,
      sdkCompatLine: aiSnapshot.sdkCompatLine,
      healthyRoutes: aiSnapshot.healthyRoutesCount,
      totalRoutes: aiSnapshot.totalRoutesCount,
      modelsCount: aiSnapshot.cascadeModels.length,
    },
    security: {
      headersActive: secSnapshot.httpsStrictHeaders,
      strictCors: secSnapshot.strictCorsOriginAllowlist,
      payloadGuardBytes: secSnapshot.maxJsonBodyBytes,
      rbacVerifiedEmail: secSnapshot.rbacVerifiedEmailRequired,
      webhookReplayGuardSec: secSnapshot.webhookHmacAndReplayWindowSec,
    },
  });
}
