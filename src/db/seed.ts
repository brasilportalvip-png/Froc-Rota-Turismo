import { count, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  availabilitySlots,
  coupons,
  destinations,
  editorialPosts,
  listings,
  merchantPlans,
  merchants,
  pricingRules,
  reviews,
  users,
} from './schema.ts';
import { ensure200AgentsSeeded } from '../services/agents.service.ts';
import { computeEditorialHash, computeImageHash } from '../services/editorial.service.ts';
import { ensurePopupsSeeded } from '../services/popups.service.ts';

let seedPromise: Promise<void> | null = null;

export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeedAll().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

async function runSeedAll() {
  await runSeed();
  await ensureExpansionSeeded();
}

async function ensureExpansionSeeded() {
  // 1. Ensure 'basic' R$ 100 / 30 days plan exists
  const existingBasic = await db
    .select()
    .from(merchantPlans)
    .where(eq(merchantPlans.slug, 'basic'))
    .limit(1);
  if (existingBasic.length === 0) {
    await db
      .insert(merchantPlans)
      .values({
        slug: 'basic',
        name: 'Anúncio Básico (30 dias)',
        monthlyPriceCents: 10000, // R$ 100,00 por 30 dias
        durationDays: 30,
        commissionBps: 1500, // 15%
        maxListings: 5,
        featuredSlots: 1,
        benefitsJson: [
          'Publicação ativa por 30 dias',
          'Galeria de fotografias autorizadas',
          'Dados de contato direto e mapa',
          'Renovação automática ou sob demanda',
        ],
      })
      .onConflictDoNothing();
  }

  // 2. Ensure configurable Financial Pricing Rules exist (matching user examples)
  const existingRules = await db.select({ value: count() }).from(pricingRules);
  if (Number(existingRules[0]?.value ?? 0) === 0) {
    await db
      .insert(pricingRules)
      .values([
        {
          ruleCode: 'FLIGHT-MARKUP-200',
          name: 'Passagens Aéreas — Remuneração Fixa Froc Rota',
          category: 'flights',
          serviceType: 'all',
          planSlug: 'all',
          markupType: 'fixed',
          markupFixedCents: 20000, // R$ 200,00 (ex: R$ 1.000 fornecedor + R$ 200 plataforma = R$ 1.200)
          markupBps: 0,
          minPriceCents: 15000,
          maxPriceCents: 5000000,
          gatewayFeeBps: 399,
          taxBps: 600,
          maxFinalMarkupRatioBps: 10000,
          active: true,
          notes: 'Exemplo referência: passagem de fornecedor R$ 1.000 + R$ 200 plataforma = R$ 1.200 ao cliente.',
        },
        {
          ruleCode: 'ACCOMMODATION-MARKUP-50',
          name: 'Hospedagens — Remuneração Padrão por Diária',
          category: 'accommodation',
          serviceType: 'all',
          planSlug: 'all',
          markupType: 'fixed',
          markupFixedCents: 5000, // R$ 50,00 (ex: R$ 100 quarto + R$ 50 plataforma = R$ 150)
          markupBps: 0,
          minPriceCents: 5000,
          maxPriceCents: 3000000,
          gatewayFeeBps: 399,
          taxBps: 600,
          maxFinalMarkupRatioBps: 10000,
          active: true,
          notes: 'Exemplo referência: diária R$ 100 + R$ 50 plataforma = R$ 150 ao cliente.',
        },
        {
          ruleCode: 'EXPERIENCE-PERCENT-15',
          name: 'Experiências & Passeios — Remuneração Percentual',
          category: 'experience',
          serviceType: 'all',
          planSlug: 'all',
          markupType: 'percent',
          markupFixedCents: 0,
          markupBps: 1500, // 15%
          minPriceCents: 3000,
          maxPriceCents: 5000000,
          gatewayFeeBps: 399,
          taxBps: 600,
          maxFinalMarkupRatioBps: 5000,
          active: true,
          notes: 'Comissão padrão configurável para passeios náuticos, trilhas e guias.',
        },
        {
          ruleCode: 'GASTRONOMY-PERCENT-12',
          name: 'Gastronomia & Quiosques — Taxa de Reserva/Experiência',
          category: 'gastronomy',
          serviceType: 'all',
          planSlug: 'all',
          markupType: 'percent',
          markupFixedCents: 0,
          markupBps: 1200, // 12%
          minPriceCents: 2000,
          maxPriceCents: 2000000,
          gatewayFeeBps: 399,
          taxBps: 600,
          maxFinalMarkupRatioBps: 5000,
          active: true,
          notes: 'Remuneração aplicada sobre menus pré-pagos e reservas gastronômicas.',
        },
      ])
      .onConflictDoNothing();
  }

  // 3. Ensure all 200 Specialized AI Agents and 54 Promotional Pop-Up Templates are seeded
  await ensure200AgentsSeeded();
  await ensurePopupsSeeded();

  // 4. Ensure initial 5 unique daily editorial posts exist for today
  const today = new Date().toISOString().slice(0, 10);
  const existingPosts = await db.select({ value: count() }).from(editorialPosts);
  if (Number(existingPosts[0]?.value ?? 0) === 0) {
    const initialDrafts = [
      {
        postCode: 'PST-INIT01',
        title: 'Baía do Sancho e o calendário ideal de mar calmo em Fernando de Noronha',
        slug: 'baia-do-sancho-calendario-fernando-de-noronha',
        body: 'Entre agosto e outubro, o arquipélago pernambucano apresenta águas com visibilidade subaquática de até 40 metros, ideais para mergulho ecológico e navegação até a Baía dos Porcos respeitando as normas do Parque Nacional Marinho.',
        category: 'praias',
        destinationSlug: 'fernando-de-noronha',
        keywordsJson: ['Fernando de Noronha', 'Baía do Sancho', 'Mergulho', 'Pernambuco'],
        coverImage: '/src/assets/images/hero_fernando_noronha_1795530548063.jpg',
        authorAgentCode: 'AGT-026',
      },
      {
        postCode: 'PST-INIT02',
        title: 'Roteiro histórico e náutico pelo Saco do Mamanguá em Paraty',
        slug: 'roteiro-saco-do-mamangua-paraty',
        body: 'O único fiorde tropical brasileiro combina mar espelhado cercado por Mata Atlântica com comunidades caiçaras tradicionais e embarques a partir do cais colonial do século XVIII em Paraty.',
        category: 'passeios',
        destinationSlug: 'paraty',
        keywordsJson: ['Paraty', 'Saco do Mamanguá', 'Lancha', 'Costa Verde'],
        coverImage: '/src/assets/images/exp_paraty_boat_1795530550508.jpg',
        authorAgentCode: 'AGT-027',
      },
      {
        postCode: 'PST-INIT03',
        title: 'Lagoas cheias nos Lençóis Maranhenses: quando viajar entre Barreirinhas e Atins',
        slug: 'lagoas-lencois-maranhenses-barreirinhas-atins',
        body: 'De maio a setembro, as chuvas recentes mantêm milhares de lagoas cristalinas entre dunas brancas móveis. O acesso autorizado em 4x4 liga Barreirinhas ao circuito da Lagoa Bonita e à vila pesqueira de Atins.',
        category: 'destinos',
        destinationSlug: 'lencois-maranhenses',
        keywordsJson: ['Lençóis Maranhenses', 'Atins', 'Lagoa Bonita', 'Maranhão'],
        coverImage: '/src/assets/images/dest_lencois_maranhenses_1795530549318.jpg',
        authorAgentCode: 'AGT-028',
      },
      {
        postCode: 'PST-INIT04',
        title: 'Sabores atlânticos e vistas panorâmicas de Santa Teresa no Rio de Janeiro',
        slug: 'sabores-atlanticos-santa-teresa-rio',
        body: 'A culinária fluminense valoriza frutos do mar frescos, caju e ingredientes de pequenos produtores enquanto oferece mirantes voltados para a Baía de Guanabara e o Pão de Açúcar entre maio e setembro.',
        category: 'gastronomia',
        destinationSlug: 'rio-de-janeiro',
        keywordsJson: ['Rio de Janeiro', 'Gastronomia', 'Santa Teresa', 'Baía de Guanabara'],
        coverImage: '/src/assets/images/dest_rio_coastline_1795530549216.jpg',
        authorAgentCode: 'AGT-029',
      },
      {
        postCode: 'PST-INIT05',
        title: 'Cristais de quartzo e quedas esmeralda na Chapada dos Veadeiros',
        slug: 'cristais-quartzo-chapada-dos-veadeiros',
        body: 'Entre Alto Paraíso de Goiás e São Jorge, o subsolo rico em quartzo reflete a luz solar nas águas cristalinas de cachoeiras como Santa Bárbara e Vale da Lua, com visitação segura durante a estação seca.',
        category: 'curiosidades',
        destinationSlug: 'chapada-dos-veadeiros',
        keywordsJson: ['Chapada dos Veadeiros', 'Cachoeiras', 'Cerrado', 'Goiás'],
        coverImage: '/src/assets/images/dest_chapada_waterfall_1795530550621.jpg',
        authorAgentCode: 'AGT-030',
      },
    ];

    await db
      .insert(editorialPosts)
      .values(
        initialDrafts.map((d) => ({
          ...d,
          imageHash: computeImageHash(d.coverImage),
          contentHash: computeEditorialHash(d.title, d.body),
          sourceReliability: 'verified_catalog_db',
          imageLicense: 'froc_rota_owned_asset',
          language: 'pt',
          riskTier: 'low_auto',
          status: 'published',
          publishDate: today,
          approvedByEmail: 'auto-editorial-policy',
        }))
      )
      .onConflictDoNothing();
  }
}

