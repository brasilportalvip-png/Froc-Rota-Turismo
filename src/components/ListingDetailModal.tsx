import React, { useEffect, useState } from 'react';
import { Flag, Heart, MapPin, ShieldCheck, Star } from 'lucide-react';
import { AvailabilitySlot, Listing, ReviewItem } from '../types.ts';
import { useApp } from '../context/AppContext.tsx';
import { formatMoney } from '../i18n/translations.ts';
import { ResilientImage } from './ResilientImage.tsx';
import { FuturisticModalHeader } from './DesignSystem.tsx';

interface ListingDetailModalProps {
  listing: Listing;
  onClose: () => void;
  onBook: (listing: Listing, slots: AvailabilitySlot[]) => void;
}

export const ListingDetailModal: React.FC<ListingDetailModalProps> = ({
  listing,
  onClose,
  onBook,
}) => {
  const { apiFetch, currency, dbUser, requestLogin, notify } = useApp();
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [merchantInfo, setMerchantInfo] = useState<{
    tradeName: string;
    verificationStatus: string;
    cadasturNumber?: string | null;
    bio: string;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const [reviewText, setReviewText] = useState('');
  const [reviewRating, setReviewRating] = useState(5);

  useEffect(() => {
    let active = true;
    fetch(`/api/listings/${encodeURIComponent(listing.slug)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setSlots(data.slots || []);
        setReviews(data.reviews || []);
        setMerchantInfo(data.merchant || null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [listing.slug]);

  const toggleFavorite = async () => {
    if (!dbUser) {
      await requestLogin();
      return;
    }
    try {
      const res = await apiFetch<{ saved: boolean }>('/api/favorites/toggle', {
        method: 'POST',
        body: JSON.stringify({ listingId: listing.id }),
      });
      setSaved(res.saved);
      notify(res.saved ? 'Oferta salva nos favoritos.' : 'Removida dos favoritos.', 'success');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar.', 'error');
    }
  };

  const handleReport = async () => {
    if (!dbUser) {
      await requestLogin();
      return;
    }
    try {
      await apiFetch('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          targetType: 'listing',
          targetId: listing.id,
          reason: 'Solicitação de revisão de conteúdo/disponibilidade pela comunidade.',
        }),
      });
      notify('Solicitação de moderação enviada para a equipe Froc Rota.', 'success');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao enviar denúncia.', 'error');
    }
  };

  const handlePublishReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbUser) {
      await requestLogin();
      return;
    }
    if (!reviewText.trim()) return;
    try {
      const res = await apiFetch<{ review: ReviewItem }>('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ listingId: listing.id, rating: reviewRating, comment: reviewText }),
      });
      setReviews((prev) => [{ ...res.review, authorName: dbUser.name }, ...prev]);
      setReviewText('');
      notify('Avaliação registrada!', 'success');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao enviar avaliação.', 'error');
    }
  };

  const kindLabel =
    listing.moduleType === 'experience'
      ? 'Experiência'
      : listing.moduleType === 'gastronomy'
      ? 'Gastronomia'
      : 'Hospedagem';

  return (
    <div role="dialog" aria-modal="true" aria-label={listing.title} className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-xs overflow-y-auto p-4 md:p-8 flex justify-center items-start">
      <div className="w-full max-w-4xl bg-[#FFFFFF] rounded-2xl border-2 border-[#111111] shadow-2xl overflow-hidden my-4 froc-animate-modal">
        <FuturisticModalHeader
          title={listing.title}
          subtitle={`${kindLabel} · ${listing.subtype} · ${listing.durationOrCheckin}`}
          icon={<ShieldCheck className="w-5 h-5" />}
          onBack={onClose}
          onClose={onClose}
        />

        <div className="relative h-56 md:h-68">
          <ResilientImage src={listing.coverImage} alt={listing.title} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#111111]/75 via-transparent to-transparent" />
          {listing.promoLabel && (
            <span className="absolute bottom-4 left-6 px-3 py-1 rounded-lg bg-[#FF1493] text-white text-xs font-extrabold uppercase">
              🔥 {listing.promoLabel}
            </span>
          )}
        </div>

        <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-12 gap-8">
          <div className="md:col-span-7 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#111111]/15 text-xs text-[#111111]/70">
              <div className="inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#111111]" />
                <span>{listing.address}</span>
              </div>
              <div className="inline-flex items-center gap-1 font-mono-tabular text-[#111111] font-semibold">
                <Star className="w-3.5 h-3.5 fill-[#D9A441] text-[#D9A441]" />
                <span>{listing.ratingAvg.toFixed(2)}</span>
              </div>
            </div>

            <div>
              <h3 className="text-base font-semibold text-[#111111]">Descrição completa</h3>
              <p className="text-sm text-[#111111]/70 leading-relaxed mt-2">{listing.description}</p>
            </div>

            {listing.amenitiesJson.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-[#111111] mb-2">
                  Comodidades e itens inclusos
                </h4>
                <div className="grid grid-cols-2 gap-2 text-xs text-[#111111]/70">
                  {listing.amenitiesJson.map((am) => (
                    <div key={am}>· {am}</div>
                  ))}
                </div>
              </div>
            )}

            {listing.menuOrScheduleJson.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-[#111111] mb-2">
                  {listing.moduleType === 'gastronomy' ? 'Cardápio em destaque' : 'Programação'}
                </h4>
                <div className="divide-y divide-[#111111]/10 border border-[#111111]/15 rounded-lg">
                  {listing.menuOrScheduleJson.map((row, idx) => (
                    <div key={idx} className="p-3 flex items-start justify-between gap-4 text-xs">
                      <div>
                        <span className="font-semibold text-[#111111]">{row.label}: </span>
                        <span className="text-[#111111]/70">{row.detail}</span>
                      </div>
                      {row.price && (
                        <span className="font-mono-tabular font-semibold text-[#111111] shrink-0">
                          {row.price}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="p-4 rounded-lg bg-white border border-[#111111]/15 text-xs text-[#111111]/70">
              <span className="font-semibold text-[#111111]">Regras de cancelamento (CDC): </span>
              {listing.cancellationPolicy}
            </div>

            <div className="pt-4 border-t border-[#111111]/15">
              <h4 className="text-sm font-semibold text-[#111111] mb-3">Avaliações</h4>
              <form onSubmit={handlePublishReview} className="flex gap-2 mb-4">
                <select
                  value={reviewRating}
                  onChange={(e) => setReviewRating(Number(e.target.value))}
                  className="px-2.5 py-2 rounded-lg border border-[#111111]/15 text-xs bg-white"
                >
                  <option value={5}>5 ★</option>
                  <option value={4}>4 ★</option>
                  <option value={3}>3 ★</option>
                </select>
                <input
                  type="text"
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  placeholder="Deixe sua avaliação..."
                  className="flex-1 px-3 py-2 rounded-lg border border-[#111111]/15 text-xs"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-semibold"
                >
                  Enviar
                </button>
              </form>
              <div className="space-y-2.5">
                {reviews.map((rev) => (
                  <div key={rev.id} className="p-3 rounded-lg border border-[#111111]/15 text-xs">
                    <div className="flex justify-between font-semibold text-[#111111]">
                      <span>{rev.authorName}</span>
                      <span className="font-mono-tabular">{rev.rating}/5</span>
                    </div>
                    <p className="text-[#111111]/70 mt-1">{rev.comment}</p>
                    {rev.merchantReply && (
                      <p className="mt-2 pl-3 text-[#111111] border-l border-[#111111]/15">
                        Resposta do parceiro: {rev.merchantReply}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="md:col-span-5 space-y-4">
            <div className="p-5 rounded-xl border border-[#111111]/15 bg-white sticky top-6 space-y-4">
              <div>
                <div className="text-xs text-[#111111]/70">
                  {listing.moduleType === 'accommodation' ? 'Diária a partir de' : 'Valor por pessoa'}
                </div>
                <div className="text-2xl font-semibold text-[#111111] font-mono-tabular mt-0.5">
                  {formatMoney(listing.priceCents, currency)}
                </div>
                <div className="text-xs text-[#111111]/70 mt-1">
                  Capacidade máxima: {listing.capacity} pessoas
                </div>
              </div>

              {merchantInfo && (
                <div className="py-3 border-y border-[#111111]/15 text-xs space-y-1">
                  <div className="font-semibold text-[#111111] inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-[#111111]" />
                    <span>{merchantInfo.tradeName}</span>
                  </div>
                  <div className="text-[#111111]/70">
                    Status: {merchantInfo.verificationStatus === 'verified' ? 'Verificado' : 'Em análise'}
                    {merchantInfo.cadasturNumber ? ` · Cadastur ${merchantInfo.cadasturNumber}` : ''}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-semibold text-[#111111] mb-2">
                  Próximas datas disponíveis ({slots.length})
                </div>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {slots.slice(0, 4).map((slot) => (
                    <div
                      key={slot.id}
                      className="flex items-center justify-between text-xs px-3 py-2 rounded-md bg-white border border-[#111111]/15"
                    >
                      <span className="font-mono-tabular">
                        {slot.date} · {slot.timeSlot}
                      </span>
                      <span className="text-[#111111] font-medium font-mono-tabular">
                        {slot.availableSpots} vagas
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onBook(listing, slots)}
                className="w-full min-h-[46px] py-3 rounded-xl froc-btn-neon text-sm font-extrabold"
              >
                Reservar com Pagamento Seguro
              </button>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={toggleFavorite}
                  className="inline-flex items-center gap-1.5 text-xs text-[#111111]/70 hover:text-[#111111]"
                >
                  <Heart className={`w-3.5 h-3.5 ${saved ? 'fill-[#DC2626] text-[#DC2626]' : ''}`} />
                  <span>{saved ? 'Salvo' : 'Favoritar'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleReport}
                  className="inline-flex items-center gap-1 text-xs text-[#111111]/70 hover:text-[#991B1B]"
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span>Reportar anúncio</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
