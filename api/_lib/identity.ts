import crypto from 'node:crypto';
import { Type } from '@google/genai';
import { adminDb } from './firebase-admin.js';
import { generateResilientJson, resolveGeminiKeySlots } from './gemini-resilience.js';

/**
 * Verificação de identidade (anti-fraude) do Froc Rota.
 *
 * Regra do dono: cadastro só vale com CPF verdadeiro e foto. Sem serviço pago de consulta à
 * Receita, a verificação é: CPF com dígitos válidos + CPF ainda não usado por outra conta +
 * foto do documento e selfie analisadas pela IA (nome, CPF e rosto conferem).
 * Na dúvida, vai para revisão humana no Painel Admin — a IA nunca aprova sozinha um caso duvidoso.
 */

export type IdentityStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'manual_review';

export interface IdentityCheckDoc {
  uid: string;
  userId: number;
  email: string;
  status: IdentityStatus;
  fullName: string;
  cpfMasked: string;
  cpfHash: string;
  birthDate: string;
  hasDocumentImage: boolean;
  hasSelfieImage: boolean;
  aiResult: IdentityAiResult | null;
  reason: string | null;
  reviewedByEmail: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  updatedAt: string;
}

export interface IdentityAiResult {
  documentoLegivel: boolean;
  tipoDocumento: string;
  nomeNoDocumento: string;
  cpfNoDocumento: string;
  nomeConfere: boolean;
  cpfConfere: boolean;
  rostoConfere: boolean;
  selfieDePessoaReal: boolean;
  sinaisDeFraude: string[];
  confianca: number;
  observacao: string;
}

export const MAX_IMAGE_BASE64_CHARS = 700_000; // ~500 KB de imagem; o navegador já comprime antes de enviar

