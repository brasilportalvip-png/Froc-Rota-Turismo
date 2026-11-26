import React, { useEffect, useState } from 'react';
import { BellRing, Moon, Plane, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { CampoAeroporto } from './CampoAeroporto.tsx';
import { FlightOffers, type OfertaVoo } from './FlightOffers.tsx';
import { formatMoney, TRANSLATIONS } from '../i18n/translations.ts';


export const TravelAndConciergeSection: React.FC = () => {
  const { apiFetch, dbUser, language, requestLogin, notify } = useApp();
  const t = TRANSLATIONS[language];

  // Travel search state
  const [tripType, setTripType] = useState<'one_way' | 'round_trip' | 'multi_city'>('round_trip');
  const [originIata, setOriginIata] = useState('SAO');
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
  // Semáforo de preços dos dias perto da data escolhida
  const [semaforo, setSemaforo] = useState<{
    loading: boolean;
    dias: Array<{ date: string; minCents: number | null; cor: 'verde' | 'laranja' | 'vermelho' | null }>;
    para: string;
  } | null>(null);
  const [searchingFlights, setSearchingFlights] = useState(false);
  const [flightResponse, setFlightResponse] = useState<{
    connected: boolean;
    provider?: string;
    message?: string;
    mode?: 'test' | 'live' | null;
    offers: OfertaVoo[];
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

  const buscarSemaforo = async (dep: string, ret: string | undefined) => {
    const para = `${originIata}-${destIata}-${dep}-${ret ?? ''}-${adults}`;
    setSemaforo({ loading: true, dias: [], para: dep });
    try {
      const r = await apiFetch<{ available: boolean; dias: NonNullable<typeof semaforo>['dias'] }>('/api/travel/calendar', {
        method: 'POST',
        body: JSON.stringify({ originIata, destinationIata: destIata, departureDate: dep, returnDate: ret, adults: Number(adults) }),
      });
      setSemaforo(r.available && r.dias.some((d) => d.cor) ? { loading: false, dias: r.dias, para: dep } : null);
    } catch {
      setSemaforo(null);
    }
    return para;
  };

  const pesquisar = async (dep: string, ret: string | undefined) => {
    if (originIata === destIata) {
      notify('Origem e destino são iguais. Escolha outra cidade.', 'error');
      return;
    }
    setSearchingFlights(true);
    void buscarSemaforo(dep, ret);
    try {
      const res = await apiFetch<NonNullable<typeof flightResponse>>('/api/travel/search', {
        method: 'POST',
        body: JSON.stringify({
          tripType,
          originIata,
          destinationIata: destIata,
          departureDate: dep,
          returnDate: ret,
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

  const handleSearchFlights = async (e: React.FormEvent) => {
    e.preventDefault();
    await pesquisar(departureDate, tripType === 'round_trip' ? returnDate : undefined);
  };

  // Tocar num dia do semáforo: pesquisa aquele dia (a volta anda junto, mantendo os dias de viagem).
  const escolherDia = (dia: string) => {
    let ret: string | undefined;
    if (tripType === 'round_trip') {
      const estadia = Math.round((Date.parse(returnDate) - Date.parse(departureDate)) / 86400000);
      ret = new Date(Date.parse(`${dia}T12:00:00Z`) + Math.max(0, estadia) * 86400000).toISOString().slice(0, 10);
      setReturnDate(ret);
    }
    setDepartureDate(dia);
    void pesquisar(dia, ret);
  };

  // "Quero este voo": abre um atendimento com todos os detalhes; a equipe confirma e emite a passagem.
  const [escolhendoVoo, setEscolhendoVoo] = useState<string | null>(null);
  const escolherVoo = async (oferta: OfertaVoo, resumo: string) => {
    if (!dbUser) {
      await requestLogin();
      return;
    }
    const t = oferta.slices?.[0];
    setEscolhendoVoo(oferta.id || 'x');
    try {
      const conv = await apiFetch<{ conversation: { id: number } }>('/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({
          subject: `Passagem ${t ? `${t.origin} → ${t.destination} ${t.departureAt.slice(8, 10)}/${t.departureAt.slice(5, 7)}` : ''}`.trim(),
          channel: 'tourist',
        }),
      });
      await apiFetch(`/api/chat/conversations/${conv.conversation.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text: resumo, requestHumanHandoff: true }),
      });
      notify('Pedido enviado! Um atendente confirma o voo e a emissão com você pelo chat.', 'success');
      window.dispatchEvent(new Event('froc-abrir-chat'));
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Não foi possível enviar o pedido.', 'error');
    } finally {
      setEscolhendoVoo(null);
    }
  };

  const COR = {
    verde: { bg: 'bg-[#16a34a]', soft: 'bg-[#16a34a]/10 border-[#16a34a]', txt: 'text-[#15803d]', label: 'Mais barato' },
    laranja: { bg: 'bg-[#f59e0b]', soft: 'bg-[#f59e0b]/10 border-[#f59e0b]', txt: 'text-[#b45309]', label: 'Preço médio' },
    vermelho: { bg: 'bg-[#dc2626]', soft: 'bg-[#dc2626]/10 border-[#dc2626]', txt: 'text-[#b91c1c]', label: 'Acima do preço' },
  } as const;
  const corDaData = semaforo && !semaforo.loading ? semaforo.dias.find((d) => d.date === departureDate)?.cor ?? null : null;

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
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-start"
          >
            <div className="sm:col-span-2 lg:col-span-6 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 items-end">
              <CampoAeroporto label="Saindo de" value={originIata} onChange={setOriginIata} placeholder="De onde você sai? Ex.: São Paulo" testId="campo-origem" />
              <button
                type="button"
                onClick={() => {
                  setOriginIata(destIata);
                  setDestIata(originIata);
                }}
                title="Inverter origem e destino"
                aria-label="Inverter origem e destino"
                className="min-h-[48px] px-3 rounded-xl border-2 border-[#111111]/15 text-lg font-bold text-[#111111] hover:border-[#111111]"
              >
                ⇄
              </button>
              <CampoAeroporto label="Indo para" value={destIata} onChange={setDestIata} placeholder="Para onde você vai? Ex.: Natal" testId="campo-destino" />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#111111] mb-1">Data de ida</label>
              <input
                required
                type="date"
                value={departureDate}
                min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                onChange={(e) => {
                  const ida = e.target.value;
                  setDepartureDate(ida);
                  // volta nunca antes da ida
                  if (ida && returnDate < ida) {
                    setReturnDate(new Date(Date.parse(`${ida}T12:00:00Z`) + 5 * 86400000).toISOString().slice(0, 10));
                  }
                }}
                className={`w-full px-3 py-2.5 rounded-xl border-2 text-sm focus:border-[#111111] outline-none ${
                  corDaData ? COR[corDaData].soft : 'border-[#111111]/15'
                }`}
                data-testid="data-ida"
                data-cor={corDaData ?? ''}
              />
              {corDaData && (
                <span className={`mt-1 inline-flex items-center gap-1 text-[11px] font-bold ${COR[corDaData].txt}`}>
                  <span className={`w-2.5 h-2.5 rounded-full ${COR[corDaData].bg}`} />
                  {COR[corDaData].label}
                </span>
              )}
            </div>
            {tripType === 'round_trip' && (
              <div>
                <label className="block text-xs font-bold text-[#111111] mb-1">Data de volta</label>
                <input
                  type="date"
                  value={returnDate}
                  min={departureDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-[#111111]/15 text-sm focus:border-[#111111] outline-none"
                />
              </div>
            )}
            <div className="lg:col-span-2">
              <label className="block text-xs font-bold text-[#111111] mb-1">Passageiros / Até R$</label>
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
            <div className={`flex gap-2 sm:mt-5 ${tripType === 'round_trip' ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
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

          {semaforo && (
            <div className="space-y-2" data-testid="semaforo">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-extrabold text-[#111111]">Preço por dia de ida (dias próximos)</div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-[#111111]/75">
                  {(['verde', 'laranja', 'vermelho'] as const).map((c) => (
                    <span key={c} className="inline-flex items-center gap-1">
                      <span className={`w-2.5 h-2.5 rounded-full ${COR[c].bg}`} />
                      {COR[c].label}
                    </span>
                  ))}
                </div>
              </div>
              {semaforo.loading ? (
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="h-[74px] rounded-xl bg-[#111111]/5 animate-pulse" />
                  ))}
                  <p className="col-span-full text-[11px] text-[#111111]/60">Comparando os preços dos dias próximos…</p>
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                  {semaforo.dias.map((d) => {
                    const dt = new Date(`${d.date}T12:00:00Z`);
                    const sel = d.date === departureDate;
                    return (
                      <button
                        key={d.date}
                        type="button"
                        disabled={!d.minCents || searchingFlights}
                        onClick={() => escolherDia(d.date)}
                        data-cor={d.cor ?? ''}
                        className={`relative rounded-xl border-2 px-2 py-2 text-left transition-transform disabled:opacity-50 ${
                          d.cor ? COR[d.cor].soft : 'border-[#111111]/15 bg-white'
                        } ${sel ? 'ring-2 ring-[#111111] ring-offset-1 scale-[1.03]' : 'hover:-translate-y-0.5'}`}
                      >
                        {d.cor && <span className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full ${COR[d.cor].bg}`} />}
                        <span className="block text-[10px] font-bold uppercase text-[#111111]/60">
                          {dt.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')}
                        </span>
                        <span className="block text-sm font-extrabold text-[#111111]">
                          {dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })}
                        </span>
                        <span className={`block text-[11px] font-bold ${d.cor ? COR[d.cor].txt : 'text-[#111111]/50'}`}>
                          {d.minCents ? formatMoney(d.minCents, 'BRL') : 'sem voo'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-[10px] text-[#111111]/55">
                Cores comparam o menor preço de cada dia com os dias vizinhos (valor total para {adults} passageiro{Number(adults) > 1 ? 's' : ''}{tripType === 'round_trip' ? ', ida e volta com a mesma duração' : ''}). Toque num dia para ver os voos dele.
              </p>
            </div>
          )}

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
                  <FlightOffers
                    offers={flightResponse.offers}
                    formatMoney={formatMoney}
                    passageiros={Number(adults) || 1}
                    onEscolher={escolherVoo}
                    escolhendo={escolhendoVoo}
                  />
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
