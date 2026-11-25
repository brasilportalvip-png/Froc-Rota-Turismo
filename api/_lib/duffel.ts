/**
 * Duffel Flights API: busca de passagens reais (preço e horários vêm da companhia aérea).
 * Chave em DUFFEL_ACCESS_TOKEN. "duffel_test_" = modo teste (companhia fictícia Duffel Airways, sem dinheiro);
 * "duffel_live_" = companhias reais, depois que a conta Duffel é ativada.
 */

const DUFFEL_API = 'https://api.duffel.com';

export interface NormalizedFlightOffer {
  id: string;
  provider: 'duffel';
  airline: string;
  airlineIata: string | null;
  price: { total: string; currency: string };
  totalCents: number;
  /** Preço final ao cliente com a taxa Froc Rota (só quando a companhia cobra em reais). */
  finalClientCents: number | null;
  platformFeeCents: number | null;
  departureAt: string;
  arrivalAt: string;
  origin: string;
  destination: string;
  stops: number;
  flightNumbers: string[];
  returnDepartureAt: string | null;
  expiresAt: string | null;
}

export function duffelMode(token = process.env.DUFFEL_ACCESS_TOKEN): 'test' | 'live' | null {
  if (!token) return null;
  return token.startsWith('duffel_live_') ? 'live' : 'test';
}

interface DuffelSegment {
  departing_at?: string;
  arriving_at?: string;
  origin?: { iata_code?: string };
  destination?: { iata_code?: string };
  marketing_carrier?: { iata_code?: string };
  marketing_carrier_flight_number?: string;
}
interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  expires_at?: string;
  owner?: { name?: string; iata_code?: string };
  slices?: Array<{ segments?: DuffelSegment[] }>;
}

/** Converte a resposta da Duffel no formato que a tela usa. Pura (testável). */
export function normalizeDuffelOffers(offers: DuffelOffer[]): NormalizedFlightOffer[] {
  return offers
    .map((o) => {
      const out = o.slices?.[0]?.segments ?? [];
      const back = o.slices?.[1]?.segments ?? [];
      const first = out[0];
      const last = out[out.length - 1];
      return {
        id: o.id,
        provider: 'duffel' as const,
        airline: o.owner?.name || 'Companhia aérea',
        airlineIata: o.owner?.iata_code ?? null,
        price: { total: o.total_amount, currency: o.total_currency },
        totalCents: Math.round(Number(o.total_amount) * 100),
        finalClientCents: null,
        platformFeeCents: null,
        departureAt: first?.departing_at ?? '',
        arrivalAt: last?.arriving_at ?? '',
        origin: first?.origin?.iata_code ?? '',
        destination: last?.destination?.iata_code ?? '',
        stops: Math.max(0, out.length - 1),
        flightNumbers: out.map((s) => `${s.marketing_carrier?.iata_code ?? ''}${s.marketing_carrier_flight_number ?? ''}`),
        returnDepartureAt: back[0]?.departing_at ?? null,
        expiresAt: o.expires_at ?? null,
      };
    })
    .filter((o) => o.departureAt && Number.isFinite(o.totalCents) && o.totalCents > 0)
    .sort((a, b) => a.totalCents - b.totalCents);
}

export function isMadrugada(isoLocal: string): boolean {
  const m = isoLocal.match(/T(\d{2}):/);
  const h = m ? Number(m[1]) : 12;
  return h >= 0 && h < 6;
}

/** Busca ofertas na Duffel (cria um "offer request" e recebe as ofertas na mesma chamada). */
export async function searchDuffelOffers(params: {
  originIata: string;
  destinationIata: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
}): Promise<NormalizedFlightOffer[]> {
  const token = process.env.DUFFEL_ACCESS_TOKEN;
  if (!token) return [];
  const slices = [
    { origin: params.originIata, destination: params.destinationIata, departure_date: params.departureDate },
  ];
  if (params.returnDate) {
    slices.push({ origin: params.destinationIata, destination: params.originIata, departure_date: params.returnDate });
  }
  const res = await fetch(`${DUFFEL_API}/air/offer_requests?return_offers=true&supplier_timeout=20000`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Duffel-Version': 'v2',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      data: {
        slices,
        passengers: Array.from({ length: Math.max(1, Math.min(9, params.adults)) }, () => ({ type: 'adult' })),
        cabin_class: 'economy',
      },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Duffel search error: ${res.status} ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: { offers?: DuffelOffer[] } };
  return normalizeDuffelOffers(json.data?.offers ?? []).slice(0, 20);
}
