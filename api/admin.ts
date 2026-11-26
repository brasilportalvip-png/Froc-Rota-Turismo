import crypto from 'node:crypto';
import { adminAuth, adminDb } from './_lib/firebase-admin.js';
import { agentVerifyMerchant } from './_lib/agent-jobs.js';
import { buildPartnerInvite } from './_lib/prospects.js';
import { dispatchAgentTask, ensure200AgentsSeeded } from './_lib/agents.js';
import { recordAuditLog } from './_lib/audit.js';
import { requireAdminContext } from './_lib/auth.js';
import { createUniqueEditorialPost, runDailyFivePostsBatch } from './_lib/editorial.js';
import { getAllDocs, nextSeqId } from './_lib/firestore-helpers.js';
import {
  getGeminiResilienceSnapshot,
  resetGeminiCircuitBreakers,
} from './_lib/gemini-resilience.js';
import {
  ApiRequest,
  ApiResponse,
  checkRateLimit,
  enforceApiSecurity,
  getHeader,
  getQuery,
  getRoutePath,
  parseJsonBody,
  sanitizeAssetOrSafeHttpUrl,
  sendJson,
} from './_lib/http.js';
import { publicIdentityStatus, IdentityCheckDoc } from './_lib/identity.js';
import { refreshMerchantListingsVisibility } from './_lib/merchant-status.js';
import { getGoogleBusinessOAuthConfig, getMercadoPagoOAuthConfig } from './_lib/oauth.js';
import { getPaymentGatewayStatus } from './_lib/payment.js';
import { SELECTABLE_POPUP_CATEGORIES } from './_lib/popups.js';
import { getSecurityPostureSnapshot } from './_lib/security.js';
import { ensureSeeded } from './_lib/seed.js';
import { getTravelIntegrationsStatus } from './_lib/travel.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!enforceApiSecurity(req, res)) return;
  if (!checkRateLimit(req, res, 'admin:api', 120, 60000)) return;
  const authHeader = getHeader(req, 'authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendJson(res, 401, { error: 'Unauthorized: Missing token' });
    return;
  }
  try {
    await ensureSeeded();
  } catch (err) {
    console.error('Seed error:', err);
    sendJson(res, 503, { error: 'Serviço temporariamente indisponível ao inicializar dados.' });
    return;
  }

  const route = getRoutePath(req);
  const query = getQuery(req);

  const byCreatedDesc = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

  // GET /api/admin/overview
  if (req.method === 'GET' && route === '/admin/overview') {
    const ctx = await requireAdminContext(req, res, 'overview');
    if (!ctx) return;

    try {
      const [
        allUsers,
        allMerchants,
        allPlans,
        allDestinations,
        allListings,
        allBookings,
        allConcierge,
        allReports,
        recentAudit,
        allPosts,
        allCampaigns,
        allAgents,
      ] = await Promise.all([
        getAllDocs<Record<string, unknown>>('users'),
        getAllDocs<Record<string, unknown>>('merchants'),
        getAllDocs<Record<string, unknown>>('merchant_plans'),
        getAllDocs<Record<string, unknown>>('destinations'),
        getAllDocs<Record<string, unknown>>('listings'),
        getAllDocs<Record<string, unknown>>('bookings'),
        getAllDocs<Record<string, unknown>>('concierge_requests'),
        getAllDocs<Record<string, unknown>>('reports'),
        getAllDocs<Record<string, unknown>>('audit_logs'),
        getAllDocs<Record<string, unknown>>('posts'),
        getAllDocs<Record<string, unknown>>('campaigns'),
        getAllDocs<Record<string, unknown>>('agents'),
      ]);

      allUsers.sort(byCreatedDesc);
      allMerchants.sort(byCreatedDesc);
      allPlans.sort((a, b) => Number(a.monthlyPriceCents || 0) - Number(b.monthlyPriceCents || 0));
      allDestinations.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      allListings.sort(byCreatedDesc);
      allBookings.sort(byCreatedDesc);
      allConcierge.sort(byCreatedDesc);
      allReports.sort(byCreatedDesc);
      recentAudit.sort(byCreatedDesc);

      const confirmedBookings = allBookings.filter((b) => b.status === 'confirmed');
      const cancelledBookings = allBookings.filter(
        (b) => b.status === 'cancelled' || b.status === 'refunded'
      );
      const gmvCents = confirmedBookings.reduce(
        (acc, b) => acc + Number(b.grossAmountCents || 0),
        0
      );
      const commissionRevenueCents = confirmedBookings.reduce(
        (acc, b) => acc + Number(b.commissionCents || 0),
        0
      );

      sendJson(res, 200, {
        metrics: {
          usersCount: allUsers.length,
          touristsCount: allUsers.filter((u) => u.role === 'tourist').length,
          merchantsCount: allMerchants.length,
          activeMerchantsCount: allMerchants.filter((m) => m.verificationStatus === 'verified')
            .length,
          destinationsCount: allDestinations.length,
          listingsCount: allListings.length,
          activeListingsCount: allListings.filter((l) => l.status === 'active').length,
          bookingsCount: allBookings.length,
          confirmedBookingsCount: confirmedBookings.length,
          cancelledBookingsCount: cancelledBookings.length,
          gmvCents,
          commissionRevenueCents,
          editorialPostsCount: allPosts.length,
          campaignsCount: allCampaigns.length,
          agentsCount: allAgents.length,
        },
        users: allUsers.slice(0, 50),
        merchants: allMerchants,
        plans: allPlans,
        destinations: allDestinations,
        listings: allListings,
        bookings: allBookings.slice(0, 50),
        conciergeRequests: allConcierge,
        reports: allReports,
        auditLogs: recentAudit.slice(0, 40),
        integrations: {
          travel: getTravelIntegrationsStatus(),
          payments: getPaymentGatewayStatus(),
          ai: {
            ...getGeminiResilienceSnapshot(),
            model: getGeminiResilienceSnapshot().cascadeModels[0],
          },
          security: getSecurityPostureSnapshot(),
        },
      });
    } catch (error) {
      console.error('GET /api/admin/overview error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar painel administrativo.' });
    }
    return;
  }

  // GET /api/admin/merchants (Scoped for sub-admins with 'merchants' without 'overview')
  if (req.method === 'GET' && route === '/admin/merchants') {
    const ctx = await requireAdminContext(req, res, 'merchants');
    if (!ctx) return;
    try {
      const [merchants, listings] = await Promise.all([
        getAllDocs<Record<string, unknown>>('merchants'),
        getAllDocs<Record<string, unknown>>('listings'),
      ]);
      merchants.sort(byCreatedDesc);
      listings.sort(byCreatedDesc);
      sendJson(res, 200, { merchants, listings });
    } catch {
      sendJson(res, 500, { error: 'Erro ao carregar parceiros.' });
    }
    return;
  }

  // PATCH /api/admin/merchants/:id/verify
  const verifyMatch = route.match(/^\/admin\/merchants\/(\d+)\/verify$/);
  if (req.method === 'PATCH' && verifyMatch) {
    const ctx = await requireAdminContext(req, res, 'merchants');
    if (!ctx) return;

    try {
      const merchantId = Number(verifyMatch[1]);
      const body = await parseJsonBody<{ status?: string; reason?: string }>(req);
      if (String(body.status) === 'ai') {
        // Pede para a IA verificar de novo (ex.: depois que o parceiro corrigiu dados).
        const r = await agentVerifyMerchant(merchantId);
        sendJson(res, 200, { verification: r });
        return;
      }
      if (!['verified', 'rejected', 'pending', 'manual_review'].includes(String(body.status))) {
        sendJson(res, 400, { error: 'Status inválido.' });
        return;
      }

      const mRef = adminDb.collection('merchants').doc(String(merchantId));
      const mSnap = await mRef.get();
      if (!mSnap.exists) {
        sendJson(res, 404, { error: 'Fornecedor não encontrado.' });
        return;
      }
      await mRef.update({
        verificationStatus: body.status,
        verificationReason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 300) : null,
        verifiedBy: ctx.dbUser.email,
        verifiedAt: new Date().toISOString(),
      });
      // Anúncios entram/saem do ar conforme verificação + plano + Mercado Pago.
      const visibility = await refreshMerchantListingsVisibility(merchantId);
      if (body.status === 'verified' && !mSnap.data()?.userUid) {
        // Parceiro de exemplo (sem conta): mantém a regra antiga de liberar os pendentes.
        const pendingListings = await adminDb
          .collection('listings')
          .where('merchantId', '==', merchantId)
          .where('status', '==', 'pending')
          .get();
        const batch = adminDb.batch();
        for (const docSnap of pendingListings.docs) batch.update(docSnap.ref, { status: 'active' });
        if (!pendingListings.empty) await batch.commit();
      }
      void visibility;

      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'ADMIN_MERCHANT_VERIFICATION',
        entityType: 'merchant',
        entityId: merchantId,
        details: { status: body.status },
      });

      sendJson(res, 200, { merchant: { ...mSnap.data(), verificationStatus: body.status } });
    } catch (error) {
      console.error('Admin verify merchant error:', error);
      sendJson(res, 500, { error: 'Erro ao atualizar verificação do fornecedor.' });
    }
    return;
  }


  // ========================
  // VERIFICAÇÃO DE IDENTIDADE (fila de revisão humana)
  // ========================
  if (req.method === 'GET' && route === '/admin/identity') {
    const ctx = await requireAdminContext(req, res, 'security');
    if (!ctx) return;
    try {
      const status = query.status || 'manual_review';
      const snap =
        status === 'all'
          ? await adminDb.collection('identity_checks').get()
          : await adminDb.collection('identity_checks').where('status', '==', status).get();
      const items = snap.docs
        .map((d) => d.data() as IdentityCheckDoc)
        .sort((a, b) => String(b.submittedAt || b.updatedAt).localeCompare(String(a.submittedAt || a.updatedAt)))
        .slice(0, 100)
        .map((c) => ({
          uid: c.uid,
          email: c.email,
          fullName: c.fullName,
          cpfMasked: c.cpfMasked,
          birthDate: c.birthDate,
          status: c.status,
          reason: c.reason,
          aiResult: c.aiResult,
          submittedAt: c.submittedAt,
          decidedAt: c.decidedAt,
          reviewedByEmail: c.reviewedByEmail,
        }));
      sendJson(res, 200, { items });
    } catch (error) {
      console.error('GET /api/admin/identity error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar verificações.' });
    }
    return;
  }

  // Fotos só aparecem para quem tem permissão de segurança, uma pessoa por vez (com registro de auditoria).
  const identityImagesMatch = route.match(/^\/admin\/identity\/([A-Za-z0-9_-]{6,128})\/images$/);
  if (req.method === 'GET' && identityImagesMatch) {
    const ctx = await requireAdminContext(req, res, 'security');
    if (!ctx) return;
    try {
      const uid = identityImagesMatch[1];
      const [d, s] = await Promise.all([
        adminDb.collection('kyc_images').doc(`${uid}_document`).get(),
        adminDb.collection('kyc_images').doc(`${uid}_selfie`).get(),
      ]);
      const toUrl = (snap: { exists: boolean; data: () => Record<string, unknown> | undefined }) =>
        snap.exists ? `data:${snap.data()?.mimeType};base64,${snap.data()?.data}` : null;
      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'ADMIN_IDENTITY_IMAGES_VIEWED',
        entityType: 'identity_check',
        entityId: uid,
      });
      sendJson(res, 200, { document: toUrl(d), selfie: toUrl(s) });
    } catch (error) {
      console.error('GET identity images error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar as fotos.' });
    }
    return;
  }

  const identityDecisionMatch = route.match(/^\/admin\/identity\/([A-Za-z0-9_-]{6,128})$/);
  if (req.method === 'PATCH' && identityDecisionMatch) {
    const ctx = await requireAdminContext(req, res, 'security');
    if (!ctx) return;
    try {
      const uid = identityDecisionMatch[1];
      const body = await parseJsonBody<{ decision?: string; reason?: string }>(req);
      const decision = String(body.decision);
      if (!['approved', 'rejected', 'release_cpf'].includes(decision)) {
        sendJson(res, 400, { error: 'Decisão inválida.' });
        return;
      }
      const ref = adminDb.collection('identity_checks').doc(uid);
      const snap = await ref.get();
      if (!snap.exists) {
        sendJson(res, 404, { error: 'Verificação não encontrada.' });
        return;
      }
      const check = snap.data() as IdentityCheckDoc;
      const nowIso = new Date().toISOString();
      if (decision === 'release_cpf') {
        // Libera o CPF preso a esta conta (ex.: o dono verdadeiro do CPF pediu ao suporte).
        if (check.cpfHash) {
          const idx = await adminDb.collection('cpf_index').doc(check.cpfHash).get();
          if (idx.exists && idx.data()?.uid === uid) await idx.ref.delete();
        }
        await ref.set({ status: 'rejected', reason: 'CPF liberado pela equipe.', decidedAt: nowIso, reviewedByEmail: ctx.dbUser.email }, { merge: true });
      } else {
        if (decision === 'approved' && check.cpfHash) {
          // Garante que o CPF não esteja em outra conta antes de aprovar.
          const idxRef = adminDb.collection('cpf_index').doc(check.cpfHash);
          const idx = await idxRef.get();
          if (idx.exists && idx.data()?.uid !== uid) {
            sendJson(res, 409, { error: 'Este CPF já pertence a outra conta.' });
            return;
          }
          if (!idx.exists) await idxRef.set({ uid, createdAt: nowIso });
        }
        if (decision === 'rejected' && check.cpfHash) {
          const idx = await adminDb.collection('cpf_index').doc(check.cpfHash).get();
          if (idx.exists && idx.data()?.uid === uid) await idx.ref.delete();
        }
        await ref.set(
          {
            status: decision,
            reason:
              decision === 'approved'
                ? 'Aprovado pela equipe.'
                : String(body.reason || 'Documento ou foto não conferem.').slice(0, 300),
            decidedAt: nowIso,
            updatedAt: nowIso,
            reviewedByEmail: ctx.dbUser.email,
          },
          { merge: true }
        );
      }
      const notifId = await nextSeqId('notifications');
      await adminDb.collection('notifications').doc(String(notifId)).set({
        id: notifId,
        userId: uid,
        numericUserId: check.userId ?? null,
        title: decision === 'approved' ? 'Identidade aprovada' : 'Verificação de identidade não aprovada',
        body:
          decision === 'approved'
            ? 'Pronto! Você já pode reservar e anunciar na Froc Rota.'
            : 'Envie novamente a foto do documento e a selfie em Minha Conta.',
        kind: 'security',
        category: 'security',
        read: false,
        createdAt: nowIso,
      });
      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'ADMIN_IDENTITY_DECISION',
        entityType: 'identity_check',
        entityId: uid,
        details: { decision },
      });
      // Se for parceiro, a IA reavalia o cadastro comercial com a identidade nova.
      if (decision === 'approved') {
        const m = await adminDb.collection('merchants').where('userUid', '==', uid).limit(1).get();
        if (!m.empty) await agentVerifyMerchant(Number(m.docs[0].data().id));
      }
      sendJson(res, 200, { identity: publicIdentityStatus((await ref.get()).data() as IdentityCheckDoc) });
    } catch (error) {
      console.error('PATCH /api/admin/identity error:', error);
      sendJson(res, 500, { error: 'Erro ao registrar a decisão.' });
    }
    return;
  }

  // GET /api/admin/reviews/hidden — avaliações ocultadas pela IA; PATCH restaura
  if (req.method === 'GET' && route === '/admin/reviews/hidden') {
    const ctx = await requireAdminContext(req, res, 'merchants');
    if (!ctx) return;
    try {
      const snap = await adminDb.collection('reviews').where('hidden', '==', true).get();
      const reviews = snap.docs.map((d) => d.data()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      sendJson(res, 200, { reviews: reviews.slice(0, 100) });
    } catch (error) {
      console.error('GET hidden reviews error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar avaliações.' });
    }
    return;
  }
  const reviewVisMatch = route.match(/^\/admin\/reviews\/(\d+)$/);
  if (req.method === 'PATCH' && reviewVisMatch) {
    const ctx = await requireAdminContext(req, res, 'merchants');
    if (!ctx) return;
    try {
      const body = await parseJsonBody<{ hidden?: boolean }>(req);
      const ref = adminDb.collection('reviews').doc(reviewVisMatch[1]);
      if (!(await ref.get()).exists) {
        sendJson(res, 404, { error: 'Avaliação não encontrada.' });
        return;
      }
      await ref.set({ hidden: body.hidden === true, hiddenBy: body.hidden === true ? ctx.dbUser.email : null }, { merge: true });
      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'ADMIN_REVIEW_VISIBILITY',
        entityType: 'review',
        entityId: reviewVisMatch[1],
        details: { hidden: body.hidden === true },
      });
      sendJson(res, 200, { ok: true });
    } catch (error) {
      console.error('PATCH review error:', error);
      sendJson(res, 500, { error: 'Erro ao atualizar avaliação.' });
    }
    return;
  }


  // ========================
  // RADAR DE PARCEIROS (negócios reais encontrados no Google Maps para convite)
  // Só o place_id do Google fica guardado (regra do Google Maps); os dados são lidos na hora.
  // ========================
  if (req.method === 'GET' && route === '/admin/prospects') {
    const ctx = await requireAdminContext(req, res, 'merchants');
    if (!ctx) return;
    try {
      const rows = await getAllDocs<Record<string, unknown>>('prospects');
      rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      sendJson(res, 200, { prospects: rows.slice(0, 300) });
    } catch (error) {
      console.error('GET prospects error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar o radar.' });
    }
    return;
  }
  if (req.method === 'POST' && route === '/admin/prospects') {
    const ctx = await requireAdminContext(req, res, 'merchants');
    if (!ctx) return;
    try {
      const body = await parseJsonBody<{ placeId?: string; destino?: string; categoria?: string }>(req);
      const placeId = String(body.placeId || '').trim();
      if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) {
        sendJson(res, 400, { error: 'Lugar inválido.' });
        return;
      }
      const dup = await adminDb.collection('prospects').where('placeId', '==', placeId).limit(1).get();
      if (!dup.empty) {
        sendJson(res, 409, { error: 'Este negócio já está no radar.' });
        return;
      }
      const id = await nextSeqId('prospects');
      const row = {
        id,
        placeId,
        destino: String(body.destino || '').slice(0, 60),
        categoria: String(body.categoria || '').slice(0, 30),
        status: 'novo',
        note: '',
        createdByEmail: ctx.dbUser.email,
        createdAt: new Date().toISOString(),
      };
      await adminDb.collection('prospects').doc(String(id)).set(row);
      sendJson(res, 201, { prospect: row });
    } catch (error) {
      console.error('POST prospects error:', error);
      sendJson(res, 500, { error: 'Erro ao salvar no radar.' });
    }
    return;
  }
  const prospectMatch = route.match(/^\/admin\/prospects\/(\d+)$/);
  if (req.method === 'PATCH' && prospectMatch) {
    const ctx = await requireAdminContext(req, res, 'merchants');
    if (!ctx) return;
    try {
      const body = await parseJsonBody<{ status?: string; note?: string }>(req);
      const allowed = ['novo', 'contatado', 'interessado', 'recusou', 'anunciante'];
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (body.status && allowed.includes(body.status)) updates.status = body.status;
      if (typeof body.note === 'string') updates.note = body.note.slice(0, 500);
      await adminDb.collection('prospects').doc(prospectMatch[1]).set(updates, { merge: true });
      sendJson(res, 200, { ok: true });
    } catch (error) {
      console.error('PATCH prospect error:', error);
      sendJson(res, 500, { error: 'Erro ao atualizar.' });
    }
    return;
  }
  if (req.method === 'POST' && route === '/admin/prospects/invite') {
    const ctx = await requireAdminContext(req, res, 'merchants');
    if (!ctx) return;
    try {
      const body = await parseJsonBody<{ businessName?: string; destino?: string; categoria?: string }>(req);
      const text = await buildPartnerInvite({
        businessName: String(body.businessName || '').slice(0, 80),
        destinoSlug: String(body.destino || ''),
        categoria: String(body.categoria || ''),
      });
      await dispatchAgentTask({
        department: 'Anunciantes e Anúncios',
        triggerType: 'event',
        eventName: 'PARTNER_INVITE_DRAFT',
        title: `Convite para ${String(body.businessName || 'parceiro').slice(0, 60)}`,
        input: { destino: body.destino, categoria: body.categoria },
      });
      sendJson(res, 200, { text });
    } catch (error) {
      console.error('POST invite error:', error);
      sendJson(res, 500, { error: 'Erro ao gerar convite.' });
    }
    return;
  }

  // GET /api/admin/agent-reports — relatórios diários escritos pelos agentes
  if (req.method === 'GET' && route === '/admin/agent-reports') {
    const ctx = await requireAdminContext(req, res, 'agents');
    if (!ctx) return;
    try {
      const reports = await getAllDocs<Record<string, unknown>>('agent_reports');
      reports.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      sendJson(res, 200, { reports: reports.slice(0, 30) });
    } catch (error) {
      console.error('GET /api/admin/agent-reports error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar relatórios.' });
    }
    return;
  }

  // POST /api/admin/agents/run-daily — roda agora a rotina diária dos agentes (a mesma do cron)
  if (req.method === 'POST' && route === '/admin/agents/run-daily') {
    const ctx = await requireAdminContext(req, res, 'agents');
    if (!ctx) return;
    try {
      const { runDailyAgentRoutine } = await import('./_lib/agent-jobs.js');
      const result = await runDailyAgentRoutine();
      sendJson(res, 200, { result });
    } catch (error) {
      console.error('POST /api/admin/agents/run-daily error:', error);
      sendJson(res, 500, { error: 'Erro ao rodar a rotina dos agentes.' });
    }
    return;
  }

  // PATCH /api/admin/plans/:id
  const planMatch = route.match(/^\/admin\/plans\/(\d+)$/);
  if (req.method === 'PATCH' && planMatch) {
    const ctx = await requireAdminContext(req, res, 'finance');
    if (!ctx) return;
    try {
      const ref = adminDb.collection('merchant_plans').doc(planMatch[1]);
      const snap = await ref.get();
      if (!snap.exists) {
        sendJson(res, 404, { error: 'Plano não encontrado.' });
        return;
      }
      const body = await parseJsonBody<{
        monthlyPriceCents?: number;
        commissionBps?: number;
        maxListings?: number;
      }>(req);
      const updates = {
        monthlyPriceCents: Math.max(0, Number(body.monthlyPriceCents) || 0),
        commissionBps: Math.max(100, Math.min(4000, Number(body.commissionBps) || 1200)),
        maxListings: Math.max(1, Number(body.maxListings) || 3),
      };
      await ref.update(updates);

      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'ADMIN_PLAN_UPDATED',
        entityType: 'merchant_plan',
        entityId: planMatch[1],
        details: updates,
      });
      sendJson(res, 200, { plan: { ...snap.data(), ...updates } });
    } catch (error) {
      console.error('Admin update plan error:', error);
      sendJson(res, 500, { error: 'Erro ao atualizar plano.' });
    }
    return;
  }

  // PATCH /api/admin/concierge/:id
  const conciergeMatch = route.match(/^\/admin\/concierge\/(\d+)$/);
  if (req.method === 'PATCH' && conciergeMatch) {
    const ctx = await requireAdminContext(req, res, 'overview');
    if (!ctx) return;
    try {
      const ref = adminDb.collection('concierge_requests').doc(conciergeMatch[1]);
      const snap = await ref.get();
      if (!snap.exists) {
        sendJson(res, 404, { error: 'Solicitação não encontrada.' });
        return;
      }
      const body = await parseJsonBody<{
        status?: string;
        proposalSummary?: string;
        proposalAmountBrl?: number;
      }>(req);
      const updates = {
        status: String(body.status || 'proposal_sent'),
        proposalSummary: body.proposalSummary ? String(body.proposalSummary).slice(0, 1500) : null,
        proposalAmountCents: body.proposalAmountBrl
          ? Math.round(Number(body.proposalAmountBrl) * 100)
          : null,
      };
      await ref.update(updates);
      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'ADMIN_CONCIERGE_PROPOSAL',
        entityType: 'concierge_request',
        entityId: conciergeMatch[1],
        details: { status: updates.status, proposalAmountBrl: body.proposalAmountBrl },
      });
      sendJson(res, 200, { request: { ...snap.data(), ...updates } });
    } catch (error) {
      console.error('Admin concierge update error:', error);
      sendJson(res, 500, { error: 'Erro ao atualizar proposta concierge.' });
    }
    return;
  }

  // PATCH /api/admin/reports/:id
  const reportMatch = route.match(/^\/admin\/reports\/(\d+)$/);
  if (req.method === 'PATCH' && reportMatch) {
    const ctx = await requireAdminContext(req, res, 'overview');
    if (!ctx) return;
    try {
      const ref = adminDb.collection('reports').doc(reportMatch[1]);
      const snap = await ref.get();
      if (!snap.exists) {
        sendJson(res, 404, { error: 'Denúncia não encontrada.' });
        return;
      }
      const body = await parseJsonBody<{ status?: string }>(req);
      const status = ['resolved', 'dismissed', 'open'].includes(String(body.status))
        ? String(body.status)
        : 'resolved';
      await ref.update({ status });
      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'ADMIN_REPORT_UPDATED',
        entityType: 'report',
        entityId: reportMatch[1],
        details: { status },
      });
      sendJson(res, 200, { report: { ...snap.data(), status } });
    } catch (error) {
      console.error('Admin report update error:', error);
      sendJson(res, 500, { error: 'Erro ao atualizar denúncia.' });
    }
    return;
  }

  // GET /api/admin/integrations
  if (req.method === 'GET' && route === '/admin/integrations') {
    const ctx = await requireAdminContext(req, res, 'integrations');
    if (!ctx) return;
    try {
      const allOauth = await getAllDocs<Record<string, unknown>>('oauth_connections');
      allOauth.sort(byCreatedDesc);
      const connectedAccounts = allOauth.slice(0, 20).map((c) => ({
        id: c.id,
        provider: c.provider,
        externalAccountName: c.externalAccountName ?? null,
        status: c.status,
        createdAt: c.createdAt,
      }));

      sendJson(res, 200, {
        travel: getTravelIntegrationsStatus(),
        payments: getPaymentGatewayStatus(),
        googleBusinessOAuth: getGoogleBusinessOAuthConfig(),
        mercadoPagoOAuth: getMercadoPagoOAuthConfig(),
        connectedAccounts,
        ai: {
          ...getGeminiResilienceSnapshot(),
          model: getGeminiResilienceSnapshot().cascadeModels[0],
        },
        security: getSecurityPostureSnapshot(),
      });
    } catch {
      sendJson(res, 500, { error: 'Erro ao carregar integrações.' });
    }
    return;
  }

  // Editorial: GET/POST /api/admin/posts, POST /api/admin/posts/run-daily, PATCH /api/admin/posts/:id/status
  if (req.method === 'GET' && route === '/admin/posts') {
    const ctx = await requireAdminContext(req, res, 'editorial');
    if (!ctx) return;
    try {
      const posts = await getAllDocs<Record<string, unknown>>('posts');
      posts.sort(byCreatedDesc);
      sendJson(res, 200, { posts: posts.slice(0, 60) });
    } catch {
      sendJson(res, 500, { error: 'Erro ao carregar fila editorial.' });
    }
    return;
  }

  if (req.method === 'POST' && route === '/admin/posts/run-daily') {
    const ctx = await requireAdminContext(req, res, 'editorial');
    if (!ctx) return;
    try {
      const body = await parseJsonBody<{ publishDate?: string }>(req);
      const result = await runDailyFivePostsBatch(body.publishDate);
      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'EDITORIAL_DAILY_BATCH_RUN',
        entityType: 'editorial_post',
        entityId: new Date().toISOString().slice(0, 10),
        details: { createdCount: result.created.length },
      });
      sendJson(res, 200, result);
    } catch (error) {
      console.error('run-daily error:', error);
      sendJson(res, 500, { error: 'Erro ao executar lote diário de publicações.' });
    }
    return;
  }

  if (req.method === 'POST' && route === '/admin/posts') {
    const ctx = await requireAdminContext(req, res, 'editorial');
    if (!ctx) return;
    try {
      const body = await parseJsonBody<{
        title?: string;
        body?: string;
        category?: string;
        destinationSlug?: string;
        coverImage?: string;
        keywords?: string[];
        riskTier?: string;
      }>(req);
      if (!body.title || !body.body || !body.category || !body.coverImage) {
        sendJson(res, 400, {
          error: 'Título, texto, categoria e imagem licenciada são obrigatórios.',
        });
        return;
      }
      const created = await createUniqueEditorialPost({
        title: String(body.title),
        body: String(body.body),
        category: String(body.category),
        destinationSlug: body.destinationSlug ? String(body.destinationSlug) : undefined,
        coverImage: String(body.coverImage),
        keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : [],
        riskTier: body.riskTier === 'low_auto' ? 'low_auto' : 'commercial_review',
      });
      sendJson(res, 201, { post: created });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Erro ao criar post.';
      if (msg.startsWith('DUPLICATE_')) {
        sendJson(res, 409, {
          error: `Bloqueado pela regra anti-duplicidade (${msg}). É proibido repetir conteúdo ou imagem diária.`,
        });
        return;
      }
      sendJson(res, 500, { error: msg });
    }
    return;
  }

  const postStatusMatch = route.match(/^\/admin\/posts\/(\d+)\/status$/);
  if (req.method === 'PATCH' && postStatusMatch) {
    const ctx = await requireAdminContext(req, res, 'editorial');
    if (!ctx) return;
    try {
      const ref = adminDb.collection('posts').doc(postStatusMatch[1]);
      const snap = await ref.get();
      if (!snap.exists) {
        sendJson(res, 404, { error: 'Publicação não encontrada.' });
        return;
      }
      const body = await parseJsonBody<{ status?: string }>(req);
      const status = ['published', 'rejected', 'pending_review'].includes(String(body.status))
        ? String(body.status)
        : 'published';
      await ref.update({ status, approvedByEmail: ctx.dbUser.email });
      sendJson(res, 200, {
        post: { ...snap.data(), status, approvedByEmail: ctx.dbUser.email },
      });
    } catch {
      sendJson(res, 500, { error: 'Erro ao atualizar publicação.' });
    }
    return;
  }

  // Popups: GET/POST /api/admin/popups, PATCH /api/admin/popups/:id
  if (req.method === 'GET' && route === '/admin/popups') {
    const ctx = await requireAdminContext(req, res, 'editorial');
    if (!ctx) return;
    try {
      const popups = await getAllDocs<{ code: string }>('popup_templates');
      popups.sort((a, b) => String(a.code).localeCompare(String(b.code)));
      sendJson(res, 200, { popups, categories: SELECTABLE_POPUP_CATEGORIES });
    } catch {
      sendJson(res, 500, { error: 'Erro ao carregar biblioteca de pop-ups.' });
    }
    return;
  }

  if (req.method === 'POST' && route === '/admin/popups') {
    const ctx = await requireAdminContext(req, res, 'editorial');
    if (!ctx) return;
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
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
      } = body;

      if (!title || !description || !ctaLabel || !category) {
        sendJson(res, 400, { error: 'Título, descrição, CTA e categoria são obrigatórios.' });
        return;
      }

      const safeImage =
        typeof imageUrl === 'string' && sanitizeAssetOrSafeHttpUrl(imageUrl)
          ? sanitizeAssetOrSafeHttpUrl(imageUrl)!
          : '/src/assets/images/hero_fernando_noronha_1795530548063.jpg';

      const id = await nextSeqId('popup_templates');
      const code = `POP-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const created = {
        id,
        code,
        title: String(title).trim().slice(0, 120),
        description: String(description).trim().slice(0, 260),
        ctaLabel: String(ctaLabel).trim().slice(0, 50),
        targetAction: String(targetAction || 'section:#destinos').trim().slice(0, 140),
        category: String(category).trim().slice(0, 60),
        visualVariant: [
          'neon-emerald',
          'pink-pulse',
          'gold-luxury',
          'obsidian-neon',
          'prism-tropical',
        ].includes(String(visualVariant))
          ? String(visualVariant)
          : 'neon-emerald',
        imageUrl: safeImage,
        emoji: String(emoji || '✨').slice(0, 8),
        priority: Math.max(1, Math.min(100, Number(priority) || 80)),
        durationMs: Math.max(2000, Math.min(12000, Number(durationMs) || 6000)),
        audience: ['all', 'tourists', 'merchants'].includes(String(audience))
          ? String(audience)
          : 'all',
        campaignName: String(campaignName || 'Campanha Personalizada').slice(0, 100),
        displayRule: String(displayRule || 'engaged_scroll').slice(0, 60),
        validFrom: String(validFrom).slice(0, 10),
        validUntil: String(validUntil).slice(0, 10),
        active: true,
        createdByEmail: ctx.dbUser.email,
        createdAt: new Date().toISOString(),
      };

      await adminDb.collection('popup_templates').doc(code).set(created);
      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'ADMIN_POPUP_CREATED',
        entityType: 'popup_template',
        entityId: code,
      });

      sendJson(res, 201, { popup: created });
    } catch (error) {
      console.error('POST /api/admin/popups error:', error);
      sendJson(res, 500, { error: 'Erro ao criar pop-up promocional.' });
    }
    return;
  }

  const popupMatch = route.match(/^\/admin\/popups\/(\d+)$/);
  if (req.method === 'PATCH' && popupMatch) {
    const ctx = await requireAdminContext(req, res, 'editorial');
    if (!ctx) return;
    try {
      const targetId = Number(popupMatch[1]);
      const snap = await adminDb
        .collection('popup_templates')
        .where('id', '==', targetId)
        .limit(1)
        .get();
      if (snap.empty) {
        sendJson(res, 404, { error: 'Pop-up não encontrado.' });
        return;
      }
      const docSnap = snap.docs[0];
      const existing = docSnap.data() as { code: string };
      const body = await parseJsonBody<{
        active?: boolean;
        durationMs?: number;
        priority?: number;
        validUntil?: string;
        campaignName?: string;
      }>(req);

      const updates: Record<string, unknown> = {
        ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
        ...(body.durationMs !== undefined
          ? { durationMs: Math.max(2000, Math.min(12000, Number(body.durationMs) || 6000)) }
          : {}),
        ...(body.priority !== undefined
          ? { priority: Math.max(1, Math.min(100, Number(body.priority) || 50)) }
          : {}),
        ...(body.validUntil !== undefined ? { validUntil: String(body.validUntil).slice(0, 10) } : {}),
        ...(body.campaignName !== undefined
          ? { campaignName: String(body.campaignName).slice(0, 100) }
          : {}),
      };

      await docSnap.ref.update(updates);
      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'ADMIN_POPUP_UPDATED',
        entityType: 'popup_template',
        entityId: existing.code,
      });

      sendJson(res, 200, { popup: { ...existing, ...updates } });
    } catch {
      sendJson(res, 500, { error: 'Erro ao atualizar pop-up.' });
    }
    return;
  }

  // Agents: GET /api/admin/agents, POST /api/admin/agents/dispatch
  if (req.method === 'GET' && route === '/admin/agents') {
    const ctx = await requireAdminContext(req, res, 'agents');
    if (!ctx) return;
    try {
      await ensure200AgentsSeeded();
      const department = query.department || 'all';
      const [allAgentsRaw, allTasks] = await Promise.all([
        getAllDocs<{
          code: string;
          department: string;
          state: string;
          tasksCompleted: number;
          estimatedCostUsdMicro: number;
        }>('agents'),
        getAllDocs<Record<string, unknown>>('agent_tasks'),
      ]);

      allAgentsRaw.sort((a, b) => String(a.code).localeCompare(String(b.code)));
      allTasks.sort(byCreatedDesc);

      const filteredAgents =
        department && department !== 'all'
          ? allAgentsRaw.filter((a) => a.department === department)
          : allAgentsRaw;

      const deptCounts: Record<string, number> = {};
      let idleCount = 0;
      let runningCount = 0;
      let waitingCount = 0;
      let errorAgentsCount = 0;
      let totalTasksCompleted = 0;
      let totalAiCostUsdMicro = 0;

      for (const a of filteredAgents) {
        deptCounts[a.department] = (deptCounts[a.department] || 0) + 1;
        if (a.state === 'idle') idleCount += 1;
        else if (a.state === 'running') runningCount += 1;
        else if (a.state === 'waiting') waitingCount += 1;
        else errorAgentsCount += 1;
        totalTasksCompleted += Number(a.tasksCompleted || 0);
        totalAiCostUsdMicro += Number(a.estimatedCostUsdMicro || 0);
      }

      sendJson(res, 200, {
        summary: {
          totalAgents: filteredAgents.length,
          idleCount,
          runningCount,
          waitingCount,
          errorAgentsCount,
          totalTasksCompleted,
          totalAiCostUsd: Number((totalAiCostUsdMicro / 1_000_000).toFixed(4)),
          departmentBreakdown: deptCounts,
        },
        agents: filteredAgents,
        recentTasks: allTasks.slice(0, 50),
      });
    } catch (error) {
      console.error('GET /api/admin/agents error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar central dos 200 agentes.' });
    }
    return;
  }

  if (req.method === 'POST' && route === '/admin/agents/dispatch') {
    const ctx = await requireAdminContext(req, res, 'agents');
    if (!ctx) return;
    try {
      const body = await parseJsonBody<{
        department?: string;
        title?: string;
        eventName?: string;
        requestedAction?: string;
        explicitApproval?: boolean;
      }>(req);
      if (!body.title) {
        sendJson(res, 400, { error: 'Descrição da tarefa obrigatória.' });
        return;
      }
      const task = await dispatchAgentTask({
        department: String(body.department || 'Administração e Inteligência'),
        triggerType: 'request',
        eventName: String(body.eventName || 'MANUAL_ADMIN_DISPATCH'),
        title: String(body.title).slice(0, 160),
        requestedAction: body.requestedAction ? String(body.requestedAction) : undefined,
        explicitApproval: Boolean(body.explicitApproval),
        input: { dispatchedBy: ctx.dbUser.email },
      });
      sendJson(res, 201, { task });
    } catch {
      sendJson(res, 500, { error: 'Erro ao acionar agente.' });
    }
    return;
  }

  // Finance: GET /api/admin/finance, POST/PATCH /api/admin/pricing-rules, POST /api/admin/subscriptions/:id/status
  if (req.method === 'GET' && route === '/admin/finance') {
    const ctx = await requireAdminContext(req, res, 'finance');
    if (!ctx) return;
    try {
      const [rules, ledgerRaw, subsRaw, allMerchants, allPlans] = await Promise.all([
        getAllDocs<{ id: number; category: string }>('pricing_rules'),
        getAllDocs<Record<string, unknown>>('financial_ledger'),
        getAllDocs<Record<string, unknown>>('merchant_subscriptions'),
        getAllDocs<{ id: number; tradeName: string }>('merchants'),
        getAllDocs<{ id: number; name: string }>('merchant_plans'),
      ]);

      rules.sort((a, b) => {
        const c = String(a.category).localeCompare(String(b.category));
        return c !== 0 ? c : a.id - b.id;
      });
      ledgerRaw.sort(byCreatedDesc);
      subsRaw.sort(byCreatedDesc);

      const ledger = ledgerRaw.slice(0, 60);
      const merchMap = new Map(allMerchants.map((m) => [m.id, m.tradeName]));
      const planMap = new Map(allPlans.map((p) => [p.id, p.name]));

      const subscriptions = subsRaw.slice(0, 50).map((subscription) => ({
        subscription,
        merchantName: merchMap.get(Number(subscription.merchantId)) || 'Parceiro',
        planName: planMap.get(Number(subscription.planId)) || 'Plano',
      }));

      const totals = ledger.reduce<{
        grossCents: number;
        platformRevenueCents: number;
        paymentFeesCents: number;
        taxesCents: number;
        estimatedMarginCents: number;
      }>(
        (acc, e) => {
          acc.grossCents += Number(e.finalClientCents || 0);
          acc.platformRevenueCents += Number(e.platformRemunerationCents || 0);
          acc.paymentFeesCents += Number(e.paymentFeeCents || 0);
          acc.taxesCents += Number(e.taxCents || 0);
          acc.estimatedMarginCents += Number(e.estimatedMarginCents || 0);
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

      sendJson(res, 200, { rules, ledger, subscriptions, totals });
    } catch {
      sendJson(res, 500, { error: 'Erro ao carregar motor financeiro.' });
    }
    return;
  }

  if (req.method === 'POST' && route === '/admin/pricing-rules') {
    const ctx = await requireAdminContext(req, res, 'finance');
    if (!ctx) return;
    try {
      const body = await parseJsonBody<{
        name?: string;
        category?: string;
        markupType?: string;
        markupFixedBrl?: number;
        markupPercent?: number;
        gatewayFeeBps?: number;
        taxBps?: number;
        notes?: string;
      }>(req);

      if (!body.name || !body.category) {
        sendJson(res, 400, { error: 'Nome e categoria obrigatórios.' });
        return;
      }

      const id = await nextSeqId('pricing_rules');
      const ruleCode = `RULE-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const rule = {
        id,
        ruleCode,
        name: String(body.name).slice(0, 120),
        category: String(body.category).slice(0, 40),
        serviceType: 'all',
        merchantId: null,
        planSlug: 'all',
        markupType: ['fixed', 'percent', 'hybrid'].includes(String(body.markupType))
          ? String(body.markupType)
          : 'fixed',
        markupFixedCents: Math.max(0, Math.round(Number(body.markupFixedBrl || 0) * 100)),
        markupBps: Math.max(0, Math.round(Number(body.markupPercent || 0) * 100)),
        minPriceCents: 0,
        maxPriceCents: 100000000,
        gatewayFeeBps: Number(body.gatewayFeeBps) || 399,
        taxBps: Number(body.taxBps) || 600,
        maxFinalMarkupRatioBps: 10000,
        active: true,
        notes: String(body.notes || '').slice(0, 300),
        updatedAt: new Date().toISOString(),
      };

      await adminDb.collection('pricing_rules').doc(String(id)).set(rule);
      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'ADMIN_PRICING_RULE_CREATED',
        entityType: 'pricing_rule',
        entityId: ruleCode,
      });

      sendJson(res, 201, { rule });
    } catch {
      sendJson(res, 500, { error: 'Erro ao criar regra de remuneração.' });
    }
    return;
  }

  const ruleMatch = route.match(/^\/admin\/pricing-rules\/(\d+)$/);
  if (req.method === 'PATCH' && ruleMatch) {
    const ctx = await requireAdminContext(req, res, 'finance');
    if (!ctx) return;
    try {
      const ref = adminDb.collection('pricing_rules').doc(ruleMatch[1]);
      const snap = await ref.get();
      if (!snap.exists) {
        sendJson(res, 404, { error: 'Regra financeira não encontrada.' });
        return;
      }
      const body = await parseJsonBody<{
        markupFixedBrl?: number;
        markupPercent?: number;
        active?: boolean;
      }>(req);

      const updates: Record<string, unknown> = {
        ...(body.markupFixedBrl !== undefined
          ? { markupFixedCents: Math.max(0, Math.round(Number(body.markupFixedBrl) * 100)) }
          : {}),
        ...(body.markupPercent !== undefined
          ? { markupBps: Math.max(0, Math.round(Number(body.markupPercent) * 100)) }
          : {}),
        ...(body.active !== undefined ? { active: Boolean(body.active) } : {}),
        updatedAt: new Date().toISOString(),
      };

      await ref.update(updates);
      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'ADMIN_PRICING_RULE_UPDATED',
        entityType: 'pricing_rule',
        entityId: ruleMatch[1],
      });

      sendJson(res, 200, { rule: { ...snap.data(), ...updates } });
    } catch {
      sendJson(res, 500, { error: 'Erro ao atualizar regra financeira.' });
    }
    return;
  }

  const subStatusMatch = route.match(/^\/admin\/subscriptions\/(\d+)\/status$/);
  if (req.method === 'POST' && subStatusMatch) {
    const ctx = await requireAdminContext(req, res, 'finance');
    if (!ctx) return;
    try {
      const ref = adminDb.collection('merchant_subscriptions').doc(subStatusMatch[1]);
      const snap = await ref.get();
      if (!snap.exists) {
        sendJson(res, 404, { error: 'Assinatura não encontrada.' });
        return;
      }
      const existing = snap.data() as { merchantId: number; planId: number };
      const body = await parseJsonBody<{ status?: string }>(req);
      const status = String(body.status || '');
      if (!['active', 'courtesy', 'suspended', 'cancelled'].includes(status)) {
        sendJson(res, 400, { error: 'Status inválido.' });
        return;
      }

      const now = new Date();
      const updates: Record<string, unknown> = {
        status,
        ...(status === 'courtesy'
          ? {
              startsAt: now.toISOString(),
              expiresAt: new Date(now.getTime() + 30 * 86400000).toISOString(),
              courtesyByEmail: ctx.dbUser.email,
            }
          : {}),
      };
      await ref.update(updates);

      if (status === 'courtesy' || status === 'active') {
        await adminDb
          .collection('merchants')
          .doc(String(existing.merchantId))
          .set({ planId: existing.planId }, { merge: true });
      }

      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'ADMIN_SUBSCRIPTION_STATUS_CHANGED',
        entityType: 'merchant_subscription',
        entityId: subStatusMatch[1],
        details: { status },
      });

      sendJson(res, 200, { subscription: { ...existing, ...updates } });
    } catch {
      sendJson(res, 500, { error: 'Erro ao atualizar assinatura.' });
    }
    return;
  }

  // Master Admin Only: GET/POST /api/admin/permissions
  if (req.method === 'GET' && route === '/admin/permissions') {
    const ctx = await requireAdminContext(req, res);
    if (!ctx) return;
    if (ctx.dbUser.role !== 'admin') {
      sendJson(res, 403, { error: 'Apenas o Administrador Master gerencia permissões.' });
      return;
    }
    const subAdmins = await getAllDocs<Record<string, unknown>>('admin_permissions');
    subAdmins.sort(byCreatedDesc);
    sendJson(res, 200, { subAdmins });
    return;
  }

  if (req.method === 'POST' && route === '/admin/permissions') {
    const ctx = await requireAdminContext(req, res);
    if (!ctx) return;
    if (ctx.dbUser.role !== 'admin') {
      sendJson(res, 403, {
        error: 'Apenas o Administrador Master pode adicionar sub-administradores.',
      });
      return;
    }
    try {
      const body = await parseJsonBody<{
        email?: string;
        label?: string;
        permissions?: string[];
        active?: boolean;
      }>(req);
      const cleanEmail = String(body.email ?? '').trim().toLowerCase();
      if (!cleanEmail || !Array.isArray(body.permissions)) {
        sendJson(res, 400, { error: 'E-mail e lista de permissões são obrigatórios.' });
        return;
      }

      const permRef = adminDb.collection('admin_permissions').doc(cleanEmail);
      const existingSnap = await permRef.get();
      const id = existingSnap.exists
        ? Number(existingSnap.data()?.id || (await nextSeqId('admin_permissions')))
        : await nextSeqId('admin_permissions');
      const isActive = body.active !== false;
      const cleanPerms = body.permissions.map(String).slice(0, 20);

      const created = {
        id,
        email: cleanEmail,
        label: String(body.label || 'Administrador Delegado').slice(0, 80),
        permissionsJson: cleanPerms,
        grantedByEmail: ctx.dbUser.email,
        active: isActive,
        createdAt: existingSnap.exists
          ? String(existingSnap.data()?.createdAt || new Date().toISOString())
          : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await permRef.set(created, { merge: true });

      // Immediately propagate custom claims if target user already exists in Firebase Auth
      try {
        const fbUser = await adminAuth.getUserByEmail(cleanEmail);
        if (fbUser.emailVerified && isActive && cleanPerms.length > 0) {
          await adminAuth.setCustomUserClaims(fbUser.uid, { frocAdmin: true });
          await adminDb
            .collection('admins')
            .doc(fbUser.uid)
            .set(
              {
                uid: fbUser.uid,
                email: cleanEmail,
                permissions: cleanPerms,
                grantedBy: ctx.dbUser.email,
                updatedAt: new Date(),
              },
              { merge: true }
            );
        } else if (!isActive || cleanPerms.length === 0) {
          await adminAuth.setCustomUserClaims(fbUser.uid, { frocAdmin: false });
          await adminDb.collection('admins').doc(fbUser.uid).delete().catch(() => {});
        }
      } catch {
        // User has not signed in yet; claims will apply automatically on first login
      }

      await recordAuditLog({
        actorUserId: ctx.dbUser.id,
        actorEmail: ctx.dbUser.email,
        action: 'MASTER_ADMIN_GRANTED_SUBADMIN',
        entityType: 'admin_permission',
        entityId: cleanEmail,
        details: { permissions: cleanPerms, active: isActive },
      });

      sendJson(res, 201, { subAdmin: created });
    } catch (error) {
      console.error('POST /api/admin/permissions error:', error);
      sendJson(res, 500, { error: 'Erro ao salvar permissões de administrador.' });
    }
    return;
  }

  // Security & Gemini Anti-Outage Status: GET /api/admin/security/status
  if (req.method === 'GET' && route === '/admin/security/status') {
    const ctx = await requireAdminContext(req, res, 'security');
    if (!ctx) return;
    sendJson(res, 200, {
      geminiResilience: getGeminiResilienceSnapshot(),
      securityPosture: getSecurityPostureSnapshot(),
    });
    return;
  }

  // Reset Gemini Circuit Breakers: POST /api/admin/security/reset-ai-circuit
  if (req.method === 'POST' && route === '/admin/security/reset-ai-circuit') {
    const ctx = await requireAdminContext(req, res, 'security');
    if (!ctx) return;
    resetGeminiCircuitBreakers();
    await recordAuditLog({
      actorUserId: ctx.dbUser.id,
      actorEmail: ctx.dbUser.email,
      action: 'ADMIN_GEMINI_CIRCUITS_RESET',
      entityType: 'ai_resilience',
      entityId: 'gemini-cascade',
    });
    sendJson(res, 200, {
      reset: true,
      geminiResilience: getGeminiResilienceSnapshot(),
    });
    return;
  }

  sendJson(res, 404, { error: 'Rota administrativa não encontrada.' });
}
