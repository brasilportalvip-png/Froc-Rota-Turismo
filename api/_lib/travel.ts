import { duffelMode, isMadrugada, searchDuffelOffers } from './duffel.js';
import { computePriceFromRule, resolvePricingRule } from './pricing.js';

export interface TravelIntegrationStatus {
  provider: string;
  category:
    | 'flights'
    | 'buses'
    | 'car_rental'
    | 'external_stays'
    | 'maps'
    | 'business_profile'
    | 'email'
    | 'ad_networks';
  configured: boolean;
  docsUrl: string;
  requiredEnvVars: string[];
  notes: string;
}

export function getTravelIntegrationsStatus(): TravelIntegrationStatus[] {
  const amadeusReady = Boolean(
    process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET
  );
  const gbpReady = Boolean(
    process.env.GOOGLE_BUSINESS_CLIENT_ID && process.env.GOOGLE_BUSINESS_CLIENT_SECRET
  );
  const mapsReady = Boolean(process.env.VITE_GOOGLE_MAPS_API_KEY);
  const trivagoReady = Boolean(process.env.TRIVAGO_PARTNER_ID);
  const emailReady = Boolean(process.env.RESEND_API_KEY);

  return [
    {
      provider: 'Amadeus Flight Offers API v2 (GDS / NDC)',
      category: 'flights',
      configured: amadeusReady,
      docsUrl: 'https://developers.amadeus.com/self-service/category/flights/api-doc/flight-offers-search',
      requiredEnvVars: ['AMADEUS_CLIENT_ID', 'AMADEUS_CLIENT_SECRET'],
      notes: amadeusReady
        ? 'Credenciais Amadeus presentes (o cadastro self-service da Amadeus foi encerrado em 17/07/2026; só funciona com contrato Enterprise).'
        : 'A Amadeus encerrou o cadastro self-service em 17/07/2026; agora exige contrato Enterprise. O site usa a Duffel para passagens.',
    },
    {
      provider: 'Duffel Flights API (NDC Direto)',
      category: 'flights',
      configured: Boolean(process.env.DUFFEL_ACCESS_TOKEN),
      docsUrl: 'https://duffel.com/docs/api/overview/welcome',
      requiredEnvVars: ['DUFFEL_ACCESS_TOKEN'],
      notes:
        duffelMode() === 'live'
          ? 'Conectado em modo real: preços e horários vêm direto das companhias aéreas.'
          : duffelMode() === 'test'
          ? 'Conectado em MODO TESTE: as ofertas são da companhia fictícia Duffel Airways (sem dinheiro). Ative a conta Duffel para ver companhias reais.'
          : 'Aguardando DUFFEL_ACCESS_TOKEN para buscar passagens reais.',
    },
    {
      provider: 'Google Business Profile API (OAuth Lojistas)',
      category: 'business_profile',
      configured: gbpReady,
      docsUrl: 'https://developers.google.com/my-business/content/basic-setup',
      requiredEnvVars: ['GOOGLE_BUSINESS_CLIENT_ID', 'GOOGLE_BUSINESS_CLIENT_SECRET'],
      notes: gbpReady
        ? 'OAuth ativo para lojistas associarem fichas do Google Meu Negócio.'
        : 'Aguardando credenciais OAuth do Google Cloud Console para conexão de anunciantes.',
    },
    {
      provider: 'Google Maps Platform (Maps JS + Markers)',
      category: 'maps',
      configured: mapsReady,
      docsUrl: 'https://developers.google.com/maps/documentation/javascript',
      requiredEnvVars: ['VITE_GOOGLE_MAPS_API_KEY'],
      notes: mapsReady
        ? 'Ativo e provisionado para mapa interativo, marcadores e rotas.'
        : 'Provisionar chave Google Maps Platform.',
    },
    {
      provider: 'Trivago & Redes de Hospedagem (Afiliados/Partner)',
      category: 'ad_networks',
      configured: trivagoReady,
      docsUrl: 'https://studio.trivago.com/',
      requiredEnvVars: ['TRIVAGO_PARTNER_ID'],
      notes: trivagoReady
        ? 'Feed e rastreamento de campanhas Trivago ativos.'
        : 'Pronto para conexão contratual/afiliada com Trivago e comparadores externos.',
    },
    {
      provider: 'Parceiros Rodoviários & Transfers (ClickBus / Mobifacil)',
      category: 'buses',
      configured: Boolean(process.env.BUS_PARTNER_API_KEY),
      docsUrl: 'https://www.clickbus.com.br/',
      requiredEnvVars: ['BUS_PARTNER_API_KEY'],
      notes: 'Integração via contrato comercial para linhas rodoviárias brasileiras.',
    },
    {
      provider: 'Locadoras de Veículos (RentCars / Localiza)',
      category: 'car_rental',
      configured: Boolean(process.env.CAR_PARTNER_API_KEY),
      docsUrl: 'https://www.rentcars.com/',
      requiredEnvVars: ['CAR_PARTNER_API_KEY'],
      notes: 'Comparador e encaminhamento com rastreamento de comissão.',
    },
    {
      provider: 'Serviço de E-mail Transacional (Resend / SMTP)',
      category: 'email',
      configured: emailReady,
      docsUrl: 'https://resend.com/docs',
      requiredEnvVars: ['RESEND_API_KEY'],
      notes: emailReady
        ? 'Ativo para envio automático de bilhetes e vouchers.'
        : 'Aguardando RESEND_API_KEY para despacho real de e-mails de confirmação.',
    },
  ];
}

