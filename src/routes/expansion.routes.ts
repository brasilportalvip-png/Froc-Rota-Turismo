import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/index.ts';
import {
  adminPermissions,
  agentTasks,
  aiAgents,
  availabilitySlots,
  bookings,
  chatConversations,
  chatMessages,
  coupons,
  destinations,
  editorialPosts,
  financialLedger,
  flightAlerts,
  flightOrders,
  idempotencyKeys,
  listings,
  marketingCampaigns,
  merchantPlans,
  merchants,
  merchantSubscriptions,
  notifications,
  oauthConnections,
  popupTemplates,
  pricingRules,
  touristDocuments,
} from '../db/schema.ts';
import {
  AuthRequest,
  rateLimit,
  requireAdmin,
  requireAdminPermission,
  requireAuth,
} from '../middleware/auth.ts';
import { dispatchAgentTask } from '../services/agents.service.ts';
import { askFrocRotaAI } from '../services/ai.service.ts';
import { recordAuditLog } from '../services/audit.service.ts';
import {
  createUniqueEditorialPost,
  runDailyFivePostsBatch,
} from '../services/editorial.service.ts';
import {
  buildGoogleBusinessAuthUrl,
  buildMercadoPagoSellerAuthUrl,
  exchangeGoogleBusinessCodeAndSync,
  exchangeMercadoPagoSellerCode,
  getGoogleBusinessOAuthConfig,
  getMercadoPagoOAuthConfig,
  verifyOAuthState,
} from '../services/oauth.service.ts';
import { createMercadoPagoPreference, getPaymentGatewayStatus } from '../services/payment.service.ts';
import {
  computePriceFromRule,
  recordImmutableLedgerEntry,
  resolvePricingRule,
} from '../services/pricing.service.ts';
import { broadcastRealtimeEvent } from '../services/realtime.service.ts';
import { getTravelIntegrationsStatus } from '../services/travel.service.ts';
import { listActivePopups, POPUP_CATEGORIES } from '../services/popups.service.ts';

export const expansionRouter = Router();

// ========================
// TOURIST HUB EXTENSIONS
// ========================
expansionRouter.get('/tourist/hub', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const [docs, orders, alerts, userNotifs, activeCoupons] = await Promise.all([
      db
        .select()
        .from(touristDocuments)
        .where(eq(touristDocuments.userId, user.id))
        .orderBy(desc(touristDocuments.createdAt)),
      db
        .select()
        .from(flightOrders)
        .where(eq(flightOrders.userId, user.id))
        .orderBy(desc(flightOrders.createdAt)),
      db
        .select()
        .from(flightAlerts)
        .where(eq(flightAlerts.userId, user.id))
        .orderBy(desc(flightAlerts.createdAt)),
      db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(40),
      db.select().from(coupons).where(eq(coupons.active, true)),
    ]);

    res.json({
      documents: docs,
      flightOrders: orders,
      flightAlerts: alerts,
      notifications: userNotifs,
      coupons: activeCoupons,
    });
  } catch (error) {
    console.error('GET /tourist/hub error:', error);
    res.status(500).json({ error: 'Erro ao carregar central pessoal do turista.' });
  }
});

expansionRouter.post('/tourist/documents', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const { docType, label, maskedNumber, expiresAt } = req.body ?? {};
    if (!label || !docType) {
      return res.status(400).json({ error: 'Tipo e identificação do documento são obrigatórios.' });
    }
    const validType = ['passport', 'rg', 'voucher', 'ticket', 'insurance'].includes(docType)
      ? docType
      : 'voucher';

    const [created] = await db
      .insert(touristDocuments)
      .values({
        userId: user.id,
        docType: validType,
        label: String(label).slice(0, 120),
        maskedNumber: String(maskedNumber || '').slice(0, 64),
        expiresAt: expiresAt ? String(expiresAt).slice(0, 32) : null,
      })
      .returning();

    res.status(201).json({ document: created });
  } catch (error) {
    console.error('POST /tourist/documents error:', error);
    res.status(500).json({ error: 'Erro ao salvar documento.' });
  }
});

expansionRouter.delete('/tourist/documents/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const id = Number(req.params.id);
    await db
      .delete(touristDocuments)
      .where(and(eq(touristDocuments.id, id), eq(touristDocuments.userId, user.id)));
    res.json({ deleted: true });
  } catch (error) {
    console.error('DELETE /tourist/documents error:', error);
    res.status(500).json({ error: 'Erro ao remover documento.' });
  }
});

expansionRouter.post('/tourist/flight-alerts', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const { originIata, destinationIata, targetPriceBrl, includeMadrugada = true } = req.body ?? {};
    if (!originIata || !destinationIata || !targetPriceBrl) {
      return res.status(400).json({ error: 'Origem, destino IATA e preço alvo são obrigatórios.' });
    }
    const [alert] = await db
      .insert(flightAlerts)
      .values({
        userId: user.id,
        originIata: String(originIata).toUpperCase().slice(0, 3),
        destinationIata: String(destinationIata).toUpperCase().slice(0, 3),
        targetPriceBrl: Math.max(50, Math.round(Number(targetPriceBrl))),
        includeMadrugada: Boolean(includeMadrugada),
        active: true,
      })
      .returning();

    await dispatchAgentTask({
      department: 'Voos e Oportunidades',
      triggerType: 'event',
      eventName: 'FLIGHT_ALERT_CREATED',
      title: `Monitoramento radar ${alert.originIata} -> ${alert.destinationIata} abaixo de R$ ${alert.targetPriceBrl}`,
      input: { alertId: alert.id },
    });

    res.status(201).json({ alert });
  } catch (error) {
    console.error('POST /tourist/flight-alerts error:', error);
    res.status(500).json({ error: 'Erro ao criar alerta de preço aéreo.' });
  }
});

expansionRouter.delete('/tourist/flight-alerts/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    await db
      .delete(flightAlerts)
      .where(and(eq(flightAlerts.id, Number(req.params.id)), eq(flightAlerts.userId, user.id)));
    res.json({ deleted: true });
  } catch {
    res.status(500).json({ error: 'Erro ao remover alerta.' });
  }
});

expansionRouter.patch('/tourist/notifications/:id/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const [updated] = await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, Number(req.params.id)), eq(notifications.userId, user.id)))
      .returning();
    res.json({ notification: updated ?? null });
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar notificação.' });
  }
});

