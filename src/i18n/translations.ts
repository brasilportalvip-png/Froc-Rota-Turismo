import { AppCurrency, AppLanguage } from '../types.ts';

export const CURRENCY_RATES_FROM_BRL: Record<AppCurrency, number> = {
  BRL: 1,
  USD: 0.18,
  EUR: 0.17,
};

export function formatMoney(amountCentsBrl: number, currency: AppCurrency): string {
  const converted = (amountCentsBrl / 100) * CURRENCY_RATES_FROM_BRL[currency];
  const locale = currency === 'BRL' ? 'pt-BR' : currency === 'USD' ? 'en-US' : 'de-DE';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(converted);
}

export const TRANSLATIONS: Record<
  AppLanguage,
  {
    slogan: string;
    heroTitle: string;
    heroSubtitle: string;
    searchPlaceholder: string;
    exploreDestinations: string;
    askAiBtn: string;
    navDestinations: string;
    navExperiences: string;
    navGastronomy: string;
    navStays: string;
    navConcierge: string;
    signIn: string;
    myAccount: string;
    partnerPortal: string;
    adminMaster: string;
    travelsBtn: string;
    mapSectionTitle: string;
    mapSectionSub: string;
    destinationsTitle: string;
    marketplaceTitle: string;
    travelsTitle: string;
    conciergeTitle: string;
    allCategories: string;
    perPerson: string;
    perNight: string;
    reserveNow: string;
    viewDetails: string;
    verifiedPartner: string;
  }
> = {
  pt: {
    slogan: 'O Brasil é seu. O mundo é seu destino.',
    heroTitle: 'Descubra o Brasil extraordinário em um único ecossistema.',
    heroSubtitle:
      'Destinos mapeados, experiências náuticas verificadas, gastronomia regional, hospedagens autorais, passagens e concierge inteligente.',
    searchPlaceholder: 'Buscar destino, praia, passeio de lancha, restaurante ou pousada...',
    exploreDestinations: 'Explorar Destinos',
    askAiBtn: 'Consultar Froc Rota AI',
    navDestinations: 'Destinos',
    navExperiences: 'Experiências',
    navGastronomy: 'Gastronomia',
    navStays: 'Hospedagem',
    navConcierge: 'Concierge',
    signIn: 'Entrar',
    myAccount: 'Minha Conta',
    partnerPortal: 'Área de Parceiros',
    adminMaster: 'Painel Admin',
    travelsBtn: 'Passagens & Viagens',
    mapSectionTitle: 'Bússola Turística & Mapa Interativo',
    mapSectionSub:
      'Localize destinos, restaurantes, pousadas e embarcações próximos a você com rotas e distâncias em tempo real.',
    destinationsTitle: 'Destinos Curados do Brasil',
    marketplaceTitle: 'Experiências, Sabores e Hospedagens',
    travelsTitle: 'Central Inteligente de Passagens & Transportes',
    conciergeTitle: 'Froc Rota Concierge — Sua Viagem Completa',
    allCategories: 'Todos',
    perPerson: 'por pessoa',
    perNight: 'por diária',
    reserveNow: 'Reservar',
    viewDetails: 'Ver Detalhes',
    verifiedPartner: 'Parceiro Verificado',
  },
  en: {
    slogan: 'Brazil is yours. The world is your destination.',
    heroTitle: 'Discover extraordinary Brazil in one intelligent ecosystem.',
    heroSubtitle:
      'Curated destinations, verified boat & nature experiences, regional gastronomy, boutique stays, flights, and personal AI concierge.',
    searchPlaceholder: 'Search destination, beach, boat tour, restaurant or boutique stay...',
    exploreDestinations: 'Explore Destinations',
    askAiBtn: 'Ask Froc Rota AI',
    navDestinations: 'Destinations',
    navExperiences: 'Experiences',
    navGastronomy: 'Gastronomy',
    navStays: 'Stays',
    navConcierge: 'Concierge',
    signIn: 'Sign In',
    myAccount: 'My Account',
    partnerPortal: 'Partner Portal',
    adminMaster: 'Admin Master',
    travelsBtn: 'Flights & Mobility',
    mapSectionTitle: 'Tourism Compass & Interactive Map',
    mapSectionSub:
      'Discover destinations, restaurants, stays, and boat tours nearby with real-time distance and routing.',
    destinationsTitle: 'Curated Brazilian Destinations',
    marketplaceTitle: 'Experiences, Dining & Stays',
    travelsTitle: 'Smart Flights & Ground Mobility Hub',
    conciergeTitle: 'Froc Rota Concierge — End-to-End Trips',
    allCategories: 'All',
    perPerson: 'per guest',
    perNight: 'per night',
    reserveNow: 'Book Now',
    viewDetails: 'View Details',
    verifiedPartner: 'Verified Partner',
  },
  es: {
    slogan: 'Brasil es tuyo. El mundo es tu destino.',
    heroTitle: 'Descubre el Brasil extraordinario en un solo ecosistema.',
    heroSubtitle:
      'Destinos curados, experiencias náuticas verificadas, gastronomía regional, alojamientos boutique, vuelos y concierge inteligente.',
    searchPlaceholder: 'Buscar destino, playa, paseo en lancha, restaurante o posada...',
    exploreDestinations: 'Explorar Destinos',
    askAiBtn: 'Consultar Froc Rota AI',
    navDestinations: 'Destinos',
    navExperiences: 'Experiencias',
    navGastronomy: 'Gastronomía',
    navStays: 'Alojamiento',
    navConcierge: 'Concierge',
    signIn: 'Ingresar',
    myAccount: 'Mi Cuenta',
    partnerPortal: 'Portal de Socios',
    adminMaster: 'Panel Admin',
    travelsBtn: 'Vuelos y Transporte',
    mapSectionTitle: 'Brújula Turística y Mapa Interactivo',
    mapSectionSub:
      'Encuentra destinos, restaurantes, posadas y paseos cercanos con distancias y rutas en tiempo real.',
    destinationsTitle: 'Destinos Curados de Brasil',
    marketplaceTitle: 'Experiencias, Sabores y Alojamientos',
    travelsTitle: 'Central Inteligente de Vuelos y Transporte',
    conciergeTitle: 'Froc Rota Concierge — Viajes Completos',
    allCategories: 'Todos',
    perPerson: 'por persona',
    perNight: 'por noche',
    reserveNow: 'Reservar',
    viewDetails: 'Ver Detalles',
    verifiedPartner: 'Socio Verificado',
  },
};
