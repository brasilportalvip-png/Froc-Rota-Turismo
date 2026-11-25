import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { isAuthorizedCron } from '../api/cron.ts';
import {
  decideIdentity,
  isValidCnpj,
  isValidCpf,
  maskCpf,
  namesMatch,
  parseImageDataUrl,
} from '../api/_lib/identity.ts';
import { decideMerchant, isPlanActive, merchantBlockers } from '../api/_lib/merchant-status.ts';
import { extendExpiry, sellerTokenNeedsRefresh } from '../api/_lib/mp-marketplace.ts';
import { cpfHash } from '../api/_lib/identity.ts';

const okAi = {
  documentoLegivel: true,
  tipoDocumento: 'CNH',
  nomeNoDocumento: 'MARIA DA SILVA SOUZA',
  cpfNoDocumento: '529.982.247-25',
  nomeConfere: true,
  cpfConfere: true,
  rostoConfere: true,
  selfieDePessoaReal: true,
  sinaisDeFraude: [] as string[],
  confianca: 0.93,
  observacao: '',
};

test('CPF: aceita CPF verdadeiro, recusa dígito errado e sequência repetida', () => {
  assert.equal(isValidCpf('529.982.247-25'), true);
  assert.equal(isValidCpf('52998224725'), true);
  assert.equal(isValidCpf('529.982.247-24'), false);
  assert.equal(isValidCpf('111.111.111-11'), false);
  assert.equal(isValidCpf('123'), false);
  assert.equal(maskCpf('52998224725'), '***.982.247-**');
});

test('CNPJ: aceita CNPJ verdadeiro e recusa inválido', () => {
  assert.equal(isValidCnpj('11.222.333/0001-81'), true);
  assert.equal(isValidCnpj('11.222.333/0001-80'), false);
  assert.equal(isValidCnpj('00000000000000'), false);
});

test('foto: só aceita imagem JPG/PNG/WEBP em base64 de tamanho razoável', () => {
  const big = 'A'.repeat(3000);
  assert.ok(parseImageDataUrl(`data:image/jpeg;base64,${big}`));
  assert.equal(parseImageDataUrl(`data:text/html;base64,${big}`), null);
  assert.equal(parseImageDataUrl('data:image/jpeg;base64,AAAA'), null); // pequena demais
  assert.equal(parseImageDataUrl(`data:image/png;base64,${'A'.repeat(800_000)}`), null); // grande demais
});

test('nome: confere com acentos e ordem, recusa nome diferente', () => {
  assert.equal(namesMatch('Maria da Silva Souza', 'MARIA DA SILVA SOUZA'), true);
  assert.equal(namesMatch('Mária Sílva', 'MARIA SILVA'), true);
  assert.equal(namesMatch('João Pereira', 'MARIA DA SILVA SOUZA'), false);
});

test('identidade: IA aprova só quando tudo confere com confiança alta', () => {
  const r = decideIdentity({ ai: okAi, typedName: 'Maria da Silva Souza', typedCpf: '52998224725' });
  assert.equal(r.status, 'approved');
});

test('identidade: sem IA, ou com dúvida, vai para revisão humana (nunca aprova sozinha)', () => {
  assert.equal(decideIdentity({ ai: null, typedName: 'Maria Silva', typedCpf: '52998224725' }).status, 'manual_review');
  assert.equal(
    decideIdentity({ ai: { ...okAi, confianca: 0.6 }, typedName: 'Maria da Silva Souza', typedCpf: '52998224725' }).status,
    'manual_review'
  );
  assert.equal(
    decideIdentity({ ai: { ...okAi, rostoConfere: false }, typedName: 'Maria da Silva Souza', typedCpf: '52998224725' }).status,
    'manual_review'
  );
  assert.equal(
    decideIdentity({ ai: { ...okAi, sinaisDeFraude: ['montagem'] }, typedName: 'Maria da Silva Souza', typedCpf: '52998224725' }).status,
    'manual_review'
  );
});

test('identidade: reprova CPF diferente do documento e selfie falsa', () => {
  assert.equal(
    decideIdentity({ ai: okAi, typedName: 'Maria da Silva Souza', typedCpf: '11144477735' }).status,
    'rejected'
  );
  assert.equal(
    decideIdentity({ ai: { ...okAi, selfieDePessoaReal: false, confianca: 0.9 }, typedName: 'Maria da Silva Souza', typedCpf: '52998224725' }).status,
    'rejected'
  );
});

test('parceiro: IA aprova cadastro coerente com CPF igual ao do responsável', () => {
  const r = decideMerchant({
    documentNumber: '529.982.247-25',
    identityApproved: true,
    identityCpfHash: cpfHash('52998224725'),
    isHighRisk: false,
    hasCadastur: false,
    ai: { aprovar: true, risco: 'baixo', motivos: [] },
  });
  assert.equal(r.status, 'verified');
});

