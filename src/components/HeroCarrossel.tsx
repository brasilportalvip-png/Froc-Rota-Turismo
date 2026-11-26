import React, { useEffect, useState } from 'react';

/**
 * Topo do site: duas faixas de fotos REAIS de pontos turísticos do Brasil (Wikimedia Commons).
 * Faixa de cima anda da direita para a esquerda; a de baixo, da esquerda para a direita.
 * Cada foto mostra o crédito do fotógrafo e a licença (exigência da licença livre).
 */
interface FotoCarrossel {
  title: string;
  url1280: string;
  url500: string;
  pageUrl: string;
  author: string;
  license: string;
  label: string;
  local: string;
  slug: string | null;
}

interface Props {
  onOpenDestination?: (slug: string) => void;
}

const Tile: React.FC<{ f: FotoCarrossel; onOpen?: (slug: string) => void; hidden?: boolean }> = ({ f, onOpen, hidden }) => (
  <figure
    className="relative shrink-0 w-[280px] h-[280px] md:w-[500px] md:h-[500px] overflow-hidden rounded-2xl bg-[#111111] group"
    aria-hidden={hidden || undefined}
  >
    <button
      type="button"
      tabIndex={hidden ? -1 : 0}
      onClick={() => f.slug && onOpen?.(f.slug)}
      className="block w-full h-full text-left"
      aria-label={`${f.label}, ${f.local}`}
    >
      <img
        src={f.url1280}
        srcSet={`${f.url500} 500w, ${f.url1280} 1280w`}
        sizes="(min-width: 768px) 500px, 280px"
        alt={`${f.label} — ${f.local}`}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
      />
      <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />
      <span className="absolute left-4 bottom-9 md:left-5 md:bottom-11 text-white drop-shadow">
        <span className="block font-display text-lg md:text-2xl font-extrabold leading-tight">{f.label}</span>
        <span className="block text-xs md:text-sm text-white/85 font-semibold">{f.local}</span>
      </span>
    </button>
    <figcaption className="absolute left-4 right-4 bottom-2.5 md:left-5 md:bottom-3 text-[9px] md:text-[10px] text-white/75 truncate">
      Foto:{' '}
      <a
        href={f.pageUrl}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={hidden ? -1 : 0}
        className="underline hover:text-white"
      >
        {f.author} · {f.license} · Wikimedia Commons
      </a>
    </figcaption>
  </figure>
);

const Faixa: React.FC<{ fotos: FotoCarrossel[]; sentido: 'esquerda' | 'direita'; onOpen?: (slug: string) => void; testId: string }> = ({
  fotos,
  sentido,
  onOpen,
  testId,
}) => (
  <div className="froc-marquee overflow-hidden" data-testid={testId}>
    <div
      className={`flex gap-3 md:gap-4 w-max ${sentido === 'esquerda' ? 'froc-marquee-esquerda' : 'froc-marquee-direita'}`}
    >
      {/* a lista aparece duas vezes para o giro não ter emenda */}
      {fotos.map((f) => (
        <Tile key={`a-${f.title}`} f={f} onOpen={onOpen} />
      ))}
      {fotos.map((f) => (
        <Tile key={`b-${f.title}`} f={f} onOpen={onOpen} hidden />
      ))}
    </div>
  </div>
);

export const HeroCarrossel: React.FC<Props> = ({ onOpenDestination }) => {
  const [dados, setDados] = useState<{ top: FotoCarrossel[]; bottom: FotoCarrossel[] } | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch('/api/fotos/carrossel')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (vivo) setDados({ top: d.top || [], bottom: d.bottom || [] });
      })
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
    };
  }, []);

  const carregando = !dados && !erro;
  const esqueleto = (
    <div className="flex gap-3 md:gap-4 overflow-hidden">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="shrink-0 w-[280px] h-[280px] md:w-[500px] md:h-[500px] rounded-2xl bg-[#111111]/10 animate-pulse" />
      ))}
    </div>
  );

  return (
    <section aria-label="Pontos turísticos do Brasil" className="bg-[#FFFFFF] py-3 md:py-4 space-y-3 md:space-y-4" data-testid="hero-carrossel">
      <h1 className="sr-only">Turismo no Brasil: passeios, pousadas e voos — Froc Rota Turismo</h1>
      {carregando ? (
        <>
          {esqueleto}
          {esqueleto}
        </>
      ) : dados && (dados.top.length > 0 || dados.bottom.length > 0) ? (
        <>
          {dados.top.length > 0 && <Faixa fotos={dados.top} sentido="esquerda" onOpen={onOpenDestination} testId="faixa-cima" />}
          {dados.bottom.length > 0 && <Faixa fotos={dados.bottom} sentido="direita" onOpen={onOpenDestination} testId="faixa-baixo" />}
        </>
      ) : null}
    </section>
  );
};
