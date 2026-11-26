import crypto from 'node:crypto';
import { runDailyAgentRoutine } from './_lib/agent-jobs.js';
import { runDailyFivePostsBatch } from './_lib/editorial.js';
import { ApiRequest, ApiResponse, enforceApiSecurity, getHeader, getQuery, sendJson } from './_lib/http.js';
import { ensureSeeded } from './_lib/seed.js';
import { pingIndexNow } from './_lib/seo.js';
import { fotosDosDestinos, TODOS_OS_SLUGS } from './_lib/fotos.js';

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
      // Avisa o Bing (IndexNow) das matérias novas; o Google acha pelo sitemap.
      const pinged = await pingIndexNow(['/blog', '/sitemap.xml', ...r.created.map((p) => `/blog/${p.slug}`)]);
      sendJson(res, 200, { ok: true, job, date: r.date, created: r.created.length, indexNow: pinged });
      return;
    }
    if (job === 'agentes') {
      const r = await runDailyAgentRoutine();
      // Deixa as fotos reais dos 100 destinos prontas (cache de 30 dias), sem segurar a rotina mais de 25 s.
      const fotos = await Promise.race([
        fotosDosDestinos(TODOS_OS_SLUGS).then((f) => Object.values(f).filter(Boolean).length),
        new Promise<number>((ok) => setTimeout(() => ok(-1), 25000)),
      ]).catch(() => -1);
      sendJson(res, 200, { ok: true, job, result: r, fotosProntas: fotos });
      return;
    }
    sendJson(res, 400, { error: 'Rotina desconhecida.' });
  } catch (error) {
    console.error('cron error:', error);
    sendJson(res, 500, { error: 'Falha na rotina diária.' });
  }
}
