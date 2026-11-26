import { DESTINOS_BRASIL, detectDestinos } from './_lib/brasil-destinos.js';
import { fotoDoDestino, fotosDoCarrossel, fotosDosDestinos, TODOS_OS_SLUGS, trocarPorFotosReais } from './_lib/fotos.js';
import { adminDb } from './_lib/firebase-admin.js';
import { buildIntentSuggestion } from './_lib/intent.js';
import { askFrocRotaAI } from './_lib/ai.js';
import { optionalAuthenticateRequest, requireAdminContext } from './_lib/auth.js';
import { getAllDocs, nextSeqId } from './_lib/firestore-helpers.js';
import { GeminiResilienceError } from './_lib/gemini-resilience.js';
import {
  ApiRequest,
  ApiResponse,
  checkRateLimit,
  enforceApiSecurity,
  getQuery,
  getRoutePath,
  parseJsonBody,
  sendJson,
} from './_lib/http.js';
import { computePriceFromRule, resolvePricingRule } from './_lib/pricing.js';
import { ensureSeeded } from './_lib/seed.js';
import { getTravelIntegrationsStatus, precosDosDiasVizinhos, publicFlightResult, searchLiveFlightsIfConfigured } from './_lib/travel.js';
import { semaforoPrecos } from './_lib/aeroportos.js';
import { lanceComissaoBps, ordemDoLeilao } from './_lib/leilao.js';

interface DestDoc extends Record<string, unknown> {
  id: number;
  slug: string;
  name: string;
  state: string;
  region: string;
  category: string;
  summary: string;
  featured: boolean;
  ratingAvg: number;
}

interface ListingDoc extends Record<string, unknown> {
  id: number;
  merchantId: number;
  destinationId: number;
  moduleType: string;
  subtype: string;
  title: string;
  slug: string;
  summary: string;
  address: string;
  priceCents: number;
  capacity: number;
  amenitiesJson?: string[];
  isFeatured: boolean;
  isSponsored: boolean;
  ratingAvg: number;
  status: string;
}

interface MerchantDoc extends Record<string, unknown> {
  id: number;
  userUid?: string;
  commissionBidBps?: number;
  tradeName: string;
  verificationStatus: string;
  cadasturNumber?: string | null;
  city: string;
  state: string;
  bio: string;
}

interface UserDoc extends Record<string, unknown> {
  id: number;
  name: string;
}

interface ReviewDoc extends Record<string, unknown> {
  id: number;
  userId: number;
  destinationId?: number | null;
  listingId?: number | null;
  rating: number;
  comment: string;
  merchantReply?: string | null;
  createdAt: string;
}

