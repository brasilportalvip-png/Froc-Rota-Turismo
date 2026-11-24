import crypto from 'node:crypto';
import { Router } from 'express';
import { and, desc, eq, gte, ilike, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { ensureSeeded } from '../db/seed.ts';
import {
  adminPermissions,
  aiAgents,
  auditLogs,
  availabilitySlots,
  bookings,
  conciergeRequests,
  coupons,
  destinations,
  editorialPosts,
  favorites,
  listings,
  marketingCampaigns,
  merchantPlans,
  merchants,
  notifications,
  payments,
  reports,
  reviews,
  savedItineraries,
  users,
} from '../db/schema.ts';
import {
  AuthRequest,
  optionalAuth,
  rateLimit,
  requireAdmin,
  requireAdminPermission,
  requireAuth,
} from '../middleware/auth.ts';
import { dispatchAgentTask } from '../services/agents.service.ts';
import { recordAuditLog } from '../services/audit.service.ts';
import { askFrocRotaAI } from '../services/ai.service.ts';
import {
  calculateCommissionSplit,
  createMercadoPagoPreference,
  getPaymentGatewayStatus,
  verifyMercadoPagoWebhookSignature,
} from '../services/payment.service.ts';
import { getAppBaseUrl } from '../services/oauth.service.ts';
import { recordImmutableLedgerEntry } from '../services/pricing.service.ts';
import {
  getTravelIntegrationsStatus,
  searchLiveFlightsIfConfigured,
} from '../services/travel.service.ts';
import { expansionRouter } from './expansion.routes.ts';

export const apiRouter = Router();

// Ensure initial catalog & plans are seeded lazily on first API call
apiRouter.use(async (_req, res, next) => {
  try {
    await ensureSeeded();
    next();
  } catch (error) {
    console.error('Database initialization error:', error);
    res.status(503).json({ error: 'Serviço temporariamente indisponível ao inicializar dados.' });
  }
});

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'Froc Rota Turismo API' });
});

// ========================
// AUTH & USER PROFILE
// ========================
apiRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const [merchantRows, permRows] = await Promise.all([
      db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1),
      user.role === 'subadmin'
        ? db
            .select()
            .from(adminPermissions)
            .where(and(eq(adminPermissions.email, user.email.toLowerCase()), eq(adminPermissions.active, true)))
            .limit(1)
        : Promise.resolve([]),
    ]);
    const perms = user.role === 'admin' ? ['*'] : permRows[0]?.permissionsJson ?? [];
    res.json({ user, merchant: merchantRows[0] ?? null, adminPermissions: perms });
  } catch (error) {
    console.error('GET /me error:', error);
    res.status(500).json({ error: 'Falha ao carregar perfil.' });
  }
});

apiRouter.patch('/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const { name, preferredLang, preferredCurrency, phone } = req.body ?? {};
    const validLang = ['pt', 'en', 'es'].includes(preferredLang) ? preferredLang : user.preferredLang;
    const validCurr = ['BRL', 'USD', 'EUR'].includes(preferredCurrency)
      ? preferredCurrency
      : user.preferredCurrency;

    const updated = await db
      .update(users)
      .set({
        name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : user.name,
        preferredLang: validLang,
        preferredCurrency: validCurr,
        phone: typeof phone === 'string' ? phone.trim().slice(0, 30) : user.phone,
      })
      .where(eq(users.id, user.id))
      .returning();

    res.json({ user: updated[0] });
  } catch (error) {
    console.error('PATCH /me error:', error);
    res.status(500).json({ error: 'Falha ao atualizar perfil.' });
  }
});

// ========================
// DESTINATIONS (MÓDULO 1)
// ========================
apiRouter.get('/destinations', async (req, res) => {
  try {
    const { q, category, region } = req.query;
    const conditions = [];
    if (typeof category === 'string' && category && category !== 'all') {
      conditions.push(eq(destinations.category, category));
    }
    if (typeof region === 'string' && region && region !== 'all') {
      conditions.push(eq(destinations.region, region));
    }
    if (typeof q === 'string' && q.trim()) {
      const pattern = `%${q.trim()}%`;
      conditions.push(
        or(
          ilike(destinations.name, pattern),
          ilike(destinations.state, pattern),
          ilike(destinations.summary, pattern)
        )
      );
    }

    const rows =
      conditions.length > 0
        ? await db
            .select()
            .from(destinations)
            .where(and(...conditions))
            .orderBy(desc(destinations.featured), desc(destinations.ratingAvg))
        : await db
            .select()
            .from(destinations)
            .orderBy(desc(destinations.featured), desc(destinations.ratingAvg));

    res.json({ destinations: rows });
  } catch (error) {
    console.error('GET /destinations error:', error);
    res.status(500).json({ error: 'Erro ao carregar destinos.' });
  }
});

apiRouter.get('/destinations/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug);
    const destRows = await db
      .select()
      .from(destinations)
      .where(eq(destinations.slug, slug))
      .limit(1);

    if (destRows.length === 0) {
      return res.status(404).json({ error: 'Destino não encontrado.' });
    }
    const destination = destRows[0];

    const [destListings, destReviews] = await Promise.all([
      db
        .select()
        .from(listings)
        .where(and(eq(listings.destinationId, destination.id), eq(listings.status, 'active')))
        .orderBy(desc(listings.isFeatured), desc(listings.ratingAvg)),
      db
        .select({
          id: reviews.id,
          rating: reviews.rating,
          comment: reviews.comment,
          merchantReply: reviews.merchantReply,
          createdAt: reviews.createdAt,
          authorName: users.name,
        })
        .from(reviews)
        .innerJoin(users, eq(reviews.userId, users.id))
        .where(eq(reviews.destinationId, destination.id))
        .orderBy(desc(reviews.createdAt)),
    ]);

    res.json({ destination, listings: destListings, reviews: destReviews });
  } catch (error) {
    console.error('GET /destinations/:slug error:', error);
    res.status(500).json({ error: 'Erro ao carregar detalhes do destino.' });
  }
});

