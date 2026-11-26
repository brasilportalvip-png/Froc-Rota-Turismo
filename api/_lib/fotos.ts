/**
 * Fotos REAIS dos lugares, do Wikimedia Commons (acervo livre: só fotos com licença livre ou domínio público).
 * - Nada de imagem gerada por IA, emoji ou desenho.
 * - Cada foto vem com autor e licença: o site mostra o crédito (exigido pela licença CC BY/BY-SA).
 * - Resultado fica guardado no Firestore (photo_cache) por 30 dias; o Admin pode trocar a foto de um destino
 *   (photo_overrides) colando o nome do arquivo do Commons.
 */
import { adminDb } from './firebase-admin.js';
import { DESTINOS_BRASIL, UF_NOME, findDestinoBrasil } from './brasil-destinos.js';

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'FrocRotaTurismo/1.0 (https://froc-rota-turismo.vercel.app; fotos de destinos turisticos)';
const TTL_MS = 30 * 86400000;

export interface FotoReal {
  title: string; // File:...
  url1280: string;
  url500: string;
  pageUrl: string;
  author: string;
  license: string;
  width: number;
  height: number;
}

export interface FotoCarrossel extends FotoReal {
  label: string;
  local: string;
  slug: string | null;
}

/** Fotos escolhidas a dedo (muitas são "Featured pictures" do Commons). Se alguma sumir, a busca encontra outra do mesmo lugar. */
export const CARROSSEL: { top: Array<{ file: string; label: string; local: string; slug: string | null; busca: string }>; bottom: Array<{ file: string; label: string; local: string; slug: string | null; busca: string }> } = {
  top: [
    { file: 'Christ the Redeemer - Cristo Redentor.jpg', label: 'Cristo Redentor', local: 'Rio de Janeiro · RJ', slug: 'rio-de-janeiro', busca: 'Cristo Redentor Corcovado' },
    { file: 'Sweet Bread Mountain.jpg', label: 'Pão de Açúcar', local: 'Rio de Janeiro · RJ', slug: 'rio-de-janeiro', busca: 'Pão de Açúcar Rio de Janeiro' },
    { file: 'Top Down View of Copacabana Mosaic and Palm Trees 3.jpg', label: 'Copacabana', local: 'Rio de Janeiro · RJ', slug: 'rio-de-janeiro', busca: 'Praia de Copacabana' },
    { file: 'Iguazu Falls Cataratas Brazil Side Luca Galuzzi 2005.jpg', label: 'Cataratas do Iguaçu', local: 'Foz do Iguaçu · PR', slug: 'foz-do-iguacu', busca: 'Cataratas do Iguaçu Brasil' },
    { file: 'Os lencois.jpg', label: 'Lençóis Maranhenses', local: 'Barreirinhas · MA', slug: 'lencois-maranhenses', busca: 'Lençóis Maranhenses dunas' },
    { file: 'Fernando de Noronha Conceicao Beach.jpg', label: 'Fernando de Noronha', local: 'Pernambuco', slug: 'fernando-de-noronha', busca: 'Fernando de Noronha praia' },
    { file: 'Centro Histórico de Salvador Bahia Largo do Pelourinho 2019-6501.jpg', label: 'Pelourinho', local: 'Salvador · BA', slug: 'salvador', busca: 'Pelourinho Salvador' },
    { file: 'Teatro amazonas.jpg', label: 'Teatro Amazonas', local: 'Manaus · AM', slug: 'manaus', busca: 'Teatro Amazonas Manaus' },
  ],
  bottom: [
    { file: 'Brazilian National Congress.jpg', label: 'Congresso Nacional', local: 'Brasília · DF', slug: 'brasilia', busca: 'Congresso Nacional Brasília' },
    { file: 'Morrão, no Parque Nacional da Chapada Diamantina - Bahia crop 2.jpg', label: 'Chapada Diamantina', local: 'Bahia', slug: 'chapada-diamantina', busca: 'Chapada Diamantina' },
    { file: 'Ouro Preto November 2009-7.jpg', label: 'Ouro Preto', local: 'Minas Gerais', slug: 'ouro-preto', busca: 'Ouro Preto Praça Tiradentes' },
    { file: 'Parque Nac dos Lençois Maranhenses Vania Passos 16.png', label: 'Lagoas dos Lençóis', local: 'Maranhão', slug: 'lencois-maranhenses', busca: 'Lençóis Maranhenses lagoa' },
    { file: 'Teatro Municipal de São Paulo 8.jpg', label: 'Theatro Municipal', local: 'São Paulo · SP', slug: 'sao-paulo', busca: 'Theatro Municipal São Paulo' },
    { file: 'Catedral1 Rodrigo Marfan.jpg', label: 'Catedral de Brasília', local: 'Brasília · DF', slug: 'brasilia', busca: 'Catedral de Brasília' },
    { file: 'Rio de Janeiro - Cristo Redentor 01.jpg', label: 'Corcovado', local: 'Rio de Janeiro · RJ', slug: 'rio-de-janeiro', busca: 'Corcovado Rio de Janeiro' },
    { file: 'Igreja de São Francisco de Assis (Ouro Preto, MG) por Rodrigo Tetsuo Argenton.jpg', label: 'Igreja de São Francisco', local: 'Ouro Preto · MG', slug: 'ouro-preto', busca: 'Igreja São Francisco de Assis Ouro Preto' },
  ],
};

