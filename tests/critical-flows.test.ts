import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateCommissionSplit,
  getPaymentGatewayStatus,
  verifyMercadoPagoWebhookSignature,
} from '../api/_lib/payment.ts';
import { computePriceFromRule } from '../api/_lib/pricing.ts';
import {
  AGENT_DEPARTMENTS,
  requiresHumanFinancialApproval,
} from '../api/_lib/agents.ts';
import {
  computeEditorialHash,
  textSimilarityRatio,
} from '../api/_lib/editorial.ts';
import {
  signOAuthState,
  verifyOAuthState,
} from '../api/_lib/oauth.ts';
import { formatMoney } from '../src/i18n/translations.ts';
import {
  getTravelIntegrationsStatus,
  searchLiveFlightsIfConfigured,
} from '../api/_lib/travel.ts';
import {
  hasAdminPermission,
  isVerifiedAdminIdentity,
} from '../api/_lib/auth.ts';
import { isExactApprovedPendingPayment } from '../api/webhooks/mercadopago.ts';
import { POPUP_CATEGORIES, READY_POPUP_MODELS } from '../api/_lib/popups.ts';
import { evaluatePasswordStrength } from '../src/components/DesignSystem.tsx';
import {
  getRandomPopupIntervalMs,
  MAX_POPUP_INTERVAL_MS,
  MIN_POPUP_INTERVAL_MS,
  POPUP_VISIBLE_DURATION_MS,
} from '../src/components/PromoPopupEngine.tsx';

test('calculateCommissionSplit computes coupon discount and marketplace split accurately', () => {
  const split = calculateCommissionSplit({
    grossAmountCents: 100000, // R$ 1.000,00
    discountPercent: 10, // 10% -> R$ 100,00 discount -> R$ 900,00 net charged
    commissionBps: 1200, // 12% commission -> R$ 108,00
  });

  assert.equal(split.discountCents, 10000);
  assert.equal(split.netChargedCents, 90000);
  assert.equal(split.commissionCents, 10800);
  assert.equal(split.netMerchantCents, 79200);
});

test('calculateCommissionSplit prevents negative merchant payout on 100% discount', () => {
  const split = calculateCommissionSplit({
    grossAmountCents: 50000,
    discountPercent: 100,
    commissionBps: 1500,
  });

  assert.equal(split.netChargedCents, 0);
  assert.equal(split.commissionCents, 0);
  assert.equal(split.netMerchantCents, 0);
});

test('Pricing Engine applies configurable rules: flights R$1000+R$200=R$1200 and accommodation R$100+R$50=R$150', () => {
  const flightBreakdown = computePriceFromRule({
    supplierCostCents: 100000,
    rule: {
      ruleCode: 'FLT-FIX-200',
      name: 'Remuneração Fixa Passagens Aéreas',
      markupType: 'fixed',
      markupFixedCents: 20000,
      markupBps: 0,
      gatewayFeeBps: 399,
      taxBps: 600,
      maxFinalMarkupRatioBps: 10000,
    },
  });
  assert.equal(flightBreakdown.supplierCostCents, 100000);
  assert.equal(flightBreakdown.platformRemunerationCents, 20000);
  assert.equal(flightBreakdown.finalClientCents, 120000);

  const stayBreakdown = computePriceFromRule({
    supplierCostCents: 10000,
    rule: {
      ruleCode: 'HTL-FIX-50',
      name: 'Remuneração Fixa Hospedagem',
      markupType: 'fixed',
      markupFixedCents: 5000,
      markupBps: 0,
      gatewayFeeBps: 399,
      taxBps: 600,
      maxFinalMarkupRatioBps: 10000,
    },
  });
  assert.equal(stayBreakdown.supplierCostCents, 10000);
  assert.equal(stayBreakdown.platformRemunerationCents, 5000);
  assert.equal(stayBreakdown.finalClientCents, 15000);
});

