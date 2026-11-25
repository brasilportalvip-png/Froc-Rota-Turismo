import { adminDb } from '../_lib/firebase-admin.js';
import { recordAuditLog } from '../_lib/audit.js';
import { nextSeqId } from '../_lib/firestore-helpers.js';
import {
  ApiRequest,
  ApiResponse,
  checkRateLimit,
  enforceApiSecurity,
  getHeader,
  getQuery,
  parseJsonBody,
  sendJson,
} from '../_lib/http.js';
import { refreshMerchantListingsVisibility } from '../_lib/merchant-status.js';
import {
  cancelCardSubscription,
  extendExpiry,
  findMerchantIdByCollector,
  getSellerAccessToken,
  mpGet,
} from '../_lib/mp-marketplace.js';
import { verifyMercadoPagoWebhookSignature } from '../_lib/payment.js';
import { recordImmutableLedgerEntry } from '../_lib/pricing.js';

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

  // 1. Assinatura de plano: SUB-{id} (cobrança automática no cartão)
  if (externalReference.startsWith('SUB-')) {
    if (mpStatus !== 'approved') {
      return { confirmed: false, entityType: 'merchant_subscription', reason: 'payment_not_approved' };
    }
    return creditSubscriptionCharge({
      subscriptionId: externalReference.slice(4).trim(),
      mpPaymentId: paymentId,
      transactionAmountBrl,
    });
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

/**
 * Cada cobrança aprovada do cartão soma 30 dias ao plano. Idempotente por id de pagamento:
 * o MP avisa a mesma cobrança por "payment" e por "subscription_authorized_payment".
 */
export async function creditSubscriptionCharge(params: {
  subscriptionId: string;
  mpPaymentId: string;
  transactionAmountBrl: number;
}): Promise<ReconcileOutcome> {
  const subRef = adminDb.collection('merchant_subscriptions').doc(params.subscriptionId);
  const eventRef = adminDb.collection('payment_events').doc(`mp-${params.mpPaymentId}`);
  const paidCents = Math.round(Number(params.transactionAmountBrl) * 100);

  const result = await adminDb.runTransaction(async (tx) => {
    const [subSnap, eventSnap] = await Promise.all([tx.get(subRef), tx.get(eventRef)]);
    if (eventSnap.exists) return { ok: false as const, reason: 'already_processed' };
    if (!subSnap.exists) return { ok: false as const, reason: 'subscription_not_found' };
    const sub = subSnap.data() as {
      id: number;
      merchantId: number;
      planId: number;
      amountCents: number;
      expiresAt?: string | null;
      durationDays?: number;
    };
    if (!Number.isFinite(paidCents) || paidCents <= 0 || paidCents !== sub.amountCents) {
      return { ok: false as const, reason: 'amount_mismatch' };
    }
    const merchantRef = adminDb.collection('merchants').doc(String(sub.merchantId));
    const merchantSnap = await tx.get(merchantRef);
    const merchantExp = merchantSnap.exists ? (merchantSnap.data()?.planExpiresAt as string | null | undefined) : null;
    // Soma a partir do que vencer por último: a própria assinatura ou o plano atual do parceiro (troca de plano não perde dias).
    const base = [sub.expiresAt, merchantExp]
      .filter((v): v is string => Boolean(v))
      .sort()
      .pop();
    const nowIso = new Date().toISOString();
    const expiresAt = extendExpiry(base, sub.durationDays ?? 30);
    tx.set(
      subRef,
      {
        status: 'active',
        paymentRef: params.mpPaymentId,
        lastChargeAt: nowIso,
        startsAt: (subSnap.data() as { startsAt?: string }).startsAt || nowIso,
        expiresAt,
      },
      { merge: true }
    );
    tx.set(merchantRef, { planId: sub.planId, planExpiresAt: expiresAt, planStatus: 'active' }, { merge: true });
    tx.set(eventRef, {
      provider: 'mercadopago',
      kind: 'subscription_charge',
      subscriptionId: sub.id,
      amountCents: paidCents,
      createdAt: nowIso,
    });
    return { ok: true as const, sub, expiresAt };
  });

  if (!result.ok) {
    return { confirmed: false, entityType: 'merchant_subscription', reason: result.reason };
  }

  // Trocou de plano: desliga a cobrança automática das assinaturas antigas.
  try {
    const others = await adminDb.collection('merchant_subscriptions').where('merchantId', '==', result.sub.merchantId).get();
    for (const d of others.docs) {
      const o = d.data() as { id: number; mpPreapprovalId?: string | null; status: string };
      if (o.id === result.sub.id || !o.mpPreapprovalId || ['cancelled', 'replaced', 'failed'].includes(o.status)) continue;
      if (await cancelCardSubscription(o.mpPreapprovalId)) {
        await d.ref.set({ status: 'replaced', autoRenew: false }, { merge: true });
      }
    }
  } catch (err) {
    console.error('cancel old subscriptions failed:', err);
  }
  await refreshMerchantListingsVisibility(result.sub.merchantId);

  const planSnap = await adminDb.collection('merchant_plans').doc(String(result.sub.planId)).get();
  const planName = planSnap.exists ? String(planSnap.data()?.name ?? 'Comercial') : 'Comercial';
  await recordImmutableLedgerEntry({
    operationType: 'plan_charge',
    referenceCode: `SUB-${params.subscriptionId}-${params.mpPaymentId}`,
    category: 'plans',
    breakdown: {
      ruleCode: 'PLAN-SUBSCRIPTION-MP-CARD',
      ruleName: `Assinatura Plano ${planName}`,
      supplierCostCents: 0,
      platformRemunerationCents: paidCents,
      paymentFeeCents: Math.round((paidCents * 399) / 10000),
      taxCents: Math.round((paidCents * 600) / 10000),
      discountCents: 0,
      finalClientCents: paidCents,
      merchantPayoutCents: 0,
      estimatedMarginCents: paidCents - Math.round((paidCents * 999) / 10000),
    },
  });
  await recordAuditLog({
    action: 'SUBSCRIPTION_CHARGE_CONFIRMED_WEBHOOK',
    entityType: 'merchant_subscription',
    entityId: `SUB-${params.subscriptionId}`,
    details: { provider: 'mercadopago', externalId: params.mpPaymentId, paidCents, expiresAt: result.expiresAt },
  });
  return { confirmed: true, entityType: 'merchant_subscription' };
}

/** Situação da autorização do cartão (assinatura criada, pausada ou cancelada no Mercado Pago). */
async function syncPreapprovalStatus(preapprovalId: string, token: string): Promise<ReconcileOutcome> {
  const pre = await mpGet<{ id: string; status: string; external_reference?: string }>(
    `/preapproval/${encodeURIComponent(preapprovalId)}`,
    token
  );
  if (!pre) return { confirmed: false, reason: 'preapproval_fetch_failed' };
  const ref = String(pre.external_reference || '');
  if (!ref.startsWith('SUB-')) return { confirmed: false, reason: 'not_a_plan_subscription' };
  const subRef = adminDb.collection('merchant_subscriptions').doc(ref.slice(4));
  const snap = await subRef.get();
  if (!snap.exists) return { confirmed: false, reason: 'subscription_not_found' };
  const mapped =
    pre.status === 'authorized' ? 'card_authorized' : pre.status === 'paused' ? 'paused' : pre.status === 'cancelled' ? 'cancelled' : null;
  const updates: Record<string, unknown> = { mpPreapprovalId: pre.id, mpPreapprovalStatus: pre.status, updatedAt: new Date().toISOString() };
  const current = String(snap.data()?.status ?? '');
  // "card_authorized" só marca que o cartão foi aceito; o plano só ativa com a cobrança aprovada.
  if (mapped === 'card_authorized' && current === 'pending_authorization') updates.status = 'card_authorized';
  if (mapped === 'paused' || mapped === 'cancelled') updates.autoRenew = false;
  await subRef.set(updates, { merge: true });
  return { confirmed: mapped === 'card_authorized', entityType: 'merchant_subscription', reason: `preapproval_${pre.status}` };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!enforceApiSecurity(req, res, { allowThirdPartyWebhook: true })) return;
  if (!checkRateLimit(req, res, 'webhook:mercadopago', 120, 60000)) return;
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await parseJsonBody<{
      type?: string;
      user_id?: string | number;
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
        enforceReplayWindow: true,
      })
    ) {
      sendJson(res, 401, { error: 'Assinatura de webhook inválida ou expirada.' });
      return;
    }

    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!token || !dataId) {
      sendJson(res, 400, { error: 'Configuração ou payload de pagamento ausente.' });
      return;
    }

    const topic = String(body?.type ?? query.type ?? query.topic ?? 'payment').trim();

    if (topic === 'subscription_preapproval') {
      const outcome = await syncPreapprovalStatus(dataId, token);
      sendJson(res, 200, { received: true, ...outcome });
      return;
    }

    if (topic === 'subscription_authorized_payment') {
      const charge = await mpGet<{
        id: number | string;
        preapproval_id?: string;
        external_reference?: string;
        transaction_amount?: number;
        payment?: { id?: number | string; status?: string };
      }>(`/authorized_payments/${encodeURIComponent(dataId)}`, token);
      if (!charge) {
        sendJson(res, 502, { error: 'Falha na conciliação junto ao provedor.' });
        return;
      }
      let ref = String(charge.external_reference || '');
      if (!ref.startsWith('SUB-') && charge.preapproval_id) {
        const pre = await mpGet<{ external_reference?: string }>(
          `/preapproval/${encodeURIComponent(charge.preapproval_id)}`,
          token
        );
        ref = String(pre?.external_reference || '');
      }
      if (!ref.startsWith('SUB-') || charge.payment?.status !== 'approved' || !charge.payment?.id) {
        sendJson(res, 200, { received: true, confirmed: false, reason: `charge_${charge.payment?.status ?? 'unknown'}` });
        return;
      }
      const outcome = await creditSubscriptionCharge({
        subscriptionId: ref.slice(4),
        mpPaymentId: String(charge.payment.id),
        transactionAmountBrl: Number(charge.transaction_amount ?? 0),
      });
      sendJson(res, 200, { received: true, ...outcome });
      return;
    }

    if (topic !== 'payment') {
      sendJson(res, 200, { received: true, confirmed: false, reason: `ignored_topic_${topic}` });
      return;
    }

    // Pagamento com split: foi criado com o token do parceiro, então só o token dele enxerga.
    let mpPayment = await mpGet<{
      status: string;
      external_reference?: string;
      transaction_amount?: number;
    }>(`/v1/payments/${encodeURIComponent(dataId)}`, token);
    if (!mpPayment) {
      const sellerUserId = String((body as { user_id?: string | number }).user_id ?? '').trim();
      const merchantId = await findMerchantIdByCollector(sellerUserId);
      const sellerToken = merchantId ? await getSellerAccessToken(merchantId) : null;
      if (sellerToken) {
        mpPayment = await mpGet(`/v1/payments/${encodeURIComponent(dataId)}`, sellerToken);
      }
    }
    if (!mpPayment) {
      sendJson(res, 502, { error: 'Falha na conciliação junto ao provedor.' });
      return;
    }

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
