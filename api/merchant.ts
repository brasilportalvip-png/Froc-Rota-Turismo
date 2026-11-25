import crypto from 'node:crypto';
import { Type } from '@google/genai';
import { adminDb } from './_lib/firebase-admin.ts';
import { dispatchAgentTask } from './_lib/agents.ts';
import { recordAuditLog } from './_lib/audit.ts';
import { authenticateRequest } from './_lib/auth.ts';
import { getAllDocs, nextSeqId } from './_lib/firestore-helpers.ts';
import { generateResilientJson, resolveGeminiKeySlots } from './_lib/gemini-resilience.ts';
import {
  ApiRequest,
  ApiResponse,
  checkRateLimit,
  enforceApiSecurity,
  getQuery,
  getRoutePath,
  parseJsonBody,
  sanitizeAssetOrSafeHttpUrl,
  sendHtml,
  sendJson,
} from './_lib/http.ts';
import {
  buildGoogleBusinessAuthUrl,
  buildMercadoPagoSellerAuthUrl,
  exchangeGoogleBusinessCodeAndSync,
  exchangeMercadoPagoSellerCode,
  getAppBaseUrl,
  getGoogleBusinessOAuthConfig,
  getMercadoPagoOAuthConfig,
  verifyOAuthState,
} from './_lib/oauth.ts';
import { createMercadoPagoPreference } from './_lib/payment.ts';
import { ensureSeeded } from './_lib/seed.ts';

interface MerchantDoc {
  id: number;
  userId: number;
  userUid?: string;
  companyName: string;
  tradeName: string;
  documentNumber: string;
  cadasturNumber: string | null;
  category: string;
  riskLevel: string;
  verificationStatus: string;
  planId: number;
  city: string;
  state: string;
  phone: string;
  bio: string;
  gbpConnected?: boolean;
  gbpAccountName?: string | null;
  gbpSyncedAt?: string | null;
  mpOauthConnected?: boolean;
  mpCollectorId?: string | null;
  createdAt: string;
}

interface PlanDoc {
  id: number;
  slug: string;
  name: string;
  monthlyPriceCents: number;
  durationDays: number;
  commissionBps: number;
  maxListings: number;
}