async function runSeed() {
  const existingPlans = await db.select({ value: count() }).from(merchantPlans);
  if (Number(existingPlans[0]?.value ?? 0) > 0) {
    return;
  }

  // 1. Merchant Commercial Plans
  const insertedPlans = await db
    .insert(merchantPlans)
    .values([
      {
        slug: 'free',
        name: 'Gratuito',
        monthlyPriceCents: 0,
        commissionBps: 1800, // 18%
        maxListings: 3,
        featuredSlots: 0,
        benefitsJson: [
          'Até 3 anúncios ativos',
          'Calendário de vagas e horários',
          'Recebimento seguro via plataforma',
          'Página comercial verificada',
        ],
      },
      {
        slug: 'pro',
        name: 'Profissional',
        monthlyPriceCents: 14900, // R$ 149,00
        commissionBps: 1200, // 12%
        maxListings: 15,
        featuredSlots: 2,
        benefitsJson: [
          'Até 15 anúncios nos módulos',
          'Comissão reduzida para 12%',
          '2 destaques regionais na bússola',
          'Relatórios financeiros e repasses detalhados',
        ],
      },
      {
        slug: 'premium',
        name: 'Premium',
        monthlyPriceCents: 34900, // R$ 349,00
        commissionBps: 800, // 8%
        maxListings: 100,
        featuredSlots: 6,
        benefitsJson: [
          'Anúncios ilimitados com selo curado',
          'Menor comissão do ecossistema (8%)',
          'Prioridade no Froc Rota AI e Concierge',
          '6 campanhas patrocinadas mensais',
        ],
      },
    ])
    .returning();

  const proPlan = insertedPlans.find((p) => p.slug === 'pro') ?? insertedPlans[0];
  const premiumPlan = insertedPlans.find((p) => p.slug === 'premium') ?? insertedPlans[0];

  // 2. Curated Platform Partner Accounts (System Demo Curated Operators)
  const insertedUsers = await db
    .insert(users)
    .values([
      {
        uid: 'curated-op-atlantico',
        email: 'operacao@frocrota.example',
        name: 'Marina Costa (Curadoria Náutica)',
        role: 'merchant',
        preferredLang: 'pt',
        preferredCurrency: 'BRL',
      },
      {
        uid: 'curated-op-gastro',
        email: 'sabores@frocrota.example',
        name: 'Chef Rafael Mendes',
        role: 'merchant',
        preferredLang: 'pt',
        preferredCurrency: 'BRL',
      },
      {
        uid: 'curated-op-hospitality',
        email: 'refugios@frocrota.example',
        name: 'Clara Vasconcelos (Refúgios Brasil)',
        role: 'merchant',
        preferredLang: 'pt',
        preferredCurrency: 'BRL',
      },
    ])
    .onConflictDoNothing()
    .returning();

  const opUsers =
    insertedUsers.length > 0 ? insertedUsers : await db.select().from(users).limit(3);

  const insertedMerchants = await db
    .insert(merchants)
    .values([
      {
        userId: opUsers[0].id,
        companyName: 'Atlântico Expedições Náuticas Ltda',
        tradeName: 'Atlântico Náutica & Mergulho',
        documentNumber: '12.345.678/0001-90',
        cadasturNumber: 'RJ-26.019283.10-0001',
        category: 'nautical',
        riskLevel: 'high_risk_nautical',
        verificationStatus: 'verified',
        planId: premiumPlan.id,
        city: 'Paraty',
        state: 'RJ',
        phone: '+55 (24) 99900-1100',
        bio: 'Operadora homologada pela Marinha e Cadastur para passeios de lancha, escuna e mergulho ecológico.',
      },
      {
        userId: opUsers[1].id,
        companyName: 'Cozinha Brasileira Raízes Ltda',
        tradeName: 'Mesa de Maré & Raízes',
        documentNumber: '23.456.789/0001-12',
        cadasturNumber: 'PE-14.088211.20-0002',
        category: 'gastronomy',
        riskLevel: 'standard',
        verificationStatus: 'verified',
        planId: proPlan.id,
        city: 'Fernando de Noronha',
        state: 'PE',
        phone: '+55 (81) 99911-2200',
        bio: 'Gastronomia costeira autoral com pesca artesanal sustentável e pratos regionais.',
      },
      {
        userId: opUsers[2].id,
        companyName: 'Refúgios Eco Brasil Hospedagem S.A.',
        tradeName: 'Coleção Refúgios Eco Brasil',
        documentNumber: '34.567.890/0001-34',
        cadasturNumber: 'GO-09.044512.10-0003',
        category: 'hospitality',
        riskLevel: 'standard',
        verificationStatus: 'verified',
        planId: premiumPlan.id,
        city: 'Alto Paraíso de Goiás',
        state: 'GO',
        phone: '+55 (62) 99922-3300',
        bio: 'Pousadas boutique, chalés de serra e casas pé na areia com energia solar e curadoria arquitetônica.',
      },
    ])
    .returning();

  // 3. Destinations (Bússola Turística)
  const insertedDests = await db
    .insert(destinations)
    .values([
      {
        slug: 'fernando-de-noronha',
        name: 'Fernando de Noronha',
        state: 'PE',
        region: 'Nordeste',
        category: 'ilha',
        lat: -3.8549,
        lng: -32.4233,
        summary: 'Arquipélago vulcânico preservado com águas esmeralda, golfinhos-rotadores e a Baía do Sancho.',
        description:
          'Patrimônio Natural da Humanidade pela UNESCO, Fernando de Noronha combina falésias basálticas, visibilidade subaquática de até 40 metros e controle rigoroso de visitação para preservar a fauna marinha.',
        bestSeason: 'Agosto a Outubro (mar mais calmo e ideal para mergulho e travessias de barco).',
        howToGet: 'Voos diários saindo do Recife (REC) e Natal (NAT) até o aeroporto da ilha (FEN).',
        culturalInfo: 'Forte tradição de conservação marinha (Projeto Tamar) e gastronomia insular com peixe na folha de bananeira.',
        curiosities: 'A Baía do Sancho já foi eleita múltiplas vezes a praia mais bonita do mundo por viajantes internacionais.',
        highlightsJson: ['Baía do Sancho', 'Baía dos Porcos', 'Mirante dos Golfinhos', 'Praia do Leão', 'Mergulho no Naufrágio Corveta'],
        coverImage: '/src/assets/images/hero_fernando_noronha_1795530548063.jpg',
        avgBudgetDayCents: 95000,
        ratingAvg: 4.95,
        reviewCount: 428,
        featured: true,
      },
      {
        slug: 'rio-de-janeiro',
        name: 'Rio de Janeiro',
        state: 'RJ',
        region: 'Sudeste',
        category: 'praia',
        lat: -22.9519,
        lng: -43.2105,
        summary: 'Encontro icônico entre Mata Atlântica urbana, Pão de Açúcar, baías navegáveis e praias oceânicas.',
        description:
          'Entre a Floresta da Tijuca e o Atlântico Sul, o Rio oferece roteiros que vão de trilhas panorâmicas no nascer do sol a passeios de barco pela Baía de Guanabara, museus históricos no Centro e alta gastronomia.',
        bestSeason: 'Maio a Setembro (céu limpo, temperaturas amenas e ótima visibilidade nos mirantes).',
        howToGet: 'Aeroportos Internacionais Galeão (GIG) e Santos Dumont (SDU), além de rodoviária Novo Rio.',
        culturalInfo: 'Berço do samba, da bossa nova, arquitetura modernista e cultura de botequim reconhecida mundialmente.',
        curiosities: 'O Parque Nacional da Tijuca é uma das maiores florestas urbanas replantadas do planeta.',
        highlightsJson: ['Pão de Açúcar', 'Cristo Redentor', 'Praia de Ipanema', 'Jardim Botânico', 'Santa Teresa'],
        coverImage: '/src/assets/images/dest_rio_coastline_1795530549216.jpg',
        avgBudgetDayCents: 62000,
        ratingAvg: 4.88,
        reviewCount: 615,
        featured: true,
      },
      {
        slug: 'lencois-maranhenses',
        name: 'Lençóis Maranhenses',
        state: 'MA',
        region: 'Nordeste',
        category: 'parque',
        lat: -2.4859,
        lng: -43.1284,
        summary: 'Imensidão de dunas brancas móveis entrecortadas por milhares de lagoas cristalinas de água doce.',
        description:
          'O Parque Nacional dos Lençóis Maranhenses forma uma paisagem geológica única no planeta. Durante o período pós-chuvas, os vales entre dunas transformam-se em piscinas naturais azul-turquesa.',
        bestSeason: 'Maio a Setembro (lagoas cheias e dias ensolarados em Barreirinhas, Atins e Santo Amaro).',
        howToGet: 'Voo até São Luís (SLZ) seguido de transfer 4x4 ou rodoviário de ~4h até Barreirinhas ou Santo Amaro.',
        culturalInfo: 'Vilarejos pesqueiros com culinária de camarão seco, arroz de cuxá e artesanato em fibra de buriti.',
        curiosities: 'Apesar da aparência desértica, a região recebe cerca de 1.200 mm de chuva anuais, formando as lagoas.',
        highlightsJson: ['Lagoa Azul', 'Lagoa Bonita', 'Vila de Atins', 'Rio Preguiças', 'Canto do Atins'],
        coverImage: '/src/assets/images/dest_lencois_maranhenses_1795530549318.jpg',
        avgBudgetDayCents: 54000,
        ratingAvg: 4.94,
        reviewCount: 312,
        featured: true,
      },
      {
        slug: 'chapada-dos-veadeiros',
        name: 'Chapada dos Veadeiros',
        state: 'GO',
        region: 'Centro-Oeste',
        category: 'cachoeira',
        lat: -14.1322,
        lng: -47.5142,
        summary: 'Cânions de quartzito, cachoeiras monumentais e céu estrelado no coração do Cerrado brasileiro.',
        description:
          'Entre Alto Paraíso, São Jorge e Cavalcante, a Chapada dos Veadeiros guarda mais de uma centena de quedas d’água em águas cristalinas e formações rochosas com mais de um bilhão de anos.',
        bestSeason: 'Abril a Outubro (época seca, trilhas firmes e águas verde-esmeralda translúcidas).',
        howToGet: 'Voo até Brasília (BSB) e trajeto rodoviário de 230 km pela GO-118 até Alto Paraíso.',
        culturalInfo: 'Comunidades quilombolas históricas (Kalunga), turismo regenerativo e gastronomia do Cerrado com baru e pequi.',
        curiosities: 'O subsolo rico em cristais de quartzo reflete a luz solar e dá às águas tons esmeralda intensos.',
        highlightsJson: ['Cachoeira Santa Bárbara', 'Vale da Lua', 'Saltos do Rio Preto', 'Cataratas dos Couros', 'Mirante da Janela'],
        coverImage: '/src/assets/images/dest_chapada_waterfall_1795530550621.jpg',
        avgBudgetDayCents: 46000,
        ratingAvg: 4.91,
        reviewCount: 289,
        featured: true,
      },
      {
        slug: 'paraty',
        name: 'Paraty e Costa Verde',
        state: 'RJ',
        region: 'Sudeste',
        category: 'historico',
        lat: -23.2178,
        lng: -44.7131,
        summary: 'Centro histórico colonial preservado diante de uma baía de 65 ilhas tropicais e mar calmo.',
        description:
          'Patrimônio Mundial da UNESCO por cultura e biodiversidade, Paraty une calçamento pé-de-moleque do século XVIII, alambiques artesanais, trilhas na Serra da Bocaina e navegação protegida em águas calmas.',
        bestSeason: 'Abril a Novembro (mar espelhado e festivais literários e gastronômicos).',
        howToGet: 'Acesso rodoviário pela Rio-Santos (BR-101) a partir do Rio de Janeiro (4h) ou São Paulo (4h30).',
        culturalInfo: 'Cultura caiçara tradicional, cachaças premiadas, FLIP e música instrumental nas praças coloniais.',
        curiosities: 'As ruas do centro histórico foram projetadas para receber a entrada suave da maré alta e limpar o calçamento.',
        highlightsJson: ['Saco do Mamanguá', 'Praia do Sono', 'Centro Histórico', 'Ilha do Pelado', 'Cachoeira do Tobogã'],
        coverImage: '/src/assets/images/exp_paraty_boat_1795530550508.jpg',
        avgBudgetDayCents: 49000,
        ratingAvg: 4.89,
        reviewCount: 374,
        featured: true,
      },
    ])
    .returning();

  const destMap = Object.fromEntries(insertedDests.map((d) => [d.slug, d]));

  // 4. Marketplace Listings (Experiências, Gastronomia, Hospedagens)
  const insertedListings = await db
    .insert(listings)
    .values([
      {
        merchantId: insertedMerchants[0].id,
        destinationId: destMap['paraty'].id,
        moduleType: 'experience',
        subtype: 'lancha',
        title: 'Expedição Privativa de Lancha pelo Saco do Mamanguá',
        slug: 'expedicao-lancha-saco-do-mamangua',
        summary: 'Roteiro de 5 horas em lancha esportiva com paradas na Ilha do Cedro, Praia Grande do Cajaíba e snorkeling.',
        description:
          'Embarque no Cais de Turismo de Paraty com marinheiro habilitado pela Capitania dos Portos. Inclui kit de snorkel higienizado, cooler com água e frutas tropicais e roteiro ajustado às condições da maré.',
        priceCents: 42000,
        currency: 'BRL',
        capacity: 8,
        durationOrCheckin: '5 horas · Saída 09:00',
        address: 'Cais de Turismo de Paraty, Centro Histórico, Paraty - RJ',
        lat: -23.2185,
        lng: -44.7102,
        amenitiesJson: ['Marinheiro habilitado', 'Snorkel incluso', 'Seguro náutico', 'Cooler com gelo'],
        menuOrScheduleJson: [
          { label: '09:00', detail: 'Embarque no Cais Histórico de Paraty' },
          { label: '10:00', detail: 'Mergulho livre na Ilha do Cedro' },
          { label: '12:00', detail: 'Parada para almoço caiçara no Saco do Mamanguá' },
          { label: '14:00', detail: 'Retorno navegando pela Baía da Ilha Grande' },
        ],
        cancellationPolicy: 'Cancelamento gratuito até 48h antes do embarque ou reagendamento sem custo em caso de mar adverso.',
        coverImage: '/src/assets/images/exp_paraty_boat_1795530550508.jpg',
        isFeatured: true,
        isSponsored: true,
        status: 'active',
        ratingAvg: 4.96,
        reviewCount: 84,
      },
      {
        merchantId: insertedMerchants[0].id,
        destinationId: destMap['fernando-de-noronha'].id,
        moduleType: 'experience',
        subtype: 'mergulho',
        title: 'Passeio de Catamarã & Batismo Submarino em Noronha',
        slug: 'catamara-mergulho-fernando-noronha',
        summary: 'Navegação pelas ilhas secundárias, passagem pela Baía do Sancho e mergulho guiado com instrutor credenciado.',
        description:
          'Experiência completa pelas águas transparentes do Parque Nacional Marinho. Guiado por instrutores certificados PADI com equipamentos revisados e briefing ambiental.',
        priceCents: 58000,
        currency: 'BRL',
        capacity: 12,
        durationOrCheckin: '4h30 · Saída 08:30',
        address: 'Porto de Santo Antônio, Fernando de Noronha - PE',
        lat: -3.8342,
        lng: -32.4018,
        amenitiesJson: ['Instrutor certificado', 'Equipamento completo', 'Fotos subaquáticas opcionais', 'Coletes salva-vidas'],
        menuOrScheduleJson: [
          { label: '08:30', detail: 'Check-in no Porto de Santo Antônio' },
          { label: '09:30', detail: 'Navegação costeira até a Baía do Sancho' },
          { label: '11:00', detail: 'Mergulho acompanhado de 40 minutos' },
        ],
        cancellationPolicy: 'Reembolso integral até 72h antes ou por fechamento climático do Parque Marinho.',
        coverImage: '/src/assets/images/hero_fernando_noronha_1795530548063.jpg',
        isFeatured: true,
        isSponsored: false,
        status: 'active',
        ratingAvg: 4.98,
        reviewCount: 142,
      },
      {
        merchantId: insertedMerchants[0].id,
        destinationId: destMap['lencois-maranhenses'].id,
        moduleType: 'experience',
        subtype: 'trilha',
        title: 'Travessia 4x4 ao Pôr do Sol na Lagoa Bonita & Atins',
        slug: 'travessia-4x4-lagoa-bonita-atins',
        summary: 'Expedição guiada em veículo 4x4 autorizado com banho nas principais lagoas e contemplação do pôr do sol nas dunas.',
        description:
          'Guia credenciado ICMBio conduz o grupo por trilhas arenosas exclusivas até os mirantes mais altos do circuito Lagoa Bonita.',
        priceCents: 24000,
        currency: 'BRL',
        capacity: 10,
        durationOrCheckin: '5h · Saída 13:30',
        address: 'Beira-Rio, Centro, Barreirinhas - MA',
        lat: -2.7475,
        lng: -42.8266,
        amenitiesJson: ['Guia credenciado ICMBio', 'Veículo 4x4 revisado', 'Água mineral'],
        menuOrScheduleJson: [
          { label: '13:30', detail: 'Embarque na pousada ou ponto central' },
          { label: '15:00', detail: 'Banho na Lagoa do Clone e Lagoa Bonita' },
          { label: '17:30', detail: 'Pôr do sol no topo das dunas' },
        ],
        cancellationPolicy: 'Cancelamento gratuito com até 24h de antecedência.',
        coverImage: '/src/assets/images/dest_lencois_maranhenses_1795530549318.jpg',
        isFeatured: true,
        isSponsored: false,
        status: 'active',
        ratingAvg: 4.92,
        reviewCount: 67,
      },
      {
        merchantId: insertedMerchants[1].id,
        destinationId: destMap['rio-de-janeiro'].id,
        moduleType: 'gastronomy',
        subtype: 'restaurante',
        title: 'Bistrô Mirante Guanabara — Culinária Atlântica',
        slug: 'bistro-mirante-guanabara-rio',
        summary: 'Menu degustação de frutos do mar brasileiros com vista panorâmica para a Baía de Guanabara e Pão de Açúcar.',
        description:
          'Ingredientes sazonais de pequenos produtores fluminenses, carta de vinhos da Serra Gaúcha e reserva garantida na varanda ao pôr do sol.',
        priceCents: 21000,
        currency: 'BRL',
        capacity: 24,
        durationOrCheckin: 'Almoço e Jantar · 12:00 às 23:00',
        address: 'Rua Almirante Alexandrino, 1420, Santa Teresa, Rio de Janeiro - RJ',
        lat: -22.9234,
        lng: -43.1921,
        amenitiesJson: ['Vista panorâmica', 'Menu vegetariano', 'Carta de vinhos brasileiros', 'Reserva de mesa'],
        menuOrScheduleJson: [
          { label: 'Entrada', detail: 'Ceviche de robalo com caju e coentro fresco', price: 'R$ 68' },
          { label: 'Principal', detail: 'Moqueca de badejo na panela de barro com farofa de dendê', price: 'R$ 138' },
          { label: 'Sobremesa', detail: 'Pudim de cumaru com calda de cupuaçu', price: 'R$ 44' },
        ],
        cancellationPolicy: 'Alteração ou cancelamento gratuito até 4h antes do horário reservado.',
        coverImage: '/src/assets/images/dest_rio_coastline_1795530549216.jpg',
        isFeatured: true,
        isSponsored: true,
        status: 'active',
        ratingAvg: 4.91,
        reviewCount: 118,
      },
      {
        merchantId: insertedMerchants[1].id,
        destinationId: destMap['fernando-de-noronha'].id,
        moduleType: 'gastronomy',
        subtype: 'bar_praia',
        title: 'Quiosque & Mesa de Maré — Peixe na Brasa em Noronha',
        slug: 'quiosque-mesa-de-mare-noronha',
        summary: 'Festival gastronômico ao ar livre com peixe fresco assado na folha de bananeira e drinks autorais de frutas do Nordeste.',
        description:
          'Experiência gastronômica pé na areia com pôr do sol, música acústica suave e reserva antecipada de espreguiçadeiras e mesa.',
        priceCents: 18500,
        currency: 'BRL',
        capacity: 30,
        durationOrCheckin: '11:30 às 20:30',
        address: 'Alameda Boldró, s/n, Fernando de Noronha - PE',
        lat: -3.8438,
        lng: -32.4315,
        amenitiesJson: ['Pé na areia', 'Pesca sustentável', 'Opções sem glúten', 'Aceita Pix'],
        menuOrScheduleJson: [
          { label: 'Clássico da Ilha', detail: 'Cavala na folha de bananeira com pirão e arroz de coco', price: 'R$ 145' },
          { label: 'Drink Autoral', detail: 'Caipirinha de seriguela com limão cravo', price: 'R$ 42' },
        ],
        cancellationPolicy: 'Cancelamento gratuito até 6h antes.',
        coverImage: '/src/assets/images/hero_fernando_noronha_1795530548063.jpg',
        isFeatured: false,
        isSponsored: false,
        status: 'active',
        ratingAvg: 4.87,
        reviewCount: 93,
      },
      {
        merchantId: insertedMerchants[2].id,
        destinationId: destMap['chapada-dos-veadeiros'].id,
        moduleType: 'accommodation',
        subtype: 'pousada',
        title: 'Refúgio Quartzito — Chalés & Spa na Chapada',
        slug: 'refugio-quartzito-chales-chapada',
        summary: 'Chalés arquitetônicos em meio ao Cerrado preservado com piscina aquecida, café da manhã regional e trilha privativa.',
        description:
          'Construídos com madeira de reflorestamento e pedra local, os chalés oferecem vista livre para o vale, lareira ecológica e acesso rápido às principais cachoeiras.',
        priceCents: 69000,
        currency: 'BRL',
        capacity: 4,
        durationOrCheckin: 'Check-in 14:00 · Check-out 12:00',
        address: 'Estrada Alto Paraíso – São Jorge, km 11, Alto Paraíso de Goiás - GO',
        lat: -14.1512,
        lng: -47.6248,
        amenitiesJson: ['Piscina aquecida', 'Café da manhã incluso', 'Wi-Fi fibra', 'Estacionamento', 'Trilha privativa'],
        menuOrScheduleJson: [
          { label: 'Café do Cerrado', detail: 'Queijo artesanal, bolo de baru, frutas orgânicas e café especial (07:00–10:30)' },
          { label: 'Suíte Master', detail: 'Cama King, banheira de imersão e deck privativo' },
        ],
        cancellationPolicy: 'Reembolso integral até 7 dias antes do check-in (conforme CDC).',
        coverImage: '/src/assets/images/dest_chapada_waterfall_1795530550621.jpg',
        isFeatured: true,
        isSponsored: true,
        status: 'active',
        ratingAvg: 4.94,
        reviewCount: 76,
      },
      {
        merchantId: insertedMerchants[2].id,
        destinationId: destMap['paraty'].id,
        moduleType: 'accommodation',
        subtype: 'hotel',
        title: 'Solar do Cais Boutique Hotel — Centro Histórico',
        slug: 'solar-do-cais-boutique-paraty',
        summary: 'Casarão colonial restaurado a 150 metros do cais de embarque, com pátio interno arborizado, piscina e suítes silenciosas.',
        description:
          'Arquitetura histórica preservada aliada a isolamento acústico moderno, enxoval 400 fios e concierge náutico integrado para embarques em Paraty.',
        priceCents: 74000,
        currency: 'BRL',
        capacity: 3,
        durationOrCheckin: 'Check-in 15:00 · Check-out 12:00',
        address: 'Rua do Comércio, 88, Centro Histórico, Paraty - RJ',
        lat: -23.2201,
        lng: -44.7145,
        amenitiesJson: ['Piscina no pátio', 'Próximo à praia e cais', 'Café da manhã', 'Ar-condicionado', 'Transfer opcional'],
        menuOrScheduleJson: [
          { label: 'Acomodação', detail: 'Suíte Colonial Superior com varanda para o jardim' },
          { label: 'Concierge Local', detail: 'Embarque facilitado para passeios de lancha e escuna' },
        ],
        cancellationPolicy: 'Cancelamento gratuito até 5 dias antes da hospedagem.',
        coverImage: '/src/assets/images/exp_paraty_boat_1795530550508.jpg',
        isFeatured: true,
        isSponsored: false,
        status: 'active',
        ratingAvg: 4.91,
        reviewCount: 109,
      },
    ])
    .returning();

  // 5. Availability Slots for upcoming 14 days
  const today = new Date();
  const slotsData: Array<typeof availabilitySlots.$inferInsert> = [];
  for (const listing of insertedListings) {
    for (let offset = 1; offset <= 7; offset += 2) {
      const dt = new Date(today.getTime() + offset * 86400000);
      const isoDate = dt.toISOString().slice(0, 10);
      slotsData.push({
        listingId: listing.id,
        date: isoDate,
        timeSlot: listing.moduleType === 'accommodation' ? 'Diária' : listing.moduleType === 'gastronomy' ? '19:30' : '09:00',
        totalSpots: listing.capacity,
        availableSpots: listing.capacity,
      });
    }
  }
  await db.insert(availabilitySlots).values(slotsData);

  // 6. Welcome Coupon
  await db
    .insert(coupons)
    .values([
      {
        code: 'FROC10',
        discountPercent: 10,
        maxUses: 500,
        usedCount: 0,
        active: true,
        expiresAt: '2027-12-31',
      },
    ])
    .onConflictDoNothing();

  // 7. Initial Verified Reviews
  await db.insert(reviews).values([
    {
      userId: opUsers[0].id,
      destinationId: destMap['fernando-de-noronha'].id,
      listingId: insertedListings[1].id,
      rating: 5,
      comment: 'Visibilidade incrível na Baía do Sancho e equipe muito atenciosa com as regras ambientais.',
    },
    {
      userId: opUsers[1].id,
      destinationId: destMap['paraty'].id,
      listingId: insertedListings[0].id,
      rating: 5,
      comment: 'Lancha impecável, marinheiro conhecia cada enseada calma do Mamanguá. Valeu cada centavo.',
    },
  ]);
}
