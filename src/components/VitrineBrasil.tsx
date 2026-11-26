import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Search, Sparkles } from 'lucide-react';
import { trackInterest } from '../lib/intent.ts';

export interface DestinoVitrine {
  slug: string;
  nome: string;
  uf: string;
  regiao: string;
  categoria: string;
  aeroporto: string;
  resumo: string;
  atrativos: string[];
  appSlug: string | null;
  ofertas: number;
}

const CAT: Record<string, { label: string }> = {
  praia: { label: 'Praias' },
  ilha: { label: 'Ilhas' },
  cachoeira: { label: 'Cachoeiras' },
  parque: { label: 'Parques' },
  historico: { label: 'Históricos' },
  serra: { label: 'Serras' },
  cidade: { label: 'Cidades' },
  ecoturismo: { label: 'Ecoturismo' },
};
interface FotoDestino {
  url500: string;
  url1280: string;
  author: string;
  license: string;
  pageUrl: string;
}
const REGIOES = ['Todas', 'Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];

interface Props {
  onOpenDestination: (appSlug: string) => void;
  onSearch: (term: string) => void;
}

/** Vitrine do Brasil: os destinos reais, por região e tipo, cada um com página própria no Google. */
export const VitrineBrasil: React.FC<Props> = ({ onOpenDestination, onSearch }) => {
  const [destinos, setDestinos] = useState<DestinoVitrine[]>([]);
  const [regiao, setRegiao] = useState('Todas');
  const [cat, setCat] = useState('todas');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [fotos, setFotos] = useState<Record<string, FotoDestino | null>>({});
  const tentativas = useRef(0);
  const [rodada, setRodada] = useState(0);

  useEffect(() => {
    fetch('/api/brasil/destinos')
      .then((r) => (r.ok ? r.json() : { destinos: [] }))
      .then((d: { destinos?: DestinoVitrine[] }) => setDestinos(d.destinos || []))
      .catch(() => setDestinos([]));
  }, []);

  const filtered = useMemo(() => {
    const term = q
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    return destinos.filter((d) => {
      if (regiao !== 'Todas' && d.regiao !== regiao) return false;
      if (cat !== 'todas' && d.categoria !== cat) return false;
      if (term) {
        const hay = `${d.nome} ${d.uf} ${d.resumo} ${d.atrativos.join(' ')}`
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '');
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [destinos, regiao, cat, q]);

  const visible = showAll || q || regiao !== 'Todas' || cat !== 'todas' ? filtered : filtered.slice(0, 12);

  // Fotos reais (Wikimedia Commons) só dos cartões que estão na tela.
  const faltando = visible.map((d) => d.slug).filter((sl) => !(sl in fotos));
  const faltandoKey = faltando.join(',');
  useEffect(() => {
    if (!faltandoKey) return;
    const pedidos = faltandoKey.split(',');
    let vivo = true;
    fetch(`/api/fotos/destinos?slugs=${encodeURIComponent(faltandoKey)}`)
      .then((r) => (r.ok ? r.json() : { fotos: {} }))
      .then((d: { fotos?: Record<string, FotoDestino | null> }) => {
        if (!vivo) return;
        tentativas.current += 1;
        setFotos((prev) => {
          const next = { ...prev };
          for (const sl of pedidos) {
            // O servidor pode devolver só parte (limite de tempo); o resto vem no próximo pedido (até 3 vezes).
            if (d.fotos && sl in d.fotos) next[sl] = d.fotos[sl] ?? null;
            else if (tentativas.current >= 3) next[sl] = null;
          }
          return next;
        });
        if (pedidos.some((sl) => !(d.fotos && sl in d.fotos)) && tentativas.current < 3) {
          window.setTimeout(() => setRodada((r) => r + 1), 1500);
        }
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [faltandoKey, rodada]);

  if (destinos.length === 0) return null;

  return (
    <section id="vitrine-brasil" className="scroll-mt-24 space-y-5" aria-labelledby="vitrine-brasil-title">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <span className="text-xs font-extrabold uppercase tracking-widest text-[#FF1493]">
            Vitrine do Brasil · {destinos.length} destinos
          </span>
          <h2 id="vitrine-brasil-title" className="text-2xl md:text-3xl font-extrabold text-[#111111]">
            Para onde você quer ir?
          </h2>
          <p className="text-sm text-[#111111]/70">
            Do Monte Roraima ao Chuí: praias, ilhas, serras, cachoeiras e cidades históricas, com o que fazer e como
            chegar.
          </p>
        </div>
        <label className="relative w-full md:w-80">
          <span className="sr-only">Buscar destino ou atração</span>
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#111111]/50" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ex.: Cristo Redentor, cachoeira, Bahia…"
            className="w-full pl-9 pr-3 py-2.5 min-h-[44px] rounded-xl border-2 border-[#111111] text-sm bg-white"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Região">
        {REGIOES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={regiao === r}
            onClick={() => setRegiao(r)}
            className={`min-h-[36px] px-3 rounded-full text-xs font-bold border ${
              regiao === r ? 'bg-[#111111] text-[#39FF14] border-[#111111]' : 'bg-white border-[#111111]/20 text-[#111111]'
            }`}
          >
            {r}
          </button>
        ))}
        <span className="w-px bg-[#111111]/15 mx-1" aria-hidden="true" />
        {[['todas', 'Todos'] as const, ...Object.entries(CAT).map(([k, v]) => [k, v.label] as const)].map(
          ([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={cat === k}
              onClick={() => setCat(k)}
              className={`min-h-[36px] px-3 rounded-full text-xs font-bold border ${
                cat === k ? 'bg-[#39FF14] text-[#111111] border-[#111111]' : 'bg-white border-[#111111]/20 text-[#111111]'
              }`}
            >
              {label}
            </button>
          )
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {visible.map((d) => {
          const foto = fotos[d.slug];
          return (
            <article
              key={d.slug}
              className="group rounded-2xl overflow-hidden border-2 border-[#111111] bg-white flex flex-col hover:-translate-y-1 transition-transform"
            >
              <a
                href={`/destinos/${d.slug}`}
                onClick={() => trackInterest(d.slug, 'vitrine')}
                className="relative block aspect-[4/3] bg-[#111111]/10 overflow-hidden"
                aria-label={`Guia de ${d.nome}`}
              >
                {foto ? (
                  <img
                    src={foto.url500}
                    alt={`${d.nome} (${d.uf})`}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : foto === null ? (
                  <span className="absolute inset-0 bg-[#111111]" />
                ) : (
                  <span className="absolute inset-0 animate-pulse bg-[#111111]/10" />
                )}
                <span className="absolute left-3 bottom-3 px-2 py-0.5 rounded-md bg-black/60 text-white text-[10px] font-bold uppercase tracking-wider">
                  {d.regiao} · {d.uf}
                </span>
              </a>
              {foto && (
                <a
                  href={foto.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 pt-1.5 text-[9px] text-[#111111]/55 truncate hover:underline"
                >
                  Foto: {foto.author} · {foto.license} · Wikimedia Commons
                </a>
              )}
              <div className="p-3.5 flex-1 flex flex-col gap-2">
                <h3 className="text-base font-extrabold text-[#111111] leading-tight">
                  <a href={`/destinos/${d.slug}`} onClick={() => trackInterest(d.slug, 'vitrine')} className="hover:underline">
                    {d.nome}
                  </a>
                </h3>
                <p className="text-xs text-[#111111]/75 line-clamp-3">{d.resumo}</p>
                <div className="flex flex-wrap gap-1">
                  {d.atrativos.slice(0, 3).map((a) => (
                    <span key={a} className="px-2 py-0.5 rounded-full bg-[#111111]/5 text-[10px] font-semibold text-[#111111]">
                      {a}
                    </span>
                  ))}
                </div>
                <div className="mt-auto pt-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-[#111111]/70 inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {d.ofertas > 0 ? `${d.ofertas} oferta${d.ofertas > 1 ? 's' : ''}` : `voo ${d.aeroporto}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      trackInterest(d.slug, 'vitrine-click');
                      if (d.appSlug) onOpenDestination(d.appSlug);
                      else onSearch(d.nome);
                    }}
                    className="min-h-[36px] px-3 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-extrabold inline-flex items-center gap-1"
                  >
                    Explorar →
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-[#111111]/70">Nenhum destino com esse filtro. Tente outra palavra.</p>
      )}

      {!showAll && !q && regiao === 'Todas' && cat === 'todas' && filtered.length > 12 && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="min-h-[44px] px-5 rounded-xl froc-btn-neon text-sm font-extrabold inline-flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" /> Ver os {filtered.length} destinos
          </button>
          <a href="/destinos" className="min-h-[44px] px-5 rounded-xl border-2 border-[#111111] text-sm font-bold inline-flex items-center">
            Guia completo por região
          </a>
        </div>
      )}
    </section>
  );
};
