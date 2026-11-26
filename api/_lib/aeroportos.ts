/**
 * Cidades e aeroportos para a busca de passagens: o cliente digita a CIDADE (ex.: "Natal", "São Paulo")
 * e o site usa o código certo. Cidades com mais de um aeroporto têm a opção "Todos os aeroportos"
 * (código de cidade da IATA, aceito pela Duffel: SAO, RIO, BHZ...).
 */

export interface Aeroporto {
  codigo: string;
  cidade: string;
  uf: string; // estado (Brasil) ou país (exterior)
  nome: string; // nome do aeroporto ou "Todos os aeroportos"
  todos?: boolean;
  pais?: string;
}

const BR: Array<[string, string, string, string]> = [
  // [código, cidade, UF, aeroporto]
  ['GRU', 'São Paulo', 'SP', 'Guarulhos'],
  ['CGH', 'São Paulo', 'SP', 'Congonhas'],
  ['VCP', 'Campinas', 'SP', 'Viracopos'],
  ['GIG', 'Rio de Janeiro', 'RJ', 'Galeão'],
  ['SDU', 'Rio de Janeiro', 'RJ', 'Santos Dumont'],
  ['CNF', 'Belo Horizonte', 'MG', 'Confins'],
  ['PLU', 'Belo Horizonte', 'MG', 'Pampulha'],
  ['BSB', 'Brasília', 'DF', 'Presidente Juscelino Kubitschek'],
  ['SSA', 'Salvador', 'BA', 'Deputado Luís Eduardo Magalhães'],
  ['REC', 'Recife', 'PE', 'Guararapes'],
  ['FOR', 'Fortaleza', 'CE', 'Pinto Martins'],
  ['NAT', 'Natal', 'RN', 'Governador Aluízio Alves'],
  ['MCZ', 'Maceió', 'AL', 'Zumbi dos Palmares'],
  ['JPA', 'João Pessoa', 'PB', 'Presidente Castro Pinto'],
  ['AJU', 'Aracaju', 'SE', 'Santa Maria'],
  ['THE', 'Teresina', 'PI', 'Senador Petrônio Portella'],
  ['SLZ', 'São Luís', 'MA', 'Marechal Cunha Machado'],
  ['BEL', 'Belém', 'PA', 'Val-de-Cans'],
  ['MAO', 'Manaus', 'AM', 'Eduardo Gomes'],
  ['POA', 'Porto Alegre', 'RS', 'Salgado Filho'],
  ['CWB', 'Curitiba', 'PR', 'Afonso Pena'],
  ['FLN', 'Florianópolis', 'SC', 'Hercílio Luz'],
  ['NVT', 'Navegantes', 'SC', 'Ministro Victor Konder (Balneário Camboriú)'],
  ['JOI', 'Joinville', 'SC', 'Lauro Carneiro de Loyola'],
  ['IGU', 'Foz do Iguaçu', 'PR', 'Cataratas'],
  ['CGB', 'Cuiabá', 'MT', 'Marechal Rondon'],
  ['CGR', 'Campo Grande', 'MS', 'Campo Grande'],
  ['GYN', 'Goiânia', 'GO', 'Santa Genoveva'],
  ['VIX', 'Vitória', 'ES', 'Eurico de Aguiar Salles'],
  ['PMW', 'Palmas', 'TO', 'Brigadeiro Lysias Rodrigues'],
  ['MCP', 'Macapá', 'AP', 'Alberto Alcolumbre'],
  ['BVB', 'Boa Vista', 'RR', 'Atlas Brasil Cantanhede'],
  ['PVH', 'Porto Velho', 'RO', 'Governador Jorge Teixeira'],
  ['RBR', 'Rio Branco', 'AC', 'Plácido de Castro'],
  ['FEN', 'Fernando de Noronha', 'PE', 'Fernando de Noronha'],
  ['BPS', 'Porto Seguro', 'BA', 'Porto Seguro'],
  ['IOS', 'Ilhéus', 'BA', 'Jorge Amado'],
  ['LEC', 'Lençóis', 'BA', 'Horácio de Mattos (Chapada Diamantina)'],
  ['BYO', 'Bonito', 'MS', 'Bonito'],
  ['JJD', 'Jericoacoara', 'CE', 'Comandante Ariston Pessoa (Cruz)'],
  ['PHB', 'Parnaíba', 'PI', 'Prefeito Dr. João Silva Filho'],
  ['STM', 'Santarém', 'PA', 'Maestro Wilson Fonseca'],
  ['PIN', 'Parintins', 'AM', 'Júlio Belém'],
  ['CLV', 'Caldas Novas', 'GO', 'Nelson Ribeiro Guimarães'],
  ['LDB', 'Londrina', 'PR', 'Governador José Richa'],
  ['MGF', 'Maringá', 'PR', 'Sílvio Name Júnior'],
  ['UDI', 'Uberlândia', 'MG', 'Ten. Cel. Aviador César Bombonato'],
  ['RAO', 'Ribeirão Preto', 'SP', 'Leite Lopes'],
  ['SJP', 'São José do Rio Preto', 'SP', 'Prof. Eribelto Manoel Reino'],
  ['CXJ', 'Caxias do Sul', 'RS', 'Hugo Cantergiani'],
  ['IMP', 'Imperatriz', 'MA', 'Prefeito Renato Moreira'],
  ['JDO', 'Juazeiro do Norte', 'CE', 'Orlando Bezerra de Menezes'],
  ['PNZ', 'Petrolina', 'PE', 'Senador Nilo Coelho'],
  ['CPV', 'Campina Grande', 'PB', 'Presidente João Suassuna'],
  ['MOC', 'Montes Claros', 'MG', 'Mário Ribeiro'],
  ['NAT', 'Natal', 'RN', 'Governador Aluízio Alves'],
];