test('Pricing Engine enforces contractual markup cap guard', () => {
  assert.throws(
    () =>
      computePriceFromRule({
        supplierCostCents: 10000,
        rule: {
          ruleCode: 'CAP-TEST',
          name: 'Cap Guard',
          markupType: 'fixed',
          markupFixedCents: 9000,
          markupBps: 0,
          gatewayFeeBps: 399,
          taxBps: 600,
          maxFinalMarkupRatioBps: 5000,
        },
      }),
    /CONTRACTUAL_PRICE_CAP_EXCEEDED/
  );
});

test('200 AI Agents architecture sums strictly to 200 specialists across 12 departments', () => {
  const totalQuota = AGENT_DEPARTMENTS.reduce((sum, d) => sum + d.quota, 0);
  assert.equal(AGENT_DEPARTMENTS.length, 12);
  assert.equal(totalQuota, 200);
});

test('200 AI Agents financial approval lock blocks unapproved sensitive financial actions', () => {
  assert.equal(requiresHumanFinancialApproval('issue_flight_ticket', false), true);
  assert.equal(requiresHumanFinancialApproval('execute_payment', false), true);
  assert.equal(requiresHumanFinancialApproval('issue_flight_ticket', true), false);
  assert.equal(requiresHumanFinancialApproval('analyze_radar', false), false);
});

test('Editorial anti-duplication detects identical content hashes and high topic similarity', () => {
  const hashA = computeEditorialHash('Guia de Noronha', 'Mergulho nas piscinas naturais de Sancho.');
  const hashB = computeEditorialHash('guia de noronha!', 'Mergulho nas piscinas naturais de Sancho');
  assert.equal(hashA, hashB);

  const sim = textSimilarityRatio(
    'Guia completo para mergulhar nas piscinas naturais de Fernando de Noronha com embarcação credenciada',
    'Guia completo de mergulho nas piscinas naturais de Fernando de Noronha com embarcação credenciada'
  );
  assert.ok(sim >= 0.65);
});

test('OAuth signed state verifies authentic payload and rejects tampered state', () => {
  const state = signOAuthState({ userId: 42, merchantId: 7, provider: 'google_business' });
  const verified = verifyOAuthState(state);
  assert.ok(verified);
  assert.equal(verified.userId, 42);
  assert.equal(verified.merchantId, 7);
  assert.equal(verified.provider, 'google_business');

  const tampered = `${state.slice(0, -3)}xxx`;
  assert.equal(verifyOAuthState(tampered), null);
});

test('verifyMercadoPagoWebhookSignature validates authentic HMAC-SHA256 signature and rejects tampered payloads', () => {
  const previousSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  process.env.MERCADOPAGO_WEBHOOK_SECRET = 'test_webhook_secret_key_for_unit_check';

  try {
    const dataId = '99887766';
    const reqId = 'req-abc-123';
    const ts = '1760000000';
    const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
    const validSig = crypto
      .createHmac('sha256', process.env.MERCADOPAGO_WEBHOOK_SECRET)
      .update(manifest)
      .digest('hex');

    assert.equal(
      verifyMercadoPagoWebhookSignature({
        xSignatureHeader: `ts=${ts},v1=${validSig}`,
        xRequestIdHeader: reqId,
        dataId,
      }),
      true
    );

    assert.equal(
      verifyMercadoPagoWebhookSignature({
        xSignatureHeader: `ts=${ts},v1=${'0'.repeat(64)}`,
        xRequestIdHeader: reqId,
        dataId,
      }),
      false
    );

    assert.equal(
      verifyMercadoPagoWebhookSignature({
        xSignatureHeader: undefined,
        xRequestIdHeader: reqId,
        dataId,
      }),
      false
    );
  } finally {
    if (previousSecret === undefined) {
      delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    } else {
      process.env.MERCADOPAGO_WEBHOOK_SECRET = previousSecret;
    }
  }
});