// ========================
// MARKETPLACE LISTINGS (MÓDULOS 2, 3, 4)
// ========================
apiRouter.get('/listings', async (req, res) => {
  try {
    const { moduleType, destinationId, subtype, maxPriceCents, minGuests, q, amenity } = req.query;
    const conditions = [eq(listings.status, 'active')];

    if (typeof moduleType === 'string' && moduleType && moduleType !== 'all') {
      conditions.push(eq(listings.moduleType, moduleType));
    }
    if (typeof destinationId === 'string' && destinationId && !Number.isNaN(Number(destinationId))) {
      conditions.push(eq(listings.destinationId, Number(destinationId)));
    }
    if (typeof subtype === 'string' && subtype && subtype !== 'all') {
      conditions.push(eq(listings.subtype, subtype));
    }
    if (typeof maxPriceCents === 'string' && Number(maxPriceCents) > 0) {
      conditions.push(lte(listings.priceCents, Number(maxPriceCents)));
    }
    if (typeof q === 'string' && q.trim()) {
      const pattern = `%${q.trim()}%`;
      conditions.push(
        or(
          ilike(listings.title, pattern),
          ilike(listings.summary, pattern),
          ilike(listings.address, pattern)
        )!
      );
    }

    const rows = await db
      .select({
        listing: listings,
        destinationName: destinations.name,
        destinationState: destinations.state,
        destinationSlug: destinations.slug,
        merchantTradeName: merchants.tradeName,
        merchantVerified: merchants.verificationStatus,
      })
      .from(listings)
      .innerJoin(destinations, eq(listings.destinationId, destinations.id))
      .innerJoin(merchants, eq(listings.merchantId, merchants.id))
      .where(and(...conditions))
      .orderBy(desc(listings.isSponsored), desc(listings.isFeatured), desc(listings.ratingAvg));

    let items = rows.map((r) => ({
      ...r.listing,
      destinationName: r.destinationName,
      destinationState: r.destinationState,
      destinationSlug: r.destinationSlug,
      merchantTradeName: r.merchantTradeName,
      merchantVerified: r.merchantVerified === 'verified',
    }));

    if (typeof minGuests === 'string' && Number(minGuests) > 1) {
      const g = Number(minGuests);
      items = items.filter((item) => item.capacity >= g);
    }

    if (typeof amenity === 'string' && amenity.trim()) {
      const target = amenity.trim().toLowerCase();
      items = items.filter((item) =>
        Array.isArray(item.amenitiesJson) &&
        item.amenitiesJson.some((a) => a.toLowerCase().includes(target))
      );
    }

    res.json({ listings: items });
  } catch (error) {
    console.error('GET /listings error:', error);
    res.status(500).json({ error: 'Erro ao consultar catálogo.' });
  }
});

apiRouter.get('/listings/:slug', async (req, res) => {
  try {
    const slug = String(req.params.slug);
    const rows = await db
      .select({
        listing: listings,
        destination: destinations,
        merchant: merchants,
      })
      .from(listings)
      .innerJoin(destinations, eq(listings.destinationId, destinations.id))
      .innerJoin(merchants, eq(listings.merchantId, merchants.id))
      .where(eq(listings.slug, slug))
      .limit(1);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Oferta não encontrada.' });
    }

    const row = rows[0];
    const [slots, itemReviews] = await Promise.all([
      db
        .select()
        .from(availabilitySlots)
        .where(eq(availabilitySlots.listingId, row.listing.id))
        .orderBy(availabilitySlots.date),
      db
        .select({
          id: reviews.id,
          rating: reviews.rating,
          comment: reviews.comment,
          merchantReply: reviews.merchantReply,
          createdAt: reviews.createdAt,
          authorName: users.name,
        })
        .from(reviews)
        .innerJoin(users, eq(reviews.userId, users.id))
        .where(eq(reviews.listingId, row.listing.id))
        .orderBy(desc(reviews.createdAt)),
    ]);

    res.json({
      listing: row.listing,
      destination: row.destination,
      merchant: {
        id: row.merchant.id,
        tradeName: row.merchant.tradeName,
        verificationStatus: row.merchant.verificationStatus,
        cadasturNumber: row.merchant.cadasturNumber,
        city: row.merchant.city,
        state: row.merchant.state,
        bio: row.merchant.bio,
      },
      slots,
      reviews: itemReviews,
    });
  } catch (error) {
    console.error('GET /listings/:slug error:', error);
    res.status(500).json({ error: 'Erro ao carregar oferta.' });
  }
});

// ========================
// COUPONS, BOOKINGS & PAYMENTS (FASE 4)
// ========================
apiRouter.post('/coupons/validate', async (req, res) => {
  try {
    const code = String(req.body?.code ?? '').trim().toUpperCase();
    if (!code) {
      return res.status(400).json({ error: 'Código de cupom obrigatório.' });
    }
    const found = await db
      .select()
      .from(coupons)
      .where(and(eq(coupons.code, code), eq(coupons.active, true)))
      .limit(1);
    if (found.length === 0 || found[0].usedCount >= found[0].maxUses) {
      return res.status(404).json({ error: 'Cupom inválido ou esgotado.' });
    }
    res.json({ valid: true, coupon: found[0] });
  } catch (error) {
    console.error('Coupon validate error:', error);
    res.status(500).json({ error: 'Erro ao validar cupom.' });
  }
});