// ========================
// MERCHANT HUB EXTENSIONS (FULL CRUD, MEDIA, PLANS, MARKETING)
// ========================
function sanitizeAssetOrSafeHttpUrl(url: string): string | null {
  const clean = url.trim();
  if (clean.startsWith('/src/assets/images/')) return clean;
  try {
    const parsed = new URL(clean);
    if (parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // invalid URL
  }
  return null;
}

expansionRouter.patch('/merchant/listings/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const listingId = Number(req.params.id);
    const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
    if (mRows.length === 0) {
      return res.status(403).json({ error: 'Conta comercial não encontrada.' });
    }
    const merchant = mRows[0];

    const existingRows = await db
      .select()
      .from(listings)
      .where(and(eq(listings.id, listingId), eq(listings.merchantId, merchant.id)))
      .limit(1);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Anúncio não encontrado nesta conta.' });
    }

    const {
      title,
      summary,
      description,
      priceBrl,
      promoPriceBrl,
      promoLabel,
      capacity,
      durationOrCheckin,
      address,
      cancellationPolicy,
      galleryUrls,
      videoUrls,
      googlePlaceId,
    } = req.body ?? {};

    const existing = existingRows[0];
    const safeGallery = Array.isArray(galleryUrls)
      ? galleryUrls.map(String).map(sanitizeAssetOrSafeHttpUrl).filter((x): x is string => Boolean(x)).slice(0, 12)
      : existing.galleryJson;
    const safeVideos = Array.isArray(videoUrls)
      ? videoUrls.map(String).map(sanitizeAssetOrSafeHttpUrl).filter((x): x is string => Boolean(x)).slice(0, 6)
      : existing.videosJson;

    const [updated] = await db
      .update(listings)
      .set({
        title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 140) : existing.title,
        summary: typeof summary === 'string' && summary.trim() ? summary.trim().slice(0, 240) : existing.summary,
        description:
          typeof description === 'string' && description.trim()
            ? description.trim().slice(0, 2000)
            : existing.description,
        priceCents:
          priceBrl !== undefined && Number(priceBrl) > 0
            ? Math.round(Number(priceBrl) * 100)
            : existing.priceCents,
        promoPriceCents:
          promoPriceBrl === null || promoPriceBrl === ''
            ? null
            : promoPriceBrl !== undefined && Number(promoPriceBrl) > 0
            ? Math.round(Number(promoPriceBrl) * 100)
            : existing.promoPriceCents,
        promoLabel:
          typeof promoLabel === 'string' ? promoLabel.trim().slice(0, 60) || null : existing.promoLabel,
        capacity:
          capacity !== undefined ? Math.max(1, Math.min(200, Number(capacity))) : existing.capacity,
        durationOrCheckin:
          typeof durationOrCheckin === 'string' && durationOrCheckin.trim()
            ? durationOrCheckin.trim().slice(0, 60)
            : existing.durationOrCheckin,
        address: typeof address === 'string' && address.trim() ? address.trim().slice(0, 200) : existing.address,
        cancellationPolicy:
          typeof cancellationPolicy === 'string' && cancellationPolicy.trim()
            ? cancellationPolicy.trim().slice(0, 300)
            : existing.cancellationPolicy,
        galleryJson: safeGallery,
        videosJson: safeVideos,
        googlePlaceId:
          typeof googlePlaceId === 'string' ? googlePlaceId.trim().slice(0, 120) || null : existing.googlePlaceId,
      })
      .where(eq(listings.id, existing.id))
      .returning();

    await recordAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'MERCHANT_LISTING_UPDATED',
      entityType: 'listing',
      entityId: updated.id,
    });

    res.json({ listing: updated });
  } catch (error) {
    console.error('PATCH /merchant/listings/:id error:', error);
    res.status(500).json({ error: 'Erro ao atualizar anúncio.' });
  }
});

expansionRouter.patch('/merchant/listings/:id/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const listingId = Number(req.params.id);
    const { status, renewDays } = req.body ?? {};
    const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
    if (mRows.length === 0) {
      return res.status(403).json({ error: 'Conta comercial não encontrada.' });
    }
    const merchant = mRows[0];

    const existingRows = await db
      .select()
      .from(listings)
      .where(and(eq(listings.id, listingId), eq(listings.merchantId, merchant.id)))
      .limit(1);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Anúncio não encontrado.' });
    }

    const nextStatus =
      status === 'paused'
        ? 'paused'
        : status === 'active'
        ? merchant.verificationStatus === 'verified'
          ? 'active'
          : 'pending'
        : existingRows[0].status;

    const nextExpires =
      renewDays && Number(renewDays) > 0
        ? new Date(Date.now() + Number(renewDays) * 86400000)
        : existingRows[0].expiresAt;

    const [updated] = await db
      .update(listings)
      .set({ status: nextStatus, expiresAt: nextExpires })
      .where(eq(listings.id, listingId))
      .returning();

    res.json({ listing: updated });
  } catch (error) {
    console.error('PATCH /merchant/listings/:id/status error:', error);
    res.status(500).json({ error: 'Erro ao alterar estado do anúncio.' });
  }
});

expansionRouter.delete('/merchant/listings/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const listingId = Number(req.params.id);
    const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
    if (mRows.length === 0) {
      return res.status(403).json({ error: 'Conta comercial não encontrada.' });
    }
    const merchant = mRows[0];

    const existingRows = await db
      .select()
      .from(listings)
      .where(and(eq(listings.id, listingId), eq(listings.merchantId, merchant.id)))
      .limit(1);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Anúncio não encontrado.' });
    }

    const activeBookings = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.listingId, listingId), eq(bookings.status, 'confirmed')))
      .limit(1);
    if (activeBookings.length > 0) {
      return res.status(409).json({
        error: 'Este anúncio possui reservas confirmadas ativas. Pause-o em vez de excluir.',
      });
    }

    await db.update(listings).set({ status: 'paused' }).where(eq(listings.id, listingId));
    await recordAuditLog({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'MERCHANT_LISTING_ARCHIVED',
      entityType: 'listing',
      entityId: listingId,
    });
    res.json({ deleted: true });
  } catch (error) {
    console.error('DELETE /merchant/listings/:id error:', error);
    res.status(500).json({ error: 'Erro ao remover anúncio.' });
  }
});

expansionRouter.post('/merchant/listings/:id/slots', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const listingId = Number(req.params.id);
    const { date, timeSlot, totalSpots } = req.body ?? {};
    if (!date || !timeSlot) {
      return res.status(400).json({ error: 'Data e horário são obrigatórios.' });
    }
    const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
    if (mRows.length === 0) {
      return res.status(403).json({ error: 'Conta comercial não encontrada.' });
    }
    const owned = await db
      .select()
      .from(listings)
      .where(and(eq(listings.id, listingId), eq(listings.merchantId, mRows[0].id)))
      .limit(1);
    if (owned.length === 0) {
      return res.status(404).json({ error: 'Anúncio não encontrado.' });
    }
    const spots = Math.max(1, Math.min(300, Number(totalSpots) || owned[0].capacity));
    const [slot] = await db
      .insert(availabilitySlots)
      .values({
        listingId,
        date: String(date).slice(0, 10),
        timeSlot: String(timeSlot).slice(0, 30),
        totalSpots: spots,
        availableSpots: spots,
      })
      .returning();

    res.status(201).json({ slot });
  } catch (error) {
    console.error('POST /merchant/listings/:id/slots error:', error);
    res.status(500).json({ error: 'Erro ao cadastrar horário.' });
  }
});

expansionRouter.get('/merchant/subscriptions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
    if (mRows.length === 0) return res.json({ subscriptions: [] });
    const subs = await db
      .select({
        subscription: merchantSubscriptions,
        planName: merchantPlans.name,
        planSlug: merchantPlans.slug,
      })
      .from(merchantSubscriptions)
      .innerJoin(merchantPlans, eq(merchantSubscriptions.planId, merchantPlans.id))
      .where(eq(merchantSubscriptions.merchantId, mRows[0].id))
      .orderBy(desc(merchantSubscriptions.createdAt));

    res.json({ subscriptions: subs });
  } catch {
    res.status(500).json({ error: 'Erro ao carregar assinaturas.' });
  }
});