interface PostDoc extends Record<string, unknown> {
  id: number;
  slug: string;
  status: string;
  createdAt: string;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!enforceApiSecurity(req, res)) return;
  try {
    await ensureSeeded();
  } catch (err) {
    console.error('Seed error:', err);
    sendJson(res, 503, { error: 'Serviço temporariamente indisponível ao inicializar dados.' });
    return;
  }

  const route = getRoutePath(req);
  if (!checkRateLimit(req, res, 'catalog:api', 240, 60000)) return;
  const query = getQuery(req);

  // POST /api/intent/suggest — oportunidade personalizada para o destino em que a pessoa está interessada
  if (req.method === 'POST' && route === '/intent/suggest') {
    if (!checkRateLimit(req, res, 'intent:suggest', 20, 3600000)) return;
    try {
      const body = await parseJsonBody<{ slug?: string; localHour?: number; firstName?: string }>(req);
      const auth = await optionalAuthenticateRequest(req);
      const name = String(auth?.dbUser?.name || body.firstName || '').trim().split(/\s+/)[0] || '';
      const suggestion = await buildIntentSuggestion({
        slug: String(body.slug || ''),
        firstName: name.includes('@') ? '' : name,
        localHour: Number(body.localHour),
      });
      if (!suggestion) {
        sendJson(res, 404, { error: 'Destino não encontrado.' });
        return;
      }
      sendJson(res, 200, suggestion);
    } catch (error) {
      console.error('POST /api/intent/suggest error:', error);
      sendJson(res, 500, { error: 'Erro ao montar a sugestão.' });
    }
    return;
  }

  // GET /api/brasil/destinos — Vitrine do Brasil (destinos reais + quantas ofertas cada um tem)
  if (req.method === 'GET' && route === '/brasil/destinos') {
    try {
      const [dests, listings] = await Promise.all([
        getAllDocs<DestDoc>('destinations'),
        adminDb.collection('listings').where('status', '==', 'active').get(),
      ]);
      const counts = new Map<number, number>();
      for (const d of listings.docs) {
        const id = Number(d.data().destinationId);
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      const destinos = DESTINOS_BRASIL.map((d) => {
        const seeded = dests.find(
          (x) => x.slug === d.slug || String(x.name || '').toLowerCase().startsWith(d.nome.toLowerCase())
        );
        return { ...d, appSlug: seeded?.slug ?? null, ofertas: seeded ? counts.get(Number(seeded.id)) || 0 : 0 };
      });
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
      sendJson(res, 200, { destinos });
    } catch (error) {
      console.error('GET /api/brasil/destinos error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar a vitrine.' });
    }
    return;
  }

  // GET /api/destinations
  if (req.method === 'GET' && route === '/destinations') {
    try {
      const { q, category, region } = query;
      let rows = await getAllDocs<DestDoc>('destinations');

      if (category && category !== 'all') {
        rows = rows.filter((d) => d.category === category);
      }
      if (region && region !== 'all') {
        rows = rows.filter((d) => d.region === region);
      }
      if (q && q.trim()) {
        const term = q.trim().toLowerCase();
        rows = rows.filter(
          (d) =>
            String(d.name || '').toLowerCase().includes(term) ||
            String(d.state || '').toLowerCase().includes(term) ||
            String(d.summary || '').toLowerCase().includes(term)
        );
      }

      rows.sort((a, b) => {
        if (Boolean(b.featured) !== Boolean(a.featured)) {
          return Number(Boolean(b.featured)) - Number(Boolean(a.featured));
        }
        return Number(b.ratingAvg || 0) - Number(a.ratingAvg || 0);
      });

      sendJson(res, 200, { destinations: await trocarPorFotosReais(rows, (d) => String(d.slug || '')) });
    } catch (error) {
      console.error('GET /api/destinations error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar destinos.' });
    }
    return;
  }

  // GET /api/destinations/:slug
  const destSlugMatch = route.match(/^\/destinations\/([^/]+)$/);
  if (req.method === 'GET' && destSlugMatch) {
    try {
      const slug = decodeURIComponent(destSlugMatch[1]);
      const destSnap = await adminDb
        .collection('destinations')
        .where('slug', '==', slug)
        .limit(1)
        .get();

      if (destSnap.empty) {
        sendJson(res, 404, { error: 'Destino não encontrado.' });
        return;
      }

      const destination = destSnap.docs[0].data() as DestDoc;
      const [listingsSnap, reviewsSnap] = await Promise.all([
        adminDb
          .collection('listings')
          .where('destinationId', '==', destination.id)
          .where('status', '==', 'active')
          .get(),
        adminDb.collection('reviews').where('destinationId', '==', destination.id).get(),
      ]);
      const userMap = await nomesDosAutores(reviewsSnap.docs.map((d) => Number((d.data() as ReviewDoc).userId)));
      const brutos = listingsSnap.docs.map((d) => d.data() as ListingDoc);
      const mIds = [...new Set(brutos.map((l) => l.merchantId))];
      const lances = new Map<number, number>();
      if (mIds.length) {
        const ms = await adminDb.getAll(...mIds.map((id) => adminDb.collection('merchants').doc(String(id))));
        for (const m of ms) if (m.exists) lances.set(Number(m.id), lanceComissaoBps((m.data() as { commissionBidBps?: number }).commissionBidBps));
      }
      const destListings = brutos.sort((a, b) =>
        ordemDoLeilao(
          { ...a, bidBps: lances.get(a.merchantId) ?? 0 },
          { ...b, bidBps: lances.get(b.merchantId) ?? 0 }
        )
      );

      const destReviews = reviewsSnap.docs
        .map((d) => d.data() as ReviewDoc & { hidden?: boolean })
        .filter((r) => r.hidden !== true) // ocultadas pela moderação da IA
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          merchantReply: r.merchantReply ?? null,
          createdAt: r.createdAt,
          authorName: userMap.get(r.userId) || 'Turista Froc Rota',
        }));

      const [destComFoto] = await trocarPorFotosReais([destination], (d) => String(d.slug || ''));
      const listingsComFoto = await trocarPorFotosReais(destListings, () => String(destination.slug || ''));
      sendJson(res, 200, { destination: destComFoto, listings: listingsComFoto, reviews: destReviews });
    } catch (error) {
      console.error('GET /api/destinations/:slug error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar detalhes do destino.' });
    }
    return;
  }

  // GET /api/listings
  if (req.method === 'GET' && route === '/listings') {
    try {
      const { moduleType, destinationId, subtype, maxPriceCents, minGuests, q, amenity } = query;
      const [allListings, allDests, allMerchants] = await Promise.all([
        getAllDocs<ListingDoc>('listings'),
        getAllDocs<DestDoc>('destinations'),
        getAllDocs<MerchantDoc>('merchants'),
      ]);

      const destMap = new Map(allDests.map((d) => [d.id, d]));
      const merchMap = new Map(allMerchants.map((m) => [m.id, m]));

      let items = allListings
        .filter((l) => l.status === 'active')
        // Só parceiros reais (com conta no site); exemplos de catálogo nunca aparecem para venda.
        .filter((l) => Boolean(merchMap.get(l.merchantId)?.userUid))
        .filter((l) => (!moduleType || moduleType === 'all' ? true : l.moduleType === moduleType))
        .filter((l) =>
          destinationId && !Number.isNaN(Number(destinationId))
            ? l.destinationId === Number(destinationId)
            : true
        )
        .filter((l) => (!subtype || subtype === 'all' ? true : l.subtype === subtype))
        .filter((l) =>
          maxPriceCents && Number(maxPriceCents) > 0
            ? l.priceCents <= Number(maxPriceCents)
            : true
        )
        .filter((l) => {
          if (!q || !q.trim()) return true;
          const term = q.trim().toLowerCase();
          return (
            String(l.title || '').toLowerCase().includes(term) ||
            String(l.summary || '').toLowerCase().includes(term) ||
            String(l.address || '').toLowerCase().includes(term)
          );
        })
        .filter((l) =>
          minGuests && Number(minGuests) > 1 ? l.capacity >= Number(minGuests) : true
        )
        .filter((l) => {
          if (!amenity || !amenity.trim()) return true;
          const target = amenity.trim().toLowerCase();
          return (
            Array.isArray(l.amenitiesJson) &&
            l.amenitiesJson.some((a) => String(a).toLowerCase().includes(target))
          );
        })
        .sort((a, b) => {
          if (Boolean(b.isSponsored) !== Boolean(a.isSponsored)) {
            return Number(Boolean(b.isSponsored)) - Number(Boolean(a.isSponsored));
          }
          if (Boolean(b.isFeatured) !== Boolean(a.isFeatured)) {
            return Number(Boolean(b.isFeatured)) - Number(Boolean(a.isFeatured));
          }
          // Leilão de comissão: quem oferece mais aparece primeiro
          const lb = lanceComissaoBps(merchMap.get(b.merchantId)?.commissionBidBps);
          const la = lanceComissaoBps(merchMap.get(a.merchantId)?.commissionBidBps);
          if (lb !== la) return lb - la;
          return Number(b.ratingAvg || 0) - Number(a.ratingAvg || 0);
        })
        .map((l) => {
          const d = destMap.get(l.destinationId);
          const m = merchMap.get(l.merchantId);
          return {
            ...l,
            destinationName: d?.name,
            destinationState: d?.state,
            destinationSlug: d?.slug,
            merchantTradeName: m?.tradeName,
            merchantVerified: m?.verificationStatus === 'verified',
          };
        });

      sendJson(res, 200, { listings: await trocarPorFotosReais(items, (l) => (l.destinationSlug ? String(l.destinationSlug) : null)) });
    } catch (error) {
      console.error('GET /api/listings error:', error);
      sendJson(res, 500, { error: 'Erro ao consultar catálogo.' });
    }
    return;
  }

  // GET /api/listings/:slug
  const listingSlugMatch = route.match(/^\/listings\/([^/]+)$/);
  if (req.method === 'GET' && listingSlugMatch) {
    try {
      const slug = decodeURIComponent(listingSlugMatch[1]);
      const listingSnap = await adminDb
        .collection('listings')
        .where('slug', '==', slug)
        .limit(1)
        .get();

      if (listingSnap.empty) {
        sendJson(res, 404, { error: 'Oferta não encontrada.' });
        return;
      }

      const listing = listingSnap.docs[0].data() as ListingDoc;
      if (listing.status !== 'active') {
        sendJson(res, 404, { error: 'Oferta indisponível no momento.' });
        return;
      }
      const [destSnap, merchantSnap, slotsSnap, reviewsSnap] = await Promise.all([
        adminDb.collection('destinations').doc(String(listing.destinationId)).get(),
        adminDb.collection('merchants').doc(String(listing.merchantId)).get(),
        adminDb.collection('availability_slots').where('listingId', '==', listing.id).get(),
        adminDb.collection('reviews').where('listingId', '==', listing.id).get(),
      ]);

      const dest = destSnap.exists ? (destSnap.data() as DestDoc) : null;
      const merchant = merchantSnap.exists ? (merchantSnap.data() as MerchantDoc) : null;
      const userMap = await nomesDosAutores(reviewsSnap.docs.map((d) => Number((d.data() as ReviewDoc).userId)));

      // Só horários futuros e com vaga (o cliente não escolhe data que já passou ou esgotada).
      const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
      const slots = slotsSnap.docs
        .map((d) => d.data() as { date: string; availableSpots?: number })
        .filter((x) => String(x.date) >= hoje && Number(x.availableSpots ?? 0) > 0)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));

      const itemReviews = reviewsSnap.docs
        .map((d) => d.data() as ReviewDoc & { hidden?: boolean })
        .filter((r) => r.hidden !== true) // ocultadas pela moderação da IA
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          merchantReply: r.merchantReply ?? null,
          createdAt: r.createdAt,
          authorName: userMap.get(r.userId) || 'Turista Froc Rota',
        }));

      sendJson(res, 200, {
        listing,
        destination: dest,
        merchant: merchant
          ? {
              id: merchant.id,
              tradeName: merchant.tradeName,
              verificationStatus: merchant.verificationStatus,
              cadasturNumber: merchant.cadasturNumber ?? null,
              city: merchant.city,
              state: merchant.state,
              bio: merchant.bio,
            }
          : null,
        slots,
        reviews: itemReviews,
      });
    } catch (error) {
      console.error('GET /api/listings/:slug error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar oferta.' });
    }
    return;
  }

  // FOTOS REAIS (Wikimedia Commons) — carrossel do topo, vitrine e redirecionamento para <img>
  if (req.method === 'GET' && route === '/fotos/carrossel') {
    try {
      const fotos = await fotosDoCarrossel();
      sendJson(res, 200, fotos, 'public, s-maxage=86400, stale-while-revalidate=604800');
    } catch (error) {
      console.error('GET /api/fotos/carrossel error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar as fotos.' });
    }
    return;
  }

  if (req.method === 'GET' && route === '/fotos/destinos') {
    try {
      const pedidos = String(query.slugs || '')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => TODOS_OS_SLUGS.includes(x))
        .slice(0, 100);
      const fotos = await fotosDosDestinos(pedidos.length ? pedidos : TODOS_OS_SLUGS);
      sendJson(res, 200, { fotos }, 'public, s-maxage=86400, stale-while-revalidate=604800');
    } catch (error) {
      console.error('GET /api/fotos/destinos error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar as fotos.' });
    }
    return;
  }

  if (req.method === 'GET' && route === '/foto') {
    if (!checkRateLimit(req, res, 'catalog:foto', 60, 60000)) return;
    const pedido = String(query.d || '').toLowerCase();
    const slug = /^[a-z0-9-]{2,60}$/.test(pedido) ? pedido : '';
    const w = String(query.w || '1280');
    const foto = slug ? await fotoDoDestino(slug).catch(() => null) : null;
    res.statusCode = foto ? 302 : 404;
    if (foto) {
      res.setHeader('Location', w === '500' ? foto.url500 : foto.url1280);
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
      res.end();
    } else {
      sendJson(res, 404, { error: 'Foto não encontrada.' });
    }
    return;
  }

  // GET /api/posts
  if (req.method === 'GET' && route === '/posts') {
    try {
      const slug = query.slug ? String(query.slug).trim() : null;
      if (slug) {
        const snap = await adminDb
          .collection('posts')
          .where('slug', '==', slug)
          .where('status', '==', 'published')
          .limit(1)
          .get();
        const one = snap.empty ? null : (snap.docs[0].data() as PostDoc);
        sendJson(res, 200, { post: one ? (await trocarPorFotosReais([one], slugDoPost))[0] : null });
        return;
      }

      const snap = await adminDb.collection('posts').where('status', '==', 'published').get();
      const posts = snap.docs
        .map((d) => d.data() as PostDoc)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 25);
      sendJson(res, 200, { posts: await trocarPorFotosReais(posts, slugDoPost) });
    } catch (error) {
      console.error('GET /api/posts error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar publicações diárias.' });
    }
    return;
  }

  // POST /api/pricing/preview
  // Regras de preço/markup são confidenciais: só a equipe (painel Admin) consulta.
  if (req.method === 'POST' && route === '/pricing/preview') {
    if (!checkRateLimit(req, res, 'pricing:preview', 40, 60000)) return;
    const staff = await requireAdminContext(req, res, 'finance');
    if (!staff) return;
    try {
      const body = await parseJsonBody<{
        category?: string;
        supplierCostCents?: number;
        discountPercent?: number;
        merchantId?: number;
        planSlug?: string;
      }>(req);

      const category = String(body.category || 'flights');
      const cost = Math.max(0, Math.round(Number(body.supplierCostCents) || 0));
      const rule = await resolvePricingRule({
        category,
        merchantId: body.merchantId ? Number(body.merchantId) : null,
        planSlug: body.planSlug ? String(body.planSlug) : null,
        costCents: cost,
      });
      const breakdown = computePriceFromRule({
        supplierCostCents: cost,
        discountPercent: Number(body.discountPercent) || 0,
        rule,
      });
      sendJson(res, 200, { breakdown, rule });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Erro no cálculo financeiro.';
      sendJson(res, 400, { error: msg });
    }
    return;
  }

  // GET /api/travel/status
  if (req.method === 'GET' && route === '/travel/status') {
    // Público vê só se a busca de voos está disponível; detalhes das integrações ficam no Admin.
    const flights = getTravelIntegrationsStatus().some(
      (i) => i.configured && /duffel|amadeus/i.test(i.provider)
    );
    sendJson(res, 200, { flightSearchAvailable: flights });
    return;
  }

  // POST /api/travel/calendar — semáforo de preços (verde/laranja/vermelho) nos dias perto da data escolhida
  if (req.method === 'POST' && route === '/travel/calendar') {
    if (!checkRateLimit(req, res, 'travel:calendar', 10, 60000)) return;
    try {
      const body = await parseJsonBody<{ originIata?: string; destinationIata?: string; departureDate?: string; returnDate?: string; adults?: number }>(req);
      const o = String(body.originIata || '').toUpperCase();
      const d = String(body.destinationIata || '').toUpperCase();
      const dep = String(body.departureDate || '');
      const ret = body.returnDate ? String(body.returnDate) : undefined;
      if (!/^[A-Z]{3}$/.test(o) || !/^[A-Z]{3}$/.test(d) || !/^\d{4}-\d{2}-\d{2}$/.test(dep) || (ret && !/^\d{4}-\d{2}-\d{2}$/.test(ret))) {
        sendJson(res, 400, { error: 'Informe origem, destino e data.' });
        return;
      }
      const r = await precosDosDiasVizinhos({ originIata: o, destinationIata: d, departureDate: dep, returnDate: ret, adults: Math.max(1, Math.min(9, Number(body.adults) || 1)) });
      sendJson(res, 200, { available: r.available, dias: semaforoPrecos(r.dias) });
    } catch (error) {
      console.error('POST /api/travel/calendar error:', error);
      sendJson(res, 502, { error: 'Não foi possível comparar os preços agora.' });
    }
    return;
  }

  // POST /api/travel/search
  if (req.method === 'POST' && route === '/travel/search') {
    if (!checkRateLimit(req, res, 'travel:search', 20, 60000)) return;
    try {
      const body = await parseJsonBody<{
        originIata?: string;
        destinationIata?: string;
        departureDate?: string;
        returnDate?: string;
        tripType?: string;
        adults?: number;
        maxPriceBrl?: number;
        madrugadaOnly?: boolean;
      }>(req);

      const {
        originIata,
        destinationIata,
        departureDate,
        returnDate,
        tripType = 'one_way',
        adults = 1,
        maxPriceBrl,
        madrugadaOnly = false,
      } = body;

      if (!originIata || !destinationIata || !departureDate) {
        sendJson(res, 400, { error: 'Informe código IATA de origem, destino e data.' });
        return;
      }

      const validTripType: 'one_way' | 'round_trip' | 'multi_city' =
        tripType === 'round_trip' || tripType === 'multi_city' ? tripType : 'one_way';

      const result = await searchLiveFlightsIfConfigured({
        originIata: String(originIata),
        destinationIata: String(destinationIata),
        departureDate: String(departureDate),
        returnDate: returnDate ? String(returnDate) : undefined,
        tripType: validTripType,
        adults: Number(adults) || 1,
        maxPriceBrl: maxPriceBrl ? Number(maxPriceBrl) : undefined,
        madrugadaOnly: Boolean(madrugadaOnly),
      });
      sendJson(res, 200, publicFlightResult(result));
    } catch (error) {
      console.error('POST /api/travel/search error:', error);
      sendJson(res, 502, { error: 'Erro ao consultar provedor de passagens aéreas.' });
    }
    return;
  }

  // POST /api/ai/chat
  if (req.method === 'POST' && route === '/ai/chat') {
    if (!checkRateLimit(req, res, 'ai:chat', 15, 60000)) return;
    try {
      const auth = await optionalAuthenticateRequest(req);
      const body = await parseJsonBody<{
        query?: string;
        language?: string;
        budgetBrl?: number;
        travelers?: number;
        locationContext?: string;
        saveItinerary?: boolean;
      }>(req);

      const { query: aiQuery, language = 'pt', budgetBrl, travelers, locationContext, saveItinerary } =
        body;
      if (!aiQuery || typeof aiQuery !== 'string' || !aiQuery.trim()) {
        sendJson(res, 400, { error: 'Digite sua pergunta para a Froc Rota AI.' });
        return;
      }

      const lang: 'pt' | 'en' | 'es' =
        language === 'en' || language === 'es' ? language : 'pt';
      const result = await askFrocRotaAI({
        query: aiQuery.trim().slice(0, 1000),
        language: lang,
        budgetBrl: budgetBrl ? Number(budgetBrl) : undefined,
        travelers: travelers ? Number(travelers) : undefined,
        locationContext: typeof locationContext === 'string' ? locationContext : undefined,
      });

      if (saveItinerary && auth?.dbUser && result.suggestedItinerary.length > 0) {
        const id = await nextSeqId('saved_itineraries');
        await adminDb
          .collection('saved_itineraries')
          .doc(String(id))
          .set({
            id,
            userId: auth.dbUser.id,
            userUid: auth.dbUser.uid,
            title: aiQuery.trim().slice(0, 90),
            destinationSlug: result.recommendedDestinations[0]?.slug ?? null,
            budgetCents: budgetBrl ? Math.round(Number(budgetBrl) * 100) : 0,
            daysCount: result.suggestedItinerary.length,
            contentJson: result as unknown as Record<string, unknown>,
            createdAt: new Date().toISOString(),
          });
      }

      sendJson(res, 200, result);
    } catch (error: unknown) {
      console.error('POST /api/ai/chat error:', error);
      if (error instanceof GeminiResilienceError) {
        sendJson(res, error.httpStatus, { error: error.message, code: error.code });
        return;
      }
      const rawMsg = error instanceof Error ? error.message : '';
      if (rawMsg === 'PROMPT_POLICY_VIOLATION') {
        sendJson(res, 400, {
          error: 'Consulta bloqueada pela política de segurança da plataforma.',
        });
        return;
      }
      if (rawMsg === 'PROMPT_EMPTY') {
        sendJson(res, 400, { error: 'Digite sua pergunta para a Froc Rota AI.' });
        return;
      }
      sendJson(res, 500, { error: 'Erro ao consultar Froc Rota AI.' });
    }
    return;
  }

  sendJson(res, 404, { error: 'Rota de catálogo não encontrada.' });
}

/** Destino de um post (o jornal grava; posts antigos: descobre pelo título). */
function slugDoPost(p: Record<string, unknown>): string | null {
  if (p.destinationSlug) return String(p.destinationSlug);
  return detectDestinos(`${p.title || ''} ${p.summary || ''}`, 1)[0]?.destino.slug ?? null;
}

/** Nome de quem escreveu cada avaliação (lê só esses usuários, nunca a coleção inteira). */
async function nomesDosAutores(ids: number[]): Promise<Map<number, string>> {
  const unicos = [...new Set(ids.filter((x) => Number.isFinite(x) && x > 0))];
  const out = new Map<number, string>();
  for (let i = 0; i < unicos.length; i += 10) {
    const snap = await adminDb.collection('users').where('id', 'in', unicos.slice(i, i + 10)).get();
    for (const d of snap.docs) {
      const u = d.data() as { id: number; name?: string };
      out.set(Number(u.id), String(u.name || '').split(' ')[0] || 'Turista');
    }
  }
  return out;
}
