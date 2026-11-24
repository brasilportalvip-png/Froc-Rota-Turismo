import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { destinations, editorialPosts, listings } from '../db/schema.ts';
import { dispatchAgentTask } from './agents.service.ts';
import { broadcastRealtimeEvent } from './realtime.service.ts';

const OWNED_ASSET_GALLERY: Array<{ image: string; destinationSlug: string; category: string }> = [
  {
    image: '/src/assets/images/hero_fernando_noronha_1795530548063.jpg',
    destinationSlug: 'fernando-de-noronha',
    category: 'praias',
  },
  {
    image: '/src/assets/images/dest_rio_coastline_1795530549216.jpg',
    destinationSlug: 'rio-de-janeiro',
    category: 'gastronomia',
  },
  {
    image: '/src/assets/images/dest_lencois_maranhenses_1795530549318.jpg',
    destinationSlug: 'lencois-maranhenses',
    category: 'destinos',
  },
  {
    image: '/src/assets/images/dest_chapada_waterfall_1795530550621.jpg',
    destinationSlug: 'chapada-dos-veadeiros',
    category: 'passeios',
  },
  {
    image: '/src/assets/images/exp_paraty_boat_1795530550508.jpg',
    destinationSlug: 'paraty',
    category: 'cultura',
  },
];

export function computeEditorialHash(title: string, body: string): string {
  const normalized = `${title} ${body}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function computeImageHash(imagePath: string): string {
  return crypto.createHash('sha256').update(imagePath.trim().toLowerCase()).digest('hex');
}

export function textSimilarityRatio(a: string, b: string): number {
  const tokenize = (str: string) =>
    new Set(
      str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/\W+/)
        .filter((w) => w.length > 3)
    );
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export async function validateEditorialUniqueness(params: {
  title: string;
  body: string;
  coverImage: string;
  publishDate?: string;
}) {
  const contentHash = computeEditorialHash(params.title, params.body);
  const imageHash = computeImageHash(params.coverImage);

  const recentPosts = await db
    .select()
    .from(editorialPosts)
    .orderBy(desc(editorialPosts.createdAt))
    .limit(50);

  if (recentPosts.some((p) => p.contentHash === contentHash)) {
    throw new Error('DUPLICATE_CONTENT_HASH');
  }

  for (const existing of recentPosts) {
    const sim = textSimilarityRatio(`${existing.title} ${existing.body}`, `${params.title} ${params.body}`);
    if (sim >= 0.65) {
      throw new Error(`DUPLICATE_TOPIC_SIMILARITY:${existing.postCode}`);
    }
  }

  // Image cannot repeat on the same publishDate (and avoid consecutive duplicate images)
  const targetDate = params.publishDate ?? new Date().toISOString().slice(0, 10);
  if (recentPosts.some((p) => p.publishDate === targetDate && p.imageHash === imageHash)) {
    throw new Error('DUPLICATE_DAILY_IMAGE');
  }

  return { contentHash, imageHash };
}

export async function createUniqueEditorialPost(params: {
  title: string;
  body: string;
  category: string;
  destinationSlug?: string;
  keywords?: string[];
  coverImage: string;
  language?: 'pt' | 'en' | 'es';
  authorAgentCode?: string;
  riskTier?: 'low_auto' | 'commercial_review';
  publishDate?: string;
}) {
  const publishDate = params.publishDate ?? new Date().toISOString().slice(0, 10);
  const { contentHash, imageHash } = await validateEditorialUniqueness({
    title: params.title,
    body: params.body,
    coverImage: params.coverImage,
    publishDate,
  });

  const slugBase = params.title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);

  const postCode = `PST-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const slug = `${slugBase}-${postCode.toLowerCase()}`;
  const riskTier = params.riskTier ?? 'low_auto';
  const status = riskTier === 'low_auto' ? 'published' : 'pending_review';

  const [created] = await db
    .insert(editorialPosts)
    .values({
      postCode,
      title: params.title.slice(0, 180),
      slug,
      body: params.body.slice(0, 4000),
      category: params.category,
      destinationSlug: params.destinationSlug ?? null,
      keywordsJson: params.keywords ?? [],
      coverImage: params.coverImage,
      imageHash,
      contentHash,
      sourceReliability: 'verified_catalog_db',
      imageLicense: 'froc_rota_owned_asset',
      language: params.language ?? 'pt',
      authorAgentCode: params.authorAgentCode ?? 'AGT-026',
      riskTier,
      status,
      publishDate,
      approvedByEmail: status === 'published' ? 'auto-editorial-policy' : null,
    })
    .returning();

  broadcastRealtimeEvent({
    type: 'editorial:published',
    data: { postCode: created.postCode, title: created.title, status: created.status },
  });

  return created;
}