const CIDADES_COM_VARIOS: Array<[string, string, string]> = [
  ['SAO', 'São Paulo', 'SP'],
  ['RIO', 'Rio de Janeiro', 'RJ'],
  ['BHZ', 'Belo Horizonte', 'MG'],
];

const EXTERIOR: Array<[string, string, string, string, boolean?]> = [
  // [código, cidade, país, aeroporto, todos?]
  ['LIS', 'Lisboa', 'Portugal', 'Humberto Delgado'],
  ['OPO', 'Porto', 'Portugal', 'Francisco Sá Carneiro'],
  ['MAD', 'Madri', 'Espanha', 'Barajas'],
  ['BCN', 'Barcelona', 'Espanha', 'El Prat'],
  ['PAR', 'Paris', 'França', 'Todos os aeroportos', true],
  ['LON', 'Londres', 'Reino Unido', 'Todos os aeroportos', true],
  ['ROM', 'Roma', 'Itália', 'Todos os aeroportos', true],
  ['MIL', 'Milão', 'Itália', 'Todos os aeroportos', true],
  ['FRA', 'Frankfurt', 'Alemanha', 'Frankfurt'],
  ['AMS', 'Amsterdã', 'Holanda', 'Schiphol'],
  ['MIA', 'Miami', 'Estados Unidos', 'Miami'],
  ['MCO', 'Orlando', 'Estados Unidos', 'Orlando'],
  ['NYC', 'Nova York', 'Estados Unidos', 'Todos os aeroportos', true],
  ['FLL', 'Fort Lauderdale', 'Estados Unidos', 'Fort Lauderdale'],
  ['CUN', 'Cancún', 'México', 'Cancún'],
  ['MEX', 'Cidade do México', 'México', 'Benito Juárez'],
  ['BUE', 'Buenos Aires', 'Argentina', 'Todos os aeroportos', true],
  ['BRC', 'Bariloche', 'Argentina', 'Bariloche'],
  ['SCL', 'Santiago', 'Chile', 'Arturo Merino Benítez'],
  ['MVD', 'Montevidéu', 'Uruguai', 'Carrasco'],
  ['PDP', 'Punta del Este', 'Uruguai', 'Punta del Este'],
  ['LIM', 'Lima', 'Peru', 'Jorge Chávez'],
  ['BOG', 'Bogotá', 'Colômbia', 'El Dorado'],
  ['PTY', 'Cidade do Panamá', 'Panamá', 'Tocumen'],
  ['PUJ', 'Punta Cana', 'República Dominicana', 'Punta Cana'],
  ['DXB', 'Dubai', 'Emirados Árabes', 'Dubai'],
];

