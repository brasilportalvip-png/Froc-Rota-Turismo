import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarPlus,
  Check,
  Edit3,
  ExternalLink,
  Megaphone,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  X,
} from 'lucide-react';
import {
  Booking,
  Destination,
  Listing,
  MarketingCampaign,
  Merchant,
  MerchantPlan,
  MerchantSubscriptionRow,
  ReviewItem,
} from '../types.ts';
import { useApp } from '../context/AppContext.tsx';
import { formatMoney } from '../i18n/translations.ts';
import { FuturisticModalHeader, SecurityPinCard } from './DesignSystem.tsx';

interface MerchantPortalProps {
  destinations: Destination[];
  onClose: () => void;
  onListingCreated: () => void;
}

interface OAuthStatusResponse {
  googleBusiness: {
    configured: boolean;
    redirectUri: string;
    connected: boolean;
    accountName: string | null;
    syncedAt: string | null;
  };
  mercadopagoSeller: {
    configured: boolean;
    redirectUri: string;
    connected: boolean;
    collectorId: string | null;
  };
}

export const MerchantPortal: React.FC<MerchantPortalProps> = ({
  destinations,
  onClose,
  onListingCreated,
}) => {
  const { apiFetch, currency, dbUser, loginWithGoogle, notify, refreshProfile } = useApp();
  const [plans, setPlans] = useState<MerchantPlan[]>([]);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [activePlan, setActivePlan] = useState<MerchantPlan | null>(null);
  const [myListings, setMyListings] = useState<Listing[]>([]);
  const [myBookings, setMyBookings] = useState<
    Array<{ booking: Booking; listingTitle: string; touristName: string; touristEmail: string }>
  >([]);
  const [myReviews, setMyReviews] = useState<
    Array<{ review: ReviewItem; authorName: string; listingTitle: string }>
  >([]);
  const [subscriptions, setSubscriptions] = useState<MerchantSubscriptionRow[]>([]);
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatusResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<
    'overview' | 'new_listing' | 'bookings' | 'reviews' | 'plans' | 'marketing' | 'oauth'
  >('overview');

  // Onboarding state
  const [selectedPlanSlug, setSelectedPlanSlug] = useState('basic');
  const [companyName, setCompanyName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [cadasturNumber, setCadasturNumber] = useState('');
  const [category, setCategory] = useState('nautical');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('RJ');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');

  // New listing state
  const [destId, setDestId] = useState<number>(destinations[0]?.id ?? 1);
  const [moduleType, setModuleType] = useState<'experience' | 'gastronomy' | 'accommodation'>(
    'experience'
  );
  const [subtype, setSubtype] = useState('lancha');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [priceBrl, setPriceBrl] = useState('350');
  const [capacity, setCapacity] = useState('8');
  const [durationOrCheckin, setDurationOrCheckin] = useState('4 horas · Saída 09:00');
  const [address, setAddress] = useState('');
  const [cancellationPolicy, setCancellationPolicy] = useState(
    'Cancelamento gratuito até 48h antes da data agendada.'
  );
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});

  // Edit listing & slot modal state
  const [editingListing, setEditingListing] = useState<Listing | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editPriceBrl, setEditPriceBrl] = useState('');
  const [editPromoBrl, setEditPromoBrl] = useState('');
  const [editPromoLabel, setEditPromoLabel] = useState('');
  const [editGalleryInput, setEditGalleryInput] = useState('');
  const [editVideosInput, setEditVideosInput] = useState('');

  const [slotListingId, setSlotListingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [slotDate, setSlotDate] = useState(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
  const [slotTime, setSlotTime] = useState('09:30');
  const [slotSpots, setSlotSpots] = useState('8');

  // Marketing Hub state
  const [campListingId, setCampListingId] = useState<string>('');
  const [campChannel, setCampChannel] = useState<'instagram' | 'google_ads' | 'trivago' | 'froc_featured'>('instagram');
  const [campTitle, setCampTitle] = useState('');
  const [campHeadline, setCampHeadline] = useState('');
  const [campAdCopy, setCampAdCopy] = useState('');
  const [campSocialCaption, setCampSocialCaption] = useState('');
  const [campSuggestion, setCampSuggestion] = useState('');
  const [generatingCopy, setGeneratingCopy] = useState(false);

  const loadPortal = useCallback(async () => {
    setLoading(true);
    try {
      const plansRes = await fetch('/api/plans').then((r) => r.json());
      setPlans(plansRes.plans || []);

      if (dbUser) {
        const [dash, subsRes, campRes, oauthRes] = await Promise.all([
          apiFetch<{
            merchant: Merchant | null;
            plan: MerchantPlan | null;
            listings: Listing[];
            bookings: Array<{
              booking: Booking;
              listingTitle: string;
              touristName: string;
              touristEmail: string;
            }>;
            reviews: Array<{ review: ReviewItem; authorName: string; listingTitle: string }>;
          }>('/api/merchant/dashboard'),
          apiFetch<{ subscriptions: MerchantSubscriptionRow[] }>('/api/merchant/subscriptions'),
          apiFetch<{ campaigns: MarketingCampaign[] }>('/api/merchant/campaigns'),
          apiFetch<OAuthStatusResponse>('/api/oauth/status'),
        ]);
        setMerchant(dash.merchant);
        setActivePlan(dash.plan);
        setMyListings(dash.listings || []);
        setMyBookings(dash.bookings || []);
        setMyReviews(dash.reviews || []);
        setSubscriptions(subsRes.subscriptions || []);
        setCampaigns(campRes.campaigns || []);
        setOauthStatus(oauthRes);
        if (!campListingId && dash.listings?.length > 0) {
          setCampListingId(String(dash.listings[0].id));
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, dbUser, campListingId]);

  useEffect(() => {
    loadPortal();
  }, [loadPortal]);

  // Listen for OAuth popup success messages
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        notify(`Conexão ${event.data.provider} concluída com segurança!`, 'success');
        loadPortal();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [loadPortal, notify]);

  const handleOnboard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbUser) {
      await loginWithGoogle();
      return;
    }
    try {
      await apiFetch('/api/merchant/onboard', {
        method: 'POST',
        body: JSON.stringify({
          companyName,
          tradeName,
          documentNumber,
          cadasturNumber,
          category,
          planSlug: selectedPlanSlug,
          city,
          state: stateCode,
          phone,
          bio,
        }),
      });
      notify('Cadastro empresarial enviado para verificação!', 'success');
      await refreshProfile();
      await loadPortal();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro no cadastro.', 'error');
    }
  };

  const handleCreateListing = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/merchant/listings', {
        method: 'POST',
        body: JSON.stringify({
          destinationId: destId,
          moduleType,
          subtype,
          title,
          summary,
          description,
          priceBrl: Number(priceBrl),
          capacity: Number(capacity),
          durationOrCheckin,
          address,
          cancellationPolicy,
          amenities: ['Atendimento verificado Froc Rota'],
        }),
      });
      notify('Serviço publicado no marketplace!', 'success');
      setTitle('');
      setSummary('');
      setDescription('');
      setAddress('');
      setTab('overview');
      await loadPortal();
      onListingCreated();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao publicar anúncio.', 'error');
    }
  };

  const openEditListing = (l: Listing) => {
    setEditingListing(l);
    setEditTitle(l.title);
    setEditSummary(l.summary);
    setEditPriceBrl(String(Math.round(l.priceCents / 100)));
    setEditPromoBrl(l.promoPriceCents ? String(Math.round(l.promoPriceCents / 100)) : '');
    setEditPromoLabel(l.promoLabel || '');
    setEditGalleryInput((l.galleryJson || []).join('\n'));
    setEditVideosInput((l.videosJson || []).join('\n'));
  };

  const handleSaveEditListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingListing) return;
    try {
      await apiFetch(`/api/merchant/listings/${editingListing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editTitle,
          summary: editSummary,
          priceBrl: Number(editPriceBrl),
          promoPriceBrl: editPromoBrl.trim() ? Number(editPromoBrl) : null,
          promoLabel: editPromoLabel.trim() || null,
          galleryUrls: editGalleryInput
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          videoUrls: editVideosInput
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      notify('Anúncio e galeria atualizados!', 'success');
      setEditingListing(null);
      await loadPortal();
      onListingCreated();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar alterações.', 'error');
    }
  };

  const handleListingStatus = async (listingId: number, status: 'paused' | 'active', renewDays?: number) => {
    try {
      await apiFetch(`/api/merchant/listings/${listingId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, renewDays }),
      });
      notify(
        renewDays
          ? `Anúncio renovado por +${renewDays} dias!`
          : status === 'paused'
          ? 'Anúncio pausado.'
          : 'Anúncio reativado.',
        'success'
      );
      await loadPortal();
      onListingCreated();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao alterar anúncio.', 'error');
    }
  };

  const handleDeleteListing = async (listingId: number) => {
    try {
      await apiFetch(`/api/merchant/listings/${listingId}`, { method: 'DELETE' });
      notify('Anúncio removido/arquivado.', 'info');
      await loadPortal();
      onListingCreated();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao excluir anúncio.', 'error');
    }
  };

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slotListingId) return;
    try {
      await apiFetch(`/api/merchant/listings/${slotListingId}/slots`, {
        method: 'POST',
        body: JSON.stringify({
          date: slotDate,
          timeSlot: slotTime,
          totalSpots: Number(slotSpots),
        }),
      });
      notify('Horário / disponibilidade adicionado!', 'success');
      setSlotListingId(null);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao cadastrar horário.', 'error');
    }
  };

  const handleSubscribePlan = async (planSlug: string) => {
    try {
      const res = await apiFetch<{
        subscription: { id: number; status: string };
        checkoutUrl: string | null;
        message: string;
      }>('/api/merchant/plans/subscribe', {
        method: 'POST',
        body: JSON.stringify({ planSlug, autoRenew: true }),
      });
      notify(res.message, 'success');
      if (res.checkoutUrl) {
        window.open(res.checkoutUrl, '_blank', 'noopener,noreferrer');
      }
      await loadPortal();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao contratar plano.', 'error');
    }
  };

  const handleVerifySubscriptionSandbox = async (subscriptionId: number) => {
    try {
      await apiFetch('/api/merchant/plans/verify-server', {
        method: 'POST',
        body: JSON.stringify({ subscriptionId }),
      });
      notify('Assinatura verificada no servidor e ativada!', 'success');
      await loadPortal();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Falha na confirmação.', 'error');
    }
  };

  const handleGenerateAiCopy = async () => {
    if (!campListingId) {
      notify('Selecione um anúncio primeiro.', 'error');
      return;
    }
    setGeneratingCopy(true);
    try {
      const res = await apiFetch<{
        headline: string;
        adCopy: string;
        socialCaption: string;
        aiSuggestion: string;
      }>('/api/merchant/campaigns/generate-copy', {
        method: 'POST',
        body: JSON.stringify({ listingId: Number(campListingId), channel: campChannel }),
      });
      setCampHeadline(res.headline);
      setCampAdCopy(res.adCopy);
      setCampSocialCaption(res.socialCaption);
      setCampSuggestion(res.aiSuggestion);
      if (!campTitle) setCampTitle(`Campanha ${campChannel.toUpperCase()}`);
      notify('Material publicitário gerado com IA!', 'success');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao gerar textos.', 'error');
    } finally {
      setGeneratingCopy(false);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/merchant/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          listingId: campListingId ? Number(campListingId) : null,
          title: campTitle,
          channel: campChannel,
          headline: campHeadline,
          adCopy: campAdCopy,
          socialCaption: campSocialCaption,
          aiSuggestion: campSuggestion,
        }),
      });
      setCampTitle('');
      setCampHeadline('');
      setCampAdCopy('');
      setCampSocialCaption('');
      notify('Campanha publicada na Central de Marketing!', 'success');
      await loadPortal();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao criar campanha.', 'error');
    }
  };

  const startOAuthPopup = async (endpoint: string) => {
    try {
      const res = await apiFetch<{ url: string }>(endpoint);
      window.open(res.url, 'froc_oauth_popup', 'width=560,height=680');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Credenciais OAuth ausentes no servidor.', 'error');
    }
  };

  const handleReplyReview = async (reviewId: number) => {
    const reply = replyDrafts[reviewId]?.trim();
    if (!reply) return;
    try {
      await apiFetch(`/api/merchant/reviews/${reviewId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ reply }),
      });
      notify('Resposta publicada!', 'success');
      await loadPortal();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao responder.', 'error');
    }
  };

  const confirmedBookings = myBookings.filter((b) => b.booking.status === 'confirmed');
  const totalNetCents = confirmedBookings.reduce((s, b) => s + b.booking.netMerchantCents, 0);
  const totalCommissionCents = confirmedBookings.reduce((s, b) => s + b.booking.commissionCents, 0);

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs overflow-y-auto p-4 md:p-8 flex justify-center items-start">
      <div className="w-full max-w-6xl bg-[#FFFFFF] rounded-2xl border-2 border-[#111111] shadow-2xl overflow-hidden my-4 froc-animate-modal">
        <FuturisticModalHeader
          title="Painel do Anunciante & Central de Marketing"
          subtitle="Anúncios, mídias, promoções, horários, planos (incl. R$ 100/30 dias), Marketing IA e Google Business OAuth"
          icon={<Store className="w-5 h-5" />}
          onBack={onClose}
          onClose={onClose}
        />

        <div className="p-6 md:p-8">
          {loading ? (
            <div className="py-12 text-center text-sm text-[#111111]/70">Carregando portal...</div>
          ) : !dbUser ? (
            <div className="py-10 text-center space-y-4">
              <h3 className="text-xl font-semibold text-[#111111]">
                Conecte sua conta para anunciar na Froc Rota Turismo
              </h3>
              <p className="text-sm text-[#111111]/70 max-w-lg mx-auto">
                Comece com o plano Anúncio Básico (30 dias) por R$ 100,00 ou escolha Gratuito,
                Profissional e Premium com repasses verificados e campanhas com IA.
              </p>
              <button
                type="button"
                onClick={loginWithGoogle}
                className="px-6 py-3 rounded-lg bg-[#111111] text-[#39FF14] text-sm font-semibold hover:bg-[#111111]/90"
              >
                Entrar com Google para Começar
              </button>
            </div>
          ) : !merchant ? (
            <div className="space-y-8">
              <div>
                <h3 className="text-xl font-semibold text-[#111111]">1. Escolha o plano comercial</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                  {plans.map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlanSlug(plan.slug)}
                      className={`text-left p-4 rounded-2xl border-2 transition-all ${
                        selectedPlanSlug === plan.slug
                          ? 'border-[#111111] bg-[#FFD700]/15 froc-gold-frame'
                          : 'border-[#111111]/20 bg-white hover:border-[#111111]'
                      }`}
                    >
                      <div className="flex justify-between items-center gap-2">
                        <span className="font-semibold text-sm text-[#111111]">{plan.name}</span>
                        <span className="text-[11px] font-mono-tabular text-[#111111] font-semibold">
                          {(plan.commissionBps / 100).toFixed(0)}% com.
                        </span>
                      </div>
                      <div className="text-xl font-semibold text-[#111111] font-mono-tabular mt-2">
                        {plan.monthlyPriceCents === 0
                          ? 'Gratuito'
                          : `${formatMoney(plan.monthlyPriceCents, currency)} / ${plan.durationDays || 30}d`}
                      </div>
                      <ul className="mt-3 space-y-1 text-[11px] text-[#111111]/70">
                        {plan.benefitsJson.map((b) => (
                          <li key={b} className="flex items-start gap-1.5">
                            <Check className="w-3.5 h-3.5 text-[#111111] shrink-0 mt-0.5" />
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </button>
                  ))}
                </div>
              </div>

              <form onSubmit={handleOnboard} className="space-y-4 pt-6 border-t border-[#111111]/15">
                <h3 className="text-xl font-semibold text-[#111111]">
                  2. Dados empresariais e verificação documental
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Razão Social ou Nome Completo MEI"
                    className="px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                  />
                  <input
                    required
                    value={tradeName}
                    onChange={(e) => setTradeName(e.target.value)}
                    placeholder="Nome Fantasia (exibido aos turistas)"
                    className="px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                  />
                  <input
                    required
                    value={documentNumber}
                    onChange={(e) => setDocumentNumber(e.target.value)}
                    placeholder="CNPJ ou CPF"
                    className="px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                  />
                  <input
                    value={cadasturNumber}
                    onChange={(e) => setCadasturNumber(e.target.value)}
                    placeholder="Registro Cadastur / Habilitação Marinha"
                    className="px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                  />
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm bg-white"
                  >
                    <option value="nautical">Náutica, Lanchas &amp; Mergulho</option>
                    <option value="tours">Passeios, Buggy, Trilhas &amp; Guias</option>
                    <option value="gastronomy">Gastronomia, Bares &amp; Quiosques</option>
                    <option value="hospitality">Hotéis, Pousadas &amp; Chalés</option>
                    <option value="transport">Transfers &amp; Receptivo</option>
                  </select>
                  <input
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="WhatsApp comercial"
                    className="px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                  />
                  <input
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Cidade de operação"
                    className="px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                  />
                  <input
                    required
                    value={stateCode}
                    onChange={(e) => setStateCode(e.target.value)}
                    placeholder="UF (ex: RJ, PE, BA)"
                    className="px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                  />
                </div>
                <textarea
                  rows={2}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Apresentação da empresa e diferenciais..."
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                />
                <button
                  type="submit"
                  className="px-6 py-3 rounded-lg bg-[#111111] text-[#39FF14] text-sm font-semibold hover:bg-[#111111]/90"
                >
                  Enviar Cadastro Comercial
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#111111]/15">
                <div>
                  <div className="text-xs text-[#111111]/70 inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-[#111111]" />
                    <span>
                      Plano {activePlan?.name} ({((activePlan?.commissionBps ?? 1800) / 100).toFixed(0)}
                      % comissão) · Status:{' '}
                      {merchant.verificationStatus === 'verified'
                        ? 'Verificado'
                        : 'Em verificação documental'}
                    </span>
                  </div>
                  <h3 className="text-2xl font-semibold text-[#111111] mt-1">
                    {merchant.tradeName}
                  </h3>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'overview', label: `📦 Anúncios (${myListings.length})` },
                    { id: 'new_listing', label: '+ Novo Anúncio' },
                    { id: 'bookings', label: `Reservas (${myBookings.length})` },
                    { id: 'plans', label: '💎 Planos & Extratos' },
                    { id: 'marketing', label: `📣 Marketing IA (${campaigns.length})` },
                    { id: 'oauth', label: '🔐 Google Business, MP & Segurança' },
                    { id: 'reviews', label: `Avaliações (${myReviews.length})` },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id as typeof tab)}
                      className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                        tab === item.id
                          ? 'bg-[#111111] text-[#39FF14]'
                          : 'bg-[#FFFFFF] border border-[#111111]/20 text-[#111111]/75 hover:border-[#111111]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-white border border-[#111111]/15">
                  <div className="text-xs text-[#111111]/70">Anúncios publicados</div>
                  <div className="text-2xl font-semibold text-[#111111] font-mono-tabular mt-1">
                    {myListings.length} / {activePlan?.maxListings ?? 3}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-white border border-[#111111]/15">
                  <div className="text-xs text-[#111111]/70">Receita líquida confirmada</div>
                  <div className="text-2xl font-semibold text-[#111111] font-mono-tabular mt-1">
                    {formatMoney(totalNetCents, currency)}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-white border border-[#111111]/15">
                  <div className="text-xs text-[#111111]/70">Comissões plataforma</div>
                  <div className="text-2xl font-semibold text-[#111111] font-mono-tabular mt-1">
                    {formatMoney(totalCommissionCents, currency)}
                  </div>
                </div>
              </div>

              {tab === 'overview' && (
                <div className="space-y-3">
                  {myListings.length === 0 ? (
                    <div className="p-8 text-center rounded-xl border border-dashed border-[#111111]/15 space-y-3">
                      <p className="text-sm text-[#111111]/70">
                        Você ainda não publicou passeios, restaurantes ou hospedagens.
                      </p>
                      <button
                        type="button"
                        onClick={() => setTab('new_listing')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-semibold"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Criar Primeiro Anúncio</span>
                      </button>
                    </div>
                  ) : (
                    myListings.map((l) => (
                      <div
                        key={l.id}
                        className="p-4 rounded-xl border border-[#111111]/15 flex flex-wrap items-center justify-between gap-4"
                      >
                        <div>
                          <div className="text-xs text-[#111111]/70">
                            {l.moduleType} · {l.subtype} · Status:{' '}
                            <strong className={l.status === 'active' ? 'text-[#111111]' : 'text-[#92400E]'}>
                              {l.status}
                            </strong>
                            {l.promoLabel ? ` · Promoção: ${l.promoLabel}` : ''}
                          </div>
                          <div className="font-semibold text-[#111111] mt-0.5">{l.title}</div>
                          <div className="text-xs font-mono-tabular text-[#111111] mt-1">
                            {formatMoney(l.priceCents, currency)}
                            {l.promoPriceCents
                              ? ` (Promo: ${formatMoney(l.promoPriceCents, currency)})`
                              : ''}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => openEditListing(l)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#111111]/15 hover:bg-white"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Editar / Mídia</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSlotListingId(l.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#111111]/15 hover:bg-white"
                          >
                            <CalendarPlus className="w-3.5 h-3.5" />
                            <span>+ Horário</span>
                          </button>
                          {l.status === 'paused' ? (
                            <button
                              type="button"
                              onClick={() => handleListingStatus(l.id, 'active')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#ECFDF5] text-[#065F46] font-semibold"
                            >
                              <PlayCircle className="w-3.5 h-3.5" />
                              <span>Reativar</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleListingStatus(l.id, 'paused')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#FEF3C7] text-[#92400E] font-semibold"
                            >
                              <PauseCircle className="w-3.5 h-3.5" />
                              <span>Pausar</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleListingStatus(l.id, 'active', 30)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#111111] text-[#111111] font-semibold"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Renovar +30d</span>
                          </button>
                          {confirmDeleteId === l.id ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1.5 rounded-lg border border-[#111111]/25 font-bold"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  await handleDeleteListing(l.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="px-2.5 py-1.5 rounded-lg froc-btn-pink font-bold"
                              >
                                Confirmar Exclusão
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(l.id)}
                              aria-label="Excluir anúncio"
                              className="p-2 rounded-lg text-[#FF1493] hover:bg-[#FF1493]/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === 'new_listing' && (
                <form onSubmit={handleCreateListing} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold mb-1">Destino</label>
                      <select
                        value={destId}
                        onChange={(e) => setDestId(Number(e.target.value))}
                        className="w-full px-3 py-2.5 rounded-lg border border-[#111111]/15 text-sm bg-white"
                      >
                        {destinations.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.state})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Módulo</label>
                      <select
                        value={moduleType}
                        onChange={(e) =>
                          setModuleType(e.target.value as 'experience' | 'gastronomy' | 'accommodation')
                        }
                        className="w-full px-3 py-2.5 rounded-lg border border-[#111111]/15 text-sm bg-white"
                      >
                        <option value="experience">Experiência / Passeio</option>
                        <option value="gastronomy">Gastronomia / Restaurante</option>
                        <option value="accommodation">Hospedagem / Pousada</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Subtipo</label>
                      <input
                        required
                        value={subtype}
                        onChange={(e) => setSubtype(e.target.value)}
                        placeholder="ex: lancha, mergulho, restaurante, chales"
                        className="w-full px-3 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                      />
                    </div>
                  </div>

                  <input
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Título do serviço ou hospedagem"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                  />
                  <input
                    required
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="Resumo em 1 frase para os cards da busca"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                  />
                  <textarea
                    required
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descrição detalhada, o que inclui, recomendações..."
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                  />

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold mb-1">Preço base (R$)</label>
                      <input
                        required
                        type="number"
                        min={20}
                        value={priceBrl}
                        onChange={(e) => setPriceBrl(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-[#111111]/15 text-sm font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Vagas / Hóspedes</label>
                      <input
                        required
                        type="number"
                        min={1}
                        value={capacity}
                        onChange={(e) => setCapacity(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-[#111111]/15 text-sm font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Duração / Horário</label>
                      <input
                        required
                        value={durationOrCheckin}
                        onChange={(e) => setDurationOrCheckin(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                      />
                    </div>
                  </div>

                  <input
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Endereço completo de embarque ou estabelecimento"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                  />
                  <input
                    required
                    value={cancellationPolicy}
                    onChange={(e) => setCancellationPolicy(e.target.value)}
                    placeholder="Regra de cancelamento"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-[#111111]/15 text-sm"
                  />

                  <button
                    type="submit"
                    className="px-6 py-3 rounded-lg bg-[#111111] text-[#39FF14] text-sm font-semibold hover:bg-[#111111]/90"
                  >
                    Publicar no Marketplace
                  </button>
                </form>
              )}

              {tab === 'bookings' && (
                <div className="space-y-3">
                  {myBookings.length === 0 ? (
                    <p className="text-sm text-[#111111]/70">Nenhuma reserva recebida ainda.</p>
                  ) : (
                    myBookings.map(({ booking, listingTitle, touristName }) => (
                      <div
                        key={booking.id}
                        className="p-4 rounded-xl border border-[#111111]/15 flex flex-wrap justify-between gap-4 text-xs"
                      >
                        <div>
                          <div className="font-mono-tabular font-semibold text-[#111111]">
                            {booking.bookingCode} · {booking.status}
                          </div>
                          <div className="text-sm font-semibold text-[#111111] mt-0.5">
                            {listingTitle}
                          </div>
                          <div className="text-[#111111]/70 mt-0.5">
                            Cliente: {touristName} · Data: {booking.checkInDate} ·{' '}
                            {booking.guestsCount} pessoas
                          </div>
                        </div>
                        <div className="text-right font-mono-tabular">
                          <div className="text-[#111111] font-semibold text-sm">
                            Líquido: {formatMoney(booking.netMerchantCents, currency)}
                          </div>
                          <div className="text-[#111111]/70">
                            Bruto: {formatMoney(booking.grossAmountCents, currency)} · Comissão:{' '}
                            {formatMoney(booking.commissionCents, currency)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === 'plans' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {plans.map((p) => {
                      const isCurrent = activePlan?.id === p.id;
                      return (
                        <div
                          key={p.id}
                          className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                            isCurrent ? 'border-[#111111] bg-white' : 'border-[#111111]/15'
                          }`}
                        >
                          <div>
                            <div className="font-semibold text-sm text-[#111111]">{p.name}</div>
                            <div className="text-xl font-semibold font-mono-tabular mt-1">
                              {p.monthlyPriceCents === 0
                                ? 'Gratuito'
                                : `${formatMoney(p.monthlyPriceCents, currency)} / ${p.durationDays || 30}d`}
                            </div>
                            <div className="text-[11px] text-[#111111]/70 mt-1">
                              Comissão: {(p.commissionBps / 100).toFixed(0)}% · Até {p.maxListings}{' '}
                              anúncios
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={isCurrent}
                            onClick={() => handleSubscribePlan(p.slug)}
                            className="w-full py-2 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-semibold disabled:opacity-50"
                          >
                            {isCurrent ? 'Plano Atual' : 'Contratar Plano'}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-[#111111]">
                      Histórico de Assinaturas &amp; Extratos de Plano ({subscriptions.length})
                    </h4>
                    {subscriptions.length === 0 ? (
                      <p className="text-xs text-[#111111]/70">Nenhuma contratação registrada ainda.</p>
                    ) : (
                      subscriptions.map(({ subscription, planName }) => (
                        <div
                          key={subscription.id}
                          className="p-3.5 rounded-xl border border-[#111111]/15 flex flex-wrap items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <span className="font-semibold">{planName}</span> ·{' '}
                            <span className="font-mono-tabular">
                              {formatMoney(subscription.amountCents, currency)}
                            </span>{' '}
                            · Status: <strong>{subscription.status}</strong>
                          </div>
                          {subscription.status === 'pending_payment' && (
                            <button
                              type="button"
                              onClick={() => handleVerifySubscriptionSandbox(subscription.id)}
                              className="px-3 py-1.5 rounded-lg bg-[#D9A441] text-[#111111] font-semibold"
                            >
                              Verificar Pagamento no Servidor
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {tab === 'marketing' && (
                <div className="space-y-6">
                  <div className="p-5 rounded-xl bg-white border border-[#111111]/15 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold text-[#111111] flex items-center gap-2">
                        <Megaphone className="w-4 h-4 text-[#111111]" />
                        <span>Central de Marketing &amp; Geração Publicitária com IA</span>
                      </h4>
                      <button
                        type="button"
                        disabled={generatingCopy}
                        onClick={handleGenerateAiCopy}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#D9A441] text-[#111111] text-xs font-semibold hover:bg-[#E5B457]"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{generatingCopy ? 'Gerando...' : 'Gerar Texto & Legenda com IA'}</span>
                      </button>
                    </div>

                    <form onSubmit={handleCreateCampaign} className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <select
                          value={campListingId}
                          onChange={(e) => setCampListingId(e.target.value)}
                          className="px-3 py-2 rounded-lg border border-[#111111]/15 text-xs bg-white"
                        >
                          <option value="">Selecione um anúncio...</option>
                          {myListings.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.title}
                            </option>
                          ))}
                        </select>
                        <select
                          value={campChannel}
                          onChange={(e) => setCampChannel(e.target.value as typeof campChannel)}
                          className="px-3 py-2 rounded-lg border border-[#111111]/15 text-xs bg-white"
                        >
                          <option value="instagram">Instagram / Redes Sociais</option>
                          <option value="froc_featured">Destaque Interno Froc Rota</option>
                          <option value="google_ads">Google Ads</option>
                          <option value="trivago">Metabusca / Vitrine Externa</option>
                        </select>
                        <input
                          required
                          value={campTitle}
                          onChange={(e) => setCampTitle(e.target.value)}
                          placeholder="Nome da campanha"
                          className="px-3 py-2 rounded-lg border border-[#111111]/15 text-xs bg-white"
                        />
                      </div>

                      <input
                        required
                        value={campHeadline}
                        onChange={(e) => setCampHeadline(e.target.value)}
                        placeholder="Chamada principal (headline)"
                        className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs bg-white"
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <textarea
                          required
                          rows={3}
                          value={campAdCopy}
                          onChange={(e) => setCampAdCopy(e.target.value)}
                          placeholder="Texto publicitário principal..."
                          className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs bg-white"
                        />
                        <textarea
                          rows={3}
                          value={campSocialCaption}
                          onChange={(e) => setCampSocialCaption(e.target.value)}
                          placeholder="Legenda e hashtags para redes sociais..."
                          className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs bg-white"
                        />
                      </div>
                      {campSuggestion && (
                        <div className="p-3 rounded-lg bg-white border border-[#D9A441] text-xs text-[#111111]">
                          <strong>Sugestão IA de conversão:</strong> {campSuggestion}
                        </div>
                      )}
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-semibold"
                      >
                        Salvar e Ativar Campanha
                      </button>
                    </form>
                  </div>

                  <div className="space-y-2.5">
                    <h4 className="text-sm font-semibold text-[#111111]">
                      Campanhas &amp; Desempenho ({campaigns.length})
                    </h4>
                    {campaigns.map((c) => (
                      <div
                        key={c.id}
                        className="p-4 rounded-xl border border-[#111111]/15 text-xs space-y-1.5"
                      >
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="font-semibold text-sm text-[#111111]">
                            {c.title} ({c.channel})
                          </span>
                          <span className="font-mono-tabular text-[#111111]/70">
                            Visualizações: {c.impressions} · Cliques: {c.clicks} · Contatos:{' '}
                            {c.contacts} · Conversões: {c.conversions}
                          </span>
                        </div>
                        <div className="font-medium text-[#111111]">{c.headline}</div>
                        <p className="text-[#111111]/70">{c.adCopy}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'oauth' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-5 rounded-2xl border border-[#111111]/20 bg-white space-y-3">
                      <div className="flex justify-between items-center">
                        <h4 className="text-base font-bold text-[#111111]">
                          Google Business Profile (OAuth)
                        </h4>
                        <span
                          className={`text-xs font-bold ${
                            oauthStatus?.googleBusiness.connected
                              ? 'text-[#111111] bg-[#39FF14] px-2 py-0.5 rounded'
                              : 'text-[#FF1493]'
                          }`}
                        >
                          {oauthStatus?.googleBusiness.connected
                            ? 'Conectado'
                            : oauthStatus?.googleBusiness.configured
                            ? 'Pronto para autorizar'
                            : 'Aguardando credenciais'}
                        </span>
                      </div>
                      <p className="text-xs text-[#111111]/75 leading-relaxed">
                        Conecte a ficha oficial da sua empresa no Google para importar e manter dados
                        comerciais consistentes com consentimento explícito OAuth 2.0 (nunca simulado).
                      </p>
                      {oauthStatus?.googleBusiness.accountName && (
                        <div className="p-2.5 rounded-lg bg-[#39FF14]/15 border border-[#111111]/20 text-xs">
                          Conta vinculada: <strong>{oauthStatus.googleBusiness.accountName}</strong>
                        </div>
                      )}
                      <div className="text-[11px] font-mono-tabular text-[#111111]/65 break-all">
                        Redirect URI: {oauthStatus?.googleBusiness.redirectUri}
                      </div>
                      <button
                        type="button"
                        onClick={() => startOAuthPopup('/api/oauth/google-business/url')}
                        className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl froc-btn-neon text-xs font-extrabold"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Autorizar Google Business Profile</span>
                      </button>
                    </div>

                    <div className="p-5 rounded-2xl border border-[#111111]/20 bg-white space-y-3">
                      <div className="flex justify-between items-center">
                        <h4 className="text-base font-bold text-[#111111]">
                          Mercado Pago Seller Split (OAuth)
                        </h4>
                        <span
                          className={`text-xs font-bold ${
                            oauthStatus?.mercadopagoSeller.connected
                              ? 'text-[#111111] bg-[#39FF14] px-2 py-0.5 rounded'
                              : 'text-[#FF1493]'
                          }`}
                        >
                          {oauthStatus?.mercadopagoSeller.connected
                            ? 'Vinculado'
                            : oauthStatus?.mercadopagoSeller.configured
                            ? 'Pronto para autorizar'
                            : 'Aguardando credenciais'}
                        </span>
                      </div>
                      <p className="text-xs text-[#111111]/75 leading-relaxed">
                        Vincule sua conta recebedora do Mercado Pago para receber repasses líquidos com
                        split automático e retenção transparente da taxa de intermediação Froc Rota.
                      </p>
                      {oauthStatus?.mercadopagoSeller.collectorId && (
                        <div className="p-2.5 rounded-lg bg-[#39FF14]/15 border border-[#111111]/20 text-xs font-mono-tabular">
                          Collector ID: <strong>{oauthStatus.mercadopagoSeller.collectorId}</strong>
                        </div>
                      )}
                      <div className="text-[11px] font-mono-tabular text-[#111111]/65 break-all">
                        Redirect URI: {oauthStatus?.mercadopagoSeller.redirectUri}
                      </div>
                      <button
                        type="button"
                        onClick={() => startOAuthPopup('/api/oauth/mercadopago/url')}
                        className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl froc-btn-gold text-xs font-extrabold"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Vincular Conta Mercado Pago</span>
                      </button>
                    </div>
                  </div>

                  <SecurityPinCard
                    title="Proteção de Acesso & Chave Operacional do Parceiro"
                    onSuccessMessage={(msg) => notify(msg, 'success')}
                  />
                </div>
              )}

              {tab === 'reviews' && (
                <div className="space-y-3">
                  {myReviews.length === 0 ? (
                    <p className="text-sm text-[#111111]/70">Nenhuma avaliação recebida ainda.</p>
                  ) : (
                    myReviews.map(({ review, authorName, listingTitle }) => (
                      <div key={review.id} className="p-4 rounded-xl border border-[#111111]/15 text-xs space-y-2">
                        <div className="flex justify-between font-semibold text-[#111111]">
                          <span>
                            {authorName} em {listingTitle}
                          </span>
                          <span className="font-mono-tabular">{review.rating}/5 ★</span>
                        </div>
                        <p className="text-sm text-[#111111]/70">{review.comment}</p>
                        {review.merchantReply ? (
                          <div className="p-2.5 rounded-lg bg-white text-[#111111]">
                            Sua resposta: {review.merchantReply}
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={replyDrafts[review.id] || ''}
                              onChange={(e) =>
                                setReplyDrafts((prev) => ({
                                  ...prev,
                                  [review.id]: e.target.value,
                                }))
                              }
                              placeholder="Responder avaliação do cliente..."
                              className="flex-1 px-3 py-2 rounded-lg border border-[#111111]/15"
                            />
                            <button
                              type="button"
                              onClick={() => handleReplyReview(review.id)}
                              className="px-3.5 py-2 rounded-lg bg-[#111111] text-[#39FF14] font-semibold"
                            >
                              Responder
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edit Listing & Media Modal */}
      {editingListing && (
        <div className="fixed inset-0 z-[95] bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveEditListing}
            className="w-full max-w-lg bg-white rounded-xl border border-[#111111]/15 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex justify-between items-center">
              <h4 className="text-base font-semibold text-[#111111]">
                Editar Anúncio &amp; Mídias
              </h4>
              <button type="button" onClick={() => setEditingListing(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Título"
              className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-sm"
            />
            <input
              required
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              placeholder="Resumo"
              className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-sm"
            />
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-semibold mb-1">Preço (R$)</label>
                <input
                  type="number"
                  min={20}
                  value={editPriceBrl}
                  onChange={(e) => setEditPriceBrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Preço Promo (R$)</label>
                <input
                  type="number"
                  min={0}
                  value={editPromoBrl}
                  onChange={(e) => setEditPromoBrl(e.target.value)}
                  placeholder="Opcional"
                  className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Selo Promoção</label>
                <input
                  value={editPromoLabel}
                  onChange={(e) => setEditPromoLabel(e.target.value)}
                  placeholder="Ex: -15% Baixa Temp."
                  className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold mb-1">
                Galeria de Fotos (1 URL HTTPS ou /src/assets/images/ por linha)
              </label>
              <textarea
                rows={2}
                value={editGalleryInput}
                onChange={(e) => setEditGalleryInput(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold mb-1">
                Vídeos promocionais (1 URL HTTPS por linha)
              </label>
              <textarea
                rows={2}
                value={editVideosInput}
                onChange={(e) => setEditVideosInput(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-xs"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingListing(null)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-[#111111]/25 text-xs font-bold text-[#111111]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2.5 rounded-xl froc-btn-neon text-xs font-extrabold"
              >
                Salvar Alterações do Anúncio
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Availability Slot Modal */}
      {slotListingId && (
        <div className="fixed inset-0 z-[95] bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleAddSlot}
            className="w-full max-w-sm bg-white rounded-xl border border-[#111111]/15 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex justify-between items-center">
              <h4 className="text-base font-semibold text-[#111111]">Cadastrar Horário / Vagas</h4>
              <button type="button" onClick={() => setSlotListingId(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              required
              type="date"
              value={slotDate}
              onChange={(e) => setSlotDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-sm"
            />
            <input
              required
              value={slotTime}
              onChange={(e) => setSlotTime(e.target.value)}
              placeholder="Ex: 14:00 ou Diária"
              className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-sm"
            />
            <input
              required
              type="number"
              min={1}
              value={slotSpots}
              onChange={(e) => setSlotSpots(e.target.value)}
              placeholder="Vagas disponíveis"
              className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 text-sm font-mono-tabular"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSlotListingId(null)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-[#111111]/25 text-xs font-bold text-[#111111]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2.5 rounded-xl froc-btn-neon text-xs font-extrabold"
              >
                Adicionar Disponibilidade
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
