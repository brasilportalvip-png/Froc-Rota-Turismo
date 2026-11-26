import React, { useState } from 'react';
import { CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import { AvailabilitySlot, Booking, Listing } from '../types.ts';
import { useApp } from '../context/AppContext.tsx';
import { formatMoney } from '../i18n/translations.ts';
import { FuturisticModalHeader } from './DesignSystem.tsx';
import { IdentityVerification } from './IdentityVerification.tsx';

interface BookingModalProps {
  listing: Listing;
  slots: AvailabilitySlot[];
  onClose: () => void;
  onSuccess: () => void;
}

export const BookingModal: React.FC<BookingModalProps> = ({
  listing,
  slots,
  onClose,
  onSuccess,
}) => {
  const { apiFetch, currency, dbUser, emailVerified, identity, requestLogin, notify } = useApp();
  const [selectedSlotId, setSelectedSlotId] = useState<number | ''>(slots[0]?.id ?? '');
  const [checkInDate, setCheckInDate] = useState(
    slots[0]?.date ?? new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  );
  const [checkOutDate, setCheckOutDate] = useState(
    new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
  );
  const [guestsCount, setGuestsCount] = useState(2);
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'card'>('pix');
  const [guestNotes, setGuestNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  const units =
    listing.moduleType === 'accommodation'
      ? Math.max(
          1,
          Math.round(
            (new Date(checkOutDate).getTime() - new Date(checkInDate).getTime()) / 86400000
          )
        )
      : guestsCount;

  // Mesmo preço que o servidor cobra: horário com preço próprio > preço promocional > preço normal.
  const slotEscolhido = slots.find((x) => x.id === selectedSlotId) as { priceOverrideCents?: number | null } | undefined;
  const precoUnitario =
    slotEscolhido?.priceOverrideCents && slotEscolhido.priceOverrideCents > 0
      ? slotEscolhido.priceOverrideCents
      : listing.promoPriceCents && listing.promoPriceCents > 0
      ? listing.promoPriceCents
      : listing.priceCents;
  const baseTotalCents = precoUnitario * units;
  const finalTotalCents = baseTotalCents;
  const isStaff = dbUser?.role === 'admin' || dbUser?.role === 'subadmin';
  // Anti-fraude: e-mail confirmado + identidade aprovada antes de reservar.
  const needsVerification = Boolean(dbUser) && !isStaff && (!emailVerified || identity?.status !== 'approved');

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbUser) {
      await requestLogin();
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{ booking: Booking; checkoutUrl: string | null }>('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          listingId: listing.id,
          slotId: selectedSlotId || null,
          checkInDate,
          checkOutDate: listing.moduleType === 'accommodation' ? checkOutDate : null,
          guestsCount,
          paymentMethod,
          guestNotes,
        }),
      });
      setCreatedBooking(res.booking);
      setCheckoutUrl(res.checkoutUrl);
      notify('Reserva criada. Aguardando validação de pagamento no servidor.', 'info');
      onSuccess();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao reservar.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-[#FFFFFF] rounded-2xl border-2 border-[#111111] shadow-2xl overflow-hidden my-4 froc-animate-modal">
        <FuturisticModalHeader
          title={listing.title}
          subtitle="Pagamento seguro pelo Mercado Pago"
          icon={<Lock className="w-4 h-4" />}
          onBack={onClose}
          onClose={onClose}
        />

        {createdBooking ? (
          <div className="p-6 space-y-5">
            <div className="p-4 rounded-2xl bg-[#FFFFFF] border-2 border-[#111111] space-y-2">
              <div className="flex items-center justify-between text-xs text-[#111111]/70">
                <span>Código da reserva</span>
                <span className="font-mono-tabular font-extrabold text-[#111111]">
                  {createdBooking.bookingCode}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-[#111111]/70">
                <span>Situação</span>
                <span
                  className={`font-extrabold ${
                    createdBooking.status === 'confirmed'
                      ? 'px-2 py-0.5 rounded bg-[#39FF14] text-[#111111]'
                      : 'text-[#FF1493]'
                  }`}
                >
                  {createdBooking.status === 'confirmed'
                    ? 'Confirmada e Paga'
                    : 'Aguardando pagamento'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm font-extrabold text-[#111111] pt-2 border-t border-[#111111]/15">
                <span>Valor total</span>
                <span className="font-mono-tabular">
                  {formatMoney(createdBooking.grossAmountCents, currency)}
                </span>
              </div>
            </div>

            {createdBooking.status === 'confirmed' ? (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-[#39FF14]/20 border border-[#111111] text-xs text-[#111111]">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  Pagamento confirmado. Acesse <strong>Minha conta</strong> a qualquer momento para ver sua reserva.
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-[#111111]/75 leading-relaxed">
                  Sua vaga fica guardada por 60 minutos. Pague pelo Mercado Pago (Pix ou cartão) para confirmar —
                  a confirmação chega automaticamente assim que o pagamento for aprovado. Se fechar esta janela, o botão
                  "Pagar agora" fica em Minha conta.
                </p>
                {checkoutUrl ? (
                  <a
                    href={checkoutUrl}
                    className="block w-full min-h-[44px] text-center py-3 rounded-xl froc-btn-neon text-sm font-extrabold"
                  >
                    Pagar no Mercado Pago
                  </a>
                ) : (
                  <div className="p-3.5 rounded-xl bg-[#FFD700]/15 border border-[#111111]/25 text-xs font-semibold text-[#111111]">
                    O link de pagamento não abriu. Vá em Minha conta e toque em "Pagar agora".
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[44px] py-2.5 rounded-xl border border-[#111111]/25 text-xs font-bold text-[#111111] hover:bg-[#111111]/5"
            >
              Concluir
            </button>
          </div>
        ) : (
          <>
          {/* Fora do formulário da reserva: formulário dentro de formulário enviaria a reserva junto. */}
          {needsVerification && (
            <div className="px-6 pt-6">
              <IdentityVerification purpose="para reservar" compact />
            </div>
          )}
          <form onSubmit={handleCreateBooking} className="p-6 space-y-4">
            {slots.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-[#111111] mb-1">
                  Horário / Disponibilidade em estoque
                </label>
                <select
                  value={selectedSlotId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setSelectedSlotId(id);
                    const found = slots.find((s) => s.id === id);
                    if (found) setCheckInDate(found.date);
                  }}
                  className="w-full px-3 py-2.5 rounded-lg border border-[#111111]/15 text-sm bg-white"
                >
                  {slots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.date} · {s.timeSlot} ({s.availableSpots} vagas restantes)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#111111] mb-1">
                  {listing.moduleType === 'accommodation' ? 'Check-in' : 'Data'}
                </label>
                <input
                  type="date"
                  value={checkInDate}
                  onChange={(e) => setCheckInDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-sm"
                />
              </div>
              {listing.moduleType === 'accommodation' ? (
                <div>
                  <label className="block text-xs font-semibold text-[#111111] mb-1">Check-out</label>
                  <input
                    type="date"
                    value={checkOutDate}
                    onChange={(e) => setCheckOutDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-sm"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-[#111111] mb-1">
                    Viajantes / Pessoas
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={listing.capacity}
                    value={guestsCount}
                    onChange={(e) => setGuestsCount(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-sm"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#111111] mb-1">
                Forma de pagamento (Gateway Mercado Pago)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('pix')}
                  className={`min-h-[44px] py-2.5 px-3 rounded-xl border text-xs font-bold ${
                    paymentMethod === 'pix'
                      ? 'border-[#111111] bg-[#111111] text-[#39FF14]'
                      : 'border-[#111111]/25 text-[#111111]'
                  }`}
                >
                  Pix Instantâneo
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  className={`min-h-[44px] py-2.5 px-3 rounded-xl border text-xs font-bold ${
                    paymentMethod === 'card'
                      ? 'border-[#111111] bg-[#111111] text-[#39FF14]'
                      : 'border-[#111111]/25 text-[#111111]'
                  }`}
                >
                  Cartão via Provedor
                </button>
              </div>
              <p className="text-[11px] text-[#111111]/70 mt-1.5 inline-flex items-center gap-1">
                <Lock className="w-3 h-3" />
                <span>Dados completos de cartão nunca são armazenados na Froc Rota.</span>
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#111111] mb-1">
                Observações ao parceiro (opcional)
              </label>
              <input
                type="text"
                value={guestNotes}
                onChange={(e) => setGuestNotes(e.target.value)}
                placeholder="Ex.: restrição alimentar, horário preferido..."
                className="w-full px-3 py-2 rounded-xl border border-[#111111]/25 text-sm"
              />
            </div>

            <div className="p-4 rounded-2xl bg-[#FFFFFF] border-2 border-[#111111] space-y-1.5 text-xs">
              <div className="flex justify-between text-[#111111]/70">
                <span>Subtotal ({units}x)</span>
                <span className="font-mono-tabular">{formatMoney(baseTotalCents, currency)}</span>
              </div>
              <div className="flex justify-between text-sm font-extrabold text-[#111111] pt-1.5 border-t border-[#111111]/15">
                <span>Total a pagar</span>
                <span className="font-mono-tabular">{formatMoney(finalTotalCents, currency)}</span>
              </div>
            </div>

            <div className="text-[11px] text-[#111111]/75 inline-flex items-start gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#111111] shrink-0" />
              <span>{listing.cancellationPolicy}</span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[46px] px-4 py-3 rounded-xl border border-[#111111]/25 text-xs font-bold text-[#111111] hover:bg-[#111111]/5"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting || needsVerification}
                className="flex-1 min-h-[46px] py-3 rounded-xl froc-btn-neon text-sm font-extrabold disabled:opacity-50"
              >
                {submitting
                  ? 'Processando reserva...'
                  : needsVerification
                  ? 'Conclua a verificação acima'
                  : dbUser
                  ? 'Confirmar Solicitação de Reserva'
                  : 'Entrar e Reservar'}
              </button>
            </div>
          </form>
          </>
        )}
      </div>
    </div>
  );
};
