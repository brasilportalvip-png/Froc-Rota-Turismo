/**
 * Identificação oficial da empresa responsável pelo site (Decreto 7.962/2013, CDC e LGPD).
 * Dados públicos do CNPJ na Receita Federal. O e-mail de contato pode ser trocado por CONTACT_EMAIL na Vercel.
 */
import { ADMIN_BOOTSTRAP_EMAIL } from './auth.js';

export const EMPRESA = {
  nomeFantasia: 'Froc Rota Turismo',
  razaoSocial: '43.330.322 ANA LUCIA LAURINDO',
  cnpj: '43.330.322/0001-01',
  natureza: 'Microempreendedor Individual (MEI)',
  atividade: 'Agência de viagens (CNAE 7911-2/00)',
  endereco: 'Avenida Arid Nasser, 260 - Parque das Hortências',
  cidade: 'Araraquara',
  uf: 'SP',
  cep: '14808-530',
  responsavel: 'Ana Lucia Laurindo',
} as const;

/** Número do Cadastur (Ministério do Turismo), quando aprovado: CADASTUR_NUMERO na Vercel. */
export function numeroCadastur(): string | null {
  const n = (process.env.CADASTUR_NUMERO || '').replace(/[^\dA-Za-z./-]/g, '').slice(0, 40);
  return n || null;
}

/** E-mail oficial de atendimento, privacidade (encarregado de dados) e SAC. */
export function emailContato(): string {
  const e = (process.env.CONTACT_EMAIL || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : ADMIN_BOOTSTRAP_EMAIL;
}

export function enderecoCompleto(): string {
  return `${EMPRESA.endereco}, ${EMPRESA.cidade}/${EMPRESA.uf}, CEP ${EMPRESA.cep}`;
}