export async function searchLiveFlightsIfConfigured(params: {
  originIata: string;
  destinationIata: string;
  departureDate: string;
  returnDate?: string;
  tripType?: 'one_way' | 'round_trip' | 'multi_city';
  adults: number;
  maxPriceBrl?: number;
  madrugadaOnly?: boolean;
}) {
  // Duffel primeiro (cadastro aberto); Amadeus só se alguém tiver contrato Enterprise.
  if (process.env.DUFFEL_ACCESS_TOKEN) {
    const mode = duffelMode();
    let offers = await searchDuffelOffers({
      originIata: params.originIata.toUpperCase().slice(0, 3),
      destinationIata: params.destinationIata.toUpperCase().slice(0, 3),
      departureDate: params.departureDate,
      returnDate: params.tripType === 'round_trip' ? params.returnDate : undefined,
      adults: params.adults,
    });
    if (params.madrugadaOnly) offers = offers.filter((o) => isMadrugada(o.departureAt));
    // Taxa Froc Rota (regra de passagens do Motor Financeiro) só quando a tarifa vem em reais.
    for (const o of offers) {
      if (o.price.currency !== 'BRL') continue;
      try {
        const rule = await resolvePricingRule({ category: 'flights', costCents: o.totalCents });
        if (rule) {
          const b = computePriceFromRule({ supplierCostCents: o.totalCents, rule });
          o.finalClientCents = b.finalClientCents;
          o.platformFeeCents = b.finalClientCents - o.totalCents;
        }
      } catch {
        // sem regra: mostra só a tarifa da companhia
      }
    }
    if (params.maxPriceBrl && params.maxPriceBrl > 0) {
      offers = offers.filter(
        (o) => o.price.currency !== 'BRL' || (o.finalClientCents ?? o.totalCents) <= params.maxPriceBrl! * 100
      );
    }
    return {
      connected: true,
      provider: mode === 'live' ? 'Duffel' : 'Duffel (modo teste)',
      mode,
      offers,
      radarOpportunities: offers.slice(0, 5),
      message:
        offers.length === 0
          ? 'Nenhuma oferta encontrada para essa data e rota. Tente outra data.'
          : mode === 'test'
          ? 'Modo teste: ofertas da companhia fictícia Duffel Airways, só para testar o site. Nenhuma compra real.'
          : undefined,
      integrations: getTravelIntegrationsStatus(),
    };
  }

  const clientId = process.env.AMADEUS_CLIENT_ID;
  const clientSecret = process.env.AMADEUS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      connected: false,
      provider: 'Duffel',
      offers: [],
      radarOpportunities: [],
      message:
        'Busca de passagens aguardando a chave da Duffel (DUFFEL_ACCESS_TOKEN). Por transparência, tarifas e horários nunca são inventados.',
      integrations: getTravelIntegrationsStatus(),
    };
  }

  const tokenRes = await fetch('https://test.api.amadeus.com/v1/security/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Amadeus OAuth error: ${tokenRes.status}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };
  const qs = new URLSearchParams({
    originLocationCode: params.originIata.toUpperCase().slice(0, 3),
    destinationLocationCode: params.destinationIata.toUpperCase().slice(0, 3),
    departureDate: params.departureDate,
    adults: String(Math.max(1, Math.min(9, params.adults))),
    currencyCode: 'BRL',
    max: '20',
  });

  if (params.returnDate && params.tripType === 'round_trip') {
    qs.set('returnDate', params.returnDate);
  }
  if (params.maxPriceBrl && params.maxPriceBrl > 0) {
    qs.set('maxPrice', String(Math.round(params.maxPriceBrl)));
  }

  const offersRes = await fetch(
    `https://test.api.amadeus.com/v2/shopping/flight-offers?${qs.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    }
  );

  if (!offersRes.ok) {
    const text = await offersRes.text();
    throw new Error(`Amadeus search error: ${offersRes.status} ${text}`);
  }

  const offersJson = (await offersRes.json()) as {
    data?: Array<{
      id?: string;
      price?: { total?: string; currency?: string };
      itineraries?: Array<{
        duration?: string;
        segments?: Array<{
          departure?: { iataCode?: string; at?: string };
          arrival?: { iataCode?: string; at?: string };
          carrierCode?: string;
          number?: string;
        }>;
      }>;
    }>;
  };

  let offers = offersJson.data ?? [];
  if (params.madrugadaOnly) {
    offers = offers.filter((o) => {
      const depAt = o.itineraries?.[0]?.segments?.[0]?.departure?.at ?? '';
      const hourMatch = depAt.match(/T(\d{2}):/);
      const hour = hourMatch ? Number(hourMatch[1]) : 12;
      return hour >= 0 && hour < 6;
    });
  }

  return {
    connected: true,
    provider: 'Amadeus Flight Offers API v2',
    offers,
    radarOpportunities: offers.slice(0, 5),
    integrations: getTravelIntegrationsStatus(),
  };
}
