/**
 * Viator (Tripadvisor) — passeios de parceiro afiliado.
 *
 * Regras do contrato de API da Viator que este arquivo respeita:
 * - o conteúdo só serve para levar o cliente à viator.com (o link `productUrl` já vem com o nosso PID);
 * - o conteúdo da Viator NÃO é indexado: não vai para o sitemap nem para as páginas de SEO;
 * - a chave fica só no servidor (VIATOR_API_KEY), nunca no navegador.
 *
 * Sem chave ou com a Viator fora do ar, devolve lista vazia e o site segue normal.
 */
import { adminDb } from './firebase-admin.js';

const BASE = (process.env.VIATOR_API_BASE || 'https://api.viator.com/partner').replace(/\/+$/, '');
const TEMPO_LIMITE_MS = 8000;
const DIA_MS = 86400000;
const PRODUTOS_TTL_MS = 6 * 3600000;
const MAX_PRODUTOS = 6;

export interface PasseioParceiro {
  codigo: string;
  titulo: string;
  imagem: string | null;
  nota: number | null;
  avaliacoes: number;
  duracaoMin: number | null;
  precoCents: number | null;
  moeda: string;
  url: string;
}

interface DestinoViator {
  id: string;
  nome: string;
  lat: number | null;
  lng: number | null;
  tipo: string;
}

export function viatorConfigurada(): boolean {
  return Boolean(process.env.VIATOR_API_KEY);
}

export function normalizarNome(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function distanciaKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}

