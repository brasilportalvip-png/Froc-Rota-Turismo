import crypto from 'node:crypto';
import { analisarLeilao, COMISSAO_MAX_BPS, COMISSAO_MIN_BPS, lanceComissaoBps } from './_lib/leilao.js';
import { Type } from '@google/genai';
import { adminDb } from './_lib/firebase-admin.js';
import { agentReviewListing, agentVerifyMerchant } from './_lib/agent-jobs.js';
import { dispatchAgentTask } from './_lib/agents.js';
import { recordAuditLog } from './_lib/audit.js';
import { authenticateRequest } from './_lib/auth.js';
import { getAllDocs, nextSeqId } from './_lib/firestore-helpers.js';
import { generateResilientJson, resolveGeminiKeySlots } from './_lib/gemini-resilience.js';
import { getIdentityCheck, isIdentityApproved, isValidCnpj, isValidCpf, normalizeCpf, publicIdentityStatus } from './_lib/identity.js';
import { isPlanActive, merchantBlockers, MerchantLike, refreshMerchantListingsVisibility } from './_lib/merchant-status.js';
import { cancelCardSubscription, createCardSubscription } from './_lib/mp-marketplace.js';
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
} from './_lib/http.js';
import {
  buildGoogleBusinessAuthUrl,
  buildMercadoPagoSellerAuthUrl,
  exchangeGoogleBusinessCodeAndSync,
  exchangeMercadoPagoSellerCode,
  getAppBaseUrl,
  getGoogleBusinessOAuthConfig,
  getMercadoPagoOAuthConfig,
  verifyOAuthState,
} from './_lib/oauth.js';
import { ensureSeeded } from './_lib/seed.js';

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
  planExpiresAt?: string | null;
  planStatus?: string | null;
  verificationReason?: string | null;
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
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'google_business' }, window.location.origin);
              window.close();
            } else {
              window.location.href = '/?painel=anunciante';
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
      // Conta conectada: anúncios que só esperavam o split já podem ir ao ar.
      await refreshMerchantListingsVisibility(parsed.merchantId);
      sendHtml(
        res,
        200,
        `<html><body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'mercadopago_seller' }, window.location.origin);
              window.close();
            } else {
              window.location.href = '/?painel=anunciante';
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
        planSlug = 'basic',
        city,
        state,
        phone,
        bio,
      } = body;

      if (!companyName || !tradeName || !documentNumber || !category || !city || !state || !phone) {
        sendJson(res, 400, { error: 'Preencha todos os dados empresariais obrigatórios.' });
        return;
      }

      // Anti-fraude: só anuncia quem confirmou o e-mail e teve a identidade (CPF + fotos) aprovada.
      if (auth.authUser.email_verified !== true) {
        sendJson(res, 403, { error: 'Confirme seu e-mail antes de cadastrar a empresa.', code: 'EMAIL_NOT_VERIFIED' });
        return;
      }
      if (!(await isIdentityApproved(user.uid, user.role))) {
        sendJson(res, 403, {
          error: 'Antes de anunciar, conclua a verificação de identidade (CPF + foto do documento + selfie).',
          code: 'IDENTITY_REQUIRED',
        });
        return;
      }
      const docDigits = normalizeCpf(documentNumber);
      if (!(docDigits.length === 11 ? isValidCpf(docDigits) : isValidCnpj(docDigits))) {
        sendJson(res, 400, { error: 'Informe um CPF ou CNPJ válido.' });
        return;
      }

      const existing = await findUserMerchant();
      if (existing) {
        sendJson(res, 409, { error: 'Esta conta já possui um cadastro comercial ativo.' });
        return;
      }

      const allPlans = await getAllDocs<PlanDoc & Record<string, unknown>>('merchant_plans');
      // Sem plano gratuito: só planos pagos e ativos.
      const paidPlans = allPlans
        .filter((p) => (p as { active?: boolean }).active !== false && Number(p.monthlyPriceCents) > 0)
        .sort((a, b) => a.monthlyPriceCents - b.monthlyPriceCents);
      const plan = paidPlans.find((p) => p.slug === String(planSlug)) ?? paidPlans[0];
      if (!plan) {
        sendJson(res, 503, { error: 'Nenhum plano disponível no momento.' });
        return;
      }
      const riskLevel =
        category === 'nautical' || category === 'adventure' ? 'high_risk_nautical' : 'standard';

      const id = await nextSeqId('merchants');
      const merchant: MerchantDoc = {
        id,
        userId: user.id,
        userUid: user.uid,
        companyName: String(companyName).slice(0, 140),
        tradeName: String(tradeName).slice(0, 120),
        documentNumber: docDigits,
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
        planStatus: 'awaiting_payment',
        planExpiresAt: null,
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

      // A IA verifica o parceiro na hora (aprova, reprova ou manda para o Admin).
      let verification = { status: 'manual_review', reason: '' };
      try {
        verification = await agentVerifyMerchant(id);
      } catch (verErr) {
        console.error('merchant verification failed:', verErr);
      }
      const fresh = (await adminDb.collection('merchants').doc(String(id)).get()).data() ?? merchant;

      sendJson(res, 201, { merchant: fresh, verification, plan });
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
        sendJson(res, 200, {
          merchant: null,
          plan: null,
          planActive: false,
          blockers: [],
          identity: publicIdentityStatus(await getIdentityCheck(user.uid)),
          listings: [],
          bookings: [],
          reviews: [],
        });
        return;
      }

      const [planSnap, listingsSnap, users] = await Promise.all([
        adminDb.collection('merchant_plans').doc(String(merchant.planId)).get(),
        adminDb.collection('listings').where('merchantId', '==', merchant.id).get(),
        getAllDocs<{ id: number; name: string; email: string }>('users'),
      ]);

      const plan = planSnap.exists ? planSnap.data() : null;
      const mListings = listingsSnap.docs
        .filter((d) => d.data().status !== 'archived')
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
        planActive: isPlanActive(merchant),
        blockers: merchantBlockers(merchant as MerchantLike),
        identity: publicIdentityStatus(await getIdentityCheck(user.uid)),
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
      if (merchant.verificationStatus === 'rejected') {
        sendJson(res, 403, { error: `Cadastro reprovado: ${merchant.verificationReason || 'fale com o suporte'}.` });
        return;
      }
      if (merchant.userUid && !isPlanActive(merchant)) {
        sendJson(res, 402, {
          error: 'Ative seu plano (cobrança automática no cartão) para publicar anúncios.',
          code: 'PLAN_REQUIRED',
        });
        return;
      }
      const plan = (planSnap.data() as PlanDoc) ?? { name: 'Plano', maxListings: 0 };
      // Anúncios excluídos (arquivados) não ocupam vaga do plano.
      const emUso = existingSnap.docs.filter((d) => d.data().status !== 'archived').length;
      if (emUso >= plan.maxListings) {
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
        // No ar só com parceiro verificado + plano em dia + Mercado Pago conectado (split).
        status: merchantBlockers(merchant as MerchantLike).length === 0 ? 'active' : 'pending',
        pendingReason:
          merchantBlockers(merchant as MerchantLike).length === 0
            ? null
            : `Falta: ${merchantBlockers(merchant as MerchantLike).join(', ')}`,
        expiresAt: merchant.planExpiresAt ?? new Date(Date.now() + 30 * 86400000).toISOString(),
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

      try {
        await agentReviewListing(id);
      } catch (revErr) {
        console.error('listing review failed:', revErr);
      }
      const freshListing = (await adminDb.collection('listings').doc(String(id)).get()).data() ?? created;

      sendJson(res, 201, { listing: freshListing });
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
      try {
        await agentReviewListing(existing.id);
      } catch (revErr) {
        console.error('listing review failed:', revErr);
      }
      const freshEdited = (await ref.get()).data() ?? { ...existing, ...updates };

      sendJson(res, 200, { listing: freshEdited });
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
          ? merchantBlockers(merchant as MerchantLike).length === 0 &&
            (existing as ListingDoc & { flaggedBy?: string }).flaggedBy !== 'ia'
            ? 'active'
            : 'pending'
          : existing.status;
      const nextExpires =
        body.renewDays && Number(body.renewDays) > 0
          ? new Date(Date.now() + Number(body.renewDays) * 86400000).toISOString()
          : existing.expiresAt ?? null;

      if (nextStatus === 'active' && existing.status !== 'active') {
        const [pSnap, todos] = await Promise.all([
          adminDb.collection('merchant_plans').doc(String(merchant.planId)).get(),
          adminDb.collection('listings').where('merchantId', '==', merchant.id).get(),
        ]);
        const max = Number(pSnap.data()?.maxListings ?? 0);
        const noAr = todos.docs.filter((d) => d.data().status === 'active').length;
        if (max && noAr >= max) {
          sendJson(res, 409, { error: `Seu plano permite ${max} anúncio(s) no ar. Pause outro anúncio ou mude de plano.` });
          return;
        }
      }
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

      await ref.update({ status: 'archived', archivedAt: new Date().toISOString() });
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
  // LEILÃO DE COMISSÃO — GET mostra posição e sugestão da IA; PATCH grava o lance (14% a 25%)
  if (route === '/merchant/leilao' && (req.method === 'GET' || req.method === 'PATCH')) {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 404, { error: 'Cadastre-se como anunciante primeiro.' });
        return;
      }
      const ref = adminDb.collection('merchants').doc(String(merchant.id));
      let lance = lanceComissaoBps((merchant as { commissionBidBps?: number }).commissionBidBps);
      if (req.method === 'PATCH') {
        const body = await parseJsonBody<{ bidBps?: number }>(req);
        const pedido = Number(body.bidBps);
        if (!Number.isFinite(pedido) || pedido < COMISSAO_MIN_BPS || pedido > COMISSAO_MAX_BPS) {
          sendJson(res, 400, { error: 'A comissão deve ficar entre 14% e 25%.' });
          return;
        }
        lance = lanceComissaoBps(pedido);
        await ref.set({ commissionBidBps: lance, commissionBidAt: new Date().toISOString() }, { merge: true });
      }
      // Concorrentes: anunciantes com anúncio ativo nos mesmos destinos.
      const meus = await adminDb.collection('listings').where('merchantId', '==', merchant.id).get();
      const destinos = [...new Set(meus.docs.map((d) => Number((d.data() as { destinationId?: number }).destinationId)).filter(Boolean))];
      const rivais = new Map<number, number>();
      for (let i = 0; i < destinos.length; i += 10) {
        const lote = destinos.slice(i, i + 10);
        const snap = await adminDb.collection('listings').where('destinationId', 'in', lote).get();
        for (const d of snap.docs) {
          const l = d.data() as { merchantId?: number; status?: string };
          if (l.status === 'active' && l.merchantId && l.merchantId !== merchant.id) rivais.set(Number(l.merchantId), 0);
        }
      }
      const ids = [...rivais.keys()];
      if (ids.length) {
        const docs = await adminDb.getAll(...ids.map((id) => adminDb.collection('merchants').doc(String(id))));
        for (const d of docs) if (d.exists) rivais.set(Number(d.id), lanceComissaoBps((d.data() as { commissionBidBps?: number }).commissionBidBps));
      }
      const analise = analisarLeilao(
        merchant.id,
        lance,
        ids.map((id) => ({ merchantId: id, bidBps: rivais.get(id) ?? COMISSAO_MIN_BPS }))
      );
      sendJson(res, 200, { ...analise, minBps: COMISSAO_MIN_BPS, maxBps: COMISSAO_MAX_BPS });
    } catch (error) {
      console.error('/api/merchant/leilao error:', error);
      sendJson(res, 500, { error: 'Erro ao consultar o leilão.' });
    }
    return;
  }

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

  // POST /api/merchant/plans/subscribe — só planos pagos, com cobrança automática mensal no cartão (Mercado Pago)
  if (req.method === 'POST' && route === '/merchant/plans/subscribe') {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 403, { error: 'Cadastre sua empresa antes de contratar um plano.' });
        return;
      }
      if (merchant.verificationStatus !== 'verified') {
        // Primeiro a IA (ou a equipe) aprova o parceiro; só depois ele paga o plano.
        sendJson(res, 403, {
          error:
            merchant.verificationStatus === 'rejected'
              ? `Cadastro reprovado: ${merchant.verificationReason || 'fale com o suporte'}.`
              : 'Aguarde a aprovação do seu cadastro para assinar o plano.',
          code: 'MERCHANT_NOT_VERIFIED',
        });
        return;
      }
      const body = await parseJsonBody<{ planSlug?: string }>(req);
      const allPlans = await getAllDocs<PlanDoc & Record<string, unknown>>('merchant_plans');
      const plan = allPlans.find(
        (p) => p.slug === String(body.planSlug) && p.active !== false && Number(p.monthlyPriceCents) > 0
      );
      if (!plan) {
        sendJson(res, 404, { error: 'Plano não encontrado.' });
        return;
      }
      if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
        sendJson(res, 503, { error: 'Pagamentos ainda não configurados. Tente mais tarde.' });
        return;
      }

      const now = new Date();
      const id = await nextSeqId('merchant_subscriptions');
      const sub = {
        id,
        merchantId: merchant.id,
        planId: plan.id,
        status: 'pending_authorization',
        billing: 'card_recurring',
        amountCents: plan.monthlyPriceCents,
        durationDays: plan.durationDays || 30,
        paymentRef: null,
        mpPreapprovalId: null as string | null,
        startsAt: null,
        expiresAt: null,
        autoRenew: true,
        courtesyByEmail: null,
        createdAt: now.toISOString(),
      };
      await adminDb.collection('merchant_subscriptions').doc(String(id)).set(sub);

      let checkoutUrl: string | null = null;
      try {
        const pre = await createCardSubscription({
          subscriptionId: id,
          planName: plan.name,
          amountCents: plan.monthlyPriceCents,
          payerEmail: user.email,
          appUrl: getAppBaseUrl(),
        });
        if (pre) {
          checkoutUrl = pre.init_point;
          sub.mpPreapprovalId = pre.id;
          await adminDb.collection('merchant_subscriptions').doc(String(id)).set({ mpPreapprovalId: pre.id }, { merge: true });
        }
      } catch (mpErr) {
        console.error('Mercado Pago preapproval failed:', mpErr);
        await adminDb.collection('merchant_subscriptions').doc(String(id)).set({ status: 'failed' }, { merge: true });
        sendJson(res, 502, {
          error: 'O Mercado Pago recusou criar a assinatura. Confira se o e-mail da sua conta Mercado Pago é o mesmo deste cadastro.',
        });
        return;
      }

      sendJson(res, 201, {
        subscription: sub,
        plan,
        checkoutUrl,
        message:
          'Cadastre o cartão no Mercado Pago. O plano ativa na primeira cobrança aprovada e renova sozinho todo mês.',
      });
    } catch (error) {
      console.error('POST /api/merchant/plans/subscribe error:', error);
      sendJson(res, 500, { error: 'Erro ao contratar plano.' });
    }
    return;
  }

  // POST /api/merchant/plans/cancel — desliga a cobrança automática (o plano vale até o fim do período pago)
  if (req.method === 'POST' && route === '/merchant/plans/cancel') {
    try {
      const merchant = await findUserMerchant();
      if (!merchant) {
        sendJson(res, 403, { error: 'Conta comercial não encontrada.' });
        return;
      }
      const subs = await adminDb.collection('merchant_subscriptions').where('merchantId', '==', merchant.id).get();
      let cancelled = 0;
      for (const d of subs.docs) {
        const sd = d.data() as { mpPreapprovalId?: string | null; status: string };
        if (!sd.mpPreapprovalId || ['cancelled', 'replaced', 'failed'].includes(sd.status)) continue;
        if (await cancelCardSubscription(sd.mpPreapprovalId)) {
          await d.ref.set({ autoRenew: false, status: sd.status === 'active' ? 'active_until_end' : 'cancelled' }, { merge: true });
          cancelled += 1;
        }
      }
      // Sem renovação automática: vale até o fim do período pago, sem a folga da renovação.
      await adminDb.collection('merchants').doc(String(merchant.id)).set({ planStatus: 'cancelled' }, { merge: true });
      await recordAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'MERCHANT_PLAN_AUTORENEW_CANCELLED',
        entityType: 'merchant',
        entityId: merchant.id,
        details: { cancelled },
      });
      sendJson(res, 200, { cancelled, planExpiresAt: merchant.planExpiresAt ?? null });
    } catch (error) {
      console.error('POST /api/merchant/plans/cancel error:', error);
      sendJson(res, 500, { error: 'Erro ao cancelar a cobrança automática.' });
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
        error: 'A conexão com o Google Meu Negócio ainda não está disponível.',
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
        error: 'A conexão com o Mercado Pago está indisponível no momento. Tente mais tarde.',
        config: cfg,
      });
      return;
    }
    sendJson(res, 200, { url });
    return;
  }

  sendJson(res, 404, { error: 'Rota do anunciante não encontrada.' });
}