apiRouter.post('/bookings', requireAuth, rateLimit(20, 60000), async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const {
      listingId,
      slotId,
      checkInDate,
      checkOutDate,
      guestsCount = 1,
      couponCode,
      paymentMethod = 'pix',
      guestNotes,
    } = req.body ?? {};

    if (!listingId || !checkInDate) {
      return res.status(400).json({ error: 'listingId e data de check-in são obrigatórios.' });
    }

    const guests = Math.max(1, Math.min(30, Number(guestsCount) || 1));

    const result = await db.transaction(async (tx) => {
      const listingRows = await tx
        .select({
          listing: listings,
          merchant: merchants,
          plan: merchantPlans,
        })
        .from(listings)
        .innerJoin(merchants, eq(listings.merchantId, merchants.id))
        .innerJoin(merchantPlans, eq(merchants.planId, merchantPlans.id))
        .where(eq(listings.id, Number(listingId)))
        .limit(1);

      if (listingRows.length === 0 || listingRows[0].listing.status !== 'active') {
        throw new Error('LISTING_UNAVAILABLE');
      }

      const { listing, plan } = listingRows[0];
      if (guests > listing.capacity) {
        throw new Error('CAPACITY_EXCEEDED');
      }

      let unitPriceCents = listing.priceCents;

      if (slotId) {
        const slotRows = await tx
          .select()
          .from(availabilitySlots)
          .where(
            and(
              eq(availabilitySlots.id, Number(slotId)),
              eq(availabilitySlots.listingId, listing.id)
            )
          )
          .limit(1);

        if (slotRows.length === 0 || slotRows[0].availableSpots < guests) {
          throw new Error('INSUFFICIENT_SPOTS');
        }

        const slot = slotRows[0];
        if (slot.priceOverrideCents) {
          unitPriceCents = slot.priceOverrideCents;
        }

        const updatedSlots = await tx
          .update(availabilitySlots)
          .set({ availableSpots: sql`${availabilitySlots.availableSpots} - ${guests}` })
          .where(
            and(
              eq(availabilitySlots.id, slot.id),
              gte(availabilitySlots.availableSpots, guests)
            )
          )
          .returning();

        if (updatedSlots.length === 0) {
          throw new Error('INSUFFICIENT_SPOTS');
        }
      }

      // Accommodations calculate nights when checkOutDate is provided; experiences/gastronomy charge per guest
      let units = guests;
      if (listing.moduleType === 'accommodation' && checkOutDate) {
        const d1 = new Date(String(checkInDate));
        const d2 = new Date(String(checkOutDate));
        const diffDays = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000));
        units = diffDays;
      }

      const grossAmountCents = unitPriceCents * units;
      let discountPercent = 0;
      let appliedCouponCode: string | null = null;

      if (typeof couponCode === 'string' && couponCode.trim()) {
        const normalized = couponCode.trim().toUpperCase();
        const updatedCoupons = await tx
          .update(coupons)
          .set({ usedCount: sql`${coupons.usedCount} + 1` })
          .where(
            and(
              eq(coupons.code, normalized),
              eq(coupons.active, true),
              lt(coupons.usedCount, coupons.maxUses)
            )
          )
          .returning();

        if (updatedCoupons.length > 0) {
          discountPercent = updatedCoupons[0].discountPercent;
          appliedCouponCode = updatedCoupons[0].code;
        }
      }

      const split = calculateCommissionSplit({
        grossAmountCents,
        discountPercent,
        commissionBps: plan.commissionBps,
      });

      const bookingCode = `FR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const paymentProvider = process.env.MERCADOPAGO_ACCESS_TOKEN
        ? 'mercadopago'
        : 'mercadopago_sandbox';

      const insertedBooking = await tx
        .insert(bookings)
        .values({
          bookingCode,
          userId: user.id,
          listingId: listing.id,
          slotId: slotId ? Number(slotId) : null,
          checkInDate: String(checkInDate),
          checkOutDate: checkOutDate ? String(checkOutDate) : null,
          guestsCount: guests,
          couponCode: appliedCouponCode,
          grossAmountCents: split.netChargedCents,
          discountCents: split.discountCents,
          commissionCents: split.commissionCents,
          netMerchantCents: split.netMerchantCents,
          currency: listing.currency,
          paymentMethod: ['pix', 'card', 'mercadopago'].includes(paymentMethod)
            ? paymentMethod
            : 'pix',
          paymentProvider,
          status: 'pending_payment',
          guestNotes: typeof guestNotes === 'string' ? guestNotes.slice(0, 400) : null,
        })
        .returning();

      const booking = insertedBooking[0];

      await tx.insert(payments).values({
        bookingId: booking.id,
        provider: paymentProvider,
        externalId: `pending-${bookingCode}`,
        status: 'pending',
        amountCents: booking.grossAmountCents,
        verifiedByServerWebhook: false,
      });

      return { booking, listing };
    });

    let checkoutUrl: string | null = null;
    if (process.env.MERCADOPAGO_ACCESS_TOKEN) {
      try {
        const appUrl = getAppBaseUrl();
        const pref = await createMercadoPagoPreference({
          bookingCode: result.booking.bookingCode,
          title: result.listing.title,
          amountCents: result.booking.grossAmountCents,
          payerEmail: user.email,
          appUrl,
        });
        if (pref) {
          checkoutUrl = pref.init_point;
        }
      } catch (mpErr) {
        console.error('Mercado Pago preference failed:', mpErr);
      }
    }

    await recordAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'BOOKING_CREATED',
      entityType: 'booking',
      entityId: result.booking.bookingCode,
      details: {
        grossAmountCents: result.booking.grossAmountCents,
        commissionCents: result.booking.commissionCents,
      },
    });

    await recordImmutableLedgerEntry({
      operationType: 'booking_charge',
      referenceCode: result.booking.bookingCode,
      category: result.listing.moduleType,
      breakdown: {
        ruleCode: 'MARKETPLACE-BOOKING',
        ruleName: `Reserva ${result.listing.moduleType}`,
        supplierCostCents: result.booking.netMerchantCents,
        platformRemunerationCents: result.booking.commissionCents,
        paymentFeeCents: Math.round((result.booking.grossAmountCents * 399) / 10000),
        taxCents: Math.round((result.booking.commissionCents * 600) / 10000),
        discountCents: result.booking.discountCents,
        finalClientCents: result.booking.grossAmountCents,
        merchantPayoutCents: result.booking.netMerchantCents,
        estimatedMarginCents:
          result.booking.commissionCents -
          Math.round((result.booking.grossAmountCents * 399) / 10000),
      },
      currency: result.booking.currency,
    });

    await db.insert(notifications).values({
      userId: user.id,
      title: `Reserva ${result.booking.bookingCode} registrada`,
      body: `Sua reserva em "${result.listing.title}" aguarda confirmação do pagamento no servidor.`,
      kind: 'booking',
      read: false,
    });

    await dispatchAgentTask({
      department: 'Reservas e Operações',
      triggerType: 'event',
      eventName: 'BOOKING_CREATED',
      title: `Monitorar confirmação de reserva ${result.booking.bookingCode}`,
      input: { bookingCode: result.booking.bookingCode },
    });

    res.status(201).json({
      booking: result.booking,
      checkoutUrl,
      gatewayStatus: getPaymentGatewayStatus(),
      message:
        'Reserva criada com status pending_payment. A confirmação ocorre exclusivamente após validação no servidor.',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'LISTING_UNAVAILABLE') {
      return res.status(404).json({ error: 'Oferta indisponível para reserva.' });
    }
    if (msg === 'CAPACITY_EXCEEDED' || msg === 'INSUFFICIENT_SPOTS') {
      return res.status(409).json({ error: 'Vagas insuficientes para a data e grupo informados.' });
    }
    console.error('POST /bookings error:', error);
    res.status(500).json({ error: 'Falha ao processar reserva.' });
  }
});

// Server-side Webhook endpoint for Mercado Pago (HMAC-SHA256 verified)
apiRouter.post('/webhooks/mercadopago', async (req, res) => {
  try {
    const xSignature = req.header('x-signature');
    const xRequestId = req.header('x-request-id');
    const dataId = String(req.body?.data?.id ?? req.query?.['data.id'] ?? '');
    const externalReference = String(req.body?.external_reference ?? '');

    if (!verifyMercadoPagoWebhookSignature({ xSignatureHeader: xSignature, xRequestIdHeader: xRequestId, dataId })) {
      return res.status(401).json({ error: 'Assinatura de webhook inválida.' });
    }

    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token || !dataId) {
      return res.status(400).json({ error: 'Configuração ou payload de pagamento ausente.' });
    }

    // Verify directly with Mercado Pago API from server
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!mpRes.ok) {
      return res.status(502).json({ error: 'Falha na conciliação junto ao provedor.' });
    }
    const mpPayment = (await mpRes.json()) as {
      status: string;
      external_reference?: string;
      transaction_amount?: number;
    };

    const bookingCode = mpPayment.external_reference || externalReference;
    if (!bookingCode) {
      return res.status(200).json({ received: true });
    }

    const bookingRows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.bookingCode, bookingCode))
      .limit(1);

    if (bookingRows.length > 0 && mpPayment.status === 'approved') {
      const booking = bookingRows[0];
      await db
        .update(bookings)
        .set({ status: 'confirmed', paymentRef: dataId })
        .where(eq(bookings.id, booking.id));

      await db
        .update(payments)
        .set({
          status: 'paid',
          externalId: dataId,
          verifiedByServerWebhook: true,
          webhookEventType: 'mercadopago.payment.approved',
        })
        .where(eq(payments.bookingId, booking.id));

      await recordAuditLog({
        action: 'PAYMENT_CONFIRMED_WEBHOOK',
        entityType: 'booking',
        entityId: booking.bookingCode,
        details: { provider: 'mercadopago', externalId: dataId },
      });
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

// Sandbox / Admin server-side reconciliation trigger (only marks confirmed on server when live Mercado Pago token is not configured)
apiRouter.post('/payments/verify-server', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const { bookingCode } = req.body ?? {};
    if (!bookingCode) {
      return res.status(400).json({ error: 'bookingCode obrigatório.' });
    }

    const rows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.bookingCode, String(bookingCode)))
      .limit(1);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Reserva não encontrada.' });
    }

    const booking = rows[0];
    if (booking.userId !== user.id && user.role !== 'admin') {
      return res.status(403).json({ error: 'Sem permissão para verificar esta reserva.' });
    }

    if (process.env.MERCADOPAGO_ACCESS_TOKEN && user.role !== 'admin') {
      return res.status(400).json({
        error: 'Gateway em produção ativo: confirmação ocorre somente via webhook assinado do provedor.',
      });
    }

    // Só reserva aguardando pagamento pode ser confirmada (cancelada/estornada/já confirmada não volta a "paga").
    if (booking.status !== 'pending_payment') {
      return res.status(409).json({ error: `Reserva não está aguardando pagamento (status atual: ${booking.status}).` });
    }

    const ref = `SBX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const updated = await db
      .update(bookings)
      .set({ status: 'confirmed', paymentRef: ref })
      .where(eq(bookings.id, booking.id))
      .returning();

    await db
      .update(payments)
      .set({
        status: 'paid',
        externalId: ref,
        verifiedByServerWebhook: true,
        webhookEventType: 'server_sandbox_reconciliation',
      })
      .where(eq(payments.bookingId, booking.id));

    await recordAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'PAYMENT_SANDBOX_RECONCILED',
      entityType: 'booking',
      entityId: booking.bookingCode,
      details: { externalRef: ref },
    });

    res.json({ booking: updated[0], verifiedByServer: true });
  } catch (error) {
    console.error('verify-server error:', error);
    res.status(500).json({ error: 'Falha na verificação de pagamento.' });
  }
});

