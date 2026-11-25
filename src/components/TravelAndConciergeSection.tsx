import React, { useEffect, useState } from 'react';
import { BellRing, Calculator, ExternalLink, Moon, Plane, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { formatMoney, TRANSLATIONS } from '../i18n/translations.ts';
import { PriceBreakdown } from '../types.ts';

interface TravelIntegration {
  provider: string;
  category: string;
  configured: boolean;
  docsUrl: string;
  requiredEnvVars: string[];
  notes: string;
}

export const TravelAndConciergeSection: React.FC = () => {
  const { apiFetch, currency, dbUser, language, requestLogin, notify } = useApp();
  const t = TRANSLATIONS[language];

  // Travel search state
  const [tripType, setTripType] = useState<'one_way' | 'round_trip' | 'multi_city'>('round_trip');
  const [originIata, setOriginIata] = useState('GRU');
  const [destIata, setDestIata] = useState('REC');
  const [departureDate, setDepartureDate] = useState(
    new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  );
  const [returnDate, setReturnDate] = useState(
    new Date(Date.now() + 19 * 86400000).toISOString().slice(0, 10)
  );
  const [adults, setAdults] = useState('2');
  const [maxPriceBrl, setMaxPriceBrl] = useState('2500');
  const [madrugadaOnly, setMadrugadaOnly] = useState(false);
  const [searchingFlights, setSearchingFlights] = useState(false);
  const [flightResponse, setFlightResponse] = useState<{
    connected: boolean;
    provider?: string;
    message?: string;
    mode?: 'test' | 'live' | null;
    offers: Array<{
      id?: string;
      price?: { total?: string; currency?: string };
      airline?: string;
      departureAt?: string;
      arrivalAt?: string;
      origin?: string;
      destination?: string;
      stops?: number;
      flightNumbers?: string[];
      returnDepartureAt?: string | null;
      finalClientCents?: number | null;
      platformFeeCents?: number | null;
      fxRate?: number | null;
      fxDate?: string | null;
    }>;
    integrations: TravelIntegration[];
  } | null>(null);
  const [integrations, setIntegrations] = useState<TravelIntegration[]>([]);

  // Transparent pricing simulator (uses real backend pricing rules)
  const [simCategory, setSimCategory] = useState<'flights' | 'accommodation' | 'experience'>('flights');
  const [simSupplierBrl, setSimSupplierBrl] = useState('1000');
  const [simBreakdown, setSimBreakdown] = useState<PriceBreakdown | null>(null);

  // Concierge request state
  const [cOrigin, setCOrigin] = useState('São Paulo, SP');
  const [cDest, setCDest] = useState('Fernando de Noronha ou Paraty');
  const [cStart, setCStart] = useState(
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  );
  const [cEnd, setCEnd] = useState(
    new Date(Date.now() + 35 * 86400000).toISOString().slice(0, 10)
  );
  const [cTravelers, setCTravelers] = useState('2');
  const [cBudget, setCBudget] = useState('8500');
  const [cStyle, setCStyle] = useState('Experiência completa (voos + pousada + passeios)');
  const [cNotes, setCNotes] = useState('');
  const [sendingConcierge, setSendingConcierge] = useState(false);
  const [conciergeCode, setConciergeCode] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/travel/status')
      .then((r) => r.json())
      .then((d) => setIntegrations(d.integrations || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const costCents = Math.max(0, Math.round(Number(simSupplierBrl || 0) * 100));
    fetch('/api/pricing/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: simCategory, supplierCostCents: costCents }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.breakdown) setSimBreakdown(d.breakdown);
      })
      .catch(() => {});
  }, [simCategory, simSupplierBrl]);

  const handleSearchFlights = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearchingFlights(true);
    try {
      const res = await apiFetch<NonNullable<typeof flightResponse>>('/api/travel/search', {
        method: 'POST',
        body: JSON.stringify({
          tripType,
          originIata,
          destinationIata: destIata,
          departureDate,
          returnDate: tripType === 'round_trip' ? returnDate : undefined,
          adults: Number(adults),
          maxPriceBrl: Number(maxPriceBrl),
          madrugadaOnly,
        }),
      });
      setFlightResponse(res);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao consultar voos.', 'error');
    } finally {
      setSearchingFlights(false);
    }
  };

  const handleQuickFlightAlert = async () => {
    if (!dbUser) {
      await requestLogin();
      return;
    }
    try {
      await apiFetch('/api/tourist/flight-alerts', {
        method: 'POST',
        body: JSON.stringify({
          originIata,
          destinationIata: destIata,
          targetPriceBrl: Number(maxPriceBrl),
          includeMadrugada: true,
        }),
      });
      notify(`Alerta Radar ${originIata} → ${destIata} salvo em Minhas Viagens!`, 'success');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao registrar alerta.', 'error');
    }
  };

  const handleConciergeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbUser) {
      await requestLogin();
      return;
    }
    setSendingConcierge(true);
    try {
      const res = await apiFetch<{ request: { requestCode: string } }>('/api/concierge', {
        method: 'POST',
        body: JSON.stringify({
          originCity: cOrigin,
          destinationPref: cDest,
          startDate: cStart,
          endDate: cEnd,
          travelersCount: Number(cTravelers),
          budgetBrl: Number(cBudget),
          tripStyle: cStyle,
          notes: cNotes,
        }),
      });
      setConciergeCode(res.request.requestCode);
      notify(`Solicitação ${res.request.requestCode} registrada!`, 'success');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao enviar solicitação.', 'error');
    } finally {
      setSendingConcierge(false);
    }
  };

  return (
    <div className="space-y-20">
      {/* MÓDULO 5 — FROC ROTA VIAGENS */}
      <section id="viagens" className="scroll-mt-24">
        <div className="max-w-3xl mb-8">
          <div className="text-xs font-bold uppercase tracking-wider text-[#FF1493]">
            ✈️ Módulo 05 · Passagens Aéreas, Radar da Madrugada &amp; Transparência Tarifária
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold text-[#111111] mt-1 tracking-tight">
            {t.travelsTitle}
          </h2>
          <p className="text-sm text-[#111111]/75 mt-2 leading-relaxed">
            Conectado ao motor financeiro configurável da Froc Rota e à API de voos oficiais
            (Amadeus / Duffel) com prevenção anti-duplicidade via Idempotency-Key. Jamais exibimos
            tarifas fictícias sem resposta real do provedor.
          </p>
        </div>

        <div className="froc-luminous-border rounded-2xl bg-white p-6 md:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-white border-2 border-[#111111]/15">
              {[
                { id: 'one_way', label: 'Somente Ida' },
                { id: 'round_trip', label: 'Ida e Volta' },
                { id: 'multi_city', label: 'Multi-trecho' },
              ].map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setTripType(mode.id as typeof tripType)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    tripType === mode.id
                      ? 'bg-[#111111] text-[#39FF14]'
                      : 'text-[#111111]/70 hover:text-[#111111]'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-bold text-[#111111] px-3 py-1.5 rounded-xl border border-[#FF1493]/40 bg-[#FF1493]/5 cursor-pointer">
              <input
                type="checkbox"
                checked={madrugadaOnly}
                onChange={(e) => setMadrugadaOnly(e.target.checked)}
                className="accent-[#FF1493]"
              />
              <Moon className="w-3.5 h-3.5 text-[#FF1493]" />
              <span>🌙 Priorizar Radar da Madrugada (00h–05h59)</span>
            </label>
          </div>

          <form
            onSubmit={handleSearchFlights}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-bold text-[#111111] mb-1">Origem (IATA)</label>
              <input
                required
                maxLength={3}
                value={originIata}
                onChange={(e) => setOriginIata(e.target.value.toUpperCase())}
                className="w-full px-3 py-2.5 rounded-xl border-2 border-[#111111]/15 text-sm font-mono-tabular uppercase font-bold focus:border-[#111111] outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#111111] mb-1">Destino (IATA)</label>
              <input
                required
                maxLength={3}
                value={destIata}
                onChange={(e) => setDestIata(e.target.value.toUpperCase())}
                className="w-full px-3 py-2.5 rounded-xl border-2 border-[#111111]/15 text-sm font-mono-tabular uppercase font-bold focus:border-[#111111] outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#111111] mb-1">Data de ida</label>
              <input
                required
                type="date"
                value={departureDate}
                onChange={(e) => setDepartureDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border-2 border-[#111111]/15 text-sm focus:border-[#111111] outline-none"
              />
            </div>
            {tripType === 'round_trip' && (
              <div>
                <label className="block text-xs font-bold text-[#111111] mb-1">Data de volta</label>
                <input
                  type="date"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-[#111111]/15 text-sm focus:border-[#111111] outline-none"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-[#111111] mb-1">Passageiros / Teto R$</label>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={9}
                  value={adults}
                  onChange={(e) => setAdults(e.target.value)}
                  className="w-16 px-2.5 py-2.5 rounded-xl border-2 border-[#111111]/15 text-sm font-mono-tabular focus:border-[#111111] outline-none"
                />
                <input
                  type="number"
                  min={200}
                  value={maxPriceBrl}
                  onChange={(e) => setMaxPriceBrl(e.target.value)}
                  className="flex-1 px-2.5 py-2.5 rounded-xl border-2 border-[#111111]/15 text-sm font-mono-tabular focus:border-[#111111] outline-none"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={searchingFlights}
                className="froc-btn-neon flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs whitespace-nowrap"
              >
                <Plane className="w-3.5 h-3.5" />
                <span>{searchingFlights ? 'Consultando...' : 'Consultar'}</span>
              </button>
              <button
                type="button"
                onClick={handleQuickFlightAlert}
                title="Criar alerta de queda de preço"
                className="froc-btn-pink inline-flex items-center justify-center px-3 py-2.5 rounded-xl"
              >
                <BellRing className="w-4 h-4" />
              </button>
            </div>
          </form>

          {flightResponse && (
            <div className="p-4 rounded-xl bg-white border-2 border-[#111111]/15 text-xs space-y-2">
              {flightResponse.connected && flightResponse.offers.length > 0 ? (
                <div className="space-y-2">
                  <div className="font-bold text-[#111111] flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#39FF14]" />
                    <span>Ofertas reais retornadas via {flightResponse.provider}:</span>
                  </div>
                  {flightResponse.mode === 'test' && (
                    <div className="p-2.5 rounded-lg bg-[#FFD700]/20 border border-[#111111]/20 font-semibold text-[#111111]">
                      {flightResponse.message}
                    </div>
                  )}
                  {flightResponse.offers.map((offer, idx) => {
                    const hora = (iso?: string | null) => (iso ? iso.slice(11, 16) : '--:--');
                    const dia = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
                    return (
                      <div
                        key={offer.id || idx}
                        className="p-3 rounded-xl bg-white border-2 border-[#39FF14] flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="space-y-0.5">
                          <div className="font-bold text-[#111111]">
                            {offer.airline || 'Companhia aérea'}
                            {offer.flightNumbers?.length ? (
                              <span className="font-mono-tabular font-normal text-[#111111]/65"> · {offer.flightNumbers.join(' + ')}</span>
                            ) : null}
                          </div>
                          {offer.departureAt && (
                            <div className="font-mono-tabular text-[#111111]/80">
                              {dia(offer.departureAt)} {offer.origin} {hora(offer.departureAt)} → {offer.destination}{' '}
                              {hora(offer.arrivalAt)} ·{' '}
                              {offer.stops ? `${offer.stops} parada${offer.stops > 1 ? 's' : ''}` : 'direto'}
                              {offer.returnDepartureAt ? ` · volta ${dia(offer.returnDepartureAt)} ${hora(offer.returnDepartureAt)}` : ''}
                            </div>
                          )}
                        </div>
                        <div className="text-right font-mono-tabular">
                          {offer.finalClientCents ? (
                            <>
                              <div className="text-sm font-extrabold text-[#111111]">
                                {formatMoney(offer.finalClientCents, 'BRL')}
                              </div>
                              <div className="text-[10px] text-[#111111]/65">
                                inclui taxa Froc Rota {formatMoney(offer.platformFeeCents ?? 0, 'BRL')}
                              </div>
                              {offer.fxRate ? (
                                <div className="text-[10px] text-[#111111]/65">
                                  tarifa {offer.price?.currency} {offer.price?.total} × câmbio BC{' '}
                                  {offer.fxRate.toFixed(4).replace('.', ',')} ({offer.fxDate?.split('-').reverse().join('/')})
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <div className="text-sm font-extrabold text-[#111111]">
                              {offer.price?.currency} {offer.price?.total}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[#111111]/80">
                  <strong className="text-[#111111]">Status real da integração aérea: </strong>
                  {flightResponse.message}
                </div>
              )}
            </div>
          )}

          {/* Live Transparent Pricing Simulator */}
          <div className="froc-gold-frame p-4 md:p-5 rounded-xl bg-white space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold text-[#111111] inline-flex items-center gap-1.5">
                <Calculator className="w-4 h-4 text-[#111111]" />
                <span>⚡ Simulador Transparente do Motor de Precificação Froc Rota</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <select
                  value={simCategory}
                  onChange={(e) => {
                    const next = e.target.value as typeof simCategory;
                    setSimCategory(next);
                    if (next === 'accommodation') setSimSupplierBrl('100');
                    if (next === 'flights') setSimSupplierBrl('1000');
                  }}
                  className="px-2.5 py-1.5 rounded-lg border-2 border-[#111111]/15 bg-white text-xs font-semibold"
                >
                  <option value="flights">Passagem Aérea (+R$ 200)</option>
                  <option value="accommodation">Hospedagem (+R$ 50)</option>
                  <option value="experience">Passeios / Serviços (12%)</option>
                </select>
                <input
                  type="number"
                  min={50}
                  value={simSupplierBrl}
                  onChange={(e) => setSimSupplierBrl(e.target.value)}
                  className="w-28 px-2.5 py-1.5 rounded-lg border-2 border-[#111111]/15 bg-white text-xs font-mono-tabular font-bold"
                />
              </div>
            </div>
            {simBreakdown && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono-tabular pt-1">
                <div>
                  <span className="text-[#111111]/60 block">Custo fornecedor</span>
                  <strong className="text-[#111111]">{formatMoney(simBreakdown.supplierCostCents, currency)}</strong>
                </div>
                <div>
                  <span className="text-[#111111]/60 block">Taxa / Markup Froc Rota</span>
                  <strong className="text-[#FF1493]">+{formatMoney(simBreakdown.platformRemunerationCents, currency)}</strong>
                </div>
                <div>
                  <span className="text-[#111111]/60 block">Regra aplicada</span>
                  <strong className="text-[#111111]">{simBreakdown.ruleCode}</strong>
                </div>
                <div>
                  <span className="text-[#111111]/60 block">Valor Final ao Cliente</span>
                  <strong className="inline-block px-2 py-0.5 rounded bg-[#39FF14] text-[#111111]">
                    {formatMoney(simBreakdown.finalClientCents, currency)}
                  </strong>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-[#111111]/10">
            {integrations.map((item) => (
              <div
                key={item.provider}
                className="p-4 rounded-xl bg-white border-2 border-[#111111]/10 hover:border-[#39FF14] transition-colors text-xs space-y-1.5"
              >
                <div className="font-extrabold text-[#111111]">{item.provider}</div>
                <div className={item.configured ? 'inline-block px-2 py-0.5 rounded bg-[#39FF14] text-[#111111] font-bold text-[10px]' : 'inline-block px-2 py-0.5 rounded bg-[#FFD700] text-[#111111] font-bold text-[10px]'}>
                  {item.configured ? 'API ativa no servidor' : 'Aguardando credenciais'}
                </div>
                <p className="text-[#111111]/70 leading-relaxed">{item.notes}</p>
                <a
                  href={item.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#111111] font-bold hover:text-[#FF1493] pt-1"
                >
                  <span>Documentação oficial</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MÓDULO 6 — FROC ROTA CONCIERGE */}
      <section id="concierge" className="scroll-mt-24">
        <div className="rounded-2xl bg-[#111111] border-2 border-[#FFD700] text-white p-8 md:p-12 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start shadow-xl">
          <div className="lg:col-span-5 space-y-4">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#FFD700] text-[#111111] text-[11px] font-extrabold uppercase tracking-wider">
              👑 Módulo 06 · Organização Completa Sob Medida
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold leading-tight">
              {t.conciergeTitle}
            </h2>
            <p className="text-sm text-white/80 leading-relaxed">
              Contrate a equipe Froc Rota para coordenar passagens, hospedagens, passeios náuticos,
              reservas gastronômicas e transfers em uma proposta única com suporte dedicado durante
              toda a viagem.
            </p>
            <div className="pt-4 space-y-2.5 text-xs text-white/90">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#39FF14] shrink-0" />
                <span>Curadoria personalizada e conciliação de fornecedores verificados</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#FFD700] shrink-0" />
                <span>Orçamento centralizado com acompanhamento direto em Minhas Viagens</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 bg-white text-[#111111] rounded-2xl border-2 border-[#39FF14] p-6 md:p-8">
            {conciergeCode ? (
              <div className="py-6 space-y-3">
                <div className="inline-block px-2.5 py-1 rounded bg-[#39FF14] text-[#111111] text-xs font-mono-tabular font-bold">
                  Solicitação {conciergeCode} registrada
                </div>
                <h3 className="text-xl font-extrabold">Recebemos seu briefing de viagem</h3>
                <p className="text-sm text-[#111111]/75">
                  Nossa equipe de concierge já pode visualizar sua solicitação no painel e enviar o
                  orçamento completo para você acompanhar em <strong>Minhas Viagens</strong>.
                </p>
                <button
                  type="button"
                  onClick={() => setConciergeCode(null)}
                  className="froc-btn-neon px-4 py-2.5 rounded-xl text-xs font-bold"
                >
                  Enviar outra solicitação
                </button>
              </div>
            ) : (
              <form onSubmit={handleConciergeSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold mb-1">Cidade de origem</label>
                    <input
                      required
                      value={cOrigin}
                      onChange={(e) => setCOrigin(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border-2 border-[#111111]/15 text-sm focus:border-[#111111] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Destino desejado</label>
                    <input
                      required
                      value={cDest}
                      onChange={(e) => setCDest(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border-2 border-[#111111]/15 text-sm focus:border-[#111111] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Ida</label>
                    <input
                      required
                      type="date"
                      value={cStart}
                      onChange={(e) => setCStart(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border-2 border-[#111111]/15 text-sm focus:border-[#111111] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Volta</label>
                    <input
                      required
                      type="date"
                      value={cEnd}
                      onChange={(e) => setCEnd(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border-2 border-[#111111]/15 text-sm focus:border-[#111111] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Viajantes</label>
                    <input
                      required
                      type="number"
                      min={1}
                      value={cTravelers}
                      onChange={(e) => setCTravelers(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border-2 border-[#111111]/15 text-sm font-mono-tabular focus:border-[#111111] outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">
                      Orçamento estimado (R$)
                    </label>
                    <input
                      required
                      type="number"
                      min={500}
                      value={cBudget}
                      onChange={(e) => setCBudget(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border-2 border-[#111111]/15 text-sm font-mono-tabular focus:border-[#111111] outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">Estilo da viagem</label>
                  <select
                    value={cStyle}
                    onChange={(e) => setCStyle(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border-2 border-[#111111]/15 text-sm bg-white focus:border-[#111111] outline-none"
                  >
                    <option value="Experiência completa (voos + pousada + passeios)">
                      Experiência completa (voos + pousada + passeios)
                    </option>
                    <option value="Lua de mel / Boutique">Lua de mel / Boutique</option>
                    <option value="Família com crianças">Família com crianças</option>
                    <option value="Aventura e Ecoturismo">Aventura e Ecoturismo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">
                    Preferências e detalhes especiais
                  </label>
                  <textarea
                    rows={2}
                    value={cNotes}
                    onChange={(e) => setCNotes(e.target.value)}
                    placeholder="Ex.: preferência por pousada pé na areia, passeio privativo de lancha..."
                    className="w-full px-3 py-2 rounded-xl border-2 border-[#111111]/15 text-sm focus:border-[#111111] outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={sendingConcierge}
                  className="froc-btn-neon w-full py-3 rounded-xl text-sm font-extrabold"
                >
                  {sendingConcierge
                    ? 'Registrando briefing...'
                    : dbUser
                    ? '✨ Solicitar Proposta Froc Rota Concierge'
                    : 'Entrar e Solicitar Concierge'}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
