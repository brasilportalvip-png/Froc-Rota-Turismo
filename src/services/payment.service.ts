import crypto from 'node:crypto';

export function getPaymentGatewayStatus() {
  const mpConfigured = Boolean(
    process.env.MERCADOPAGO_ACCESS_TOKEN &&
      process.env.MERCADOPAGO_ACCESS_TOKEN.trim().length > 10
  );
  const mpOauthConfigured = Boolean(
    process.env.MERCADOPAGO_CLIENT_ID && process.env.MERCADOPAGO_CLIENT_SECRET
  );
  const stripeConfigured = Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_SECRET_KEY.trim().length > 10
  );

  return {
    mercadopago: {
      configured: mpConfigured,
      oauthSplitConfigured: mpOauthConfigured,
      mode: mpConfigured ? 'live_api' : 'awaiting_credentials',
      supportedFlows: ['Checkout Pro', 'Checkout Transparente (Bricks)', 'Marketplace Split 1:1 (via OAuth vendedor)', 'Webhooks HMAC-SHA256', 'Reembolso & Conciliação'],
      splitComplianceNote:
        'O Split de Pagamentos no Mercado Pago exige autorização OAuth prévia da conta do vendedor (1:1 por pedido). Split 1:N simultâneo depende de aprovação comercial específica junto ao Mercado Pago.',
      docsUrl: 'https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/landing',
      requiredEnvVars: [
        'MERCADOPAGO_ACCESS_TOKEN',
        'MERCADOPAGO_WEBHOOK_SECRET',
        'MERCADOPAGO_CLIENT_ID',
        'MERCADOPAGO_CLIENT_SECRET',
      ],
    },
    stripe: {
      configured: stripeConfigured,
      mode: stripeConfigured ? 'live_api' : 'awaiting_credentials',
      docsUrl: 'https://stripe.com/docs/api',
      requiredEnvVars: ['STRIPE_SECRET_KEY'],
    },
  };
}

export async function createMercadoPagoPreference(params: {
  bookingCode: string;
  title: string;
  amountCents: number;
  marketplaceFeeCents?: number;
  sellerAccessToken?: string | null;
  payerEmail: string;
  appUrl: string;
}) {
  const token = params.sellerAccessToken || process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    return null;
  }

  const bodyPayload: Record<string, unknown> = {
    external_reference: params.bookingCode,
    payer: { email: params.payerEmail },
    items: [
      {
        title: params.title,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: Number((params.amountCents / 100).toFixed(2)),
      },
    ],
    notification_url: `${params.appUrl}/api/webhooks/mercadopago`,
    back_urls: {
      success: `${params.appUrl}/?booking=${params.bookingCode}&payment=pending_verification`,
      failure: `${params.appUrl}/?booking=${params.bookingCode}&payment=failed`,
      pending: `${params.appUrl}/?booking=${params.bookingCode}&payment=pending`,
    },
    auto_return: 'approved',
  };

  if (params.sellerAccessToken && params.marketplaceFeeCents && params.marketplaceFeeCents > 0) {
    bodyPayload.marketplace_fee = Number((params.marketplaceFeeCents / 100).toFixed(2));
  }

  const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Mercado Pago preference error: ${response.status} ${errText}`);
  }

  return (await response.json()) as {
    id: string;
    init_point: string;
    sandbox_init_point: string;
  };
}

export function verifyMercadoPagoWebhookSignature(params: {
  xSignatureHeader?: string;
  xRequestIdHeader?: string;
  dataId?: string;
}): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) {
    return false;
  }
  if (!params.xSignatureHeader || !params.dataId) {
    return false;
  }

  const parts = Object.fromEntries(
    params.xSignatureHeader.split(',').map((kv) => {
      const [k, v] = kv.trim().split('=');
      return [k, v];
    })
  );

  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${params.dataId};request-id:${params.xRequestIdHeader ?? ''};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}

export function calculateCommissionSplit(params: {
  grossAmountCents: number;
  discountPercent: number;
  commissionBps: number;
}) {
  const discountCents = Math.round((params.grossAmountCents * params.discountPercent) / 100);
  const netChargedCents = Math.max(0, params.grossAmountCents - discountCents);
  const commissionCents = Math.round((netChargedCents * params.commissionBps) / 10000);
  const netMerchantCents = Math.max(0, netChargedCents - commissionCents);

  return {
    discountCents,
    netChargedCents,
    commissionCents,
    netMerchantCents,
  };
}