apiRouter.post('/bookings/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const bookingId = Number(req.params.id);
    const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Reserva não encontrada.' });
    }
    const booking = rows[0];
    if (booking.userId !== user.id && user.role !== 'admin') {
      return res.status(403).json({ error: 'Sem permissão.' });
    }
    if (booking.status === 'cancelled' || booking.status === 'refunded') {
      return res.status(400).json({ error: 'Reserva já cancelada.' });
    }

    const newStatus = booking.status === 'confirmed' ? 'refunded' : 'cancelled';
    await db.transaction(async (tx) => {
      await tx.update(bookings).set({ status: newStatus }).where(eq(bookings.id, booking.id));
      await tx
        .update(payments)
        .set({ status: newStatus === 'refunded' ? 'refunded' : 'failed' })
        .where(eq(payments.bookingId, booking.id));
      if (booking.slotId) {
        await tx
          .update(availabilitySlots)
          .set({ availableSpots: sql`${availabilitySlots.availableSpots} + ${booking.guestsCount}` })
          .where(eq(availabilitySlots.id, booking.slotId));
      }
    });

    await recordAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'BOOKING_CANCELLED',
      entityType: 'booking',
      entityId: booking.bookingCode,
      details: { previousStatus: booking.status, newStatus },
    });

    res.json({ status: newStatus, bookingCode: booking.bookingCode });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({ error: 'Falha ao cancelar reserva.' });
  }
});

