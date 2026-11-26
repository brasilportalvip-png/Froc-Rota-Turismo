import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { analisarLeilao, lanceComissaoBps, ordemDoLeilao, COMISSAO_MIN_BPS, COMISSAO_MAX_BPS } from '../api/_lib/leilao.ts';
import { isPlanActive } from '../api/_lib/merchant-status.ts';
import { normalizeDuffelOffers, isoDurationMin } from '../api/_lib/duffel.ts';
import { FlightOffers, resumoEscalas, duracao, textoDaOferta } from '../src/components/FlightOffers.tsx';

test('Leilão: lance vale de 14% a 25% (sem lance = 14%), em passos de 0,5%', () => {
  assert.equal(lanceComissaoBps(undefined), COMISSAO_MIN_BPS);
  assert.equal(lanceComissaoBps(900), 1400);
  assert.equal(lanceComissaoBps(9000), COMISSAO_MAX_BPS);
  assert.equal(lanceComissaoBps(1730), 1750);
});

test('Leilão: posição e sugestão da IA para chegar ao topo', () => {
  const r = analisarLeilao(1, 1400, [
    { merchantId: 2, bidBps: 1800 },
    { merchantId: 3, bidBps: 1600 },
    { merchantId: 4, bidBps: 1500 },
  ]);
  assert.equal(r.posicao, 4);
  assert.equal(r.total, 4);
  assert.equal(r.sugestaoTopoBps, 1850);
  assert.equal(r.sugestaoTop3Bps, 1550);
  assert.match(r.dica, /18,5%|18.5%/);
  const sozinho = analisarLeilao(1, 1400, []);
  assert.equal(sozinho.posicao, 1);
  const lider = analisarLeilao(1, 2000, [{ merchantId: 2, bidBps: 1800 }]);
  assert.equal(lider.posicao, 1);
});

test('Leilão: vitrine põe destaque pago, depois maior lance, depois nota', () => {
  const lista = [
    { id: 'a', bidBps: 1400, ratingAvg: 5 },
    { id: 'b', bidBps: 2500, ratingAvg: 3 },
    { id: 'c', bidBps: 1400, ratingAvg: 4, isFeatured: true },
  ];
  assert.deepEqual([...lista].sort(ordemDoLeilao).map((x) => x.id), ['c', 'b', 'a']);
});

test('Plano com cobrança automática tem 4 dias de folga; cancelado não tem', () => {
  const agora = Date.parse('2026-11-26T12:00:00Z');
  const venceuOntem = '2026-11-25T12:00:00Z';
  assert.equal(isPlanActive({ planExpiresAt: venceuOntem, planStatus: 'active' }, agora), true);
  assert.equal(isPlanActive({ planExpiresAt: venceuOntem, planStatus: 'cancelled' }, agora), false);
  assert.equal(isPlanActive({ planExpiresAt: '2026-11-20T12:00:00Z', planStatus: 'active' }, agora), false);
});

const ofertaDuffel = {
  id: 'off_x',
  total_amount: '900.00',
  total_currency: 'BRL',
  owner: { name: 'Azul', iata_code: 'AD' },
  slices: [
    {
      duration: 'PT6H',
      segments: [
        { departing_at: '2026-12-09T08:00:00', arriving_at: '2026-12-09T09:30:00', origin: { iata_code: 'VCP', city_name: 'Campinas' }, destination: { iata_code: 'CNF', name: 'Confins', city_name: 'Belo Horizonte' }, marketing_carrier: { iata_code: 'AD', name: 'Azul' }, marketing_carrier_flight_number: '4010', aircraft: { name: 'Embraer 195' } },
        { departing_at: '2026-12-09T11:00:00', arriving_at: '2026-12-09T14:00:00', origin: { iata_code: 'CNF', name: 'Confins', city_name: 'Belo Horizonte' }, destination: { iata_code: 'NAT', city_name: 'Natal' }, marketing_carrier: { iata_code: 'AD', name: 'Azul' }, marketing_carrier_flight_number: '4020', aircraft: { name: 'Airbus A320neo' } },
      ],
    },
    {
      duration: 'PT3H10M',
      segments: [
        { departing_at: '2026-12-14T20:00:00', arriving_at: '2026-12-14T23:10:00', origin: { iata_code: 'NAT' }, destination: { iata_code: 'VCP' }, marketing_carrier: { iata_code: 'AD', name: 'Azul' }, marketing_carrier_flight_number: '4100' },
      ],
    },
  ],
};

test('Duffel: ida e volta com escala (onde, quanto tempo, troca de avião) e volta direta', () => {
  assert.equal(isoDurationMin('PT6H'), 360);
  assert.equal(isoDurationMin('P1DT2H'), 1560);
  const [o] = normalizeDuffelOffers([ofertaDuffel] as never);
  assert.equal(o.slices.length, 2);
  const ida = o.slices[0];
  assert.equal(ida.stops, 1);
  assert.equal(ida.layovers[0].airport, 'CNF');
  assert.equal(ida.layovers[0].durationMin, 90);
  assert.equal(ida.layovers[0].changeAircraft, true);
  assert.equal(o.slices[1].stops, 0);
  assert.equal(o.stops, 1);
});

test('Tela de voos: mais barato, direto, escala e onde, e detalhe da volta', () => {
  const ofertas = normalizeDuffelOffers([
    ofertaDuffel,
    { ...ofertaDuffel, id: 'off_dir', total_amount: '1300.00', slices: [ofertaDuffel.slices[1], ofertaDuffel.slices[1]] },
  ] as never).map((o) => ({ ...o, finalClientCents: Math.round(Number(o.price.total) * 114) }));
  const html = renderToStaticMarkup(
    <FlightOffers offers={ofertas as never} formatMoney={(c) => `R$ ${(c / 100).toFixed(2)}`} passageiros={1} onEscolher={() => {}} />
  );
  assert.match(html, /Mais barato/);
  assert.match(html, /Direto/);
  assert.match(html, /1 escala/);
  assert.match(html, /CNF/);
  assert.match(html, /Volta/);
  assert.match(html, /Quero este voo/);
  const t = ofertas[0].slices[0];
  assert.match(resumoEscalas(t as never), /1 escala.*CNF/);
  assert.equal(duracao(90), '1h 30min');
  assert.match(textoDaOferta(ofertas[0] as never, 'R$ 1.026,00', 1), /conexão em CNF: espera 1h 30min, troca de avião/);
});