export function normalizeCpf(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

/** CPF com 11 dígitos e dígitos verificadores corretos (rejeita sequências como 111.111.111-11). */
export function isValidCpf(value: unknown): boolean {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/** CNPJ com 14 dígitos e dígitos verificadores corretos. */
export function isValidCnpj(value: unknown): boolean {
  const cnpj = String(value ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cnpj[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

export function maskCpf(value: unknown): string {
  const cpf = normalizeCpf(value);
  return cpf.length === 11 ? `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**` : '***';
}

/** Identificador do CPF sem guardar o número aberto no índice de unicidade. */
export function cpfHash(value: unknown): string {
  const pepper = process.env.IDENTITY_HASH_SECRET || 'froc-rota-cpf-index-v1';
  return crypto.createHmac('sha256', pepper).update(normalizeCpf(value)).digest('hex');
}

/** Aceita "data:image/jpeg;base64,..." ou o base64 puro; devolve { mimeType, data } ou null. */
export function parseImageDataUrl(value: unknown): { mimeType: string; data: string } | null {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  if (match[2].length > MAX_IMAGE_BASE64_CHARS || match[2].length < 2_000) return null;
  return { mimeType: match[1] === 'image/jpg' ? 'image/jpeg' : match[1], data: match[2] };
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function namesMatch(a: string, b: string): boolean {
  const x = normalizeName(a).split(' ').filter((p) => p.length > 2);
  const y = new Set(normalizeName(b).split(' ').filter((p) => p.length > 2));
  if (x.length === 0 || y.size === 0) return false;
  const common = x.filter((p) => y.has(p)).length;
  return common >= Math.min(2, x.length);
}

/**
 * Decisão a partir do resultado da IA. Aprova só quando tudo confere com alta confiança;
 * reprova só fraude evidente; o resto vai para revisão humana.
 */
export function decideIdentity(params: {
  ai: IdentityAiResult | null;
  typedName: string;
  typedCpf: string;
}): { status: IdentityStatus; reason: string } {
  const { ai } = params;
  if (!ai) return { status: 'manual_review', reason: 'A IA não pôde analisar as fotos agora; revisão humana.' };

  const cpfOnDoc = normalizeCpf(ai.cpfNoDocumento);
  const cpfMatches = ai.cpfConfere && (cpfOnDoc.length !== 11 || cpfOnDoc === normalizeCpf(params.typedCpf));
  const nameMatches = ai.nomeConfere && (!ai.nomeNoDocumento || namesMatch(params.typedName, ai.nomeNoDocumento));
  const fraud = Array.isArray(ai.sinaisDeFraude) ? ai.sinaisDeFraude.filter(Boolean) : [];

  if (ai.documentoLegivel && !ai.selfieDePessoaReal && ai.confianca >= 0.85) {
    return { status: 'rejected', reason: 'A selfie não é de uma pessoa real (foto de tela, impressão ou imagem gerada).' };
  }
  if (ai.documentoLegivel && cpfOnDoc.length === 11 && cpfOnDoc !== normalizeCpf(params.typedCpf) && ai.confianca >= 0.85) {
    return { status: 'rejected', reason: 'O CPF do documento é diferente do CPF informado.' };
  }
  if (
    ai.documentoLegivel &&
    cpfMatches &&
    nameMatches &&
    ai.rostoConfere &&
    ai.selfieDePessoaReal &&
    fraud.length === 0 &&
    ai.confianca >= 0.8
  ) {
    return { status: 'approved', reason: 'Documento, CPF, nome e rosto conferem.' };
  }
  const motivos: string[] = [];
  if (!ai.documentoLegivel) motivos.push('documento ilegível');
  if (!cpfMatches) motivos.push('CPF não confirmado no documento');
  if (!nameMatches) motivos.push('nome não confere');
  if (!ai.rostoConfere) motivos.push('rosto não confere com o documento');
  if (fraud.length) motivos.push(`sinais: ${fraud.slice(0, 3).join(', ')}`);
  if (ai.confianca < 0.8) motivos.push('baixa confiança da análise');
  return { status: 'manual_review', reason: `Revisão humana: ${motivos.join('; ') || 'análise inconclusiva'}.` };
}

const IDENTITY_SYSTEM = `Você é o analista antifraude de cadastro da Froc Rota Turismo (marketplace de turismo no Brasil).
Recebe: nome completo e CPF digitados, a FOTO DE UM DOCUMENTO (RG, CNH ou outro documento oficial brasileiro com foto) e uma SELFIE.
Responda SOMENTE com o JSON pedido. Regras:
- documentoLegivel: true só se for um documento oficial brasileiro com foto e os dados forem legíveis.
- nomeNoDocumento e cpfNoDocumento: transcreva exatamente o que está no documento ("" se não aparecer).
- nomeConfere / cpfConfere: o nome/CPF digitado é o mesmo do documento.
- rostoConfere: o rosto da selfie é a mesma pessoa da foto do documento.
- selfieDePessoaReal: false se a selfie for foto de tela, foto impressa, máscara, desenho ou imagem gerada.
- sinaisDeFraude: lista curta de sinais concretos (edição, montagem, documento de outra pessoa, etc.). Vazia se não houver.
- confianca: 0 a 1.
Nunca invente dados que não estão nas imagens.`;

export async function analyzeIdentityWithAI(params: {
  fullName: string;
  cpf: string;
  birthDate: string;
  documentImage: { mimeType: string; data: string };
  selfieImage: { mimeType: string; data: string };
}): Promise<IdentityAiResult | null> {
  if (resolveGeminiKeySlots().length === 0) return null;
  try {
    const { data } = await generateResilientJson<IdentityAiResult>({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: JSON.stringify({
                nomeDigitado: params.fullName,
                cpfDigitado: normalizeCpf(params.cpf),
                dataNascimentoDigitada: params.birthDate,
                imagem1: 'FOTO DO DOCUMENTO',
                imagem2: 'SELFIE',
              }),
            },
            { inlineData: params.documentImage },
            { inlineData: params.selfieImage },
          ],
        },
      ],
      config: {
        systemInstruction: IDENTITY_SYSTEM,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            documentoLegivel: { type: Type.BOOLEAN },
            tipoDocumento: { type: Type.STRING },
            nomeNoDocumento: { type: Type.STRING },
            cpfNoDocumento: { type: Type.STRING },
            nomeConfere: { type: Type.BOOLEAN },
            cpfConfere: { type: Type.BOOLEAN },
            rostoConfere: { type: Type.BOOLEAN },
            selfieDePessoaReal: { type: Type.BOOLEAN },
            sinaisDeFraude: { type: Type.ARRAY, items: { type: Type.STRING } },
            confianca: { type: Type.NUMBER },
            observacao: { type: Type.STRING },
          },
          required: [
            'documentoLegivel',
            'nomeConfere',
            'cpfConfere',
            'rostoConfere',
            'selfieDePessoaReal',
            'sinaisDeFraude',
            'confianca',
          ],
        },
      },
      timeoutMs: 22_000,
      deadlineMs: 26_000, // a função tem 60 s: nunca deixar o cliente esperando além disso
      validate: (p) => Boolean(p && typeof p.confianca === 'number'),
    });
    return {
      documentoLegivel: Boolean(data.documentoLegivel),
      tipoDocumento: String(data.tipoDocumento || ''),
      nomeNoDocumento: String(data.nomeNoDocumento || ''),
      cpfNoDocumento: String(data.cpfNoDocumento || ''),
      nomeConfere: Boolean(data.nomeConfere),
      cpfConfere: Boolean(data.cpfConfere),
      rostoConfere: Boolean(data.rostoConfere),
      selfieDePessoaReal: Boolean(data.selfieDePessoaReal),
      sinaisDeFraude: Array.isArray(data.sinaisDeFraude) ? data.sinaisDeFraude.map(String).slice(0, 8) : [],
      confianca: Math.max(0, Math.min(1, Number(data.confianca) || 0)),
      observacao: String(data.observacao || '').slice(0, 400),
    };
  } catch (err) {
    console.error('Identity AI analysis failed:', err);
    return null;
  }
}

export async function getIdentityCheck(uid: string): Promise<IdentityCheckDoc | null> {
  const snap = await adminDb.collection('identity_checks').doc(uid).get();
  return snap.exists ? (snap.data() as IdentityCheckDoc) : null;
}

/** Situação pública (sem dados sensíveis) para o navegador. */
export function publicIdentityStatus(check: IdentityCheckDoc | null) {
  return {
    status: (check?.status ?? 'none') as IdentityStatus,
    reason: check?.status === 'approved' ? null : check?.reason ?? null,
    cpfMasked: check?.cpfMasked ?? null,
    hasDocumentImage: Boolean(check?.hasDocumentImage),
    hasSelfieImage: Boolean(check?.hasSelfieImage),
    decidedAt: check?.decidedAt ?? null,
  };
}

/** Admin e sub-admin não precisam; todos os outros só reservam/anunciam com identidade aprovada. */
export async function isIdentityApproved(uid: string, role?: string): Promise<boolean> {
  if (role === 'admin' || role === 'subadmin') return true;
  const check = await getIdentityCheck(uid);
  return check?.status === 'approved';
}
