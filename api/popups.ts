import { ApiRequest, ApiResponse, sendJson } from './_lib/http.ts';
import { listActivePopups, POPUP_CATEGORIES } from './_lib/popups.ts';
import { ensureSeeded } from './_lib/seed.ts';

export default async function handler(req: ApiRequest, res: ApiResponse) {
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
