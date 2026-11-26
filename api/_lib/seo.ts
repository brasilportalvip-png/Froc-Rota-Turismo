import crypto from 'node:crypto';

/**
 * SEO da Froc Rota seguindo as regras do Yoast SEO (o mesmo checklist do plugin do WordPress):
 * título SEO até 60 caracteres, meta descrição 120–156, palavra-chave no título, na descrição, na URL,
 * no H1 e no primeiro parágrafo, densidade 0,5%–3%, texto com 300+ palavras em matérias,
 * intertítulos, links internos e imagens com texto alternativo.
 */

export const SITE_NAME = 'Froc Rota Turismo';

export function siteUrl(): string {
  const raw =
    process.env.APP_URL ||
    (process.env.VERCEL_ENV !== 'production' && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://froc-rota-turismo.vercel.app');
  return raw.replace(/\/+$/, '');
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function slugify(s: string): string {
  return norm(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Corta no limite sem quebrar palavra. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${cut.slice(0, sp > max * 0.6 ? sp : cut.length).replace(/[,.;:\s]+$/, '')}…`;
}

/** Título SEO (até 60): "Assunto | Froc Rota" quando couber. */
export function seoTitle(main: string): string {
  const suffix = ' | Froc Rota';
  const m = main.replace(/\s+/g, ' ').trim();
  if (m.length + suffix.length <= 60) return `${m}${suffix}`;
  return clip(m, 60);
}

/** Meta descrição 120–156 caracteres, completando com chamada para ação quando ficar curta. */
export function metaDescription(text: string, cta = 'Reserve com parceiros verificados na Froc Rota.'): string {
  let d = text.replace(/\s+/g, ' ').trim();
  if (d.length < 120) d = `${d.replace(/[.!]?$/, '.')} ${cta}`;
  if (d.length < 120) d = `${d} Destinos, passeios, pousadas e passagens em reais num só lugar.`;
  return clip(d, 156);
}

export interface YoastCheck {
  id: string;
  ok: boolean;
  label: string;
}

export function analyzeSeo(p: {
  keyphrase: string;
  title: string;
  description: string;
  slug: string;
  h1: string;
  bodyText: string;
  internalLinks: number;
  imagesWithoutAlt: number;
  subheadings: number;
  minWords?: number;
}): { score: number; checks: YoastCheck[] } {
  const k = norm(p.keyphrase).trim();
  const kSlug = slugify(p.keyphrase);
  const body = norm(p.bodyText);
  const words = body.split(/\s+/).filter(Boolean);
  const firstParagraph = norm(p.bodyText.split(/\n{2,}|\n/)[0] || '');
  const occurrences = k ? body.split(k).length - 1 : 0;
  const kWords = Math.max(1, k.split(/\s+/).length);
  const density = words.length ? (occurrences * kWords * 100) / words.length : 0;
  const minWords = p.minWords ?? 300;
  const checks: YoastCheck[] = [
    { id: 'title-length', ok: p.title.length >= 30 && p.title.length <= 60, label: 'Título SEO entre 30 e 60 caracteres' },
    { id: 'desc-length', ok: p.description.length >= 120 && p.description.length <= 156, label: 'Meta descrição entre 120 e 156 caracteres' },
    { id: 'kp-title', ok: Boolean(k) && norm(p.title).includes(k), label: 'Palavra-chave no título SEO' },
    { id: 'kp-desc', ok: Boolean(k) && norm(p.description).includes(k), label: 'Palavra-chave na meta descrição' },
    { id: 'kp-slug', ok: Boolean(kSlug) && p.slug.includes(kSlug.split('-')[0]), label: 'Palavra-chave na URL' },
    { id: 'kp-h1', ok: Boolean(k) && norm(p.h1).includes(k), label: 'Palavra-chave no título da página (H1)' },
    { id: 'kp-intro', ok: Boolean(k) && firstParagraph.includes(k), label: 'Palavra-chave no primeiro parágrafo' },
    { id: 'density', ok: density >= 0.5 && density <= 3, label: 'Densidade da palavra-chave entre 0,5% e 3%' },
    { id: 'length', ok: words.length >= minWords, label: `Texto com pelo menos ${minWords} palavras` },
    { id: 'subheadings', ok: p.subheadings >= 1, label: 'Usa intertítulos (H2)' },
    { id: 'internal-links', ok: p.internalLinks >= 2, label: 'Tem links internos' },
    { id: 'img-alt', ok: p.imagesWithoutAlt === 0, label: 'Todas as imagens têm texto alternativo' },
  ];
  const score = Math.round((checks.filter((c) => c.ok).length * 100) / checks.length);
  return { score, checks };
}

export interface PageInput {
  path: string;
  title: string;
  description: string;
  h1: string;
  breadcrumbs: Array<{ name: string; path: string }>;
  bodyHtml: string;
  jsonLd?: Array<Record<string, unknown>>;
  ogType?: 'website' | 'article';
  image?: string;
  noindex?: boolean;
}

const CSS = `
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;background:#fafaf7;line-height:1.65}
a{color:#0b5d1e}a:hover{color:#FF1493}
.foto{margin:0 0 18px}.foto img{width:100%;height:auto;max-height:520px;object-fit:cover;border-radius:14px;display:block}.foto figcaption{font-size:11px;color:#666;margin-top:4px}.foto figcaption a{color:#666}
header.top{background:#111;color:#fff;position:sticky;top:0;z-index:5}
header.top .in{max-width:1080px;margin:0 auto;padding:10px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header.top a{color:#fff;text-decoration:none;font-weight:600;font-size:14px}
header.top .brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:17px;margin-right:auto}
header.top .brand img{width:34px;height:34px;border-radius:8px}
header.top .cta{background:#39FF14;color:#111;padding:8px 14px;border-radius:10px}
main{max-width:1080px;margin:0 auto;padding:20px 16px 48px}
nav.bc{font-size:13px;color:#555;margin-bottom:10px}nav.bc a{color:#555}
h1{font-size:clamp(26px,4vw,40px);line-height:1.15;margin:6px 0 12px}
h2{font-size:22px;margin:28px 0 8px}
.lead{font-size:18px;color:#333}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin:14px 0}
.card{background:#fff;border:1px solid #e5e5e0;border-radius:16px;padding:16px;text-decoration:none;color:#111;display:block;transition:transform .15s,box-shadow .15s}
.card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.08)}
.card .k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#0b5d1e;font-weight:700}
.card h3{margin:6px 0;font-size:18px}
.btns{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}
.btn{display:inline-block;padding:12px 18px;border-radius:12px;font-weight:800;text-decoration:none;border:2px solid #111}
.btn.p{background:#39FF14;color:#111}.btn.s{background:#fff;color:#111}
.box{background:#fff;border:2px solid #111;border-radius:18px;padding:18px;margin:20px 0}
.gold{background:linear-gradient(135deg,#13233f,#1d3b63);color:#fff;border:0}.gold h2,.gold p{color:#fff}.gold .btn.s{border-color:#fff}
.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{background:#fff;border:1px solid #ddd;border-radius:999px;padding:4px 10px;font-size:13px}
article p{margin:0 0 14px}
footer{background:#111;color:#ccc;font-size:14px}footer .in{max-width:1080px;margin:0 auto;padding:24px 16px;display:flex;gap:18px;flex-wrap:wrap}footer a{color:#ccc}
`;

export function renderPage(p: PageInput): string {
  const base = siteUrl();
  const url = `${base}${p.path}`;
  const image = p.image || `${base}/og-froc-rota.jpg`;
  const bcLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: p.breadcrumbs.map((b, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: b.name,
      item: `${base}${b.path}`,
    })),
  };
  const ld = [bcLd, ...(p.jsonLd ?? [])];
  // Código do Google Search Console do dono (é público por natureza: fica no <head> de todas as páginas).
  const verify = `<meta name="google-site-verification" content="${escapeHtml(
    process.env.GOOGLE_SITE_VERIFICATION || 'WgcZ29owPWh-IYCntXdzzCadEoHsfk7NA7rx65_NRE4'
  )}">`;
  const bing = process.env.BING_SITE_VERIFICATION
    ? `<meta name="msvalidate.01" content="${escapeHtml(process.env.BING_SITE_VERIFICATION)}">`
    : '';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(p.title)}</title>
<meta name="description" content="${escapeHtml(p.description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta name="robots" content="${p.noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large,max-snippet:-1'}">
${verify}${bing}
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="${p.ogType || 'website'}">
<meta property="og:title" content="${escapeHtml(p.title)}">
<meta property="og:description" content="${escapeHtml(p.description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(p.title)}">
<meta name="twitter:description" content="${escapeHtml(p.description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<link rel="icon" type="image/png" href="/favicon-48.png">
<meta name="theme-color" content="#111111">
<style>${CSS}</style>
${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<header class="top"><div class="in">
<a class="brand" href="/"><img src="/logo-emblema.png" alt="Logotipo Froc Rota Turismo" width="34" height="34">Froc Rota</a>
<a href="/destinos">Destinos</a><a href="/blog">Blog</a><a href="/anuncie">Anuncie</a><a class="cta" href="/">Abrir o app</a>
</div></header>
<main>
<nav class="bc" aria-label="Você está em">${p.breadcrumbs
    .map((b, i) => (i === p.breadcrumbs.length - 1 ? escapeHtml(b.name) : `<a href="${escapeHtml(b.path)}">${escapeHtml(b.name)}</a>`))
    .join(' › ')}</nav>
<h1>${escapeHtml(p.h1)}</h1>
${p.bodyHtml}
</main>
<footer><div class="in">
<span>© ${new Date().getFullYear()} ${SITE_NAME}</span>
<a href="/sobre">Sobre</a><a href="/contato">Contato</a><a href="/politica-de-privacidade">Política de Privacidade</a><a href="/termos-de-uso">Termos de Uso</a><a href="/anuncie">Anuncie</a><a href="/sitemap.xml">Sitemap</a>
</div></footer>
</body>
</html>`;
}

/** Texto em parágrafos (\n) → HTML seguro, com intertítulos para linhas curtas terminadas em ":". */
export function textToHtml(text: string): { html: string; subheadings: number } {
  let subheadings = 0;
  const html = String(text || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      if ((l.length < 80 && /:$/.test(l)) || /^#{2,3}\s/.test(l)) {
        subheadings += 1;
        return `<h2>${escapeHtml(l.replace(/^#{2,3}\s/, '').replace(/:$/, ''))}</h2>`;
      }
      return `<p>${escapeHtml(l)}</p>`;
    })
    .join('\n');
  return { html, subheadings };
}

export const LEGAL_UPDATED = '26/11/2026';

/** E-mail de contato público (CONTACT_EMAIL na Vercel). Sem ele, as páginas indicam o chat do site. */
export function contactLine(): string {
  const e = (process.env.CONTACT_EMAIL || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
    ? `<a href="mailto:${escapeHtml(e)}">${escapeHtml(e)}</a>`
    : 'o chat em tempo real do site';
}

export const privacyHtml = () => `
<p class="lead">A Froc Rota Turismo respeita sua privacidade e trata dados pessoais conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018 – LGPD). Atualizada em ${LEGAL_UPDATED}.</p>
<h2>Quem somos</h2>
<p>A Froc Rota Turismo é uma plataforma on-line que conecta turistas a parceiros de turismo (passeios, hospedagens, restaurantes e serviços) e oferece busca de passagens e concierge. Contato do encarregado de dados: ${contactLine()}.</p>
<h2>Quais dados coletamos</h2>
<p>Dados de cadastro (nome, e-mail), dados de verificação de identidade (CPF, data de nascimento, foto do documento e selfie), dados de reservas e pagamentos (processados pelo Mercado Pago; não guardamos número de cartão), mensagens enviadas no chat e dados de navegação (páginas vistas e interesses), estes últimos guardados no seu próprio aparelho e usados somente com o seu consentimento.</p>
<h2>Para que usamos</h2>
<p>Para criar e proteger sua conta, prevenir fraude (verificação de CPF e fotos analisadas por inteligência artificial e, quando necessário, por pessoa da equipe), processar reservas e pagamentos, repassar valores aos parceiros, atender você, cumprir obrigações legais e, com seu consentimento, personalizar sugestões de viagem.</p>
<h2>Base legal</h2>
<p>Execução de contrato (reservas e anúncios), cumprimento de obrigação legal, legítimo interesse na prevenção a fraudes e segurança, e consentimento para personalização e comunicações de marketing.</p>
<h2>Com quem compartilhamos</h2>
<p>Com o parceiro responsável pela sua reserva (somente o necessário para prestar o serviço), com o Mercado Pago (pagamentos), com provedores de infraestrutura e de inteligência artificial que processam dados em nosso nome (Google Cloud/Firebase, Google Gemini, Vercel) e com autoridades quando a lei exigir. Não vendemos dados pessoais.</p>
<h2>Segurança e retenção</h2>
<p>O CPF é guardado de forma mascarada e com código de verificação; as fotos de identidade ficam em área restrita, acessível somente à análise antifraude. Mantemos os dados pelo tempo necessário às finalidades acima e aos prazos legais.</p>
<h2>Seus direitos</h2>
<p>Você pode pedir confirmação, acesso, correção, anonimização, portabilidade, eliminação de dados tratados com consentimento, informação sobre compartilhamento e revogar o consentimento a qualquer momento, pelo e-mail acima. Também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>
<h2>Cookies e personalização</h2>
<p>Usamos armazenamento local do navegador para manter sua sessão e, se você aceitar, para lembrar os destinos que mais interessam a você e mostrar oportunidades parecidas. Você pode recusar ou apagar a qualquer momento no aviso de privacidade do site ou limpando os dados do navegador.</p>
`;

export const termsHtml = () => `
<p class="lead">Estes Termos regem o uso da plataforma Froc Rota Turismo. Ao usar o site você concorda com eles. Atualizados em ${LEGAL_UPDATED}.</p>
<h2>O que é a Froc Rota</h2>
<p>Somos uma plataforma que aproxima turistas e parceiros de turismo. Os serviços anunciados (passeios, hospedagens, refeições e outros) são prestados pelos próprios parceiros, que respondem pela sua execução, segurança e licenças exigidas (como o Cadastur, quando obrigatório).</p>
<h2>Cadastro e verificação</h2>
<p>Para reservar ou anunciar é obrigatório confirmar o e-mail e verificar a identidade com CPF verdadeiro, foto do documento e selfie. Cadastros falsos, de terceiros ou com sinais de fraude são recusados ou bloqueados.</p>
<h2>Reservas e pagamentos</h2>
<p>O pagamento é feito pelo Mercado Pago com divisão automática: o valor do serviço vai ao parceiro e a comissão da plataforma fica com a Froc Rota. A reserva é confirmada após a aprovação do pagamento. Cancelamentos e reembolsos seguem a política informada em cada oferta e o Código de Defesa do Consumidor, inclusive o direito de arrependimento em compras on-line quando aplicável.</p>
<h2>Passagens aéreas</h2>
<p>Preços e horários de passagens vêm em tempo real dos fornecedores e podem mudar até a emissão. Tarifas em moeda estrangeira são mostradas em reais pela cotação oficial do Banco Central do dia, com a taxa de serviço da Froc Rota informada antes da compra.</p>
<h2>Anunciantes</h2>
<p>Anunciantes assinam um plano pago com cobrança automática mensal no cartão. O anúncio só é publicado com cadastro verificado, plano em dia e conta Mercado Pago conectada. O anunciante garante que as informações, fotos e preços são verdadeiros e que tem direito de usá-los.</p>
<h2>Conteúdo e avaliações</h2>
<p>Avaliações devem ser honestas e sobre experiências reais. Conteúdo ofensivo, falso, propaganda de terceiros ou com dados pessoais pode ser ocultado pela moderação.</p>
<h2>Responsabilidade</h2>
<p>A Froc Rota se responsabiliza pelo funcionamento da plataforma e pelo processamento correto dos pagamentos, na forma da lei. Problemas na prestação do serviço devem ser comunicados pelo chat do site para mediação com o parceiro.</p>
<h2>Contato e foro</h2>
<p>Fale com a gente em ${contactLine()}. Aplica-se a lei brasileira; fica eleito o foro do domicílio do consumidor.</p>
`;

/** Chave pública do IndexNow (Bing, Yandex…). Estável, derivada dos segredos do servidor. */
export function indexNowKey(): string {
  if (process.env.INDEXNOW_KEY) return process.env.INDEXNOW_KEY;
  const base = `${process.env.FIREBASE_SERVICE_ACCOUNT_KEY || ''}|${process.env.MERCADOPAGO_WEBHOOK_SECRET || ''}`;
  return crypto.createHash('sha256').update(`indexnow|${base}`).digest('hex').slice(0, 32);
}

/** Avisa Bing e parceiros do IndexNow que há páginas novas (o Google lê o sitemap). */
export async function pingIndexNow(paths: string[]): Promise<boolean> {
  if (paths.length === 0) return false;
  const base = siteUrl();
  try {
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(base).host,
        key: indexNowKey(),
        keyLocation: `${base}/indexnow-key.txt`,
        urlList: paths.map((p) => `${base}${p}`),
      }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

