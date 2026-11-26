import crypto from 'node:crypto';
import { Type } from '@google/genai';
import { adminDb } from './firebase-admin.js';
import { nextSeqId } from './firestore-helpers.js';
import { DESTINOS_BRASIL } from './brasil-destinos.js';
import { fotoDoDestino } from './fotos.js';
import { analyzeSeo, seoTitle, slugify } from './seo.js';
import { generateResilientJson, resolveGeminiKeySlots } from './gemini-resilience.js';
import { dispatchAgentTask } from './agents.js';


export interface EditorialPostDoc {
  id: number;
  postCode: string;
  title: string;
  slug: string;
  body: string;
  category: string;
  destinationSlug: string | null;
  keywordsJson: string[];
  /** Meta descrição (Yoast: 120–156 caracteres) e resumo do card. */
  summary?: string;
  focusKeyphrase?: string;
  seoScore?: number;
  coverImage: string;
  fotoCredito?: { author: string; license: string; pageUrl: string } | null;
  imageHash: string;
  contentHash: string;
  sourceReliability: string;
  imageLicense: string;
  language: string;
  authorAgentCode: string;
  riskTier: string;
  status: string;
  publishDate: string;
  approvedByEmail: string | null;
  createdAt: string;
}

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

  const snap = await adminDb
    .collection('posts')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  const recentPosts = snap.docs.map((d) => d.data() as EditorialPostDoc);

  if (recentPosts.some((p) => p.contentHash === contentHash)) {
    throw new Error('DUPLICATE_CONTENT_HASH');
  }

  for (const existing of recentPosts) {
    const sim = textSimilarityRatio(
      `${existing.title} ${existing.body}`,
      `${params.title} ${params.body}`
    );
    if (sim >= 0.65) {
      throw new Error(`DUPLICATE_TOPIC_SIMILARITY:${existing.postCode}`);
    }
  }

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
  fotoCredito?: { author: string; license: string; pageUrl: string } | null;
  language?: 'pt' | 'en' | 'es';
  authorAgentCode?: string;
  riskTier?: 'low_auto' | 'commercial_review';
  publishDate?: string;
  summary?: string;
  focusKeyphrase?: string;
  seoScore?: number;
  slugBase?: string;
}): Promise<EditorialPostDoc> {
  const publishDate = params.publishDate ?? new Date().toISOString().slice(0, 10);
  const { contentHash, imageHash } = await validateEditorialUniqueness({
    title: params.title,
    body: params.body,
    coverImage: params.coverImage,
    publishDate,
  });

  const slugBase = (params.slugBase || params.title)
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
  const id = await nextSeqId('posts');

  const created: EditorialPostDoc = {
    id,
    postCode,
    title: params.title.slice(0, 180),
    slug,
    body: params.body.slice(0, 12000),
    summary: params.summary ?? params.body.replace(/\s+/g, ' ').slice(0, 155),
    focusKeyphrase: params.focusKeyphrase ?? '',
    seoScore: params.seoScore ?? 0,
    category: params.category,
    destinationSlug: params.destinationSlug ?? null,
    keywordsJson: params.keywords ?? [],
    coverImage: params.coverImage,
    fotoCredito: params.fotoCredito ?? null,
    imageHash,
    contentHash,
    sourceReliability: 'verified_catalog_db',
    imageLicense: params.fotoCredito ? `wikimedia_commons:${params.fotoCredito.license}` : 'froc_rota_owned_asset',
    language: params.language ?? 'pt',
    authorAgentCode: params.authorAgentCode ?? 'AGT-026',
    riskTier,
    status,
    publishDate,
    approvedByEmail: status === 'published' ? 'auto-editorial-policy' : null,
    createdAt: new Date().toISOString(),
  };

  await adminDb.collection('posts').doc(String(id)).set(created);
  return created;
}

