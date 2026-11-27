import test from 'node:test';
import assert from 'node:assert/strict';
import { DESTINOS_BRASIL } from '../api/_lib/brasil-destinos.ts';
import { fichaDoDestino } from '../api/_lib/seed.ts';
import { negociosDoPlaces, TIPOS_GOOGLE } from '../src/lib/negociosGoogle.ts';

test('Destinos: os 100 da Vitrine viram ficha honesta (sem orçamento nem época inventados)', () => {
  assert.equal(DESTINOS_BRASIL.length, 100);
  const bonito = DESTINOS_BRASIL.find((d) => d.slug === 'bonito')!;
  const f = fichaDoDestino(bonito, 42, '2026-11-27T00:00:00Z');
  assert.equal(f.id, 42);
  assert.equal(f.avgBudgetDayCents, 0);
  assert.equal(f.bestSeason, '');
  assert.equal(f.curiosities, '');
  assert.match(f.howToGet, /BYO/);
  assert.match(f.description, /Destaques: .* e /);
  assert.equal(f.region, 'Centro-Oeste');
  for (const d of DESTINOS_BRASIL) {
    const x = fichaDoDestino(d, 1, 'x');
    assert.ok(x.summary && x.lat && x.lng && x.region && x.howToGet, d.slug);
  }
});

test('Mapa: negócios do Google com posição e link do próprio Google', () => {
  const r = negociosDoPlaces([
    { id: 'a', displayName: 'Pousada A', location: { lat: () => -21.8, lng: () => -48.2 }, rating: 4.6, userRatingCount: 80, googleMapsURI: 'https://maps.google.com/?cid=9', primaryTypeDisplayName: 'Pousada' },
    { id: 'b', displayName: 'Sem posição' },
    { id: 'c', displayName: 'Link estranho', location: { lat: -21.7, lng: -48.1 }, googleMapsURI: 'https://golpe.example/x' },
    { id: 'd', location: { lat: -21, lng: -48 } },
  ]);
  assert.deepEqual(r.map((x) => x.id), ['a', 'c']);
  assert.equal(r[0].nota, 4.6);
  assert.equal(r[1].url, '');
  assert.deepEqual(TIPOS_GOOGLE.hospedagem.tipos, ['lodging']);
});
