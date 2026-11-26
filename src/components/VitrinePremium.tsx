import React, { useMemo, useState } from 'react';
import { MapPin, Megaphone, ShieldCheck, Sparkles, Star } from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { formatMoney } from '../i18n/translations.ts';
import { trackText } from '../lib/intent.ts';
import { Listing } from '../types.ts';
import { ResilientImage } from './ResilientImage.tsx';

/** Todo o comércio do turista: cada categoria reconhecida pelo tipo e pelo subtipo do anúncio. */
const CATEGORIAS: Array<{ id: string; label: string; match: (l: Listing) => boolean }> = [
  { id: 'todos', label: '✨ Tudo', match: () => true },
  { id: 'barco', label: '🚤 Barcos & Lanchas', match: (l) => /barco|lancha|escuna|catamar|veleiro|jet|mergulho|nautic/i.test(`${l.subtype} ${l.title}`) },
  { id: 'passeio', label: '🧭 Passeios & Aventura', match: (l) => l.moduleType === 'experience' && !/barco|lancha|escuna|catamar/i.test(`${l.subtype} ${l.title}`) },
  { id: 'casa', label: '🏡 Casas & Apartamentos', match: (l) => /casa|apart|flat|chal|temporada|loft|studio/i.test(`${l.subtype} ${l.title}`) },
  { id: 'hospedagem', label: '🏨 Pousadas & Hotéis', match: (l) => l.moduleType === 'accommodation' },
  { id: 'comida', label: '🍽️ Restaurantes & Bares', match: (l) => l.moduleType === 'gastronomy' },
];

interface Props {
  listings: Listing[];
  onOpenListing: (l: Listing) => void;
  onAdvertise: () => void;
}

/**
 * Vitrine Premium: anúncios dos parceiros com visual de destaque.
 * Ordem honesta: patrocinados e destaques do plano primeiro, depois os mais bem avaliados.
 */
export const VitrinePremium: React.FC<Props> = ({ listings, onOpenListing, onAdvertise }) => {
  const { currency } = useApp();
  const [cat, setCat] = useState('todos');

  const ordered = useMemo(() => {
    const m = CATEGORIAS.find((c) => c.id === cat) ?? CATEGORIAS[0];
    return listings
      .filter((l) => m.match(l))
      .sort(
        (a, b) =>
          Number(b.isSponsored) - Number(a.isSponsored) ||
          Number(b.isFeatured) - Number(a.isFeatured) ||
          (b.ratingAvg || 0) - (a.ratingAvg || 0)
      )
      .slice(0, 8);
  }, [listings, cat]);

  return (
    <section id="vitrine-premium" className="scroll-mt-24" aria-labelledby="vitrine-premium-title">
      <div className="rounded-3xl overflow-hidden border-2 border-[#111111] bg-gradient-to-br from-[#0d1b33] via-[#13233f] to-[#1d3b63] text-white">
        <div className="p-6 md:p-8 space-y-5">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest text-[#FFD700]">
                <Sparkles className="w-4 h-4" /> Vitrine Premium
              </span>
              <h2 id="vitrine-premium-title" className="text-2xl md:text-3xl font-extrabold">
                Experiências de quem faz o turismo acontecer
              </h2>
              <p className="text-sm text-white/75">
                Barcos, passeios, casas de temporada, pousadas e restaurantes de parceiros com identidade verificada.
              </p>
            </div>
            <button
              type="button"
              onClick={onAdvertise}
              className="min-h-[44px] px-4 rounded-xl bg-[#FFD700] text-[#111111] text-sm font-extrabold inline-flex items-center gap-2 self-start"
            >
              <Megaphone className="w-4 h-4" /> Quero minha vitrine aqui
            </button>
          </div>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Categoria">
            {CATEGORIAS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={cat === c.id}
                onClick={() => setCat(c.id)}
                className={`min-h-[36px] px-3 rounded-full text-xs font-bold border ${
                  cat === c.id ? 'bg-[#FFD700] text-[#111111] border-[#FFD700]' : 'border-white/30 text-white hover:border-white'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {ordered.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  trackText(`${l.title} ${l.destinationName || ''}`, 'oferta');
                  onOpenListing(l);
                }}
                className="text-left rounded-2xl overflow-hidden bg-white text-[#111111] border-2 border-[#FFD700]/70 hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(255,215,0,0.25)] transition-all flex flex-col"
              >
                <div className="relative h-40">
                  <ResilientImage src={l.coverImage} alt={l.title} className="w-full h-full object-cover" />
                  {(l.isSponsored || l.isFeatured) && (
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-[#FFD700] text-[#111111] text-[10px] font-extrabold uppercase">
                      {l.isSponsored ? 'Patrocinado' : 'Destaque'}
                    </span>
                  )}
                </div>
                <div className="p-3.5 flex-1 flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold text-[#111111]/65 inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {l.destinationName || 'Brasil'}
                  </span>
                  <h3 className="text-sm font-extrabold leading-snug line-clamp-2">{l.title}</h3>
                  {l.merchantTradeName && (
                    <span className="text-[11px] text-[#111111]/70 inline-flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> {l.merchantTradeName}
                    </span>
                  )}
                  <div className="mt-auto pt-2 flex items-end justify-between">
                    <span>
                      <span className="block text-[10px] text-[#111111]/60">a partir de</span>
                      <strong className="text-base">{formatMoney(l.priceCents, currency)}</strong>
                    </span>
                    {l.reviewCount > 0 && (
                      <span className="text-[11px] font-bold inline-flex items-center gap-0.5">
                        <Star className="w-3 h-3 fill-[#FFD700] text-[#FFD700]" /> {l.ratingAvg.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}

            {/* Espaço do próximo anunciante: convite verdadeiro, sem números inventados */}
            <button
              type="button"
              onClick={onAdvertise}
              className="text-left rounded-2xl border-2 border-dashed border-[#FFD700] p-5 flex flex-col justify-between gap-3 min-h-[240px] hover:bg-white/5"
            >
              <span className="text-xs font-extrabold uppercase tracking-widest text-[#FFD700]">Seu negócio aqui</span>
              <span className="text-lg font-extrabold leading-snug">
                Seu barco, sua pousada ou seu restaurante na vitrine de quem já está escolhendo o destino.
              </span>
              <span className="text-xs text-white/75">
                Página própria no Google, sugestões da IA para quem pesquisa a sua região e pagamento direto no seu Mercado Pago.
              </span>
              <span className="inline-flex items-center gap-1 text-sm font-extrabold text-[#FFD700]">Anunciar agora →</span>
            </button>
          </div>

          {ordered.length === 0 && (
            <p className="text-sm text-white/75">
              Ainda não há anúncios nesta categoria. Seja o primeiro e saia na frente.
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
