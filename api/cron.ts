import crypto from 'node:crypto';
import { runDailyAgentRoutine } from './_lib/agent-jobs.js';
import { runDailyFivePostsBatch } from './_lib/editorial.js';
import { ApiRequest, ApiResponse, enforceApiSecurity, getHeader, getQuery, sendJson } from './_lib/http.js';
import { ensureSeeded } from './_lib/seed.js';

/**
 * Rotinas automáticas diárias (Vercel Cron, ver vercel.json):
 *  - /api/cron/jornal  → jornal diário (5 matérias originais)
 *  - /api/cron/agentes → agentes: planos/anúncios, financeiro, anti-fraude, relatório executivo
 * A Vercel manda "Authorization: Bearer <CRON_SECRET>". Sem esse segredo ninguém de fora dispara.
 */
export function isAuthorizedCron(authHeader: string | undefined, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !authHeader) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(authHeader);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!enforceApiSecurity(req, res, { allowThirdPartyWebhook: true })) return;
  if (!isAuthorizedCron(getHeader(req, 'authorization'), process.env.CRON_SECRET)) {
    sendJson(res, 401, { error: 'Não autorizado.' });
    return;
  }
  try {
    await ensureSeeded();
    const job = getQuery(req).job || 'agentes';
    if (job === 'jornal') {
      const r = await runDailyFivePostsBatch();
      sendJson(res, 200, { ok: true, job, date: r.date, created: r.created.length });
      return;
    }
    if (job === 'agentes') {
      const r = await runDailyAgentRoutine();
      sendJson(res, 200, { ok: true, job, result: r });
      return;
    }
    sendJson(res, 400, { error: 'Rotina desconhecida.' });
  } catch (error) {
    console.error('cron error:', error);
    sendJson(res, 500, { error: 'Falha na rotina diária.' });
  }
}