expansionRouter.post('/merchant/plans/subscribe', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const { planSlug, autoRenew = true } = req.body ?? {};
    const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
    if (mRows.length === 0) {
      return res.status(403).json({ error: 'Cadastre sua empresa antes de contratar um plano.' });
    }
    const merchant = mRows[0];

    const pRows = await db
      .select()
      .from(merchantPlans)
      .where(eq(merchantPlans.slug, String(planSlug)))
      .limit(1);
    if (pRows.length === 0) {
      return res.status(404).json({ error: 'Plano comercial não encontrado.' });
    }
    const plan = pRows[0];

    const isFree = plan.monthlyPriceCents === 0;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + plan.durationDays * 86400000);

    const [sub] = await db
      .insert(merchantSubscriptions)
      .values({
        merchantId: merchant.id,
        planId: plan.id,
        status: isFree ? 'active' : 'pending_payment',
        amountCents: plan.monthlyPriceCents,
        startsAt: isFree ? now : null,
        expiresAt: isFree ? expiresAt : null,
        autoRenew: Boolean(autoRenew),
      })
      .returning();

    if (isFree) {
      await db.update(merchants).set({ planId: plan.id }).where(eq(merchants.id, merchant.id));
    }

    let checkoutUrl: string | null = null;
    if (!isFree && process.env.MERCADOPAGO_ACCESS_TOKEN) {
      const pref = await createMercadoPagoPreference({
        bookingCode: `SUB-${sub.id}`,
        title: `Plano ${plan.name} (${plan.durationDays} dias) - Froc Rota`,
        amountCents: plan.monthlyPriceCents,
        payerEmail: user.email,
        appUrl: process.env.APP_URL || 'http://localhost:3000',
      });
      checkoutUrl = pref?.init_point ?? null;
    }

    res.status(201).json({
      subscription: sub,
      plan,
      checkoutUrl,
      message: isFree
        ? 'Plano gratuito ativado.'
        : 'Assinatura criada como pending_payment. Será ativada somente após confirmação de pagamento no servidor.',
    });
  } catch (error) {
    console.error('POST /merchant/plans/subscribe error:', error);
    res.status(500).json({ error: 'Erro ao contratar plano.' });
  }
});

expansionRouter.post('/merchant/plans/verify-server', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const { subscriptionId } = req.body ?? {};
    const rows = await db
      .select()
      .from(merchantSubscriptions)
      .where(eq(merchantSubscriptions.id, Number(subscriptionId)))
      .limit(1);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Assinatura não encontrada.' });
    }
    const sub = rows[0];

    const mRows = await db.select().from(merchants).where(eq(merchants.id, sub.merchantId)).limit(1);
    if (mRows.length === 0 || (mRows[0].userId !== user.id && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Sem permissão para confirmar esta assinatura.' });
    }
    if (process.env.MERCADOPAGO_ACCESS_TOKEN && user.role !== 'admin') {
      return res.status(400).json({ error: 'Confirmação de assinatura ativa somente via webhook do gateway.' });
    }

    const planRows = await db.select().from(merchantPlans).where(eq(merchantPlans.id, sub.planId)).limit(1);
    const plan = planRows[0];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (plan?.durationDays ?? 30) * 86400000);
    const ref = `PLAN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const [updatedSub] = await db
      .update(merchantSubscriptions)
      .set({
        status: 'active',
        paymentRef: ref,
        startsAt: now,
        expiresAt,
      })
      .where(eq(merchantSubscriptions.id, sub.id))
      .returning();

    await db.update(merchants).set({ planId: sub.planId }).where(eq(merchants.id, sub.merchantId));

    await recordImmutableLedgerEntry({
      operationType: 'plan_charge',
      referenceCode: ref,
      category: 'plans',
      breakdown: {
        ruleCode: 'PLAN-SUBSCRIPTION-100',
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

    res.json({ subscription: updatedSub, activated: true });
  } catch (error) {
    console.error('POST /merchant/plans/verify-server error:', error);
    res.status(500).json({ error: 'Erro ao confirmar pagamento do plano.' });
  }
});

// Marketing Campaigns & AI Copy Generator
expansionRouter.get('/merchant/campaigns', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
    if (mRows.length === 0) return res.json({ campaigns: [] });

    const list = await db
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.merchantId, mRows[0].id))
      .orderBy(desc(marketingCampaigns.createdAt));

    res.json({ campaigns: list });
  } catch {
    res.status(500).json({ error: 'Erro ao carregar campanhas.' });
  }
});

expansionRouter.post('/merchant/campaigns/generate-copy', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const { listingId, channel = 'instagram', tone = 'Sofisticado e acolhedor' } = req.body ?? {};
    const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
    if (mRows.length === 0) {
      return res.status(403).json({ error: 'Conta comercial necessária.' });
    }
    const listRows = await db
      .select()
      .from(listings)
      .where(and(eq(listings.id, Number(listingId)), eq(listings.merchantId, mRows[0].id)))
      .limit(1);
    if (listRows.length === 0) {
      return res.status(404).json({ error: 'Anúncio não encontrado.' });
    }
    const item = listRows[0];

    const apiKey = process.env.GEMINI_API_KEY;
    let generated = {
      headline: `${item.title} — Reserve com segurança na Froc Rota`,
      adCopy: `${item.summary} Atendimento verificado em ${item.address}. Valor a partir de R$ ${Math.round(item.priceCents / 100)}.`,
      socialCaption: `Descubra ${item.title}! Experiência verificada na Froc Rota Turismo. Reserve sua vaga diretamente pelo link oficial. #FrocRota #TurismoBrasil`,
      aiSuggestion: `Destaque a política flexível ("${item.cancellationPolicy}") e inclua fotos em alta luz natural para elevar o CTR no canal ${channel}.`,
    };

    if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
      try {
        const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
        const aiRes = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: JSON.stringify({ listing: item, channel, tone }),
          config: {
            systemInstruction:
              'Você é especialista em marketing turístico da Froc Rota. Gere headline, adCopy, socialCaption e aiSuggestion baseados exclusivamente nos dados reais do anúncio.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                headline: { type: Type.STRING },
                adCopy: { type: Type.STRING },
                socialCaption: { type: Type.STRING },
                aiSuggestion: { type: Type.STRING },
              },
              required: ['headline', 'adCopy', 'socialCaption', 'aiSuggestion'],
            },
          },
        });
        const parsed = JSON.parse((aiRes.text ?? '').trim());
        if (parsed.headline && parsed.adCopy) {
          generated = parsed;
        }
      } catch {
        // Keep real grounded fallback
      }
    }

    await dispatchAgentTask({
      department: 'Marketing e SEO',
      triggerType: 'request',
      eventName: 'CAMPAIGN_AI_COPY_GENERATED',
      title: `Copy gerada para "${item.title}" (${channel})`,
      input: { listingId: item.id, channel },
    });

    res.json(generated);
  } catch (error) {
    console.error('generate-copy error:', error);
    res.status(500).json({ error: 'Erro ao gerar material de marketing.' });
  }
});

expansionRouter.post('/merchant/campaigns', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
    if (mRows.length === 0) {
      return res.status(403).json({ error: 'Conta comercial necessária.' });
    }
    const { listingId, title, channel = 'froc_featured', headline, adCopy, socialCaption, aiSuggestion } = req.body ?? {};
    if (!title || !headline || !adCopy) {
      return res.status(400).json({ error: 'Título, chamada e texto do anúncio são obrigatórios.' });
    }

    const [created] = await db
      .insert(marketingCampaigns)
      .values({
        merchantId: mRows[0].id,
        listingId: listingId ? Number(listingId) : null,
        title: String(title).slice(0, 140),
        channel: ['instagram', 'google_ads', 'trivago', 'froc_featured'].includes(channel)
          ? channel
          : 'froc_featured',
        headline: String(headline).slice(0, 200),
        adCopy: String(adCopy).slice(0, 1500),
        socialCaption: String(socialCaption || '').slice(0, 1000),
        aiSuggestion: aiSuggestion ? String(aiSuggestion).slice(0, 600) : null,
        status: 'active',
      })
      .returning();

    res.status(201).json({ campaign: created });
  } catch (error) {
    console.error('POST /merchant/campaigns error:', error);
    res.status(500).json({ error: 'Erro ao criar campanha.' });
  }
});

