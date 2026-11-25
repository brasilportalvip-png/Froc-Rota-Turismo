import { adminDb } from './_lib/firebase-admin.js';
import { askFrocRotaAI } from './_lib/ai.js';
import { optionalAuthenticateRequest } from './_lib/auth.js';
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
import { getPaymentGatewayStatus } from './_lib/payment.js';
import { computePriceFromRule, resolvePricingRule } from './_lib/pricing.js';
import { ensureSeeded } from './_lib/seed.js';
import { getTravelIntegrationsStatus, searchLiveFlightsIfConfigured } from './_lib/travel.js';

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
  const query = getQuery(req);

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

      sendJson(res, 200, { destinations: rows });
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
      const [listingsSnap, reviewsSnap, users] = await Promise.all([
        adminDb
          .collection('listings')
          .where('destinationId', '==', destination.id)
          .where('status', '==', 'active')
          .get(),
        adminDb.collection('reviews').where('destinationId', '==', destination.id).get(),
        getAllDocs<UserDoc>('users'),
      ]);

      const userMap = new Map(users.map((u) => [u.id, u.name]));
      const destListings = listingsSnap.docs
        .map((d) => d.data() as ListingDoc)
        .sort((a, b) => {
          if (Boolean(b.isFeatured) !== Boolean(a.isFeatured)) {
            return Number(Boolean(b.isFeatured)) - Number(Boolean(a.isFeatured));
          }
          return Number(b.ratingAvg || 0) - Number(a.ratingAvg || 0);
        });

      const destReviews = reviewsSnap.docs
        .map((d) => d.data() as ReviewDoc)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          merchantReply: r.merchantReply ?? null,
          createdAt: r.createdAt,
          authorName: userMap.get(r.userId) || 'Turista Froc Rota',
        }));

      sendJson(res, 200, { destination, listings: destListings, reviews: destReviews });
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

      sendJson(res, 200, { listings: items });
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
      const [destSnap, merchantSnap, slotsSnap, reviewsSnap, users] = await Promise.all([
        adminDb.collection('destinations').doc(String(listing.destinationId)).get(),
        adminDb.collection('merchants').doc(String(listing.merchantId)).get(),
        adminDb.collection('availability_slots').where('listingId', '==', listing.id).get(),
        adminDb.collection('reviews').where('listingId', '==', listing.id).get(),
        getAllDocs<UserDoc>('users'),
      ]);

      const dest = destSnap.exists ? (destSnap.data() as DestDoc) : null;
      const merchant = merchantSnap.exists ? (merchantSnap.data() as MerchantDoc) : null;
      const userMap = new Map(users.map((u) => [u.id, u.name]));

      const slots = slotsSnap.docs
        .map((d) => d.data() as { date: string })
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));

      const itemReviews = reviewsSnap.docs
        .map((d) => d.data() as ReviewDoc)
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
        sendJson(res, 200, { post: snap.empty ? null : snap.docs[0].data() });
        return;
      }

      const snap = await adminDb.collection('posts').where('status', '==', 'published').get();
      const posts = snap.docs
        .map((d) => d.data() as PostDoc)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 25);
      sendJson(res, 200, { posts });
    } catch (error) {
      console.error('GET /api/posts error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar publicações diárias.' });
    }
    return;
  }

  // POST /api/coupons/validate
  if (req.method === 'POST' && route === '/coupons/validate') {
    if (!checkRateLimit(req, res, 'coupons:validate', 25, 60000)) return;
    try {
      const body = await parseJsonBody<{ code?: string }>(req);
      const code = String(body.code ?? '').trim().toUpperCase();
      if (!code) {
        sendJson(res, 400, { error: 'Código de cupom obrigatório.' });
        return;
      }
      const couponSnap = await adminDb.collection('coupons').doc(code).get();
      if (!couponSnap.exists) {
        sendJson(res, 404, { error: 'Cupom inválido ou esgotado.' });
        return;
      }
      const coupon = couponSnap.data() as {
        active: boolean;
        usedCount: number;
        maxUses: number;
      };
      if (!coupon.active || coupon.usedCount >= coupon.maxUses) {
        sendJson(res, 404, { error: 'Cupom inválido ou esgotado.' });
        return;
      }
      sendJson(res, 200, { valid: true, coupon });
    } catch (error) {
      console.error('POST /api/coupons/validate error:', error);
      sendJson(res, 500, { error: 'Erro ao validar cupom.' });
    }
    return;
  }

  // POST /api/pricing/preview
  if (req.method === 'POST' && route === '/pricing/preview') {
    if (!checkRateLimit(req, res, 'pricing:preview', 40, 60000)) return;
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
    sendJson(res, 200, {
      integrations: getTravelIntegrationsStatus(),
      payments: getPaymentGatewayStatus(),
    });
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
      sendJson(res, 200, result);
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
