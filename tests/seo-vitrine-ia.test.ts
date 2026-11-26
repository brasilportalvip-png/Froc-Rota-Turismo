import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { DESTINOS_BRASIL, detectDestinos } from '../api/_lib/brasil-destinos.ts';
import { fallbackSuggestion, saudacao } from '../api/_lib/intent.ts';
import { fallbackInvite } from '../api/_lib/prospects.ts';
import { analyzeSeo, clip, metaDescription, seoTitle, slugify, textToHtml } from '../api/_lib/seo.ts';
import { decayed, firstName, greeting } from '../src/lib/intent.ts';

test('Vitrine do Brasil: 100 destinos reais, sem repetição, dentro do mapa do Brasil e nas 5 regiões', () => {
  assert.ok(DESTINOS_BRASIL.length >= 100);
  const slugs = new Set(DESTINOS_BRASIL.map((d) => d.slug));
  assert.equal(slugs.size, DESTINOS_BRASIL.length);
  for (const d of DESTINOS_BRASIL) {
    assert.ok(d.lat > -34 && d.lat < 6 && d.lng > -74 && d.lng < -32, `${d.slug} fora do Brasil`);
    assert.match(d.aeroporto, /^[A-Z]{3}$/, d.slug);
    assert.ok(d.resumo.length > 40 && d.atrativos.length >= 2, d.slug);
  }
  assert.deepEqual(new Set(DESTINOS_BRASIL.map((d) => d.regiao)), new Set(['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul']));
});

test('IA de intenção: quem lê sobre o Cristo está pensando no Rio; Cataratas → Foz', () => {
  assert.equal(detectDestinos('Subi no Cristo Redentor e no Pão de Açúcar')[0].destino.slug, 'rio-de-janeiro');
  assert.equal(detectDestinos('vale a pena ver as cataratas do iguaçu em julho?')[0].destino.slug, 'foz-do-iguacu');
  assert.equal(detectDestinos('Lagoa Azul e Barreirinhas')[0].destino.regiao, 'Nordeste');
  assert.equal(detectDestinos('receita de bolo de cenoura').length, 0);
});

test('Saudação pela hora certa e chamada pelo primeiro nome', () => {
  assert.equal(saudacao(6), 'Bom dia');
  assert.equal(saudacao(13), 'Boa tarde');
  assert.equal(saudacao(20), 'Boa noite');
  assert.equal(saudacao(2), 'Boa noite');
  assert.equal(greeting(new Date(2026, 10, 26, 9, 0)), 'Bom dia');
  assert.equal(firstName('ana souza'), 'Ana');
  assert.equal(firstName('alguem@email.com'), '');
});

test('Interesse esquece com o tempo (vale metade depois de 7 dias)', () => {
  const now = Date.now();
  assert.equal(Math.round(decayed(8, now - 7 * 86400000, now)), 4);
  assert.equal(decayed(5, now, now), 5);
});

test('Pop-up de oportunidade e convite de parceiro: texto verdadeiro, sem escassez, desconto ou grátis', () => {
  const rio = DESTINOS_BRASIL.find((d) => d.slug === 'rio-de-janeiro')!;
  const s = fallbackSuggestion(rio, 'Ana', 9, 2);
  assert.match(s.headline, /^Bom dia, Ana!/);
  assert.match(s.message, /Cristo Redentor/);
  const forbidden = /(últimas vagas|só restam|cupom|desconto|grátis|gratuito)/i;
  assert.doesNotMatch(`${s.headline} ${s.message}`, forbidden);
  const inv = fallbackInvite('Escuna Sol', 'Paraty', 'barco');
  assert.match(inv, /SAIR/);
  assert.match(inv, /R\$ 100/);
  assert.doesNotMatch(inv, forbidden);
});

test('Regras Yoast: título até 60, descrição 120–156, slug limpo', () => {
  const t = seoTitle('Cristais de quartzo e quedas esmeralda na Chapada dos Veadeiros em Goiás');
  assert.ok(t.length <= 60, t);
  assert.equal(seoTitle('Paraty: o que fazer'), 'Paraty: o que fazer | Froc Rota');
  const d = metaDescription('Paraty tem centro histórico.');
  assert.ok(d.length >= 120 && d.length <= 156, String(d.length));
  assert.ok(metaDescription('x '.repeat(200)).length <= 156);
  assert.equal(slugify('O que fazer em São Thomé das Letras!'), 'o-que-fazer-em-sao-thome-das-letras');
  assert.equal(clip('uma frase curta', 50), 'uma frase curta');
});

