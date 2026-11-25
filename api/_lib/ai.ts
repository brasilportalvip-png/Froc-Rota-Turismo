import { GoogleGenAI, Type } from '@google/genai';
import { adminDb } from './firebase-admin.ts';

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface AiAssistantResult {
  reply: string;
  recommendedDestinations: Array<{
    slug: string;
    name: string;
    state: string;
    avgBudgetDayBrl: number;
    reason: string;
  }>;
  recommendedListings: Array<{
    id: number;
    slug: string;
    title: string;
    moduleType: string;
    priceBrl: number;
    city: string;
  }>;
  suggestedItinerary: Array<{
    day: number;
    title: string;
    activities: string[];
  }>;
}

export async function askFrocRotaAI(params: {
  query: string;
  language: 'pt' | 'en' | 'es';
  budgetBrl?: number;
  travelers?: number;
  locationContext?: string;
}): Promise<AiAssistantResult> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY não configurada no servidor.');
  }

  const [destsSnap, listingsSnap, plansSnap] = await Promise.all([
    adminDb.collection('destinations').get(),
    adminDb.collection('listings').where('status', '==', 'active').get(),
    adminDb.collection('merchant_plans').where('active', '==', true).get(),
  ]);

  const dbDestinations = destsSnap.docs.map((d) => d.data() as Record<string, unknown>);
  const dbListings = listingsSnap.docs.map((d) => d.data() as Record<string, unknown>);
  const dbPlans = plansSnap.docs.map((d) => d.data() as Record<string, unknown>);

  const groundedCatalog = {
    platformInfo: {
      brand: 'Froc Rota Turismo',
      slogan: 'O Brasil é seu. O mundo é seu destino.',
      modules: [
        'Destinos Nacionais',
        'Experiências & Passeios',
        'Gastronomia',
        'Hospedagem',
        'Motor de Passagens Aéreas (Amadeus/Duffel)',
        'Concierge Personalizado',
        'Painel do Turista (Minhas Viagens)',
        'Painel do Anunciante + Marketing',
      ],
      commercialPlans: dbPlans.map((p) => ({
        name: p.name,
        slug: p.slug,
        monthlyPriceBrl: Math.round(Number(p.monthlyPriceCents || 0) / 100),
        durationDays: p.durationDays,
        maxListings: p.maxListings,
      })),
    },
    destinations: dbDestinations.map((d) => ({
      slug: d.slug,
      name: d.name,
      state: d.state,
      region: d.region,
      category: d.category,
      bestSeason: d.bestSeason,
      avgBudgetDayBrl: Math.round(Number(d.avgBudgetDayCents || 0) / 100),
      highlights: d.highlightsJson,
      summary: d.summary,
    })),
    listings: dbListings.map((l) => ({
      id: l.id,
      slug: l.slug,
      destinationId: l.destinationId,
      moduleType: l.moduleType,
      subtype: l.subtype,
      title: l.title,
      priceBrl: Math.round(Number(l.promoPriceCents ?? l.priceCents ?? 0) / 100),
      capacity: l.capacity,
      durationOrCheckin: l.durationOrCheckin,
      address: l.address,
      summary: l.summary,
    })),
  };

  const langInstruction =
    params.language === 'en'
      ? 'Respond in clear, natural English.'
      : params.language === 'es'
      ? 'Responde en español claro y natural.'
      : 'Responda em português brasileiro claro, elegante e objetivo.';

  const systemInstruction = `Você é o FROC ROTA AI ASSISTANT, assistente oficial em tempo real da plataforma Froc Rota Turismo ("O Brasil é seu. O mundo é seu destino.").
${langInstruction}

REGRAS CRÍTICAS DE CONFIABILIDADE E PRIVACIDADE:
1. Utilize EXCLUSIVAMENTE os destinos, experiências, restaurantes, hospedagens, planos e políticas presentes no CATÁLOGO REAL fornecido em JSON.
2. NUNCA invente nomes de hotéis, restaurantes, passagens aéreas, tarifas ou horários que não estejam no catálogo real.
3. Você conhece toda a estrutura da plataforma (Destinos, Experiências, Hospedagens, Gastronomia, Passagens, Planos para Anunciantes, Políticas LGPD/CDC) e nunca acessa dados privados de outros usuários.
4. Se o turista informar um orçamento, compare com os custos reais do catálogo (avgBudgetDayBrl e priceBrl) e explique com transparência.
5. Se o cliente pedir atendimento humano ou uma cotação aérea complexa, oriente claramente sobre o encaminhamento para a equipe humana no Chat em Tempo Real ou Froc Rota Concierge.`;

  const userPrompt = JSON.stringify({
    touristQuery: params.query,
    budgetBrl: params.budgetBrl ?? null,
    travelers: params.travelers ?? null,
    locationContext: params.locationContext ?? null,
    realPlatformCatalog: groundedCatalog,
  });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: userPrompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          reply: {
            type: Type.STRING,
            description: 'Helpful, accurate response grounded strictly in the real catalog.',
          },
          recommendedDestinations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                slug: { type: Type.STRING },
                name: { type: Type.STRING },
                state: { type: Type.STRING },
                avgBudgetDayBrl: { type: Type.NUMBER },
                reason: { type: Type.STRING },
              },
              required: ['slug', 'name', 'state', 'avgBudgetDayBrl', 'reason'],
            },
          },
          recommendedListings: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER },
                slug: { type: Type.STRING },
                title: { type: Type.STRING },
                moduleType: { type: Type.STRING },
                priceBrl: { type: Type.NUMBER },
                city: { type: Type.STRING },
              },
              required: ['id', 'slug', 'title', 'moduleType', 'priceBrl', 'city'],
            },
          },
          suggestedItinerary: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                day: { type: Type.INTEGER },
                title: { type: Type.STRING },
                activities: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['day', 'title', 'activities'],
            },
          },
        },
        required: ['reply', 'recommendedDestinations', 'recommendedListings', 'suggestedItinerary'],
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Resposta vazia do motor de inteligência artificial.');
  }

  return JSON.parse(rawText) as AiAssistantResult;
}