expansionRouter.patch('/merchant/campaigns/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
    if (mRows.length === 0) return res.status(403).json({ error: 'Sem permissão.' });
    const status = ['draft', 'active', 'paused'].includes(req.body?.status) ? req.body.status : 'paused';
    const [updated] = await db
      .update(marketingCampaigns)
      .set({ status })
      .where(and(eq(marketingCampaigns.id, Number(req.params.id)), eq(marketingCampaigns.merchantId, mRows[0].id)))
      .returning();
    res.json({ campaign: updated });
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar campanha.' });
  }
});

// ========================
// REAL OAUTH CONNECTORS (GOOGLE BUSINESS PROFILE & MERCADO PAGO SELLER)
// ========================
expansionRouter.get('/oauth/status', requireAuth, async (req: AuthRequest, res) => {
  const user = req.dbUser!;
  const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
  const merchant = mRows[0] ?? null;

  res.json({
    googleBusiness: {
      ...getGoogleBusinessOAuthConfig(),
      connected: merchant?.gbpConnected ?? false,
      accountName: merchant?.gbpAccountName ?? null,
      syncedAt: merchant?.gbpSyncedAt ?? null,
    },
    mercadopagoSeller: {
      ...getMercadoPagoOAuthConfig(),
      connected: merchant?.mpOauthConnected ?? false,
      collectorId: merchant?.mpCollectorId ?? null,
    },
  });
});

expansionRouter.get('/oauth/google-business/url', requireAuth, async (req: AuthRequest, res) => {
  const user = req.dbUser!;
  const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
  if (mRows.length === 0) {
    return res.status(403).json({ error: 'Complete o cadastro comercial antes de conectar o Google Business Profile.' });
  }
  const url = buildGoogleBusinessAuthUrl({ userId: user.id, merchantId: mRows[0].id });
  if (!url) {
    const cfg = getGoogleBusinessOAuthConfig();
    return res.status(400).json({
      error: `Credenciais GOOGLE_BUSINESS_CLIENT_ID e GOOGLE_BUSINESS_CLIENT_SECRET não configuradas no servidor. Redirect URI cadastrável: ${cfg.redirectUri}`,
      config: cfg,
    });
  }
  res.json({ url });
});

expansionRouter.get(['/oauth/google-business/callback', '/oauth/google-business/callback/'], async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code || !state) {
    return res.status(400).send('<p>Autorização Google Business cancelada ou incompleta.</p>');
  }
  const parsed = verifyOAuthState(String(state));
  if (!parsed || parsed.provider !== 'google_business') {
    return res.status(400).send('<p>Token de estado OAuth inválido ou expirado.</p>');
  }

  try {
    await exchangeGoogleBusinessCodeAndSync({
      code: String(code),
      userId: parsed.userId,
      merchantId: parsed.merchantId,
    });
    res.send(`
      <html><body>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'google_business' }, '*');
            window.close();
          } else {
            window.location.href = '/';
          }
        </script>
        <p>Google Business Profile conectado com sucesso. Esta janela será fechada.</p>
      </body></html>
    `);
  } catch (err) {
    console.error('Google Business OAuth callback error:', err);
    res.status(500).send('<p>Falha ao concluir conexão com Google Business Profile.</p>');
  }
});

expansionRouter.get('/oauth/mercadopago/url', requireAuth, async (req: AuthRequest, res) => {
  const user = req.dbUser!;
  const mRows = await db.select().from(merchants).where(eq(merchants.userId, user.id)).limit(1);
  if (mRows.length === 0) {
    return res.status(403).json({ error: 'Complete o cadastro comercial antes de autorizar sua conta Mercado Pago.' });
  }
  const url = buildMercadoPagoSellerAuthUrl({ userId: user.id, merchantId: mRows[0].id });
  if (!url) {
    const cfg = getMercadoPagoOAuthConfig();
    return res.status(400).json({
      error: `Credenciais MERCADOPAGO_CLIENT_ID e MERCADOPAGO_CLIENT_SECRET não configuradas no servidor. Redirect URI cadastrável: ${cfg.redirectUri}`,
      config: cfg,
    });
  }
  res.json({ url });
});

expansionRouter.get(['/oauth/mercadopago/callback', '/oauth/mercadopago/callback/'], async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return res.status(400).send('<p>Autorização Mercado Pago cancelada ou incompleta.</p>');
  }
  const parsed = verifyOAuthState(String(state));
  if (!parsed || parsed.provider !== 'mercadopago_seller') {
    return res.status(400).send('<p>Estado OAuth Mercado Pago inválido.</p>');
  }

  try {
    await exchangeMercadoPagoSellerCode({
      code: String(code),
      userId: parsed.userId,
      merchantId: parsed.merchantId,
    });
    res.send(`
      <html><body>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'mercadopago_seller' }, '*');
            window.close();
          } else {
            window.location.href = '/';
          }
        </script>
        <p>Conta Mercado Pago vinculada ao Split Froc Rota. Esta janela será fechada.</p>
      </body></html>
    `);
  } catch (err) {
    console.error('Mercado Pago OAuth callback error:', err);
    res.status(500).send('<p>Erro na vinculação OAuth Mercado Pago.</p>');
  }
});

// ========================
// FINANCIAL ENGINE & FLIGHT ORDERS (IDEMPOTENT)
// ========================
expansionRouter.post('/pricing/preview', async (req, res) => {
  try {
    const { category = 'flights', supplierCostCents, discountPercent = 0, merchantId, planSlug } = req.body ?? {};
    const cost = Math.max(0, Math.round(Number(supplierCostCents) || 0));
    const rule = await resolvePricingRule({
      category: String(category),
      merchantId: merchantId ? Number(merchantId) : null,
      planSlug: planSlug ? String(planSlug) : null,
      costCents: cost,
    });
    const breakdown = computePriceFromRule({
      supplierCostCents: cost,
      discountPercent: Number(discountPercent) || 0,
      rule,
    });
    res.json({ breakdown, rule });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Erro no cálculo financeiro.';
    res.status(400).json({ error: msg });
  }
});

