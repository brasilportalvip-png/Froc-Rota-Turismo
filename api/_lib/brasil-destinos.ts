/**
 * Vitrine do Brasil: destinos turísticos reais, em texto próprio da Froc Rota.
 * Coordenadas aproximadas (centro do destino). "aeroporto" = aeroporto comercial mais usado para chegar.
 * "atrativos" alimenta a IA de intenção (ex.: quem lê sobre "Cristo Redentor" está pensando no Rio).
 */

export type Regiao = 'Norte' | 'Nordeste' | 'Centro-Oeste' | 'Sudeste' | 'Sul';
export type CategoriaDestino =
  | 'praia'
  | 'ilha'
  | 'cachoeira'
  | 'parque'
  | 'historico'
  | 'serra'
  | 'cidade'
  | 'ecoturismo';

export interface DestinoBrasil {
  slug: string;
  nome: string;
  uf: string;
  regiao: Regiao;
  categoria: CategoriaDestino;
  lat: number;
  lng: number;
  aeroporto: string;
  resumo: string;
  atrativos: string[];
}

const UF_REGIAO: Record<string, Regiao> = {
  AC: 'Norte', AM: 'Norte', AP: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte',
  AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste', PE: 'Nordeste', PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste',
  DF: 'Centro-Oeste', GO: 'Centro-Oeste', MS: 'Centro-Oeste', MT: 'Centro-Oeste',
  ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste',
  PR: 'Sul', RS: 'Sul', SC: 'Sul',
};

export const UF_NOME: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso',
  PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};

type Linha = [string, string, string, CategoriaDestino, number, number, string, string, string[]];

