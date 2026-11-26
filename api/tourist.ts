import crypto from 'node:crypto';
import { liberarReservasVencidas } from './_lib/reservas.js';
import { assetParaFotoReal } from './_lib/fotos.js';
import { adminDb } from './_lib/firebase-admin.js';
import { agentModerateReview } from './_lib/agent-jobs.js';
import { dispatchAgentTask } from './_lib/agents.js';
import { askFrocRotaAI } from './_lib/ai.js';
import { recordAuditLog } from './_lib/audit.js';
import { hasAdminPermission, authenticateRequest } from './_lib/auth.js';
import { getAllDocs, nextSeqId } from './_lib/firestore-helpers.js';
import {
  analyzeIdentityWithAI,
  cpfHash,
  decideIdentity,
  getIdentityCheck,
  IdentityCheckDoc,
  isValidCpf,
  maskCpf,
  normalizeCpf,
  parseImageDataUrl,
  publicIdentityStatus,
} from './_lib/identity.js';
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
import {
  computePriceFromRule,
  recordImmutableLedgerEntry,
  resolvePricingRule,
} from './_lib/pricing.js';
import { ensureSeeded } from './_lib/seed.js';

async function verifyAuthoritativeFlightFareCents(params: {
  originIata: string;
  destinationIata: string;
  departureDate: string;
  returnDate?: string | null;
  tripType: string;
  adults: number;
  flightNumber?: string | null;
  carrierCode?: string | null;
}): Promise<number | null> {
  const clientId = process.env.AMADEUS_CLIENT_ID;
  const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const tokenRes = await fetch('https://test.api.amadeus.com/v1/security/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!tokenRes.ok) return null;
  const tokenData = (await tokenRes.json()) as { access_token: string };

  const qs = new URLSearchParams({
    originLocationCode: params.originIata.toUpperCase().slice(0, 3),
    destinationLocationCode: params.destinationIata.toUpperCase().slice(0, 3),
    departureDate: params.departureDate,
    adults: String(Math.max(1, Math.min(9, params.adults))),
    currencyCode: 'BRL',
    max: '20',
  });
  if (params.returnDate && params.tripType === 'round_trip') {
    qs.set('returnDate', params.returnDate);
  }

  const offersRes = await fetch(
    `https://test.api.amadeus.com/v2/shopping/flight-offers?${qs.toString()}`,
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
  );
  if (!offersRes.ok) return null;

  const offersJson = (await offersRes.json()) as {
    data?: Array<{
      price?: { total?: string };
      itineraries?: Array<{
        segments?: Array<{ carrierCode?: string; number?: string }>;
      }>;
    }>;
  };
  const offers = offersJson.data ?? [];
  const matched =
    offers.find((o) => {
      const seg = o.itineraries?.[0]?.segments?.[0];
      if (!seg) return false;
      const carrierMatch = !params.carrierCode || seg.carrierCode === params.carrierCode;
      const flightMatch = !params.flightNumber || seg.number === params.flightNumber;
      return carrierMatch && flightMatch;
    }) ?? offers[0];

  const totalNum = Number(matched?.price?.total);
  if (!Number.isFinite(totalNum) || totalNum <= 0) return null;
  return Math.round(totalNum * 100);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!enforceApiSecurity(req, res)) return;
  if (!checkRateLimit(req, res, 'tourist:api', 120, 60000)) return;
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

  const auth = await authenticateRequest(req, res);
  if (!auth) return;
  const user = auth.dbUser;
  // Equipe só vê/atende conversas de outros com a permissão "chat" (o dono tem todas).
  const isStaff =
    auth.authUser.email_verified === true &&
    (user.role === 'admin' || user.role === 'subadmin') &&
    hasAdminPermission(auth.adminPermissions ?? [], 'chat');

  // ========================
  // USER PROFILE (/api/me)
  // ========================
  if (req.method === 'GET' && route === '/me') {
    try {
      const merchantSnap = await adminDb
        .collection('merchants')
        .where('userId', '==', user.id)
        .limit(1)
        .get();
      const merchant = merchantSnap.empty ? null : merchantSnap.docs[0].data();
      const identityCheck = await getIdentityCheck(user.uid);
      sendJson(res, 200, {
        user,
        merchant,
        adminPermissions: auth.adminPermissions,
        emailVerified: auth.authUser.email_verified === true,
        identity: publicIdentityStatus(identityCheck),
      });
    } catch (error) {
      console.error('GET /api/me error:', error);
      sendJson(res, 500, { error: 'Falha ao carregar perfil.' });
    }
    return;
  }

  if (req.method === 'PATCH' && route === '/me') {
    try {
      const body = await parseJsonBody<{
        name?: string;
        preferredLang?: string;
        preferredCurrency?: string;
        phone?: string;
      }>(req);

      const validLang = ['pt', 'en', 'es'].includes(String(body.preferredLang))
        ? (body.preferredLang as 'pt' | 'en' | 'es')
        : user.preferredLang;
      const validCurr = ['BRL', 'USD', 'EUR'].includes(String(body.preferredCurrency))
        ? (body.preferredCurrency as 'BRL' | 'USD' | 'EUR')
        : user.preferredCurrency;
      const cleanName =
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim().slice(0, 80)
          : user.name;
      const cleanPhone =
        typeof body.phone === 'string' ? body.phone.trim().slice(0, 30) : user.phone;

      const updates = {
        name: cleanName,
        displayName: cleanName,
        preferredLang: validLang,
        preferredCurrency: validCurr,
        phone: cleanPhone,
        updatedAt: new Date().toISOString(),
      };
      await adminDb.collection('users').doc(user.uid).set(updates, { merge: true });
      sendJson(res, 200, { user: { ...user, ...updates } });
    } catch (error) {
      console.error('PATCH /api/me error:', error);
      sendJson(res, 500, { error: 'Falha ao atualizar perfil.' });
    }
    return;
  }


  // ========================
  // VERIFICAÇÃO DE IDENTIDADE (anti-fraude): CPF + foto do documento + selfie
  // ========================
  if (req.method === 'GET' && route === '/identity/status') {
    try {
      sendJson(res, 200, {
        identity: publicIdentityStatus(await getIdentityCheck(user.uid)),
        emailVerified: auth.authUser.email_verified === true,
      });
    } catch (error) {
      console.error('GET /api/identity/status error:', error);
      sendJson(res, 500, { error: 'Erro ao consultar verificação.' });
    }
    return;
  }

  // As duas fotos vão em chamadas separadas (cada uma até ~500 KB) por causa do limite de 1 MB por chamada.
  if (req.method === 'POST' && route === '/identity/image') {
    if (!checkRateLimit(req, res, 'identity:image', 20, 3600000)) return;
    try {
      const body = await parseJsonBody<{ kind?: string; image?: string }>(req);
      const kind = body.kind === 'document' || body.kind === 'selfie' ? body.kind : null;
      const image = parseImageDataUrl(body.image);
      if (!kind || !image) {
        sendJson(res, 400, { error: 'Envie uma foto JPG/PNG nítida (tipo "document" ou "selfie").' });
        return;
      }
      const current = await getIdentityCheck(user.uid);
      if (current?.status === 'approved') {
        sendJson(res, 409, { error: 'Sua identidade já está aprovada.' });
        return;
      }
      if (current?.status === 'manual_review' || current?.status === 'pending') {
        sendJson(res, 409, { error: 'Sua verificação já está em análise. Aguarde o resultado.' });
        return;
      }
      const nowIso = new Date().toISOString();
      await adminDb.collection('kyc_images').doc(`${user.uid}_${kind}`).set({
        uid: user.uid,
        kind,
        mimeType: image.mimeType,
        data: image.data,
        createdAt: nowIso,
      });
      await adminDb
        .collection('identity_checks')
        .doc(user.uid)
        .set(
          {
            uid: user.uid,
            userId: user.id,
            email: user.email,
            status: current?.status && current.status !== 'rejected' ? current.status : 'none',
            [kind === 'document' ? 'hasDocumentImage' : 'hasSelfieImage']: true,
            updatedAt: nowIso,
          },
          { merge: true }
        );
      sendJson(res, 200, { ok: true, kind });
    } catch (error) {
      console.error('POST /api/identity/image error:', error);
      sendJson(res, 500, { error: 'Erro ao salvar a foto.' });
    }
    return;
  }

  if (req.method === 'POST' && route === '/identity/submit') {
    if (!checkRateLimit(req, res, 'identity:submit', 6, 3600000)) return;
    try {
      if (auth.authUser.email_verified !== true) {
        sendJson(res, 403, { error: 'Confirme seu e-mail antes de enviar a verificação.', code: 'EMAIL_NOT_VERIFIED' });
        return;
      }
      const body = await parseJsonBody<{ fullName?: string; cpf?: string; birthDate?: string }>(req);
      const fullName = String(body.fullName ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const cpf = normalizeCpf(body.cpf);
      const birthDate = String(body.birthDate ?? '').trim();
      if (fullName.split(' ').filter(Boolean).length < 2) {
        sendJson(res, 400, { error: 'Informe o nome completo, igual ao documento.' });
        return;
      }
      if (!isValidCpf(cpf)) {
        sendJson(res, 400, { error: 'CPF inválido. Confira os números.' });
        return;
      }
      const birth = Date.parse(birthDate);
      const age = (Date.now() - birth) / (365.25 * 86400000);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(birth) || age < 18 || age > 120) {
        sendJson(res, 400, { error: 'Data de nascimento inválida (é preciso ter 18 anos ou mais).' });
        return;
      }

      const current = await getIdentityCheck(user.uid);
      if (current?.status === 'approved') {
        sendJson(res, 409, { error: 'Sua identidade já está aprovada.' });
        return;
      }
      if (current?.status === 'manual_review') {
        sendJson(res, 409, { error: 'Sua verificação já está em análise. Aguarde o resultado.' });
        return;
      }
      const attempts = Number((current as (IdentityCheckDoc & { attempts?: number }) | null)?.attempts ?? 0);
      if (attempts >= 5) {
        sendJson(res, 429, { error: 'Muitas tentativas. Sua verificação foi enviada para análise da equipe.' });
        return;
      }

      const [docSnap, selfieSnap] = await Promise.all([
        adminDb.collection('kyc_images').doc(`${user.uid}_document`).get(),
        adminDb.collection('kyc_images').doc(`${user.uid}_selfie`).get(),
      ]);
      if (!docSnap.exists || !selfieSnap.exists) {
        sendJson(res, 400, { error: 'Envie a foto do documento e a selfie antes de concluir.' });
        return;
      }

      // CPF único: um CPF só pode pertencer a uma conta.
      const hash = cpfHash(cpf);
      const indexRef = adminDb.collection('cpf_index').doc(hash);
      const owner = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(indexRef);
        if (snap.exists && snap.data()?.uid !== user.uid) return String(snap.data()?.uid);
        if (!snap.exists) tx.set(indexRef, { uid: user.uid, createdAt: new Date().toISOString() });
        return user.uid;
      });
      if (owner !== user.uid) {
        await recordAuditLog({
          actorUserId: user.id,
          actorEmail: user.email,
          action: 'IDENTITY_CPF_ALREADY_USED',
          entityType: 'identity_check',
          entityId: user.uid,
          details: { cpfMasked: maskCpf(cpf) },
        });
        sendJson(res, 409, {
          error: 'Este CPF já está cadastrado em outra conta. Se for seu, fale com o suporte.',
          code: 'CPF_IN_USE',
        });
        return;
      }
      // Se a pessoa trocou de CPF, libera o anterior.
      if (current?.cpfHash && current.cpfHash !== hash) {
        const old = await adminDb.collection('cpf_index').doc(current.cpfHash).get();
        if (old.exists && old.data()?.uid === user.uid) await old.ref.delete();
      }

      const nowIso = new Date().toISOString();
      await adminDb.collection('identity_checks').doc(user.uid).set(
        {
          uid: user.uid,
          userId: user.id,
          email: user.email,
          // Já entra na fila da equipe: se a análise automática cair no meio, ninguém fica preso em "pendente".
          status: 'manual_review',
          reason: 'Em análise.',
          fullName,
          cpfMasked: maskCpf(cpf),
          cpfHash: hash,
          birthDate,
          hasDocumentImage: true,
          hasSelfieImage: true,
          submittedAt: nowIso,
          updatedAt: nowIso,
          attempts: attempts + 1,
        },
        { merge: true }
      );

      // Agente de Segurança analisa as fotos com a IA e decide.
      let decision = { status: 'manual_review' as string, reason: '' };
      let aiResult: Awaited<ReturnType<typeof analyzeIdentityWithAI>> = null;
      await dispatchAgentTask({
        department: 'Segurança e Auditoria',
        triggerType: 'event',
        eventName: 'IDENTITY_VERIFICATION',
        title: `Verificar identidade de ${maskCpf(cpf)}`,
        input: { uid: user.uid, cpfMasked: maskCpf(cpf) },
        executor: async () => {
          const d = docSnap.data() as { mimeType: string; data: string };
          const s = selfieSnap.data() as { mimeType: string; data: string };
          aiResult = await analyzeIdentityWithAI({
            fullName,
            cpf,
            birthDate,
            documentImage: { mimeType: d.mimeType, data: d.data },
            selfieImage: { mimeType: s.mimeType, data: s.data },
          });
          decision = decideIdentity({ ai: aiResult, typedName: fullName, typedCpf: cpf });
          return `${decision.status}: ${decision.reason}`;
        },
      });
      if (!decision.reason) {
        decision = { status: 'manual_review', reason: 'Análise automática indisponível; revisão humana.' };
      }

      const decidedAt = new Date().toISOString();
      await adminDb.collection('identity_checks').doc(user.uid).set(
        {
          status: decision.status,
          reason: decision.reason,
          // CPF lido no documento fica mascarado (LGPD).
          aiResult: aiResult
            ? { ...(aiResult as Record<string, unknown>), cpfNoDocumento: maskCpf(String((aiResult as { cpfNoDocumento?: string }).cpfNoDocumento || '')) }
            : null,
          reviewedByEmail: decision.status === 'manual_review' ? null : 'ia',
          decidedAt,
          updatedAt: decidedAt,
        },
        { merge: true }
      );
      // LGPD: decidido pela IA (aprovado ou reprovado), as fotos são apagadas. Em revisão humana, ficam para a equipe.
      if (decision.status === 'approved' || decision.status === 'rejected') {
        await Promise.all(['document', 'selfie'].map((k) => adminDb.collection('kyc_images').doc(`${user.uid}_${k}`).delete().catch(() => undefined)));
        await adminDb.collection('identity_checks').doc(user.uid).set({ hasDocumentImage: false, hasSelfieImage: false }, { merge: true });
      }
      if (decision.status === 'rejected') {
        // Reprovado: o CPF não fica preso a esta conta.
        const idx = await indexRef.get();
        if (idx.exists && idx.data()?.uid === user.uid) await indexRef.delete();
      }
      await recordAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'IDENTITY_DECIDED',
        entityType: 'identity_check',
        entityId: user.uid,
        details: { status: decision.status, cpfMasked: maskCpf(cpf) },
      });

      sendJson(res, 200, { identity: publicIdentityStatus(await getIdentityCheck(user.uid)) });
    } catch (error) {
      console.error('POST /api/identity/submit error:', error);
      sendJson(res, 500, { error: 'Erro ao processar a verificação.' });
    }
    return;
  }

  // ========================
  // TOURIST DASHBOARD & HUB
  // ========================
  if (req.method === 'GET' && route === '/tourist/dashboard') {
    try {
      // Reservas não pagas no prazo aparecem como vencidas (e as vagas voltam para venda).
      await liberarReservasVencidas({ userId: user.id }).catch(() => 0);
      const [bookingsSnap, favsSnap, itinSnap, conciergeSnap, allListings] = await Promise.all([
        adminDb.collection('bookings').where('userId', '==', user.id).get(),
        adminDb.collection('favorites').where('userId', '==', user.id).get(),
        adminDb.collection('saved_itineraries').where('userId', '==', user.id).get(),
        adminDb.collection('concierge_requests').where('userId', '==', user.id).get(),
        getAllDocs<{
          id: number;
          title: string;
          slug: string;
          coverImage: string;
          moduleType: string;
        }>('listings'),
      ]);

      const listingMap = new Map(allListings.map((l) => [l.id, l]));
      const userBookings = bookingsSnap.docs
        .map((d) => d.data() as Record<string, unknown>)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((b) => {
          const l = listingMap.get(Number(b.listingId));
          return {
            booking: b,
            listingTitle: l?.title || 'Experiência Froc Rota',
            listingSlug: l?.slug || '',
            listingImage: assetParaFotoReal(l?.coverImage || '/src/assets/images/rio_'),
            moduleType: l?.moduleType || 'experience',
          };
        });

      const userFavs = favsSnap.docs.map((d) => d.data());
      const userItineraries = itinSnap.docs
        .map((d) => d.data() as Record<string, unknown>)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const userConcierge = conciergeSnap.docs
        .map((d) => d.data() as Record<string, unknown>)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

      sendJson(res, 200, {
        bookings: userBookings,
        favorites: userFavs,
        itineraries: userItineraries,
        conciergeRequests: userConcierge,
      });
    } catch (error) {
      console.error('GET /api/tourist/dashboard error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar área do turista.' });
    }
    return;
  }

  if (req.method === 'GET' && route === '/tourist/hub') {
    try {
      const [docsSnap, ordersSnap, alertsSnap, notifsSnap] = await Promise.all([
        adminDb.collection('tourist_documents').where('numericUserId', '==', user.id).get(),
        adminDb.collection('flight_orders').where('userId', '==', user.id).get(),
        adminDb.collection('flight_alerts').where('numericUserId', '==', user.id).get(),
        adminDb.collection('notifications').where('numericUserId', '==', user.id).get(),
      ]);

      const sortDesc = (arr: Array<Record<string, unknown>>) =>
        arr.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

      sendJson(res, 200, {
        documents: sortDesc(docsSnap.docs.map((d) => d.data() as Record<string, unknown>)),
        flightOrders: sortDesc(ordersSnap.docs.map((d) => d.data() as Record<string, unknown>)),
        flightAlerts: sortDesc(alertsSnap.docs.map((d) => d.data() as Record<string, unknown>)),
        notifications: sortDesc(notifsSnap.docs.map((d) => d.data() as Record<string, unknown>)).slice(0, 40),
      });
    } catch (error) {
      console.error('GET /api/tourist/hub error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar central pessoal do turista.' });
    }
    return;
  }

  // POST /api/tourist/documents
  if (req.method === 'POST' && route === '/tourist/documents') {
    try {
      const body = await parseJsonBody<{
        docType?: string;
        label?: string;
        maskedNumber?: string;
        expiresAt?: string;
      }>(req);
      if (!body.label || !body.docType) {
        sendJson(res, 400, { error: 'Tipo e identificação do documento são obrigatórios.' });
        return;
      }
      const validType = ['passport', 'rg', 'voucher', 'ticket', 'insurance'].includes(
        String(body.docType)
      )
        ? String(body.docType)
        : 'voucher';

      const id = await nextSeqId('tourist_documents');
      const created = {
        id,
        userId: user.uid,
        numericUserId: user.id,
        docType: validType,
        label: String(body.label).slice(0, 120),
        maskedNumber: String(body.maskedNumber || '').slice(0, 64),
        expiresAt: body.expiresAt ? String(body.expiresAt).slice(0, 32) : null,
        createdAt: new Date().toISOString(),
      };
      await adminDb.collection('tourist_documents').doc(String(id)).set(created);
      sendJson(res, 201, { document: created });
    } catch (error) {
      console.error('POST /api/tourist/documents error:', error);
      sendJson(res, 500, { error: 'Erro ao salvar documento.' });
    }
    return;
  }

  // DELETE /api/tourist/documents/:id
  const delDocMatch = route.match(/^\/tourist\/documents\/(\d+)$/);
  if (req.method === 'DELETE' && delDocMatch) {
    try {
      const docRef = adminDb.collection('tourist_documents').doc(delDocMatch[1]);
      const snap = await docRef.get();
      if (snap.exists && (snap.data()?.numericUserId === user.id || snap.data()?.userId === user.uid)) {
        await docRef.delete();
      }
      sendJson(res, 200, { deleted: true });
    } catch (error) {
      console.error('DELETE /api/tourist/documents error:', error);
      sendJson(res, 500, { error: 'Erro ao remover documento.' });
    }
    return;
  }

  // POST /api/tourist/flight-alerts
  if (req.method === 'POST' && route === '/tourist/flight-alerts') {
    try {
      const body = await parseJsonBody<{
        originIata?: string;
        destinationIata?: string;
        targetPriceBrl?: number;
        includeMadrugada?: boolean;
      }>(req);
      if (!body.originIata || !body.destinationIata || !body.targetPriceBrl) {
        sendJson(res, 400, { error: 'Origem, destino IATA e preço alvo são obrigatórios.' });
        return;
      }

      const id = await nextSeqId('flight_alerts');
      const alert = {
        id,
        userId: user.uid,
        numericUserId: user.id,
        originIata: String(body.originIata).toUpperCase().slice(0, 3),
        destinationIata: String(body.destinationIata).toUpperCase().slice(0, 3),
        targetPriceBrl: Math.max(50, Math.round(Number(body.targetPriceBrl))),
        includeMadrugada: body.includeMadrugada !== false,
        active: true,
        createdAt: new Date().toISOString(),
      };
      await adminDb.collection('flight_alerts').doc(String(id)).set(alert);

      await dispatchAgentTask({
        department: 'Voos e Oportunidades',
        triggerType: 'event',
        eventName: 'FLIGHT_ALERT_CREATED',
        title: `Monitoramento radar ${alert.originIata} -> ${alert.destinationIata} abaixo de R$ ${alert.targetPriceBrl}`,
        input: { alertId: alert.id },
      });

      sendJson(res, 201, { alert });
    } catch (error) {
      console.error('POST /api/tourist/flight-alerts error:', error);
      sendJson(res, 500, { error: 'Erro ao criar alerta de preço aéreo.' });
    }
    return;
  }

  // DELETE /api/tourist/flight-alerts/:id
  const delAlertMatch = route.match(/^\/tourist\/flight-alerts\/(\d+)$/);
  if (req.method === 'DELETE' && delAlertMatch) {
    try {
      const ref = adminDb.collection('flight_alerts').doc(delAlertMatch[1]);
      const snap = await ref.get();
      if (snap.exists && (snap.data()?.numericUserId === user.id || snap.data()?.userId === user.uid)) {
        await ref.delete();
      }
      sendJson(res, 200, { deleted: true });
    } catch {
      sendJson(res, 500, { error: 'Erro ao remover alerta.' });
    }
    return;
  }

  // PATCH /api/tourist/notifications/:id/read
  const readNotifMatch = route.match(/^\/tourist\/notifications\/(\d+)\/read$/);
  if (req.method === 'PATCH' && readNotifMatch) {
    try {
      const ref = adminDb.collection('notifications').doc(readNotifMatch[1]);
      const snap = await ref.get();
      if (!snap.exists || (snap.data()?.numericUserId !== user.id && snap.data()?.userId !== user.uid)) {
        sendJson(res, 200, { notification: null });
        return;
      }
      await ref.update({ read: true });
      sendJson(res, 200, { notification: { ...snap.data(), read: true } });
    } catch {
      sendJson(res, 500, { error: 'Erro ao atualizar notificação.' });
    }
    return;
  }

  // POST /api/favorites/toggle
  if (req.method === 'POST' && route === '/favorites/toggle') {
    try {
      const body = await parseJsonBody<{ destinationId?: number; listingId?: number }>(req);
      if (!body.destinationId && !body.listingId) {
        sendJson(res, 400, { error: 'Informe destinationId ou listingId.' });
        return;
      }
      const key = body.destinationId
        ? `${user.id}_dest_${Number(body.destinationId)}`
        : `${user.id}_list_${Number(body.listingId)}`;
      const favRef = adminDb.collection('favorites').doc(key);
      const snap = await favRef.get();
      if (snap.exists) {
        await favRef.delete();
        sendJson(res, 200, { saved: false });
        return;
      }
      const id = await nextSeqId('favorites');
      await favRef.set({
        id,
        userId: user.id,
        userUid: user.uid,
        destinationId: body.destinationId ? Number(body.destinationId) : null,
        listingId: body.listingId ? Number(body.listingId) : null,
        createdAt: new Date().toISOString(),
      });
      sendJson(res, 200, { saved: true });
    } catch (error) {
      console.error('POST /api/favorites/toggle error:', error);
      sendJson(res, 500, { error: 'Erro ao atualizar favoritos.' });
    }
    return;
  }

  // POST /api/reviews
  if (req.method === 'POST' && route === '/reviews') {
    try {
      const body = await parseJsonBody<{
        destinationId?: number;
        listingId?: number;
        rating?: number;
        comment?: string;
      }>(req);
      const numRating = Math.max(1, Math.min(5, Number(body.rating) || 5));
      const cleanComment = String(body.comment ?? '').trim().slice(0, 800);
      if (!cleanComment) {
        sendJson(res, 400, { error: 'Escreva um comentário para publicar a avaliação.' });
        return;
      }
      // Avaliação de oferta só de quem comprou (reserva paga), para a nota ser verdadeira.
      if (body.listingId) {
        const compras = await adminDb.collection('bookings').where('userId', '==', user.id).where('listingId', '==', Number(body.listingId)).get();
        if (!compras.docs.some((d) => d.data().status === 'confirmed')) {
          sendJson(res, 403, { error: 'Só quem reservou e pagou esta oferta pode avaliá-la.' });
          return;
        }
      }
      const id = await nextSeqId('reviews');
      const created = {
        id,
        userId: user.id,
        userUid: user.uid,
        destinationId: body.destinationId ? Number(body.destinationId) : null,
        listingId: body.listingId ? Number(body.listingId) : null,
        rating: numRating,
        comment: cleanComment,
        merchantReply: null,
        createdAt: new Date().toISOString(),
      };
      await adminDb.collection('reviews').doc(String(id)).set(created);
      try {
        await agentModerateReview(id, cleanComment);
      } catch (modErr) {
        console.error('review moderation failed:', modErr);
      }
      const after = await adminDb.collection('reviews').doc(String(id)).get();
      const hidden = after.data()?.hidden === true;
      sendJson(res, 201, {
        review: { ...created, hidden },
        message: hidden ? 'Sua avaliação ficou em análise por não seguir as regras da comunidade.' : undefined,
      });
    } catch (error) {
      console.error('POST /api/reviews error:', error);
      sendJson(res, 500, { error: 'Erro ao salvar avaliação.' });
    }
    return;
  }

  // POST /api/concierge
  if (req.method === 'POST' && route === '/concierge') {
    try {
      const body = await parseJsonBody<{
        originCity?: string;
        destinationPref?: string;
        startDate?: string;
        endDate?: string;
        travelersCount?: number;
        budgetBrl?: number;
        tripStyle?: string;
        notes?: string;
      }>(req);

      const {
        originCity,
        destinationPref,
        startDate,
        endDate,
        travelersCount,
        budgetBrl,
        tripStyle,
        notes,
      } = body;

      if (!originCity || !destinationPref || !startDate || !endDate || !budgetBrl) {
        sendJson(res, 400, { error: 'Preencha origem, destino, datas e orçamento.' });
        return;
      }

      const id = await nextSeqId('concierge_requests');
      const requestCode = `CON-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const created = {
        id,
        requestCode,
        userId: user.id,
        userUid: user.uid,
        originCity: String(originCity).slice(0, 120),
        destinationPref: String(destinationPref).slice(0, 160),
        startDate: String(startDate),
        endDate: String(endDate),
        travelersCount: Math.max(1, Math.min(30, Number(travelersCount) || 2)),
        budgetCents: Math.max(50000, Math.round(Number(budgetBrl) * 100)),
        tripStyle: String(tripStyle || 'Personalizado').slice(0, 80),
        notes: String(notes || '').slice(0, 1200),
        status: 'new',
        proposalSummary: null,
        proposalAmountCents: null,
        createdAt: new Date().toISOString(),
      };
      await adminDb.collection('concierge_requests').doc(String(id)).set(created);

      await recordAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'CONCIERGE_REQUEST_CREATED',
        entityType: 'concierge_request',
        entityId: requestCode,
      });

      sendJson(res, 201, { request: created });
    } catch (error) {
      console.error('POST /api/concierge error:', error);
      sendJson(res, 500, { error: 'Erro ao enviar solicitação de concierge.' });
    }
    return;
  }

  // POST /api/reports
  if (req.method === 'POST' && route === '/reports') {
    try {
      const body = await parseJsonBody<{
        targetType?: string;
        targetId?: number;
        reason?: string;
      }>(req);
      if (!body.targetType || !body.targetId || !body.reason) {
        sendJson(res, 400, { error: 'Dados da denúncia incompletos.' });
        return;
      }
      const id = await nextSeqId('reports');
      const created = {
        id,
        userId: user.id,
        userUid: user.uid,
        targetType: String(body.targetType),
        targetId: Number(body.targetId),
        reason: String(body.reason).slice(0, 500),
        status: 'open',
        createdAt: new Date().toISOString(),
      };
      await adminDb.collection('reports').doc(String(id)).set(created);
      sendJson(res, 201, { report: created });
    } catch (error) {
      console.error('POST /api/reports error:', error);
      sendJson(res, 500, { error: 'Erro ao registrar denúncia.' });
    }
    return;
  }

  // POST /api/travel/orders (Server-Authoritative Fare Verification + Idempotent)
  // Emissão automática de passagens fica desligada até a conta Duffel estar em produção com pagamento
  // integrado. Hoje o cliente escolhe o voo e a equipe emite pelo atendimento (botão "Quero este voo").
  if (req.method === 'POST' && route === '/travel/orders' && process.env.FLIGHT_ORDERS_ENABLED !== 'true') {
    sendJson(res, 503, { error: 'Compra online de passagens em breve. Use "Quero este voo" para a equipe emitir para você.' });
    return;
  }
  if (req.method === 'POST' && route === '/travel/orders') {
    if (!checkRateLimit(req, res, 'travel:orders', 15, 60000)) return;
    try {
      const body = await parseJsonBody<{
        idempotencyKey?: string;
        originIata?: string;
        destinationIata?: string;
        departureDate?: string;
        returnDate?: string | null;
        tripType?: string;
        carrierCode?: string | null;
        flightNumber?: string | null;
        isMadrugada?: boolean;
        passengers?: Array<{ name: string; docType?: string }>;
        provider?: string;
      }>(req);

      const idempKey = String(getHeader(req, 'idempotency-key') || body.idempotencyKey || '').trim();
      if (!idempKey) {
        sendJson(res, 400, { error: 'Idempotency-Key obrigatório para evitar compras duplicadas.' });
        return;
      }

      const idempDocId = `flight_order_${idempKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const existingIdemp = await adminDb.collection('idempotency_keys').doc(idempDocId).get();
      if (existingIdemp.exists) {
        const saved = existingIdemp.data() as {
          statusCode: number;
          responseJson: Record<string, unknown>;
        };
        sendJson(res, saved.statusCode, saved.responseJson);
        return;
      }

      const {
        originIata,
        destinationIata,
        departureDate,
        returnDate,
        tripType = 'one_way',
        carrierCode,
        flightNumber,
        isMadrugada = false,
        passengers,
        provider = 'Amadeus Flight Offers API v2',
      } = body;

      if (
        !originIata ||
        !destinationIata ||
        !departureDate ||
        !Array.isArray(passengers) ||
        passengers.length === 0
      ) {
        sendJson(res, 400, {
          error: 'Dados dos passageiros, rota e tarifa confirmada são obrigatórios.',
        });
        return;
      }

      const authoritativeCostCents = await verifyAuthoritativeFlightFareCents({
        originIata: String(originIata),
        destinationIata: String(destinationIata),
        departureDate: String(departureDate),
        returnDate: returnDate ? String(returnDate) : null,
        tripType: String(tripType),
        adults: passengers.length,
        carrierCode: carrierCode ? String(carrierCode) : null,
        flightNumber: flightNumber ? String(flightNumber) : null,
      });

      if (!authoritativeCostCents) {
        sendJson(res, 400, {
          error:
            'Emissão bloqueada: tarifa e disponibilidade devem ser confirmadas em tempo real pelo provedor aéreo oficial no servidor.',
        });
        return;
      }

      const rule = await resolvePricingRule({
        category: 'flights',
        costCents: authoritativeCostCents,
      });
      const breakdown = computePriceFromRule({
        supplierCostCents: authoritativeCostCents,
        rule,
      });

      const id = await nextSeqId('flight_orders');
      const orderCode = `FLT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const order = {
        id,
        orderCode,
        userId: user.id,
        userUid: user.uid,
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
        createdAt: new Date().toISOString(),
      };

      await adminDb.collection('flight_orders').doc(String(id)).set(order);

      await recordImmutableLedgerEntry({
        operationType: 'flight_charge',
        referenceCode: orderCode,
        category: 'flights',
        breakdown,
        idempotencyKey: idempKey,
      });

      const responsePayload = { order, breakdown };
      await adminDb
        .collection('idempotency_keys')
        .doc(idempDocId)
        .set({
          key: idempKey,
          scope: 'flight_order',
          userId: user.id,
          statusCode: 201,
          responseJson: responsePayload,
          createdAt: new Date().toISOString(),
        });

      await dispatchAgentTask({
        department: 'Voos e Oportunidades',
        triggerType: 'event',
        eventName: 'FLIGHT_ORDER_CREATED',
        title: `Pedido aéreo ${orderCode} (${order.originIata}-${order.destinationIata}) aguardando pagamento`,
        requestedAction: 'issue_flight_ticket',
        explicitApproval: false,
        input: { orderCode },
      });

      sendJson(res, 201, responsePayload);
    } catch (error) {
      console.error('POST /api/travel/orders error:', error);
      sendJson(res, 500, { error: 'Erro ao registrar pedido aéreo.' });
    }
    return;
  }

  // ========================
  // REAL-TIME CHAT (FIRESTORE SNAPSHOT BACKEND)
  // ========================
  if (req.method === 'GET' && route === '/chat/conversations') {
    try {
      const q = (query.q || '').trim().toLowerCase();
      const snap = isStaff
        ? await adminDb.collection('conversations').get()
        : await adminDb.collection('conversations').where('ownerUid', '==', user.uid).get();

      let rows = snap.docs
        .map((d) => d.data() as {
          id: number;
          conversationCode: string;
          subject: string;
          ownerName: string;
          lastMessageAt: string;
          hiddenFor?: string[];
        })
        .filter((c) => !(Array.isArray(c.hiddenFor) && c.hiddenFor.includes(user.uid)))
        .sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));

      if (q) {
        rows = rows.filter(
          (c) =>
            String(c.subject || '').toLowerCase().includes(q) ||
            String(c.ownerName || '').toLowerCase().includes(q) ||
            String(c.conversationCode || '').toLowerCase().includes(q)
        );
      }

      sendJson(res, 200, { conversations: rows.slice(0, 60) });
    } catch (error) {
      console.error('GET /api/chat/conversations error:', error);
      sendJson(res, 500, { error: 'Erro ao carregar conversas.' });
    }
    return;
  }

  if (req.method === 'POST' && route === '/chat/conversations') {
    try {
      const body = await parseJsonBody<{
        subject?: string;
        channel?: string;
        initialMessage?: string;
      }>(req);

      const id = await nextSeqId('conversations');
      const convCode = `CHT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const nowIso = new Date().toISOString();
      const initialText =
        typeof body.initialMessage === 'string' ? body.initialMessage.trim().slice(0, 2000) : '';

      const conv = {
        id,
        conversationCode: convCode,
        ownerUserId: user.id,
        ownerUid: user.uid,
        ownerName: user.name,
        channel: ['tourist', 'merchant', 'admin', 'ai_handoff'].includes(String(body.channel))
          ? String(body.channel)
          : 'tourist',
        subject: String(body.subject || 'Atendimento Froc Rota Turismo').slice(0, 160),
        status: 'open',
        lastMessagePreview: initialText.slice(0, 220),
        unreadByOwner: 0,
        unreadByStaff: initialText ? 1 : 0,
        lastMessageAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      await adminDb.collection('conversations').doc(String(id)).set(conv);

      if (initialText) {
        const senderRole = isStaff
          ? 'admin'
          : user.role === 'merchant'
          ? 'merchant'
          : 'tourist';
        const msgId = await nextSeqId('chat_messages');
        await adminDb
          .collection('conversations')
          .doc(String(id))
          .collection('messages')
          .doc(String(msgId))
          .set({
            id: msgId,
            conversationId: id,
            conversationOwnerUid: user.uid,
            senderUid: user.uid,
            senderName: user.name,
            senderRole,
            text: initialText,
            attachmentUrl: null,
            readByStaff: senderRole === 'admin',
            createdAt: nowIso,
          });
      }

      sendJson(res, 201, { conversation: conv });
    } catch (error) {
      console.error('POST /api/chat/conversations error:', error);
      sendJson(res, 500, { error: 'Erro ao iniciar conversa.' });
    }
    return;
  }

  const getMsgsMatch = route.match(/^\/chat\/conversations\/(\d+)\/messages$/);
  if (req.method === 'GET' && getMsgsMatch) {
    try {
      const convRef = adminDb.collection('conversations').doc(getMsgsMatch[1]);
      const convSnap = await convRef.get();
      if (!convSnap.exists) {
        sendJson(res, 404, { error: 'Conversa não encontrada.' });
        return;
      }
      const conv = convSnap.data() as {
        id: number;
        ownerUserId: number;
        ownerUid: string;
        unreadByOwner: number;
        unreadByStaff: number;
      };
      if (conv.ownerUid !== user.uid && conv.ownerUserId !== user.id && !isStaff) {
        sendJson(res, 403, { error: 'Sem permissão para ler esta conversa.' });
        return;
      }

      const msgsSnap = await convRef.collection('messages').get();
      const msgs = msgsSnap.docs
        .map((d) => d.data() as { createdAt: string })
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

      if (isStaff && (conv.unreadByStaff || 0) > 0) {
        await convRef.update({ unreadByStaff: 0 });
      } else if (!isStaff && (conv.unreadByOwner || 0) > 0) {
        await convRef.update({ unreadByOwner: 0 });
      }

      sendJson(res, 200, { conversation: conv, messages: msgs });
    } catch {
      sendJson(res, 500, { error: 'Erro ao carregar mensagens.' });
    }
    return;
  }

  if (req.method === 'POST' && getMsgsMatch) {
    try {
      const convRef = adminDb.collection('conversations').doc(getMsgsMatch[1]);
      const convSnap = await convRef.get();
      if (!convSnap.exists) {
        sendJson(res, 404, { error: 'Conversa não encontrada.' });
        return;
      }
      const conv = convSnap.data() as {
        id: number;
        conversationCode: string;
        subject: string;
        ownerUserId: number;
        ownerUid: string;
        unreadByOwner: number;
        unreadByStaff: number;
      };

      if (conv.ownerUid !== user.uid && conv.ownerUserId !== user.id && !isStaff) {
        sendJson(res, 403, { error: 'Sem permissão nesta conversa.' });
        return;
      }

      const body = await parseJsonBody<{
        text?: string;
        attachmentUrl?: string;
        requestHumanHandoff?: boolean;
        askAi?: boolean;
      }>(req);

      const cleanText = String(body.text ?? '').trim().slice(0, 2000);
      if (!cleanText && !body.requestHumanHandoff) {
        sendJson(res, 400, { error: 'Mensagem obrigatória.' });
        return;
      }

      const safeAttach =
        typeof body.attachmentUrl === 'string'
          ? sanitizeAssetOrSafeHttpUrl(body.attachmentUrl)
          : null;

      const senderRole = isStaff
        ? 'admin'
        : user.role === 'merchant'
        ? 'merchant'
        : 'tourist';
      const createdMsgs: Array<Record<string, unknown>> = [];
      let latestPreview = cleanText;

      if (cleanText) {
        const msgId = await nextSeqId('chat_messages');
        const userMsg = {
          id: msgId,
          conversationId: conv.id,
          conversationOwnerUid: conv.ownerUid,
          senderUid: user.uid,
          senderName: user.name,
          senderRole,
          text: cleanText,
          attachmentUrl: safeAttach,
          readByStaff: isStaff,
          createdAt: new Date().toISOString(),
        };
        await convRef.collection('messages').doc(String(msgId)).set(userMsg);
        createdMsgs.push(userMsg);
      }

      if (body.requestHumanHandoff) {
        const sysId = await nextSeqId('chat_messages');
        const handoffText =
          'Pronto! Sua conversa foi encaminhada para um atendente da equipe Froc Rota. A resposta aparece aqui mesmo.';
        const sysMsg = {
          id: sysId,
          conversationId: conv.id,
          conversationOwnerUid: conv.ownerUid,
          senderUid: 'froc-orchestrator',
          senderName: 'Central Froc Rota',
          senderRole: 'ai_agent',
          text: handoffText,
          attachmentUrl: null,
          readByStaff: false,
          createdAt: new Date().toISOString(),
        };
        await convRef.collection('messages').doc(String(sysId)).set(sysMsg);
        createdMsgs.push(sysMsg);
        latestPreview = handoffText;

        await convRef.update({
          status: 'human_assigned',
          channel: 'admin',
          unreadByStaff: (conv.unreadByStaff || 0) + 1,
        });
      } else if (body.askAi && cleanText && conv.ownerUid === user.uid) {
        // A IA responde quem é dono da conversa (cliente, parceiro ou o próprio admin testando o chat).
        // A IA recebe as últimas mensagens da conversa para responder com contexto.
        let aiText = '';
        try {
          const historySnap = await convRef.collection('messages').get();
          const history = historySnap.docs
            .map((d) => d.data() as { createdAt?: string; senderRole?: string; text?: string })
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
            .slice(-7, -1)
            .map((m) => `${m.senderRole === 'ai_agent' ? 'Assistente' : 'Cliente'}: ${String(m.text || '').slice(0, 180)}`)
            .join('\n');
          const aiReply = await askFrocRotaAI({
            query: history ? `${cleanText}\n\n(Contexto: mensagens anteriores desta conversa)\n${history}` : cleanText,
            language: (user.preferredLang as 'pt' | 'en' | 'es') || 'pt',
          });
          aiText = String(aiReply.reply || '').trim().slice(0, 2000);
        } catch (aiError) {
          console.error('Chat AI reply error:', aiError);
        }
        if (!aiText) {
          aiText =
            'Recebi sua mensagem! No momento não consegui gerar uma resposta automática. ' +
            'Toque em "Falar com atendente" e a equipe Froc Rota responde aqui mesmo nesta conversa.';
        }
        {
          const aiId = await nextSeqId('chat_messages');
          const aiMsg = {
            id: aiId,
            conversationId: conv.id,
            conversationOwnerUid: conv.ownerUid,
            senderUid: 'froc-rota-ai',
            senderName: 'Assistente Froc Rota',
            senderRole: 'ai_agent',
            text: aiText,
            attachmentUrl: null,
            readByStaff: true,
            createdAt: new Date().toISOString(),
          };
          await convRef.collection('messages').doc(String(aiId)).set(aiMsg);
          createdMsgs.push(aiMsg);
          latestPreview = aiText;
        }
      }

      const nowIso = new Date().toISOString();
      const statusAtual = (convSnap.data() as { status?: string }).status;
      await convRef.update({
        ...(statusAtual === 'resolved' && !body.requestHumanHandoff ? { status: 'open' } : {}),
        lastMessageAt: nowIso,
        updatedAt: nowIso,
        lastMessagePreview: latestPreview.slice(0, 220),
        unreadByOwner: isStaff ? (conv.unreadByOwner || 0) + 1 : conv.unreadByOwner || 0,
        unreadByStaff: !isStaff ? (conv.unreadByStaff || 0) + 1 : conv.unreadByStaff || 0,
      });

      // Registro do agente não pode derrubar o envio (a mensagem já foi salva).
      await dispatchAgentTask({
        department: 'Atendimento e Chat',
        triggerType: 'event',
        eventName: body.requestHumanHandoff ? 'CHAT_HUMAN_ESCALATION' : 'CHAT_MESSAGE_PROCESSED',
        title: `Atendimento ${conv.conversationCode} (${conv.subject})`,
        input: { conversationId: conv.id, senderRole },
      }).catch((agentError) => console.error('Chat agent log error:', agentError));

      sendJson(res, 201, { messages: createdMsgs });
    } catch (error) {
      console.error('POST /api/chat/messages error:', error);
      sendJson(res, 500, { error: 'Erro ao enviar mensagem.' });
    }
    return;
  }

  // Encerrar / reabrir e excluir conversa (dono ou equipe)
  const convOnlyMatch = route.match(/^\/chat\/conversations\/(\d+)$/);
  if (convOnlyMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
    try {
      const convRef = adminDb.collection('conversations').doc(convOnlyMatch[1]);
      const convSnap = await convRef.get();
      if (!convSnap.exists) {
        sendJson(res, 404, { error: 'Conversa não encontrada.' });
        return;
      }
      const conv = convSnap.data() as { ownerUid: string; ownerUserId: number; hiddenFor?: string[]; status?: string };
      const isOwner = conv.ownerUid === user.uid || conv.ownerUserId === user.id;
      if (!isOwner && !isStaff) {
        sendJson(res, 403, { error: 'Sem permissão nesta conversa.' });
        return;
      }
      const nowIso = new Date().toISOString();
      if (req.method === 'DELETE') {
        // Some da lista de quem excluiu; o histórico continua guardado (comprovantes e atendimento).
        const hiddenFor = Array.from(new Set([...(conv.hiddenFor || []), user.uid]));
        await convRef.update({ hiddenFor, updatedAt: nowIso });
        sendJson(res, 200, { ok: true });
        return;
      }
      const body = await parseJsonBody<{ action?: string }>(req);
      const status = body.action === 'reopen' ? 'open' : body.action === 'close' ? 'resolved' : null;
      if (!status) {
        sendJson(res, 400, { error: 'Ação inválida.' });
        return;
      }
      await convRef.update({ status, updatedAt: nowIso, ...(status === 'resolved' ? { closedAt: nowIso, closedByUid: user.uid } : {}) });
      sendJson(res, 200, { conversation: { ...conv, status } });
    } catch (error) {
      console.error('PATCH/DELETE /api/chat/conversations/:id error:', error);
      sendJson(res, 500, { error: 'Erro ao atualizar a conversa.' });
    }
    return;
  }

  sendJson(res, 404, { error: 'Rota do turista não encontrada.' });
}
