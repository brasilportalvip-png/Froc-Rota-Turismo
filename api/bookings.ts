import crypto from 'node:crypto';
import { adminDb } from './_lib/firebase-admin.ts';
import { dispatchAgentTask } from './_lib/agents.ts';
import { recordAuditLog } from './_lib/audit.ts';
import { authenticateRequest } from './_lib/auth.ts';
import { nextSeqId } from './_lib/firestore-helpers.ts';
import {
  ApiRequest,
  ApiResponse,
  checkRateLimit,
  enforceApiSecurity,
  getRoutePath,
  parseJsonBody,
  sendJson,
} from './_lib/http.ts';
import { getAppBaseUrl } from './_lib/oauth.ts';
import {
  calculateCommissionSplit,
  createMercadoPagoPreference,
  getPaymentGatewayStatus,
} from './_lib/payment.ts';
import { recordImmutableLedgerEntry } from './_lib/pricing.ts';
import { ensureSeeded } from './_lib/seed.ts';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!enforceApiSecurity(req, res)) return;
  if (!checkRateLimit(req, res, 'bookings:api', 60, 60000)) return;
  try {
    await ensureSeeded();
  } catch (err) {
    console.error('Seed error:', err);
    sendJson(res, 503, { error: 'Serviço temporariamente indisponível ao inicializar dados.' });
    return;
  }

  const route = getRoutePath(req);
  const cancelMatch = route.match(/^\/bookings\/(\d+)\/cancel$/);

  if (req.method === 'POST' && cancelMatch) {
    const auth = await authenticateRequest(req, res);
    if (!auth) return;
    const bookingId = Number(cancelMatch[1]);

    try {
      const bookingRef = adminDb.collection('bookings').doc(String(bookingId));
      const snap = await bookingRef.get();
      if (!snap.exists) {
        sendJson(res, 404, { error: 'Reserva não encontrada.' });
        return;
      }

      const booking = snap.data() as {
        id: number;
        bookingCode: string;
        userId: number;
        slotId?: number | null;
        guestsCount: number;
        status: string;
      };

      const isAdmin =
        auth.authUser.email_verified === true &&
        (auth.dbUser.role === 'admin' || auth.dbUser.role === 'subadmin');
      if (booking.userId !== auth.dbUser.id && !isAdmin) {
        sendJson(res, 403, { error: 'Sem permissão.' });
        return;
      }

      if (booking.status === 'cancelled' || booking.status === 'refunded') {
        sendJson(res, 400, { error: 'Reserva já cancelada.' });
        return;
      }

      const newStatus = booking.status === 'confirmed' ? 'refunded' : 'cancelled';
      await adminDb.runTransaction(async (tx) => {
        tx.update(bookingRef, { status: newStatus, updatedAt: new Date().toISOString() });
        tx.set(
          adminDb.collection('payments').doc(String(booking.id)),
          { status: newStatus === 'refunded' ? 'refunded' : 'failed' },
          { merge: true }
        );
        if (booking.slotId) {
          const slotRef = adminDb.collection('availability_slots').doc(String(booking.slotId));
          const slotSnap = await tx.get(slotRef);
          if (slotSnap.exists) {
            const currentSpots = Number(slotSnap.data()?.availableSpots ?? 0);
            tx.update(slotRef, { availableSpots: currentSpots + booking.guestsCount });
          }
        }
      });

      await recordAuditLog({
        actorUserId: auth.dbUser.id,
        actorEmail: auth.dbUser.email,
        action: 'BOOKING_CANCELLED',
        entityType: 'booking',
        entityId: booking.bookingCode,
        details: { previousStatus: booking.status, newStatus },
      });

      sendJson(res, 200, { status: newStatus, bookingCode: booking.bookingCode });
    } catch (error) {
      console.error('Cancel booking error:', error);
      sendJson(res, 500, { error: 'Falha ao cancelar reserva.' });
    }
    return;
  }

  if (req.method === 'POST' && (route === '/bookings' || route === '/')) {
    if (!checkRateLimit(req, res, 'bookings:create', 20, 60000)) return;
    const auth = await authenticateRequest(req, res);
    if (!auth) return;
    const user = auth.dbUser;

    try {
      const body = await parseJsonBody<{
        listingId?: number;
        slotId?: number | null;
        checkInDate?: string;
        checkOutDate?: string | null;
        guestsCount?: number;
        couponCode?: string | null;
        paymentMethod?: string;
        guestNotes?: string;
      }>(req);

      const {
        listingId,
        slotId,
        checkInDate,
        checkOutDate,
        guestsCount = 1,
        couponCode,
        paymentMethod = 'pix',
        guestNotes,
      } = body;

      if (!listingId || !checkInDate) {
        sendJson(res, 400, { error: 'listingId e data de check-in são obrigatórios.' });
        return;
      }

      const guests = Math.max(1, Math.min(30, Number(guestsCount) || 1));
      const newBookingId = await nextSeqId('bookings');

      const result = await adminDb.runTransaction(async (tx) => {
        const listingRef = adminDb.collection('listings').doc(String(Number(listingId)));
        const listingSnap = await tx.get(listingRef);
        if (!listingSnap.exists) {
          throw new Error('LISTING_UNAVAILABLE');
        }
        const listing = listingSnap.data() as {
          id: number;
          merchantId: number;
          title: string;
          moduleType: string;
          priceCents: number;
          currency: string;
          capacity: number;
          status: string;
        };
        if (listing.status !== 'active') {
          throw new Error('LISTING_UNAVAILABLE');
        }
        if (guests > listing.capacity) {
          throw new Error('CAPACITY_EXCEEDED');
        }

        const merchantRef = adminDb.collection('merchants').doc(String(listing.merchantId));
        const merchantSnap = await tx.get(merchantRef);
        if (!merchantSnap.exists) {
          throw new Error('LISTING_UNAVAILABLE');
        }
        const merchant = merchantSnap.data() as { id: number; planId: number };

        const planRef = adminDb.collection('merchant_plans').doc(String(merchant.planId));
        const planSnap = await tx.get(planRef);
        const plan = planSnap.exists
          ? (planSnap.data() as { commissionBps: number })
          : { commissionBps: 1800 };

        let unitPriceCents = listing.priceCents;

        if (slotId) {
          const slotRef = adminDb.collection('availability_slots').doc(String(Number(slotId)));
          const slotSnap = await tx.get(slotRef);
          if (!slotSnap.exists) {
            throw new Error('INSUFFICIENT_SPOTS');
          }
          const slot = slotSnap.data() as {
            id: number;
            listingId: number;
            availableSpots: number;
            priceOverrideCents?: number | null;
          };
          if (slot.listingId !== listing.id || slot.availableSpots < guests) {
            throw new Error('INSUFFICIENT_SPOTS');
          }
          if (slot.priceOverrideCents) {
            unitPriceCents = slot.priceOverrideCents;
          }
          tx.update(slotRef, { availableSpots: slot.availableSpots - guests });
        }

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
          const couponRef = adminDb.collection('coupons').doc(normalized);
          const couponSnap = await tx.get(couponRef);
          if (couponSnap.exists) {
            const c = couponSnap.data() as {
              code: string;
              discountPercent: number;
              usedCount: number;
              maxUses: number;
              active: boolean;
            };
            if (c.active && c.usedCount < c.maxUses) {
              discountPercent = c.discountPercent;
              appliedCouponCode = c.code;
              tx.update(couponRef, { usedCount: c.usedCount + 1 });
            }
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
          : 'mercadopago_awaiting_credentials';
        const nowIso = new Date().toISOString();

        const bookingRecord = {
          id: newBookingId,
          bookingCode,
          userId: user.id,
          userUid: user.uid,
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
          currency: listing.currency || 'BRL',
          paymentMethod: ['pix', 'card', 'mercadopago'].includes(paymentMethod)
            ? paymentMethod
            : 'pix',
          paymentProvider,
          paymentRef: null,
          status: 'pending_payment' as const,
          guestNotes: typeof guestNotes === 'string' ? guestNotes.slice(0, 400) : null,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        tx.set(adminDb.collection('bookings').doc(String(newBookingId)), bookingRecord);
        tx.set(adminDb.collection('payments').doc(String(newBookingId)), {
          id: newBookingId,
          bookingId: newBookingId,
          bookingCode,
          provider: paymentProvider,
          externalId: `pending-${bookingCode}`,
          status: 'pending',
          amountCents: bookingRecord.grossAmountCents,
          verifiedByServerWebhook: false,
          webhookEventType: null,
          createdAt: nowIso,
        });

        return { booking: bookingRecord, listing };
      });

      let checkoutUrl: string | null = null;
      if (process.env.MERCADOPAGO_ACCESS_TOKEN) {
        try {
          const pref = await createMercadoPagoPreference({
            bookingCode: result.booking.bookingCode,
            title: result.listing.title,
            amountCents: result.booking.grossAmountCents,
            payerEmail: user.email,
            appUrl: getAppBaseUrl(),
          });
          if (pref) checkoutUrl = pref.init_point;
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

      const notifId = await nextSeqId('notifications');
      await adminDb.collection('notifications').doc(String(notifId)).set({
        id: notifId,
        userId: user.uid,
        numericUserId: user.id,
        title: `Reserva ${result.booking.bookingCode} registrada`,
        body: `Sua reserva em "${result.listing.title}" aguarda confirmação de pagamento via Mercado Pago.`,
        kind: 'booking',
        category: 'booking',
        read: false,
        createdAt: new Date().toISOString(),
      });

      await dispatchAgentTask({
        department: 'Reservas e Operações',
        triggerType: 'event',
        eventName: 'BOOKING_CREATED',
        title: `Monitorar confirmação de reserva ${result.booking.bookingCode}`,
        input: { bookingCode: result.booking.bookingCode },
      });

      sendJson(res, 201, {
        booking: result.booking,
        checkoutUrl,
        gatewayStatus: getPaymentGatewayStatus(),
        message:
          'Reserva criada com status pending_payment. A confirmação ocorre exclusivamente após aprovação do Mercado Pago via webhook assinado.',
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '';
      if (msg === 'LISTING_UNAVAILABLE') {
        sendJson(res, 404, { error: 'Oferta indisponível para reserva.' });
        return;
      }
      if (msg === 'CAPACITY_EXCEEDED' || msg === 'INSUFFICIENT_SPOTS') {
        sendJson(res, 409, { error: 'Vagas insuficientes para a data e grupo informados.' });
        return;
      }
      console.error('POST /api/bookings error:', error);
      sendJson(res, 500, { error: 'Falha ao processar reserva.' });
    }
    return;
  }

  sendJson(res, 404, { error: 'Rota de reserva não encontrada.' });
}