test('parceiro: reprova CPF de outra pessoa e documento inválido; dúvida vai ao Admin', () => {
  const base = { identityApproved: true, identityCpfHash: cpfHash('52998224725'), isHighRisk: false, hasCadastur: false, ai: { aprovar: true, risco: 'baixo' as const, motivos: [] } };
  assert.equal(decideMerchant({ ...base, documentNumber: '111.444.777-35' }).status, 'rejected');
  assert.equal(decideMerchant({ ...base, documentNumber: '11.222.333/0001-80' }).status, 'rejected');
  assert.equal(decideMerchant({ ...base, documentNumber: '11.222.333/0001-81', ai: null }).status, 'manual_review');
  assert.equal(decideMerchant({ ...base, documentNumber: '11.222.333/0001-81', isHighRisk: true }).status, 'manual_review');
  assert.equal(decideMerchant({ ...base, documentNumber: '11.222.333/0001-81', identityApproved: false }).status, 'manual_review');
  assert.equal(
    decideMerchant({ ...base, documentNumber: '11.222.333/0001-81', ai: { aprovar: false, risco: 'alto', motivos: ['golpe'] } }).status,
    'rejected'
  );
});

test('anúncio no ar só com parceiro verificado + plano pago em dia + Mercado Pago conectado', () => {
  const future = new Date(Date.now() + 5 * 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  const m = {
    id: 1, companyName: 'x', tradeName: 'x', documentNumber: '', category: 'tour', city: 'x', state: 'RJ', phone: '1',
    verificationStatus: 'verified', planExpiresAt: future, mpOauthConnected: true,
  };
  assert.deepEqual(merchantBlockers(m), []);
  assert.deepEqual(merchantBlockers({ ...m, planExpiresAt: past }), ['plano pago em dia']);
  assert.deepEqual(merchantBlockers({ ...m, mpOauthConnected: false }), ['conta Mercado Pago conectada']);
  assert.deepEqual(merchantBlockers({ ...m, verificationStatus: 'manual_review' }), ['verificação do parceiro']);
  assert.equal(isPlanActive({ planExpiresAt: null }), false);
});

test('cobrança automática: cada pagamento aprovado soma 30 dias sem perder dias já pagos', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  assert.equal(extendExpiry(null, 30, now), '2026-12-25T12:00:00.000Z');
  assert.equal(extendExpiry('2026-11-30T12:00:00.000Z', 30, now), '2026-12-30T12:00:00.000Z');
  assert.equal(extendExpiry('2026-10-01T00:00:00.000Z', 30, now), '2026-12-25T12:00:00.000Z');
});

test('split: token do parceiro é renovado antes de vencer', () => {
  const now = Date.parse('2026-11-25T00:00:00Z');
  assert.equal(sellerTokenNeedsRefresh('2026-11-28T00:00:00Z', now), true);
  assert.equal(sellerTokenNeedsRefresh('2027-03-01T00:00:00Z', now), false);
  assert.equal(sellerTokenNeedsRefresh(null, now), false);
});

test('rotinas diárias só rodam com o CRON_SECRET da Vercel', () => {
  const secret = 'segredo-de-teste-123456';
  assert.equal(isAuthorizedCron(`Bearer ${secret}`, secret), true);
  assert.equal(isAuthorizedCron('Bearer errado', secret), false);
  assert.equal(isAuthorizedCron(undefined, secret), false);
  assert.equal(isAuthorizedCron(`Bearer ${secret}`, undefined), false);
  assert.equal(isAuthorizedCron('Bearer curto', 'curto'), false);
});

test('regras do dono no código: sem plano gratuito ativo, sem cupons, jornal e agentes automáticos', () => {
  const seed = fs.readFileSync('api/_lib/seed.ts', 'utf8');
  const freeBlock = seed.slice(seed.indexOf("slug: 'free'"), seed.indexOf("slug: 'basic'"));
  assert.match(freeBlock, /active: false/);
  assert.doesNotMatch(seed, /collection\('coupons'\)\.doc\('FROC10'\)/);
  assert.match(seed, /business_rules_v2/);

  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const crons = (vercel.crons || []).map((c: { path: string }) => c.path);
  assert.ok(crons.includes('/api/cron/jornal'));
  assert.ok(crons.includes('/api/cron/agentes'));
  assert.ok(!JSON.stringify(vercel.rewrites).includes('coupons'));
  const fnCount = fs
    .readdirSync('api', { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('_lib'));
  assert.ok(fnCount.length <= 12, `Vercel Hobby aceita 12 funções; há ${fnCount.length}`);

  for (const f of ['api/bookings.ts', 'api/catalog.ts', 'api/tourist.ts', 'api/admin.ts']) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /couponCode|coupons\/validate|collection\('coupons'\)/, f);
  }
  const bookings = fs.readFileSync('api/bookings.ts', 'utf8');
  assert.match(bookings, /marketplaceFeeCents: result\.booking\.commissionCents/);
  assert.match(bookings, /sellerAccessToken,/);
  assert.match(bookings, /IDENTITY_REQUIRED/);
});
