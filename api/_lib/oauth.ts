import crypto from 'node:crypto';
import { adminDb } from './firebase-admin.js';
import { nextSeqId } from './firestore-helpers.js';

/**
 * Na Vercel cada chamada pode cair numa instância diferente: um segredo aleatório por instância
 * fazia o retorno do OAuth falhar. Sem OAUTH_STATE_SECRET, deriva um segredo estável dos
 * segredos que já existem no servidor.
 */
function getStateSecret(): string {
  if (process.env.OAUTH_STATE_SECRET) return process.env.OAUTH_STATE_SECRET;
  const base = [
    process.env.MERCADOPAGO_CLIENT_SECRET,
    process.env.MERCADOPAGO_WEBHOOK_SECRET,
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY,
  ]
    .filter(Boolean)
    .join('|');
  return crypto.createHash('sha256').update(`froc-oauth-state-v1|${base}`).digest('hex');
}

export function getAppBaseUrl(): string {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/+$/, '');
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}

export function signOAuthState(payload: {
  userId: number;
  merchantId: number;
  provider: 'google_business' | 'mercadopago_seller';
}): string {
  const data = {
    ...payload,
    nonce: crypto.randomBytes(8).toString('hex'),
    iat: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto.createHmac('sha256', getStateSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyOAuthState(stateToken: string): {
  userId: number;
  merchantId: number;
  provider: 'google_business' | 'mercadopago_seller';
} | null {
  const parts = stateToken.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', getStateSecret()).update(encoded).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      userId: number;
      merchantId: number;
      provider: 'google_business' | 'mercadopago_seller';
      iat: number;
    };
    if (Date.now() - parsed.iat > 15 * 60 * 1000) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getGoogleBusinessOAuthConfig() {
  const clientId = process.env.GOOGLE_BUSINESS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_BUSINESS_CLIENT_SECRET;
  const redirectUri = `${getAppBaseUrl()}/api/oauth/google-business/callback`;

  return {
    configured: Boolean(clientId && clientSecret),
    redirectUri,
    requiredEnvVars: ['GOOGLE_BUSINESS_CLIENT_ID', 'GOOGLE_BUSINESS_CLIENT_SECRET'],
    scope: 'https://www.googleapis.com/auth/business.manage',
    docsUrl: 'https://developers.google.com/my-business/content/basic-setup',
  };
}

export function buildGoogleBusinessAuthUrl(params: { userId: number; merchantId: number }): string | null {
  const clientId = process.env.GOOGLE_BUSINESS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_BUSINESS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const state = signOAuthState({
    userId: params.userId,
    merchantId: params.merchantId,
    provider: 'google_business',
  });

  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${getAppBaseUrl()}/api/oauth/google-business/callback`,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/business.manage openid email',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${qs.toString()}`;
}

export async function exchangeGoogleBusinessCodeAndSync(params: {
  code: string;
  userId: number;
  merchantId: number;
}) {
  const clientId = process.env.GOOGLE_BUSINESS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_BUSINESS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_BUSINESS_CREDENTIALS_MISSING');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: params.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${getAppBaseUrl()}/api/oauth/google-business/callback`,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google OAuth exchange failed: ${tokenRes.status} ${errText}`);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  let accountId = '';
  let accountName = 'Google Business Profile Conectado';

  const accRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (accRes.ok) {
    const accJson = (await accRes.json()) as {
      accounts?: Array<{ name: string; accountName?: string }>;
    };
    const first = accJson.accounts?.[0];
    if (first) {
      accountId = first.name;
      accountName = first.accountName || first.name;
    }
  }

  const connId = await nextSeqId('oauth_connections');
  const now = new Date().toISOString();

  await Promise.all([
    adminDb
      .collection('oauth_connections')
      .doc(String(connId))
      .set({
        id: connId,
        userId: params.userId,
        merchantId: params.merchantId,
        provider: 'google_business',
        externalAccountId: accountId || null,
        externalAccountName: accountName,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? null,
        scope: tokenData.scope ?? 'https://www.googleapis.com/auth/business.manage',
        status: 'connected',
        expiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
          : null,
        createdAt: now,
      }),
    adminDb
      .collection('merchants')
      .doc(String(params.merchantId))
      .set(
        {
          gbpConnected: true,
          gbpAccountName: accountName,
          gbpLocationId: accountId || null,
          gbpSyncedAt: now,
        },
        { merge: true }
      ),
  ]);

  return { accountId, accountName };
}

export function getMercadoPagoOAuthConfig() {
  const clientId = process.env.MERCADOPAGO_CLIENT_ID;
  const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET;
  const redirectUri = `${getAppBaseUrl()}/api/oauth/mercadopago/callback`;

  return {
    configured: Boolean(clientId && clientSecret),
    redirectUri,
    requiredEnvVars: ['MERCADOPAGO_CLIENT_ID', 'MERCADOPAGO_CLIENT_SECRET'],
    docsUrl: 'https://www.mercadopago.com.br/developers/pt/docs/split-payments/integration-configuration/marketplace',
  };
}

export function buildMercadoPagoSellerAuthUrl(params: { userId: number; merchantId: number }): string | null {
  const clientId = process.env.MERCADOPAGO_CLIENT_ID;
  const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const state = signOAuthState({
    userId: params.userId,
    merchantId: params.merchantId,
    provider: 'mercadopago_seller',
  });

  const qs = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    platform_id: 'mp',
    state,
    redirect_uri: `${getAppBaseUrl()}/api/oauth/mercadopago/callback`,
  });

  return `https://auth.mercadopago.com.br/authorization?${qs.toString()}`;
}

export async function exchangeMercadoPagoSellerCode(params: {
  code: string;
  userId: number;
  merchantId: number;
}) {
  const clientId = process.env.MERCADOPAGO_CLIENT_ID;
  const clientSecret = process.env.MERCADOPAGO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('MERCADOPAGO_OAUTH_CREDENTIALS_MISSING');
  }

  const tokenRes = await fetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: `${getAppBaseUrl()}/api/oauth/mercadopago/callback`,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Mercado Pago OAuth error: ${tokenRes.status} ${errText}`);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    user_id?: number;
    expires_in?: number;
    scope?: string;
  };

  const collectorId = tokenData.user_id ? String(tokenData.user_id) : '';
  const connId = await nextSeqId('oauth_connections');
  const now = new Date().toISOString();

  await Promise.all([
    adminDb
      .collection('oauth_connections')
      .doc(String(connId))
      .set({
        id: connId,
        userId: params.userId,
        merchantId: params.merchantId,
        provider: 'mercadopago_seller',
        externalAccountId: collectorId || null,
        externalAccountName: `MP Seller ${collectorId}`,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? null,
        scope: tokenData.scope ?? 'read write offline_access',
        status: 'connected',
        expiresAt: tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
          : null,
        createdAt: now,
      }),
    adminDb
      .collection('merchants')
      .doc(String(params.merchantId))
      .set(
        {
          mpCollectorId: collectorId || null,
          mpOauthConnected: true,
        },
        { merge: true }
      ),
  ]);

  return { collectorId };
}
