import { adminDb } from '../_lib/firebase-admin.ts';
import { recordAuditLog } from '../_lib/audit.ts';
import { nextSeqId } from '../_lib/firestore-helpers.ts';
import {
  ApiRequest,
  ApiResponse,
  getHeader,
  getQuery,
  parseJsonBody,
  sendJson,
} from '../_lib/http.ts';
import { verifyMercadoPagoWebhookSignature } from '../_lib/payment.ts';
import { recordImmutableLedgerEntry } from '../_lib/pricing.ts';

export interface ReconcileMercadoPagoInput {
  externalReference: string;
  paymentId: string;
  mpStatus: string;
  transactionAmountBrl: number;
}

export interface ReconcileOutcome {
  confirmed: boolean;
  entityType?: 'booking' | 'merchant_subscription';
  reason?: string;
}

/**
 * Pure cent-level verification helper used both by tests and live Firestore reconciliation.
 */
export function isExactApprovedPendingPayment(params: {
  currentStatus: string;
  expectedAmountCents: number;
  mpStatus: string;
  transactionAmountBrl: number;
}): { ok: boolean; reason?: string; paidCents: number } {
  const paidCents = Math.round(Number(params.transactionAmountBrl) * 100);
  if (params.mpStatus !== 'approved') {
    return { ok: false, reason: 'payment_not_approved', paidCents };
  }
  if (params.currentStatus !== 'pending_payment') {
    return { ok: false, reason: 'status_not_pending_payment', paidCents };
  }
  if (!Number.isFinite(paidCents) || paidCents <= 0 || paidCents !== params.expectedAmountCents) {
    return { ok: false, reason: 'amount_mismatch', paidCents };
  }
  return { ok: true, paidCents };
}

