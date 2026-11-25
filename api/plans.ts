import { adminDb } from './_lib/firebase-admin.ts';
import { ApiRequest, ApiResponse, checkRateLimit, enforceApiSecurity, sendJson } from './_lib/http.ts';
import { ensureSeeded } from './_lib/seed.ts';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!enforceApiSecurity(req, res)) return;
  if (!checkRateLimit(req, res, 'plans:api', 60, 60000)) return;
  if (req.method && req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  try {
    await ensureSeeded();
    const snap = await adminDb
      .collection('merchant_plans')
      .where('active', '==', true)
      .get();
    const plans = snap.docs
      .map((d) => d.data() as Record<string, unknown>)
      .sort((a, b) => Number(a.monthlyPriceCents || 0) - Number(b.monthlyPriceCents || 0));
    sendJson(res, 200, { plans });
  } catch (error) {
    console.error('GET /api/plans error:', error);
    sendJson(res, 500, { error: 'Erro ao carregar planos comerciais.' });
  }
}
