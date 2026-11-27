import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, MessageSquare, Search, ShieldCheck, Sparkles, Star } from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext.tsx';
import { formatMoney, TRANSLATIONS } from './i18n/translations.ts';
import { AvailabilitySlot, Destination, Listing } from './types.ts';
import { ResilientImage } from './components/ResilientImage.tsx';
import { HeroCarrossel } from './components/HeroCarrossel.tsx';
import { FotoCredito } from './components/FotoCredito.tsx';
import { InteractiveMap } from './components/InteractiveMap.tsx';
import { FrocXPromo } from './components/FrocXPromo.tsx';
import { TravelAndConciergeSection } from './components/TravelAndConciergeSection.tsx';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { EditorialDailySection } from './components/EditorialDailySection.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { PromoPopupEngine } from './components/PromoPopupEngine.tsx';
import { VitrineBrasil } from './components/VitrineBrasil.tsx';
import { VitrinePremium } from './components/VitrinePremium.tsx';
import { IntentOpportunity } from './components/IntentOpportunity.tsx';
import { AdvertiserCampaign } from './components/AdvertiserCampaign.tsx';
import { firstName, greeting, trackText } from './lib/intent.ts';

const CATEGORIA_PT: Record<string, string> = {
  praia: 'Praia',
  ilha: 'Ilha',
  cachoeira: 'Cachoeira',
  parque: 'Parque',
  historico: 'Histórico',
  serra: 'Serra',
  cidade: 'Cidade',
  ecoturismo: 'Ecoturismo',
};

// Code splitting for modals & heavy dashboards
const DestinationDetailModal = React.lazy(() =>
  import('./components/DestinationDetailModal.tsx').then((m) => ({ default: m.DestinationDetailModal }))
);
const ListingDetailModal = React.lazy(() =>
  import('./components/ListingDetailModal.tsx').then((m) => ({ default: m.ListingDetailModal }))
);
const BookingModal = React.lazy(() =>
  import('./components/BookingModal.tsx').then((m) => ({ default: m.BookingModal }))
);
const FrocRotaAIModal = React.lazy(() =>
  import('./components/FrocRotaAIModal.tsx').then((m) => ({ default: m.FrocRotaAIModal }))
);
const MerchantPortal = React.lazy(() =>
  import('./components/MerchantPortal.tsx').then((m) => ({ default: m.MerchantPortal }))
);
const TouristAccount = React.lazy(() =>
  import('./components/TouristAccount.tsx').then((m) => ({ default: m.TouristAccount }))
);
const AdminMasterPanel = React.lazy(() =>
  import('./components/AdminMasterPanel.tsx').then((m) => ({ default: m.AdminMasterPanel }))
);
const LegalComplianceModal = React.lazy(() =>
  import('./components/LegalComplianceModal.tsx').then((m) => ({ default: m.LegalComplianceModal }))
);
const RealtimeChatDrawer = React.lazy(() =>
  import('./components/RealtimeChatDrawer.tsx').then((m) => ({ default: m.RealtimeChatDrawer }))
);

const LazyFallback = () => (
  <div className="fixed inset-0 z-[92] bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
    <div className="px-6 py-4 rounded-2xl bg-[#111111] border-2 border-[#39FF14] text-white text-xs font-bold flex items-center gap-3 shadow-2xl">
      <span className="w-3 h-3 rounded-full bg-[#39FF14] animate-ping" />
      <span>Carregando...</span>
    </div>
  </div>
);

