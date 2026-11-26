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
  /** Tarifa da companhia convertida para reais (câmbio PTAX do Banco Central quando vem em outra moeda). */
  supplierBrlCents: number | null;
  fxRate: number | null;
  fxDate: string | null;
  /** Preço final ao cliente em reais, com a taxa Froc Rota. */
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
  /** Detalhe de cada trecho (ida e, se houver, volta): voos, escalas, tempo de espera e troca de avião. */
  slices: FlightSlice[];
  /** Duração total em minutos (ida + volta), para ordenar por "mais rápido". */
  totalDurationMin: number;
}

export interface FlightSegmentInfo {
  origin: string;
  originName: string;
  originCity: string;
  destination: string;
  destinationName: string;
  destinationCity: string;
  departureAt: string;
  arrivalAt: string;
  durationMin: number;
  carrier: string;
  carrierIata: string;
  flightNumber: string;
  operatedBy: string | null;
  aircraft: string | null;
  /** Paradas técnicas dentro do mesmo voo (o avião pousa, mas o passageiro não troca de voo). */
  technicalStops: Array<{ airport: string; city: string; durationMin: number }>;
}

export interface FlightLayover {
  airport: string;
  airportName: string;
  city: string;
  durationMin: number;
  /** Troca de avião (voo diferente) ou o mesmo avião segue viagem. */
  changeAircraft: boolean;
  /** Chega num aeroporto e sai de outro (ex.: Galeão → Santos Dumont): precisa se deslocar. */
  changeAirport: boolean;
  nextAirport: string;
  /** Espera passa da meia-noite. */
  overnight: boolean;
}

export interface FlightSlice {
  origin: string;
  originCity: string;
  destination: string;
  destinationCity: string;
  departureAt: string;
  arrivalAt: string;
  durationMin: number;
  stops: number;
  segments: FlightSegmentInfo[];
  layovers: FlightLayover[];
}

export function duffelMode(token = process.env.DUFFEL_ACCESS_TOKEN): 'test' | 'live' | null {
  if (!token) return null;
  return token.startsWith('duffel_live_') ? 'live' : 'test';
}

interface DuffelPlace {
  iata_code?: string;
  name?: string;
  city_name?: string;
  city?: { name?: string } | null;
}
interface DuffelSegment {
  departing_at?: string;
  arriving_at?: string;
  duration?: string | null;
  origin?: DuffelPlace;
  destination?: DuffelPlace;
  marketing_carrier?: { iata_code?: string; name?: string };
  marketing_carrier_flight_number?: string;
  operating_carrier?: { iata_code?: string; name?: string } | null;
  operating_carrier_flight_number?: string | null;
  aircraft?: { name?: string } | null;
  stops?: Array<{ airport?: DuffelPlace; duration?: string | null }>;
}
interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  expires_at?: string;
  owner?: { name?: string; iata_code?: string };
  slices?: Array<{ duration?: string | null; segments?: DuffelSegment[] }>;
}

/** "PT2H35M" / "P1DT1H" → minutos. */
export function isoDurationMin(d: string | null | undefined): number | null {
  if (!d) return null;
  const m = String(d).match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/);
  if (!m) return null;
  return Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

/** Diferença em minutos entre dois horários locais do MESMO aeroporto (a Duffel manda hora local sem fuso). */
function minutesBetweenLocal(a: string, b: string): number {
  const ta = Date.parse(`${a.slice(0, 19)}Z`);
  const tb = Date.parse(`${b.slice(0, 19)}Z`);
  return Number.isFinite(ta) && Number.isFinite(tb) ? Math.max(0, Math.round((tb - ta) / 60000)) : 0;
}

const cidadeDe = (p?: DuffelPlace) => p?.city_name || p?.city?.name || p?.name || p?.iata_code || '';

function sliceInfo(slice: { duration?: string | null; segments?: DuffelSegment[] }): FlightSlice | null {
  const segs = slice.segments ?? [];
  if (!segs.length) return null;
  const segments: FlightSegmentInfo[] = segs.map((s) => ({
    origin: s.origin?.iata_code ?? '',
    originName: s.origin?.name ?? '',
    originCity: cidadeDe(s.origin),
    destination: s.destination?.iata_code ?? '',
    destinationName: s.destination?.name ?? '',
    destinationCity: cidadeDe(s.destination),
    departureAt: s.departing_at ?? '',
    arrivalAt: s.arriving_at ?? '',
    durationMin: isoDurationMin(s.duration) ?? 0,
    carrier: s.marketing_carrier?.name ?? '',
    carrierIata: s.marketing_carrier?.iata_code ?? '',
    flightNumber: `${s.marketing_carrier?.iata_code ?? ''}${s.marketing_carrier_flight_number ?? ''}`,
    operatedBy:
      s.operating_carrier?.name && s.operating_carrier.name !== s.marketing_carrier?.name ? s.operating_carrier.name : null,
    aircraft: s.aircraft?.name ?? null,
    technicalStops: (s.stops ?? []).map((t) => ({
      airport: t.airport?.iata_code ?? '',
      city: cidadeDe(t.airport),
      durationMin: isoDurationMin(t.duration) ?? 0,
    })),
  }));
  const layovers: FlightLayover[] = [];
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i];
    const b = segs[i + 1];
    const sameFlight =
      Boolean(a.marketing_carrier_flight_number) &&
      a.marketing_carrier?.iata_code === b.marketing_carrier?.iata_code &&
      a.marketing_carrier_flight_number === b.marketing_carrier_flight_number;
    layovers.push({
      airport: a.destination?.iata_code ?? '',
      airportName: a.destination?.name ?? '',
      city: cidadeDe(a.destination),
      durationMin: minutesBetweenLocal(a.arriving_at ?? '', b.departing_at ?? ''),
      changeAircraft: !sameFlight,
      changeAirport: (a.destination?.iata_code ?? '') !== (b.origin?.iata_code ?? ''),
      nextAirport: b.origin?.iata_code ?? '',
      overnight: (a.arriving_at ?? '').slice(0, 10) !== (b.departing_at ?? '').slice(0, 10),
    });
  }
  const first = segments[0];
  const last = segments[segments.length - 1];
  const soma = segments.reduce((t, x) => t + x.durationMin, 0) + layovers.reduce((t, x) => t + x.durationMin, 0);
  return {
    origin: first.origin,
    originCity: first.originCity,
    destination: last.destination,
    destinationCity: last.destinationCity,
    departureAt: first.departureAt,
    arrivalAt: last.arrivalAt,
    durationMin: isoDurationMin(slice.duration) ?? soma,
    stops: layovers.length + segments.reduce((t, x) => t + x.technicalStops.length, 0),
    segments,
    layovers,
  };
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
        supplierBrlCents: null,
        fxRate: null,
        fxDate: null,
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
        slices: (o.slices ?? []).map(sliceInfo).filter((x): x is FlightSlice => Boolean(x)),
        totalDurationMin: 0,
      };
    })
    .map((o) => ({
      ...o,
      stops: o.slices[0]?.stops ?? o.stops,
      totalDurationMin: o.slices.reduce((t, sl) => t + sl.durationMin, 0),
    }))
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