test('isExactApprovedPendingPayment confirms only approved payments matching exact amount and pending_payment state', () => {
  assert.equal(
    isExactApprovedPendingPayment({
      currentStatus: 'pending_payment',
      expectedAmountCents: 45000,
      mpStatus: 'approved',
      transactionAmountBrl: 450.0,
    }).ok,
    true
  );

  assert.equal(
    isExactApprovedPendingPayment({
      currentStatus: 'pending_payment',
      expectedAmountCents: 45000,
      mpStatus: 'approved',
      transactionAmountBrl: 449.99,
    }).reason,
    'amount_mismatch'
  );

  assert.equal(
    isExactApprovedPendingPayment({
      currentStatus: 'confirmed',
      expectedAmountCents: 45000,
      mpStatus: 'approved',
      transactionAmountBrl: 450.0,
    }).reason,
    'status_not_pending_payment'
  );

  assert.equal(
    isExactApprovedPendingPayment({
      currentStatus: 'pending_payment',
      expectedAmountCents: 45000,
      mpStatus: 'pending',
      transactionAmountBrl: 450.0,
    }).reason,
    'payment_not_approved'
  );
});

test('formatMoney converts BRL cents across BRL, USD, and EUR', () => {
  const brl = formatMoney(45000, 'BRL');
  const usd = formatMoney(10000, 'USD');
  const eur = formatMoney(10000, 'EUR');

  assert.match(brl, /R\$\s?450/);
  assert.match(usd, /\$18/);
  assert.match(eur, /17\s?€|€\s?17/);
});

test('Travel integration refuses to fabricate flight offers when Amadeus credentials are absent', async () => {
  const prevId = process.env.AMADEUS_CLIENT_ID;
  const prevSec = process.env.AMADEUS_CLIENT_SECRET;
  delete process.env.AMADEUS_CLIENT_ID;
  delete process.env.AMADEUS_CLIENT_SECRET;

  try {
    const result = await searchLiveFlightsIfConfigured({
      originIata: 'GRU',
      destinationIata: 'FEN',
      departureDate: '2026-12-10',
      adults: 2,
    });

    assert.equal(result.connected, false);
    assert.deepEqual(result.offers, []);
    assert.ok(Array.isArray(result.integrations));
    assert.equal(getTravelIntegrationsStatus()[0].configured, false);
    const pgStatus = getPaymentGatewayStatus();
    assert.equal(pgStatus.mercadopago.configured, Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN));
    assert.equal(
      pgStatus.mercadopago.webhookSecretConfigured,
      Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET)
    );
    assert.equal('stripe' in pgStatus, false);
  } finally {
    if (prevId !== undefined) process.env.AMADEUS_CLIENT_ID = prevId;
    if (prevSec !== undefined) process.env.AMADEUS_CLIENT_SECRET = prevSec;
  }
});

test('Admin & Sub-Admin RBAC requires verified email and enforces granular tab permissions', () => {
  assert.equal(isVerifiedAdminIdentity({ emailVerified: true, role: 'admin' }), true);
  assert.equal(isVerifiedAdminIdentity({ emailVerified: true, role: 'subadmin' }), true);
  assert.equal(isVerifiedAdminIdentity({ emailVerified: false, role: 'admin' }), false);
  assert.equal(isVerifiedAdminIdentity({ emailVerified: false, role: 'subadmin' }), false);
  assert.equal(isVerifiedAdminIdentity({ emailVerified: true, role: 'tourist' }), false);

  const subAdminPerms = ['editorial', 'chat'];
  assert.equal(hasAdminPermission(subAdminPerms, 'editorial'), true);
  assert.equal(hasAdminPermission(subAdminPerms, 'chat'), true);
  assert.equal(hasAdminPermission(subAdminPerms, 'finance'), false);
  assert.equal(hasAdminPermission(subAdminPerms, 'merchants'), false);
  assert.equal(hasAdminPermission(['*'], 'finance'), true);
});

