import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FROC_X_URL, linkFrocX } from '../src/lib/frocX.ts';
import { BotaoFrocX } from '../src/components/BotaoFrocX.tsx';

test('Froc X: link com destino e coordenadas (o app abre com o ponto B pronto)', () => {
  const u = new URL(linkFrocX({ destino: { nome: 'Paraty', lat: -23.2178, lng: -44.7131, cidade: 'Paraty', uf: 'RJ' } }));
  assert.equal(`${u.origin}`, FROC_X_URL);
  assert.equal(u.searchParams.get('destino'), 'Paraty');
  assert.equal(u.searchParams.get('lat'), '-23.2178');
  assert.equal(u.searchParams.get('lng'), '-44.7131');
  assert.equal(u.searchParams.get('uf'), 'RJ');
  assert.equal(u.searchParams.get('de'), 'froc-rota');
});

test('Froc X: aeroporto vai como partida, só com o nome; coordenada 0,0 não é enviada', () => {
  const u = new URL(linkFrocX({ origem: { nome: 'Aeroporto Governador Aluízio Alves - Natal/RN', cidade: 'Natal', uf: 'RN' } }));
  assert.equal(u.searchParams.get('origem'), 'Aeroporto Governador Aluízio Alves - Natal/RN');
  assert.equal(u.searchParams.get('olat'), null);
  assert.equal(u.searchParams.get('destino'), null);
  const z = new URL(linkFrocX({ destino: { nome: 'Hotel', lat: 0, lng: 0 } }));
  assert.equal(z.searchParams.get('lat'), null);
});

test('Froc X: botão abre em outra aba com o link certo', () => {
  const html = renderToStaticMarkup(<BotaoFrocX destino={{ nome: 'Bonito', lat: -21.13, lng: -56.49 }} texto="Ir até Bonito de Froc X" />);
  assert.match(html, /froc-x-uber\.vercel\.app\/\?destino=Bonito&amp;lat=-21\.13&amp;lng=-56\.49/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /noopener/);
  assert.match(html, /Ir até Bonito de Froc X/);
});

test('Propaganda Froc X: contagem até a inauguração e chamadas para cadastro e motorista', async () => {
  const { FrocXPromo, diasAteInauguracao } = await import('../src/components/FrocXPromo.tsx');
  assert.equal(diasAteInauguracao(new Date('2026-11-27T16:40:00-03:00')), 103);
  assert.equal(diasAteInauguracao(new Date('2027-04-01T00:00:00-03:00')), 0);
  const html = renderToStaticMarkup(<FrocXPromo agora={new Date('2026-11-27T16:40:00-03:00')} />);
  assert.match(html, /Quero ser fundador/);
  assert.match(html, /seja-motorista\?de=froc-rota/);
  assert.match(html, /wa\.me/);
  const depois = renderToStaticMarkup(<FrocXPromo agora={new Date('2027-04-01T00:00:00-03:00')} />);
  assert.match(depois, /Já está funcionando/);
  assert.doesNotMatch(depois, /Quero ser fundador/);
});