export async function runDailyFivePostsBatch(targetDate?: string) {
  const today = targetDate ?? new Date().toISOString().slice(0, 10);
  const existingTodaySnap = await adminDb
    .collection('posts')
    .where('publishDate', '==', today)
    .get();
  const existingToday = existingTodaySnap.docs.map((d) => d.data() as EditorialPostDoc);

  if (existingToday.length >= 5) {
    return {
      created: [],
      existingCount: existingToday.length,
      date: today,
      skipped: 'Já existem 5 publicações para hoje.',
    };
  }

  const remainingSlots = 5 - existingToday.length;
  const usedImageHashes = new Set(existingToday.map((p) => p.imageHash));
  const [destsSnap, listingsSnap] = await Promise.all([
    adminDb.collection('destinations').get(),
    adminDb.collection('listings').where('status', '==', 'active').get(),
  ]);

  const allDests = destsSnap.docs.map((d) => d.data() as Record<string, unknown>);
  const allListings = listingsSnap.docs.map((d) => d.data() as Record<string, unknown>);

  const createdPosts: EditorialPostDoc[] = [];
  const hasGeminiKey = resolveGeminiKeySlots().length > 0;

  // Rodízio pelos destinos do Brasil: 5 por dia → todos os destinos a cada ~20 dias, com ângulo diferente a cada volta.
  const dayIndex = Math.floor(Date.parse(`${today}T12:00:00Z`) / 86400000);
  const ANGLES = ['passeios', 'destinos', 'praias', 'gastronomia', 'curiosidades'];
  const recentSnap = await adminDb.collection('posts').orderBy('createdAt', 'desc').limit(60).get();
  const recentTitles = recentSnap.docs.map((d) => String(d.data().title || ''));

  for (let i = 0; i < remainingSlots; i++) {
    const slot = existingToday.length + i;
    const destino = DESTINOS_BRASIL[(dayIndex * 5 + slot) % DESTINOS_BRASIL.length];
    const angle = ANGLES[(slot + Math.floor(dayIndex / 20)) % ANGLES.length];
    const seeded = allDests.find((d) => d.slug === destino.slug);
    const relatedListings = seeded ? allListings.filter((l) => l.destinationId === seeded.id) : [];
    // Toda matéria sai com FOTO REAL do destino (Wikimedia Commons, com crédito do fotógrafo).
    // Se o Commons não responder agora, o endereço /api/foto busca a foto quando a página abrir.
    const fotoReal = await fotoDoDestino(destino.slug).catch(() => null);
    const coverImage = fotoReal?.url1280 ?? `/api/foto?d=${destino.slug}&w=1280`;
    const fotoCredito = fotoReal ? { author: fotoReal.author, license: fotoReal.license, pageUrl: fotoReal.pageUrl } : null;

    const keyphrase = `${destino.nome}`;
    let title = `${destino.nome}: guia de ${angle} para a sua viagem`;
    let summary = `${destino.nome} (${destino.uf}): ${destino.resumo}`;
    let body = `${destino.nome} é um destino de ${destino.categoria} em ${destino.uf}. ${destino.resumo}\n## O que ver\n${destino.atrativos.join(', ')}.\n## Como chegar\nO aeroporto mais usado é ${destino.aeroporto}.`;
    let keywords = [destino.nome, angle, destino.regiao, ...destino.atrativos.slice(0, 3)];
    let focusKeyphrase = keyphrase;
    let seoScore = 0;

    if (hasGeminiKey) {
      let feedback = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { data: parsed } = await generateResilientJson<{
            focusKeyphrase: string;
            title: string;
            metaDescription: string;
            body: string;
            keywords: string[];
          }>({
            contents: JSON.stringify({
              date: today,
              angulo: angle,
              destino: {
                nome: destino.nome,
                estado: destino.uf,
                regiao: destino.regiao,
                tipo: destino.categoria,
                resumo: destino.resumo,
                atrativos: destino.atrativos,
                aeroporto: destino.aeroporto,
                detalhes: seeded ? { descricao: seeded.description, melhorEpoca: seeded.bestSeason, comoChegar: seeded.howToGet } : null,
              },
              ofertasVerificadas: relatedListings.map((l) => l.title),
              titulosQueJaExistem: recentTitles.concat(existingToday.map((p) => p.title)).concat(createdPosts.map((p) => p.title)),
              correcoesPedidas: feedback || undefined,
            }),
            config: {
              systemInstruction: [
                'Você é editor-chefe e especialista em SEO (padrão Yoast SEO) da Froc Rota Turismo.',
                'Escreva 1 matéria ORIGINAL em português do Brasil sobre o destino e o ângulo pedidos, para ranquear no Google e convencer o leitor a planejar a viagem.',
                'Regras Yoast obrigatórias:',
                '- focusKeyphrase: 2 a 4 palavras que o turista pesquisa (ex.: "o que fazer em Paraty"). Deve conter o nome do destino.',
                '- title: até 60 caracteres, começando pela focusKeyphrase ou contendo-a.',
                '- metaDescription: entre 125 e 155 caracteres, com a focusKeyphrase e uma chamada para ação.',
                '- body: 450 a 700 palavras. O PRIMEIRO parágrafo contém a focusKeyphrase. Use 3 a 5 intertítulos em linhas próprias começando com "## " (pelo menos um com a focusKeyphrase). Parágrafos curtos (até 4 frases), frases curtas, voz ativa, palavras de transição. Repita a focusKeyphrase de forma natural de 3 a 6 vezes.',
                '- Termine com um parágrafo chamando o leitor a ver passeios, hospedagens e passagens na Froc Rota.',
                'Verdade sempre: use só fatos do destino e conhecimento geral consolidado. NUNCA invente nomes de empresas, hotéis, preços, telefones ou estatísticas. Não repita títulos existentes.',
              ].join('\n'),
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  focusKeyphrase: { type: Type.STRING },
                  title: { type: Type.STRING },
                  metaDescription: { type: Type.STRING },
                  body: { type: Type.STRING },
                  keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['focusKeyphrase', 'title', 'metaDescription', 'body', 'keywords'],
              },
            },
            timeoutMs: 25_000,
            validate: (p) => Boolean(p && p.title && p.body && p.focusKeyphrase),
          });
          const check = analyzeSeo({
            keyphrase: parsed.focusKeyphrase,
            title: seoTitle(parsed.title),
            description: parsed.metaDescription,
            slug: slugify(parsed.focusKeyphrase),
            h1: parsed.title,
            bodyText: parsed.body,
            internalLinks: 3, // a página do post sempre leva links para destino, ofertas e blog
            imagesWithoutAlt: 0,
            subheadings: (parsed.body.match(/^##\s/gm) || []).length,
            minWords: 300,
          });
          title = parsed.title;
          summary = parsed.metaDescription;
          body = parsed.body;
          keywords = parsed.keywords?.length ? parsed.keywords : keywords;
          focusKeyphrase = parsed.focusKeyphrase;
          seoScore = check.score;
          if (check.score >= 80) break;
          feedback = `Corrija: ${check.checks.filter((c) => !c.ok).map((c) => c.label).join('; ')}`;
        } catch {
          break; // mantém o texto de reserva baseado nos dados reais
        }
      }
    }

    try {
      const post = await createUniqueEditorialPost({
        title,
        body,
        summary,
        focusKeyphrase,
        seoScore,
        slugBase: focusKeyphrase,
        category: angle,
        destinationSlug: destino.slug,
        fotoCredito,
        keywords,
        coverImage,
        language: 'pt',
        authorAgentCode: `AGT-0${26 + (slot % 5)}`,
        riskTier: 'low_auto',
        publishDate: today,
      });
      createdPosts.push(post);
      usedImageHashes.add(post.imageHash);
    } catch (err) {
      // Tema repetido ou imagem repetida: pula este e segue com os outros (antes um erro parava o jornal todo).
      console.error('editorial slot skipped:', err instanceof Error ? err.message : err);
    }
  }

  await dispatchAgentTask({
    department: 'Marketing e SEO',
    triggerType: 'schedule',
    eventName: 'DAILY_EDITORIAL_BATCH_5',
    title: `Motor Editorial publicou ${createdPosts.length} artigos originais em ${today}`,
    input: { targetDate: today, createdCount: createdPosts.length },
  });

  return {
    created: createdPosts,
    date: today,
    existingCount: existingToday.length + createdPosts.length,
  };
}
