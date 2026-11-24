import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Calendar,
  FileText,
  LogOut,
  MessageSquare,
  Plane,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  Booking,
  ConciergeRequest,
  FlightAlert,
  FlightOrder,
  NotificationItem,
  TouristDocument,
} from '../types.ts';
import { useApp } from '../context/AppContext.tsx';
import { formatMoney } from '../i18n/translations.ts';
import { FuturisticModalHeader, SecurityPinCard } from './DesignSystem.tsx';

interface TouristAccountProps {
  onClose: () => void;
  onOpenChat?: () => void;
}

export const TouristAccount: React.FC<TouristAccountProps> = ({ onClose, onOpenChat }) => {
  const {
    apiFetch,
    currency,
    dbUser,
    language,
    logout,
    notify,
    refreshProfile,
    setCurrency,
    setLanguage,
  } = useApp();

  const [tab, setTab] = useState<'timeline' | 'docs' | 'flights' | 'notifications' | 'profile'>(
    'timeline'
  );

  const [bookings, setBookings] = useState<
    Array<{ booking: Booking; listingTitle: string; listingSlug: string; moduleType: string }>
  >([]);
  const [itineraries, setItineraries] = useState<
    Array<{ id: number; title: string; daysCount: number; budgetCents: number; createdAt: string }>
  >([]);
  const [conciergeList, setConciergeList] = useState<ConciergeRequest[]>([]);
  const [favoritesCount, setFavoritesCount] = useState(0);

  const [documents, setDocuments] = useState<TouristDocument[]>([]);
  const [flightOrders, setFlightOrders] = useState<FlightOrder[]>([]);
  const [flightAlerts, setFlightAlerts] = useState<FlightAlert[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [coupons, setCoupons] = useState<Array<{ id: number; code: string; discountPercent: number }>>([]);

  const [loading, setLoading] = useState(true);
  const [confirmCancelBookingId, setConfirmCancelBookingId] = useState<number | null>(null);
  const [name, setName] = useState(dbUser?.name ?? '');
  const [phone, setPhone] = useState(dbUser?.phone ?? '');

  // Document form
  const [docType, setDocType] = useState('passport');
  const [docLabel, setDocLabel] = useState('');
  const [docMasked, setDocMasked] = useState('');
  const [docExpires, setDocExpires] = useState('');

  // Flight alert form
  const [alertOrigin, setAlertOrigin] = useState('GRU');
  const [alertDest, setAlertDest] = useState('REC');
  const [alertTarget, setAlertTarget] = useState('1200');
  const [alertMadrugada, setAlertMadrugada] = useState(true);

  const loadData = useCallback(async () => {
    if (!dbUser) return;
    setLoading(true);
    try {
      const [dash, hub] = await Promise.all([
        apiFetch<{
          bookings: Array<{
            booking: Booking;
            listingTitle: string;
            listingSlug: string;
            moduleType: string;
          }>;
          favorites: Array<{ id: number }>;
          itineraries: Array<{
            id: number;
            title: string;
            daysCount: number;
            budgetCents: number;
            createdAt: string;
          }>;
          conciergeRequests: ConciergeRequest[];
        }>('/api/tourist/dashboard'),
        apiFetch<{
          documents: TouristDocument[];
          flightOrders: FlightOrder[];
          flightAlerts: FlightAlert[];
          notifications: NotificationItem[];
          coupons: Array<{ id: number; code: string; discountPercent: number }>;
        }>('/api/tourist/hub'),
      ]);

      setBookings(dash.bookings || []);
      setFavoritesCount(dash.favorites?.length ?? 0);
      setItineraries(dash.itineraries || []);
      setConciergeList(dash.conciergeRequests || []);

      setDocuments(hub.documents || []);
      setFlightOrders(hub.flightOrders || []);
      setFlightAlerts(hub.flightAlerts || []);
      setNotifications(hub.notifications || []);
      setCoupons(hub.coupons || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, dbUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const timelineItems = useMemo(() => {
    const items: Array<{
      id: string;
      date: string;
      kind: string;
      code: string;
      title: string;
      status: string;
      amountCents?: number;
      bookingId?: number;
      cancellable?: boolean;
    }> = [];

    for (const { booking, listingTitle, moduleType } of bookings) {
      items.push({
        id: `bk-${booking.id}`,
        date: booking.checkInDate,
        kind:
          moduleType === 'accommodation'
            ? 'Hospedagem'
            : moduleType === 'gastronomy'
            ? 'Gastronomia'
            : 'Passeio / Experiência',
        code: booking.bookingCode,
        title: listingTitle,
        status: booking.status,
        amountCents: booking.grossAmountCents,
        bookingId: booking.id,
        cancellable: booking.status === 'pending_payment' || booking.status === 'confirmed',
      });
    }

    for (const fo of flightOrders) {
      items.push({
        id: `fl-${fo.id}`,
        date: fo.departureDate,
        kind: fo.isMadrugada ? 'Voo (Madrugada)' : 'Voo',
        code: fo.orderCode,
        title: `${fo.originIata} → ${fo.destinationIata} (${fo.tripType})`,
        status: fo.status,
        amountCents: fo.totalClientCents,
      });
    }

    for (const c of conciergeList) {
      items.push({
        id: `cc-${c.id}`,
        date: c.startDate,
        kind: 'Concierge Sob Medida',
        code: c.requestCode,
        title: `${c.originCity} → ${c.destinationPref}`,
        status: c.status,
        amountCents: c.proposalAmountCents ?? c.budgetCents,
      });
    }

    return items.sort((a, b) => a.date.localeCompare(b.date));
  }, [bookings, flightOrders, conciergeList]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/me', {
        method: 'PATCH',
        body: JSON.stringify({ name, phone }),
      });
      await refreshProfile();
      notify('Dados pessoais e preferências atualizados!', 'success');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar perfil.', 'error');
    }
  };

  const handleCancelBooking = async (bookingId: number) => {
    try {
      await apiFetch(`/api/bookings/${bookingId}/cancel`, { method: 'POST' });
      notify('Cancelamento / reembolso processado conforme política.', 'info');
      await loadData();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao cancelar.', 'error');
    }
  };

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/tourist/documents', {
        method: 'POST',
        body: JSON.stringify({
          docType,
          label: docLabel,
          maskedNumber: docMasked,
          expiresAt: docExpires || null,
        }),
      });
      setDocLabel('');
      setDocMasked('');
      setDocExpires('');
      notify('Documento salvo na sua carteira de viagem!', 'success');
      await loadData();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar documento.', 'error');
    }
  };

  const handleDeleteDocument = async (id: number) => {
    await apiFetch(`/api/tourist/documents/${id}`, { method: 'DELETE' });
    await loadData();
  };

  const handleCreateFlightAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/tourist/flight-alerts', {
        method: 'POST',
        body: JSON.stringify({
          originIata: alertOrigin,
          destinationIata: alertDest,
          targetPriceBrl: Number(alertTarget),
          includeMadrugada: alertMadrugada,
        }),
      });
      notify('Alerta no Radar de Oportunidades ativado!', 'success');
      await loadData();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao criar alerta aéreo.', 'error');
    }
  };

  const handleDeleteAlert = async (id: number) => {
    await apiFetch(`/api/tourist/flight-alerts/${id}`, { method: 'DELETE' });
    await loadData();
  };

  const markNotifRead = async (id: number) => {
    await apiFetch(`/api/tourist/notifications/${id}/read`, { method: 'PATCH' });
    await loadData();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs overflow-y-auto p-4 md:p-8 flex justify-center items-start">
      <div className="w-full max-w-5xl bg-[#FFFFFF] rounded-2xl border-2 border-[#111111] shadow-2xl overflow-hidden my-4 froc-animate-modal">
        <FuturisticModalHeader
          title="Central Pessoal — MINHAS VIAGENS"
          subtitle={`${dbUser?.email || ''} · ${favoritesCount} favoritos · ${unreadCount} notificações pendentes`}
          icon={<Plane className="w-5 h-5" />}
          onBack={onClose}
          onClose={onClose}
          actions={
            <div className="flex items-center gap-2">
              {onOpenChat && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenChat();
                  }}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl froc-btn-gold text-xs font-extrabold"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Chat Ao Vivo</span>
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  onClose();
                }}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/25 text-white text-xs font-bold hover:border-[#FF1493] hover:text-[#FF1493]"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sair</span>
              </button>
            </div>
          }
        />

        {/* Navigation tabs */}
        <div className="px-6 pt-4 pb-3 border-b border-[#111111]/15 flex flex-wrap gap-1.5 bg-[#FFFFFF]">
          {[
            { id: 'timeline', label: `🗓️ Minhas Viagens (${timelineItems.length})` },
            { id: 'docs', label: `📄 Documentos (${documents.length})` },
            { id: 'flights', label: `✈️ Voos & Alertas (${flightOrders.length + flightAlerts.length})` },
            { id: 'notifications', label: `🔔 Notificações & Cupons (${unreadCount})` },
            { id: 'profile', label: '🔐 Dados & Segurança' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as typeof tab)}
              className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
                tab === t.id
                  ? 'bg-[#111111] text-[#39FF14]'
                  : 'bg-[#FFFFFF] border border-[#111111]/20 text-[#111111]/75 hover:border-[#111111]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-6 md:p-8 space-y-6">
          {loading ? (
            <div className="py-8 text-center text-sm text-[#111111]/70">
              Carregando sua central de viagens...
            </div>
          ) : (
            <>
              {tab === 'timeline' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-base font-semibold text-[#111111] mb-3 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-[#111111]" />
                      <span>Linha do Tempo Completa da Viagem</span>
                    </h3>
                    {timelineItems.length === 0 ? (
                      <p className="text-sm text-[#111111]/70 p-4 rounded-xl bg-white border border-[#111111]/15">
                        Nenhuma viagem agendada ainda. Explore os destinos ou solicite um roteiro no Concierge.
                      </p>
                    ) : (
                      <div className="space-y-3 border-l-2 border-[#111111]/25 pl-4">
                        {timelineItems.map((item) => (
                          <div
                            key={item.id}
                            className="p-4 rounded-xl border border-[#111111]/15 bg-white flex flex-wrap items-center justify-between gap-4"
                          >
                            <div>
                              <div className="text-[11px] font-mono-tabular text-[#111111]/70">
                                {item.date} · {item.kind} · <strong>{item.code}</strong>
                              </div>
                              <div className="text-sm font-semibold text-[#111111] mt-0.5">
                                {item.title}
                              </div>
                              <div className="text-xs mt-1 text-[#111111] font-medium">
                                Status real: {item.status}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              {item.amountCents !== undefined && (
                                <span className="font-mono-tabular text-sm font-semibold text-[#111111]">
                                  {formatMoney(item.amountCents, currency)}
                                </span>
                              )}
                              {item.cancellable && item.bookingId && (
                                confirmCancelBookingId === item.bookingId ? (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setConfirmCancelBookingId(null)}
                                      className="px-2.5 py-1.5 rounded-lg border border-[#111111]/25 text-xs font-bold text-[#111111]"
                                    >
                                      Manter
                                    </button>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        await handleCancelBooking(item.bookingId!);
                                        setConfirmCancelBookingId(null);
                                      }}
                                      className="px-3 py-1.5 rounded-lg froc-btn-pink text-xs font-bold"
                                    >
                                      Confirmar Cancelamento
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmCancelBookingId(item.bookingId!)}
                                    className="px-3 py-1.5 rounded-xl border border-[#FF1493] text-xs font-bold text-[#FF1493] hover:bg-[#FF1493]/10"
                                  >
                                    Cancelar / Reembolso
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-base font-semibold text-[#111111] mb-3">
                      Roteiros Salvos da Froc Rota AI ({itineraries.length})
                    </h3>
                    {itineraries.length === 0 ? (
                      <p className="text-xs text-[#111111]/70">
                        Nenhum roteiro salvo ainda. Use a Froc Rota AI conectado para salvar roteiros.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {itineraries.map((it) => (
                          <div
                            key={it.id}
                            className="p-3.5 rounded-xl bg-white border border-[#111111]/15 text-xs"
                          >
                            <div className="font-semibold text-[#111111]">{it.title}</div>
                            <div className="text-[#111111]/70 mt-1">
                              {it.daysCount} dias · Orçamento ref.{' '}
                              {formatMoney(it.budgetCents, currency)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab === 'docs' && (
                <div className="space-y-6">
                  <form
                    onSubmit={handleAddDocument}
                    className="p-4 rounded-xl bg-white border border-[#111111]/15 grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
                  >
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">Tipo</label>
                      <select
                        value={docType}
                        onChange={(e) => setDocType(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-lg border border-[#111111]/15 text-xs bg-white"
                      >
                        <option value="passport">Passaporte</option>
                        <option value="rg">RG / CNH</option>
                        <option value="voucher">Voucher / Reserva</option>
                        <option value="ticket">Bilhete Aéreo</option>
                        <option value="insurance">Seguro Viagem</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">Identificação</label>
                      <input
                        required
                        value={docLabel}
                        onChange={(e) => setDocLabel(e.target.value)}
                        placeholder="Ex: Passaporte Titular"
                        className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">
                        Número mascarado
                      </label>
                      <input
                        value={docMasked}
                        onChange={(e) => setDocMasked(e.target.value)}
                        placeholder="Ex: FX***881"
                        className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs bg-white font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">Validade</label>
                      <input
                        type="date"
                        value={docExpires}
                        onChange={(e) => setDocExpires(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs bg-white"
                      />
                    </div>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-semibold"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Adicionar</span>
                    </button>
                  </form>

                  <div className="space-y-2.5">
                    {documents.length === 0 ? (
                      <p className="text-sm text-[#111111]/70">
                        Nenhum documento cadastrado. Cadastre apenas números mascarados para sua segurança.
                      </p>
                    ) : (
                      documents.map((doc) => (
                        <div
                          key={doc.id}
                          className="p-4 rounded-xl border border-[#111111]/15 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <FileText className="w-4 h-4 text-[#111111]" />
                            <div>
                              <div className="font-semibold text-[#111111]">{doc.label}</div>
                              <div className="text-[#111111]/70 font-mono-tabular">
                                {doc.docType} · {doc.maskedNumber || 'S/N'} ·{' '}
                                {doc.expiresAt ? `Validade ${doc.expiresAt}` : 'Sem expiração'}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteDocument(doc.id)}
                            aria-label="Excluir documento"
                            className="p-1.5 rounded-lg text-[#991B1B] hover:bg-[#FFF5F5]"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {tab === 'flights' && (
                <div className="space-y-6">
                  <form
                    onSubmit={handleCreateFlightAlert}
                    className="p-4 rounded-xl bg-white border border-[#111111]/15 grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
                  >
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">Origem IATA</label>
                      <input
                        required
                        maxLength={3}
                        value={alertOrigin}
                        onChange={(e) => setAlertOrigin(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs font-mono-tabular uppercase bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">Destino IATA</label>
                      <input
                        required
                        maxLength={3}
                        value={alertDest}
                        onChange={(e) => setAlertDest(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs font-mono-tabular uppercase bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold mb-1">Alerta abaixo de (R$)</label>
                      <input
                        required
                        type="number"
                        min={100}
                        value={alertTarget}
                        onChange={(e) => setAlertTarget(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs font-mono-tabular bg-white"
                      />
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs pb-2">
                      <input
                        type="checkbox"
                        checked={alertMadrugada}
                        onChange={(e) => setAlertMadrugada(e.target.checked)}
                      />
                      <span>Radar Madrugada</span>
                    </label>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-semibold"
                    >
                      <Plane className="w-3.5 h-3.5" />
                      <span>Criar Alerta</span>
                    </button>
                  </form>

                  <div className="space-y-2.5">
                    <h4 className="text-sm font-semibold text-[#111111]">
                      Alertas de Tarifa Ativos ({flightAlerts.length})
                    </h4>
                    {flightAlerts.map((al) => (
                      <div
                        key={al.id}
                        className="p-3.5 rounded-xl border border-[#111111]/15 flex items-center justify-between text-xs"
                      >
                        <span className="font-mono-tabular">
                          <strong>
                            {al.originIata} → {al.destinationIata}
                          </strong>{' '}
                          · Alvo: {formatMoney(al.targetPriceBrl * 100, currency)} ·{' '}
                          {al.includeMadrugada ? 'Inclui voos da madrugada' : 'Horário comercial'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteAlert(al.id)}
                          className="text-[#991B1B] hover:underline"
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'notifications' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-[#111111] flex items-center gap-2">
                      <Bell className="w-4 h-4 text-[#111111]" />
                      <span>Notificações &amp; Avisos ({notifications.length})</span>
                    </h3>
                    {notifications.length === 0 ? (
                      <p className="text-xs text-[#111111]/70">Nenhuma notificação no momento.</p>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className={`p-3.5 rounded-xl border text-xs space-y-1 ${
                            n.read ? 'border-[#111111]/15 bg-white' : 'border-[#D9A441] bg-white'
                          }`}
                        >
                          <div className="flex justify-between font-semibold text-[#111111]">
                            <span>{n.title}</span>
                            {!n.read && (
                              <button
                                type="button"
                                onClick={() => markNotifRead(n.id)}
                                className="text-[11px] text-[#111111] underline"
                              >
                                Marcar lida
                              </button>
                            )}
                          </div>
                          <p className="text-[#111111]/70">{n.body}</p>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-[#111111]">
                      Cupons Disponíveis ({coupons.length})
                    </h3>
                    {coupons.map((c) => (
                      <div
                        key={c.id}
                        className="p-3.5 rounded-xl border border-[#111111]/15 flex items-center justify-between text-xs font-mono-tabular"
                      >
                        <span className="font-bold text-[#111111]">{c.code}</span>
                        <span>{c.discountPercent}% OFF em reservas elegíveis</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'profile' && (
                <div className="space-y-6 max-w-3xl">
                  <form
                    onSubmit={handleSaveProfile}
                    className="p-5 rounded-2xl border border-[#111111]/20 bg-[#FFFFFF] grid grid-cols-1 md:grid-cols-2 gap-4"
                  >
                    <div>
                      <label className="block text-xs font-bold text-[#111111] mb-1">Nome completo</label>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#111111]/25 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#111111] mb-1">Telefone / WhatsApp</label>
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+55 ..."
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#111111]/25 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#111111] mb-1">Idioma padrão</label>
                      <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value as 'pt' | 'en' | 'es')}
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#111111]/25 text-sm bg-white"
                      >
                        <option value="pt">Português</option>
                        <option value="en">English</option>
                        <option value="es">Español</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#111111] mb-1">Moeda preferida</label>
                      <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value as 'BRL' | 'USD' | 'EUR')}
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#111111]/25 text-sm bg-white"
                      >
                        <option value="BRL">BRL (R$)</option>
                        <option value="USD">USD ($)</option>
                        <option value="EUR">EUR (€)</option>
                      </select>
                    </div>
                    <div className="md:col-span-2 flex justify-end">
                      <button
                        type="submit"
                        className="min-h-[44px] px-5 py-2.5 rounded-xl froc-btn-neon text-xs font-extrabold"
                      >
                        Salvar Dados Pessoais
                      </button>
                    </div>
                  </form>

                  <SecurityPinCard
                    title="Senha & Proteção Privada da Conta"
                    onSuccessMessage={(msg) => notify(msg, 'success')}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
