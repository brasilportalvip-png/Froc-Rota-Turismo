/**
 * Leilão de comissão (regra do dono, nov/2026): cada anunciante escolhe quanto paga de comissão
 * à Froc Rota por reserva, de 14% a 25%. Quem oferece mais aparece primeiro na vitrine e nas buscas
 * do mesmo destino. A IA sugere o lance para chegar ao topo.
 */
export const COMISSAO_MIN_BPS = 1400;
export const COMISSAO_MAX_BPS = 2500;
export const PASSO_BPS = 50; // 0,5%

/** Lance válido (sem lance = 14%). */
export function lanceComissaoBps(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return COMISSAO_MIN_BPS;
  const arred = Math.round(n / PASSO_BPS) * PASSO_BPS;
  return Math.min(COMISSAO_MAX_BPS, Math.max(COMISSAO_MIN_BPS, arred));
}

export interface Concorrente {
  merchantId: number;
  bidBps: number;
}

/**
 * Posição do anunciante entre os concorrentes do mesmo destino (1 = topo) e o lance sugerido.
 * Empate: quem deu o lance primeiro fica na frente, então para passar é preciso oferecer 0,5% a mais.
 */
export function analisarLeilao(meuId: number, meuLance: number, concorrentes: Concorrente[]) {
  const outros = concorrentes.filter((c) => c.merchantId !== meuId).map((c) => lanceComissaoBps(c.bidBps)).sort((a, b) => b - a);
  const lance = lanceComissaoBps(meuLance);
  const posicao = 1 + outros.filter((b) => b >= lance).length;
  const topo = outros.length ? Math.min(COMISSAO_MAX_BPS, outros[0] + PASSO_BPS) : COMISSAO_MIN_BPS;
  const top3 = outros.length >= 3 ? Math.min(COMISSAO_MAX_BPS, outros[2] + PASSO_BPS) : COMISSAO_MIN_BPS;
  const empateNoMaximo = outros.length > 0 && outros[0] >= COMISSAO_MAX_BPS;
  let dica: string;
  if (!outros.length) dica = 'Você é o único anunciante nos seus destinos: com 14% você já aparece primeiro.';
  else if (posicao === 1) dica = `Você está em 1º lugar. Ninguém oferece mais que ${(lance / 100).toFixed(1).replace('.0', '')}%.`;
  else if (empateNoMaximo) dica = 'Já há concorrente no máximo (25%). Com 25% você fica logo atrás dele.';
  else dica = `Com ${(topo / 100).toFixed(1).replace('.0', '')}% você passa para o 1º lugar${outros.length >= 3 && top3 < topo ? `; com ${(top3 / 100).toFixed(1).replace('.0', '')}% fica entre os 3 primeiros` : ''}.`;
  return { lanceBps: lance, posicao, total: outros.length + 1, sugestaoTopoBps: topo, sugestaoTop3Bps: top3, dica };
}

/** Ordem da vitrine: destaque pago, depois maior lance, depois nota. */
export function ordemDoLeilao<T extends { isFeatured?: boolean; ratingAvg?: number }>(a: T & { bidBps: number }, b: T & { bidBps: number }) {
  if (Boolean(b.isFeatured) !== Boolean(a.isFeatured)) return Number(Boolean(b.isFeatured)) - Number(Boolean(a.isFeatured));
  if (b.bidBps !== a.bidBps) return b.bidBps - a.bidBps;
  return Number(b.ratingAvg || 0) - Number(a.ratingAvg || 0);
}
