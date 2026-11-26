import { DESTINOS_BRASIL, DestinoBrasil, detectDestinos, findDestinoBrasil, UF_NOME } from './_lib/brasil-destinos.js';
import { fotoDoDestino, type FotoReal } from './_lib/fotos.js';
import { adminDb } from './_lib/firebase-admin.js';
import { ApiRequest, ApiResponse, getQuery } from './_lib/http.js';
import { ensureSeeded } from './_lib/seed.js';
import {
  clip,
  contactLine,
  escapeHtml,
  indexNowKey,
  metaDescription,
  privacyHtml,
  renderPage,
  seoTitle,
  siteUrl,
  SITE_NAME,
  termsHtml,
  textToHtml,
} from './_lib/seo.js';

/**
 * Páginas para o Google e o Bing (HTML pronto, sem depender de JavaScript):
 * /destinos, /destinos/:slug, /blog, /blog/:slug, /ofertas/:slug, /anuncie, /sobre, /contato,
 * /politica-de-privacidade, /termos-de-uso, /sitemap.xml, /robots.txt e a chave do IndexNow.
 * As matérias do blog nunca são apagadas: todas ficam no sitemap para sempre.
 */

interface PostRow {
  id: number;
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  keywordsJson?: string[];
  publishDate: string;
  status: string;
}
interface ListingRow {
  id: number;
  slug: string;
  title: string;
  summary: string;
  description: string;
  moduleType: string;
  priceCents: number;
  status: string;
  destinationId: number;
  address: string;
  cancellationPolicy?: string;
  createdAt?: string;
}
interface DestinationRow {
  id: number;
  slug: string;
  name: string;
  description?: string;
  bestSeason?: string;
  howToGet?: string;
}

let cache: { at: number; posts: PostRow[]; listings: ListingRow[]; destinations: DestinationRow[] } | null = null;

async function loadData() {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return cache;
  await ensureSeeded();
  const [p, l, d] = await Promise.all([
    adminDb.collection('posts').where('status', '==', 'published').get(),
    adminDb.collection('listings').where('status', '==', 'active').get(),
    adminDb.collection('destinations').get(),
  ]);
  cache = {
    at: Date.now(),
    posts: p.docs
      .map((x) => x.data() as PostRow)
      .map((x) => ({
        ...x,
        title: String(x.title || ''),
        body: String(x.body || ''),
        // matérias antigas não tinham resumo: usa o começo do texto
        summary: String(x.summary || clip(String(x.body || '').replace(/^##\s.*$/gm, ''), 155)),
        category: String(x.category || 'destinos'),
        publishDate: String(x.publishDate || ''),
      }))
      .sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)) || b.id - a.id),
    listings: l.docs.map((x) => x.data() as ListingRow),
    destinations: d.docs.map((x) => x.data() as DestinationRow),
  };
  return cache;
}

const MODULE_LABEL: Record<string, string> = {
  experience: 'Passeio / experiência',
  gastronomy: 'Gastronomia',
  accommodation: 'Hospedagem',
};

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function send(res: ApiResponse, status: number, body: string, type = 'text/html; charset=utf-8', cacheSec = 600) {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', status === 200 ? `public, s-maxage=${cacheSec}, stale-while-revalidate=86400` : 'no-store');
  res.end(body);
}

function notFound(res: ApiResponse) {
  send(
    res,
    404,
    renderPage({
      path: '/404',
      title: 'Página não encontrada | Froc Rota',
      description:
        'Esta página não existe mais ou o endereço está errado. Veja os destinos do Brasil e as ofertas de parceiros verificados na Froc Rota Turismo.',
      h1: 'Página não encontrada',
      breadcrumbs: [{ name: 'Início', path: '/' }],
      bodyHtml:
        '<p class="lead">Não encontramos esta página.</p><div class="btns"><a class="btn p" href="/destinos">Ver destinos</a><a class="btn s" href="/blog">Ler o blog</a></div>',
      noindex: true,
    })
  );
}