// Nunca: mapas, bandeiras, brasões, logos, desenhos, pinturas e fotos antigas de acervo.
const RUIM =
  /(\bmapa?\b|\bmap\b|locator|location|flag|bandeira|bras[aã]o|coat[ _]of[ _]arms|logo|diagram|esquema|\bselo\b|stamp|escudo|\bseal\b|planta|gr[aá]fico|chart|acervo|arquivo nacional|moreira salles|postal|postcard|rugendas|debret|pintura|painting|gravura|drawing|desenho|ilustra|\.svg|\.tif|\.gif|\.pdf|screenshot|captura|sat[eé]lite|satellite)/i;

const RUIM_CAT =
  /(\bmaps?\b|mapas|locator maps|flags of|bandeiras|coats of arms|bras[oõ]es|logos|paintings|pinturas|drawings|desenhos|postcards|cart[oõ]es postais|acervo|moreira salles|engravings|gravuras|illustrations)/i;

const mem = new Map<string, { at: number; foto: FotoReal | null }>();
const overridesMem = new Map<string, { at: number; foto: FotoReal | null }>();

function stripHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

interface CommonsPage {
  title?: string;
  missing?: boolean;
  imageinfo?: Array<{
    url?: string;
    thumburl?: string;
    descriptionurl?: string;
    width?: number;
    height?: number;
    mime?: string;
    extmetadata?: Record<string, { value?: unknown }>;
  }>;
}

function toFoto(p: CommonsPage): FotoReal | null {
  const ii = p.imageinfo?.[0];
  if (!p.title || !ii?.url) return null;
  const thumb = ii.thumburl || ii.url;
  const url500 = /\/\d+px-/.test(thumb) ? thumb.replace(/\/\d+px-/, '/500px-') : thumb;
  const meta = ii.extmetadata || {};
  return {
    title: p.title,
    url1280: thumb,
    url500,
    pageUrl: ii.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
    author: stripHtml(meta.Artist?.value) || 'Autor no Wikimedia Commons',
    license: stripHtml(meta.LicenseShortName?.value) || 'Licença livre',
    width: Number(ii.width || 0),
    height: Number(ii.height || 0),
  };
}