test('Analisador Yoast aprova texto bom e reprova texto fraco', () => {
  const body =
    'O que fazer em Paraty é a dúvida de quem chega à Costa Verde.\n## Centro histórico\n' +
    'Ruas de pedra, igrejas e casarões. '.repeat(40) +
    '\n## Passeios de barco\nO que fazer em Paraty inclui ilhas e praias. ' +
    'Escunas saem do cais todos os dias. '.repeat(30);
  const good = analyzeSeo({
    keyphrase: 'o que fazer em Paraty',
    title: 'O que fazer em Paraty: guia completo | Froc Rota',
    description: 'O que fazer em Paraty: centro histórico, passeios de barco, ilhas e cachoeiras. Veja o roteiro e reserve com parceiros verificados.',
    slug: 'o-que-fazer-em-paraty',
    h1: 'O que fazer em Paraty',
    bodyText: body,
    internalLinks: 3,
    imagesWithoutAlt: 0,
    subheadings: 2,
  });
  assert.ok(good.score >= 90, JSON.stringify(good.checks.filter((c) => !c.ok)));
  const bad = analyzeSeo({
    keyphrase: 'Paraty',
    title: 'Oi',
    description: 'curta',
    slug: 'x',
    h1: 'Bem-vindo',
    bodyText: 'texto curto',
    internalLinks: 0,
    imagesWithoutAlt: 2,
    subheadings: 0,
  });
  assert.ok(bad.score < 30);
});

test('Texto do blog vira HTML seguro, com intertítulos', () => {
  const { html, subheadings } = textToHtml('Intro <script>x</script>\n## Como chegar\nDe avião.');
  assert.equal(subheadings, 1);
  assert.match(html, /<h2>Como chegar<\/h2>/);
  assert.doesNotMatch(html, /<script>/);
});

test('Endereços de SEO apontam para o servidor e o app offline não os engole', () => {
  const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const src = v.rewrites.map((r: { source: string }) => r.source);
  for (const p of ['/sitemap.xml', '/robots.txt', '/destinos', '/destinos/:slug', '/blog', '/blog/:slug', '/ofertas/:slug', '/anuncie', '/politica-de-privacidade', '/termos-de-uso', '/sobre', '/contato']) {
    assert.ok(src.includes(p), p);
    assert.ok(src.indexOf(p) < src.indexOf('/(.*)'), `${p} precisa vir antes do app`);
  }
  assert.equal(fs.existsSync('public/robots.txt'), false, 'robots.txt estático tapava o dinâmico');
  const vite = fs.readFileSync('vite.config.ts', 'utf8');
  assert.match(vite, /destinos\|blog\|ofertas\|anuncie/);
  const html = fs.readFileSync('index.html', 'utf8');
  const title = html.match(/<title>([^<]+)<\/title>/)![1];
  assert.ok(title.length <= 60 && /Turismo no Brasil/.test(title));
  assert.match(html, /rel="canonical"/);
  assert.match(html, /SearchAction/);
});

test('As matérias do blog nunca são apagadas pelo código', () => {
  for (const f of ['api/admin.ts', 'api/cron.ts', 'api/_lib/editorial.ts', 'api/_lib/agent-jobs.ts', 'api/seo.ts']) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /collection\('posts'\)[\s\S]{0,120}\.delete\(/, f);
  }
});

test('Confidencial: tela pública sem simulador de markup, status de integrações ou números internos', async () => {
  const fs = await import('node:fs');
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const travel = fs.readFileSync('src/components/TravelAndConciergeSection.tsx', 'utf8');
  for (const bad of [/Corpo Autônomo/, /Modelos Pop-up/, /AnimatedCounter/, /SHA-256/, /Módulo 0/]) assert.equal(bad.test(app), false, String(bad));
  for (const bad of [/Simulador/, /pricing\/preview/, /travel\/status/, /platformFeeCents/, /fxRate/, /Idempotency/, /Amadeus/]) assert.equal(bad.test(travel), false, String(bad));
  const catalog = fs.readFileSync('api/catalog.ts', 'utf8');
  assert.match(catalog, /route === '\/pricing\/preview'\) \{\r?\n[^\n]*\n\s*const staff = await requireAdminContext/);
  const { publicFlightResult } = await import('../api/_lib/travel.ts');
  const out = JSON.stringify(publicFlightResult({ connected: true, provider: 'Duffel', integrations: [1], offers: [{ finalClientCents: 1000, platformFeeCents: 200, supplierBrlCents: 800, fxRate: 6, price: { total: '1', currency: 'EUR' } }] }));
  assert.equal(/platformFeeCents|supplierBrlCents|fxRate|integrations|provider|"price"/.test(out), false);
});
