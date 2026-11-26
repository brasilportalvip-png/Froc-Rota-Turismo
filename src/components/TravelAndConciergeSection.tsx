import React, { useEffect, useState } from 'react';
import { BellRing, Moon, Plane, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { formatMoney, TRANSLATIONS } from '../i18n/translations.ts';


export const TravelAndConciergeSection: React.FC = () => {
  const { apiFetch, dbUser, language, requestLogin, notify } = useApp();
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
    }>;
  } | null>(null);

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

  // Links das páginas de destino/blog: ?voo=REC abre a busca já com o destino; ?concierge=Paraty preenche o roteiro.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const voo = (params.get('voo') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    const conc = (params.get('concierge') || '').slice(0, 80);
    if (voo.length === 3) {
      setDestIata(voo);
      setTimeout(() => document.getElementById('viagens')?.scrollIntoView({ behavior: 'smooth' }), 600);
    }
    if (conc) {
      setCDest(conc);
      setTimeout(() => document.getElementById('concierge')?.scrollIntoView({ behavior: 'smooth' }), 600);
    }
    // Sugestões da IA (pop-up de oportunidade) preenchem a busca sem recarregar a página.
    const onVoo = (e: Event) => {
      const iata = String((e as CustomEvent<{ iata?: string }>).detail?.iata || '').toUpperCase().slice(0, 3);
      if (/^[A-Z]{3}$/.test(iata)) setDestIata(iata);
    };
    const onConcierge = (e: Event) => {
      const d = String((e as CustomEvent<{ destino?: string }>).detail?.destino || '').slice(0, 80);
      if (d) setCDest(d);
    };
    window.addEventListener('froc-voo', onVoo);
    window.addEventListener('froc-concierge', onConcierge);
    return () => {
      window.removeEventListener('froc-voo', onVoo);
      window.removeEventListener('froc-concierge', onConcierge);
    };
  }, []);
  const [conciergeCode, setConciergeCode] = useState<string | null>(null);

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
            ✈️ Passagens aéreas em reais
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold text-[#111111] mt-1 tracking-tight">
            {t.travelsTitle}
          </h2>
          <p className="text-sm text-[#111111]/75 mt-2 leading-relaxed">
            Compare voos com o preço final em reais, já com tudo incluído. As tarifas vêm direto
            das companhias aéreas no momento da busca — nada de preço inventado.
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
                    <span>Voos encontrados:</span>
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
                              <div className="text-[10px] text-[#111111]/65">preço final, taxas incluídas</div>
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
                  {flightResponse.message}
                </div>
              )}
            </div>
          )}

        </div>
      </section>

      {/* MÓDULO 6 — FROC ROTA CONCIERGE */}
      <section id="concierge" className="scroll-mt-24">
        <div className="rounded-2xl bg-[#111111] border-2 border-[#FFD700] text-white p-8 md:p-12 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start shadow-xl">
          <div className="lg:col-span-5 space-y-4">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#FFD700] text-[#111111] text-[11px] font-extrabold uppercase tracking-wider">
              👑 Viagem completa sob medida
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