// [slug, nome, UF, categoria, lat, lng, aeroporto, resumo, atrativos]
const LINHAS: Linha[] = [
  // ---------- Sudeste ----------
  ['rio-de-janeiro', 'Rio de Janeiro', 'RJ', 'cidade', -22.91, -43.17, 'GIG', 'A cidade que junta mar, montanha e floresta: praias famosas, mirantes de cartão-postal e a energia carioca o ano inteiro.', ['Cristo Redentor', 'Corcovado', 'Pão de Açúcar', 'Copacabana', 'Ipanema', 'Lapa', 'Maracanã', 'Santa Teresa', 'Floresta da Tijuca', 'Escadaria Selarón']],
  ['paraty', 'Paraty', 'RJ', 'historico', -23.22, -44.71, 'GIG', 'Centro colonial de ruas de pedra diante de uma baía com dezenas de ilhas, cachoeiras e alambiques.', ['Saco do Mamanguá', 'centro histórico de Paraty', 'Trindade', 'passeio de escuna', 'Flip']],
  ['ilha-grande', 'Ilha Grande', 'RJ', 'ilha', -23.14, -44.23, 'GIG', 'Ilha sem carros, com trilhas na Mata Atlântica e algumas das praias mais bonitas do litoral fluminense.', ['Lopes Mendes', 'Lagoa Azul', 'Abraão', 'Praia de Dois Rios', 'Lagoa Verde']],
  ['angra-dos-reis', 'Angra dos Reis', 'RJ', 'praia', -23.01, -44.32, 'GIG', 'Baía com mais de 300 ilhas, mar calmo e passeios de lancha entre praias e piscinas naturais.', ['ilhas de Angra', 'passeio de lancha', 'Ilha da Gipóia', 'Lagoa Azul']],
  ['buzios', 'Armação dos Búzios', 'RJ', 'praia', -22.75, -41.88, 'GIG', 'Península charmosa com mais de 20 praias, vida noturna animada e a famosa Rua das Pedras.', ['Rua das Pedras', 'Geribá', 'João Fernandes', 'Orla Bardot', 'Praia Azeda']],
  ['arraial-do-cabo', 'Arraial do Cabo', 'RJ', 'praia', -22.97, -42.03, 'GIG', 'Água cristalina e azul-turquesa, ótima para mergulho e passeios de barco até a Ilha do Farol.', ['Prainhas do Pontal do Atalaia', 'Ilha do Farol', 'mergulho em Arraial', 'Praia do Forno']],
  ['petropolis', 'Petrópolis', 'RJ', 'serra', -22.51, -43.18, 'GIG', 'A Cidade Imperial na serra: museus, casarões, cervejarias e clima ameno perto do Rio.', ['Museu Imperial', 'Palácio Quitandinha', 'Catedral de Petrópolis', 'Vale do Cuiabá']],
  ['itatiaia', 'Itatiaia', 'RJ', 'parque', -22.43, -44.6, 'GIG', 'O primeiro parque nacional do Brasil, com picos, cachoeiras e trilhas de altitude.', ['Parque Nacional do Itatiaia', 'Pico das Agulhas Negras', 'Cachoeira Véu da Noiva', 'Penedo']],
  ['sao-paulo', 'São Paulo', 'SP', 'cidade', -23.55, -46.63, 'GRU', 'Capital da gastronomia, dos museus e dos grandes eventos, com vida cultural que não para.', ['Avenida Paulista', 'MASP', 'Ibirapuera', 'Mercadão', 'Liberdade', 'Pinacoteca']],
  ['ilhabela', 'Ilhabela', 'SP', 'ilha', -23.78, -45.36, 'GRU', 'Ilha montanhosa com cachoeiras, praias selvagens e um dos melhores pontos de vela do país.', ['Castelhanos', 'Baía dos Castelhanos', 'cachoeiras de Ilhabela', 'Praia do Jabaquara']],
  ['ubatuba', 'Ubatuba', 'SP', 'praia', -23.43, -45.07, 'GRU', 'Mais de 100 praias entre a serra e o mar, de baías tranquilas a picos de surfe.', ['Praia do Félix', 'Ilha Anchieta', 'Prumirim', 'Itamambuca']],
  ['campos-do-jordao', 'Campos do Jordão', 'SP', 'serra', -22.74, -45.59, 'GRU', 'A "Suíça brasileira": clima frio, arquitetura enxaimel, fondue e festival de inverno.', ['Capivari', 'Festival de Inverno', 'Pico do Itapeva', 'Horto Florestal']],
  ['brotas', 'Brotas', 'SP', 'ecoturismo', -22.28, -48.13, 'VCP', 'Capital paulista da aventura: rafting, boia-cross, tirolesa e muitas cachoeiras.', ['rafting em Brotas', 'Rio Jacaré-Pepira', 'cachoeiras de Brotas']],
  ['holambra', 'Holambra', 'SP', 'cidade', -22.63, -47.06, 'VCP', 'A cidade das flores, com campos coloridos, moinho holandês e a Expoflora.', ['Expoflora', 'Moinho Povos Unidos', 'campos de flores']],
  ['aparecida', 'Aparecida', 'SP', 'historico', -22.85, -45.23, 'GRU', 'Maior centro de peregrinação católica do Brasil, com o Santuário Nacional.', ['Santuário Nacional de Aparecida', 'Basílica', 'turismo religioso']],
  ['ouro-preto', 'Ouro Preto', 'MG', 'historico', -20.39, -43.5, 'CNF', 'Patrimônio Mundial com igrejas barrocas, ladeiras de pedra e a história do ciclo do ouro.', ['Aleijadinho', 'Igreja de São Francisco de Assis', 'Mina da Passagem', 'Praça Tiradentes']],
  ['tiradentes', 'Tiradentes', 'MG', 'historico', -21.11, -44.18, 'CNF', 'Cidadezinha colonial charmosa, famosa pela gastronomia mineira e pelo passeio de Maria Fumaça.', ['Maria Fumaça', 'Igreja Matriz de Santo Antônio', 'Festival de Cultura e Gastronomia']],
  ['belo-horizonte', 'Belo Horizonte', 'MG', 'cidade', -19.92, -43.94, 'CNF', 'Capital dos botecos e da comida mineira, com a Pampulha de Niemeyer e Inhotim por perto.', ['Pampulha', 'Mercado Central', 'Praça da Liberdade', 'Inhotim']],
  ['brumadinho-inhotim', 'Inhotim (Brumadinho)', 'MG', 'parque', -20.12, -44.22, 'CNF', 'Um dos maiores museus a céu aberto do mundo, com arte contemporânea e jardim botânico.', ['Inhotim', 'arte contemporânea', 'jardim botânico']],
  ['capitolio', 'Capitólio', 'MG', 'ecoturismo', -20.6, -46.05, 'CNF', 'Cânions e cachoeiras no lago de Furnas, com passeios de lancha em água verde.', ['Cânions de Furnas', 'Lago de Furnas', 'Cachoeira Lagoa Azul']],
  ['serra-da-canastra', 'Serra da Canastra', 'MG', 'parque', -20.25, -46.6, 'CNF', 'Nascente do Rio São Francisco, cachoeira Casca d’Anta e o famoso queijo canastra.', ['Casca d’Anta', 'nascente do São Francisco', 'queijo canastra']],
  ['sao-thome-das-letras', 'São Thomé das Letras', 'MG', 'serra', -21.72, -44.98, 'CNF', 'Vila de pedra no alto da serra, com cachoeiras, grutas e um pôr do sol místico.', ['Pirâmide', 'Gruta do Carimbado', 'pôr do sol']],
  ['monte-verde', 'Monte Verde', 'MG', 'serra', -22.86, -46.04, 'GRU', 'Vila de montanha aconchegante, com chalés, trilhas e gastronomia de clima frio.', ['Pedra Redonda', 'chalés', 'fondue']],
  ['diamantina', 'Diamantina', 'MG', 'historico', -18.24, -43.6, 'CNF', 'Cidade do ciclo dos diamantes, terra de JK, com vesperatas e serras ao redor.', ['Vesperata', 'Casa de Chica da Silva', 'Caminho dos Escravos']],
  ['vitoria', 'Vitória', 'ES', 'cidade', -20.32, -40.34, 'VIX', 'Capital-ilha com praias urbanas, moqueca capixaba e o Convento da Penha ao lado.', ['Convento da Penha', 'moqueca capixaba', 'Praia de Camburi']],
  ['guarapari', 'Guarapari', 'ES', 'praia', -20.67, -40.5, 'VIX', 'Cidade saúde das areias monazíticas, com enseadas e mergulho.', ['areias monazíticas', 'Praia do Morro', 'Setiba']],
  ['domingos-martins', 'Domingos Martins', 'ES', 'serra', -20.36, -40.66, 'VIX', 'Montanhas capixabas de colonização alemã, com Pedra Azul, vinícolas e agroturismo.', ['Pedra Azul', 'Rota do Lagarto', 'agroturismo']],
  ['cabo-frio', 'Cabo Frio', 'RJ', 'praia', -22.88, -42.02, 'GIG', 'Areia branquinha, dunas e o Forte São Mateus na Região dos Lagos.', ['Praia do Forte', 'Ilha do Japonês', 'Praia das Conchas']],
  ['visconde-de-maua', 'Visconde de Mauá', 'RJ', 'serra', -22.33, -44.54, 'GIG', 'Vale de cachoeiras e pousadas aconchegantes na Serra da Mantiqueira.', ['Vale do Pavão', 'cachoeiras de Mauá', 'Maromba']],
  ['sao-sebastiao', 'São Sebastião', 'SP', 'praia', -23.76, -45.41, 'GRU', 'Litoral norte paulista com Maresias, Juquehy e Camburi.', ['Maresias', 'Juquehy', 'Camburi', 'Barra do Sahy']],
  ['garopaba', 'Garopaba', 'SC', 'praia', -28.03, -48.62, 'FLN', 'Surf, dunas da Siriú e baleias-francas no inverno.', ['baleia-franca', 'Siriú', 'Ferrugem', 'Praia do Rosa']],
  ['torres', 'Torres', 'RS', 'praia', -29.34, -49.73, 'POA', 'Falésias de basalto à beira-mar e o Festival de Balonismo.', ['Guarita', 'Festival de Balonismo', 'Ilha dos Lobos']],
  ['caraiva', 'Caraíva', 'BA', 'praia', -16.81, -39.15, 'BPS', 'Vila sem carros entre rio e mar, com forró pé na areia.', ['forró', 'Rio Caraíva', 'Praia do Satu']],
  ['lavras-novas', 'Lavras Novas', 'MG', 'serra', -20.47, -43.51, 'CNF', 'Distrito de Ouro Preto com cachoeiras e vista para a serra.', ['Cachoeira dos Três Pingos', 'Mirante']],
  ['barreirinhas', 'Barreirinhas', 'MA', 'ecoturismo', -2.75, -42.83, 'SLZ', 'Base para os Lençóis Maranhenses e para o passeio pelo Rio Preguiças.', ['Rio Preguiças', 'Vassouras', 'Mandacaru']],
  // ---------- Sul ----------
  ['florianopolis', 'Florianópolis', 'SC', 'ilha', -27.6, -48.55, 'FLN', 'A Ilha da Magia: 40 praias, lagoas, trilhas e ostras frescas.', ['Lagoa da Conceição', 'Jurerê', 'Joaquina', 'Campeche', 'Santo Antônio de Lisboa']],
  ['balneario-camboriu', 'Balneário Camboriú', 'SC', 'praia', -26.99, -48.63, 'NVT', 'Orla de arranha-céus, vida noturna e o bondinho do Parque Unipraias.', ['Parque Unipraias', 'roda-gigante', 'Praia de Laranjeiras']],
  ['bombinhas', 'Bombinhas', 'SC', 'praia', -27.14, -48.48, 'NVT', 'Capital do mergulho ecológico, com mar verde e praias pequenas e tranquilas.', ['mergulho', 'Praia de Quatro Ilhas', 'Mariscal']],
  ['urubici', 'Urubici', 'SC', 'serra', -28.02, -49.59, 'FLN', 'Serra catarinense com cânions, cachoeiras e chance de neve no inverno.', ['Morro da Igreja', 'Pedra Furada', 'Cascata Véu de Noiva']],
  ['blumenau', 'Blumenau', 'SC', 'cidade', -26.92, -49.07, 'NVT', 'Herança alemã, cervejarias artesanais e a Oktoberfest.', ['Oktoberfest', 'Vila Germânica', 'cerveja artesanal']],
  ['gramado', 'Gramado', 'RS', 'serra', -29.38, -50.87, 'POA', 'Serra gaúcha de chocolates, arquitetura europeia e o Natal Luz.', ['Natal Luz', 'Lago Negro', 'Rua Coberta', 'Festival de Cinema']],
  ['canela', 'Canela', 'RS', 'serra', -29.36, -50.81, 'POA', 'Vizinha de Gramado, com a Cascata do Caracol e catedral de pedra.', ['Cascata do Caracol', 'Catedral de Pedra', 'Parque do Caracol']],
  ['bento-goncalves', 'Bento Gonçalves', 'RS', 'serra', -29.17, -51.52, 'POA', 'Coração do Vale dos Vinhedos, com vinícolas, Maria Fumaça e gastronomia italiana.', ['Vale dos Vinhedos', 'Maria Fumaça', 'vinícolas', 'Caminhos de Pedra']],
  ['cambara-do-sul', 'Cambará do Sul', 'RS', 'parque', -29.05, -50.15, 'POA', 'Terra dos cânions Itaimbezinho e Fortaleza, entre os mais impressionantes do país.', ['Cânion Itaimbezinho', 'Cânion Fortaleza', 'Aparados da Serra']],
  ['porto-alegre', 'Porto Alegre', 'RS', 'cidade', -30.03, -51.23, 'POA', 'Capital gaúcha às margens do Guaíba, com pôr do sol famoso e cultura do churrasco.', ['pôr do sol do Guaíba', 'Mercado Público', 'Usina do Gasômetro']],
  ['foz-do-iguacu', 'Foz do Iguaçu', 'PR', 'cachoeira', -25.55, -54.58, 'IGU', 'As Cataratas do Iguaçu, uma das maravilhas naturais do mundo, na tríplice fronteira.', ['Cataratas do Iguaçu', 'Itaipu', 'Parque das Aves', 'Marco das Três Fronteiras']],
  ['curitiba', 'Curitiba', 'PR', 'cidade', -25.43, -49.27, 'CWB', 'Capital verde, com parques, Jardim Botânico e o passeio de trem pela Serra do Mar.', ['Jardim Botânico', 'Ópera de Arame', 'Museu Oscar Niemeyer', 'trem Curitiba–Morretes']],
  ['ilha-do-mel', 'Ilha do Mel', 'PR', 'ilha', -25.55, -48.31, 'CWB', 'Ilha sem carros, com farol, gruta e praias tranquilas no litoral paranaense.', ['Farol das Conchas', 'Gruta das Encantadas', 'Fortaleza']],
  ['morretes', 'Morretes', 'PR', 'historico', -25.47, -48.83, 'CWB', 'Cidade colonial na Serra do Mar, famosa pelo barreado e pelo trem que desce a serra.', ['barreado', 'trem da Serra do Mar', 'Rio Nhundiaquara']],
  // ---------- Nordeste ----------
  ['fernando-de-noronha', 'Fernando de Noronha', 'PE', 'ilha', -3.85, -32.42, 'FEN', 'Arquipélago preservado de mar transparente, golfinhos e algumas das praias mais premiadas do mundo.', ['Baía do Sancho', 'Baía dos Porcos', 'golfinhos-rotadores', 'Morro Dois Irmãos', 'mergulho']],
  ['porto-de-galinhas', 'Porto de Galinhas', 'PE', 'praia', -8.5, -35.0, 'REC', 'Piscinas naturais com peixinhos, passeios de jangada e resorts pé na areia.', ['piscinas naturais', 'jangada', 'Muro Alto', 'Maracaípe']],
  ['recife', 'Recife', 'PE', 'cidade', -8.05, -34.88, 'REC', 'A Veneza brasileira, com Recife Antigo, frevo e Boa Viagem.', ['Recife Antigo', 'Boa Viagem', 'Paço do Frevo', 'Instituto Ricardo Brennand']],
  ['olinda', 'Olinda', 'PE', 'historico', -8.01, -34.85, 'REC', 'Ladeiras coloridas, igrejas e o carnaval de bonecos gigantes.', ['carnaval de Olinda', 'bonecos gigantes', 'Alto da Sé']],
  ['salvador', 'Salvador', 'BA', 'cidade', -12.97, -38.5, 'SSA', 'Primeira capital do Brasil: Pelourinho, axé, acarajé e praias de água morna.', ['Pelourinho', 'Elevador Lacerda', 'Farol da Barra', 'Igreja do Bonfim', 'acarajé']],
  ['morro-de-sao-paulo', 'Morro de São Paulo', 'BA', 'ilha', -13.38, -38.91, 'SSA', 'Vila sem carros na Ilha de Tinharé, com praias numeradas e festas à beira-mar.', ['Segunda Praia', 'Gamboa', 'Boipeba', 'tirolesa do farol']],
  ['boipeba', 'Boipeba', 'BA', 'ilha', -13.62, -38.93, 'SSA', 'Ilha rústica e tranquila, com piscinas naturais e coqueirais.', ['Moreré', 'piscinas naturais', 'Cueira']],
  ['itacare', 'Itacaré', 'BA', 'praia', -14.28, -38.99, 'IOS', 'Surf, trilhas na mata e praias cercadas de coqueiros no litoral do cacau.', ['Prainha', 'Itacarezinho', 'surf', 'Engenhoca']],
  ['trancoso', 'Trancoso', 'BA', 'praia', -16.59, -39.09, 'BPS', 'O Quadrado colonial, falésias e praias sofisticadas no sul da Bahia.', ['Quadrado de Trancoso', 'Praia do Espelho', 'Itapororoca']],
  ['porto-seguro', 'Porto Seguro', 'BA', 'praia', -16.45, -39.06, 'BPS', 'Onde a história do Brasil começou, com Arraial d’Ajuda e praias animadas.', ['Arraial d’Ajuda', 'Cidade Histórica', 'Recife de Fora', 'Coroa Vermelha']],
  ['chapada-diamantina', 'Chapada Diamantina', 'BA', 'parque', -12.56, -41.39, 'LEC', 'Cachoeiras gigantes, poços azuis e trilhas épicas no sertão baiano.', ['Cachoeira da Fumaça', 'Poço Azul', 'Morro do Pai Inácio', 'Vale do Pati', 'Lençóis']],
  ['praia-do-forte', 'Praia do Forte', 'BA', 'praia', -12.58, -38.0, 'SSA', 'Vila charmosa com piscinas naturais e base do Projeto Tamar.', ['Projeto Tamar', 'piscinas naturais', 'Castelo Garcia d’Ávila']],
  ['maragogi', 'Maragogi', 'AL', 'praia', -9.01, -35.22, 'MCZ', 'O Caribe brasileiro: galés de corais e mar verde-esmeralda.', ['Galés de Maragogi', 'piscinas naturais', 'Praia de Antunes']],
  ['maceio', 'Maceió', 'AL', 'praia', -9.67, -35.73, 'MCZ', 'Capital de mar azul-turquesa, piscinas naturais de Pajuçara e praias ao norte e ao sul.', ['Pajuçara', 'Praia do Gunga', 'Ipioca', 'jangadas']],
  ['sao-miguel-dos-milagres', 'São Miguel dos Milagres', 'AL', 'praia', -9.26, -35.37, 'MCZ', 'Rota Ecológica com pousadas charmosas, piscinas naturais e peixes-boi.', ['Rota Ecológica', 'peixe-boi', 'Praia do Patacho']],
  ['jericoacoara', 'Jericoacoara', 'CE', 'praia', -2.79, -40.51, 'JJD', 'Dunas, lagoas e o pôr do sol mais famoso do Nordeste, paraíso do kitesurf.', ['Duna do Pôr do Sol', 'Pedra Furada', 'Lagoa do Paraíso', 'kitesurf']],
  ['fortaleza', 'Fortaleza', 'CE', 'cidade', -3.73, -38.52, 'FOR', 'Sol o ano todo, Beach Park, Praia do Futuro e humor cearense.', ['Beach Park', 'Praia do Futuro', 'Beira-Mar', 'Dragão do Mar']],
  ['canoa-quebrada', 'Canoa Quebrada', 'CE', 'praia', -4.53, -37.71, 'FOR', 'Falésias coloridas, passeio de buggy e a famosa Broadway.', ['falésias', 'buggy', 'Broadway']],
  ['natal', 'Natal', 'RN', 'praia', -5.79, -35.21, 'NAT', 'Cidade do sol, dunas de Genipabu e o maior cajueiro do mundo por perto.', ['Genipabu', 'Ponta Negra', 'Morro do Careca', 'maior cajueiro do mundo']],
  ['pipa', 'Praia da Pipa', 'RN', 'praia', -6.23, -35.05, 'NAT', 'Falésias, golfinhos e baías protegidas, com vila cheia de bares e pousadas.', ['Baía dos Golfinhos', 'Chapadão', 'Praia do Amor']],
  ['sao-miguel-do-gostoso', 'São Miguel do Gostoso', 'RN', 'praia', -5.12, -35.64, 'NAT', 'Vila de ventos constantes, kitesurf e praias quase desertas.', ['kitesurf', 'Praia de Tourinhos']],
  ['joao-pessoa', 'João Pessoa', 'PB', 'cidade', -7.12, -34.86, 'JPA', 'Capital tranquila, onde o sol nasce primeiro nas Américas, com piscinas naturais.', ['Ponta do Seixas', 'Picãozinho', 'Areia Vermelha', 'Praia do Jacaré']],
  ['aracaju', 'Aracaju', 'SE', 'cidade', -10.91, -37.07, 'AJU', 'Orla de Atalaia, cânions do São Francisco e culinária de caranguejo.', ['Orla de Atalaia', 'Cânions do Xingó', 'Passarela do Caranguejo']],
  ['canions-do-xingo', 'Cânions do Xingó', 'SE', 'ecoturismo', -9.62, -37.79, 'AJU', 'Passeio de catamarã entre paredões de pedra no Rio São Francisco.', ['catamarã', 'Rio São Francisco', 'Gruta do Talhado']],
  ['lencois-maranhenses', 'Lençóis Maranhenses', 'MA', 'parque', -2.49, -43.13, 'SLZ', 'Dunas brancas a perder de vista com lagoas de água doce entre elas.', ['Lagoa Azul', 'Lagoa Bonita', 'Atins', 'Barreirinhas', 'Caburé']],
  ['sao-luis', 'São Luís', 'MA', 'historico', -2.53, -44.3, 'SLZ', 'Centro histórico de azulejos portugueses e a cultura do bumba-meu-boi.', ['azulejos', 'bumba-meu-boi', 'Praia Grande']],
  ['delta-do-parnaiba', 'Delta do Parnaíba', 'PI', 'ecoturismo', -2.9, -41.77, 'PHB', 'Único delta em mar aberto das Américas, com ilhas, dunas e revoada de guarás.', ['revoada dos guarás', 'Ilha do Caju', 'Rota das Emoções']],
  ['serra-da-capivara', 'Serra da Capivara', 'PI', 'parque', -8.83, -42.55, 'THE', 'Maior concentração de pinturas rupestres das Américas, Patrimônio da Humanidade.', ['pinturas rupestres', 'Pedra Furada', 'Museu do Homem Americano']],
  ['barra-grande-piaui', 'Barra Grande', 'PI', 'praia', -2.9, -41.4, 'PHB', 'Vilarejo de kitesurf e cavalos-marinhos no litoral do Piauí.', ['cavalos-marinhos', 'kitesurf']],
  // ---------- Centro-Oeste ----------
  ['chapada-dos-veadeiros', 'Chapada dos Veadeiros', 'GO', 'parque', -14.13, -47.51, 'BSB', 'Cânions, cachoeiras e cristais no cerrado, sobre uma das rochas mais antigas do planeta.', ['Vale da Lua', 'Cachoeira Santa Bárbara', 'Alto Paraíso', 'São Jorge', 'Cataratas dos Couros']],
  ['pirenopolis', 'Pirenópolis', 'GO', 'historico', -15.85, -48.96, 'BSB', 'Cidade colonial cercada de cachoeiras, com as Cavalhadas e a Festa do Divino.', ['Cavalhadas', 'Cachoeira do Abade', 'Santuário Vagafogo']],
  ['caldas-novas', 'Caldas Novas', 'GO', 'cidade', -17.74, -48.62, 'CLV', 'Maior estância hidrotermal do mundo, com parques aquáticos de águas quentes.', ['águas termais', 'Hot Park', 'Lagoa Quente']],
  ['brasilia', 'Brasília', 'DF', 'cidade', -15.79, -47.88, 'BSB', 'Capital modernista de Niemeyer e Lúcio Costa, Patrimônio da Humanidade.', ['Congresso Nacional', 'Catedral de Brasília', 'Ponte JK', 'Esplanada dos Ministérios']],
  ['bonito', 'Bonito', 'MS', 'ecoturismo', -21.13, -56.48, 'BYO', 'Rios de água cristalina para flutuar entre peixes, grutas azuis e ecoturismo exemplar.', ['flutuação', 'Gruta do Lago Azul', 'Rio da Prata', 'Abismo Anhumas', 'Buraco das Araras']],
  ['pantanal-sul', 'Pantanal Sul (Miranda)', 'MS', 'ecoturismo', -20.24, -56.38, 'CGR', 'A maior planície alagada do mundo: onças, jacarés e araras em safáris fotográficos.', ['Pantanal', 'onça-pintada', 'safári fotográfico', 'Estrada Parque']],
  ['chapada-dos-guimaraes', 'Chapada dos Guimarães', 'MT', 'parque', -15.46, -55.75, 'CGB', 'Paredões vermelhos, cachoeira Véu de Noiva e o centro geodésico da América do Sul.', ['Véu de Noiva', 'Cidade de Pedra', 'Mirante do Centro Geodésico']],
  ['pantanal-norte', 'Pantanal Norte (Poconé)', 'MT', 'ecoturismo', -16.26, -56.62, 'CGB', 'Transpantaneira e as melhores chances de ver a onça-pintada na natureza.', ['Transpantaneira', 'onça-pintada', 'Porto Jofre']],
  ['nobres', 'Nobres', 'MT', 'ecoturismo', -14.72, -56.33, 'CGB', 'Flutuação em águas azuis e a famosa Lagoa das Araras.', ['Aquário Encantado', 'Lagoa das Araras', 'flutuação']],
  // ---------- Norte ----------
  ['manaus', 'Manaus', 'AM', 'cidade', -3.12, -60.02, 'MAO', 'Porta de entrada da Amazônia: Teatro Amazonas, Encontro das Águas e hotéis de selva.', ['Teatro Amazonas', 'Encontro das Águas', 'hotel de selva', 'botos']],
  ['anavilhanas', 'Anavilhanas', 'AM', 'ecoturismo', -2.68, -60.76, 'MAO', 'Arquipélago fluvial com centenas de ilhas no Rio Negro e botos-cor-de-rosa.', ['Rio Negro', 'boto-cor-de-rosa', 'Novo Airão']],
  ['parintins', 'Parintins', 'AM', 'cidade', -2.63, -56.74, 'PIN', 'Ilha do Festival Folclórico, a disputa entre os bois Garantido e Caprichoso.', ['Festival de Parintins', 'Garantido', 'Caprichoso']],
  ['alter-do-chao', 'Alter do Chão', 'PA', 'praia', -2.5, -54.95, 'STM', 'O Caribe amazônico: praias de rio de areia branca e a Ilha do Amor.', ['Ilha do Amor', 'Rio Tapajós', 'Lago Verde', 'Çairé']],
  ['belem', 'Belém', 'PA', 'cidade', -1.46, -48.49, 'BEL', 'Ver-o-Peso, Estação das Docas, açaí de verdade e o Círio de Nazaré.', ['Ver-o-Peso', 'Estação das Docas', 'Círio de Nazaré', 'açaí']],
  ['ilha-de-marajo', 'Ilha de Marajó', 'PA', 'ilha', -0.77, -48.5, 'BEL', 'A maior ilha fluviomarinha do mundo, com búfalos, praias de rio e cerâmica marajoara.', ['búfalos', 'Soure', 'cerâmica marajoara']],
  ['jalapao', 'Jalapão', 'TO', 'parque', -10.36, -46.58, 'PMW', 'Dunas douradas, fervedouros onde não se afunda e cachoeiras no cerrado.', ['fervedouros', 'Dunas do Jalapão', 'Cachoeira da Velha', 'capim dourado']],
  ['monte-roraima', 'Monte Roraima', 'RR', 'parque', 5.14, -60.76, 'BVB', 'Montanha de topo plano na tríplice fronteira, para trekkings inesquecíveis.', ['trekking', 'tepui', 'Pacaraima']],
  ['serra-do-tepequem', 'Serra do Tepequém', 'RR', 'serra', 3.76, -61.72, 'BVB', 'Platô com cachoeiras e mirantes, a principal serra turística de Roraima.', ['Cachoeira do Paiva', 'mirante do Tepequém']],
  ['oiapoque', 'Oiapoque', 'AP', 'cidade', 3.84, -51.83, 'MCP', 'O extremo norte do país, na fronteira com a Guiana Francesa.', ['extremo norte', 'Guiana Francesa', 'Ponte Binacional']],
  ['macapa', 'Macapá', 'AP', 'cidade', 0.03, -51.07, 'MCP', 'Capital cortada pela Linha do Equador, com o Marco Zero e a Fortaleza de São José.', ['Marco Zero do Equador', 'Fortaleza de São José', 'Rio Amazonas']],
  ['rio-branco', 'Rio Branco', 'AC', 'cidade', -9.97, -67.81, 'RBR', 'Capital acreana com memória dos seringais e acesso a geoglifos amazônicos.', ['geoglifos', 'Chico Mendes', 'Gameleira']],
  ['porto-velho', 'Porto Velho', 'RO', 'cidade', -8.76, -63.9, 'PVH', 'Estrada de Ferro Madeira-Mamoré e o Rio Madeira.', ['Madeira-Mamoré', 'Rio Madeira']],
];

