// Busca do site inteiro: destinos, ofertas, matérias do blog, passagens e todas as seções/páginas.
// Função pura (sem React) para ser testada sozinha.
import { buscarAeroportos, rotuloAeroporto } from '../../api/_lib/aeroportos.ts';

export type AcaoBusca =
  | { kind: 'destino'; id: number }
  | { kind: 'oferta'; id: number }
  | { kind: 'materia'; slug: string }
  | { kind: 'voo'; iata: string }
  | { kind: 'ancora'; id: string; filtro?: 'all' | 'experience' | 'gastronomy' | 'accommodation' }
  | { kind: 'link'; href: string }
  | { kind: 'modal'; nome: 'chat' | 'ia' | 'anunciante' | 'conta' | 'lgpd' };

export type TipoResultado = 'destino' | 'oferta' | 'materia' | 'voo' | 'secao';

export interface ResultadoBusca {
  key: string;
  tipo: TipoResultado;
  titulo: string;
  sub: string;
  acao: AcaoBusca;
  pontos: number;
}

export interface DestinoBusca {
  id: number;
  name: string;
  state: string;
  region?: string;
  category?: string;
  summary?: string;
  highlightsJson?: string[];
}
export interface OfertaBusca {
  id: number;
  title: string;
  moduleType: string;
  subtype?: string;
  address?: string;
  summary?: string;
  destinationId?: number;
}
export interface MateriaBusca {
  slug: string;
  title: string;
  category?: string;
  summary?: string;
}

interface Secao {
  titulo: string;
  sub: string;
  palavras: string;
  acao: AcaoBusca;
}

/** Todas as partes do site, com as palavras que as pessoas usam para procurar cada uma. */
export const SECOES_SITE: Secao[] = [
  { titulo: 'Destinos do Brasil', sub: 'Os 100 destinos, com filtros por região e estilo', palavras: 'destinos cidades lugares viajar praia serra brasil regioes', acao: { kind: 'ancora', id: 'destinos' } },
  { titulo: 'Mapa interativo', sub: 'Veja ofertas e comércios perto de você', palavras: 'mapa perto de mim localizacao onde estou google negocios proximo', acao: { kind: 'ancora', id: 'mapa' } },
  { titulo: 'Passeios e experiências', sub: 'Tours, trilhas, mergulho, barco e mais', palavras: 'passeios experiencias tour trilha mergulho barco buggy guia aventura atracoes viator getyourguide', acao: { kind: 'ancora', id: 'marketplace', filtro: 'experience' } },
  { titulo: 'Gastronomia', sub: 'Restaurantes e experiências gastronômicas', palavras: 'gastronomia restaurante comida comer jantar almoco bar culinaria', acao: { kind: 'ancora', id: 'marketplace', filtro: 'gastronomy' } },
  { titulo: 'Hospedagens', sub: 'Pousadas, hotéis e casas', palavras: 'hospedagem hotel pousada hostel casa chale resort dormir quarto', acao: { kind: 'ancora', id: 'marketplace', filtro: 'accommodation' } },
  { titulo: 'Passagens aéreas', sub: 'Compare voos em tempo real', palavras: 'passagens voos voo aviao aereo aeroporto companhia latam gol azul', acao: { kind: 'ancora', id: 'viagens' } },
  { titulo: 'Concierge: roteiro sob medida', sub: 'Peça um roteiro completo com orçamento', palavras: 'concierge roteiro personalizado viagem completa pacote orcamento agencia', acao: { kind: 'ancora', id: 'concierge' } },
  { titulo: 'Roteiro com inteligência artificial', sub: 'A IA monta um roteiro em segundos', palavras: 'ia inteligencia artificial roteiro assistente sugestao', acao: { kind: 'modal', nome: 'ia' } },
  { titulo: 'Froc X: motorista no destino', sub: 'Corridas do aeroporto ao hotel e seja motorista fundador', palavras: 'froc x uber motorista corrida carro transfer taxi aeroporto aplicativo app', acao: { kind: 'ancora', id: 'froc-x' } },
  { titulo: 'Blog e notícias de viagem', sub: 'Matérias diárias sobre turismo no Brasil', palavras: 'blog noticias materias jornal artigos dicas publicacoes', acao: { kind: 'ancora', id: 'publicacoes' } },
  { titulo: 'Chat em tempo real (atendimento)', sub: 'Fale com a equipe agora', palavras: 'chat atendimento suporte ajuda sac falar contato duvida reclamacao whatsapp', acao: { kind: 'modal', nome: 'chat' } },
  { titulo: 'Minha conta e minhas viagens', sub: 'Reservas, documentos, alertas de preço e perfil', palavras: 'minha conta perfil reservas viagens login entrar cadastro documentos alertas excluir conta senha', acao: { kind: 'modal', nome: 'conta' } },
  { titulo: 'Anuncie na Froc Rota', sub: 'Planos Básico, Profissional e Premium', palavras: 'anunciar anuncie anunciante parceiro empresa planos preco vender cadastrar negocio divulgar', acao: { kind: 'link', href: '/anuncie' } },
  { titulo: 'Painel do anunciante', sub: 'Gerencie anúncios, agenda e leilão de comissão', palavras: 'painel anunciante parceiro meus anuncios leilao comissao agenda', acao: { kind: 'modal', nome: 'anunciante' } },
  { titulo: 'Termos de Uso', sub: 'Reservas, cancelamento, arrependimento de 7 dias e SAC', palavras: 'termos uso regras cancelar cancelamento reembolso estorno arrependimento devolucao cdc consumidor', acao: { kind: 'link', href: '/termos-de-uso' } },
  { titulo: 'Política de Privacidade (LGPD)', sub: 'Seus dados, seus direitos e como excluir a conta', palavras: 'privacidade lgpd dados pessoais cookies excluir apagar conta encarregado dpo', acao: { kind: 'link', href: '/politica-de-privacidade' } },
  { titulo: 'Contato e dados da empresa', sub: 'CNPJ, endereço, e-mail e atendimento', palavras: 'contato email cnpj empresa endereco telefone razao social cadastur', acao: { kind: 'link', href: '/contato' } },
  { titulo: 'Sobre a Froc Rota', sub: 'Quem somos e como funciona', palavras: 'sobre quem somos empresa historia como funciona seguranca', acao: { kind: 'link', href: '/sobre' } },
  { titulo: 'LGPD, Privacidade e CDC (resumo)', sub: 'Resumo das regras de proteção ao turista', palavras: 'lgpd cdc governanca seguranca protecao', acao: { kind: 'modal', nome: 'lgpd' } },
];