export async function reconcileMercadoPagoPayment(
  input: ReconcileMercadoPagoInput
): Promise<ReconcileOutcome> {
  const { externalReference, paymentId, mpStatus, transactionAmountBrl } = input;
  if (!externalReference) {
    return { confirmed: false, reason: 'missing_reference' };
  }

  // 1. Check Subscription reference: SUB-{id}
  if (externalReference.startsWith('SUB-')) {
    const subIdStr = externalReference.slice(4).trim();
    const subRef = adminDb.collection('merchant_subscriptions').doc(subIdStr);
    const subSnap = await subRef.get();
    if (!subSnap.exists) {
      return { confirmed: false, reason: 'subscription_not_found' };
    }
    const sub = subSnap.data() as {
      id: number;
      merchantId: number;
      planId: number;
      status: string;
      amountCents: number;
    };

    const check = isExactApprovedPendingPayment({
      currentStatus: sub.status,
      expectedAmountCents: sub.amountCents,
      mpStatus,
      transactionAmountBrl,
    });
    if (!check.ok) {
      return { confirmed: false, entityType: 'merchant_subscription', reason: check.reason };
    }

    const planSnap = await adminDb.collection('merchant_plans').doc(String(sub.planId)).get();
    const plan = planSnap.exists ? (planSnap.data() as { name?: string; durationDays?: number }) : null;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (plan?.durationDays ?? 30) * 86400000);

    const updated = await adminDb.runTransaction(async (tx) => {
      const fresh = await tx.get(subRef);
      if (!fresh.exists) return false;
      const freshData = fresh.data() as { status: string; amountCents: number };
      if (freshData.status !== 'pending_payment' || freshData.amountCents !== check.paidCents) {
        return false;
      }
      tx.update(subRef, {
        status: 'active',
        paymentRef: paymentId,
        startsAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      tx.set(
        adminDb.collection('merchants').doc(String(sub.merchantId)),
        { planId: sub.planId },
        { merge: true }
      );
      return true;
    });

    if (!updated) {
      return { confirmed: false, entityType: 'merchant_subscription', reason: 'concurrent_update' };
    }

    await recordImmutableLedgerEntry({
      operationType: 'plan_charge',
      referenceCode: externalReference,
      category: 'plans',
      breakdown: {
        ruleCode: 'PLAN-SUBSCRIPTION-MP',
        ruleName: `Assinatura Plano ${plan?.name ?? 'Comercial'}`,
        supplierCostCents: 0,
        platformRemunerationCents: sub.amountCents,
        paymentFeeCents: Math.round((sub.amountCents * 399) / 10000),
        taxCents: Math.round((sub.amountCents * 600) / 10000),
        discountCents: 0,
        finalClientCents: sub.amountCents,
        merchantPayoutCents: 0,
        estimatedMarginCents: sub.amountCents - Math.round((sub.amountCents * 999) / 10000),
      },
    });

    await recordAuditLog({
      action: 'SUBSCRIPTION_CONFIRMED_WEBHOOK',
      entityType: 'merchant_subscription',
      entityId: externalReference,
      details: { provider: 'mercadopago', externalId: paymentId, paidCents: check.paidCents },
    });

    return { confirmed: true, entityType: 'merchant_subscription' };
  }

  // 2. Booking reference: FR-*
  const bookingQuery = await adminDb
    .collection('bookings')
    .where('bookingCode', '==', externalReference)
    .limit(1)
    .get();

  if (bookingQuery.empty) {
    return { confirmed: false, reason: 'booking_not_found' };
  }

  const bookingDoc = bookingQuery.docs[0];
  const booking = bookingDoc.data() as {
    id: number;
    bookingCode: string;
    userId: number;
    userUid?: string;
    status: string;
    grossAmountCents: number;
  };

  const check = isExactApprovedPendingPayment({
    currentStatus: booking.status,
    expectedAmountCents: booking.grossAmountCents,
    mpStatus,
    transactionAmountBrl,
  });

  if (!check.ok) {
    return { confirmed: false, entityType: 'booking', reason: check.reason };
  }

  const updated = await adminDb.runTransaction(async (tx) => {
    const fresh = await tx.get(bookingDoc.ref);
    if (!fresh.exists) return false;
    const freshData = fresh.data() as { status: string; grossAmountCents: number };
    if (
      freshData.status !== 'pending_payment' ||
      freshData.grossAmountCents !== check.paidCents
    ) {
      return false;
    }

    tx.update(bookingDoc.ref, {
      status: 'confirmed',
      paymentRef: paymentId,
      updatedAt: new Date().toISOString(),
    });

    const payRef = adminDb.collection('payments').doc(String(booking.id));
    tx.set(
      payRef,
      {
        bookingId: booking.id,
        provider: 'mercadopago',
        externalId: paymentId,
        status: 'paid',
        amountCents: booking.grossAmountCents,
        verifiedByServerWebhook: true,
        webhookEventType: 'mercadopago.payment.approved',
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return true;
  });

  if (!updated) {
    return { confirmed: false, entityType: 'booking', reason: 'concurrent_update' };
  }

  if (booking.userUid) {
    const notifId = await nextSeqId('notifications');
    await adminDb.collection('notifications').doc(String(notifId)).set({
      id: notifId,
      userId: booking.userUid,
      numericUserId: booking.userId,
      title: `Pagamento confirmado: ${booking.bookingCode}`,
      body: 'Seu pagamento foi aprovado pelo Mercado Pago e sua reserva está confirmada.',
      kind: 'payment',
      category: 'payment',
      read: false,
      createdAt: new Date().toISOString(),
    });
  }

  await recordAuditLog({
    action: 'PAYMENT_CONFIRMED_WEBHOOK',
    entityType: 'booking',
    entityId: booking.bookingCode,
    details: { provider: 'mercadopago', externalId: paymentId, paidCents: check.paidCents },
  });

  return { confirmed: true, entityType: 'booking' };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await parseJsonBody<{
      data?: { id?: string | number };
      external_reference?: string;
    }>(req);
    const query = getQuery(req);
    const xSignature = getHeader(req, 'x-signature');
    const xRequestId = getHeader(req, 'x-request-id');
    const dataId = String(body?.data?.id ?? query['data.id'] ?? '').trim();
    const externalReference = String(body?.external_reference ?? '').trim();

    if (
      !verifyMercadoPagoWebhookSignature({
        xSignatureHeader: xSignature,
        xRequestIdHeader: xRequestId,
        dataId,
      })
    ) {
      sendJson(res, 401, { error: 'Assinatura de webhook inválida.' });
      return;
    }

    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token || !dataId) {
      sendJson(res, 400, { error: 'Configuração ou payload de pagamento ausente.' });
      return;
    }

    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!mpRes.ok) {
      sendJson(res, 502, { error: 'Falha na conciliação junto ao provedor.' });
      return;
    }

    const mpPayment = (await mpRes.json()) as {
      status: string;
      external_reference?: string;
      transaction_amount?: number;
    };

    const refCode = String(mpPayment.external_reference || externalReference || '').trim();
    const outcome = await reconcileMercadoPagoPayment({
      externalReference: refCode,
      paymentId: dataId,
      mpStatus: mpPayment.status,
      transactionAmountBrl: Number(mpPayment.transaction_amount ?? 0),
    });

    sendJson(res, 200, { received: true, ...outcome });
  } catch (error) {
    console.error('Mercado Pago webhook error:', error);
    sendJson(res, 500, { error: 'Webhook processing error' });
  }
}
