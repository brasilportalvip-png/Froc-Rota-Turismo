import crypto from 'node:crypto';
import { lanceComissaoBps } from './_lib/leilao.js';
import { adminDb } from './_lib/firebase-admin.js';
import { dispatchAgentTask } from './_lib/agents.js';
import { recordAuditLog } from './_lib/audit.js';
import { authenticateRequest, hasAdminPermission } from './_lib/auth.js';
import { nextSeqId } from './_lib/firestore-helpers.js';
import { isIdentityApproved } from './_lib/identity.js';
import { getSellerAccessToken } from './_lib/mp-marketplace.js';
import {
  ApiRequest,
  ApiResponse,
  checkRateLimit,
  enforceApiSecurity,
  getRoutePath,
  parseJsonBody,
  sendJson,
} from './_lib/http.js';
import { getAppBaseUrl } from './_lib/oauth.js';
import {
  calculateCommissionSplit,
  createMercadoPagoPreference,
  PRAZO_PAGAMENTO_MIN,
  refundMercadoPagoPayment,
} from './_lib/payment.js';
import { merchantBlockers, type MerchantLike } from './_lib/merchant-status.js';
import { BookingDoc, lerVaga, liberarReservasVencidas, validarDatas } from './_lib/reservas.js';
import { recordImmutableLedgerEntry } from './_lib/pricing.js';
import { ensureSeeded } from './_lib/seed.js';

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

      const booking = snap.data() as BookingDoc;

      const isAdmin =
        auth.authUser.email_verified === true &&
        (auth.dbUser.role === 'admin' || auth.dbUser.role === 'subadmin') &&
        hasAdminPermission(auth.adminPermissions ?? [], 'finance');
      if (booking.userId !== auth.dbUser.id && !isAdmin) {
        sendJson(res, 403, { error: 'Sem permissão.' });
        return;
      }

      if (['cancelled', 'refunded', 'expired', 'refund_requested'].includes(booking.status)) {
        sendJson(res, 400, { error: 'Esta reserva já foi cancelada.' });
        return;
      }

      // Reserva paga: devolve o dinheiro no Mercado Pago ANTES de marcar como reembolsada.
      let newStatus: 'cancelled' | 'refunded' | 'refund_requested' = 'cancelled';
      if (booking.status === 'confirmed') {
        const merchantId = booking.merchantId ?? Number((await adminDb.collection('listings').doc(String(booking.listingId)).get()).data()?.merchantId);
        const sellerToken = Number.isFinite(merchantId) ? await getSellerAccessToken(Number(merchantId)) : null;
        const devolvido =
          booking.paymentRef && sellerToken ? await refundMercadoPagoPayment(String(booking.paymentRef), sellerToken) : false;
        newStatus = devolvido ? 'refunded' : 'refund_requested';
      }
      const nowIso = new Date().toISOString();
      await adminDb.runTransaction(async (tx) => {
        // Firestore: todas as leituras antes das escritas.
        const vaga = await lerVaga(tx, booking.slotId);
        tx.update(bookingRef, { status: newStatus, updatedAt: nowIso, cancelledByUid: auth.dbUser.uid });
        tx.set(
          adminDb.collection('payments').doc(String(booking.id)),
          { status: newStatus === 'refunded' ? 'refunded' : newStatus === 'refund_requested' ? 'refund_pending' : 'cancelled', updatedAt: nowIso },
          { merge: true }
        );
        if (vaga) tx.update(vaga.ref, { availableSpots: vaga.disponiveis + Number(booking.guestsCount || 0) });
      });
      if (newStatus === 'refunded') {
        await recordImmutableLedgerEntry({
          operationType: 'refund',
          referenceCode: `${booking.bookingCode}-REEMBOLSO`,
          category: 'bookings',
          breakdown: {
            ruleCode: 'MARKETPLACE-REFUND',
            ruleName: 'Reembolso de reserva',
            supplierCostCents: 0,
            platformRemunerationCents: 0,
            paymentFeeCents: 0,
            taxCents: 0,
            discountCents: 0,
            finalClientCents: -Number(booking.grossAmountCents || 0),
            merchantPayoutCents: 0,
            estimatedMarginCents: 0,
          },
        }).catch(() => undefined);
      }
      if (newStatus === 'refund_requested') {
        await dispatchAgentTask({
          department: 'Financeiro',
          triggerType: 'event',
          eventName: 'REFUND_REQUESTED',
          title: `Reembolso manual: ${booking.bookingCode}`,
          input: { bookingCode: booking.bookingCode, paymentRef: booking.paymentRef ?? null },
        }).catch(() => undefined);
      }

      await recordAuditLog({
        actorUserId: auth.dbUser.id,
        actorEmail: auth.dbUser.email,
        action: 'BOOKING_CANCELLED',
        entityType: 'booking',
        entityId: booking.bookingCode,
        details: { previousStatus: booking.status, newStatus },
      });

      sendJson(res, 200, {
        status: newStatus,
        bookingCode: booking.bookingCode,
        message:
          newStatus === 'refunded'
            ? 'Reserva cancelada e valor devolvido pelo Mercado Pago (o prazo para aparecer depende do seu banco/cartão).'
            : newStatus === 'refund_requested'
            ? 'Reserva cancelada. O reembolso foi encaminhado à equipe financeira e você será avisado.'
            : 'Reserva cancelada.',
      });
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
        paymentMethod?: string;
        guestNotes?: string;
      }>(req);

      const {
        listingId,
        slotId,
        checkInDate,
        checkOutDate,
        guestsCount = 1,
        paymentMethod = 'pix',
        guestNotes,
      } = body;

      if (!listingId || !checkInDate) {
        sendJson(res, 400, { error: 'listingId e data de check-in são obrigatórios.' });
        return;
      }

      // Split obrigatório: o parceiro precisa ter a conta Mercado Pago conectada.
      const listingPre = await adminDb.collection('listings').doc(String(Number(listingId))).get();
      if (!listingPre.exists || listingPre.data()?.status !== 'active') {
        sendJson(res, 404, { error: 'Esta oferta não está mais disponível.', code: 'LISTING_UNAVAILABLE' });
        return;
      }
      const preMerchantId = Number(listingPre.data()?.merchantId);
      const sellerAccessToken = Number.isFinite(preMerchantId) ? await getSellerAccessToken(preMerchantId) : null;
      if (!sellerAccessToken) {
        sendJson(res, 409, {
          error: 'Este parceiro ainda não ativou o recebimento pelo Mercado Pago. Tente outra oferta.',
          code: 'SELLER_NOT_CONNECTED',
        });
        return;
      }

      // Anti-fraude: só reserva quem confirmou o e-mail e teve CPF + fotos aprovados.
      if (auth.authUser.email_verified !== true) {
        sendJson(res, 403, {
          error: 'Confirme seu e-mail antes de reservar (enviamos um link para sua caixa de entrada).',
          code: 'EMAIL_NOT_VERIFIED',
        });
        return;
      }
      if (!(await isIdentityApproved(user.uid, user.role))) {
        sendJson(res, 403, {
          error: 'Para reservar, conclua a verificação de identidade (CPF + foto do documento + selfie) em Minha Conta.',
          code: 'IDENTITY_REQUIRED',
        });
        return;
      }

      const guests = Math.max(1, Math.min(30, Number(guestsCount) || 1));
      const listingPreData = (listingPre.data() ?? {}) as { moduleType?: string };
      const hospedagem = listingPreData.moduleType === 'accommodation';
      const datas = validarDatas({ checkInDate, checkOutDate, hospedagem });
      if (datas.erro) {
        sendJson(res, 400, { error: datas.erro });
        return;
      }
      // Reservas não pagas no prazo desta oferta devolvem as vagas antes de conferir disponibilidade.
      await liberarReservasVencidas({ listingId: Number(listingId) }).catch(() => 0);
      const temHorarios = !(await adminDb.collection('availability_slots').where('listingId', '==', Number(listingId)).limit(1).get()).empty;
      if (temHorarios && !slotId) {
        sendJson(res, 400, { error: 'Escolha um horário/data disponível para esta oferta.' });
        return;
      }
      const newBookingId = await nextSeqId('bookings');
      const expiresAt = new Date(Date.now() + PRAZO_PAGAMENTO_MIN * 60000).toISOString();

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
          promoPriceCents?: number | null;
          currency: string;
          capacity: number;
          status: string;
        };
        if (listing.status !== 'active' || listing.merchantId !== preMerchantId) {
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
        const merchant = merchantSnap.data() as MerchantLike & { id: number; planId: number; commissionBidBps?: number };
        // Regra do dono: só vende parceiro verificado + plano pago em dia + Mercado Pago conectado.
        if (merchantBlockers(merchant).length > 0) {
          throw new Error('LISTING_UNAVAILABLE');
        }
        // Comissão = lance do anunciante no leilão (14% a 25%).
        const plan = { commissionBps: lanceComissaoBps(merchant.commissionBidBps) };

        // Mesmo preço que o cliente vê: horário com preço próprio > preço promocional > preço normal.
        let unitPriceCents = listing.promoPriceCents && listing.promoPriceCents > 0 ? listing.promoPriceCents : listing.priceCents;

        if (slotId) {
          const slotRef = adminDb.collection('availability_slots').doc(String(Number(slotId)));
          const slotSnap = await tx.get(slotRef);
          if (!slotSnap.exists) {
            throw new Error('INSUFFICIENT_SPOTS');
          }
          const slot = slotSnap.data() as {
            id: number;
            listingId: number;
            date?: string;
            availableSpots: number;
            priceOverrideCents?: number | null;
          };
          if (slot.listingId !== listing.id || slot.availableSpots < guests) {
            throw new Error('INSUFFICIENT_SPOTS');
          }
          if (slot.date && slot.date !== String(checkInDate)) {
            throw new Error('SLOT_DATE_MISMATCH');
          }
          if (slot.priceOverrideCents) {
            unitPriceCents = slot.priceOverrideCents;
          }
          tx.update(slotRef, { availableSpots: slot.availableSpots - guests });
        }

        // Hospedagem: preço por diária; passeios/serviços: preço por pessoa.
        const units = listing.moduleType === 'accommodation' ? datas.noites : guests;

        const grossAmountCents = unitPriceCents * units;
        const split = calculateCommissionSplit({
          grossAmountCents,
          discountPercent: 0, // o site não oferece cupons de desconto
          commissionBps: plan.commissionBps,
        });

        const bookingCode = `FR-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
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
          merchantId: listing.merchantId,
          slotId: slotId ? Number(slotId) : null,
          checkInDate: String(checkInDate),
          checkOutDate: checkOutDate ? String(checkOutDate) : null,
          guestsCount: guests,
          splitMode: 'mercadopago_marketplace',
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
          expiresAt,
          checkoutUrl: null as string | null,
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

      // Split automático: a cobrança sai na conta do parceiro e a comissão (marketplace_fee) vem para a Froc.
      let checkoutUrl: string | null = null;
      try {
        const pref = await createMercadoPagoPreference({
          bookingCode: result.booking.bookingCode,
          title: result.listing.title,
          amountCents: result.booking.grossAmountCents,
          marketplaceFeeCents: result.booking.commissionCents,
          sellerAccessToken,
          payerEmail: user.email,
          appUrl: getAppBaseUrl(),
          expiresAt,
        });
        if (pref) checkoutUrl = pref.init_point;
      } catch (mpErr) {
        console.error('Mercado Pago preference failed:', mpErr);
      }
      const bookingRef = adminDb.collection('bookings').doc(String(newBookingId));
      if (!checkoutUrl) {
        // Sem link de pagamento: desfaz a reserva e devolve as vagas (o cliente não fica preso).
        await adminDb.runTransaction(async (tx) => {
          const vaga = await lerVaga(tx, result.booking.slotId);
          tx.update(bookingRef, { status: 'cancelled', updatedAt: new Date().toISOString(), cancelReason: 'checkout_unavailable' });
          tx.set(adminDb.collection('payments').doc(String(newBookingId)), { status: 'cancelled' }, { merge: true });
          if (vaga) tx.update(vaga.ref, { availableSpots: vaga.disponiveis + result.booking.guestsCount });
        });
        sendJson(res, 502, { error: 'O pagamento está indisponível no momento. Nenhum valor foi cobrado; tente novamente em alguns minutos.' });
        return;
      }
      await bookingRef.set({ checkoutUrl }, { merge: true });
      result.booking.checkoutUrl = checkoutUrl;

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

      const notifId = await nextSeqId('notifications');
      await adminDb.collection('notifications').doc(String(notifId)).set({
        id: notifId,
        userId: user.uid,
        numericUserId: user.id,
        title: `Reserva ${result.booking.bookingCode} registrada`,
        body: `Sua reserva em "${result.listing.title}" está guardada por ${PRAZO_PAGAMENTO_MIN} minutos. Conclua o pagamento no Mercado Pago para confirmar.`,
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
      }).catch(() => undefined);

      sendJson(res, 201, {
        booking: result.booking,
        checkoutUrl,
        message: `Reserva guardada por ${PRAZO_PAGAMENTO_MIN} minutos. Pague pelo Mercado Pago para confirmar.`,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '';
      if (msg === 'LISTING_UNAVAILABLE') {
        sendJson(res, 404, { error: 'Oferta indisponível para reserva.' });
        return;
      }
      if (msg === 'SLOT_DATE_MISMATCH') {
        sendJson(res, 400, { error: 'A data não confere com o horário escolhido. Escolha o horário de novo.' });
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
