import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { acharDestino, filtrarDestinosDoBrasil, normalizarNome, normalizarProdutos } from '../api/_lib/viator.ts';
import { GYG_PARTNER_ID, linkGetYourGuide, PasseiosParceiros, textoDuracao } from '../src/components/PasseiosParceiros.tsx';

const destinos = [
  { destinationId: 21, name: 'Brasil', type: 'COUNTRY', lookupId: '8.21' },
  { destinationId: 712, name: 'Rio de Janeiro', type: 'CITY', lookupId: '8.21.712', center: { latitude: -22.9, longitude: -43.2 } },
  { destinationId: 22002, name: 'Bonito', type: 'CITY', lookupId: '8.21.22002', center: { latitude: -21.13, longitude: -56.49 } },
  { destinationId: 5000, name: 'Bonito', type: 'CITY', lookupId: '8.99.5000' },
  { destinationId: 9, name: 'Lisboa', type: 'CITY', lookupId: '6.66.9' },
];

test('Viator: só destinos dentro do Brasil', () => {
  const br = filtrarDestinosDoBrasil(destinos);
  assert.deepEqual(br.map((d) => d.id).sort(), ['22002', '712']);
});

test('Viator: acha o destino pelo nome (sem acento) ou pela distância', () => {
  const br = filtrarDestinosDoBrasil(destinos);
  assert.equal(normalizarNome('Fernando de Noronha!'), 'fernando de noronha');
  assert.equal(acharDestino(br, { nome: 'rio de janeiro' })?.id, '712');
  // Niterói fica a ~10 km do Rio: usa o destino mais perto
  assert.equal(acharDestino(br, { nome: 'Niterói', lat: -22.88, lng: -43.1 })?.id, '712');
  // Longe de tudo: não inventa
  assert.equal(acharDestino(br, { nome: 'Jalapão', lat: -10.5, lng: -46.5 }), null);
});

test('Viator: produto vira cartão do site; link fora da Viator é descartado', () => {
  const r = normalizarProdutos(
    {
      products: [
        {
          productCode: '123P1',
          title: 'Cristo Redentor e Pão de Açúcar',
          productUrl: 'https://www.viator.com/tours/Rio/x/d712-123P1?pid=P00334421&mcid=42383&medium=api',
          images: [{ isCover: true, variants: [{ url: 'https://media.tacdn.com/a-200.jpg', width: 200 }, { url: 'https://media.tacdn.com/a-480.jpg', width: 480 }] }],
          reviews: { totalReviews: 2310, combinedAverageRating: 4.78 },
          duration: { fixedDurationInMinutes: 480 },
          pricing: { summary: { fromPrice: 389.9 }, currency: 'BRL' },
        },
        { productCode: 'X', title: 'Golpe', productUrl: 'https://site-falso.com/x' },
      ],
    },
    'BRL'
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].imagem, 'https://media.tacdn.com/a-480.jpg');
  assert.equal(r[0].nota, 4.8);
  assert.equal(r[0].precoCents, 38990);
  assert.equal(r[0].duracaoMin, 480);
  assert.match(r[0].url, /pid=P00334421/);
});

test('Tela: passeios dos parceiros com aviso de comissão, link da GetYourGuide com o nosso ID e sem widget antes do consentimento', () => {
  const html = renderToStaticMarkup(
    <PasseiosParceiros
      slug="rio-de-janeiro"
      cidade="Rio de Janeiro"
      inicial={[
        { codigo: '1', titulo: 'Cristo Redentor', imagem: null, nota: 4.8, avaliacoes: 2310, duracaoMin: 480, precoCents: 38990, moeda: 'BRL', url: 'https://www.viator.com/x' },
      ]}
    />
  );
  assert.match(html, /Mais passeios em Rio de Janeiro/);
  assert.match(html, /pode receber comissão/);
  assert.match(html, /Cristo Redentor/);
  assert.match(html, /a partir de R\$\s?390/);
  assert.match(html, /rel="sponsored noopener noreferrer"/);
  assert.match(html, /data-nosnippet/);
  assert.match(html, new RegExp(`partner_id=${GYG_PARTNER_ID}`));
  assert.doesNotMatch(html, /data-gyg-widget/);
  assert.equal(GYG_PARTNER_ID, 'NC3UBVZ');
  assert.match(linkGetYourGuide('Bonito'), /q=Bonito%2C%20Brasil/);
  assert.equal(textoDuracao(480), '8h');
  assert.equal(textoDuracao(90), '1h 30min');
  assert.equal(textoDuracao(2880), '2 dias');
});