/** Lista final, com região calculada pela UF. */
export const DESTINOS_BRASIL: DestinoBrasil[] = LINHAS.map(([slug, nome, uf, categoria, lat, lng, aeroporto, resumo, atrativos]) => ({
  slug,
  nome,
  uf,
  regiao: UF_REGIAO[uf],
  categoria,
  lat,
  lng,
  aeroporto,
  resumo,
  atrativos,
}));

export function findDestinoBrasil(slug: string): DestinoBrasil | undefined {
  return DESTINOS_BRASIL.find((d) => d.slug === slug);
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '');
}

/**
 * Descobre de qual destino um texto fala (título de matéria, anúncio, busca).
 * Atrativo específico (ex.: "Cristo Redentor") pesa mais que só o nome da cidade.
 */
export function detectDestinos(texto: string, limit = 3): Array<{ destino: DestinoBrasil; score: number; motivo: string }> {
  const t = norm(texto);
  const hits: Array<{ destino: DestinoBrasil; score: number; motivo: string }> = [];
  for (const d of DESTINOS_BRASIL) {
    let score = 0;
    let motivo = '';
    if (t.includes(norm(d.nome))) {
      score += 3;
      motivo = d.nome;
    }
    for (const a of d.atrativos) {
      if (a.length >= 4 && t.includes(norm(a))) {
        score += 4;
        motivo = a;
      }
    }
    if (score > 0) hits.push({ destino: d, score, motivo });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