expansionRouter.post('/travel/orders', requireAuth, rateLimit(15, 60000), async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const idempKey = String(req.header('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
    if (!idempKey) {
      return res.status(400).json({ error: 'Idempotency-Key obrigatório para evitar compras duplicadas.' });
    }

    const existingKey = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, idempKey), eq(idempotencyKeys.scope, 'flight_order')))
      .limit(1);
    if (existingKey.length > 0) {
      return res.status(existingKey[0].statusCode).json(existingKey[0].responseJson);
    }

    const {
      originIata,
      destinationIata,
      departureDate,
      returnDate,
      tripType = 'one_way',
      supplierCostCents,
      carrierCode,
      flightNumber,
      isMadrugada = false,
      passengers,
      provider = 'Amadeus Flight Offers API v2',
      fareConfirmedByProvider = false,
    } = req.body ?? {};

    if (!fareConfirmedByProvider && !process.env.AMADEUS_CLIENT_ID) {
      return res.status(400).json({
        error:
          'Emissão bloqueada: tarifa e disponibilidade devem ser confirmadas em tempo real pelo provedor aéreo oficial configurado.',
      });
    }

    if (!originIata || !destinationIata || !departureDate || !supplierCostCents || !Array.isArray(passengers) || passengers.length === 0) {
      return res.status(400).json({ error: 'Dados dos passageiros, rota e tarifa confirmada são obrigatórios.' });
    }

    const rule = await resolvePricingRule({ category: 'flights', costCents: Number(supplierCostCents) });
    const breakdown = computePriceFromRule({ supplierCostCents: Number(supplierCostCents), rule });

    const orderCode = `FLT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const [order] = await db
      .insert(flightOrders)
      .values({
        orderCode,
        userId: user.id,
        idempotencyKey: idempKey,
        provider: String(provider),
        tripType: String(tripType),
        originIata: String(originIata).toUpperCase().slice(0, 3),
        destinationIata: String(destinationIata).toUpperCase().slice(0, 3),
        departureDate: String(departureDate),
        returnDate: returnDate ? String(returnDate) : null,
        carrierCode: carrierCode ? String(carrierCode).slice(0, 8) : null,
        flightNumber: flightNumber ? String(flightNumber).slice(0, 16) : null,
        isMadrugada: Boolean(isMadrugada),
        passengersJson: passengers.slice(0, 9),
        supplierCostCents: breakdown.supplierCostCents,
        platformFeeCents: breakdown.platformRemunerationCents,
        paymentFeeCents: breakdown.paymentFeeCents,
        taxCents: breakdown.taxCents,
        totalClientCents: breakdown.finalClientCents,
        status: 'pending_payment',
      })
      .returning();

    await recordImmutableLedgerEntry({
      operationType: 'flight_charge',
      referenceCode: orderCode,
      category: 'flights',
      breakdown,
      idempotencyKey: idempKey,
    });

    const responsePayload = { order, breakdown };
    await db
      .insert(idempotencyKeys)
      .values({
        key: idempKey,
        scope: 'flight_order',
        userId: user.id,
        statusCode: 201,
        responseJson: responsePayload as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing();

    await dispatchAgentTask({
      department: 'Voos e Oportunidades',
      triggerType: 'event',
      eventName: 'FLIGHT_ORDER_CREATED',
      title: `Pedido aéreo ${orderCode} (${order.originIata}-${order.destinationIata}) aguardando pagamento`,
      requestedAction: 'issue_flight_ticket',
      explicitApproval: false,
      input: { orderCode },
    });

    res.status(201).json(responsePayload);
  } catch (error) {
    console.error('POST /travel/orders error:', error);
    res.status(500).json({ error: 'Erro ao registrar pedido aéreo.' });
  }
});

// ========================
// REAL-TIME CHAT (TOURIST / MERCHANT / ADMIN / AI HANDOFF)
// ========================
expansionRouter.get('/chat/conversations', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const isStaff = user.role === 'admin' || user.role === 'subadmin';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const conditions = [];
    if (!isStaff) {
      conditions.push(eq(chatConversations.ownerUserId, user.id));
    }
    if (q) {
      conditions.push(
        or(
          ilike(chatConversations.subject, `%${q}%`),
          ilike(chatConversations.ownerName, `%${q}%`),
          ilike(chatConversations.conversationCode, `%${q}%`)
        )!
      );
    }

    const rows =
      conditions.length > 0
        ? await db
            .select()
            .from(chatConversations)
            .where(and(...conditions))
            .orderBy(desc(chatConversations.lastMessageAt))
            .limit(60)
        : await db
            .select()
            .from(chatConversations)
            .orderBy(desc(chatConversations.lastMessageAt))
            .limit(60);

    res.json({ conversations: rows });
  } catch (error) {
    console.error('GET /chat/conversations error:', error);
    res.status(500).json({ error: 'Erro ao carregar conversas.' });
  }
});

expansionRouter.post('/chat/conversations', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const { subject, channel = 'tourist', initialMessage } = req.body ?? {};
    const convCode = `CHT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const [conv] = await db
      .insert(chatConversations)
      .values({
        conversationCode: convCode,
        ownerUserId: user.id,
        ownerUid: user.uid,
        ownerName: user.name,
        channel: ['tourist', 'merchant', 'admin', 'ai_handoff'].includes(channel) ? channel : 'tourist',
        subject: String(subject || 'Atendimento Froc Rota Turismo').slice(0, 160),
        status: 'open',
      })
      .returning();

    if (typeof initialMessage === 'string' && initialMessage.trim()) {
      const senderRole = user.role === 'admin' || user.role === 'subadmin' ? 'admin' : user.role === 'merchant' ? 'merchant' : 'tourist';
      const [msg] = await db
        .insert(chatMessages)
        .values({
          conversationId: conv.id,
          senderUid: user.uid,
          senderName: user.name,
          senderRole,
          text: initialMessage.trim().slice(0, 2000),
          readByStaff: senderRole === 'admin',
        })
        .returning();

      broadcastRealtimeEvent({
        type: 'chat:message',
        channel: conv.conversationCode,
        data: { conversationId: conv.id, message: msg },
      });
    }

    res.status(201).json({ conversation: conv });
  } catch (error) {
    console.error('POST /chat/conversations error:', error);
    res.status(500).json({ error: 'Erro ao iniciar conversa.' });
  }
});

expansionRouter.get('/chat/conversations/:id/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const convId = Number(req.params.id);
    const convRows = await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, convId))
      .limit(1);

    if (convRows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada.' });
    }
    const conv = convRows[0];
    const isStaff = user.role === 'admin' || user.role === 'subadmin';
    if (conv.ownerUserId !== user.id && !isStaff) {
      return res.status(403).json({ error: 'Sem permissão para ler esta conversa.' });
    }

    const msgs = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conv.id))
      .orderBy(chatMessages.createdAt);

    if (isStaff && conv.unreadByStaff > 0) {
      await db.update(chatConversations).set({ unreadByStaff: 0 }).where(eq(chatConversations.id, conv.id));
    } else if (!isStaff && conv.unreadByOwner > 0) {
      await db.update(chatConversations).set({ unreadByOwner: 0 }).where(eq(chatConversations.id, conv.id));
    }

    res.json({ conversation: conv, messages: msgs });
  } catch {
    res.status(500).json({ error: 'Erro ao carregar mensagens.' });
  }
});