const MODULO_PT: Record<string, string> = {
  experience: 'Passeio',
  gastronomy: 'Gastronomia',
  accommodation: 'Hospedagem',
};

export function normalizar(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const PARADAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'para', 'pra', 'a', 'o', 'as', 'os', 'com', 'um', 'uma']);

function termos(q: string): string[] {
  const t = normalizar(q).split(' ').filter(Boolean);
  const uteis = t.filter((x) => !PARADAS.has(x));
  return uteis.length ? uteis : t;
}

/**
 * Pontua um texto: todos os termos precisam aparecer (início de palavra).
 * forte = título/nome; fraco = palavras-chave e resumo.
 */
export function pontuar(qTermos: string[], forte: string, fraco = ''): number {
  if (!qTermos.length) return 0;
  const f = normalizar(forte);
  const fPal = f.split(' ');
  const w = normalizar(fraco).split(' ');
  const frase = qTermos.join(' ');
  let total = 0;
  for (const t of qTermos) {
    if (fPal.some((p) => p === t)) total += 30;
    else if (fPal.some((p) => p.startsWith(t))) total += 20;
    else if (t.length >= 4 && f.includes(t)) total += 10;
    else if (w.some((p) => p === t)) total += 8;
    else if (w.some((p) => p.startsWith(t))) total += 5;
    else return 0;
  }
  if (f === frase) total += 60;
  else if (f.startsWith(frase)) total += 35;
  return total;
}