export async function runDailyFivePostsBatch(targetDate?: string) {
  const today = targetDate ?? new Date().toISOString().slice(0, 10);
  const existingToday = await db
    .select()
    .from(editorialPosts)
    .where(eq(editorialPosts.publishDate, today));

  if (existingToday.length >= 5) {
    return { created: [], existingCount: existingToday.length, skipped: 'Já existem 5 publicações para hoje.' };
  }

  const remainingSlots = 5 - existingToday.length;
  const usedImageHashes = new Set(existingToday.map((p) => p.imageHash));
  const [allDests, allListings] = await Promise.all([
    db.select().from(destinations),
    db.select().from(listings).where(eq(listings.status, 'active')),
  ]);

  const availableAssets = OWNED_ASSET_GALLERY.filter(
    (a) => !usedImageHashes.has(computeImageHash(a.image))
  );

  const createdPosts: Array<typeof editorialPosts.$inferSelect> = [];
  const apiKey = process.env.GEMINI_API_KEY;
  const ai =
    apiKey && apiKey !== 'MY_GEMINI_API_KEY'
      ? new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } })
      : null;

  for (let i = 0; i < remainingSlots && i < availableAssets.length; i++) {
    const asset = availableAssets[i];
    const dest = allDests.find((d) => d.slug === asset.destinationSlug) ?? allDests[i % allDests.length];
    const relatedListings = allListings.filter((l) => l.destinationId === dest?.id);

    let title = `${dest?.name ?? 'Brasil'}: guia autêntico de ${asset.category} (${today})`;
    let body = `${dest?.description ?? ''} Melhor época para visitar: ${dest?.bestSeason ?? 'Todo o ano'}. Curiosidade local: ${dest?.curiosities ?? ''}`;
    let keywords = [dest?.name ?? 'Brasil', asset.category, dest?.region ?? 'Turismo'];

    if (ai && dest) {
      try {
        const res = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: JSON.stringify({
            date: today,
            focusCategory: asset.category,
            destination: dest,
            verifiedServices: relatedListings.map((l) => l.title),
            existingTitles: existingToday.map((p) => p.title).concat(createdPosts.map((p) => p.title)),
          }),
          config: {
            systemInstruction:
              'Você é um editor sênior da Froc Rota Turismo. Escreva 1 artigo jornalístico original e inédito em português do Brasil baseado APENAS nos dados fornecidos do destino real. Nunca repita títulos existentes e nunca invente nomes de hotéis ou preços.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                body: { type: Type.STRING },
                keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['title', 'body', 'keywords'],
            },
          },
        });
        const parsed = JSON.parse((res.text ?? '').trim()) as {
          title: string;
          body: string;
          keywords: string[];
        };
        if (parsed.title && parsed.body) {
          title = parsed.title;
          body = parsed.body;
          keywords = parsed.keywords ?? keywords;
        }
      } catch {
        // Fallback determinístico baseado estritamente nos dados reais do banco
      }
    }

    const post = await createUniqueEditorialPost({
      title,
      body,
      category: asset.category,
      destinationSlug: dest?.slug,
      keywords,
      coverImage: asset.image,
      language: 'pt',
      authorAgentCode: `AGT-0${26 + i}`,
      riskTier: asset.category === 'promocoes' ? 'commercial_review' : 'low_auto',
      publishDate: today,
    });
    createdPosts.push(post);
  }

  await dispatchAgentTask({
    department: 'Marketing e SEO',
    triggerType: 'schedule',
    eventName: 'DAILY_EDITORIAL_BATCH_5',
    title: `Motor Editorial publicou ${createdPosts.length} artigos originais em ${today}`,
    input: { targetDate: today, createdCount: createdPosts.length },
  });

  return { created: createdPosts, existingCount: existingToday.length + createdPosts.length };
}
