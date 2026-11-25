/**
 * Câmbio oficial do Banco Central (PTAX, API pública Olinda, sem chave).
 * Usado para mostrar em reais as tarifas que a companhia aérea devolve em outra moeda.
 */

const OLINDA =
  'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)';

const cache = new Map<string, { at: number; rate: number; date: string }>();
const TTL_MS = 60 * 60 * 1000;

function mmddyyyy(d: Date): string {
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${d.getUTCFullYear()}`;
}

/** Último boletim de venda da moeda (busca os últimos 10 dias por causa de fim de semana e feriado). */
export function pickLatestSellRate(
  rows: Array<{ cotacaoVenda?: number; dataHoraCotacao?: string }>
): { rate: number; date: string } | null {
  const valid = rows
    .filter((r) => typeof r.cotacaoVenda === 'number' && r.cotacaoVenda > 0 && r.dataHoraCotacao)
    .sort((a, b) => String(a.dataHoraCotacao).localeCompare(String(b.dataHoraCotacao)));
  const last = valid[valid.length - 1];
  return last ? { rate: Number(last.cotacaoVenda), date: String(last.dataHoraCotacao).slice(0, 10) } : null;
}

export async function getBrlRate(currency: string, now = new Date()): Promise<{ rate: number; date: string } | null> {
  const cur = currency.toUpperCase();
  if (cur === 'BRL') return { rate: 1, date: now.toISOString().slice(0, 10) };
  if (!/^[A-Z]{3}$/.test(cur)) return null;
  const hit = cache.get(cur);
  if (hit && Date.now() - hit.at < TTL_MS) return { rate: hit.rate, date: hit.date };
  const start = new Date(now.getTime() - 10 * 86400000);
  const url =
    `${OLINDA}?%40moeda='${cur}'&%40dataInicial='${mmddyyyy(start)}'&%40dataFinalCotacao='${mmddyyyy(now)}'` +
    `&%24format=json&%24select=cotacaoVenda,dataHoraCotacao`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { value?: Array<{ cotacaoVenda?: number; dataHoraCotacao?: string }> };
    const latest = pickLatestSellRate(json.value ?? []);
    if (latest) cache.set(cur, { at: Date.now(), ...latest });
    return latest;
  } catch (err) {
    console.error('PTAX error:', err);
    return null;
  }
}
