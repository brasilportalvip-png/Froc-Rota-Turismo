/**
 * Integração com o Froc X Uber (app de corridas da Froc): o botão "Ir de Froc X" abre o app
 * com o destino (ou a partida, no caso do aeroporto) já preenchido.
 *
 * O Froc X lê: ?destino=&lat=&lng=&cidade=&uf=  (ponto B)  e  ?origem=&olat=&olng=&ocidade=&ouf=  (ponto A).
 * Sem coordenadas, ele procura o lugar pelo nome no mapa.
 */
const env: Record<string, string | undefined> = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
export const FROC_X_URL = (env.VITE_FROC_X_URL || 'https://froc-x-uber.vercel.app').replace(/\/+$/, '');

export interface PontoFrocX {
  nome: string;
  lat?: number | null;
  lng?: number | null;
  cidade?: string;
  uf?: string;
}

function coordenadaValida(lat?: number | null, lng?: number | null): boolean {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

/** Monta o link do Froc X com o destino e/ou a partida. */
export function linkFrocX(p: { destino?: PontoFrocX; origem?: PontoFrocX }): string {
  const q = new URLSearchParams();
  if (p.destino?.nome) {
    q.set('destino', p.destino.nome.slice(0, 120));
    if (coordenadaValida(p.destino.lat, p.destino.lng)) {
      q.set('lat', String(p.destino.lat));
      q.set('lng', String(p.destino.lng));
    }
    if (p.destino.cidade) q.set('cidade', p.destino.cidade);
    if (p.destino.uf) q.set('uf', p.destino.uf);
  }
  if (p.origem?.nome) {
    q.set('origem', p.origem.nome.slice(0, 120));
    if (coordenadaValida(p.origem.lat, p.origem.lng)) {
      q.set('olat', String(p.origem.lat));
      q.set('olng', String(p.origem.lng));
    }
    if (p.origem.cidade) q.set('ocidade', p.origem.cidade);
    if (p.origem.uf) q.set('ouf', p.origem.uf);
  }
  q.set('de', 'froc-rota');
  return `${FROC_X_URL}/?${q.toString()}`;
}
