import { ApiRequest, ApiResponse, sendJson } from './_lib/http.ts';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method && req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  sendJson(res, 200, { ok: true, service: 'Froc Rota Turismo API' });
}