// ========================
// TOURIST DASHBOARD, FAVORITES, REVIEWS, CONCIERGE
// ========================
apiRouter.get('/tourist/dashboard', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const [userBookings, userFavs, userItineraries, userConcierge] = await Promise.all([
      db
        .select({
          booking: bookings,
          listingTitle: listings.title,
          listingSlug: listings.slug,
          listingImage: listings.coverImage,
          moduleType: listings.moduleType,
        })
        .from(bookings)
        .innerJoin(listings, eq(bookings.listingId, listings.id))
        .where(eq(bookings.userId, user.id))
        .orderBy(desc(bookings.createdAt)),
      db.select().from(favorites).where(eq(favorites.userId, user.id)),
      db
        .select()
        .from(savedItineraries)
        .where(eq(savedItineraries.userId, user.id))
        .orderBy(desc(savedItineraries.createdAt)),
      db
        .select()
        .from(conciergeRequests)
        .where(eq(conciergeRequests.userId, user.id))
        .orderBy(desc(conciergeRequests.createdAt)),
    ]);

    res.json({
      bookings: userBookings,
      favorites: userFavs,
      itineraries: userItineraries,
      conciergeRequests: userConcierge,
    });
  } catch (error) {
    console.error('GET /tourist/dashboard error:', error);
    res.status(500).json({ error: 'Erro ao carregar área do turista.' });
  }
});

apiRouter.post('/favorites/toggle', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const { destinationId, listingId } = req.body ?? {};
    if (!destinationId && !listingId) {
      return res.status(400).json({ error: 'Informe destinationId ou listingId.' });
    }

    const cond = destinationId
      ? and(eq(favorites.userId, user.id), eq(favorites.destinationId, Number(destinationId)))
      : and(eq(favorites.userId, user.id), eq(favorites.listingId, Number(listingId)));

    const existing = await db.select().from(favorites).where(cond).limit(1);
    if (existing.length > 0) {
      await db.delete(favorites).where(eq(favorites.id, existing[0].id));
      return res.json({ saved: false });
    }

    await db.insert(favorites).values({
      userId: user.id,
      destinationId: destinationId ? Number(destinationId) : null,
      listingId: listingId ? Number(listingId) : null,
    });
    res.json({ saved: true });
  } catch (error) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({ error: 'Erro ao atualizar favoritos.' });
  }
});

apiRouter.post('/reviews', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const { destinationId, listingId, rating, comment } = req.body ?? {};
    const numRating = Math.max(1, Math.min(5, Number(rating) || 5));
    const cleanComment = String(comment ?? '').trim().slice(0, 800);
    if (!cleanComment) {
      return res.status(400).json({ error: 'Escreva um comentário para publicar a avaliação.' });
    }

    const inserted = await db
      .insert(reviews)
      .values({
        userId: user.id,
        destinationId: destinationId ? Number(destinationId) : null,
        listingId: listingId ? Number(listingId) : null,
        rating: numRating,
        comment: cleanComment,
      })
      .returning();

    res.status(201).json({ review: inserted[0] });
  } catch (error) {
    console.error('POST /reviews error:', error);
    res.status(500).json({ error: 'Erro ao salvar avaliação.' });
  }
});

