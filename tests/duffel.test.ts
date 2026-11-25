import assert from 'node:assert/strict';
import test from 'node:test';
import { duffelMode, isMadrugada, normalizeDuffelOffers } from '../api/_lib/duffel.ts';

const offer = (id: string, amount: string, dep: string, segs = 1) => ({
  id,
  total_amount: amount,
  total_currency: 'BRL',
  owner: { name: 'Duffel Airways', iata_code: 'ZZ' },
  slices: [
    {
      segments: Array.from({ length: segs }, (_, i) => ({
        departing_at: i === 0 ? dep : '2026-12-09T12:00:00',
        arriving_at: '2026-12-09T15:30:00',
        origin: { iata_code: i === 0 ? 'GRU' : 'BSB' },
        destination: { iata_code: i === segs - 1 ? 'REC' : 'BSB' },
        marketing_carrier: { iata_code: 'ZZ' },
        marketing_carrier_flight_number: String(100 + i),
      })),
    },
  ],
});

test('Duffel: ofertas viram cartões com companhia, horários, paradas e preço, do mais barato ao mais caro', () => {
  const out = normalizeDuffelOffers([offer('o1', '899.90', '2026-12-09T08:10:00', 2), offer('o2', '640.00', '2026-12-09T02:30:00')]);
  assert.equal(out[0].id, 'o2');
  assert.equal(out[0].totalCents, 64000);
  assert.equal(out[0].stops, 0);
  assert.equal(out[1].stops, 1);
  assert.equal(out[1].origin, 'GRU');
  assert.equal(out[1].destination, 'REC');
  assert.deepEqual(out[1].flightNumbers, ['ZZ100', 'ZZ101']);
});

test('Duffel: oferta sem preço ou sem horário é descartada (nunca inventa)', () => {
  assert.equal(normalizeDuffelOffers([offer('x', '0', '2026-12-09T08:00:00'), { id: 'y', total_amount: '10', total_currency: 'BRL', slices: [] }]).length, 0);
});

test('Duffel: modo teste x real pela chave; radar da madrugada 00h–05h59', () => {
  assert.equal(duffelMode('duffel_test_abc'), 'test');
  assert.equal(duffelMode('duffel_live_abc'), 'live');
  assert.equal(duffelMode(''), null);
  assert.equal(isMadrugada('2026-12-09T02:30:00'), true);
  assert.equal(isMadrugada('2026-12-09T06:00:00'), false);
});