const vistos = new Set<string>();
export const AEROPORTOS: Aeroporto[] = [
  ...CIDADES_COM_VARIOS.map(([codigo, cidade, uf]) => ({ codigo, cidade, uf, nome: 'Todos os aeroportos', todos: true })),
  ...BR.map(([codigo, cidade, uf, nome]) => ({ codigo, cidade, uf, nome })),
  ...EXTERIOR.map(([codigo, cidade, pais, nome, todos]) => ({ codigo, cidade, uf: pais, pais, nome, todos: Boolean(todos) })),
].filter((a) => (vistos.has(a.codigo) ? false : (vistos.add(a.codigo), true)));

const sem = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Texto mostrado no campo: "São Paulo - SP (Todos os aeroportos)" ou "Natal - RN (NAT)". */
export function rotuloAeroporto(a: Aeroporto): string {
  return a.todos ? `${a.cidade} - ${a.uf} (Todos os aeroportos)` : `${a.cidade} - ${a.uf} (${a.codigo})`;
}

export function acharAeroporto(codigo: string): Aeroporto | undefined {
  const c = String(codigo || '').toUpperCase();
  return AEROPORTOS.find((a) => a.codigo === c);
}

/** Sugestões enquanto a pessoa digita: cidade, estado, nome do aeroporto ou o código. */
export function buscarAeroportos(texto: string, limite = 8): Aeroporto[] {
  const q = sem(texto);
  if (!q) return [];
  const pontos = (a: Aeroporto) => {
    const cidade = sem(a.cidade);
    const tudo = `${cidade} ${sem(a.uf)} ${sem(a.nome)} ${a.codigo.toLowerCase()}`;
    let p = 0;
    if (a.codigo.toLowerCase() === q) p += 100;
    if (cidade === q) p += 60;
    if (cidade.startsWith(q)) p += 40;
    if (cidade.split(' ').some((w) => w.startsWith(q))) p += 20;
    if (tudo.includes(q)) p += 10;
    if (q.split(' ').every((w) => tudo.includes(w))) p += 5;
    if (!p) return 0;
    if (a.todos) p += 3; // "Todos os aeroportos" aparece primeiro na cidade
    if (!a.pais) p += 1; // Brasil antes do exterior
    return p;
  };
  return AEROPORTOS.map((a) => ({ a, p: pontos(a) }))
    .filter((x) => x.p > 0)
    .sort((x, y) => y.p - x.p || x.a.cidade.localeCompare(y.a.cidade))
    .slice(0, limite)
    .map((x) => x.a);
}

export type CorPreco = 'verde' | 'laranja' | 'vermelho';

/**
 * Semáforo de preços: compara o menor preço de cada dia com os dias vizinhos.
 * Verde = mais barato do período; laranja = preço médio; vermelho = acima do preço.
 * Se a diferença entre o mais barato e o mais caro for pequena (até 5%), todos ficam verdes.
 */
export function semaforoPrecos(dias: Array<{ date: string; minCents: number | null }>): Array<{ date: string; minCents: number | null; cor: CorPreco | null }> {
  const precos = dias.map((d) => d.minCents).filter((x): x is number => typeof x === 'number' && x > 0);
  if (!precos.length) return dias.map((d) => ({ ...d, cor: null }));
  const min = Math.min(...precos);
  const max = Math.max(...precos);
  const faixa = max - min;
  return dias.map((d) => {
    if (typeof d.minCents !== 'number' || d.minCents <= 0) return { ...d, cor: null };
    if (faixa <= min * 0.05) return { ...d, cor: 'verde' as const };
    const pos = (d.minCents - min) / faixa;
    return { ...d, cor: pos <= 1 / 3 ? ('verde' as const) : pos <= 2 / 3 ? ('laranja' as const) : ('vermelho' as const) };
  });
}
