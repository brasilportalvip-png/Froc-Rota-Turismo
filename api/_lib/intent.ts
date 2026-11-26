import { Type } from '@google/genai';
import { DestinoBrasil, findDestinoBrasil } from './brasil-destinos.js';
import { adminDb } from './firebase-admin.js';
import { generateResilientJson, resolveGeminiKeySlots } from './gemini-resilience.js';

/**
 * Oportunidade personalizada: quando o visitante demonstra interesse forte num destino
 * (lê matérias, abre o guia, busca), a IA monta um convite curto, com o nome e a saudação da hora,
 * usando SÓ ofertas reais do site. Nada de escassez falsa nem desconto (o site não tem cupom).
 */

export interface IntentAction {
  type: 'destino' | 'voo' | 'concierge' | 'oferta' | 'guia';
  label: string;
  value: string;
}
export interface IntentSuggestion {
  destino: string;
  headline: string;
  message: string;
  actions: IntentAction[];
  offers: Array<{ slug: string; title: string; priceCents: number; moduleType: string }>;
}

export function saudacao(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

const FORBIDDEN = /(últimas? vagas|só restam|apenas \d+ vagas|corra|cupom|desconto|grátis|gratuito|promoção relâmpago)/i;

/** Texto padrão (sem IA) e também a régua de segurança para o texto da IA. */
export function fallbackSuggestion(d: DestinoBrasil, nome: string, hour: number, offersCount: number): { headline: string; message: string } {
  const quem = nome ? `${saudacao(hour)}, ${nome}!` : `${saudacao(hour)}!`;
  const atr = d.atrativos[0];
  return {
    headline: `${quem} ${d.nome} está chamando você`,
    message:
      offersCount > 0
        ? `Vimos que ${d.nome} entrou no seu radar${atr ? ` (${atr} é imperdível)` : ''}. Separamos ${offersCount} experiência${offersCount > 1 ? 's' : ''} de parceiros verificados e as passagens para ${d.aeroporto} em reais.`
        : `Vimos que ${d.nome} entrou no seu radar${atr ? ` (${atr} é imperdível)` : ''}. Veja como chegar, as passagens para ${d.aeroporto} em reais e peça um roteiro sob medida.`,
  };
}

export async function buildIntentSuggestion(params: {
  slug: string;
  firstName: string;
  localHour: number;
}): Promise<IntentSuggestion | null> {
  const d = findDestinoBrasil(params.slug);
  if (!d) return null;
  const hour = Number.isFinite(params.localHour) ? Math.max(0, Math.min(23, Math.floor(params.localHour))) : 12;
  const nome = params.firstName.replace(/[^\p{L}\s'-]/gu, '').slice(0, 20).trim();

  const destSnap = await adminDb.collection('destinations').get();
  const seeded = destSnap.docs
    .map((x) => x.data() as { id: number; slug: string; name: string })
    .find((x) => x.slug === d.slug || String(x.name || '').toLowerCase().startsWith(d.nome.toLowerCase()));
  let offers: IntentSuggestion['offers'] = [];
  if (seeded) {
    const l = await adminDb.collection('listings').where('destinationId', '==', seeded.id).get();
    offers = l.docs
      .map((x) => x.data())
      .filter((x) => x.status === 'active')
      .slice(0, 3)
      .map((x) => ({ slug: String(x.slug), title: String(x.title), priceCents: Number(x.priceCents), moduleType: String(x.moduleType) }));
  }

  let { headline, message } = fallbackSuggestion(d, nome, hour, offers.length);
  if (resolveGeminiKeySlots().length > 0) {
    try {
      const { data } = await generateResilientJson<{ headline: string; message: string }>({
        contents: JSON.stringify({
          saudacao: saudacao(hour),
          nomeDoVisitante: nome || null,
          destino: { nome: d.nome, estado: d.uf, resumo: d.resumo, atrativos: d.atrativos, aeroporto: d.aeroporto },
          ofertasReais: offers.map((o) => ({ titulo: o.title, precoReais: (o.priceCents / 100).toFixed(0) })),
        }),
        config: {
          systemInstruction: [
            'Você é a concierge da Froc Rota Turismo. O visitante está muito interessado no destino informado.',
            'Escreva um convite curto e caloroso em português do Brasil que desperte o desejo de viajar e leve à ação.',
            'headline: até 60 caracteres, começa com a saudação (e o nome, se houver).',
            'message: até 220 caracteres, cita 1 atrativo real do destino e o que ele encontra no site (ofertas reais, passagens em reais, roteiro sob medida).',
            'PROIBIDO: inventar preço, vaga, prazo, desconto, cupom, escassez ("últimas vagas"), urgência falsa ou depoimento. Só use as ofertas reais fornecidas.',
          ].join('\n'),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: { headline: { type: Type.STRING }, message: { type: Type.STRING } },
            required: ['headline', 'message'],
          },
        },
        timeoutMs: 8_000,
        validate: (p) => Boolean(p?.headline && p?.message),
      });
      const h = String(data.headline).trim().slice(0, 70);
      const m = String(data.message).trim().slice(0, 260);
      // Régua de honestidade: se a IA prometer escassez/desconto, fica o texto padrão.
      if (h && m && !FORBIDDEN.test(`${h} ${m}`)) {
        headline = h;
        message = m;
      }
    } catch {
      // segue com o texto padrão
    }
  }

  const actions: IntentAction[] = [];
  if (offers.length && seeded) actions.push({ type: 'destino', label: `Ver ofertas em ${d.nome}`, value: seeded.slug });
  actions.push({ type: 'voo', label: `Passagens para ${d.aeroporto}`, value: d.aeroporto });
  actions.push({ type: 'concierge', label: 'Quero um roteiro sob medida', value: d.nome });
  actions.push({ type: 'guia', label: `Guia de ${d.nome}`, value: d.slug });

  return { destino: d.slug, headline, message, actions, offers };
}