function FrocRotaPlatform() {
  const {
    currency,
    dbUser,
    isAnyAdmin,
    merchant,
    language,
    requestLogin,
    notify,
    setCurrency,
    setLanguage,
  } = useApp();
  const t = TRANSLATIONS[language];

  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [initialPostSlug, setInitialPostSlug] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [destCategory, setDestCategory] = useState('all');
  const [destRegion, setDestRegion] = useState('all');
  const [moduleFilter, setModuleFilter] = useState<'all' | 'experience' | 'gastronomy' | 'accommodation'>('all');
  const [maxPriceBrl, setMaxPriceBrl] = useState<string>('');
  const [minGuests, setMinGuests] = useState<string>('');
  const [amenityFilter, setAmenityFilter] = useState<string>('');

  // Modals / Portals
  const [selectedDestination, setSelectedDestination] = useState<Destination | null>(null);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [bookingContext, setBookingContext] = useState<{
    listing: Listing;
    slots: AvailabilitySlot[];
  } | null>(null);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiInitialPrompt, setAiInitialPrompt] = useState('');
  const [showMerchantPortal, setShowMerchantPortal] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [intentVisible, setIntentVisible] = useState(false);
  const [campanhaVisivel, setCampanhaVisivel] = useState(false);

  const hasOpenOverlay = Boolean(
    selectedDestination ||
      selectedListing ||
      bookingContext ||
      showAIModal ||
      showMerchantPortal ||
      showAccount ||
      showAdmin ||
      showLegal ||
      showChat
  );

  // IA de intenção: o que a pessoa abre conta como interesse (guardado só no aparelho, com consentimento)
  useEffect(() => {
    if (selectedDestination) trackText(`${selectedDestination.name} ${selectedDestination.state}`, 'destino');
  }, [selectedDestination]);
  useEffect(() => {
    if (selectedListing) trackText(`${selectedListing.title} ${selectedListing.destinationName || ''}`, 'oferta');
  }, [selectedListing]);

  const openDestinationBySlug = useCallback(
    (slug: string) => {
      const d = destinations.find((x) => x.slug === slug);
      if (d) setSelectedDestination(d);
    },
    [destinations]
  );
  const openListingBySlug = useCallback(
    (slug: string) => {
      const l = listings.find((x) => x.slug === slug);
      if (l) setSelectedListing(l);
    },
    [listings]
  );
  const searchFromVitrine = useCallback((term: string) => {
    setSearchQuery(term);
    trackText(term, 'busca');
    setTimeout(() => document.getElementById('marketplace')?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  // Sync browser/Android hardware Back button (popstate) with open modal overlays
  const pushedHistoryRef = useRef(false);
  useEffect(() => {
    if (hasOpenOverlay && !pushedHistoryRef.current) {
      window.history.pushState({ frocModal: true }, '', window.location.href);
      pushedHistoryRef.current = true;
    } else if (!hasOpenOverlay) {
      pushedHistoryRef.current = false;
    }
  }, [hasOpenOverlay]);

  useEffect(() => {
    const onPopState = () => {
      if (bookingContext) {
        setBookingContext(null);
      } else if (selectedListing) {
        setSelectedListing(null);
      } else if (selectedDestination) {
        setSelectedDestination(null);
      } else if (showChat) {
        setShowChat(false);
      } else if (showAdmin) {
        setShowAdmin(false);
      } else if (showMerchantPortal) {
        setShowMerchantPortal(false);
      } else if (showAccount) {
        setShowAccount(false);
      } else if (showAIModal) {
        setShowAIModal(false);
      } else if (showLegal) {
        setShowLegal(false);
      }
      pushedHistoryRef.current = false;
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [
    bookingContext,
    selectedListing,
    selectedDestination,
    showChat,
    showAdmin,
    showMerchantPortal,
    showAccount,
    showAIModal,
    showLegal,
  ]);

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      const [destRes, listRes] = await Promise.all([
        fetch('/api/destinations'),
        fetch('/api/listings'),
      ]);
      if (!destRes.ok || !listRes.ok) {
        throw new Error('Falha ao carregar catálogo do servidor.');
      }
      const destData = (await destRes.json()) as { destinations: Destination[] };
      const listData = (await listRes.json()) as { listings: Listing[] };
      setDestinations(destData.destinations || []);
      setListings(listData.listings || []);

      // Handle SEO direct links ?dest=, ?oferta=, ?post=
      const params = new URLSearchParams(window.location.search);
      const destSlug = params.get('dest');
      const offerSlug = params.get('oferta');
      const postSlug = params.get('post');
      if (destSlug) {
        const matchDest = (destData.destinations || []).find((d) => d.slug === destSlug);
        if (matchDest) setSelectedDestination(matchDest);
      }
      if (offerSlug) {
        const matchList = (listData.listings || []).find((l) => l.slug === offerSlug);
        if (matchList) setSelectedListing(matchList);
      }
      if (postSlug) {
        setInitialPostSlug(postSlug);
      }
      // Links vindos das páginas de SEO (/anuncie, /destinos/...)
      if (params.get('painel') === 'anunciante') setShowMerchantPortal(true);
      const busca = (params.get('busca') || '').slice(0, 80);
      if (busca) {
        setSearchQuery(busca);
        setTimeout(() => document.getElementById('marketplace')?.scrollIntoView({ behavior: 'smooth' }), 500);
      }
    } catch (err: unknown) {
      setCatalogError(err instanceof Error ? err.message : 'Erro ao conectar ao banco de dados.');
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  // Outras partes do site pedem para abrir o chat (ex.: "Quero este voo" na busca de passagens).
  useEffect(() => {
    const abrir = () => setShowChat(true);
    window.addEventListener('froc-abrir-chat', abrir);
    return () => window.removeEventListener('froc-abrir-chat', abrir);
  }, []);

  // Volta do Mercado Pago (?booking=FR-...&payment=...): avisa o resultado e abre "Minha conta".
  const retornoPagamento = useRef(false);
  useEffect(() => {
    if (retornoPagamento.current) return;
    const params = new URLSearchParams(window.location.search);
    const codigo = params.get('booking');
    const pagamento = params.get('payment');
    if (!codigo || !pagamento) return;
    if (!dbUser) return; // espera o login carregar
    retornoPagamento.current = true;
    if (pagamento === 'failed') {
      notify(`O pagamento da reserva ${codigo} não foi concluído. Você pode tentar de novo em "Minha conta" enquanto o prazo estiver valendo.`, 'error');
    } else if (pagamento === 'pending') {
      notify(`Pagamento da reserva ${codigo} em processamento. Avisaremos assim que o Mercado Pago confirmar.`, 'info');
    } else {
      notify(`Recebemos o retorno do pagamento da reserva ${codigo}. A confirmação aparece em "Minha conta" em instantes.`, 'success');
    }
    setShowAccount(true);
    params.delete('booking');
    params.delete('payment');
    const rest = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
  }, [dbUser, notify]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const [destLimite, setDestLimite] = useState(12);
  useEffect(() => setDestLimite(12), [destCategory, destRegion, searchQuery]);
  const filteredDestinations = useMemo(() => {
    return destinations.filter((d) => {
      if (destCategory !== 'all' && d.category !== destCategory) return false;
      if (destRegion !== 'all' && d.region !== destRegion) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hit =
          d.name.toLowerCase().includes(q) ||
          d.state.toLowerCase().includes(q) ||
          d.summary.toLowerCase().includes(q) ||
          d.category.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [destinations, destCategory, destRegion, searchQuery]);

  const filteredListings = useMemo(() => {
    return listings.filter((l) => {
      if (moduleFilter !== 'all' && l.moduleType !== moduleFilter) return false;
      if (maxPriceBrl && Number(maxPriceBrl) > 0 && l.priceCents > Number(maxPriceBrl) * 100) {
        return false;
      }
      if (minGuests && Number(minGuests) > 1 && l.capacity < Number(minGuests)) {
        return false;
      }
      if (amenityFilter.trim()) {
        const am = amenityFilter.trim().toLowerCase();
        if (!l.amenitiesJson.some((x) => x.toLowerCase().includes(am))) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hit =
          l.title.toLowerCase().includes(q) ||
          l.summary.toLowerCase().includes(q) ||
          l.address.toLowerCase().includes(q) ||
          (l.destinationName || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [listings, moduleFilter, maxPriceBrl, minGuests, amenityFilter, searchQuery]);

  const openBookingDirectly = async (listing: Listing) => {
    try {
      const res = await fetch(`/api/listings/${encodeURIComponent(listing.slug)}`);
      const data = await res.json();
      setBookingContext({ listing, slots: data.slots || [] });
    } catch {
      setBookingContext({ listing, slots: [] });
    }
  };

  const handleHeroSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) trackText(searchQuery, 'busca');
    document.getElementById('marketplace')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handlePopupAction = useCallback(
    (targetAction: string) => {
      if (targetAction.startsWith('section:')) {
        const id = targetAction.replace('section:', '').replace('#', '');
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (targetAction.startsWith('dest:')) {
        const slug = targetAction.replace('dest:', '');
        const match = destinations.find((d) => d.slug === slug);
        if (match) setSelectedDestination(match);
        else document.getElementById('destinos')?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (targetAction.startsWith('listing:')) {
        const slug = targetAction.replace('listing:', '');
        const match = listings.find((l) => l.slug === slug);
        if (match) setSelectedListing(match);
        else document.getElementById('marketplace')?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (targetAction.startsWith('filter:')) {
        const kind = targetAction.replace('filter:', '') as typeof moduleFilter;
        if (kind === 'experience' || kind === 'gastronomy' || kind === 'accommodation') {
          setModuleFilter(kind);
        } else {
          setModuleFilter('all');
        }
        document.getElementById('marketplace')?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (targetAction.startsWith('coupon:')) {
        // O site não oferece cupons de desconto: pop-up antigo só leva ao marketplace.
        document.getElementById('marketplace')?.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      if (targetAction === 'modal:ai') {
        setShowAIModal(true);
      } else if (targetAction === 'modal:merchant') {
        setShowMerchantPortal(true);
      } else if (targetAction === 'modal:account') {
        if (dbUser) setShowAccount(true);
        else requestLogin();
      } else if (targetAction === 'modal:chat') {
        setShowChat(true);
      } else if (targetAction === 'modal:pwa') {
        window.dispatchEvent(new CustomEvent('froc-open-pwa-guide'));
      }
    },
    [dbUser, destinations, listings, requestLogin, notify]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#FFFFFF] text-[#111111]">
      {/* TOP BAR CONTRACT: Strictly 3 zones, single line, gap-8 */}
      <header className="sticky top-0 z-50 bg-[#FFFFFF]/95 backdrop-blur-md border-b border-[#111111]/15">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4 md:gap-8">
          <a
            href="#top"
            className="font-display text-lg sm:text-xl font-extrabold tracking-tight text-[#111111] inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <img
              src="/logo-emblema.png"
              alt="Logotipo Froc Rota Turismo"
              width={40}
              height={40}
              className="w-10 h-10 object-contain shrink-0"
            />
            <span>Froc Rota</span>
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-bold text-[#111111]/80">
            <a
              href="#destinos"
              onClick={() => setModuleFilter('all')}
              className="hover:text-[#FF1493] transition-colors whitespace-nowrap shrink-0"
            >
              {t.navDestinations}
            </a>
            <a
              href="#marketplace"
              onClick={() => setModuleFilter('experience')}
              className="hover:text-[#FF1493] transition-colors whitespace-nowrap shrink-0"
            >
              {t.navExperiences}
            </a>
            <a
              href="#marketplace"
              onClick={() => setModuleFilter('gastronomy')}
              className="hover:text-[#FF1493] transition-colors whitespace-nowrap shrink-0"
            >
              {t.navGastronomy}
            </a>
            <a
              href="#marketplace"
              onClick={() => setModuleFilter('accommodation')}
              className="hover:text-[#FF1493] transition-colors whitespace-nowrap shrink-0"
            >
              {t.navStays}
            </a>
            <a
              href="#concierge"
              className="hover:text-[#FF1493] transition-colors whitespace-nowrap shrink-0"
            >
              {t.navConcierge}
            </a>
          </nav>

          <div className="shrink-0">
            {dbUser ? (
              <button
                type="button"
                onClick={() => setShowAccount(true)}
                className="min-h-[42px] px-4 py-2 rounded-xl froc-btn-neon text-xs font-extrabold whitespace-nowrap shrink-0"
              >
                ✈️ Minhas Viagens
              </button>
            ) : (
              <button
                type="button"
                onClick={requestLogin}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-[#111111] text-[#FFFFFF] border border-[#111111] text-xs font-bold hover:border-[#39FF14] hover:text-[#39FF14] transition-colors whitespace-nowrap shrink-0"
              >
                {t.signIn}
              </button>
            )}
          </div>
        </div>
        <div className="h-[2px] w-full froc-prism-bar" />
      </header>

      <main id="top" className="flex-1">
        {/* TOPO: dois carrosséis de fotos reais dos pontos turísticos do Brasil */}
        <HeroCarrossel
          onOpenDestination={(slug) => {
            if (destinations.some((x) => x.slug === slug)) openDestinationBySlug(slug);
            else window.location.href = `/destinos/${slug}`;
          }}
        />

        {/* ECOSYSTEM UTILITY, PWA & PORTALS BAR */}
        <section className="border-b-2 border-[#111111] bg-[#FFFFFF]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href="#mapa"
                className="min-h-[40px] inline-flex items-center px-3.5 py-2 rounded-xl border border-[#111111]/20 bg-[#FFFFFF] text-xs font-bold text-[#111111] hover:border-[#39FF14] hover:bg-[#39FF14]/15 whitespace-nowrap shrink-0 transition-colors"
              >
                🗺️ Mapa Interativo
              </a>
              <a
                href="#publicacoes"
                className="min-h-[40px] inline-flex items-center px-3.5 py-2 rounded-xl border border-[#111111]/20 bg-[#FFFFFF] text-xs font-bold text-[#111111] hover:border-[#FFD700] hover:bg-[#FFD700]/20 whitespace-nowrap shrink-0 transition-colors"
              >
                📰 Jornal Diário
              </a>
              <a
                href="#viagens"
                className="min-h-[40px] inline-flex items-center px-3.5 py-2 rounded-xl border border-[#111111]/20 bg-[#FFFFFF] text-xs font-bold text-[#111111] hover:border-[#FF1493] hover:text-[#FF1493] whitespace-nowrap shrink-0 transition-colors"
              >
                ✈️ {t.travelsBtn}
              </a>
              <button
                type="button"
                onClick={() => setShowChat(true)}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl froc-btn-pink text-xs font-bold whitespace-nowrap shrink-0"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chat em Tempo Real</span>
              </button>
              <button
                type="button"
                onClick={() => setShowMerchantPortal(true)}
                className="min-h-[40px] inline-flex items-center px-3.5 py-2 rounded-xl border border-[#111111] bg-[#FFFFFF] text-xs font-bold text-[#111111] hover:bg-[#FFD700] whitespace-nowrap shrink-0 transition-colors"
              >
                🏆 Painel do Anunciante
              </button>
              {isAnyAdmin && (
                <button
                  type="button"
                  onClick={() => setShowAdmin(true)}
                  className="min-h-[40px] inline-flex items-center px-3.5 py-2 rounded-xl bg-[#111111] text-[#FFD700] border border-[#FFD700] text-xs font-bold hover:bg-[#39FF14] hover:text-[#111111] whitespace-nowrap shrink-0 transition-colors"
                >
                  🛡️ {t.adminMaster}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Idioma"
                value={language}
                onChange={(e) => setLanguage(e.target.value as 'pt' | 'en' | 'es')}
                className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-[#111111]/25 bg-[#FFFFFF] text-xs font-bold text-[#111111]"
              >
                <option value="pt">Português</option>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
              <select
                aria-label="Moeda"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as 'BRL' | 'USD' | 'EUR')}
                className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-[#111111]/25 bg-[#FFFFFF] text-xs font-bold text-[#111111] font-mono-tabular"
              >
                <option value="BRL">BRL R$</option>
                <option value="USD">USD $</option>
                <option value="EUR">EUR €</option>
              </select>
              <PWAInstallButton />
            </div>
          </div>
        </section>

        {/* BENEFÍCIOS PARA O CLIENTE (sem números internos da operação) */}
        <section className="bg-[#FFFFFF] border-b border-[#111111]/10" data-testid="beneficios-strip">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: '🛡️', title: 'Parceiros verificados', text: 'Identidade e documentos conferidos' },
              { icon: '💳', title: 'Pagamento seguro', text: 'Processado pelo Mercado Pago' },
              { icon: '💬', title: 'Atendimento de verdade', text: 'Assistente IA e equipe humana' },
              { icon: '🇧🇷', title: 'Preços em reais', text: 'Sem surpresa na hora de pagar' },
            ].map((b) => (
              <div
                key={b.title}
                className="p-4 rounded-2xl border border-[#111111]/15 bg-[#FFFFFF] flex items-start gap-3"
              >
                <span className="text-2xl leading-none" aria-hidden="true">{b.icon}</span>
                <div>
                  <div className="text-sm font-extrabold text-[#111111]">{b.title}</div>
                  <div className="text-xs text-[#111111]/70 mt-0.5">{b.text}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 space-y-20">
          {catalogError && (
            <div className="p-4 rounded-2xl bg-[#FFFFFF] border-2 border-[#FF1493] text-sm text-[#111111] flex justify-between items-center gap-4">
              <span className="font-semibold">{catalogError}</span>
              <button
                type="button"
                onClick={loadCatalog}
                className="min-h-[42px] px-4 py-2 rounded-xl froc-btn-pink text-xs font-bold"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {/* MÓDULO 1 — DESTINOS */}
          <section id="destinos" className="scroll-mt-24">
            <div className="flex flex-wrap items-end justify-between gap-6 mb-8">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[#FF1493]">
                  <span>🧭 Destinos pelo Brasil</span>
                </div>
                <h2 className="text-3xl md:text-4xl font-extrabold text-[#111111] mt-1">
                  {t.destinationsTitle}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-[#FFFFFF] border border-[#111111]/20 rounded-xl">
                  {[
                    { id: 'all', label: `✨ ${t.allCategories}` },
                    { id: 'ilha', label: '🏝️ Ilhas' },
                    { id: 'praia', label: '🏖️ Praias' },
                    { id: 'cachoeira', label: '💧 Cachoeiras' },
                    { id: 'parque', label: '🏞️ Parques' },
                    { id: 'historico', label: '🏛️ Históricos' },
                    { id: 'serra', label: '⛰️ Serras' },
                    { id: 'cidade', label: '🏙️ Cidades' },
                    { id: 'ecoturismo', label: '🌿 Ecoturismo' },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setDestCategory(cat.id)}
                      className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                        destCategory === cat.id
                          ? 'bg-[#111111] text-[#39FF14] border border-[#111111]'
                          : 'text-[#111111]/75 hover:bg-[#111111]/5'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <select
                  aria-label="Região"
                  value={destRegion}
                  onChange={(e) => setDestRegion(e.target.value)}
                  className="min-h-[42px] px-3 py-2 rounded-xl border border-[#111111]/25 bg-[#FFFFFF] text-xs font-bold text-[#111111]"
                >
                  <option value="all">🌎 Todas as regiões</option>
                  <option value="Nordeste">Nordeste</option>
                  <option value="Sudeste">Sudeste</option>
                  <option value="Centro-Oeste">Centro-Oeste</option>
                  <option value="Sul">Sul</option>
                  <option value="Norte">Norte</option>
                </select>
              </div>
            </div>

            {loadingCatalog ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="h-80 rounded-2xl bg-[#FFFFFF] border border-[#111111]/15 animate-pulse"
                  />
                ))}
              </div>
            ) : filteredDestinations.length === 0 ? (
              <div className="p-10 text-center rounded-2xl bg-[#FFFFFF] border border-[#111111]/20 text-sm text-[#111111]/75">
                Nenhum destino corresponde ao filtro atual.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7">
                {filteredDestinations.slice(0, destLimite).map((dest) => (
                  <article
                    key={dest.id}
                    className="group bg-[#FFFFFF] rounded-2xl border border-[#111111]/20 froc-luminous-border overflow-hidden flex flex-col hover:-translate-y-1 transition-transform duration-300"
                  >
                    <div className="aspect-[4/3] overflow-hidden relative">
                      <ResilientImage
                        src={dest.coverImage}
                        alt={`${dest.name}, ${dest.state}`}
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                      />
                      <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-[#111111]/90 text-[#FFD700] text-[10px] font-extrabold uppercase tracking-wide border border-[#FFD700]/60">
                        {dest.region} · {dest.state}
                      </div>
                    </div>
                    <FotoCredito credito={dest.fotoCredito} className="px-5 pt-1.5" />
                    <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                      <div>
                        <div className="flex items-center justify-between text-xs text-[#111111]/70">
                          <span className="font-bold uppercase tracking-wide text-[#FF1493]">
                            {CATEGORIA_PT[dest.category] || dest.category}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#FFD700] text-[#111111] font-mono-tabular font-extrabold border border-[#111111]">
                            <Star className="w-3.5 h-3.5 fill-[#111111] text-[#111111]" />
                            {dest.reviewCount > 0 && dest.ratingAvg > 0 ? dest.ratingAvg.toFixed(2) : 'Novo'}
                          </span>
                        </div>
                        <h3 className="text-xl font-extrabold text-[#111111] mt-1.5">
                          {dest.name}
                        </h3>
                        <p className="text-sm text-[#111111]/75 mt-1.5 line-clamp-2 leading-relaxed">
                          {dest.summary}
                        </p>
                      </div>

                      <div className="pt-3 border-t border-[#111111]/10 flex items-center justify-between">
                        <div className="text-xs text-[#111111]/70">
                          {dest.avgBudgetDayCents > 0 ? (
                            <>
                              Média diária{' '}
                              <span className="font-mono-tabular font-extrabold text-[#111111]">
                                {formatMoney(dest.avgBudgetDayCents, currency)}
                              </span>
                            </>
                          ) : (
                            <span>{dest.highlightsJson?.[0] ? `✨ ${dest.highlightsJson[0]}` : `📍 ${dest.state}`}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedDestination(dest)}
                          className="min-h-[38px] px-3.5 py-1.5 rounded-xl froc-btn-neon text-xs font-extrabold whitespace-nowrap"
                        >
                          {t.viewDetails} →
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {filteredDestinations.length > destLimite && (
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => setDestLimite((n) => n + 12)}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#111111] text-white text-sm font-extrabold"
                  data-testid="mais-destinos"
                >
                  Ver mais destinos ({filteredDestinations.length - destLimite} restantes)
                </button>
              </div>
            )}
          </section>

          {/* MAPA INTERATIVO & GEOLOCALIZAÇÃO */}
          <section id="mapa" className="scroll-mt-24">
            <div className="max-w-2xl mb-6">
              <div className="text-xs font-extrabold uppercase tracking-wider text-[#FF1493]">
                📍 Mapa dos destinos
              </div>
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#111111] mt-1">
                {t.mapSectionTitle}
              </h2>
              <p className="text-sm text-[#111111]/75 mt-2 leading-relaxed">{t.mapSectionSub}</p>
            </div>
            <InteractiveMap
              destinations={destinations}
              listings={listings}
              onSelectDestination={(d) => setSelectedDestination(d)}
              onSelectListing={(l) => setSelectedListing(l)}
            />
          </section>

          {/* Propaganda do Froc X Uber (app de corridas da Froc) */}
          <FrocXPromo />

          {/* VITRINE DO BRASIL — todos os destinos, cada um com página própria no Google */}
          <VitrineBrasil onOpenDestination={openDestinationBySlug} onSearch={searchFromVitrine} />

          {/* VITRINE PREMIUM — anúncios dos parceiros */}
          {listings.length > 0 && (
            <VitrinePremium
              listings={listings}
              onOpenListing={(l) => setSelectedListing(l)}
              onAdvertise={() => setShowMerchantPortal(true)}
            />
          )}

          {/* MÓDULOS 2, 3, 4 — MARKETPLACE INTEGRADO */}
          <section id="marketplace" className="scroll-mt-24">
            <div className="flex flex-wrap items-end justify-between gap-6 mb-6">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wider text-[#FF1493]">
                  💎 Parceiros Verificados
                </div>
                <h2 className="text-3xl md:text-4xl font-extrabold text-[#111111] mt-1">
                  {t.marketplaceTitle}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-1 p-1 bg-[#FFFFFF] border border-[#111111]/20 rounded-xl">
                {[
                  { id: 'all', label: `✨ ${t.allCategories}` },
                  { id: 'experience', label: `🚤 ${t.navExperiences}` },
                  { id: 'gastronomy', label: `🍽️ ${t.navGastronomy}` },
                  { id: 'accommodation', label: `🏨 ${t.navStays}` },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setModuleFilter(tab.id as typeof moduleFilter)}
                    className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                      moduleFilter === tab.id
                        ? 'bg-[#111111] text-[#39FF14]'
                        : 'text-[#111111]/75 hover:bg-[#111111]/5'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filtros avançados */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8 p-4 rounded-2xl bg-[#FFFFFF] border-2 border-[#111111]/15">
              <div>
                <label className="block text-[11px] font-bold text-[#111111] mb-1">
                  Preço máximo (R$)
                </label>
                <input
                  type="number"
                  min={50}
                  value={maxPriceBrl}
                  onChange={(e) => setMaxPriceBrl(e.target.value)}
                  placeholder="Ex: 500"
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#111111]/25 text-xs font-mono-tabular focus:outline-none focus:border-[#39FF14]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#111111] mb-1">
                  Hóspedes / Pessoas mín.
                </label>
                <input
                  type="number"
                  min={1}
                  value={minGuests}
                  onChange={(e) => setMinGuests(e.target.value)}
                  placeholder="Ex: 2"
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#111111]/25 text-xs font-mono-tabular focus:outline-none focus:border-[#39FF14]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-[#111111] mb-1">
                  Comodidade (piscina, praia, snorkel)
                </label>
                <input
                  type="text"
                  value={amenityFilter}
                  onChange={(e) => setAmenityFilter(e.target.value)}
                  placeholder="Filtrar comodidade..."
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#111111]/25 text-xs focus:outline-none focus:border-[#39FF14]"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setMaxPriceBrl('');
                    setMinGuests('');
                    setAmenityFilter('');
                    setModuleFilter('all');
                  }}
                  className="w-full min-h-[42px] py-2 px-3 rounded-xl border border-[#111111] text-xs font-bold text-[#111111] hover:bg-[#FF1493] hover:text-[#FFFFFF] hover:border-[#FF1493] transition-colors"
                >
                  Limpar filtros
                </button>
              </div>
            </div>

            {filteredListings.length === 0 ? (
              <div className="p-10 text-center rounded-2xl bg-[#FFFFFF] border border-[#111111]/20 text-sm text-[#111111]/75">
                Nenhuma oferta encontrada com esses filtros.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7">
                {filteredListings.map((item) => (
                  <article
                    key={item.id}
                    className={`bg-[#FFFFFF] rounded-2xl border overflow-hidden flex flex-col justify-between transition-transform duration-300 hover:-translate-y-1 ${
                      item.promoLabel
                        ? 'froc-pink-frame border-[#FF1493]'
                        : item.isFeatured
                        ? 'froc-gold-frame border-[#111111]'
                        : 'froc-luminous-border border-[#111111]/20'
                    }`}
                  >
                    <div>
                      <div className="aspect-[4/3] overflow-hidden relative">
                        <ResilientImage
                          src={item.coverImage}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                        {item.promoLabel && (
                          <span className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-[#FF1493] text-[#FFFFFF] text-[10px] font-extrabold uppercase tracking-wide shadow-md">
                            🔥 {item.promoLabel}
                          </span>
                        )}
                      </div>
                      <div className="p-5 space-y-2">
                        <div className="flex items-center justify-between text-xs text-[#111111]/70">
                          <span className="font-bold">
                            {item.moduleType === 'experience'
                              ? '🚤 Experiência'
                              : item.moduleType === 'gastronomy'
                              ? '🍽️ Gastronomia'
                              : '🏨 Hospedagem'}{' '}
                            · {item.destinationName || item.subtype}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#FFD700] text-[#111111] font-mono-tabular font-extrabold border border-[#111111]">
                            <Star className="w-3.5 h-3.5 fill-[#111111] text-[#111111]" />
                            {item.reviewCount > 0 && item.ratingAvg > 0 ? item.ratingAvg.toFixed(2) : 'Novo'}
                          </span>
                        </div>
                        <h3 className="text-lg font-extrabold text-[#111111] leading-snug">
                          {item.title}
                        </h3>
                        <p className="text-xs text-[#111111]/75 line-clamp-2 leading-relaxed">
                          {item.summary}
                        </p>
                        {item.merchantVerified && (
                          <div className="text-[11px] bg-[#39FF14]/25 border border-[#111111]/20 px-2 py-0.5 rounded-md text-[#111111] font-bold inline-flex items-center gap-1 pt-0.5">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>
                              {item.merchantTradeName || t.verifiedPartner}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="px-5 py-4 border-t border-[#111111]/10 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-base font-extrabold text-[#111111] font-mono-tabular">
                          {formatMoney(item.promoPriceCents ?? item.priceCents, currency)}
                        </div>
                        <div className="text-[11px] text-[#111111]/65 font-semibold">
                          {item.moduleType === 'accommodation' ? t.perNight : t.perPerson}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedListing(item)}
                          className="min-h-[40px] px-3 py-2 rounded-xl border border-[#111111]/25 text-xs font-bold text-[#111111] hover:border-[#111111] whitespace-nowrap"
                        >
                          Detalhes
                        </button>
                        <button
                          type="button"
                          onClick={() => openBookingDirectly(item)}
                          className="min-h-[40px] px-3.5 py-2 rounded-xl froc-btn-neon text-xs font-extrabold whitespace-nowrap"
                        >
                          {t.reserveNow}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* JORNAL EDITORIAL — 5 POSTS DIÁRIOS */}
          <EditorialDailySection initialPostSlug={initialPostSlug} />

          {/* MÓDULOS 5 & 6 — VIAGENS & CONCIERGE */}
          <TravelAndConciergeSection />

          {/* CHAMADA PARA PARCEIROS */}
          <section className="rounded-2xl border-2 border-[#111111] bg-[#FFFFFF] froc-gold-frame p-8 md:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="max-w-2xl space-y-2">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#FFD700] text-[#111111] border border-[#111111] text-[11px] font-extrabold uppercase">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Comerciantes, Operadores Náuticos, Guias, Restaurantes e Pousadas</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-extrabold text-[#111111]">
                Conecte seu negócio turístico à Froc Rota Turismo
              </h2>
              <p className="text-sm text-[#111111]/75 leading-relaxed">
                Planos a partir de R$ 100,00 por mês com cobrança automática no cartão, cadastro
                verificado (anti-fraude), calendário de vagas, Central de Marketing IA e recebimento
                direto pelo Mercado Pago com split automático.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowMerchantPortal(true)}
              className="min-h-[48px] px-6 py-3 rounded-xl froc-btn-neon text-sm font-extrabold whitespace-nowrap shrink-0"
            >
              🚀 Cadastrar Empresa Parceira
            </button>
          </section>
        </div>
      </main>

      {/* FUTURISTIC FOOTER */}
      <footer className="border-t-2 border-[#111111] bg-[#FFFFFF]">
        <div className="h-[3px] w-full froc-prism-bar" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-xs text-[#111111]/75">
          <div>
            <div className="font-display text-base font-extrabold text-[#111111] inline-flex items-center gap-2">
              <img
                src="/logo-froc-rota.png"
                alt="Froc Rota Turismo"
                width={110}
                height={120}
                loading="lazy"
                className="w-[110px] h-auto shrink-0"
              />
            </div>
            <div className="mt-1 font-semibold">{t.slogan}</div>
          </div>

          <div className="flex flex-wrap items-center gap-5 font-semibold">
            <button
              type="button"
              onClick={() => setShowLegal(true)}
              className="hover:text-[#FF1493] underline"
            >
              LGPD, Privacidade &amp; CDC
            </button>
            <button
              type="button"
              onClick={() => setShowChat(true)}
              className="hover:text-[#FF1493]"
            >
              Chat em Tempo Real
            </button>
            <button
              type="button"
              onClick={() => setShowMerchantPortal(true)}
              className="hover:text-[#FF1493]"
            >
              Painel do Anunciante
            </button>
            <a href="/destinos" className="hover:text-[#FF1493]">Destinos do Brasil</a>
            <a href="/blog" className="hover:text-[#FF1493]">Blog de viagem</a>
            <a href="/anuncie" className="hover:text-[#FF1493]">Anuncie</a>
            <a href="/sobre" className="hover:text-[#FF1493]">Sobre</a>
            <a href="/contato" className="hover:text-[#FF1493]">Contato</a>
            <a href="/politica-de-privacidade" className="hover:text-[#FF1493]">Política de Privacidade</a>
            <a href="/termos-de-uso" className="hover:text-[#FF1493]">Termos de Uso</a>
            <a href="/sitemap.xml" className="hover:text-[#FF1493]">Sitemap</a>
            <span>© {new Date().getFullYear()} Froc Rota Turismo</span>
          </div>
        </div>
      </footer>

      {/* MODALS & OVERLAYS (CODE-SPLITTED) */}
      <Suspense fallback={<LazyFallback />}>
        {selectedDestination && (
          <DestinationDetailModal
            destination={selectedDestination}
            onClose={() => setSelectedDestination(null)}
            onSelectListing={(l) => {
              setSelectedDestination(null);
              setSelectedListing(l);
            }}
            onOpenAiForDestination={(destName) => {
              setSelectedDestination(null);
              setAiInitialPrompt(
                `Monte um roteiro de 3 dias em ${destName} usando experiências e serviços disponíveis na Froc Rota.`
              );
              setShowAIModal(true);
            }}
          />
        )}

        {selectedListing && (
          <ListingDetailModal
            listing={selectedListing}
            onClose={() => setSelectedListing(null)}
            onBook={(listing, slots) => {
              setSelectedListing(null);
              setBookingContext({ listing, slots });
            }}
          />
        )}

        {bookingContext && (
          <BookingModal
            listing={bookingContext.listing}
            slots={bookingContext.slots}
            onClose={() => setBookingContext(null)}
            onSuccess={loadCatalog}
          />
        )}

        {showAIModal && (
          <FrocRotaAIModal
            initialPrompt={aiInitialPrompt}
            onClose={() => setShowAIModal(false)}
            onSelectDestinationSlug={(slug) => {
              const match = destinations.find((d) => d.slug === slug);
              if (match) setSelectedDestination(match);
            }}
            onSelectListingSlug={(slug) => {
              const match = listings.find((l) => l.slug === slug);
              if (match) setSelectedListing(match);
            }}
          />
        )}

        {showMerchantPortal && (
          <MerchantPortal
            destinations={destinations}
            onClose={() => setShowMerchantPortal(false)}
            onListingCreated={loadCatalog}
          />
        )}

        {showAccount && (
          <TouristAccount
            onClose={() => setShowAccount(false)}
            onOpenChat={() => setShowChat(true)}
          />
        )}

        {showAdmin && isAnyAdmin && (
          <AdminMasterPanel
            onClose={() => setShowAdmin(false)}
            onOpenChat={() => setShowChat(true)}
          />
        )}

        {showChat && (
          <RealtimeChatDrawer
            onClose={() => setShowChat(false)}
            defaultChannel={isAnyAdmin ? 'admin' : dbUser?.role === 'merchant' ? 'merchant' : 'tourist'}
          />
        )}

        {showLegal && <LegalComplianceModal onClose={() => setShowLegal(false)} />}
      </Suspense>

      {/* SMART PROMOTIONAL POP-UP ENGINE (54+ READY MODELS) */}
      {/* Só um pop-up por vez: privacidade/oportunidade da IA têm prioridade sobre os demais */}
      <IntentOpportunity
        blocked={hasOpenOverlay}
        onOpenDestination={openDestinationBySlug}
        onOpenOffer={openListingBySlug}
        onVisibleChange={setIntentVisible}
      />
      <AdvertiserCampaign
        blocked={hasOpenOverlay || intentVisible}
        isMerchant={dbUser?.role === 'merchant' || Boolean(merchant)}
        onAdvertise={() => setShowMerchantPortal(true)}
        onVisibleChange={setCampanhaVisivel}
      />
      <PromoPopupEngine
        blockedByOverlay={hasOpenOverlay || intentVisible || campanhaVisivel}
        userAudience={dbUser?.role === 'merchant' ? 'merchants' : 'tourists'}
        onAction={handlePopupAction}
      />

      <OfflineIndicator />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <FrocRotaPlatform />
      </AppProvider>
    </ErrorBoundary>
  );
}
