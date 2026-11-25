import { getGeminiResilienceSnapshot } from './_lib/gemini-resilience.js';
import { ApiRequest, ApiResponse, enforceApiSecurity, sendJson } from './_lib/http.js';
import { getSecurityPostureSnapshot } from './_lib/security.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!enforceApiSecurity(req, res)) return;
  if (req.method && req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  // Carregado aqui dentro: se o Firebase falhar, o /api/health continua respondendo e mostra o motivo.
  let firebase: Record<string, unknown>;
  try {
    const { getFirebaseStatus } = await import('./_lib/firebase-admin.js');
    firebase = await getFirebaseStatus();
  } catch (err) {
    firebase = { ok: false, error: `Firebase Admin não carregou: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}` };
  }
  const aiSnapshot = getGeminiResilienceSnapshot();
  const secSnapshot = getSecurityPostureSnapshot();
  sendJson(res, 200, {
    ok: firebase.ok === true,
    service: 'Froc Rota Turismo API',
    node: process.version,
    firebase,
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
