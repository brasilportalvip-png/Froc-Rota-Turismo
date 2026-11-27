import { detectDestinos } from '../../api/_lib/brasil-destinos.ts';

/**
 * Intenção do visitante, guardada só neste aparelho (LGPD): quais destinos ele está olhando,
 * lendo ou buscando. Só funciona depois que a pessoa aceita no aviso de privacidade.
 */

const CONSENT_KEY = 'froc_consent_v1';
const INTEREST_KEY = 'froc_interest_v1';
const OFFERED_KEY = 'froc_offered_v1';
const HALF_LIFE_MS = 7 * 86400000;
export const OFFER_THRESHOLD = 4;

type InterestMap = Record<string, { score: number; at: number }>;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // navegador sem armazenamento: segue sem personalizar
  }
}

export type Consent = 'yes' | 'no' | null;
export function getConsent(): Consent {
  return read<Consent>(CONSENT_KEY, null);
}
export function setConsent(c: 'yes' | 'no') {
  write(CONSENT_KEY, c);
  try {
    window.dispatchEvent(new CustomEvent('froc-consent', { detail: c }));
  } catch {
    /* ambiente sem window */
  }
  if (c === 'no') {
    try {
      localStorage.removeItem(INTEREST_KEY);
    } catch {
      /* ok */
    }
  }
}

/** Pontuação com esquecimento: interesse de semanas atrás vale menos que o de hoje. */
export function decayed(score: number, at: number, now = Date.now()): number {
  return score * Math.pow(0.5, Math.max(0, now - at) / HALF_LIFE_MS);
}

const WEIGHTS: Record<string, number> = {
  vitrine: 1,
  'vitrine-click': 2,
  destino: 2,
  oferta: 2,
  leitura: 1.5,
  'leitura-longa': 2.5,
  busca: 2,
};

export function trackInterest(slug: string, source: keyof typeof WEIGHTS | string, now = Date.now()) {
  if (getConsent() !== 'yes' || !slug) return;
  const map = read<InterestMap>(INTEREST_KEY, {});
  const prev = map[slug];
  const base = prev ? decayed(prev.score, prev.at, now) : 0;
  map[slug] = { score: Math.round((base + (WEIGHTS[source] ?? 1)) * 100) / 100, at: now };
  write(INTEREST_KEY, map);
  try {
    window.dispatchEvent(new CustomEvent('froc-interest', { detail: { slug } }));
  } catch {
    /* ok */
  }
}

/** Lê um texto (matéria, busca, título de oferta) e registra os destinos de que ele fala. */
export function trackText(text: string, source: string) {
  for (const hit of detectDestinos(text, 2)) trackInterest(hit.destino.slug, source);
}

export function topInterest(now = Date.now()): { slug: string; score: number } | null {
  const map = read<InterestMap>(INTEREST_KEY, {});
  let best: { slug: string; score: number } | null = null;
  for (const [slug, v] of Object.entries(map)) {
    const s = decayed(v.score, v.at, now);
    if (!best || s > best.score) best = { slug, score: s };
  }
  return best;
}

/** Mostra a oportunidade de um destino no máximo 1 vez por dia (nada de pop-up insistente). */
export function canOffer(slug: string, now = Date.now()): boolean {
  const offered = read<Record<string, number>>(OFFERED_KEY, {});
  return !offered[slug] || now - offered[slug] > 86400000;
}
export function markOffered(slug: string, now = Date.now()) {
  const offered = read<Record<string, number>>(OFFERED_KEY, {});
  offered[slug] = now;
  write(OFFERED_KEY, offered);
}

/** "Bom dia", "Boa tarde" ou "Boa noite" pela hora do aparelho da pessoa. */
export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function firstName(full?: string | null): string {
  const n = String(full || '').trim().split(/\s+/)[0] || '';
  return n.length >= 2 && n.length <= 20 && !n.includes('@') ? n.charAt(0).toUpperCase() + n.slice(1) : '';
}