interface ListingDoc {
  id: number;
  merchantId: number;
  destinationId: number;
  moduleType: string;
  subtype: string;
  title: string;
  slug: string;
  summary: string;
  description: string;
  priceCents: number;
  promoPriceCents?: number | null;
  promoLabel?: string | null;
  capacity: number;
  durationOrCheckin: string;
  address: string;
  cancellationPolicy: string;
  galleryJson?: string[];
  videosJson?: string[];
  googlePlaceId?: string | null;
  status: string;
  expiresAt?: string | null;
  createdAt: string;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!enforceApiSecurity(req, res)) return;
  if (!checkRateLimit(req, res, 'merchant:api', 90, 60000)) return;
  try {
    await ensureSeeded();
  } catch (err) {
    console.error('Seed error:', err);
    sendJson(res, 503, { error: 'Serviço temporariamente indisponível ao inicializar dados.' });
    return;
  }

  const route = getRoutePath(req);
  const query = getQuery(req);

  // ========================
  // PUBLIC OAUTH CALLBACKS (NO BEARER HEADER — SIGNED STATE TOKEN)
  // ========================
  if (req.method === 'GET' && route === '/oauth/google-business/callback') {
    const { code, state, error } = query;
    if (error || !code || !state) {
      sendHtml(res, 400, '<p>Autorização Google Business cancelada ou incompleta.</p>');
      return;
    }
    const parsed = verifyOAuthState(String(state));
    if (!parsed || parsed.provider !== 'google_business') {
      sendHtml(res, 400, '<p>Token de estado OAuth inválido ou expirado.</p>');
      return;
    }
    try {
      await exchangeGoogleBusinessCodeAndSync({
        code: String(code),
        userId: parsed.userId,
        merchantId: parsed.merchantId,
      });
      sendHtml(
        res,
        200,
        `<html><body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'google_business' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Google Business Profile conectado com sucesso. Esta janela será fechada.</p>
        </body></html>`
      );
    } catch (err) {
      console.error('Google Business OAuth callback error:', err);
      sendHtml(res, 500, '<p>Falha ao concluir conexão com Google Business Profile.</p>');
    }
    return;
  }

  if (req.method === 'GET' && route === '/oauth/mercadopago/callback') {
    const { code, state } = query;
    if (!code || !state) {
      sendHtml(res, 400, '<p>Autorização Mercado Pago cancelada ou incompleta.</p>');
      return;
    }
    const parsed = verifyOAuthState(String(state));
    if (!parsed || parsed.provider !== 'mercadopago_seller') {
      sendHtml(res, 400, '<p>Estado OAuth Mercado Pago inválido.</p>');
      return;
    }
    try {
      await exchangeMercadoPagoSellerCode({
        code: String(code),
        userId: parsed.userId,
        merchantId: parsed.merchantId,
      });
      sendHtml(
        res,
        200,
        `<html><body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'mercadopago_seller' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Conta Mercado Pago vinculada ao Split Froc Rota. Esta janela será fechada.</p>
        </body></html>`
      );
    } catch (err) {
      console.error('Mercado Pago OAuth callback error:', err);
      sendHtml(res, 500, '<p>Erro na vinculação OAuth Mercado Pago.</p>');
    }
    return;
  }

  // All other routes require authenticated Firebase user
  const auth = await authenticateRequest(req, res);
  if (!auth) return;
  const user = auth.dbUser;

  const findUserMerchant = async (): Promise<MerchantDoc | null> => {
    const snap = await adminDb
      .collection('merchants')
      .where('userId', '==', user.id)
      .limit(1)
      .get();
    return snap.empty ? null : (snap.docs[0].data() as MerchantDoc);
  };

  // POST /api/merchant/onboard
  if (req.method === 'POST' && route === '/merchant/onboard') {
    try {
      const body = await parseJsonBody<{
        companyName?: string;
        tradeName?: string;
        documentNumber?: string;
        cadasturNumber?: string;
        category?: string;
        planSlug?: string;
        city?: string;
        state?: string;
        phone?: string;
        bio?: string;
      }>(req);

      const {
        companyName,
        tradeName,
        documentNumber,
        cadasturNumber,
        category,
        planSlug = 'free',
        city,
        state,
        phone,
        bio,
      } = body;

      if (!companyName || !tradeName || !documentNumber || !category || !city || !state || !phone) {
        sendJson(res, 400, { error: 'Preencha todos os dados empresariais obrigatórios.' });
        return;
      }

      const existing = await findUserMerchant();
      if (existing) {
        sendJson(res, 409, { error: 'Esta conta já possui um cadastro comercial ativo.' });
        return;
      }

      const allPlans = await getAllDocs<PlanDoc & Record<string, unknown>>('merchant_plans');
      const plan = allPlans.find((p) => p.slug === String(planSlug)) ?? allPlans[0];
      const riskLevel =
        category === 'nautical' || category === 'adventure' ? 'high_risk_nautical' : 'standard';

      const id = await nextSeqId('merchants');
      const merchant: MerchantDoc = {
        id,
        userId: user.id,
        userUid: user.uid,
        companyName: String(companyName).slice(0, 140),
        tradeName: String(tradeName).slice(0, 120),
        documentNumber: String(documentNumber).slice(0, 30),
        cadasturNumber: cadasturNumber ? String(cadasturNumber).slice(0, 40) : null,
        category: String(category),
        riskLevel,
        verificationStatus: 'pending',
        planId: plan.id,
        city: String(city).slice(0, 80),
        state: String(state).slice(0, 10),
        phone: String(phone).slice(0, 30),
        bio: String(bio || '').slice(0, 500),
        gbpConnected: false,
        mpOauthConnected: false,
        createdAt: new Date().toISOString(),
      };

      await adminDb.collection('merchants').doc(String(id)).set(merchant);
      if (user.role === 'tourist') {
        await adminDb.collection('users').doc(user.uid).set({ role: 'merchant' }, { merge: true });
      }

      await recordAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'MERCHANT_ONBOARDED',
        entityType: 'merchant',
        entityId: id,
        details: { tradeName, planSlug: plan.slug, riskLevel },
      });

      sendJson(res, 201, { merchant });
    } catch (error) {
      console.error('POST /api/merchant/onboard error:', error);
      sendJson(res, 500, { error: 'Erro ao cadastrar parceiro.' });
    }
    return;
  }

  // GET /api/merchant/dashboard
  if (req.method === 'GET' && route === '/merchant/dashboard') {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 200, { merchant: null, plan: null, listings: [], bookings: [], reviews: [] });
        return;
      }

      const [planSnap, listingsSnap, users] = await Promise.all([
        adminDb.collection('merchant_plans').doc(String(merchant.planId)).get(),
        adminDb.collection('listings').where('merchantId', '==', merchant.id).get(),
        getAllDocs<{ id: number; name: string; email: string }>('users'),
      ]);

      const plan = planSnap.exists ? planSnap.data() : null;
      const mListings = listingsSnap.docs
        .map((d) => d.data() as ListingDoc)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

      const listingIds = new Set(mListings.map((l) => l.id));
      const listingMap = new Map(mListings.map((l) => [l.id, l.title]));
      const userMap = new Map(users.map((u) => [u.id, u]));

      let mBookings: Array<{
        booking: Record<string, unknown>;
        listingTitle: string;
        touristName: string;
        touristEmail: string;
      }> = [];
      let mReviews: Array<{
        review: Record<string, unknown>;
        authorName: string;
        listingTitle: string;
      }> = [];

      if (listingIds.size > 0) {
        const [allBookings, allReviews] = await Promise.all([
          getAllDocs<Record<string, unknown>>('bookings'),
          getAllDocs<Record<string, unknown>>('reviews'),
        ]);

        mBookings = allBookings
          .filter((b) => listingIds.has(Number(b.listingId)))
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .map((booking) => {
            const u = userMap.get(Number(booking.userId));
            return {
              booking,
              listingTitle: listingMap.get(Number(booking.listingId)) || 'Serviço',
              touristName: u?.name || 'Viajante',
              touristEmail: u?.email || '',
            };
          });

        mReviews = allReviews
          .filter((r) => r.listingId !== null && listingIds.has(Number(r.listingId)))
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .map((review) => ({
            review,
            authorName: userMap.get(Number(review.userId))?.name || 'Viajante',
            listingTitle: listingMap.get(Number(review.listingId)) || 'Serviço',
          }));
      }

      sendJson(res, 200, {
        merchant,
        plan,
        listings: mListings,
        bookings: mBookings,
        reviews: mReviews,
      });
    } catch (error) {
      console.error('GET /api/merchant/dashboard error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar painel do comerciante.' });
    }
    return;
  }

  // POST /api/merchant/listings
  if (req.method === 'POST' && route === '/merchant/listings') {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 403, { error: 'Complete o cadastro de parceiro primeiro.' });
        return;
      }

      const [planSnap, existingSnap] = await Promise.all([
        adminDb.collection('merchant_plans').doc(String(merchant.planId)).get(),
        adminDb.collection('listings').where('merchantId', '==', merchant.id).get(),
      ]);
      const plan = (planSnap.data() as PlanDoc) ?? { name: 'Gratuito', maxListings: 3 };
      if (existingSnap.size >= plan.maxListings) {
        sendJson(res, 403, {
          error: `Limite de ${plan.maxListings} anúncios atingido para o plano ${plan.name}.`,
        });
        return;
      }

      const body = await parseJsonBody<{
        destinationId?: number;
        moduleType?: string;
        subtype?: string;
        title?: string;
        summary?: string;
        description?: string;
        priceBrl?: number;
        capacity?: number;
        durationOrCheckin?: string;
        address?: string;
        cancellationPolicy?: string;
        amenities?: string[];
        coverImage?: string;
      }>(req);

      const {
        destinationId,
        moduleType,
        subtype,
        title,
        summary,
        description,
        priceBrl,
        capacity,
        durationOrCheckin,
        address,
        cancellationPolicy,
        amenities,
        coverImage,
      } = body;

      if (!destinationId || !moduleType || !title || !priceBrl || !address) {
        sendJson(res, 400, { error: 'Dados obrigatórios do anúncio ausentes.' });
        return;
      }

      const destSnap = await adminDb
        .collection('destinations')
        .doc(String(Number(destinationId)))
        .get();
      if (!destSnap.exists) {
        sendJson(res, 404, { error: 'Destino inválido.' });
        return;
      }
      const dest = destSnap.data() as {
        id: number;
        coverImage: string;
        lat: number;
        lng: number;
      };

      const slug =
        String(title)
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') +
        '-' +
        crypto.randomBytes(2).toString('hex');

      const safeCover =
        typeof coverImage === 'string' && coverImage.startsWith('/src/assets/images/')
          ? coverImage
          : dest.coverImage;

      const id = await nextSeqId('listings');
      const cap = Math.max(1, Math.min(200, Number(capacity) || 8));
      const nowIso = new Date().toISOString();
      const created = {
        id,
        merchantId: merchant.id,
        destinationId: dest.id,
        moduleType: ['experience', 'gastronomy', 'accommodation'].includes(String(moduleType))
          ? String(moduleType)
          : 'experience',
        subtype: String(subtype || 'passeio').slice(0, 40),
        title: String(title).slice(0, 140),
        slug,
        summary: String(summary || title).slice(0, 240),
        description: String(description || summary || title).slice(0, 2000),
        priceCents: Math.max(1000, Math.round(Number(priceBrl) * 100)),
        promoPriceCents: null,
        promoLabel: null,
        currency: 'BRL',
        capacity: cap,
        durationOrCheckin: String(durationOrCheckin || '3 horas').slice(0, 60),
        address: String(address).slice(0, 200),
        lat: dest.lat + (Math.random() - 0.5) * 0.02,
        lng: dest.lng + (Math.random() - 0.5) * 0.02,
        amenitiesJson: Array.isArray(amenities) ? amenities.map(String).slice(0, 12) : [],
        galleryJson: [],
        videosJson: [],
        googlePlaceId: null,
        menuOrScheduleJson: [],
        cancellationPolicy: String(
          cancellationPolicy || 'Cancelamento gratuito até 48h antes da data agendada.'
        ).slice(0, 300),
        coverImage: safeCover,
        isFeatured: false,
        isSponsored: false,
        status: merchant.verificationStatus === 'verified' ? 'active' : 'pending',
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        ratingAvg: 5,
        reviewCount: 0,
        createdAt: nowIso,
      };

      await adminDb.collection('listings').doc(String(id)).set(created);

      const today = new Date();
      for (const offset of [1, 3, 5]) {
        const slotId = await nextSeqId('availability_slots');
        await adminDb
          .collection('availability_slots')
          .doc(String(slotId))
          .set({
            id: slotId,
            listingId: id,
            date: new Date(today.getTime() + offset * 86400000).toISOString().slice(0, 10),
            timeSlot: moduleType === 'accommodation' ? 'Diária' : '09:30',
            totalSpots: cap,
            availableSpots: cap,
            priceOverrideCents: null,
          });
      }

      await recordAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'LISTING_CREATED',
        entityType: 'listing',
        entityId: id,
        details: { title: created.title, status: created.status },
      });

      sendJson(res, 201, { listing: created });
    } catch (error) {
      console.error('POST /api/merchant/listings error:', error);
      sendJson(res, 500, { error: 'Erro ao criar anúncio.' });
    }
    return;
  }

  // PATCH /api/merchant/listings/:id
  const editListingMatch = route.match(/^\/merchant\/listings\/(\d+)$/);
  if (req.method === 'PATCH' && editListingMatch) {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 403, { error: 'Conta comercial não encontrada.' });
        return;
      }
      const ref = adminDb.collection('listings').doc(editListingMatch[1]);
      const snap = await ref.get();
      if (!snap.exists || (snap.data() as ListingDoc).merchantId !== merchant.id) {
        sendJson(res, 404, { error: 'Anúncio não encontrado nesta conta.' });
        return;
      }

      const existing = snap.data() as ListingDoc;
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const {
        title,
        summary,
        description,
        priceBrl,
        promoPriceBrl,
        promoLabel,
        capacity,
        durationOrCheckin,
        address,
        cancellationPolicy,
        galleryUrls,
        videoUrls,
        googlePlaceId,
      } = body;

      const safeGallery = Array.isArray(galleryUrls)
        ? galleryUrls
            .map(String)
            .map(sanitizeAssetOrSafeHttpUrl)
            .filter((x): x is string => Boolean(x))
            .slice(0, 12)
        : existing.galleryJson ?? [];
      const safeVideos = Array.isArray(videoUrls)
        ? videoUrls
            .map(String)
            .map(sanitizeAssetOrSafeHttpUrl)
            .filter((x): x is string => Boolean(x))
            .slice(0, 6)
        : existing.videosJson ?? [];

      const updates = {
        title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 140) : existing.title,
        summary:
          typeof summary === 'string' && summary.trim() ? summary.trim().slice(0, 240) : existing.summary,
        description:
          typeof description === 'string' && description.trim()
            ? description.trim().slice(0, 2000)
            : existing.description,
        priceCents:
          priceBrl !== undefined && Number(priceBrl) > 0
            ? Math.round(Number(priceBrl) * 100)
            : existing.priceCents,
        promoPriceCents:
          promoPriceBrl === null || promoPriceBrl === ''
            ? null
            : promoPriceBrl !== undefined && Number(promoPriceBrl) > 0
            ? Math.round(Number(promoPriceBrl) * 100)
            : existing.promoPriceCents ?? null,
        promoLabel:
          typeof promoLabel === 'string'
            ? promoLabel.trim().slice(0, 60) || null
            : existing.promoLabel ?? null,
        capacity:
          capacity !== undefined ? Math.max(1, Math.min(200, Number(capacity))) : existing.capacity,
        durationOrCheckin:
          typeof durationOrCheckin === 'string' && durationOrCheckin.trim()
            ? durationOrCheckin.trim().slice(0, 60)
            : existing.durationOrCheckin,
        address:
          typeof address === 'string' && address.trim() ? address.trim().slice(0, 200) : existing.address,
        cancellationPolicy:
          typeof cancellationPolicy === 'string' && cancellationPolicy.trim()
            ? cancellationPolicy.trim().slice(0, 300)
            : existing.cancellationPolicy,
        galleryJson: safeGallery,
        videosJson: safeVideos,
        googlePlaceId:
          typeof googlePlaceId === 'string'
            ? googlePlaceId.trim().slice(0, 120) || null
            : existing.googlePlaceId ?? null,
      };

      await ref.update(updates);
      await recordAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'MERCHANT_LISTING_UPDATED',
        entityType: 'listing',
        entityId: existing.id,
      });

      sendJson(res, 200, { listing: { ...existing, ...updates } });
    } catch (error) {
      console.error('PATCH /api/merchant/listings/:id error:', error);
      sendJson(res, 500, { error: 'Erro ao atualizar anúncio.' });
    }
    return;
  }

  // PATCH /api/merchant/listings/:id/status
  const statusListingMatch = route.match(/^\/merchant\/listings\/(\d+)\/status$/);
  if (req.method === 'PATCH' && statusListingMatch) {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 403, { error: 'Conta comercial não encontrada.' });
        return;
      }
      const ref = adminDb.collection('listings').doc(statusListingMatch[1]);
      const snap = await ref.get();
      if (!snap.exists || (snap.data() as ListingDoc).merchantId !== merchant.id) {
        sendJson(res, 404, { error: 'Anúncio não encontrado.' });
        return;
      }
      const existing = snap.data() as ListingDoc;
      const body = await parseJsonBody<{ status?: string; renewDays?: number }>(req);

      const nextStatus =
        body.status === 'paused'
          ? 'paused'
          : body.status === 'active'
          ? merchant.verificationStatus === 'verified'
            ? 'active'
            : 'pending'
          : existing.status;
      const nextExpires =
        body.renewDays && Number(body.renewDays) > 0
          ? new Date(Date.now() + Number(body.renewDays) * 86400000).toISOString()
          : existing.expiresAt ?? null;

      await ref.update({ status: nextStatus, expiresAt: nextExpires });
      sendJson(res, 200, { listing: { ...existing, status: nextStatus, expiresAt: nextExpires } });
    } catch (error) {
      console.error('PATCH /api/merchant/listings/:id/status error:', error);
      sendJson(res, 500, { error: 'Erro ao alterar estado do anúncio.' });
    }
    return;
  }

  // DELETE /api/merchant/listings/:id
  if (req.method === 'DELETE' && editListingMatch) {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 403, { error: 'Conta comercial não encontrada.' });
        return;
      }
      const listingId = Number(editListingMatch[1]);
      const ref = adminDb.collection('listings').doc(String(listingId));
      const snap = await ref.get();
      if (!snap.exists || (snap.data() as ListingDoc).merchantId !== merchant.id) {
        sendJson(res, 404, { error: 'Anúncio não encontrado.' });
        return;
      }

      const activeBookings = await adminDb
        .collection('bookings')
        .where('listingId', '==', listingId)
        .where('status', '==', 'confirmed')
        .limit(1)
        .get();
      if (!activeBookings.empty) {
        sendJson(res, 409, {
          error: 'Este anúncio possui reservas confirmadas ativas. Pause-o em vez de excluir.',
        });
        return;
      }

      await ref.update({ status: 'paused' });
      await recordAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'MERCHANT_LISTING_ARCHIVED',
        entityType: 'listing',
        entityId: listingId,
      });
      sendJson(res, 200, { deleted: true });
    } catch (error) {
      console.error('DELETE /api/merchant/listings/:id error:', error);
      sendJson(res, 500, { error: 'Erro ao remover anúncio.' });
    }
    return;
  }

  // POST /api/merchant/listings/:id/slots
  const slotsMatch = route.match(/^\/merchant\/listings\/(\d+)\/slots$/);
  if (req.method === 'POST' && slotsMatch) {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 403, { error: 'Conta comercial não encontrada.' });
        return;
      }
      const listingId = Number(slotsMatch[1]);
      const listingSnap = await adminDb.collection('listings').doc(String(listingId)).get();
      if (!listingSnap.exists || (listingSnap.data() as ListingDoc).merchantId !== merchant.id) {
        sendJson(res, 404, { error: 'Anúncio não encontrado.' });
        return;
      }
      const owned = listingSnap.data() as ListingDoc;
      const body = await parseJsonBody<{
        date?: string;
        timeSlot?: string;
        totalSpots?: number;
      }>(req);
      if (!body.date || !body.timeSlot) {
        sendJson(res, 400, { error: 'Data e horário são obrigatórios.' });
        return;
      }

      const spots = Math.max(1, Math.min(300, Number(body.totalSpots) || owned.capacity));
      const id = await nextSeqId('availability_slots');
      const slot = {
        id,
        listingId,
        date: String(body.date).slice(0, 10),
        timeSlot: String(body.timeSlot).slice(0, 30),
        totalSpots: spots,
        availableSpots: spots,
        priceOverrideCents: null,
      };
      await adminDb.collection('availability_slots').doc(String(id)).set(slot);
      sendJson(res, 201, { slot });
    } catch (error) {
      console.error('POST /api/merchant/listings/:id/slots error:', error);
      sendJson(res, 500, { error: 'Erro ao cadastrar horário.' });
    }
    return;
  }

  // GET /api/merchant/subscriptions
  if (req.method === 'GET' && route === '/merchant/subscriptions') {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 200, { subscriptions: [] });
        return;
      }
      const [subsSnap, plans] = await Promise.all([
        adminDb.collection('merchant_subscriptions').where('merchantId', '==', merchant.id).get(),
        getAllDocs<PlanDoc & Record<string, unknown>>('merchant_plans'),
      ]);
      const planMap = new Map(plans.map((p) => [p.id, p]));
      const subs = subsSnap.docs
        .map((d) => d.data() as { planId: number; createdAt: string })
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((subscription) => {
          const p = planMap.get(subscription.planId);
          return {
            subscription,
            planName: p?.name || 'Plano Comercial',
            planSlug: p?.slug || '',
          };
        });
      sendJson(res, 200, { subscriptions: subs });
    } catch {
      sendJson(res, 500, { error: 'Erro ao carregar assinaturas.' });
    }
    return;
  }

  // POST /api/merchant/plans/subscribe (Free immediate; Paid strictly via Mercado Pago webhook)
  if (req.method === 'POST' && route === '/merchant/plans/subscribe') {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 403, { error: 'Cadastre sua empresa antes de contratar um plano.' });
        return;
      }
      const body = await parseJsonBody<{ planSlug?: string; autoRenew?: boolean }>(req);
      const allPlans = await getAllDocs<PlanDoc & Record<string, unknown>>('merchant_plans');
      const plan = allPlans.find((p) => p.slug === String(body.planSlug));
      if (!plan) {
        sendJson(res, 404, { error: 'Plano comercial não encontrado.' });
        return;
      }

      const isFree = plan.monthlyPriceCents === 0;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (plan.durationDays || 30) * 86400000);
      const id = await nextSeqId('merchant_subscriptions');

      const sub = {
        id,
        merchantId: merchant.id,
        planId: plan.id,
        status: isFree ? 'active' : 'pending_payment',
        amountCents: plan.monthlyPriceCents,
        paymentRef: null,
        startsAt: isFree ? now.toISOString() : null,
        expiresAt: isFree ? expiresAt.toISOString() : null,
        autoRenew: body.autoRenew !== false,
        courtesyByEmail: null,
        createdAt: now.toISOString(),
      };

      await adminDb.collection('merchant_subscriptions').doc(String(id)).set(sub);
      if (isFree) {
        await adminDb.collection('merchants').doc(String(merchant.id)).set({ planId: plan.id }, { merge: true });
      }

      let checkoutUrl: string | null = null;
      if (!isFree && process.env.MERCADOPAGO_ACCESS_TOKEN) {
        try {
          const pref = await createMercadoPagoPreference({
            bookingCode: `SUB-${sub.id}`,
            title: `Plano ${plan.name} (${plan.durationDays} dias) - Froc Rota`,
            amountCents: plan.monthlyPriceCents,
            payerEmail: user.email,
            appUrl: getAppBaseUrl(),
          });
          checkoutUrl = pref?.init_point ?? null;
        } catch (mpErr) {
          console.error('Mercado Pago plan preference failed:', mpErr);
        }
      }

      sendJson(res, 201, {
        subscription: sub,
        plan,
        checkoutUrl,
        message: isFree
          ? 'Plano gratuito ativado.'
          : 'Assinatura criada como pending_payment. Será ativada automaticamente após aprovação no Mercado Pago.',
      });
    } catch (error) {
      console.error('POST /api/merchant/plans/subscribe error:', error);
      sendJson(res, 500, { error: 'Erro ao contratar plano.' });
    }
    return;
  }

  // GET /api/merchant/campaigns
  if (req.method === 'GET' && route === '/merchant/campaigns') {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 200, { campaigns: [] });
        return;
      }
      const snap = await adminDb
        .collection('campaigns')
        .where('merchantId', '==', merchant.id)
        .get();
      const list = snap.docs
        .map((d) => d.data() as { createdAt: string })
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      sendJson(res, 200, { campaigns: list });
    } catch {
      sendJson(res, 500, { error: 'Erro ao carregar campanhas.' });
    }
    return;
  }

  // POST /api/merchant/campaigns/generate-copy
  if (req.method === 'POST' && route === '/merchant/campaigns/generate-copy') {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 403, { error: 'Conta comercial necessária.' });
        return;
      }
      const body = await parseJsonBody<{
        listingId?: number;
        channel?: string;
        tone?: string;
      }>(req);
      const listingSnap = await adminDb
        .collection('listings')
        .doc(String(Number(body.listingId)))
        .get();
      if (!listingSnap.exists || (listingSnap.data() as ListingDoc).merchantId !== merchant.id) {
        sendJson(res, 404, { error: 'Anúncio não encontrado.' });
        return;
      }
      const item = listingSnap.data() as ListingDoc;
      const channel = body.channel || 'instagram';
      const tone = body.tone || 'Sofisticado e acolhedor';

      let generated = {
        headline: `${item.title} — Reserve com segurança na Froc Rota`,
        adCopy: `${item.summary} Atendimento verificado em ${item.address}. Valor a partir de R$ ${Math.round(item.priceCents / 100)}.`,
        socialCaption: `Descubra ${item.title}! Experiência verificada na Froc Rota Turismo. Reserve sua vaga diretamente pelo link oficial. #FrocRota #TurismoBrasil`,
        aiSuggestion: `Destaque a política flexível ("${item.cancellationPolicy}") e inclua fotos em alta luz natural para elevar o CTR no canal ${channel}.`,
      };

      if (resolveGeminiKeySlots().length > 0) {
        try {
          const { data: parsed } = await generateResilientJson<{
            headline: string;
            adCopy: string;
            socialCaption: string;
            aiSuggestion: string;
          }>({
            contents: JSON.stringify({ listing: item, channel, tone }),
            config: {
              systemInstruction:
                'Você é especialista em marketing turístico da Froc Rota. Gere headline, adCopy, socialCaption e aiSuggestion baseados exclusivamente nos dados reais do anúncio.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  headline: { type: Type.STRING },
                  adCopy: { type: Type.STRING },
                  socialCaption: { type: Type.STRING },
                  aiSuggestion: { type: Type.STRING },
                },
                required: ['headline', 'adCopy', 'socialCaption', 'aiSuggestion'],
              },
            },
            validate: (p) => Boolean(p && p.headline && p.adCopy),
          });
          if (parsed.headline && parsed.adCopy) generated = parsed;
        } catch {
          // Keep grounded fallback
        }
      }

      await dispatchAgentTask({
        department: 'Marketing e SEO',
        triggerType: 'request',
        eventName: 'CAMPAIGN_AI_COPY_GENERATED',
        title: `Copy gerada para "${item.title}" (${channel})`,
        input: { listingId: item.id, channel },
      });

      sendJson(res, 200, generated);
    } catch (error) {
      console.error('generate-copy error:', error);
      sendJson(res, 500, { error: 'Erro ao gerar material de marketing.' });
    }
    return;
  }

  // POST /api/merchant/campaigns
  if (req.method === 'POST' && route === '/merchant/campaigns') {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 403, { error: 'Conta comercial necessária.' });
        return;
      }
      const body = await parseJsonBody<{
        listingId?: number | null;
        title?: string;
        channel?: string;
        headline?: string;
        adCopy?: string;
        socialCaption?: string;
        aiSuggestion?: string;
      }>(req);

      if (!body.title || !body.headline || !body.adCopy) {
        sendJson(res, 400, { error: 'Título, chamada e texto do anúncio são obrigatórios.' });
        return;
      }

      const id = await nextSeqId('campaigns');
      const created = {
        id,
        merchantId: merchant.id,
        ownerUid: user.uid,
        listingId: body.listingId ? Number(body.listingId) : null,
        title: String(body.title).slice(0, 140),
        channel: ['instagram', 'google_ads', 'trivago', 'froc_featured'].includes(
          String(body.channel)
        )
          ? String(body.channel)
          : 'froc_featured',
        headline: String(body.headline).slice(0, 200),
        adCopy: String(body.adCopy).slice(0, 1500),
        socialCaption: String(body.socialCaption || '').slice(0, 1000),
        caption: String(body.socialCaption || '').slice(0, 1000),
        aiSuggestion: body.aiSuggestion ? String(body.aiSuggestion).slice(0, 600) : null,
        status: 'active',
        impressions: 0,
        clicks: 0,
        contacts: 0,
        conversions: 0,
        createdAt: new Date().toISOString(),
      };
      await adminDb.collection('campaigns').doc(String(id)).set(created);
      sendJson(res, 201, { campaign: created });
    } catch (error) {
      console.error('POST /api/merchant/campaigns error:', error);
      sendJson(res, 500, { error: 'Erro ao criar campanha.' });
    }
    return;
  }

  // PATCH /api/merchant/campaigns/:id
  const campMatch = route.match(/^\/merchant\/campaigns\/(\d+)$/);
  if (req.method === 'PATCH' && campMatch) {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 403, { error: 'Sem permissão.' });
        return;
      }
      const ref = adminDb.collection('campaigns').doc(campMatch[1]);
      const snap = await ref.get();
      if (!snap.exists || snap.data()?.merchantId !== merchant.id) {
        sendJson(res, 404, { error: 'Campanha não encontrada.' });
        return;
      }
      const body = await parseJsonBody<{ status?: string }>(req);
      const status = ['draft', 'active', 'paused'].includes(String(body.status))
        ? String(body.status)
        : 'paused';
      await ref.update({ status });
      sendJson(res, 200, { campaign: { ...snap.data(), status } });
    } catch {
      sendJson(res, 500, { error: 'Erro ao atualizar campanha.' });
    }
    return;
  }

  // POST /api/merchant/reviews/:id/reply
  const replyReviewMatch = route.match(/^\/merchant\/reviews\/(\d+)\/reply$/);
  if (req.method === 'POST' && replyReviewMatch) {
    try {
      const replyText = String((await parseJsonBody<{ reply?: string }>(req)).reply ?? '')
        .trim()
        .slice(0, 500);
      if (!replyText) {
        sendJson(res, 400, { error: 'Digite uma resposta.' });
        return;
      }
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 403, { error: 'Acesso restrito a parceiros.' });
        return;
      }
      const revRef = adminDb.collection('reviews').doc(replyReviewMatch[1]);
      const revSnap = await revRef.get();
      if (!revSnap.exists) {
        sendJson(res, 404, { error: 'Avaliação não encontrada.' });
        return;
      }
      const rev = revSnap.data() as { listingId?: number | null };
      if (!rev.listingId) {
        sendJson(res, 403, { error: 'Sem permissão para responder esta avaliação.' });
        return;
      }
      const listingSnap = await adminDb.collection('listings').doc(String(rev.listingId)).get();
      if (!listingSnap.exists || (listingSnap.data() as ListingDoc).merchantId !== merchant.id) {
        sendJson(res, 403, { error: 'Sem permissão para responder esta avaliação.' });
        return;
      }
      await revRef.update({ merchantReply: replyText });
      sendJson(res, 200, { review: { ...revSnap.data(), merchantReply: replyText } });
    } catch (error) {
      console.error('Reply review error:', error);
      sendJson(res, 500, { error: 'Erro ao responder avaliação.' });
    }
    return;
  }

  // OAuth status & URL routes
  if (req.method === 'GET' && route === '/oauth/status') {
    const merchant = await findUserMerchant();
    sendJson(res, 200, {
      googleBusiness: {
        ...getGoogleBusinessOAuthConfig(),
        connected: merchant?.gbpConnected ?? false,
        accountName: merchant?.gbpAccountName ?? null,
        syncedAt: merchant?.gbpSyncedAt ?? null,
      },
      mercadopagoSeller: {
        ...getMercadoPagoOAuthConfig(),
        connected: merchant?.mpOauthConnected ?? false,
        collectorId: merchant?.mpCollectorId ?? null,
      },
    });
    return;
  }

  if (req.method === 'GET' && route === '/oauth/google-business/url') {
    const merchant = await findUserMerchant();
    if (!merchant) {
      sendJson(res, 403, {
        error: 'Complete o cadastro comercial antes de conectar o Google Business Profile.',
      });
      return;
    }
    const url = buildGoogleBusinessAuthUrl({ userId: user.id, merchantId: merchant.id });
    if (!url) {
      const cfg = getGoogleBusinessOAuthConfig();
      sendJson(res, 400, {
        error: `Credenciais GOOGLE_BUSINESS_CLIENT_ID e GOOGLE_BUSINESS_CLIENT_SECRET não configuradas no servidor. Redirect URI cadastrável: ${cfg.redirectUri}`,
        config: cfg,
      });
      return;
    }
    sendJson(res, 200, { url });
    return;
  }

  if (req.method === 'GET' && route === '/oauth/mercadopago/url') {
    const merchant = await findUserMerchant();
    if (!merchant) {
      sendJson(res, 403, {
        error: 'Complete o cadastro comercial antes de autorizar sua conta Mercado Pago.',
      });
      return;
    }
    const url = buildMercadoPagoSellerAuthUrl({ userId: user.id, merchantId: merchant.id });
    if (!url) {
      const cfg = getMercadoPagoOAuthConfig();
      sendJson(res, 400, {
        error: `Credenciais MERCADOPAGO_CLIENT_ID e MERCADOPAGO_CLIENT_SECRET não configuradas no servidor. Redirect URI cadastrável: ${cfg.redirectUri}`,
        config: cfg,
      });
      return;
    }
    sendJson(res, 200, { url });
    return;
  }

  sendJson(res, 404, { error: 'Rota do anunciante não encontrada.' });
}
