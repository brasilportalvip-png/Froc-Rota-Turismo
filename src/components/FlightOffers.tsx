import React, { useMemo, useState } from 'react';
import { Eye, EyeOff, Plane } from 'lucide-react';
import { acharAeroporto } from '../../api/_lib/aeroportos.ts';

/** Resultado de voos no estilo dos grandes buscadores: ida e volta completas, escalas, espera e troca de avião. */

export interface SegmentoVoo {
  origin: string;
  originName: string;
  originCity: string;
  destination: string;
  destinationName: string;
  destinationCity: string;
  departureAt: string;
  arrivalAt: string;
  durationMin: number;
  carrier: string;
  carrierIata: string;
  flightNumber: string;
  operatedBy: string | null;
  aircraft: string | null;
  technicalStops: Array<{ airport: string; city: string; durationMin: number }>;
}
export interface EscalaVoo {
  airport: string;
  airportName: string;
  city: string;
  durationMin: number;
  changeAircraft: boolean;
  changeAirport: boolean;
  nextAirport: string;
  overnight: boolean;
}
export interface TrechoVoo {
  origin: string;
  originCity: string;
  destination: string;
  destinationCity: string;
  departureAt: string;
  arrivalAt: string;
  durationMin: number;
  stops: number;
  segments: SegmentoVoo[];
  layovers: EscalaVoo[];
}
export interface OfertaVoo {
  id?: string;
  airline?: string;
  finalClientCents?: number | null;
  price?: { total?: string; currency?: string };
  slices?: TrechoVoo[];
  totalDurationMin?: number;
  // formato antigo (sem detalhe), ainda aceito
  departureAt?: string;
  arrivalAt?: string;
  origin?: string;
  destination?: string;
  stops?: number;
  flightNumbers?: string[];
  returnDepartureAt?: string | null;
}

type Ordem = 'melhor' | 'barato' | 'rapido';

export const duracao = (min: number) => {
  if (!min || min < 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${String(m).padStart(2, '0')}min` : ''}` : `${m}min`;
};
const hora = (iso?: string) => (iso ? iso.slice(11, 16) : '--:--');
const dataCurta = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d
    .toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
    .replace('.', '');
};
const diasDepois = (a?: string, b?: string) => {
  if (!a || !b) return 0;
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86400000);
};
const cidade = (codigo: string, fallback: string) => {
  const a = acharAeroporto(codigo);
  return a && !a.todos ? a.cidade : fallback || codigo;
};

/** Texto curto das escalas: "Direto", "1 escala · Brasília (BSB)", "2 escalas · BSB, GRU". */
export function resumoEscalas(t: TrechoVoo): string {
  const tecnicas = t.segments.flatMap((s) => s.technicalStops.map((x) => x.airport));
  const lugares = [...t.layovers.map((l) => l.airport), ...tecnicas];
  if (!lugares.length) return 'Direto';
  if (lugares.length === 1) {
    const l = t.layovers[0];
    return `1 escala · ${l ? `${cidade(l.airport, l.city)} (${l.airport})` : lugares[0]}`;
  }
  return `${lugares.length} escalas · ${lugares.join(', ')}`;
}

const Trecho: React.FC<{ rotulo: string; t: TrechoVoo }> = ({ rotulo, t }) => {
  const mais = diasDepois(t.departureAt, t.arrivalAt);
  const direto = t.layovers.length === 0 && t.segments.every((s) => s.technicalStops.length === 0);
  const cias = [...new Set(t.segments.map((s) => s.carrier).filter(Boolean))].join(' + ');
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[64px_1fr_auto] gap-x-3 gap-y-1 items-center">
      <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#111111]/55 flex sm:block items-baseline gap-1.5">
        {rotulo}
        <div className="normal-case tracking-normal font-semibold text-[11px] text-[#111111]/70">{dataCurta(t.departureAt)}</div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="text-right shrink-0">
          <div className="text-base sm:text-lg whitespace-nowrap font-extrabold text-[#111111] leading-none font-mono-tabular">{hora(t.departureAt)}</div>
          <div className="text-[11px] font-bold text-[#111111]/70">{t.origin}</div>
        </div>
        <div className="flex-1 min-w-0 text-center">
          <div className="text-[11px] font-semibold text-[#111111]/70">{duracao(t.durationMin)}</div>
          <div className="relative h-[2px] bg-[#111111]/30 my-1">
            {t.layovers.map((l, i) => (
              <span
                key={l.airport + i}
                className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#dc2626] border border-white"
                style={{ left: `${((i + 1) / (t.layovers.length + 1)) * 100}%` }}
                title={`Escala em ${l.airport}`}
              />
            ))}
          </div>
          <div className={`text-[11px] font-bold ${direto ? 'text-[#15803d]' : 'text-[#b45309]'}`} data-testid="resumo-escalas">
            {resumoEscalas(t)}
          </div>
        </div>
        <div className="shrink-0">
          <div className="text-base sm:text-lg whitespace-nowrap font-extrabold text-[#111111] leading-none font-mono-tabular">
            {hora(t.arrivalAt)}
            {mais > 0 && <sup className="text-[10px] text-[#dc2626] font-bold ml-0.5">+{mais}</sup>}
          </div>
          <div className="text-[11px] font-bold text-[#111111]/70">{t.destination}</div>
        </div>
      </div>
      <div className="text-[11px] text-[#111111]/70 sm:text-right truncate">{cias}</div>
    </div>
  );
};