async function chamarViator<T>(caminho: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const chave = process.env.VIATOR_API_KEY;
  if (!chave) throw new Error('VIATOR_SEM_CHAVE');
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    const resp = await fetch(`${BASE}${caminho}`, {
      method: init.method || 'GET',
      headers: {
        'exp-api-key': chave,
        Accept: 'application/json;version=2.0',
        'Accept-Language': 'pt-BR',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controle.signal,
    });
    if (!resp.ok) throw new Error(`VIATOR_HTTP_${resp.status}`);
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Só os destinos do Brasil, guardados por 1 dia (memória + banco) para não baixar a lista toda a cada visita. */
let destinosMem: { at: number; itens: DestinoViator[] } | null = null;

export function filtrarDestinosDoBrasil(lista: Array<Record<string, unknown>>): DestinoViator[] {
  const brasil = lista.find(
    (d) => String(d.type || '').toUpperCase() === 'COUNTRY' && ['brazil', 'brasil'].includes(normalizarNome(String(d.name || '')))
  );
  if (!brasil) return [];
  const idBr = String(brasil.destinationId);
  return lista
    .filter((d) => {
      const caminho = String(d.lookupId || '').split('.');
      return caminho.includes(idBr) && String(d.destinationId) !== idBr;
    })
    .map((d) => {
      const centro = (d.center || {}) as { latitude?: number; longitude?: number };
      return {
        id: String(d.destinationId),
        nome: String(d.name || ''),
        lat: typeof centro.latitude === 'number' ? centro.latitude : null,
        lng: typeof centro.longitude === 'number' ? centro.longitude : null,
        tipo: String(d.type || ''),
      };
    });
}

async function destinosDoBrasil(): Promise<DestinoViator[]> {
  if (destinosMem && Date.now() - destinosMem.at < DIA_MS) return destinosMem.itens;
  const ref = adminDb.collection('_cache').doc('viator_destinos_br');
  try {
    const snap = await ref.get();
    const dados = snap.exists ? (snap.data() as { at?: number; itens?: DestinoViator[] }) : null;
    if (dados?.itens?.length && Date.now() - Number(dados.at || 0) < DIA_MS) {
      destinosMem = { at: Number(dados.at), itens: dados.itens };
      return dados.itens;
    }
  } catch {
    // sem cache no banco: busca direto
  }
  const resp = await chamarViator<{ destinations?: Array<Record<string, unknown>> }>('/destinations');
  const itens = filtrarDestinosDoBrasil(resp.destinations || []);
  if (itens.length) {
    destinosMem = { at: Date.now(), itens };
    await ref.set({ at: destinosMem.at, itens }).catch(() => undefined);
  }
  return itens;
}

/** Acha o destino da Viator: primeiro pelo nome; se não achar, o mais perto (até 60 km). */
export function acharDestino(
  itens: DestinoViator[],
  alvo: { nome: string; lat?: number | null; lng?: number | null }
): DestinoViator | null {
  const nome = normalizarNome(alvo.nome);
  const porNome = itens.filter((d) => normalizarNome(d.nome) === nome);
  if (porNome.length) {
    const cidade = porNome.find((d) => d.tipo.toUpperCase() === 'CITY');
    return cidade || porNome[0];
  }
  if (typeof alvo.lat !== 'number' || typeof alvo.lng !== 'number') return null;
  let melhor: DestinoViator | null = null;
  let menor = 60;
  for (const d of itens) {
    if (d.lat === null || d.lng === null) continue;
    const km = distanciaKm(alvo.lat, alvo.lng, d.lat, d.lng);
    if (km < menor) {
      menor = km;
      melhor = d;
    }
  }
  return melhor;
}

function escolherImagem(imagens: unknown): string | null {
  const lista = Array.isArray(imagens) ? (imagens as Array<Record<string, unknown>>) : [];
  const capa = lista.find((i) => i.isCover) || lista[0];
  const variantes = Array.isArray(capa?.variants) ? (capa!.variants as Array<{ url?: string; width?: number }>) : [];
  const boas = variantes.filter((v) => typeof v.url === 'string' && /^https:\/\//.test(v.url!));
  if (!boas.length) return null;
  boas.sort((a, b) => Math.abs((a.width || 0) - 480) - Math.abs((b.width || 0) - 480));
  return boas[0].url!;
}

function duracaoEmMinutos(d: unknown): number | null {
  const x = (d || {}) as Record<string, unknown>;
  const n = Number(x.fixedDurationInMinutes ?? x.variableDurationFromMinutes ?? NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Converte a resposta da Viator no formato do site, jogando fora o que não presta. */
export function normalizarProdutos(resp: { products?: Array<Record<string, unknown>>; currency?: string }, moedaPedida: string): PasseioParceiro[] {
  const lista = Array.isArray(resp.products) ? resp.products : [];
  const saida: PasseioParceiro[] = [];
  for (const p of lista) {
    const url = String(p.productUrl || '');
    if (!/^https:\/\/(www\.)?viator\.com\//.test(url)) continue;
    const titulo = String(p.title || '').trim();
    if (!titulo) continue;
    const reviews = (p.reviews || {}) as { totalReviews?: number; combinedAverageRating?: number };
    const preco = Number(((p.pricing || {}) as { summary?: { fromPrice?: number } }).summary?.fromPrice);
    const moeda = String(((p.pricing || {}) as { currency?: string }).currency || resp.currency || moedaPedida);
    saida.push({
      codigo: String(p.productCode || ''),
      titulo: titulo.slice(0, 140),
      imagem: escolherImagem(p.images),
      nota: Number.isFinite(Number(reviews.combinedAverageRating)) && Number(reviews.combinedAverageRating) > 0
        ? Math.round(Number(reviews.combinedAverageRating) * 10) / 10
        : null,
      avaliacoes: Math.max(0, Number(reviews.totalReviews) || 0),
      duracaoMin: duracaoEmMinutos(p.duration),
      precoCents: Number.isFinite(preco) && preco > 0 ? Math.round(preco * 100) : null,
      moeda,
      url,
    });
    if (saida.length >= MAX_PRODUTOS) break;
  }
  return saida;
}

const produtosMem = new Map<string, { at: number; itens: PasseioParceiro[] }>(); // chave = slug (ordem: destaque)

/** Passeios da Viator para um destino do site (até 6, os mais procurados), em reais. */
export async function passeiosViator(destino: { slug: string; name: string; lat?: number | null; lng?: number | null }): Promise<PasseioParceiro[]> {
  if (!viatorConfigurada()) return [];
  const chave = destino.slug;
  const emMem = produtosMem.get(chave);
  if (emMem && Date.now() - emMem.at < PRODUTOS_TTL_MS) return emMem.itens;

  const ref = adminDb.collection('_cache').doc(`viator_p2_${chave}`);
  try {
    const snap = await ref.get();
    const dados = snap.exists ? (snap.data() as { at?: number; itens?: PasseioParceiro[] }) : null;
    if (dados?.itens && Date.now() - Number(dados.at || 0) < PRODUTOS_TTL_MS) {
      produtosMem.set(chave, { at: Number(dados.at), itens: dados.itens });
      return dados.itens;
    }
  } catch {
    // segue buscando
  }

  const itensDestino = await destinosDoBrasil();
  const alvo = acharDestino(itensDestino, { nome: destino.name, lat: destino.lat, lng: destino.lng });
  let itens: PasseioParceiro[] = [];
  if (alvo) {
    const pedir = (moeda: string) =>
      chamarViator<{ products?: Array<Record<string, unknown>>; currency?: string }>('/products/search', {
        method: 'POST',
        body: {
          filtering: { destination: alvo.id },
          // DEFAULT = ordem "em destaque" da própria Viator (mais procurados/vendidos primeiro)
          sorting: { sort: 'DEFAULT' },
          pagination: { start: 1, count: MAX_PRODUTOS + 4 },
          currency: moeda,
        },
      }).then((r) => normalizarProdutos(r, moeda));
    try {
      itens = await pedir('BRL');
    } catch {
      itens = await pedir('USD');
    }
  }
  produtosMem.set(chave, { at: Date.now(), itens });
  if (produtosMem.size > 300) produtosMem.delete(produtosMem.keys().next().value as string);
  await ref.set({ at: Date.now(), itens }).catch(() => undefined);
  return itens;
}