function destinationButtons(slugSeed: string | null, nome: string, aeroporto?: string) {
  const app = slugSeed ? `/?dest=${encodeURIComponent(slugSeed)}` : `/?busca=${encodeURIComponent(nome)}#marketplace`;
  return `<a class="btn p" href="${app}">Ver passeios, hospedagens e restaurantes em ${escapeHtml(nome)}</a>
${aeroporto ? `<a class="btn s" href="/?voo=${encodeURIComponent(aeroporto)}#viagens">Passagem para ${escapeHtml(nome)} (${escapeHtml(aeroporto)})</a>` : ''}
<a class="btn s" href="/?concierge=${encodeURIComponent(nome)}#concierge">Quero um roteiro sob medida</a>`;
}

function advertiserBox(nome?: string) {
  return `<div class="box gold"><h2>Você tem um negócio de turismo${nome ? ` em ${escapeHtml(nome)}` : ''}?</h2>
<p>Passeio de barco, pousada, casa de temporada, restaurante, guia ou transfer: apareça para quem já está planejando a viagem e receba direto na sua conta Mercado Pago.</p>
<div class="btns"><a class="btn p" href="/anuncie">Quero anunciar</a></div></div>`;
}

function listingCards(listings: ListingRow[]) {
  return `<div class="grid">${listings
    .map(
      (l) =>
        `<a class="card" href="/ofertas/${escapeHtml(l.slug)}"><span class="k">${escapeHtml(MODULE_LABEL[l.moduleType] || l.moduleType)}</span><h3>${escapeHtml(l.title)}</h3><p>${escapeHtml(clip(l.summary, 120))}</p><strong>${brl(l.priceCents)}</strong></a>`
    )
    .join('')}</div>`;
}

function postCards(posts: PostRow[]) {
  return `<div class="grid">${posts
    .map(
      (p) =>
        `<a class="card" href="/blog/${escapeHtml(p.slug)}"><span class="k">${escapeHtml(p.category)} · ${escapeHtml(String(p.publishDate).split('-').reverse().join('/'))}</span><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(clip(p.summary, 130))}</p></a>`
    )
    .join('')}</div>`;
}

