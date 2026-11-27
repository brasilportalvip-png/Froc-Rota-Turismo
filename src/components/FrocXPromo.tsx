import React, { useMemo } from 'react';
import { FROC_X_URL } from '../lib/frocX.ts';

/** Inauguração do Froc X Uber (mesma data do app): quem se cadastra antes vira membro fundador. */
export const FROC_X_INAUGURACAO = new Date('2027-03-10T00:00:00-03:00');

export function diasAteInauguracao(agora: Date = new Date()): number {
  return Math.max(0, Math.ceil((FROC_X_INAUGURACAO.getTime() - agora.getTime()) / 86400000));
}

const SERVICOS = [
  { icone: '🚗', titulo: 'Corridas', texto: 'Carro, conforto ou moto, na hora.' },
  { icone: '🤝', titulo: 'Preço negociado', texto: 'Você oferece, o motorista aceita.' },
  { icone: '🛣️', titulo: 'Caronas entre cidades', texto: 'Divida a viagem e o custo.' },
  { icone: '🚚', titulo: 'Fretes', texto: 'Caminhão, van e utilitário.' },
];

const MENSAGEM_WHATSAPP = `Vem aí o Froc X Uber: corridas, preço negociado, caronas e fretes num app só. Cadastre-se antes da inauguração e ganhe o selo de membro fundador: ${FROC_X_URL}/?de=froc-rota`;

/** Propaganda do Froc X Uber no Froc Rota: chamada para criar a conta, instalar e virar motorista. */
export const FrocXPromo: React.FC<{ agora?: Date }> = ({ agora }) => {
  const dias = useMemo(() => diasAteInauguracao(agora), [agora]);
  const inaugurado = dias === 0;
  const link = (caminho = '/') => `${FROC_X_URL}${caminho}?de=froc-rota&utm_source=froc-rota&utm_medium=banner`;

  return (
    <section
      aria-labelledby="froc-x-titulo"
      data-testid="froc-x-promo"
      className="rounded-3xl overflow-hidden border-2 border-[#111111] bg-[#0b0b0c] text-white"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12">
        <div className="lg:col-span-7 p-6 md:p-10 space-y-5">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-[#39FF14]">🚗 Novo na família Froc</div>
          <h2 id="froc-x-titulo" className="text-3xl md:text-5xl font-extrabold leading-tight">
            Chegou ao destino?
            <span className="block text-[#FFD700]">Seu motorista também.</span>
          </h2>
          <p className="text-sm md:text-base text-white/80 max-w-xl leading-relaxed">
            Do aeroporto ao hotel, da pousada ao passeio: vá de <strong className="text-white">Froc X Uber</strong>, o app de
            mobilidade da Froc. Pagamento protegido pela carteira Froc (Pix ou cartão), motoristas verificados e botão SOS
            em toda corrida.
          </p>

          <div className="grid grid-cols-2 gap-2.5 max-w-xl">
            {SERVICOS.map((s) => (
              <div key={s.titulo} className="rounded-xl bg-white/[0.06] border border-white/10 p-3">
                <div className="text-sm font-extrabold">
                  <span aria-hidden="true">{s.icone}</span> {s.titulo}
                </div>
                <div className="text-[11px] text-white/65 mt-0.5">{s.texto}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            <a
              href={link('/')}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="froc-x-cadastro"
              className="inline-flex items-center justify-center min-h-[52px] px-6 rounded-2xl bg-[#39FF14] text-[#111111] text-sm font-extrabold shadow-[0_0_24px_rgba(57,255,20,0.45)] hover:brightness-110"
            >
              {inaugurado ? 'Criar minha conta grátis →' : 'Quero ser fundador: criar conta grátis →'}
            </a>
            <a
              href={link('/seja-motorista')}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="froc-x-motorista"
              className="inline-flex items-center justify-center min-h-[52px] px-6 rounded-2xl bg-[#FFD700] text-[#111111] text-sm font-extrabold hover:brightness-105"
            >
              Sou motorista: quero ganhar dinheiro
            </a>
          </div>
          <p className="text-[11px] text-white/55">
            📲 Para instalar no celular: abra o Froc X e toque em <strong>Instalar</strong> (Android) ou em{' '}
            <strong>Compartilhar → Adicionar à Tela de Início</strong> (iPhone). Não ocupa espaço como um app comum.
          </p>
        </div>

        <div className="lg:col-span-5 p-6 md:p-10 bg-gradient-to-br from-[#1a1a1d] to-[#0b0b0c] border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col justify-center gap-4">
          {inaugurado ? (
            <div className="text-2xl font-extrabold text-[#39FF14]">Já está funcionando! 🎉</div>
          ) : (
            <>
              <div className="text-xs font-bold text-white/70 uppercase tracking-wide">Faltam para a inauguração</div>
              <div className="flex items-baseline gap-2">
                <span className="text-6xl md:text-7xl font-extrabold text-[#FFD700] font-mono-tabular" data-testid="froc-x-dias">
                  {dias}
                </span>
                <span className="text-lg font-bold text-white/80">{dias === 1 ? 'dia' : 'dias'}</span>
              </div>
              <div className="text-xs text-white/70">Inauguração em 10 de março de 2027</div>
              <div className="rounded-xl border border-[#FFD700]/50 bg-[#FFD700]/10 p-3 text-sm">
                <strong className="text-[#FFD700]">★ Membro fundador:</strong> quem cria a conta antes da inauguração ganha o
                selo de fundador no perfil.
              </div>
            </>
          )}
          <a
            href={`https://wa.me/?text=${encodeURIComponent(MENSAGEM_WHATSAPP)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl border border-white/25 text-sm font-bold text-white hover:bg-white/5"
          >
            Avisar meus amigos no WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
};