export function buscarNoSite(
  q: string,
  dados: { destinos: DestinoBusca[]; ofertas: OfertaBusca[]; materias: MateriaBusca[] },
  limites = { destino: 6, oferta: 5, materia: 4, voo: 3, secao: 5 }
): ResultadoBusca[] {
  const qt = termos(q);
  if (!qt.length || normalizar(q).length < 2) return [];
  const nomeDestino = new Map(dados.destinos.map((d) => [d.id, `${d.name} ${d.state}`]));
  const out: ResultadoBusca[] = [];
  const top = (arr: ResultadoBusca[], n: number) => arr.sort((a, b) => b.pontos - a.pontos || a.titulo.localeCompare(b.titulo)).slice(0, n);

  out.push(
    ...top(
      dados.destinos
        .map((d) => ({
          key: `d-${d.id}`,
          tipo: 'destino' as const,
          titulo: `${d.name} - ${d.state}`,
          sub: [d.region, d.summary].filter(Boolean).join(' · ').slice(0, 110),
          acao: { kind: 'destino' as const, id: d.id },
          pontos: pontuar(qt, `${d.name} ${d.state}`, `${d.region || ''} ${d.category || ''} ${(d.highlightsJson || []).join(' ')} ${d.summary || ''}`),
        }))
        .filter((r) => r.pontos > 0),
      limites.destino
    )
  );

  out.push(
    ...top(
      dados.ofertas
        .map((o) => {
          const dest = nomeDestino.get(Number(o.destinationId)) || '';
          return {
            key: `o-${o.id}`,
            tipo: 'oferta' as const,
            titulo: o.title,
            sub: [MODULO_PT[o.moduleType] || 'Oferta', dest || o.address].filter(Boolean).join(' · ').slice(0, 110),
            acao: { kind: 'oferta' as const, id: o.id },
            pontos: pontuar(qt, o.title, `${MODULO_PT[o.moduleType] || ''} ${o.subtype || ''} ${dest} ${o.address || ''} ${o.summary || ''}`),
          };
        })
        .filter((r) => r.pontos > 0),
      limites.oferta
    )
  );

  out.push(
    ...top(
      dados.materias
        .map((m) => ({
          key: `m-${m.slug}`,
          tipo: 'materia' as const,
          titulo: m.title,
          sub: `Blog${m.category ? ` · ${m.category}` : ''}`,
          acao: { kind: 'materia' as const, slug: m.slug },
          pontos: pontuar(qt, m.title, `${m.category || ''} ${m.summary || ''}`),
        }))
        .filter((r) => r.pontos > 0),
      limites.materia
    )
  );

  // Passagens: "voo natal", "passagem para recife" ou só o nome da cidade.
  const pedeVoo = qt.some((t) => /^(voo|voos|passag|aere|aviao)/.test(t));
  const semPalavraVoo = qt.filter((t) => !/^(voo|voos|passag|aere|aviao)/.test(t)).join(' ');
  if (semPalavraVoo.length >= 3) {
    const aeros = buscarAeroportos(semPalavraVoo, limites.voo);
    aeros.forEach((a, i) =>
      out.push({
        key: `v-${a.codigo}`,
        tipo: 'voo',
        titulo: `Passagens para ${a.cidade}`,
        sub: rotuloAeroporto(a),
        acao: { kind: 'voo', iata: a.codigo },
        pontos: (pedeVoo ? 90 : 15) - i,
      })
    );
  }

  out.push(
    ...top(
      SECOES_SITE.map((s) => ({
        key: `s-${s.titulo}`,
        tipo: 'secao' as const,
        titulo: s.titulo,
        sub: s.sub,
        acao: s.acao,
        pontos: pontuar(qt, s.titulo, `${s.palavras} ${s.sub}`),
      })).filter((r) => r.pontos > 0),
      limites.secao
    )
  );

  return out;
}

/** Atalhos mostrados antes de digitar (para a pessoa conhecer o site inteiro). */
export function atalhosIniciais(): ResultadoBusca[] {
  return SECOES_SITE.map((s, i) => ({
    key: `s-${s.titulo}`,
    tipo: 'secao' as const,
    titulo: s.titulo,
    sub: s.sub,
    acao: s.acao,
    pontos: 100 - i,
  }));
}

export const ROTULO_TIPO: Record<TipoResultado, string> = {
  destino: 'Destinos',
  oferta: 'Passeios, restaurantes e hospedagens',
  materia: 'Blog',
  voo: 'Passagens aéreas',
  secao: 'Páginas e seções do site',
};