apiRouter.post('/concierge', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const {
      originCity,
      destinationPref,
      startDate,
      endDate,
      travelersCount,
      budgetBrl,
      tripStyle,
      notes,
    } = req.body ?? {};

    if (!originCity || !destinationPref || !startDate || !endDate || !budgetBrl) {
      return res.status(400).json({ error: 'Preencha origem, destino, datas e orçamento.' });
    }

    const requestCode = `CON-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const inserted = await db
      .insert(conciergeRequests)
      .values({
        requestCode,
        userId: user.id,
        originCity: String(originCity).slice(0, 120),
        destinationPref: String(destinationPref).slice(0, 160),
        startDate: String(startDate),
        endDate: String(endDate),
        travelersCount: Math.max(1, Math.min(30, Number(travelersCount) || 2)),
        budgetCents: Math.max(50000, Math.round(Number(budgetBrl) * 100)),
        tripStyle: String(tripStyle || 'Personalizado').slice(0, 80),
        notes: String(notes || '').slice(0, 1200),
        status: 'new',
      })
      .returning();

    await recordAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'CONCIERGE_REQUEST_CREATED',
      entityType: 'concierge_request',
      entityId: requestCode,
    });

    res.status(201).json({ request: inserted[0] });
  } catch (error) {
    console.error('POST /concierge error:', error);
    res.status(500).json({ error: 'Erro ao enviar solicitação de concierge.' });
  }
});

// ========================
// TRAVEL & FLIGHTS (MÓDULO 5)
// ========================
apiRouter.get('/travel/status', (_req, res) => {
  res.json({
    integrations: getTravelIntegrationsStatus(),
    payments: getPaymentGatewayStatus(),
  });
});

apiRouter.post('/travel/search', rateLimit(20, 60000), async (req, res) => {
  try {
    const {
      originIata,
      destinationIata,
      departureDate,
      returnDate,
      tripType = 'one_way',
      adults = 1,
      maxPriceBrl,
      madrugadaOnly = false,
    } = req.body ?? {};
    if (!originIata || !destinationIata || !departureDate) {
      return res.status(400).json({ error: 'Informe código IATA de origem, destino e data.' });
    }
    const result = await searchLiveFlightsIfConfigured({
      originIata: String(originIata),
      destinationIata: String(destinationIata),
      departureDate: String(departureDate),
      returnDate: returnDate ? String(returnDate) : undefined,
      tripType: ['one_way', 'round_trip', 'multi_city'].includes(tripType) ? tripType : 'one_way',
      adults: Number(adults) || 1,
      maxPriceBrl: maxPriceBrl ? Number(maxPriceBrl) : undefined,
      madrugadaOnly: Boolean(madrugadaOnly),
    });
    res.json(result);
  } catch (error) {
    console.error('POST /travel/search error:', error);
    res.status(502).json({ error: 'Erro ao consultar provedor de passagens aéreas.' });
  }
});

// ========================
// FROC ROTA AI (MÓDULO IA)
// ========================
apiRouter.post('/ai/chat', optionalAuth, rateLimit(15, 60000), async (req: AuthRequest, res) => {
  try {
    const { query, language = 'pt', budgetBrl, travelers, locationContext, saveItinerary } = req.body ?? {};
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'Digite sua pergunta para a Froc Rota AI.' });
    }

    const lang = ['pt', 'en', 'es'].includes(language) ? (language as 'pt' | 'en' | 'es') : 'pt';
    const result = await askFrocRotaAI({
      query: query.trim().slice(0, 1000),
      language: lang,
      budgetBrl: budgetBrl ? Number(budgetBrl) : undefined,
      travelers: travelers ? Number(travelers) : undefined,
      locationContext: typeof locationContext === 'string' ? locationContext : undefined,
    });

    if (saveItinerary && req.dbUser && result.suggestedItinerary.length > 0) {
      await db.insert(savedItineraries).values({
        userId: req.dbUser.id,
        title: query.trim().slice(0, 90),
        destinationSlug: result.recommendedDestinations[0]?.slug ?? null,
        budgetCents: budgetBrl ? Math.round(Number(budgetBrl) * 100) : 0,
        daysCount: result.suggestedItinerary.length,
        contentJson: result as unknown as Record<string, unknown>,
      });
    }

    res.json(result);
  } catch (error: unknown) {
    console.error('POST /ai/chat error:', error);
    const message = error instanceof Error ? error.message : 'Erro ao consultar Froc Rota AI.';
    res.status(500).json({ error: message });
  }
});

// ========================
// MERCHANT & PARTNER PORTAL
// ========================
apiRouter.get('/plans', async (_req, res) => {
  try {
    const plans = await db
      .select()
      .from(merchantPlans)
      .where(eq(merchantPlans.active, true))
      .orderBy(merchantPlans.monthlyPriceCents);
    res.json({ plans });
  } catch (error) {
    console.error('GET /plans error:', error);
    res.status(500).json({ error: 'Erro ao carregar planos comerciais.' });
  }
});

apiRouter.post('/merchant/onboard', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
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
    } = req.body ?? {};

    if (!companyName || !tradeName || !documentNumber || !category || !city || !state || !phone) {
      return res.status(400).json({ error: 'Preencha todos os dados empresariais obrigatórios.' });
    }

    const existing = await db
      .select()
      .from(merchants)
      .where(eq(merchants.userId, user.id))
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Esta conta já possui um cadastro comercial ativo.' });
    }

    const planRows = await db
      .select()
      .from(merchantPlans)
      .where(eq(merchantPlans.slug, String(planSlug)))
      .limit(1);
    const plan = planRows[0] ?? (await db.select().from(merchantPlans).limit(1))[0];

    const riskLevel =
      category === 'nautical' || category === 'adventure' ? 'high_risk_nautical' : 'standard';

    const inserted = await db
      .insert(merchants)
      .values({
        userId: user.id,
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
      })
      .returning();

    if (user.role === 'tourist') {
      await db.update(users).set({ role: 'merchant' }).where(eq(users.id, user.id));
    }

    await recordAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'MERCHANT_ONBOARDED',
      entityType: 'merchant',
      entityId: inserted[0].id,
      details: { tradeName, planSlug: plan.slug, riskLevel },
    });

    res.status(201).json({ merchant: inserted[0] });
  } catch (error) {
    console.error('POST /merchant/onboard error:', error);
    res.status(500).json({ error: 'Erro ao cadastrar parceiro.' });
  }
});

apiRouter.get('/merchant/dashboard', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const mRows = await db
      .select({
        merchant: merchants,
        plan: merchantPlans,
      })
      .from(merchants)
      .innerJoin(merchantPlans, eq(merchants.planId, merchantPlans.id))
      .where(eq(merchants.userId, user.id))
      .limit(1);

    if (mRows.length === 0) {
      return res.json({ merchant: null, plan: null, listings: [], bookings: [], reviews: [] });
    }

    const { merchant, plan } = mRows[0];
    const mListings = await db
      .select()
      .from(listings)
      .where(eq(listings.merchantId, merchant.id))
      .orderBy(desc(listings.createdAt));

    const listingIds = mListings.map((l) => l.id);
    let mBookings: Array<{
      booking: typeof bookings.$inferSelect;
      listingTitle: string;
      touristName: string;
      touristEmail: string;
    }> = [];
    let mReviews: Array<{
      review: typeof reviews.$inferSelect;
      authorName: string;
      listingTitle: string;
    }> = [];

    if (listingIds.length > 0) {
      const allBookings = await db
        .select({
          booking: bookings,
          listingTitle: listings.title,
          merchantId: listings.merchantId,
          touristName: users.name,
          touristEmail: users.email,
        })
        .from(bookings)
        .innerJoin(listings, eq(bookings.listingId, listings.id))
        .innerJoin(users, eq(bookings.userId, users.id))
        .where(eq(listings.merchantId, merchant.id))
        .orderBy(desc(bookings.createdAt));

      mBookings = allBookings.map(({ booking, listingTitle, touristName, touristEmail }) => ({
        booking,
        listingTitle,
        touristName,
        touristEmail,
      }));

      const allReviews = await db
        .select({
          review: reviews,
          authorName: users.name,
          listingTitle: listings.title,
        })
        .from(reviews)
        .innerJoin(listings, eq(reviews.listingId, listings.id))
        .innerJoin(users, eq(reviews.userId, users.id))
        .where(eq(listings.merchantId, merchant.id))
        .orderBy(desc(reviews.createdAt));

      mReviews = allReviews;
    }

    res.json({
      merchant,
      plan,
      listings: mListings,
      bookings: mBookings,
      reviews: mReviews,
    });
  } catch (error) {
    console.error('GET /merchant/dashboard error:', error);
    res.status(500).json({ error: 'Erro ao carregar painel do comerciante.' });
  }
});

apiRouter.post('/merchant/listings', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const mRows = await db
      .select({ merchant: merchants, plan: merchantPlans })
      .from(merchants)
      .innerJoin(merchantPlans, eq(merchants.planId, merchantPlans.id))
      .where(eq(merchants.userId, user.id))
      .limit(1);

    if (mRows.length === 0) {
      return res.status(403).json({ error: 'Complete o cadastro de parceiro primeiro.' });
    }
    const { merchant, plan } = mRows[0];

    const existingListings = await db
      .select()
      .from(listings)
      .where(eq(listings.merchantId, merchant.id));
    if (existingListings.length >= plan.maxListings) {
      return res.status(403).json({
        error: `Limite de ${plan.maxListings} anúncios atingido para o plano ${plan.name}.`,
      });
    }

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
    } = req.body ?? {};

    if (!destinationId || !moduleType || !title || !priceBrl || !address) {
      return res.status(400).json({ error: 'Dados obrigatórios do anúncio ausentes.' });
    }

    const destRows = await db
      .select()
      .from(destinations)
      .where(eq(destinations.id, Number(destinationId)))
      .limit(1);
    if (destRows.length === 0) {
      return res.status(404).json({ error: 'Destino inválido.' });
    }
    const dest = destRows[0];

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

    const inserted = await db
      .insert(listings)
      .values({
        merchantId: merchant.id,
        destinationId: dest.id,
        moduleType: ['experience', 'gastronomy', 'accommodation'].includes(moduleType)
          ? moduleType
          : 'experience',
        subtype: String(subtype || 'passeio').slice(0, 40),
        title: String(title).slice(0, 140),
        slug,
        summary: String(summary || title).slice(0, 240),
        description: String(description || summary || title).slice(0, 2000),
        priceCents: Math.max(1000, Math.round(Number(priceBrl) * 100)),
        currency: 'BRL',
        capacity: Math.max(1, Math.min(200, Number(capacity) || 8)),
        durationOrCheckin: String(durationOrCheckin || '3 horas').slice(0, 60),
        address: String(address).slice(0, 200),
        lat: dest.lat + (Math.random() - 0.5) * 0.02,
        lng: dest.lng + (Math.random() - 0.5) * 0.02,
        amenitiesJson: Array.isArray(amenities) ? amenities.map(String).slice(0, 12) : [],
        menuOrScheduleJson: [],
        cancellationPolicy: String(
          cancellationPolicy || 'Cancelamento gratuito até 48h antes da data agendada.'
        ).slice(0, 300),
        coverImage: safeCover,
        status: merchant.verificationStatus === 'verified' ? 'active' : 'pending',
      })
      .returning();

    // Seed 3 initial slots for the new listing
    const today = new Date();
    const slotValues = [1, 3, 5].map((offset) => ({
      listingId: inserted[0].id,
      date: new Date(today.getTime() + offset * 86400000).toISOString().slice(0, 10),
      timeSlot: moduleType === 'accommodation' ? 'Diária' : '09:30',
      totalSpots: inserted[0].capacity,
      availableSpots: inserted[0].capacity,
    }));
    await db.insert(availabilitySlots).values(slotValues);

    await recordAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'LISTING_CREATED',
      entityType: 'listing',
      entityId: inserted[0].id,
      details: { title: inserted[0].title, status: inserted[0].status },
    });

    res.status(201).json({ listing: inserted[0] });
  } catch (error) {
    console.error('POST /merchant/listings error:', error);
    res.status(500).json({ error: 'Erro ao criar anúncio.' });
  }
});

apiRouter.post('/merchant/reviews/:id/reply', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const reviewId = Number(req.params.id);
    const replyText = String(req.body?.reply ?? '').trim().slice(0, 500);
    if (!replyText) {
      return res.status(400).json({ error: 'Digite uma resposta.' });
    }

    const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
    if (mRows.length === 0) {
      return res.status(403).json({ error: 'Acesso restrito a parceiros.' });
    }

    const revRows = await db
      .select({ review: reviews, listingMerchantId: listings.merchantId })
      .from(reviews)
      .innerJoin(listings, eq(reviews.listingId, listings.id))
      .where(eq(reviews.id, reviewId))
      .limit(1);

    if (revRows.length === 0 || revRows[0].listingMerchantId !== mRows[0].id) {
      return res.status(403).json({ error: 'Sem permissão para responder esta avaliação.' });
    }

    const updated = await db
      .update(reviews)
      .set({ merchantReply: replyText })
      .where(eq(reviews.id, reviewId))
      .returning();

    res.json({ review: updated[0] });
  } catch (error) {
    console.error('Reply review error:', error);
    res.status(500).json({ error: 'Erro ao responder avaliação.' });
  }
});

// ========================
// REPORTS (MODERATION)
// ========================
apiRouter.post('/reports', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const { targetType, targetId, reason } = req.body ?? {};
    if (!targetType || !targetId || !reason) {
      return res.status(400).json({ error: 'Dados da denúncia incompletos.' });
    }
    const inserted = await db
      .insert(reports)
      .values({
        userId: user.id,
        targetType: String(targetType),
        targetId: Number(targetId),
        reason: String(reason).slice(0, 500),
      })
      .returning();
    res.status(201).json({ report: inserted[0] });
  } catch (error) {
    console.error('POST /reports error:', error);
    res.status(500).json({ error: 'Erro ao registrar denúncia.' });
  }
});

// ========================
// ADMIN MASTER PANEL (PROTECTED RBAC)
// ========================
apiRouter.get(
  '/admin/overview',
  requireAuth,
  requireAdmin,
  requireAdminPermission('overview'),
  async (_req, res) => {
    try {
      const [
        allUsers,
        allMerchants,
        allPlans,
        allDestinations,
        allListings,
        allBookings,
        allCoupons,
        allConcierge,
        allReports,
        recentAudit,
        allPosts,
        allCampaigns,
        allAgents,
      ] = await Promise.all([
        db.select().from(users).orderBy(desc(users.createdAt)).limit(50),
        db.select().from(merchants).orderBy(desc(merchants.createdAt)),
        db.select().from(merchantPlans).orderBy(merchantPlans.monthlyPriceCents),
        db.select().from(destinations).orderBy(destinations.name),
        db.select().from(listings).orderBy(desc(listings.createdAt)),
        db.select().from(bookings).orderBy(desc(bookings.createdAt)).limit(50),
        db.select().from(coupons).orderBy(desc(coupons.createdAt)),
        db.select().from(conciergeRequests).orderBy(desc(conciergeRequests.createdAt)),
        db.select().from(reports).orderBy(desc(reports.createdAt)),
        db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(40),
        db.select().from(editorialPosts).orderBy(desc(editorialPosts.createdAt)).limit(30),
        db.select().from(marketingCampaigns).orderBy(desc(marketingCampaigns.createdAt)).limit(30),
        db.select().from(aiAgents),
      ]);

      const confirmedBookings = allBookings.filter((b) => b.status === 'confirmed');
      const cancelledBookings = allBookings.filter(
        (b) => b.status === 'cancelled' || b.status === 'refunded'
      );
      const gmvCents = confirmedBookings.reduce((acc, b) => acc + b.grossAmountCents, 0);
      const commissionRevenueCents = confirmedBookings.reduce(
        (acc, b) => acc + b.commissionCents,
        0
      );

      res.json({
        metrics: {
          usersCount: allUsers.length,
          touristsCount: allUsers.filter((u) => u.role === 'tourist').length,
          merchantsCount: allMerchants.length,
          activeMerchantsCount: allMerchants.filter((m) => m.verificationStatus === 'verified')
            .length,
          destinationsCount: allDestinations.length,
          listingsCount: allListings.length,
          activeListingsCount: allListings.filter((l) => l.status === 'active').length,
          bookingsCount: allBookings.length,
          confirmedBookingsCount: confirmedBookings.length,
          cancelledBookingsCount: cancelledBookings.length,
          gmvCents,
          commissionRevenueCents,
          editorialPostsCount: allPosts.length,
          campaignsCount: allCampaigns.length,
          agentsCount: allAgents.length,
        },
        users: allUsers,
        merchants: allMerchants,
        plans: allPlans,
        destinations: allDestinations,
        listings: allListings,
        bookings: allBookings,
        coupons: allCoupons,
        conciergeRequests: allConcierge,
        reports: allReports,
        auditLogs: recentAudit,
        integrations: {
          travel: getTravelIntegrationsStatus(),
          payments: getPaymentGatewayStatus(),
          ai: {
            configured: Boolean(
              process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
            ),
          },
        },
      });
    } catch (error) {
      console.error('GET /admin/overview error:', error);
      res.status(500).json({ error: 'Erro ao carregar painel administrativo.' });
    }
  }
);

apiRouter.patch('/admin/merchants/:id/verify', requireAuth, requireAdmin, requireAdminPermission('merchants'), async (req: AuthRequest, res) => {
  try {
    const merchantId = Number(req.params.id);
    const { status } = req.body ?? {};
    if (!['verified', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido.' });
    }
    const updated = await db
      .update(merchants)
      .set({ verificationStatus: status })
      .where(eq(merchants.id, merchantId))
      .returning();

    if (status === 'verified') {
      await db
        .update(listings)
        .set({ status: 'active' })
        .where(and(eq(listings.merchantId, merchantId), eq(listings.status, 'pending')));
    }

    await recordAuditLog({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      action: 'ADMIN_MERCHANT_VERIFICATION',
      entityType: 'merchant',
      entityId: merchantId,
      details: { status },
    });

    res.json({ merchant: updated[0] });
  } catch (error) {
    console.error('Admin verify merchant error:', error);
    res.status(500).json({ error: 'Erro ao atualizar verificação do fornecedor.' });
  }
});

apiRouter.patch('/admin/plans/:id', requireAuth, requireAdmin, requireAdminPermission('finance'), async (req: AuthRequest, res) => {
  try {
    const planId = Number(req.params.id);
    const { monthlyPriceCents, commissionBps, maxListings } = req.body ?? {};
    const updated = await db
      .update(merchantPlans)
      .set({
        monthlyPriceCents: Math.max(0, Number(monthlyPriceCents) || 0),
        commissionBps: Math.max(100, Math.min(4000, Number(commissionBps) || 1200)),
        maxListings: Math.max(1, Number(maxListings) || 3),
      })
      .where(eq(merchantPlans.id, planId))
      .returning();

    await recordAuditLog({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      action: 'ADMIN_PLAN_UPDATED',
      entityType: 'merchant_plan',
      entityId: planId,
      details: { monthlyPriceCents, commissionBps, maxListings },
    });

    res.json({ plan: updated[0] });
  } catch (error) {
    console.error('Admin update plan error:', error);
    res.status(500).json({ error: 'Erro ao atualizar plano.' });
  }
});

apiRouter.post('/admin/coupons', requireAuth, requireAdmin, requireAdminPermission('merchants'), async (req: AuthRequest, res) => {
  try {
    const { code, discountPercent, maxUses = 100 } = req.body ?? {};
    const cleanCode = String(code ?? '').trim().toUpperCase();
    if (!cleanCode) {
      return res.status(400).json({ error: 'Código obrigatório.' });
    }
    const inserted = await db
      .insert(coupons)
      .values({
        code: cleanCode,
        discountPercent: Math.max(1, Math.min(70, Number(discountPercent) || 10)),
        maxUses: Math.max(1, Number(maxUses) || 100),
        active: true,
      })
      .returning();

    await recordAuditLog({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      action: 'ADMIN_COUPON_CREATED',
      entityType: 'coupon',
      entityId: cleanCode,
    });

    res.status(201).json({ coupon: inserted[0] });
  } catch (error) {
    console.error('Admin coupon error:', error);
    res.status(500).json({ error: 'Erro ao criar cupom.' });
  }
});

apiRouter.patch('/admin/concierge/:id', requireAuth, requireAdmin, requireAdminPermission('overview'), async (req: AuthRequest, res) => {
  try {
    const reqId = Number(req.params.id);
    const { status, proposalSummary, proposalAmountBrl } = req.body ?? {};
    const updated = await db
      .update(conciergeRequests)
      .set({
        status: String(status || 'proposal_sent'),
        proposalSummary: proposalSummary ? String(proposalSummary).slice(0, 1500) : null,
        proposalAmountCents: proposalAmountBrl ? Math.round(Number(proposalAmountBrl) * 100) : null,
      })
      .where(eq(conciergeRequests.id, reqId))
      .returning();

    await recordAuditLog({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      action: 'ADMIN_CONCIERGE_PROPOSAL',
      entityType: 'concierge_request',
      entityId: reqId,
      details: { status, proposalAmountBrl },
    });

    res.json({ request: updated[0] });
  } catch (error) {
    console.error('Admin concierge update error:', error);
    res.status(500).json({ error: 'Erro ao atualizar proposta concierge.' });
  }
});

apiRouter.patch('/admin/reports/:id', requireAuth, requireAdmin, requireAdminPermission('overview'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const status = ['resolved', 'dismissed', 'open'].includes(req.body?.status)
      ? req.body.status
      : 'resolved';
    const updated = await db
      .update(reports)
      .set({ status })
      .where(eq(reports.id, id))
      .returning();

    await recordAuditLog({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      action: 'ADMIN_REPORT_UPDATED',
      entityType: 'report',
      entityId: id,
      details: { status },
    });
    res.json({ report: updated[0] });
  } catch (error) {
    console.error('Admin report update error:', error);
    res.status(500).json({ error: 'Erro ao atualizar denúncia.' });
  }
});

apiRouter.use(expansionRouter);