const Detalhe: React.FC<{ rotulo: string; t: TrechoVoo }> = ({ rotulo, t }) => (
  <div className="space-y-2">
    <div className="text-[11px] font-extrabold uppercase tracking-wider text-[#111111]">
      {rotulo}: {cidade(t.origin, t.originCity)} → {cidade(t.destination, t.destinationCity)} · {dataCurta(t.departureAt)} · duração total{' '}
      {duracao(t.durationMin)}
    </div>
    <ol className="space-y-2">
      {t.segments.map((s, i) => (
        <li key={s.flightNumber + i} className="space-y-2">
          <div className="p-3 rounded-lg border border-[#111111]/15 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-[#111111] inline-flex items-center gap-1.5">
                <Plane className="w-3.5 h-3.5" /> {s.carrier || 'Companhia'} · voo {s.flightNumber}
              </span>
              <span className="text-[#111111]/65">
                {s.aircraft ? `Avião: ${s.aircraft}` : ''}
                {s.operatedBy ? ` · operado por ${s.operatedBy}` : ''}
              </span>
            </div>
            <div className="mt-1.5 grid grid-cols-[52px_1fr] gap-x-2 text-xs text-[#111111]">
              <span className="font-mono-tabular font-bold">{hora(s.departureAt)}</span>
              <span>
                <strong>{s.origin}</strong> · {s.originName || cidade(s.origin, s.originCity)}
              </span>
              <span className="font-mono-tabular text-[#111111]/55 text-[11px]">{duracao(s.durationMin)}</span>
              <span className="text-[11px] text-[#111111]/55">
                {s.technicalStops.length
                  ? `Parada técnica em ${s.technicalStops.map((x) => `${x.city || x.airport} (${x.airport}${x.durationMin ? `, ${duracao(x.durationMin)}` : ''})`).join(', ')} — sem trocar de avião`
                  : 'voo sem paradas'}
              </span>
              <span className="font-mono-tabular font-bold">
                {hora(s.arrivalAt)}
                {diasDepois(s.departureAt, s.arrivalAt) > 0 && <sup className="text-[#dc2626]">+{diasDepois(s.departureAt, s.arrivalAt)}</sup>}
              </span>
              <span>
                <strong>{s.destination}</strong> · {s.destinationName || cidade(s.destination, s.destinationCity)}
              </span>
            </div>
          </div>
          {t.layovers[i] && (
            <div
              className={`px-3 py-2 rounded-lg text-xs border ${
                t.layovers[i].changeAirport || t.layovers[i].durationMin > 360 ? 'bg-[#dc2626]/10 border-[#dc2626]/40' : 'bg-[#f59e0b]/10 border-[#f59e0b]/40'
              }`}
              data-testid="escala"
            >
              <strong>
                Conexão em {cidade(t.layovers[i].airport, t.layovers[i].city)} ({t.layovers[i].airport})
              </strong>{' '}
              · espera de {duracao(t.layovers[i].durationMin)} ·{' '}
              {t.layovers[i].changeAircraft ? 'troca de avião' : 'mesmo avião (continua no voo)'}
              {t.layovers[i].changeAirport && (
                <div className="mt-1 font-bold text-[#b91c1c]">
                  Atenção: chega em {t.layovers[i].airport} e o próximo voo sai de {t.layovers[i].nextAirport} — é preciso trocar de aeroporto.
                </div>
              )}
              {t.layovers[i].overnight && <div className="mt-1 font-semibold text-[#b45309]">Espera passa da meia-noite.</div>}
              {!t.layovers[i].changeAirport && t.layovers[i].durationMin > 0 && t.layovers[i].durationMin < 60 && (
                <div className="mt-1 font-semibold text-[#b45309]">Conexão curta: menos de 1 hora para trocar de avião.</div>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  </div>
);

export const FlightOffers: React.FC<{
  offers: OfertaVoo[];
  formatMoney: (cents: number, currency: string) => string;
  passageiros: number;
  onEscolher?: (oferta: OfertaVoo, resumo: string) => void;
  escolhendo?: string | null;
}> = ({ offers, formatMoney, passageiros, onEscolher, escolhendo }) => {
  const [ordem, setOrdem] = useState<Ordem>('melhor');
  const [soDiretos, setSoDiretos] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  const preco = (o: OfertaVoo) => o.finalClientCents ?? Math.round(Number(o.price?.total || 0) * 100);
  const tempo = (o: OfertaVoo) => o.totalDurationMin || (o.slices ?? []).reduce((t, s) => t + s.durationMin, 0);
  const direto = (o: OfertaVoo) => (o.slices?.length ? o.slices.every((s) => s.stops === 0) : !o.stops);

  const { lista, maisBarato, maisRapido, melhor, temDiretos } = useMemo(() => {
    const base = offers.filter((o) => preco(o) > 0);
    const precos = base.map(preco);
    const tempos = base.map(tempo).filter((x) => x > 0);
    const pMin = Math.min(...precos);
    const pMax = Math.max(...precos);
    const tMin = tempos.length ? Math.min(...tempos) : 0;
    const tMax = tempos.length ? Math.max(...tempos) : 0;
    // "Melhor": equilíbrio entre preço (60%) e duração (40%), como fazem os buscadores
    const nota = (o: OfertaVoo) =>
      0.6 * (pMax > pMin ? (preco(o) - pMin) / (pMax - pMin) : 0) + 0.4 * (tMax > tMin && tempo(o) ? (tempo(o) - tMin) / (tMax - tMin) : 0);
    const barato = base.reduce<OfertaVoo | null>((a, o) => (!a || preco(o) < preco(a) ? o : a), null);
    const rapido = base.filter((o) => tempo(o) > 0).reduce<OfertaVoo | null>((a, o) => (!a || tempo(o) < tempo(a) ? o : a), null);
    const melhorO = base.reduce<OfertaVoo | null>((a, o) => (!a || nota(o) < nota(a) ? o : a), null);
    const filtrada = base.filter((o) => (soDiretos ? direto(o) : true));
    const ordenada = [...filtrada].sort((a, b) =>
      ordem === 'barato' ? preco(a) - preco(b) : ordem === 'rapido' ? (tempo(a) || 1e9) - (tempo(b) || 1e9) : nota(a) - nota(b)
    );
    return { lista: ordenada, maisBarato: barato, maisRapido: rapido, melhor: melhorO, temDiretos: base.some(direto) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offers, ordem, soDiretos]);

  const abas: Array<[Ordem, string, OfertaVoo | null]> = [
    ['melhor', 'Melhor opção', melhor],
    ['barato', 'Mais barato', maisBarato],
    ['rapido', 'Mais rápido', maisRapido],
  ];

  return (
    <div className="space-y-3" data-testid="ofertas-voo">
      <div className="grid grid-cols-3 rounded-xl border-2 border-[#111111] overflow-hidden">
        {abas.map(([k, nome, o]) => (
          <button
            key={k}
            type="button"
            onClick={() => setOrdem(k)}
            className={`px-2 py-2.5 text-left border-r last:border-r-0 border-[#111111]/20 ${ordem === k ? 'bg-[#111111] text-white' : 'bg-white text-[#111111]'}`}
          >
            <span className="block text-xs font-extrabold">{nome}</span>
            <span className={`block text-[11px] font-semibold ${ordem === k ? 'text-[#39FF14]' : 'text-[#111111]/65'}`}>
              {o ? `${formatMoney(preco(o), 'BRL')} · ${duracao(tempo(o))}` : '—'}
            </span>
          </button>
        ))}
      </div>
      <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#111111] select-none">
        <input type="checkbox" checked={soDiretos} onChange={(e) => setSoDiretos(e.target.checked)} disabled={!temDiretos} />
        Só voos diretos {temDiretos ? '' : '(nenhum direto nesta data)'}
      </label>

      {lista.map((o, idx) => {
        const id = o.id || String(idx);
        const trechos = o.slices ?? [];
        const selos = [
          o === maisBarato && { t: 'Mais barato', c: 'bg-[#16a34a] text-white' },
          o === maisRapido && { t: 'Mais rápido', c: 'bg-[#2563eb] text-white' },
          o === melhor && o !== maisBarato && o !== maisRapido && { t: 'Melhor opção', c: 'bg-[#111111] text-[#39FF14]' },
          direto(o) && { t: 'Direto', c: 'bg-[#16a34a]/15 text-[#15803d]' },
        ].filter(Boolean) as Array<{ t: string; c: string }>;
        return (
          <article key={id} className="rounded-xl border-2 border-[#111111]/15 bg-white overflow-hidden" data-testid="oferta">
            <div className="p-3 sm:p-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
              <div className="space-y-3">
                {selos.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selos.map((s) => (
                      <span key={s.t} className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wide ${s.c}`}>
                        {s.t}
                      </span>
                    ))}
                  </div>
                )}
                {trechos.length ? (
                  trechos.map((t, i) => <Trecho key={i} rotulo={i === 0 ? 'Ida' : 'Volta'} t={t} />)
                ) : (
                  <div className="text-xs text-[#111111]/80 font-mono-tabular">
                    {o.origin} {hora(o.departureAt)} → {o.destination} {hora(o.arrivalAt)} · {o.stops ? `${o.stops} escala(s)` : 'direto'}
                  </div>
                )}
              </div>
              <div className="md:text-right md:border-l md:pl-4 border-[#111111]/10 flex flex-wrap md:flex-col items-center md:items-end justify-between gap-2">
                <div className="min-w-[120px] flex-1 md:flex-none">
                  <div className="text-xl font-extrabold text-[#111111] font-mono-tabular">{formatMoney(preco(o), 'BRL')}</div>
                  <div className="text-[10px] text-[#111111]/60">
                    total para {passageiros} passageiro{passageiros > 1 ? 's' : ''}, taxas incluídas
                  </div>
                  <div className="text-[11px] font-semibold text-[#111111]/75">{o.airline}</div>
                </div>
                {onEscolher && (
                  <button
                    type="button"
                    disabled={Boolean(escolhendo)}
                    onClick={() => onEscolher(o, textoDaOferta(o, formatMoney(preco(o), 'BRL'), passageiros))}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg froc-btn-neon text-xs font-extrabold whitespace-nowrap disabled:opacity-60"
                  >
                    {escolhendo === id ? 'Enviando…' : 'Quero este voo'}
                  </button>
                )}
                {trechos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAberto(aberto === id ? null : id)}
                    aria-expanded={aberto === id}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border-2 border-[#111111] text-xs font-bold text-[#111111] whitespace-nowrap hover:bg-[#111111]/5"
                  >
                    {aberto === id ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {aberto === id ? 'Fechar detalhes' : 'Ver detalhes do voo'}
                  </button>
                )}
              </div>
            </div>
            {aberto === id && (
              <div className="px-3 sm:px-4 pb-4 pt-1 space-y-4 border-t border-[#111111]/10 bg-[#111111]/[0.02]">
                {trechos.map((t, i) => (
                  <Detalhe key={i} rotulo={i === 0 ? 'Ida' : 'Volta'} t={t} />
                ))}
              </div>
            )}
          </article>
        );
      })}
      {lista.length === 0 && <p className="text-xs text-[#111111]/70">Nenhum voo direto nesta data. Desmarque "Só voos diretos" para ver os com escala.</p>}
    </div>
  );
};

/** Resumo do voo escolhido (vai para o atendimento, que emite a passagem). */
export function textoDaOferta(o: OfertaVoo, preco: string, passageiros: number): string {
  const linhas = [`Quero este voo — ${o.airline ?? 'Companhia'} · ${preco} (total para ${passageiros} passageiro${passageiros > 1 ? 's' : ''}, taxas incluídas)`];
  (o.slices ?? []).forEach((t, i) => {
    linhas.push(
      `${i === 0 ? 'IDA' : 'VOLTA'} ${t.departureAt.slice(8, 10)}/${t.departureAt.slice(5, 7)}: ${t.origin} ${t.departureAt.slice(11, 16)} → ${t.destination} ${t.arrivalAt.slice(11, 16)} · ${resumoEscalas(t)} · voos ${t.segments.map((s) => s.flightNumber).join(' + ')}`
    );
    t.layovers.forEach((l) => linhas.push(`   conexão em ${l.airport}: espera ${duracao(l.durationMin)}${l.changeAircraft ? ', troca de avião' : ''}${l.changeAirport ? `, troca para ${l.nextAirport}` : ''}`));
  });
  if (o.id) linhas.push(`Oferta: ${o.id}`);
  return linhas.join('\n');
}
