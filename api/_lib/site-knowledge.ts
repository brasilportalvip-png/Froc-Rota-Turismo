import { adminDb } from './firebase-admin.js';

/**
 * O que todo agente de IA precisa saber sobre o site antes de agir.
 * Parte fixa = regras do dono (só mudam com autorização dele); parte viva = lida do banco (planos, taxas, números).
 */

export const OWNER_RULES = [
  'O site NÃO oferece plano gratuito: todo anunciante assina um plano pago com cobrança automática mensal no cartão (Mercado Pago).',
  'O site NÃO oferece cupons de desconto.',
  'Cadastro anti-fraude obrigatório: CPF verdadeiro (dígitos válidos e não usado por outra conta) + foto do documento + selfie, analisados pela IA. Caso duvidoso vai para revisão humana no Painel Admin.',
  'Sem identidade aprovada ninguém reserva nem anuncia. Login por e-mail/senha exige e-mail confirmado.',
  'Toda reserva usa o split automático do Mercado Pago: o valor cai na conta do parceiro e a comissão do plano fica com a Froc Rota.',
  'Parceiro só anuncia depois da verificação feita pela IA (documento CPF/CNPJ válido, CPF igual ao do responsável verificado, cadastro coerente).',
  'Anúncio só fica no ar com parceiro verificado + plano pago em dia + conta Mercado Pago conectada.',
  'Três painéis: Admin (dono e sub-admins), Usuário/Turista (Minha Conta) e Anunciante (Portal do Parceiro).',
  'O jornal diário (5 matérias originais) é publicado automaticamente todo dia.',
  'Agentes nunca executam pagamento, reembolso, cancelamento ou mudança de repasse sem aprovação humana.',
];

export const SITE_MAP = [
  'Página inicial: destinos nacionais, marketplace (experiências, gastronomia, hospedagem), passagens aéreas, concierge, jornal diário, chat com IA.',
  'Minha Conta (turista): reservas, favoritos, roteiros, documentos de viagem, alertas de voo, notificações, verificação de identidade.',
  'Portal do Parceiro: cadastro comercial, verificação, plano e assinatura, conexão Mercado Pago, anúncios, horários/vagas, reservas recebidas, avaliações, campanhas.',
  'Painel Admin: visão geral, parceiros, verificações de identidade, planos, regras de preço, finanças, agentes, jornal, pop-ups, auditoria.',
];

let cache: { at: number; full: string; compact: string } | null = null;
const TTL_MS = 5 * 60 * 1000;

function brl(cents: unknown): string {
  return `R$ ${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')}`;
}

export async function getSiteKnowledgeText(opts: { compact?: boolean } = {}): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return opts.compact ? cache.compact : cache.full;

  let plansText = '';
  let pricingText = '';
  let numbersText = '';
  try {
    const [plans, rules, destCount, listingCount, merchantCount] = await Promise.all([
      adminDb.collection('merchant_plans').where('active', '==', true).get(),
      adminDb.collection('pricing_rules').where('active', '==', true).get(),
      adminDb.collection('destinations').count().get(),
      adminDb.collection('listings').where('status', '==', 'active').count().get(),
      adminDb.collection('merchants').where('verificationStatus', '==', 'verified').count().get(),
    ]);
    plansText = plans.docs
      .map((d) => d.data())
      .sort((a, b) => Number(a.monthlyPriceCents) - Number(b.monthlyPriceCents))
      .map(
        (p) =>
          `- ${p.name}: ${brl(p.monthlyPriceCents)}/mês, comissão ${(Number(p.commissionBps) / 100).toFixed(0)}%, até ${p.maxListings} anúncios`
      )
      .join('\n');
    pricingText = rules.docs
      .map((d) => d.data())
      .map((r) =>
        r.markupType === 'fixed'
          ? `- ${r.name}: +${brl(r.markupFixedCents)} por item`
          : `- ${r.name}: +${(Number(r.markupBps) / 100).toFixed(0)}%`
      )
      .join('\n');
    numbersText = `Destinos: ${destCount.data().count}. Anúncios no ar: ${listingCount.data().count}. Parceiros verificados: ${merchantCount.data().count}.`;
  } catch (err) {
    console.error('site knowledge load failed:', err);
  }

  const compact = [
    'REGRAS DO DONO:',
    ...OWNER_RULES.map((r) => `- ${r}`),
    plansText ? `PLANOS:\n${plansText}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const full = [
    'Froc Rota Turismo — marketplace de turismo no Brasil (https://froc-rota-turismo.vercel.app).',
    compact,
    pricingText ? `REMUNERAÇÃO DA PLATAFORMA:\n${pricingText}` : '',
    'MAPA DO SITE:',
    ...SITE_MAP.map((s) => `- ${s}`),
    numbersText ? `NÚMEROS AGORA: ${numbersText}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  cache = { at: Date.now(), full, compact };
  return opts.compact ? compact : full;
}