expansionRouter.post('/chat/conversations/:id/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = req.dbUser!;
    const convId = Number(req.params.id);
    const { text, attachmentUrl, requestHumanHandoff, askAi } = req.body ?? {};
    const convRows = await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, convId))
      .limit(1);

    if (convRows.length === 0) {
      return res.status(404).json({ error: 'Conversa não encontrada.' });
    }
    const conv = convRows[0];
    const isStaff = user.role === 'admin' || user.role === 'subadmin';
    if (conv.ownerUserId !== user.id && !isStaff) {
      return res.status(403).json({ error: 'Sem permissão nesta conversa.' });
    }

    const cleanText = String(text ?? '').trim().slice(0, 2000);
    if (!cleanText && !requestHumanHandoff) {
      return res.status(400).json({ error: 'Mensagem obrigatória.' });
    }

    const safeAttach =
      typeof attachmentUrl === 'string' ? sanitizeAssetOrSafeHttpUrl(attachmentUrl) : null;

    const senderRole = isStaff ? 'admin' : user.role === 'merchant' ? 'merchant' : 'tourist';
    const createdMsgs: Array<typeof chatMessages.$inferSelect> = [];

    if (cleanText) {
      const [userMsg] = await db
        .insert(chatMessages)
        .values({
          conversationId: conv.id,
          senderUid: user.uid,
          senderName: user.name,
          senderRole,
          text: cleanText,
          attachmentUrl: safeAttach,
          readByStaff: isStaff,
        })
        .returning();
      createdMsgs.push(userMsg);

      broadcastRealtimeEvent({
        type: 'chat:message',
        channel: conv.conversationCode,
        data: { conversationId: conv.id, message: userMsg },
      });
    }

    if (requestHumanHandoff) {
      await db
        .update(chatConversations)
        .set({ status: 'human_assigned', channel: 'admin', unreadByStaff: sql`${chatConversations.unreadByStaff} + 1` })
        .where(eq(chatConversations.id, conv.id));

      const [sysMsg] = await db
        .insert(chatMessages)
        .values({
          conversationId: conv.id,
          senderUid: 'froc-orchestrator',
          senderName: 'Orquestrador Froc Rota',
          senderRole: 'ai_agent',
          text: 'Conversa encaminhada em tempo real para um atendente humano da central Froc Rota.',
          readByStaff: false,
        })
        .returning();
      createdMsgs.push(sysMsg);
    } else if (askAi && !isStaff && cleanText) {
      try {
        const aiReply = await askFrocRotaAI({
          query: cleanText,
          language: (user.preferredLang as 'pt' | 'en' | 'es') || 'pt',
        });
        const [aiMsg] = await db
          .insert(chatMessages)
          .values({
            conversationId: conv.id,
            senderUid: 'froc-rota-ai',
            senderName: 'Froc Rota AI Assistant',
            senderRole: 'ai_agent',
            text: aiReply.reply.slice(0, 2000),
            readByStaff: true,
          })
          .returning();
        createdMsgs.push(aiMsg);

        broadcastRealtimeEvent({
          type: 'chat:message',
          channel: conv.conversationCode,
          data: { conversationId: conv.id, message: aiMsg },
        });
      } catch {
        // AI key unavailable or failed; keep human thread intact
      }
    }

    await db
      .update(chatConversations)
      .set({
        lastMessageAt: new Date(),
        unreadByOwner: isStaff ? sql`${chatConversations.unreadByOwner} + 1` : conv.unreadByOwner,
        unreadByStaff: !isStaff ? sql`${chatConversations.unreadByStaff} + 1` : conv.unreadByStaff,
      })
      .where(eq(chatConversations.id, conv.id));

    await dispatchAgentTask({
      department: 'Atendimento e Chat',
      triggerType: 'event',
      eventName: requestHumanHandoff ? 'CHAT_HUMAN_ESCALATION' : 'CHAT_MESSAGE_PROCESSED',
      title: `Atendimento ${conv.conversationCode} (${conv.subject})`,
      input: { conversationId: conv.id, senderRole },
    });

    res.status(201).json({ messages: createdMsgs });
  } catch (error) {
    console.error('POST /chat/messages error:', error);
    res.status(500).json({ error: 'Erro ao enviar mensagem.' });
  }
});

// ========================
// EDITORIAL 5 DAILY POSTS ENGINE
// ========================
expansionRouter.get('/posts', async (req, res) => {
  try {
    const slug = typeof req.query.slug === 'string' ? req.query.slug : null;
    if (slug) {
      const found = await db
        .select()
        .from(editorialPosts)
        .where(and(eq(editorialPosts.slug, slug), eq(editorialPosts.status, 'published')))
        .limit(1);
      return res.json({ post: found[0] ?? null });
    }
    const posts = await db
      .select()
      .from(editorialPosts)
      .where(eq(editorialPosts.status, 'published'))
      .orderBy(desc(editorialPosts.createdAt))
      .limit(25);
    res.json({ posts });
  } catch {
    res.status(500).json({ error: 'Erro ao carregar publicações diárias.' });
  }
});

expansionRouter.get(
  '/admin/posts',
  requireAuth,
  requireAdmin,
  requireAdminPermission('editorial'),
  async (_req, res) => {
    try {
      const posts = await db.select().from(editorialPosts).orderBy(desc(editorialPosts.createdAt)).limit(60);
      res.json({ posts });
    } catch {
      res.status(500).json({ error: 'Erro ao carregar fila editorial.' });
    }
  }
);

expansionRouter.post(
  '/admin/posts/run-daily',
  requireAuth,
  requireAdmin,
  requireAdminPermission('editorial'),
  async (req: AuthRequest, res) => {
    try {
      const result = await runDailyFivePostsBatch(req.body?.publishDate);
      await recordAuditLog({
        actorUserId: req.dbUser!.id,
        actorEmail: req.dbUser!.email,
        action: 'EDITORIAL_DAILY_BATCH_RUN',
        entityType: 'editorial_post',
        entityId: new Date().toISOString().slice(0, 10),
        details: { createdCount: result.created.length },
      });
      res.json(result);
    } catch (error) {
      console.error('run-daily error:', error);
      res.status(500).json({ error: 'Erro ao executar lote diário de publicações.' });
    }
  }
);

expansionRouter.post(
  '/admin/posts',
  requireAuth,
  requireAdmin,
  requireAdminPermission('editorial'),
  async (req: AuthRequest, res) => {
    try {
      const { title, body, category, destinationSlug, coverImage, keywords, riskTier = 'commercial_review' } = req.body ?? {};
      if (!title || !body || !category || !coverImage) {
        return res.status(400).json({ error: 'Título, texto, categoria e imagem licenciada são obrigatórios.' });
      }
      const created = await createUniqueEditorialPost({
        title: String(title),
        body: String(body),
        category: String(category),
        destinationSlug: destinationSlug ? String(destinationSlug) : undefined,
        coverImage: String(coverImage),
        keywords: Array.isArray(keywords) ? keywords.map(String) : [],
        riskTier: riskTier === 'low_auto' ? 'low_auto' : 'commercial_review',
      });
      res.status(201).json({ post: created });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Erro ao criar post.';
      if (msg.startsWith('DUPLICATE_')) {
        return res.status(409).json({
          error: `Bloqueado pela regra anti-duplicidade (${msg}). É proibido repetir conteúdo ou imagem diária.`,
        });
      }
      res.status(500).json({ error: msg });
    }
  }
);

expansionRouter.patch(
  '/admin/posts/:id/status',
  requireAuth,
  requireAdmin,
  requireAdminPermission('editorial'),
  async (req: AuthRequest, res) => {
    try {
      const status = ['published', 'rejected', 'pending_review'].includes(req.body?.status)
        ? req.body.status
        : 'published';
      const [updated] = await db
        .update(editorialPosts)
        .set({ status, approvedByEmail: req.dbUser!.email })
        .where(eq(editorialPosts.id, Number(req.params.id)))
        .returning();
      res.json({ post: updated });
    } catch {
      res.status(500).json({ error: 'Erro ao atualizar publicação.' });
    }
  }
);

// ========================
// ADMIN 200 AGENTS MONITOR & ORCHESTRATOR
// ========================
expansionRouter.get(
  '/admin/agents',
  requireAuth,
  requireAdmin,
  requireAdminPermission('agents'),
  async (req, res) => {
    try {
      const department = typeof req.query.department === 'string' ? req.query.department : 'all';
      const allAgents =
        department && department !== 'all'
          ? await db
              .select()
              .from(aiAgents)
              .where(eq(aiAgents.department, department))
              .orderBy(aiAgents.code)
          : await db.select().from(aiAgents).orderBy(aiAgents.code);

      const recentTasks = await db
        .select()
        .from(agentTasks)
        .orderBy(desc(agentTasks.createdAt))
        .limit(50);

      const deptCounts: Record<string, number> = {};
      let idleCount = 0;
      let runningCount = 0;
      let waitingCount = 0;
      let errorAgentsCount = 0;
      let totalTasksCompleted = 0;
      let totalAiCostUsdMicro = 0;

      for (const a of allAgents) {
        deptCounts[a.department] = (deptCounts[a.department] || 0) + 1;
        if (a.state === 'idle') idleCount += 1;
        else if (a.state === 'running') runningCount += 1;
        else if (a.state === 'waiting') waitingCount += 1;
        else errorAgentsCount += 1;
        totalTasksCompleted += a.tasksCompleted;
        totalAiCostUsdMicro += a.estimatedCostUsdMicro;
      }

      res.json({
        summary: {
          totalAgents: allAgents.length,
          idleCount,
          runningCount,
          waitingCount,
          errorAgentsCount,
          totalTasksCompleted,
          totalAiCostUsd: Number((totalAiCostUsdMicro / 1_000_000).toFixed(4)),
          departmentBreakdown: deptCounts,
        },
        agents: allAgents,
        recentTasks,
      });
    } catch (error) {
      console.error('GET /admin/agents error:', error);
      res.status(500).json({ error: 'Erro ao carregar central dos 200 agentes.' });
    }
  }
);

