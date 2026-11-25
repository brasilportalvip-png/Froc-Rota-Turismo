import { ApiRequest, ApiResponse, checkRateLimit, enforceApiSecurity, sendJson } from './_lib/http.js';
import { listActivePopups, POPUP_CATEGORIES } from './_lib/popups.js';
import { ensureSeeded } from './_lib/seed.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!enforceApiSecurity(req, res)) return;
  if (!checkRateLimit(req, res, 'popups:api', 60, 60000)) return;
  if (req.method && req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  try {
    await ensureSeeded();
    const popups = await listActivePopups();
    sendJson(res, 200, { popups, categories: POPUP_CATEGORIES });
  } catch (error) {
    console.error('GET /api/popups error:', error);
    sendJson(res, 500, { error: 'Erro ao carregar modelos de pop-ups.' });
  }
}
