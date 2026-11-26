import { adminDb } from './firebase-admin.js';

/**
 * Mercado Pago do marketplace:
 * - token do parceiro (OAuth) para o split automático das reservas;
 * - assinatura com cobrança automática no cartão (preapproval) para os planos.
 */

const MP_API = 'https://api.mercadopago.com';
const REFRESH_MARGIN_MS = 7 * 86400000; // renova o token do parceiro quando faltar 7 dias

export interface SellerConnection {
  docId: string;
  merchantId: number;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  externalAccountId: string | null;
}

async function loadSellerConnection(merchantId: number): Promise<SellerConnection | null> {
  const snap = await adminDb
    .collection('oauth_connections')
    .where('merchantId', '==', merchantId)
    .where('provider', '==', 'mercadopago_seller')
    .get();
  const rows = snap.docs
    .map((d): Record<string, unknown> & { docId: string } => ({ ...(d.data() as Record<string, unknown>), docId: d.id }))
    .filter((r) => r.status === 'connected' && typeof r.accessToken === 'string')
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  const row = rows[0];
  if (!row) return null;
  return {
    docId: row.docId,
    merchantId,
    accessToken: String(row.accessToken),
    refreshToken: row.refreshToken ? String(row.refreshToken) : null,
    expiresAt: row.expiresAt ? String(row.expiresAt) : null,
    externalAccountId: row.externalAccountId ? String(row.externalAccountId) : null,
  };
}

export function sellerTokenNeedsRefresh(expiresAt: string | null, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t - now < REFRESH_MARGIN_MS;
}

/** Token do parceiro para cobrar com split. Renova sozinho antes de vencer (o token do MP vale 180 dias). */
export async function getSellerAccessToken(merchantId: number): Promise<string | null> {
  const conn = await loadSellerConnection(merchantId);
  if (!conn) return null;
  if (!sellerTokenNeedsRefresh(conn.expiresAt)) return conn.accessToken;

  const clientId = process.env.MERCADOPAGO_CLIENT_ID;
  const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET;
  if (!clientId || !clientSecret || !conn.refreshToken) {
    return Date.parse(conn.expiresAt ?? '') > Date.now() ? conn.accessToken : null;
  }
  try {
    const r = await fetch(`${MP_API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: conn.refreshToken,
      }),
    });
    if (!r.ok) throw new Error(`refresh ${r.status}`);
    const data = (await r.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    await adminDb
      .collection('oauth_connections')
      .doc(conn.docId)
      .set(
        {
          accessToken: data.access_token,
          refreshToken: data.refresh_token ?? conn.refreshToken,
          expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
          refreshedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    return data.access_token;
  } catch (err) {
    console.error('MP seller token refresh failed:', err);
    if (Date.parse(conn.expiresAt ?? '') > Date.now()) return conn.accessToken;
    // Conexão vencida de vez: o parceiro precisa reconectar; os anúncios saem do ar até lá (nada de 409 no checkout).
    await adminDb.collection('merchants').doc(String(merchantId)).set({ mpOauthConnected: false, mpReconnectNeeded: true }, { merge: true }).catch(() => undefined);
    return null;
  }
}

/** Descobre o parceiro pelo id da conta MP (o webhook do split chega com user_id do vendedor). */
export async function findMerchantIdByCollector(collectorId: string): Promise<number | null> {
  if (!collectorId) return null;
  const snap = await adminDb.collection('merchants').where('mpCollectorId', '==', collectorId).limit(1).get();
  return snap.empty ? null : Number(snap.docs[0].data().id);
}

export async function mpGet<T>(path: string, token: string): Promise<T | null> {
  const r = await fetch(`${MP_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return (await r.json()) as T;
}

/** Assinatura mensal com cobrança automática no cartão (o cliente cadastra o cartão no Mercado Pago). */
export async function createCardSubscription(params: {
  subscriptionId: number;
  planName: string;
  amountCents: number;
  payerEmail: string;
  appUrl: string;
}): Promise<{ id: string; init_point: string } | null> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) return null;
  const r = await fetch(`${MP_API}/preapproval`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reason: `Froc Rota · ${params.planName}`,
      external_reference: `SUB-${params.subscriptionId}`,
      payer_email: params.payerEmail,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: Number((params.amountCents / 100).toFixed(2)),
        currency_id: 'BRL',
      },
      back_url: `${params.appUrl}/?painel=anunciante&assinatura=SUB-${params.subscriptionId}`,
      status: 'pending',
    }),
  });
  if (!r.ok) {
    throw new Error(`Mercado Pago preapproval error: ${r.status} ${await r.text()}`);
  }
  const data = (await r.json()) as { id: string; init_point: string };
  return { id: data.id, init_point: data.init_point };
}

/** Cancela a cobrança automática (quando o parceiro troca de plano ou cancela). */
export async function cancelCardSubscription(preapprovalId: string): Promise<boolean> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token || !preapprovalId) return false;
  const r = await fetch(`${MP_API}/preapproval/${encodeURIComponent(preapprovalId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  return r.ok;
}

/** Nova validade do plano após uma cobrança aprovada: soma 30 dias a partir do que for maior (hoje ou validade atual). */
export function extendExpiry(currentExpiresAt: string | null | undefined, days: number, now = new Date()): string {
  const current = currentExpiresAt ? Date.parse(currentExpiresAt) : NaN;
  const base = Number.isFinite(current) && current > now.getTime() ? current : now.getTime();
  return new Date(base + days * 86400000).toISOString();
}