expansionRouter.post(
  '/admin/agents/dispatch',
  requireAuth,
  requireAdmin,
  requireAdminPermission('agents'),
  async (req: AuthRequest, res) => {
    try {
      const {
        department = 'Administração e Inteligência',
        title,
        eventName = 'MANUAL_ADMIN_DISPATCH',
        requestedAction,
        explicitApproval = false,
      } = req.body ?? {};
      if (!title) {
        return res.status(400).json({ error: 'Descrição da tarefa obrigatória.' });
      }
      const task = await dispatchAgentTask({
        department: String(department),
        triggerType: 'request',
        eventName: String(eventName),
        title: String(title).slice(0, 160),
        requestedAction: requestedAction ? String(requestedAction) : undefined,
        explicitApproval: Boolean(explicitApproval),
        input: { dispatchedBy: req.dbUser!.email },
      });
      res.status(201).json({ task });
    } catch {
      res.status(500).json({ error: 'Erro ao acionar agente.' });
    }
  }
);

// ========================
// ADMIN FINANCIAL MOTOR, SUB-ADMIN PERMISSIONS & INTEGRATIONS
// ========================
expansionRouter.get(
  '/admin/finance',
  requireAuth,
  requireAdmin,
  requireAdminPermission('finance'),
  async (_req, res) => {
    try {
      const [rules, ledger, subs] = await Promise.all([
        db.select().from(pricingRules).orderBy(pricingRules.category, pricingRules.id),
        db.select().from(financialLedger).orderBy(desc(financialLedger.createdAt)).limit(60),
        db
          .select({
            subscription: merchantSubscriptions,
            merchantName: merchants.tradeName,
            planName: merchantPlans.name,
          })
          .from(merchantSubscriptions)
          .innerJoin(merchants, eq(merchantSubscriptions.merchantId, merchants.id))
          .innerJoin(merchantPlans, eq(merchantSubscriptions.planId, merchantPlans.id))
          .orderBy(desc(merchantSubscriptions.createdAt))
          .limit(50),
      ]);

      const totals = ledger.reduce(
        (acc, e) => {
          acc.grossCents += e.finalClientCents;
          acc.platformRevenueCents += e.platformRemunerationCents;
          acc.paymentFeesCents += e.paymentFeeCents;
          acc.taxesCents += e.taxCents;
          acc.estimatedMarginCents += e.estimatedMarginCents;
          return acc;
        },
        {
          grossCents: 0,
          platformRevenueCents: 0,
          paymentFeesCents: 0,
          taxesCents: 0,
          estimatedMarginCents: 0,
        }
      );

      res.json({ rules, ledger, subscriptions: subs, totals });
    } catch {
      res.status(500).json({ error: 'Erro ao carregar motor financeiro.' });
    }
  }
);

