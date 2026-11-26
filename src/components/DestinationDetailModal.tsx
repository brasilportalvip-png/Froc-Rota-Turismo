import React, { useEffect, useState } from 'react';
import { Heart, MapPin, Star, Calendar, Navigation, Compass } from 'lucide-react';
import { Destination, Listing, ReviewItem } from '../types.ts';
import { useApp } from '../context/AppContext.tsx';
import { formatMoney } from '../i18n/translations.ts';
import { ResilientImage } from './ResilientImage.tsx';
import { FotoCredito } from './FotoCredito.tsx';
import { FuturisticModalHeader } from './DesignSystem.tsx';

interface DestinationDetailModalProps {
  destination: Destination;
  onClose: () => void;
  onSelectListing: (listing: Listing) => void;
  onOpenAiForDestination: (destName: string) => void;
}

export const DestinationDetailModal: React.FC<DestinationDetailModalProps> = ({
  destination,
  onClose,
  onSelectListing,
  onOpenAiForDestination,
}) => {
  const { apiFetch, currency, dbUser, requestLogin, notify } = useApp();
  const [relatedListings, setRelatedListings] = useState<Listing[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/destinations/${encodeURIComponent(destination.slug)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setRelatedListings(data.listings || []);
        setReviews(data.reviews || []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [destination.slug]);

  const handleFavorite = async () => {
    if (!dbUser) {
      await requestLogin();
      return;
    }
    try {
      const res = await apiFetch<{ saved: boolean }>('/api/favorites/toggle', {
        method: 'POST',
        body: JSON.stringify({ destinationId: destination.id }),
      });
      setSaved(res.saved);
      notify(res.saved ? 'Destino salvo nos favoritos.' : 'Removido dos favoritos.', 'success');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao favoritar.', 'error');
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbUser) {
      await requestLogin();
      return;
    }
    if (!comment.trim()) return;
    setSubmitting(true);
    try {
      const res = await apiFetch<{ review: ReviewItem }>('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ destinationId: destination.id, rating, comment }),
      });
      setReviews((prev) => [{ ...res.review, authorName: dbUser.name }, ...prev]);
      setComment('');
      notify('Avaliação publicada!', 'success');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao publicar avaliação.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={destination.name} className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-xs overflow-y-auto p-4 md:p-8 flex justify-center items-start">
      <div className="w-full max-w-4xl bg-[#FFFFFF] rounded-2xl border-2 border-[#111111] shadow-2xl overflow-hidden my-4 froc-animate-modal">
        <FuturisticModalHeader
          title={destination.name}
          subtitle={`${destination.region} · ${destination.state} · ${destination.category}`}
          icon={<MapPin className="w-5 h-5" />}
          onBack={onClose}
          onClose={onClose}
        />

        <div className="relative h-60 md:h-72">
          <ResilientImage
            src={destination.coverImage}
            alt={`${destination.name}, ${destination.state}`}
            className="w-full h-full object-cover"
          />
          {destination.fotoCredito && (
            <FotoCredito
              credito={destination.fotoCredito}
              className="absolute top-2 right-3 max-w-[70%] !text-white/80 drop-shadow"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#111111]/85 via-black/25 to-transparent" />
          <div className="absolute bottom-5 left-6 right-6 flex flex-wrap items-center justify-between gap-3 text-white">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleFavorite}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-[#111111] border border-[#111111] text-xs font-bold"
              >
                <Heart className={`w-3.5 h-3.5 ${saved ? 'fill-[#FF1493] text-[#FF1493]' : ''}`} />
                <span>{saved ? 'Salvo' : 'Salvar destino'}</span>
              </button>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${destination.lat},${destination.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl froc-btn-neon text-xs font-extrabold"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Abrir no Mapa</span>
              </a>
            </div>
          </div>
        </div>

        <div className="p-6 md:p-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pb-6 border-b border-[#111111]/15">
            <div>
              <div className="text-xs font-bold text-[#111111]/65">Orçamento médio diário</div>
              <div className="text-xl font-extrabold text-[#111111] font-mono-tabular mt-1">
                {formatMoney(destination.avgBudgetDayCents, currency)} / dia
              </div>
            </div>
            <div>
              <div className="text-xs font-bold text-[#111111]/65">Avaliação dos viajantes</div>
              <div className="text-xl font-extrabold text-[#111111] font-mono-tabular mt-1 inline-flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded-md bg-[#FFD700] text-[#111111] border border-[#111111] inline-flex items-center gap-1 text-sm">
                  <Star className="w-3.5 h-3.5 fill-[#111111]" />
                  {destination.ratingAvg.toFixed(2)}
                </span>
                <span className="text-xs font-sans font-semibold text-[#111111]/70">
                  ({destination.reviewCount + reviews.length} opiniões)
                </span>
              </div>
            </div>
            <div className="flex md:justify-end items-center">
              <button
                type="button"
                onClick={() => onOpenAiForDestination(destination.name)}
                className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl froc-btn-gold text-xs font-extrabold"
              >
                <Compass className="w-4 h-4" />
                <span>✨ Gerar Roteiro com Froc Rota AI</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
            <div className="md:col-span-7 space-y-5">
              <div>
                <h3 className="text-lg font-semibold text-[#111111]">Sobre o destino</h3>
                <p className="text-sm text-[#111111]/70 leading-relaxed mt-2">
                  {destination.description}
                </p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-[#111111]">Cultura, costumes e gastronomia</h4>
                <p className="text-sm text-[#111111]/70 leading-relaxed mt-1">
                  {destination.culturalInfo}
                </p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-[#111111]">Curiosidades locais</h4>
                <p className="text-sm text-[#111111]/70 leading-relaxed mt-1">
                  {destination.curiosities}
                </p>
              </div>
            </div>

            <div className="md:col-span-5 space-y-4 bg-white p-5 rounded-xl border border-[#111111]/15">
              <div>
                <div className="text-xs font-semibold text-[#111111] inline-flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#111111]" />
                  <span>Melhor época para visitar</span>
                </div>
                <p className="text-xs text-[#111111]/70 mt-1 leading-relaxed">{destination.bestSeason}</p>
              </div>
              <div className="pt-3 border-t border-[#111111]/15">
                <div className="text-xs font-semibold text-[#111111] inline-flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#111111]" />
                  <span>Como chegar</span>
                </div>
                <p className="text-xs text-[#111111]/70 mt-1 leading-relaxed">{destination.howToGet}</p>
              </div>
              <div className="pt-3 border-t border-[#111111]/15">
                <div className="text-xs font-semibold text-[#111111] mb-2">Principais atrações</div>
                <ul className="space-y-1 text-xs text-[#111111]/70">
                  {destination.highlightsJson.map((h) => (
                    <li key={h}>· {h}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[#111111]/15">
            <h3 className="text-lg font-semibold text-[#111111] mb-4">
              Experiências, Gastronomia e Hospedagens em {destination.name}
            </h3>
            {loading ? (
              <div className="text-sm text-[#111111]/70">Carregando serviços locais...</div>
            ) : relatedListings.length === 0 ? (
              <div className="text-sm text-[#111111]/70">
                Em breve novos parceiros verificados nesta região.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {relatedListings.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectListing(item)}
                    className="text-left p-4 rounded-xl border border-[#111111]/15 hover:border-[#111111] transition-colors flex gap-4 items-center bg-white"
                  >
                    <ResilientImage
                      src={item.coverImage}
                      alt={item.title}
                      className="w-20 h-20 rounded-lg object-cover shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-[#111111]/70">
                        {item.moduleType === 'experience'
                          ? 'Experiência'
                          : item.moduleType === 'gastronomy'
                          ? 'Gastronomia'
                          : 'Hospedagem'}{' '}
                        · {item.durationOrCheckin}
                      </div>
                      <div className="text-sm font-semibold text-[#111111] truncate mt-0.5">
                        {item.title}
                      </div>
                      <div className="text-xs font-semibold text-[#111111] font-mono-tabular mt-1">
                        {formatMoney(item.priceCents, currency)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-[#111111]/15">
            <h3 className="text-lg font-semibold text-[#111111] mb-4">Avaliações dos visitantes</h3>
            <form onSubmit={handleSubmitReview} className="mb-6 flex flex-col sm:flex-row gap-3">
              <select
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
                className="px-3 py-2 rounded-lg border border-[#111111]/15 bg-white text-sm"
                aria-label="Nota"
              >
                <option value={5}>5 estrelas</option>
                <option value={4}>4 estrelas</option>
                <option value={3}>3 estrelas</option>
                <option value={2}>2 estrelas</option>
                <option value={1}>1 estrela</option>
              </select>
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Compartilhe sua experiência neste destino..."
                className="flex-1 px-3.5 py-2 rounded-lg border border-[#111111]/15 text-sm"
              />
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-semibold hover:bg-[#111111]/90 whitespace-nowrap"
              >
                {submitting ? 'Enviando...' : 'Publicar'}
              </button>
            </form>

            <div className="space-y-3">
              {reviews.length === 0 ? (
                <p className="text-xs text-[#111111]/70">Seja o primeiro visitante a avaliar.</p>
              ) : (
                reviews.map((rev) => (
                  <div key={rev.id} className="p-4 rounded-lg bg-white border border-[#111111]/15">
                    <div className="flex items-center justify-between text-xs text-[#111111]/70">
                      <span className="font-semibold text-[#111111]">{rev.authorName}</span>
                      <span className="font-mono-tabular">Nota {rev.rating}/5</span>
                    </div>
                    <p className="text-sm text-[#111111] mt-1">{rev.comment}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
