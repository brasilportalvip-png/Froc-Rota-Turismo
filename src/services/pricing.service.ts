import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { financialLedger, pricingRules } from '../db/schema.ts';

export interface PriceBreakdown {
  ruleCode: string;
  ruleName: string;
  supplierCostCents: number;
  platformRemunerationCents: number;
  paymentFeeCents: number;
  taxCents: number;
  discountCents: number;
  finalClientCents: number;
  merchantPayoutCents: number;
  estimatedMarginCents: number;
}

export function computePriceFromRule(params: {
  supplierCostCents: number;
  discountPercent?: number;
  rule: {
    ruleCode: string;
    name: string;
    markupType: string;
    markupFixedCents: number;
    markupBps: number;
    gatewayFeeBps: number;
    taxBps: number;
    maxFinalMarkupRatioBps: number;
  };
}): PriceBreakdown {
  const cost = Math.max(0, Math.round(params.supplierCostCents));
  const pct = Math.max(0, Math.min(90, params.discountPercent ?? 0));

  let rawPlatformCents = 0;
  if (params.rule.markupType === 'fixed') {
    rawPlatformCents = params.rule.markupFixedCents;
  } else if (params.rule.markupType === 'percent') {
    rawPlatformCents = Math.round((cost * params.rule.markupBps) / 10000);
  } else {
    rawPlatformCents =
      params.rule.markupFixedCents + Math.round((cost * params.rule.markupBps) / 10000);
  }

  // Enforce contractual markup cap guard
  const maxAllowedMarkup = Math.round((cost * params.rule.maxFinalMarkupRatioBps) / 10000);
  if (cost > 0 && params.rule.maxFinalMarkupRatioBps > 0 && rawPlatformCents > maxAllowedMarkup) {
    throw new Error('CONTRACTUAL_PRICE_CAP_EXCEEDED');
  }

  const grossBeforeDiscount = cost + rawPlatformCents;
  const discountCents = Math.round((grossBeforeDiscount * pct) / 100);
  const finalClientCents = Math.max(0, grossBeforeDiscount - discountCents);

  // Remuneração efetiva após eventual cupom promocional (cupom absorvido pela plataforma até o limite da taxa)
  const effectivePlatformCents = Math.max(0, finalClientCents - cost);
  const merchantPayoutCents = Math.max(0, finalClientCents - effectivePlatformCents);

  const paymentFeeCents = Math.round((finalClientCents * params.rule.gatewayFeeBps) / 10000);
  const taxCents = Math.round((effectivePlatformCents * params.rule.taxBps) / 10000);
  const estimatedMarginCents = effectivePlatformCents - paymentFeeCents - taxCents;

  return {
    ruleCode: params.rule.ruleCode,
    ruleName: params.rule.name,
    supplierCostCents: cost,
    platformRemunerationCents: effectivePlatformCents,
    paymentFeeCents,
    taxCents,
    discountCents,
    finalClientCents,
    merchantPayoutCents,
    estimatedMarginCents,
  };
}

export async function resolvePricingRule(params: {
  category: string;
  merchantId?: number | null;
  planSlug?: string | null;
  costCents: number;
}) {
  const rules = await db
    .select()
    .from(pricingRules)
    .where(and(eq(pricingRules.category, params.category), eq(pricingRules.active, true)));

  const matched =
    rules.find(
      (r) =>
        r.merchantId === params.merchantId &&
        params.costCents >= r.minPriceCents &&
        params.costCents <= r.maxPriceCents
    ) ??
    rules.find(
      (r) =>
        r.planSlug === params.planSlug &&
        params.costCents >= r.minPriceCents &&
        params.costCents <= r.maxPriceCents
    ) ??
    rules.find(
      (r) =>
        r.merchantId === null &&
        r.planSlug === 'all' &&
        params.costCents >= r.minPriceCents &&
        params.costCents <= r.maxPriceCents
    );

  if (matched) {
    return matched;
  }

  return {
    ruleCode: `DEFAULT-${params.category.toUpperCase()}`,
    name: 'Regra Padrão da Plataforma',
    markupType: 'percent',
    markupFixedCents: 0,
    markupBps: 1200,
    gatewayFeeBps: 399,
    taxBps: 600,
    maxFinalMarkupRatioBps: 10000,
  };
}

export async function recordImmutableLedgerEntry(params: {
  operationType: 'booking_charge' | 'flight_charge' | 'plan_charge' | 'refund';
  referenceCode: string;
  category: string;
  breakdown: PriceBreakdown;
  currency?: string;
  idempotencyKey?: string;
}) {
  const entryCode = `LED-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  await db.insert(financialLedger).values({
    entryCode,
    operationType: params.operationType,
    referenceCode: params.referenceCode,
    category: params.category,
    supplierCostCents: params.breakdown.supplierCostCents,
    platformRemunerationCents: params.breakdown.platformRemunerationCents,
    paymentFeeCents: params.breakdown.paymentFeeCents,
    taxCents: params.breakdown.taxCents,
    discountCents: params.breakdown.discountCents,
    finalClientCents: params.breakdown.finalClientCents,
    merchantPayoutCents: params.breakdown.merchantPayoutCents,
    estimatedMarginCents: params.breakdown.estimatedMarginCents,
    currency: params.currency ?? 'BRL',
    ruleSnapshotJson: {
      ruleCode: params.breakdown.ruleCode,
      ruleName: params.breakdown.ruleName,
    },
    idempotencyKey: params.idempotencyKey ?? null,
  });
  return entryCode;
}