expansionRouter.post(
  '/admin/pricing-rules',
  requireAuth,
  requireAdmin,
  requireAdminPermission('finance'),
  async (req: AuthRequest, res) => {
    try {
      const {
        name,
        category,
        markupType = 'fixed',
        markupFixedBrl = 0,
        markupPercent = 0,
        gatewayFeeBps = 399,
        taxBps = 600,
        notes = '',
      } = req.body ?? {};
      if (!name || !category) {
        return res.status(400).json({ error: 'Nome e categoria obrigatórios.' });
      }
      const ruleCode = `RULE-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const [rule] = await db
        .insert(pricingRules)
        .values({
          ruleCode,
          name: String(name).slice(0, 120),
          category: String(category).slice(0, 40),
          markupType: ['fixed', 'percent', 'hybrid'].includes(markupType) ? markupType : 'fixed',
          markupFixedCents: Math.max(0, Math.round(Number(markupFixedBrl) * 100)),
          markupBps: Math.max(0, Math.round(Number(markupPercent) * 100)),
          gatewayFeeBps: Number(gatewayFeeBps) || 399,
          taxBps: Number(taxBps) || 600,
          notes: String(notes).slice(0, 300),
          active: true,
        })
        .returning();

      await recordAuditLog({
        actorUserId: req.dbUser!.id,
        actorEmail: req.dbUser!.email,
        action: 'ADMIN_PRICING_RULE_CREATED',
        entityType: 'pricing_rule',
        entityId: ruleCode,
      });

      res.status(201).json({ rule });
    } catch {
      res.status(500).json({ error: 'Erro ao criar regra de remuneração.' });
    }
  }
);

expansionRouter.patch(
  '/admin/pricing-rules/:id',
  requireAuth,
  requireAdmin,
  requireAdminPermission('finance'),
  async (req: AuthRequest, res) => {
    try {
      const { markupFixedBrl, markupPercent, active } = req.body ?? {};
      const [updated] = await db
        .update(pricingRules)
        .set({
          ...(markupFixedBrl !== undefined
            ? { markupFixedCents: Math.max(0, Math.round(Number(markupFixedBrl) * 100)) }
            : {}),
          ...(markupPercent !== undefined
            ? { markupBps: Math.max(0, Math.round(Number(markupPercent) * 100)) }
            : {}),
          ...(active !== undefined ? { active: Boolean(active) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(pricingRules.id, Number(req.params.id)))
        .returning();

      await recordAuditLog({
        actorUserId: req.dbUser!.id,
        actorEmail: req.dbUser!.email,
        action: 'ADMIN_PRICING_RULE_UPDATED',
        entityType: 'pricing_rule',
        entityId: req.params.id,
      });

      res.json({ rule: updated });
    } catch {
      res.status(500).json({ error: 'Erro ao atualizar regra financeira.' });
    }
  }
);

expansionRouter.post(
  '/admin/subscriptions/:id/status',
  requireAuth,
  requireAdmin,
  requireAdminPermission('finance'),
  async (req: AuthRequest, res) => {
    try {
      const { status } = req.body ?? {};
      if (!['active', 'courtesy', 'suspended', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Status inválido.' });
      }
      const now = new Date();
      const [updated] = await db
        .update(merchantSubscriptions)
        .set({
          status,
          ...(status === 'courtesy'
            ? {
                startsAt: now,
                expiresAt: new Date(now.getTime() + 30 * 86400000),
                courtesyByEmail: req.dbUser!.email,
              }
            : {}),
        })
        .where(eq(merchantSubscriptions.id, Number(req.params.id)))
        .returning();

      if (updated && (status === 'courtesy' || status === 'active')) {
        await db.update(merchants).set({ planId: updated.planId }).where(eq(merchants.id, updated.merchantId));
      }

      await recordAuditLog({
        actorUserId: req.dbUser!.id,
        actorEmail: req.dbUser!.email,
        action: 'ADMIN_SUBSCRIPTION_STATUS_CHANGED',
        entityType: 'merchant_subscription',
        entityId: req.params.id,
        details: { status },
      });

      res.json({ subscription: updated });
    } catch {
      res.status(500).json({ error: 'Erro ao atualizar assinatura.' });
    }
  }
);

// Master Admin Only: Delegated Sub-Admin RBAC
expansionRouter.get('/admin/permissions', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  if (req.dbUser!.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas o Administrador Master gerencia permissões.' });
  }
  const rows = await db.select().from(adminPermissions).orderBy(desc(adminPermissions.createdAt));
  res.json({ subAdmins: rows });
});

expansionRouter.post('/admin/permissions', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  try {
    if (req.dbUser!.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas o Administrador Master pode adicionar sub-administradores.' });
    }
    const { email, label, permissions } = req.body ?? {};
    const cleanEmail = String(email ?? '').trim().toLowerCase();
    if (!cleanEmail || !Array.isArray(permissions)) {
      return res.status(400).json({ error: 'E-mail e lista de permissões são obrigatórios.' });
    }
    const [created] = await db
      .insert(adminPermissions)
      .values({
        email: cleanEmail,
        label: String(label || 'Administrador Delegado').slice(0, 80),
        permissionsJson: permissions.map(String).slice(0, 20),
        grantedByEmail: req.dbUser!.email,
        active: true,
      })
      .onConflictDoUpdate({
        target: adminPermissions.email,
        set: {
          label: String(label || 'Administrador Delegado').slice(0, 80),
          permissionsJson: permissions.map(String).slice(0, 20),
          active: true,
        },
      })
      .returning();

    await recordAuditLog({
      actorUserId: req.dbUser!.id,
      actorEmail: req.dbUser!.email,
      action: 'MASTER_ADMIN_GRANTED_SUBADMIN',
      entityType: 'admin_permission',
      entityId: cleanEmail,
      details: { permissions },
    });

    res.status(201).json({ subAdmin: created });
  } catch (error) {
    console.error('POST /admin/permissions error:', error);
    res.status(500).json({ error: 'Erro ao salvar permissões de administrador.' });
  }
});

expansionRouter.get('/admin/integrations', requireAuth, requireAdmin, async (_req, res) => {
  const oauthList = await db
    .select({
      id: oauthConnections.id,
      provider: oauthConnections.provider,
      externalAccountName: oauthConnections.externalAccountName,
      status: oauthConnections.status,
      createdAt: oauthConnections.createdAt,
    })
    .from(oauthConnections)
    .orderBy(desc(oauthConnections.createdAt))
    .limit(20);

  res.json({
    travel: getTravelIntegrationsStatus(),
    payments: getPaymentGatewayStatus(),
    googleBusinessOAuth: getGoogleBusinessOAuthConfig(),
    mercadoPagoOAuth: getMercadoPagoOAuthConfig(),
    connectedAccounts: oauthList,
    ai: {
      configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
      model: 'gemini-4-hydrogen',
    },
  });
});

// ========================
// PROMOTIONAL POP-UPS (50+ CONFIGURABLE MODELS & ADMIN MANAGEMENT)
// ========================
expansionRouter.get('/popups', async (_req, res) => {
  try {
    const popups = await listActivePopups();
    res.json({ popups, categories: POPUP_CATEGORIES });
  } catch (error) {
    console.error('GET /popups error:', error);
    res.status(500).json({ error: 'Erro ao carregar modelos de pop-ups.' });
  }
});

expansionRouter.get(
  '/admin/popups',
  requireAuth,
  requireAdmin,
  requireAdminPermission('editorial'),
  async (_req, res) => {
    try {
      const popups = await db.select().from(popupTemplates).orderBy(popupTemplates.code);
      res.json({ popups, categories: POPUP_CATEGORIES });
    } catch {
      res.status(500).json({ error: 'Erro ao carregar biblioteca de pop-ups.' });
    }
  }
);

expansionRouter.post(
  '/admin/popups',
  requireAuth,
  requireAdmin,
  requireAdminPermission('editorial'),
  async (req: AuthRequest, res) => {
    try {
      const {
        title,
        description,
        ctaLabel,
        targetAction,
        category,
        visualVariant = 'neon-emerald',
        imageUrl,
        emoji = '✨',
        priority = 80,
        durationMs = 6000,
        audience = 'all',
        campaignName = 'Campanha Personalizada',
        displayRule = 'engaged_scroll',
        validFrom = '2025-01-01',
        validUntil = '2028-12-31',
      } = req.body ?? {};

      if (!title || !description || !ctaLabel || !category) {
        return res.status(400).json({ error: 'Título, descrição, CTA e categoria são obrigatórios.' });
      }

      const safeImage =
        typeof imageUrl === 'string' && sanitizeAssetOrSafeHttpUrl(imageUrl)
          ? sanitizeAssetOrSafeHttpUrl(imageUrl)!
          : '/src/assets/images/hero_fernando_noronha_1795530548063.jpg';

      const code = `POP-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const [created] = await db
        .insert(popupTemplates)
        .values({
          code,
          title: String(title).trim().slice(0, 120),
          description: String(description).trim().slice(0, 260),
          ctaLabel: String(ctaLabel).trim().slice(0, 50),
          targetAction: String(targetAction || 'section:#destinos').trim().slice(0, 140),
          category: String(category).trim().slice(0, 60),
          visualVariant: ['neon-emerald', 'pink-pulse', 'gold-luxury', 'obsidian-neon', 'prism-tropical'].includes(
            visualVariant
          )
            ? visualVariant
            : 'neon-emerald',
          imageUrl: safeImage,
          emoji: String(emoji || '✨').slice(0, 8),
          priority: Math.max(1, Math.min(100, Number(priority) || 80)),
          durationMs: Math.max(2000, Math.min(12000, Number(durationMs) || 6000)),
          audience: ['all', 'tourists', 'merchants'].includes(audience) ? audience : 'all',
          campaignName: String(campaignName || 'Campanha Personalizada').slice(0, 100),
          displayRule: String(displayRule || 'engaged_scroll').slice(0, 60),
          validFrom: String(validFrom).slice(0, 10),
          validUntil: String(validUntil).slice(0, 10),
          active: true,
          createdByEmail: req.dbUser!.email,
        })
        .returning();

      await recordAuditLog({
        actorUserId: req.dbUser!.id,
        actorEmail: req.dbUser!.email,
        action: 'ADMIN_POPUP_CREATED',
        entityType: 'popup_template',
        entityId: code,
      });

      res.status(201).json({ popup: created });
    } catch (error) {
      console.error('POST /admin/popups error:', error);
      res.status(500).json({ error: 'Erro ao criar pop-up promocional.' });
    }
  }
);

expansionRouter.patch(
  '/admin/popups/:id',
  requireAuth,
  requireAdmin,
  requireAdminPermission('editorial'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const { active, durationMs, priority, validUntil, campaignName } = req.body ?? {};
      const [updated] = await db
        .update(popupTemplates)
        .set({
          ...(active !== undefined ? { active: Boolean(active) } : {}),
          ...(durationMs !== undefined
            ? { durationMs: Math.max(2000, Math.min(12000, Number(durationMs) || 6000)) }
            : {}),
          ...(priority !== undefined
            ? { priority: Math.max(1, Math.min(100, Number(priority) || 50)) }
            : {}),
          ...(validUntil !== undefined ? { validUntil: String(validUntil).slice(0, 10) } : {}),
          ...(campaignName !== undefined ? { campaignName: String(campaignName).slice(0, 100) } : {}),
        })
        .where(eq(popupTemplates.id, id))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: 'Pop-up não encontrado.' });
      }

      await recordAuditLog({
        actorUserId: req.dbUser!.id,
        actorEmail: req.dbUser!.email,
        action: 'ADMIN_POPUP_UPDATED',
        entityType: 'popup_template',
        entityId: updated.code,
      });

      res.json({ popup: updated });
    } catch {
      res.status(500).json({ error: 'Erro ao atualizar pop-up.' });
    }
  }
);