function seededFor(d: DestinoBrasil, destinations: DestinationRow[]): DestinationRow | undefined {
  return destinations.find((x) => x.slug === d.slug || x.name.toLowerCase().startsWith(d.nome.toLowerCase()));
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const q = getQuery(req);
  const route = q.route || '';
  const slug = (q.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const base = siteUrl();

  try {
    if (route === 'robots') {
      send(res, 200, `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`, 'text/plain; charset=utf-8', 3600);
      return;
    }
    if (route === 'indexnow-key') {
      send(res, 200, indexNowKey(), 'text/plain; charset=utf-8', 86400);
      return;
    }
    if (route === 'google-verify') {
      const file = process.env.GOOGLE_SITE_VERIFICATION_FILE || '';
      const asked = (q.f || '').replace(/[^a-zA-Z0-9.]/g, '');
      if (file && asked === file) {
        send(res, 200, `google-site-verification: ${file}`, 'text/html; charset=utf-8', 86400);
        return;
      }
      notFound(res);
      return;
    }

    const data = await loadData();

    if (route === 'sitemap') {
      const today = new Date().toISOString().slice(0, 10);
      const urls: Array<{ loc: string; lastmod: string; pri: string; freq: string }> = [
        { loc: '/', lastmod: today, pri: '1.0', freq: 'daily' },
        { loc: '/destinos', lastmod: today, pri: '0.9', freq: 'weekly' },
        { loc: '/blog', lastmod: data.posts[0]?.publishDate || today, pri: '0.9', freq: 'daily' },
        { loc: '/anuncie', lastmod: today, pri: '0.8', freq: 'monthly' },
        { loc: '/sobre', lastmod: today, pri: '0.4', freq: 'yearly' },
        { loc: '/contato', lastmod: today, pri: '0.4', freq: 'yearly' },
        { loc: '/politica-de-privacidade', lastmod: today, pri: '0.3', freq: 'yearly' },
        { loc: '/termos-de-uso', lastmod: today, pri: '0.3', freq: 'yearly' },
        ...DESTINOS_BRASIL.map((d) => ({ loc: `/destinos/${d.slug}`, lastmod: today, pri: '0.8', freq: 'weekly' })),
        ...data.posts.map((p) => ({ loc: `/blog/${p.slug}`, lastmod: p.publishDate, pri: '0.7', freq: 'monthly' })),
        ...data.listings.map((l) => ({
          loc: `/ofertas/${l.slug}`,
          lastmod: (l.createdAt || today).slice(0, 10),
          pri: '0.7',
          freq: 'weekly',
        })),
      ];
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map(
          (u) =>
            `<url><loc>${escapeHtml(base + u.loc)}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`
        )
        .join('\n')}\n</urlset>\n`;
      send(res, 200, xml, 'application/xml; charset=utf-8', 900);
      return;
    }

    if (route === 'destinos') {
      const byRegion = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'].map((r) => ({
        r,
        items: DESTINOS_BRASIL.filter((d) => d.regiao === r).sort((a, b) => a.nome.localeCompare(b.nome)),
      }));
      send(
        res,
        200,
        renderPage({
          path: '/destinos',
          title: seoTitle('Destinos turísticos do Brasil por região'),
          description: metaDescription(
            `Destinos turísticos do Brasil por região: ${DESTINOS_BRASIL.length} praias, ilhas, serras, parques e cidades históricas com o que fazer, como chegar e ofertas.`
          ),
          h1: 'Destinos turísticos do Brasil',
          breadcrumbs: [
            { name: 'Início', path: '/' },
            { name: 'Destinos', path: '/destinos' },
          ],
          bodyHtml: `<p class="lead">Os destinos turísticos do Brasil reunidos num só lugar: ${DESTINOS_BRASIL.length} lugares, do Norte ao Sul, com o que fazer, quando ir, como chegar e ofertas de parceiros verificados.</p>
${byRegion
  .map(
    ({ r, items }) =>
      `<h2>${r}</h2><div class="grid">${items
        .map(
          (d) =>
            `<a class="card" href="/destinos/${d.slug}"><span class="k">${escapeHtml(d.categoria)} · ${d.uf}</span><h3>${escapeHtml(d.nome)}</h3><p>${escapeHtml(d.resumo)}</p></a>`
        )
        .join('')}</div>`
  )
  .join('\n')}
${advertiserBox()}`,
          jsonLd: [
            {
              '@context': 'https://schema.org',
              '@type': 'ItemList',
              name: 'Destinos turísticos do Brasil',
              itemListElement: DESTINOS_BRASIL.map((d, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                url: `${base}/destinos/${d.slug}`,
                name: d.nome,
              })),
            },
          ],
        })
      );
      return;
    }

    if (route === 'destino') {
      const d = findDestinoBrasil(slug);
      if (!d) return notFound(res);
      const seeded = seededFor(d, data.destinations);
      const offers = seeded ? data.listings.filter((l) => l.destinationId === seeded.id) : [];
      const related = data.posts
        .filter((p) => detectDestinos(`${p.title} ${p.summary}`, 3).some((h) => h.destino.slug === d.slug))
        .slice(0, 6);
      const near = DESTINOS_BRASIL.filter((x) => x.slug !== d.slug && (x.uf === d.uf || x.aeroporto === d.aeroporto)).slice(0, 6);
      const estado = UF_NOME[d.uf] || d.uf;
      const foto = await fotoComPrazo(d.slug);
      send(
        res,
        200,
        renderPage({
          path: `/destinos/${d.slug}`,
          image: foto?.url1280,
          title: seoTitle(`${d.nome}: o que fazer, quando ir e ofertas`),
          description: metaDescription(`${d.nome} (${d.uf}): ${d.resumo} Veja o que fazer, como chegar e ofertas.`),
          h1: `${d.nome}: o que fazer, quando ir e onde ficar`,
          breadcrumbs: [
            { name: 'Início', path: '/' },
            { name: 'Destinos', path: '/destinos' },
            { name: d.nome, path: `/destinos/${d.slug}` },
          ],
          bodyHtml: `${fotoHtml(foto, `${d.nome}, ${estado}`)}<p class="lead">${escapeHtml(d.nome)}, em ${escapeHtml(estado)} (região ${d.regiao}): ${escapeHtml(d.resumo)}</p>
<div class="btns">${destinationButtons(seeded?.slug ?? null, d.nome, d.aeroporto)}</div>
<h2>O que fazer em ${escapeHtml(d.nome)}</h2>
<div class="chips">${d.atrativos.map((a) => `<span class="chip">${escapeHtml(a)}</span>`).join('')}</div>
${seeded?.description ? `<p>${escapeHtml(seeded.description)}</p>` : ''}
${seeded?.bestSeason ? `<h2>Quando ir</h2><p>${escapeHtml(seeded.bestSeason)}</p>` : ''}
<h2>Como chegar a ${escapeHtml(d.nome)}</h2>
<p>${
            seeded?.howToGet
              ? escapeHtml(seeded.howToGet)
              : `O aeroporto mais usado para chegar a ${escapeHtml(d.nome)} tem o código ${escapeHtml(d.aeroporto)}. Compare passagens e horários na Froc Rota e, se preferir, peça ao concierge um roteiro completo com transfer.`
          }</p>
<h2>Ofertas de parceiros em ${escapeHtml(d.nome)}</h2>
${offers.length ? listingCards(offers) : `<p>Ainda não há parceiros publicados aqui. Seja o primeiro a anunciar em ${escapeHtml(d.nome)} e apareça para quem está planejando a viagem.</p>`}
${related.length ? `<h2>Leia antes de ir</h2>${postCards(related)}` : ''}
${
  near.length
    ? `<h2>Destinos perto de ${escapeHtml(d.nome)}</h2><div class="grid">${near
        .map((x) => `<a class="card" href="/destinos/${x.slug}"><span class="k">${x.uf}</span><h3>${escapeHtml(x.nome)}</h3></a>`)
        .join('')}</div>`
    : ''
}
${advertiserBox(d.nome)}`,
          jsonLd: [
            {
              '@context': 'https://schema.org',
              '@type': 'TouristDestination',
              name: d.nome,
              description: d.resumo,
              url: `${base}/destinos/${d.slug}`,
              geo: { '@type': 'GeoCoordinates', latitude: d.lat, longitude: d.lng },
              containedInPlace: { '@type': 'State', name: estado },
              includesAttraction: d.atrativos.map((a) => ({ '@type': 'TouristAttraction', name: a })),
            },
          ],
        })
      );
      return;
    }

    if (route === 'blog') {
      const page = Math.max(1, Number(q.pagina) || 1);
      const per = 30;
      const items = data.posts.slice((page - 1) * per, page * per);
      const pages = Math.max(1, Math.ceil(data.posts.length / per));
      if (page > pages) return notFound(res);
      send(
        res,
        200,
        renderPage({
          path: page > 1 ? `/blog?pagina=${page}` : '/blog',
          title: seoTitle(page > 1 ? `Blog de viagem pelo Brasil – página ${page}` : 'Blog de viagem pelo Brasil: dicas e roteiros'),
          description: metaDescription(
            'Blog de viagem pelo Brasil com dicas de destinos, praias, passeios, gastronomia e roteiros escritos pela equipe da Froc Rota, com novas matérias todos os dias.'
          ),
          h1: 'Blog de viagem pelo Brasil',
          breadcrumbs: [
            { name: 'Início', path: '/' },
            { name: 'Blog', path: '/blog' },
          ],
          bodyHtml: `<p class="lead">Dicas de viagem pelo Brasil todos os dias: destinos, praias, passeios, gastronomia e curiosidades. São ${data.posts.length} matérias e nenhuma sai do ar.</p>
${postCards(items)}
<div class="btns">${page > 1 ? `<a class="btn s" href="/blog?pagina=${page - 1}">← Mais recentes</a>` : ''}${
            page < pages ? `<a class="btn s" href="/blog?pagina=${page + 1}">Mais antigas →</a>` : ''
          }</div>`,
        })
      );
      return;
    }

    if (route === 'post') {
      const p = data.posts.find((x) => x.slug === slug);
      if (!p) return notFound(res);
      const hits = detectDestinos(`${p.title} ${p.summary} ${p.body}`, 2);
      const mainDest = hits[0]?.destino;
      const seeded = mainDest ? seededFor(mainDest, data.destinations) : undefined;
      const { html } = textToHtml(p.body);
      const more = data.posts.filter((x) => x.slug !== p.slug).slice(0, 4);
      const pr = p as unknown as { coverImage?: string; fotoCredito?: { author: string; license: string; pageUrl: string } | null; destinationSlug?: string | null };
      const realCover = pr.coverImage && /^https:\/\/upload\.wikimedia\.org\//.test(pr.coverImage) && pr.fotoCredito;
      const fotoPost: FotoReal | null = realCover
        ? { title: '', url1280: pr.coverImage!, url500: pr.coverImage!, pageUrl: pr.fotoCredito!.pageUrl, author: pr.fotoCredito!.author, license: pr.fotoCredito!.license, width: 0, height: 0 }
        : await fotoComPrazo(pr.destinationSlug || mainDest?.slug || '');
      send(
        res,
        200,
        renderPage({
          path: `/blog/${p.slug}`,
          image: fotoPost?.url1280,
          title: seoTitle(p.title),
          description: metaDescription(p.summary, 'Leia a matéria completa na Froc Rota Turismo.'),
          h1: p.title,
          ogType: 'article',
          breadcrumbs: [
            { name: 'Início', path: '/' },
            { name: 'Blog', path: '/blog' },
            { name: clip(p.title, 50), path: `/blog/${p.slug}` },
          ],
          bodyHtml: `<p class="chips"><span class="chip">${escapeHtml(p.category)}</span><span class="chip">Publicado em ${escapeHtml(
            String(p.publishDate).split('-').reverse().join('/')
          )}</span></p>
${fotoHtml(fotoPost, p.title)}<p class="lead">${escapeHtml(p.summary)}</p>
<article>${html}</article>
${
  mainDest
    ? `<div class="box"><h2>Vai para ${escapeHtml(mainDest.nome)}?</h2><p>Veja o guia do destino, passeios e hospedagens de parceiros verificados e passagens com preço em reais.</p><div class="btns"><a class="btn p" href="/destinos/${mainDest.slug}">Guia de ${escapeHtml(
        mainDest.nome
      )}</a>${destinationButtons(seeded?.slug ?? null, mainDest.nome, mainDest.aeroporto)}</div></div>`
    : ''
}
${more.length ? `<h2>Mais do blog</h2>${postCards(more)}` : ''}`,
          jsonLd: [
            {
              '@context': 'https://schema.org',
              '@type': 'BlogPosting',
              headline: clip(p.title, 110),
              description: p.summary,
              datePublished: p.publishDate,
              dateModified: p.publishDate,
              inLanguage: 'pt-BR',
              mainEntityOfPage: `${base}/blog/${p.slug}`,
              image: fotoPost?.url1280 || `${base}/og-froc-rota.jpg`,
              keywords: (p.keywordsJson || []).join(', '),
              author: { '@type': 'Organization', name: SITE_NAME, url: base },
              publisher: {
                '@type': 'Organization',
                name: SITE_NAME,
                logo: { '@type': 'ImageObject', url: `${base}/logo-froc-rota.png` },
              },
            },
          ],
        })
      );
      return;
    }

    if (route === 'oferta') {
      const l = data.listings.find((x) => x.slug === slug);
      if (!l) return notFound(res);
      const dest = data.destinations.find((d) => d.id === l.destinationId);
      const [reviews, merchantSnap] = await Promise.all([
        adminDb.collection('reviews').where('listingId', '==', l.id).get(),
        adminDb.collection('merchants').doc(String((l as ListingRow & { merchantId?: number }).merchantId ?? '')).get(),
      ]);
      // Ofertas de exemplo (parceiro sem conta real) não exibem nota: avaliação só de cliente real.
      const realMerchant = merchantSnap.exists && Boolean(merchantSnap.data()?.userUid);
      const visible = realMerchant ? reviews.docs.map((r) => r.data()).filter((r) => r.hidden !== true) : [];
      const avg = visible.length ? visible.reduce((a, r) => a + Number(r.rating || 0), 0) / visible.length : 0;
      const product: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: l.title,
        description: l.summary,
        category: MODULE_LABEL[l.moduleType] || l.moduleType,
        url: `${base}/ofertas/${l.slug}`,
        offers: {
          '@type': 'Offer',
          price: (l.priceCents / 100).toFixed(2),
          priceCurrency: 'BRL',
          availability: 'https://schema.org/InStock',
          url: `${base}/ofertas/${l.slug}`,
        },
      };
      // Nota só com avaliações reais publicadas (nunca inventada).
      if (visible.length > 0) {
        product.aggregateRating = { '@type': 'AggregateRating', ratingValue: avg.toFixed(1), reviewCount: visible.length };
      }
      const destPage = dest ? findDestinoBrasil(dest.slug) : undefined;
      send(
        res,
        200,
        renderPage({
          path: `/ofertas/${l.slug}`,
          title: seoTitle(l.title),
          description: metaDescription(`${l.summary}${dest ? ` Em ${dest.name}.` : ''} A partir de ${brl(l.priceCents)}.`),
          h1: l.title,
          breadcrumbs: [
            { name: 'Início', path: '/' },
            ...(destPage ? [{ name: destPage.nome, path: `/destinos/${destPage.slug}` }] : []),
            { name: clip(l.title, 50), path: `/ofertas/${l.slug}` },
          ],
          bodyHtml: `<p class="chips"><span class="chip">${escapeHtml(MODULE_LABEL[l.moduleType] || l.moduleType)}</span>${
            dest ? `<span class="chip">${escapeHtml(dest.name)}</span>` : ''
          }${visible.length ? `<span class="chip">${avg.toFixed(1)}★ (${visible.length} avaliação${visible.length > 1 ? 'ões' : ''})</span>` : ''}</p>
<p class="lead">${escapeHtml(l.summary)}</p>
<div class="box"><strong style="font-size:24px">${brl(l.priceCents)}</strong><div class="btns"><a class="btn p" href="/?oferta=${encodeURIComponent(
            l.slug
          )}">Ver datas e reservar</a></div><p>Pagamento seguro pelo Mercado Pago, com parceiro de identidade verificada.</p></div>
${textToHtml(l.description).html}
${l.address ? `<h2>Onde fica</h2><p>${escapeHtml(l.address)}</p>` : ''}
${l.cancellationPolicy ? `<h2>Cancelamento</h2><p>${escapeHtml(l.cancellationPolicy)}</p>` : ''}
${
  visible.length
    ? `<h2>O que dizem os viajantes</h2>${visible
        .slice(0, 5)
        .map((r) => `<p>“${escapeHtml(r.comment)}” — ${escapeHtml(r.authorName || 'viajante')}, ${Number(r.rating)}★</p>`)
        .join('')}`
    : ''
}`,
          jsonLd: [product],
        })
      );
      return;
    }

    if (route === 'anuncie') {
      const plans = (await adminDb.collection('merchant_plans').where('active', '==', true).get()).docs
        .map((x) => x.data())
        .filter((x) => Number(x.monthlyPriceCents) > 0)
        .sort((a, b) => Number(a.monthlyPriceCents) - Number(b.monthlyPriceCents));
      send(
        res,
        200,
        renderPage({
          path: '/anuncie',
          title: seoTitle('Anuncie seu negócio de turismo na Froc Rota'),
          description: metaDescription(
            'Anuncie seu negócio de turismo na Froc Rota: passeios de barco, pousadas, casas, restaurantes e guias, com reserva on-line e pagamento direto no seu Mercado Pago.'
          ),
          h1: 'Anuncie seu negócio de turismo para quem já está planejando a viagem',
          breadcrumbs: [
            { name: 'Início', path: '/' },
            { name: 'Anuncie', path: '/anuncie' },
          ],
          bodyHtml: `<p class="lead">Quem chega à Froc Rota já está escolhendo o destino. Anuncie seu negócio de turismo onde a decisão acontece: no guia do destino, no blog diário e nas sugestões da nossa IA.</p>
<div class="btns"><a class="btn p" href="/?painel=anunciante">Começar meu cadastro</a><a class="btn s" href="/destinos">Ver os ${DESTINOS_BRASIL.length} destinos</a></div>
<h2>Por que anunciar aqui</h2>
<div class="grid">
<div class="card"><h3>Vitrine em ${DESTINOS_BRASIL.length} destinos</h3><p>Sua oferta aparece na página do seu destino, feita para ser encontrada no Google e no Bing.</p></div>
<div class="card"><h3>IA que entende o turista</h3><p>Quem lê sobre a sua região recebe sugestões das ofertas de lá, no momento certo.</p></div>
<div class="card"><h3>Dinheiro direto na sua conta</h3><p>O pagamento cai no seu Mercado Pago com divisão automática. Sem esperar repasse.</p></div>
<div class="card"><h3>Clientes verificados</h3><p>Todo turista confirma e-mail, CPF e foto antes de reservar. Menos golpe, menos calote.</p></div>
<div class="card"><h3>Blog diário</h3><p>${data.posts.length} matérias publicadas e uma nova leva de matérias todo dia trazendo leitores para os destinos.</p></div>
<div class="card"><h3>Marketing com IA</h3><p>A Central de Marketing escreve textos e campanhas para o seu anúncio.</p></div>
</div>
<h2>Planos</h2>
<div class="grid">${plans
            .map(
              (p) =>
                `<div class="card"><span class="k">${escapeHtml(p.name)}</span><h3>${brl(Number(p.monthlyPriceCents))}/mês</h3><p>Comissão de ${(Number(p.commissionBps) / 100).toFixed(0)}% por reserva · até ${p.maxListings} anúncios</p><ul>${(
                  (p.benefitsJson as string[]) || []
                )
                  .map((b) => `<li>${escapeHtml(b)}</li>`)
                  .join('')}</ul></div>`
            )
            .join('')}</div>
<p>Cobrança automática mensal no cartão. Desligue a renovação quando quiser.</p>
<h2>Como funciona</h2>
<p>1. Crie sua conta e confirme o e-mail. 2. Verifique sua identidade (CPF, documento e selfie) em poucos minutos. 3. Cadastre a empresa; a IA confere e aprova. 4. Ative o plano e conecte o Mercado Pago. 5. Publique seus anúncios.</p>
<div class="btns"><a class="btn p" href="/?painel=anunciante">Quero anunciar agora</a></div>`,
          jsonLd: [
            {
              '@context': 'https://schema.org',
              '@type': 'Service',
              name: 'Anúncios para negócios de turismo',
              provider: { '@type': 'Organization', name: SITE_NAME, url: base },
              areaServed: 'BR',
            },
          ],
        })
      );
      return;
    }

    if (route === 'sobre' || route === 'contato' || route === 'privacidade' || route === 'termos') {
      const pages = {
        sobre: {
          path: '/sobre',
          title: seoTitle('Sobre a Froc Rota Turismo'),
          description: metaDescription(
            'Sobre a Froc Rota Turismo: plataforma brasileira que reúne destinos, passeios, hospedagens, restaurantes, passagens e concierge com parceiros verificados e pagamento seguro.'
          ),
          h1: 'Sobre a Froc Rota Turismo',
          body: `<p class="lead">A Froc Rota Turismo nasceu para ser a vitrine do turismo brasileiro: um só lugar para descobrir destinos, reservar com quem é verificado e viajar com segurança.</p><h2>O que fazemos</h2><p>Reunimos ${DESTINOS_BRASIL.length} destinos do Brasil, conectamos turistas a parceiros locais (passeios, hospedagens, restaurantes e serviços), buscamos passagens em tempo real e montamos roteiros sob medida pelo concierge.</p><h2>Segurança em primeiro lugar</h2><p>Todo usuário e todo anunciante passa por verificação de identidade. Pagamentos são feitos pelo Mercado Pago, com divisão automática entre parceiro e plataforma.</p><div class="btns"><a class="btn p" href="/destinos">Explorar destinos</a><a class="btn s" href="/anuncie">Anunciar</a></div>`,
        },
        contato: {
          path: '/contato',
          title: seoTitle('Contato da Froc Rota Turismo'),
          description: metaDescription(
            'Fale com a Froc Rota Turismo: dúvidas sobre reservas, anúncios, pagamentos ou privacidade. Atendimento pelo chat em tempo real do site, todos os dias.'
          ),
          h1: 'Contato',
          body: `<p class="lead">Estamos aqui para ajudar com reservas, anúncios, pagamentos e privacidade.</p><h2>Atendimento</h2><p>Fale com a gente pelo chat em tempo real do site (botão "Chat em Tempo Real") ou por ${contactLine()}.</p><h2>Para anunciantes</h2><p>Veja os planos e comece o cadastro em <a href="/anuncie">Anuncie</a>.</p>`,
        },
        privacidade: {
          path: '/politica-de-privacidade',
          title: seoTitle('Política de Privacidade (LGPD)'),
          description: metaDescription(
            'Política de Privacidade da Froc Rota Turismo conforme a LGPD: quais dados coletamos, para que usamos, com quem compartilhamos e como exercer seus direitos.'
          ),
          h1: 'Política de Privacidade',
          body: privacyHtml(),
        },
        termos: {
          path: '/termos-de-uso',
          title: seoTitle('Termos de Uso da Froc Rota Turismo'),
          description: metaDescription(
            'Termos de Uso da Froc Rota Turismo: cadastro e verificação, reservas e pagamentos com divisão automática, passagens, regras para anunciantes e avaliações.'
          ),
          h1: 'Termos de Uso',
          body: termsHtml(),
        },
      }[route];
      send(
        res,
        200,
        renderPage({
          path: pages.path,
          title: pages.title,
          description: pages.description,
          h1: pages.h1,
          breadcrumbs: [
            { name: 'Início', path: '/' },
            { name: pages.h1, path: pages.path },
          ],
          bodyHtml: pages.body,
          jsonLd:
            route === 'sobre'
              ? [{ '@context': 'https://schema.org', '@type': 'Organization', name: SITE_NAME, url: base, logo: `${base}/logo-froc-rota.png` }]
              : [],
        }),
        'text/html; charset=utf-8',
        3600
      );
      return;
    }

    notFound(res);
  } catch (error) {
    console.error('SEO page error:', error);
    send(res, 500, '<!doctype html><title>Erro</title><p>Erro temporário. Tente de novo em instantes.</p>', 'text/html; charset=utf-8');
  }
}

/** Foto real do destino sem segurar a página: se o Commons demorar, a página sai sem foto e tenta de novo na próxima visita. */
async function fotoComPrazo(slug: string, ms = 4000): Promise<FotoReal | null> {
  if (!slug) return null;
  return Promise.race([
    fotoDoDestino(slug).catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

function fotoHtml(foto: FotoReal | null, alt: string): string {
  if (!foto) return '';
  return `<figure class="foto"><img src="${escapeHtml(foto.url1280)}" alt="${escapeHtml(alt)}" width="1280" height="720" loading="eager" decoding="async" referrerpolicy="no-referrer"><figcaption>Foto: <a href="${escapeHtml(
    foto.pageUrl
  )}" rel="noopener" target="_blank">${escapeHtml(foto.author)} · ${escapeHtml(foto.license)} · Wikimedia Commons</a></figcaption></figure>`;
}