test('Vercel serverless & Firebase architecture invariants hold cleanly', () => {
  // Legacy Express/Postgres/WebSocket files must be removed
  assert.equal(fs.existsSync('server.ts'), false);
  assert.equal(fs.existsSync('drizzle.config.ts'), false);
  assert.equal(fs.existsSync('src/db'), false);
  assert.equal(fs.existsSync('src/routes'), false);
  assert.equal(fs.existsSync('src/middleware'), false);
  assert.equal(fs.existsSync('src/services'), false);

  // package.json must not include Express/Postgres/Drizzle/WS
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const forbidden of ['express', 'pg', 'drizzle-orm', 'drizzle-kit', 'ws']) {
    assert.equal(forbidden in allDeps, false, `Forbidden legacy dependency present: ${forbidden}`);
  }

  // Count Vercel Serverless Functions in /api excluding /api/_lib (must be strictly < 12)
  const countFunctions = (dir: string): number => {
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '_lib') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) count += countFunctions(full);
      else if (entry.name.endsWith('.ts')) count += 1;
    }
    return count;
  };
  const fnCount = countFunctions('api');
  assert.ok(fnCount > 0 && fnCount < 12, `Expected 1..11 Vercel functions, got ${fnCount}`);
  assert.equal(fs.existsSync('api/webhooks/mercadopago.ts'), true);

  // Client-side payment self-confirmation endpoints/buttons must be absent
  const bookingModalSrc = fs.readFileSync('src/components/BookingModal.tsx', 'utf8');
  const merchantPortalSrc = fs.readFileSync('src/components/MerchantPortal.tsx', 'utf8');
  assert.equal(bookingModalSrc.includes('/api/payments/verify-server'), false);
  assert.equal(merchantPortalSrc.includes('/api/merchant/plans/verify-server'), false);
});

test('Promotional Pop-Up library has 54 ready-to-use models covering all 12 categories with valid assets', () => {
  assert.ok(READY_POPUP_MODELS.length >= 50, `Expected >= 50 popups, got ${READY_POPUP_MODELS.length}`);
  assert.equal(POPUP_CATEGORIES.length, 12);

  const codes = new Set<string>();
  const categoriesCovered = new Set<string>();

  for (const pop of READY_POPUP_MODELS) {
    assert.ok(pop.code && !codes.has(pop.code), `Duplicate or empty popup code: ${pop.code}`);
    codes.add(pop.code);
    categoriesCovered.add(pop.category);

    assert.ok(pop.title.trim().length > 0, `${pop.code} missing title`);
    assert.ok(pop.description.trim().length > 0, `${pop.code} missing description`);
    assert.ok(pop.ctaLabel.trim().length > 0, `${pop.code} missing ctaLabel`);
    assert.ok(pop.targetAction.trim().length > 0, `${pop.code} missing targetAction`);
    assert.equal(pop.durationMs, 6000, `${pop.code} durationMs should be 6000ms`);

    const localAsset = path.resolve(process.cwd(), pop.imageUrl.replace(/^\//, ''));
    assert.ok(fs.existsSync(localAsset), `${pop.code} references missing image: ${pop.imageUrl}`);
  }

  for (const cat of POPUP_CATEGORIES) {
    assert.ok(categoriesCovered.has(cat), `Popup category not covered in library: ${cat}`);
  }
});

test('PromoPopupEngine enforces 6s display and 3 to 7 minute intervals between pop-ups', () => {
  assert.equal(POPUP_VISIBLE_DURATION_MS, 6000);
  assert.equal(MIN_POPUP_INTERVAL_MS, 180000);
  assert.equal(MAX_POPUP_INTERVAL_MS, 420000);

  for (let i = 0; i < 100; i += 1) {
    const interval = getRandomPopupIntervalMs();
    assert.ok(
      interval >= 180000 && interval <= 420000,
      `Interval ${interval}ms out of 3-7 minute bounds`
    );
  }
});

test('PasswordField strength evaluator grades weak, moderate, strong, and ultra passwords accurately', () => {
  assert.equal(evaluatePasswordStrength('').score, 0);
  assert.equal(evaluatePasswordStrength('abc').score, 1);
  assert.equal(evaluatePasswordStrength('FrocRota').score, 2);
  assert.equal(evaluatePasswordStrength('FrocRota2030').score, 3);
  assert.equal(evaluatePasswordStrength('FrocRota@2030!').score, 4);
});