/** null = o Commons não respondeu (não guardar como "sem foto"). */
async function commons(params: Record<string, string>): Promise<CommonsPage[] | null> {
  const qs = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1280',
    iiextmetadatafilter: 'Artist|LicenseShortName|Categories',
    origin: '*',
    ...params,
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${API}?${qs.toString()}`, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: ctrl.signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { query?: { pages?: CommonsPage[] } };
    return j.query?.pages ?? [];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Foto de um arquivo exato do Commons ("File:..."). */
export async function fotoPorArquivo(file: string): Promise<FotoReal | null> {
  const title = file.startsWith('File:') ? file : `File:${file}`;
  const pages = await commons({ titles: title });
  const p = (pages ?? []).find((x) => !x.missing);
  return p ? toFoto(p) : null;
}

/** Nota de qualidade de um resultado da busca (maior = melhor). Exportada para os testes. */
export function notaFoto(p: CommonsPage, palavras: string[]): number {
  const ii = p.imageinfo?.[0];
  const title = String(p.title || '');
  if (!ii || RUIM.test(title)) return -1;
  const mime = String(ii.mime || '');
  if (!/jpeg|png|webp/.test(mime)) return -1;
  const w = Number(ii.width || 0);
  const h = Number(ii.height || 0);
  if (w < 1280 || h < 700) return -1;
  const cats = String(ii.extmetadata?.Categories?.value || '');
  if (RUIM_CAT.test(cats)) return -1;
  let nota = 1;
  if (/Featured pictures/i.test(cats)) nota += 6;
  if (/Quality images/i.test(cats)) nota += 4;
  if (/Valued images/i.test(cats)) nota += 2;
  if (/jpeg/.test(mime)) nota += 1;
  const ratio = w / Math.max(1, h);
  if (ratio >= 1.2 && ratio <= 1.9) nota += 2;
  if (w >= 2400) nota += 1;
  const t = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const pal of palavras) if (pal.length > 3 && t.includes(pal)) nota += 1.5;
  return nota;
}

function palavrasDe(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((x) => x.length > 3);
}

/** Procura a melhor foto real de um lugar no Commons. */
export async function buscarFoto(consultas: string[]): Promise<FotoReal | null | undefined> {
  let melhor: { nota: number; page: CommonsPage } | null = null;
  let respondeu = false;
  for (const q of consultas) {
    const pages = await commons({
      generator: 'search',
      gsrnamespace: '6',
      gsrsearch: `${q} filetype:bitmap`,
      gsrlimit: '20',
    });
    if (pages === null) continue; // falha de rede: tenta a próxima consulta
    respondeu = true;
    const palavras = palavrasDe(q);
    for (const p of pages) {
      const nota = notaFoto(p, palavras);
      if (nota > 0 && (!melhor || nota > melhor.nota)) melhor = { nota, page: p };
    }
    if (melhor && melhor.nota >= 8) break; // já achou foto de destaque
  }
  if (melhor) return toFoto(melhor.page);
  // undefined = o Commons não respondeu (tentar de novo depois); null = respondeu e não há foto boa
  return respondeu ? null : undefined;
}

async function lerCache(key: string): Promise<FotoReal | null | undefined> {
  const m = mem.get(key);
  if (m && Date.now() - m.at < TTL_MS) return m.foto;
  try {
    const snap = await adminDb.collection('photo_cache').doc(key).get();
    if (snap.exists) {
      const d = snap.data() as { foto?: FotoReal | null; savedAt?: string };
      if (d.savedAt && Date.now() - Date.parse(d.savedAt) < TTL_MS && d.foto?.url1280) {
        mem.set(key, { at: Date.parse(d.savedAt), foto: d.foto });
        return d.foto;
      }
    }
  } catch {
    // cache é só otimização
  }
  return undefined;
}

async function gravarCache(key: string, foto: FotoReal | null | undefined) {
  if (foto === undefined) return; // falha temporária: não guarda nada
  // "Sem foto" vale só 6 horas (TTL de 30 dias - 6h = guarda como se tivesse sido salvo há quase 30 dias)
  mem.set(key, { at: foto ? Date.now() : Date.now() - TTL_MS + 6 * 3600000, foto });
  if (mem.size > 800) mem.delete(mem.keys().next().value as string);
  if (!foto) return;
  try {
    await adminDb.collection('photo_cache').doc(key).set({ foto, savedAt: new Date().toISOString() });
  } catch {
    // sem problema
  }
}

const keyOf = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 120) || 'x';

/** Foto real de um destino (slug da Vitrine do Brasil ou do catálogo). */
export async function fotoDoDestino(slugOuNome: string): Promise<FotoReal | null> {
  const slug = keyOf(slugOuNome);
  // 1) troca manual feita pelo Admin (lida no banco no máximo a cada 10 minutos por slug)
  const ovMem = overridesMem.get(slug);
  if (ovMem && Date.now() - ovMem.at < 600000) {
    if (ovMem.foto) return ovMem.foto;
  } else {
    try {
      const ov = await adminDb.collection('photo_overrides').doc(slug).get();
      const f = ov.exists ? ((ov.data() as { foto?: FotoReal }).foto ?? null) : null;
      overridesMem.set(slug, { at: Date.now(), foto: f?.url1280 ? f : null });
      if (f?.url1280) return f;
    } catch {
      // segue
    }
  }
  const key = `dest-${slug}`;
  const cached = await lerCache(key);
  if (cached !== undefined) return cached;

  const d = findDestinoBrasil(slug);
  const nome = d?.nome ?? slugOuNome.replace(/-/g, ' ');
  const estado = d ? UF_NOME[d.uf] ?? d.uf : 'Brasil';
  const consultas = d
    ? [`${d.atrativos[0]} ${d.nome}`, `${d.nome} ${estado}`, `${d.nome} Brasil`]
    : [`${nome} Brasil`];
  const foto = await buscarFoto(consultas);
  await gravarCache(key, foto);
  return foto ?? null;
}

/** Fotos dos dois carrosséis do topo. */
export async function fotosDoCarrossel(): Promise<{ top: FotoCarrossel[]; bottom: FotoCarrossel[] }> {
  const montar = async (lista: (typeof CARROSSEL)['top']) => {
    const out: FotoCarrossel[] = [];
    const res = await Promise.all(
      lista.map(async (item) => {
        const key = `car-${keyOf(item.file)}`;
        let foto = await lerCache(key);
        if (foto === undefined) {
          const achada = (await fotoPorArquivo(item.file)) ?? (await buscarFoto([item.busca]));
          await gravarCache(key, achada);
          foto = achada ?? null;
        }
        return foto ? { ...foto, label: item.label, local: item.local, slug: item.slug } : null;
      })
    );
    for (const r of res) if (r) out.push(r);
    return out;
  };
  const [top, bottom] = await Promise.all([montar(CARROSSEL.top), montar(CARROSSEL.bottom)]);
  return { top, bottom };
}

/** Fotos de vários destinos de uma vez (Vitrine do Brasil), com no máximo 6 buscas ao mesmo tempo. */
export async function fotosDosDestinos(slugs: string[], prazoMs = 40000): Promise<Record<string, FotoReal | null>> {
  const out: Record<string, FotoReal | null> = {};
  const limite = Date.now() + prazoMs;
  let i = 0;
  const worker = async () => {
    // Para de começar buscas novas perto do limite de tempo da função (o que faltar vem na próxima visita).
    while (i < slugs.length && Date.now() < limite) {
      const s = slugs[i++];
      out[s] = await fotoDoDestino(s).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, slugs.length) }, worker));
  return out;
}

/** Admin troca a foto de um destino colando o nome do arquivo (ou o link) do Commons. */
export async function definirFotoDoDestino(slug: string, arquivoOuLink: string): Promise<FotoReal | null> {
  let file = String(arquivoOuLink || '').trim();
  const m = file.match(/wiki\/(File:[^?#]+)/i) || file.match(/\/(?:\d+px-)?([^/]+\.(?:jpe?g|png|webp))(?:$|\?)/i);
  if (m) file = decodeURIComponent(m[1]).replace(/_/g, ' ');
  const foto = await fotoPorArquivo(file);
  if (!foto) return null;
  await adminDb.collection('photo_overrides').doc(keyOf(slug)).set({ foto, updatedAt: new Date().toISOString() });
  mem.delete(`dest-${keyOf(slug)}`);
  overridesMem.set(keyOf(slug), { at: Date.now(), foto });
  return foto;
}

/** Imagem que não é foto real (gerada, arte da marca ou vazia) → precisa trocar por foto do lugar. */
export function precisaFotoReal(url: unknown): boolean {
  const u = String(url ?? '');
  return !u || u.startsWith('/src/assets/images/') || u.startsWith('/og-froc-rota') || u.startsWith('/logo');
}

export const TODOS_OS_SLUGS = DESTINOS_BRASIL.map((d) => d.slug);

export interface CreditoFoto {
  author: string;
  license: string;
  pageUrl: string;
}

const credito = (f: FotoReal): CreditoFoto => ({ author: f.author, license: f.license, pageUrl: f.pageUrl });

/**
 * Troca imagem gerada/arte da marca por FOTO REAL do destino (e junta o crédito do fotógrafo).
 * Fotos já reais (do parceiro ou do Commons) ficam como estão.
 */
export async function trocarPorFotosReais<T extends Record<string, unknown>>(
  items: T[],
  slugOf: (x: T) => string | null | undefined,
  field = 'coverImage',
  tempoMaxMs = 9000
): Promise<Array<T & { fotoCredito?: CreditoFoto | null }>> {
  const precisa = items.filter((x) => precisaFotoReal(x[field]));
  const slugs = [...new Set(precisa.map((x) => slugOf(x)).filter((s): s is string => Boolean(s)))];
  let fotos: Record<string, FotoReal | null> = {};
  if (slugs.length) {
    fotos = await Promise.race([
      fotosDosDestinos(slugs, Math.max(2000, tempoMaxMs - 1000)),
      new Promise<Record<string, FotoReal | null>>((r) => setTimeout(() => r({}), tempoMaxMs)),
    ]);
  }
  return items.map((x) => {
    if (!precisaFotoReal(x[field])) return x;
    const s = slugOf(x);
    const f = s ? fotos[s] : null;
    if (f) return { ...x, [field]: f.url1280, fotoCredito: credito(f) };
    return { ...x, [field]: s ? `/api/foto?d=${encodeURIComponent(s)}&w=1280` : x[field], fotoCredito: null };
  });
}

/** Imagens geradas antigas (/src/assets/images/...) → foto real do mesmo destino. */
export function assetParaFotoReal(url: string): string {
  const u = String(url || '');
  if (!u.startsWith('/src/assets/images/')) return u;
  const slug = /noronha/.test(u)
    ? 'fernando-de-noronha'
    : /rio_/.test(u)
    ? 'rio-de-janeiro'
    : /lencois/.test(u)
    ? 'lencois-maranhenses'
    : /chapada/.test(u)
    ? 'chapada-dos-veadeiros'
    : /paraty/.test(u)
    ? 'paraty'
    : 'rio-de-janeiro';
  return `/api/foto?d=${slug}&w=1280`;
}
