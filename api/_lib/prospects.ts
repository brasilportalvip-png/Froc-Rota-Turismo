import { Type } from '@google/genai';
import { findDestinoBrasil } from './brasil-destinos.js';
import { generateResilientJson, resolveGeminiKeySlots } from './gemini-resilience.js';
import { getSiteKnowledgeText } from './site-knowledge.js';

const CAT_LABEL: Record<string, string> = {
  barco: 'passeio de barco',
  passeio: 'passeios',
  pousada: 'hospedagem',
  casa: 'casa de temporada',
  restaurante: 'restaurante',
  guia: 'guia de turismo',
  aventura: 'turismo de aventura',
  transfer: 'transfer',
};

const FORBIDDEN = /(grátis|gratuito|cupom|desconto|últimas vagas|garantimos|milhares de clientes|\d{2,}\s?mil (visitas|clientes|turistas))/i;

/** Texto padrão do convite (também usado quando a IA não responde). */
export function fallbackInvite(businessName: string, destino: string, categoria: string): string {
  const nome = businessName || 'tudo bem';
  return [
    `Olá, ${nome}! Aqui é da Froc Rota Turismo, um site de turismo pelo Brasil.`,
    `Estamos convidando negócios de ${CAT_LABEL[categoria] || 'turismo'} em ${destino} para aparecer na nossa vitrine: página própria no Google, sugestões da nossa IA para quem pesquisa ${destino} e reserva on-line com pagamento direto na sua conta Mercado Pago.`,
    'Os planos começam em R$ 100 por mês. Posso te mandar o link para conhecer?',
    'Se preferir não receber mensagens, é só responder SAIR.',
  ].join('\n\n');
}

/** Convite escrito pela IA, verdadeiro e curto, para a equipe enviar manualmente. */
export async function buildPartnerInvite(p: { businessName: string; destinoSlug: string; categoria: string }): Promise<string> {
  const d = findDestinoBrasil(p.destinoSlug);
  const destino = d?.nome || 'sua cidade';
  const base = fallbackInvite(p.businessName, destino, p.categoria);
  if (resolveGeminiKeySlots().length === 0) return base;
  try {
    const knowledge = await getSiteKnowledgeText({ compact: true });
    const { data } = await generateResilientJson<{ mensagem: string }>({
      contents: JSON.stringify({
        negocio: p.businessName,
        tipo: CAT_LABEL[p.categoria] || p.categoria,
        destino,
        atrativosDoDestino: d?.atrativos.slice(0, 4) ?? [],
        modelo: base,
      }),
      config: {
        systemInstruction: `Você escreve convites de WhatsApp da Froc Rota Turismo para negócios de turismo anunciarem no site.
Tom: cordial, direto, brasileiro, sem exagero. Até 650 caracteres, 3 ou 4 parágrafos curtos.
Personalize com o nome do negócio, o tipo e o destino. Diga o benefício real (vitrine, página no Google, IA que sugere ofertas a quem pesquisa o destino, pagamento direto no Mercado Pago com divisão automática).
Termine com uma pergunta simples e com a frase: "Se preferir não receber mensagens, é só responder SAIR."
PROIBIDO: inventar números de visitas/clientes, prometer resultado, oferecer desconto, cupom ou plano grátis (não existem).
Regras do site:\n${knowledge}`,
        responseMimeType: 'application/json',
        responseSchema: { type: Type.OBJECT, properties: { mensagem: { type: Type.STRING } }, required: ['mensagem'] },
      },
      timeoutMs: 12_000,
      validate: (x) => typeof x?.mensagem === 'string' && x.mensagem.length > 80,
    });
    const msg = data.mensagem.trim().slice(0, 900);
    if (FORBIDDEN.test(msg) || !/SAIR/.test(msg)) return base;
    return msg;
  } catch {
    return base;
  }
}
