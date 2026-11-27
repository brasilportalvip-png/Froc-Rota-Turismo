import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DESTINOS_BRASIL } from '../api/_lib/brasil-destinos.ts';
import { fichaDoDestino } from '../api/_lib/seed.ts';
import { buscarNoSite, atalhosIniciais, normalizar, SECOES_SITE } from '../src/lib/buscaSite.ts';
import { BuscaSite } from '../src/components/BuscaSite.tsx';
import { EMPRESA } from '../api/_lib/empresa.ts';
import { EMPRESA_SITE } from '../src/lib/empresa.ts';
import { privacyHtml, termsHtml, identificacaoHtml } from '../api/_lib/seo.ts';

const destinos = DESTINOS_BRASIL.map((d, i) => fichaDoDestino(d, i + 1, '2026-11-27T00:00:00Z'));
const ofertas = [
  { id: 1, title: 'Passeio de barco em Arraial do Cabo', moduleType: 'experience', subtype: 'barco', destinationId: destinos.find((d) => d.slug === 'arraial-do-cabo')?.id, summary: 'Praias de água azul' },
  { id: 2, title: 'Pousada Mar Azul', moduleType: 'accommodation', subtype: 'pousada', destinationId: destinos.find((d) => d.slug === 'bonito')?.id },
];
const materias = [{ slug: 'chapada-cristais', title: 'Cristais de quartzo e quedas na Chapada dos Veadeiros', category: 'Natureza' }];
const dados = { destinos, ofertas, materias };

test('Busca: acha destino sem acento e com erro de maiúscula', () => {
  const r = buscarNoSite('sao paulo', dados);
  assert.equal(r[0].tipo, 'destino');
  assert.match(r[0].titulo, /São Paulo/);
  const b = buscarNoSite('BONITO', dados);
  assert.ok(b.some((x) => x.tipo === 'destino' && /^Bonito/.test(x.titulo)));
  assert.equal(normalizar('Jericoacoara — CE'), 'jericoacoara ce');
});

test('Busca: todos os 100 destinos são encontráveis pelo nome', () => {
  for (const d of destinos) {
    const r = buscarNoSite(d.name, dados);
    assert.ok(r.some((x) => x.tipo === 'destino' && x.acao.kind === 'destino' && x.acao.id === d.id), d.name);
  }
});

test('Busca: ofertas, blog, passagens e seções', () => {
  assert.ok(buscarNoSite('barco', dados).some((x) => x.tipo === 'oferta' && x.acao.kind === 'oferta' && x.acao.id === 1));
  assert.ok(buscarNoSite('pousada bonito', dados).some((x) => x.tipo === 'oferta' && x.titulo === 'Pousada Mar Azul'));
  assert.ok(buscarNoSite('chapada', dados).some((x) => x.tipo === 'materia'));
  const voo = buscarNoSite('voo natal', dados);
  const primeiroVoo = voo.find((x) => x.tipo === 'voo')!;
  assert.equal(primeiroVoo.acao.kind === 'voo' && primeiroVoo.acao.iata, 'NAT');
  assert.ok(buscarNoSite('passagem para recife', dados).some((x) => x.tipo === 'voo' && x.acao.kind === 'voo' && x.acao.iata === 'REC'));
  const sec = (q: string) => buscarNoSite(q, dados).filter((x) => x.tipo === 'secao').map((x) => x.titulo);
  assert.ok(sec('cancelar').includes('Termos de Uso'));
  assert.ok(sec('reembolso').includes('Termos de Uso'));
  assert.ok(sec('hotel').includes('Hospedagens'));
  assert.ok(sec('restaurante').includes('Gastronomia'));
  assert.ok(sec('uber').some((t) => /Froc X/.test(t)));
  assert.ok(sec('cnpj').includes('Contato e dados da empresa'));
  assert.ok(sec('excluir conta').includes('Política de Privacidade (LGPD)'));
  assert.ok(sec('planos').includes('Anuncie na Froc Rota'));
  assert.ok(sec('atendimento').some((t) => /Chat/.test(t)));
  assert.ok(sec('perto de mim').includes('Mapa interativo'));
  assert.deepEqual(buscarNoSite('xyzqwk', dados), []);
  assert.deepEqual(buscarNoSite('a', dados), []);
});

test('Busca: atalhos iniciais mostram o site inteiro e o componente é acessível', () => {
  assert.equal(atalhosIniciais().length, SECOES_SITE.length);
  const html = renderToStaticMarkup(<BuscaSite destinos={destinos} ofertas={ofertas} onEscolher={() => undefined} />);
  assert.match(html, /aria-label="Buscar no site"/);
  assert.match(html, /data-testid="abrir-busca"/);
});

test('Legal: identificação da empresa igual no site e nas páginas; termos com arrependimento e SAC', () => {
  assert.equal(EMPRESA_SITE.cnpj, EMPRESA.cnpj);
  assert.equal(EMPRESA_SITE.razaoSocial, EMPRESA.razaoSocial);
  assert.equal(EMPRESA_SITE.cidade, EMPRESA.cidade);
  assert.equal(EMPRESA_SITE.uf, EMPRESA.uf);
  const id = identificacaoHtml();
  assert.match(id, /43\.330\.322\/0001-01/);
  assert.match(id, /mailto:/);
  assert.doesNotMatch(id, /Araraquara|Arid Nasser|ANA LUCIA|Atividade/, 'só CNPJ e e-mail (pedido do dono)');
  const t = termsHtml();
  assert.match(t, /art\. 49/);
  assert.match(t, /7 dias/);
  assert.match(t, /consumidor\.gov\.br/);
  const p = privacyHtml();
  assert.match(p, /Encarregado/);
  assert.match(p, /Excluir minha conta/);
  assert.match(p, /ANPD/);
});
