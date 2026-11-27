import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  atalhosIniciais,
  buscarNoSite,
  ROTULO_TIPO,
  type AcaoBusca,
  type DestinoBusca,
  type MateriaBusca,
  type OfertaBusca,
  type ResultadoBusca,
} from '../lib/buscaSite.ts';

interface Props {
  destinos: DestinoBusca[];
  ofertas: OfertaBusca[];
  onEscolher: (acao: AcaoBusca) => void;
}

const ICONE: Record<ResultadoBusca['tipo'], string> = {
  destino: '📍',
  oferta: '🎟️',
  materia: '📰',
  voo: '✈️',
  secao: '🧭',
};

let materiasCache: MateriaBusca[] | null = null;

/** Barra de pesquisa do site inteiro (botão no topo; abre com Ctrl+K ou "/"). */
export const BuscaSite: React.FC<Props> = ({ destinos, ofertas, onEscolher }) => {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState('');
  const [ativo, setAtivo] = useState(0);
  const [materias, setMaterias] = useState<MateriaBusca[]>(materiasCache || []);
  const input = useRef<HTMLInputElement | null>(null);
  const botao = useRef<HTMLButtonElement | null>(null);
  const lista = useRef<HTMLUListElement | null>(null);
  const uid = useId();

  // Atalhos de teclado: Ctrl/Cmd+K e "/" (fora de campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const digitando = !!alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable);
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setAberto(true);
      } else if (e.key === '/' && !digitando) {
        e.preventDefault();
        setAberto(true);
      }
    };
    const onAbrir = (e: Event) => {
      const termo = String((e as CustomEvent<{ q?: string }>).detail?.q || '');
      if (termo) setQ(termo);
      setAberto(true);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('froc-busca', onAbrir);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('froc-busca', onAbrir);
    };
  }, []);

  useEffect(() => {
    if (!aberto) return;
    setTimeout(() => input.current?.focus(), 0);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!materiasCache) {
      fetch('/api/posts')
        .then((r) => r.json())
        .then((d) => {
          const list = ((d?.posts || []) as MateriaBusca[]).map((p) => ({ slug: p.slug, title: p.title, category: p.category, summary: p.summary }));
          materiasCache = list;
          setMaterias(list);
        })
        .catch(() => undefined);
    }
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [aberto]);

  const resultados = useMemo(
    () => (q.trim().length >= 2 ? buscarNoSite(q, { destinos, ofertas, materias }) : atalhosIniciais()),
    [q, destinos, ofertas, materias]
  );

  useEffect(() => setAtivo(0), [q]);

  useEffect(() => {
    lista.current?.querySelector(`[data-idx="${ativo}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [ativo]);

  const fechar = () => {
    setAberto(false);
    setQ('');
    setTimeout(() => botao.current?.focus(), 0);
  };

  const escolher = (r: ResultadoBusca) => {
    setAberto(false);
    setQ('');
    onEscolher(r.acao);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      fechar();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo((a) => Math.min(a + 1, Math.max(0, resultados.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      const r = resultados[ativo];
      if (r) {
        e.preventDefault();
        escolher(r);
      }
    }
  };

  // Agrupa mantendo a ordem dos índices para a navegação por setas.
  const grupos: Array<{ tipo: ResultadoBusca['tipo']; itens: Array<{ r: ResultadoBusca; idx: number }> }> = [];
  resultados.forEach((r, idx) => {
    const g = grupos.find((x) => x.tipo === r.tipo);
    if (g) g.itens.push({ r, idx });
    else grupos.push({ tipo: r.tipo, itens: [{ r, idx }] });
  });

  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Buscar no site"
        data-testid="abrir-busca"
        className="min-h-[42px] min-w-[42px] px-3 py-2 rounded-xl border border-[#111111]/25 bg-white text-[#111111] text-xs font-bold inline-flex items-center gap-2 hover:border-[#FF1493] whitespace-nowrap shrink-0"
      >
        <Search className="w-4 h-4" aria-hidden="true" />
        <span className="hidden xl:inline text-[#111111]/70">Buscar destinos, passeios, voos…</span>
        <span className="hidden lg:inline xl:hidden text-[#111111]/70">Buscar</span>
        <kbd className="hidden xl:inline text-[10px] px-1.5 py-0.5 rounded border border-[#111111]/20 text-[#111111]/60">Ctrl K</kbd>
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-xs flex justify-center items-start p-0 sm:p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) fechar();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Buscar no site"
            data-testid="busca-site"
            className="w-full sm:max-w-2xl bg-white sm:rounded-2xl border-b-2 sm:border-2 border-[#111111] shadow-2xl overflow-hidden flex flex-col max-h-[100dvh] sm:max-h-[80vh]"
          >
            <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-[#111111]/15">
              <Search className="w-5 h-5 text-[#111111]/60 shrink-0" aria-hidden="true" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                role="combobox"
                aria-expanded="true"
                aria-controls={`${uid}-lista`}
                aria-activedescendant={resultados[ativo] ? `${uid}-op-${ativo}` : undefined}
                aria-autocomplete="list"
                aria-label="O que você procura?"
                placeholder="Destino, passeio, hotel, voo, cancelamento, contato…"
                enterKeyHint="search"
                autoComplete="off"
                data-testid="campo-busca"
                className="flex-1 min-h-[48px] text-base outline-none bg-transparent"
              />
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar busca"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl hover:bg-[#111111]/5"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <ul ref={lista} id={`${uid}-lista`} role="listbox" aria-label="Resultados" className="overflow-y-auto flex-1 py-2" data-testid="resultados-busca">
              {q.trim().length < 2 && (
                <li role="presentation" className="px-4 pt-1 pb-2 text-[11px] font-extrabold uppercase tracking-wide text-[#111111]/55">
                  Conheça o site inteiro
                </li>
              )}
              {grupos.map((g) => (
                <React.Fragment key={g.tipo}>
                  {q.trim().length >= 2 && (
                    <li role="presentation" className="px-4 pt-3 pb-1 text-[11px] font-extrabold uppercase tracking-wide text-[#111111]/55">
                      {ROTULO_TIPO[g.tipo]}
                    </li>
                  )}
                  {g.itens.map(({ r, idx }) => (
                    <li
                      key={r.key}
                      id={`${uid}-op-${idx}`}
                      role="option"
                      aria-selected={idx === ativo}
                      data-idx={idx}
                      data-testid="resultado-busca"
                      onMouseMove={() => setAtivo(idx)}
                      onClick={() => escolher(r)}
                      className={`mx-2 px-3 py-2.5 rounded-xl cursor-pointer flex items-start gap-3 ${idx === ativo ? 'bg-[#FF1493]/10 ring-1 ring-[#FF1493]/40' : ''}`}
                    >
                      <span aria-hidden="true" className="text-lg leading-6">{ICONE[r.tipo]}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-[#111111] truncate">{r.titulo}</span>
                        {r.sub && <span className="block text-xs text-[#111111]/65 truncate">{r.sub}</span>}
                      </span>
                    </li>
                  ))}
                </React.Fragment>
              ))}
              {q.trim().length >= 2 && resultados.length === 0 && (
                <li role="presentation" className="px-4 py-6 text-sm text-[#111111]/75" data-testid="busca-vazia">
                  Nada encontrado para “{q.trim()}”. Tente o nome de uma cidade, um tipo de passeio ou fale com a gente pelo chat.
                </li>
              )}
            </ul>
            <div className="hidden sm:flex px-4 py-2 border-t border-[#111111]/10 text-[11px] text-[#111111]/55 gap-4">
              <span>↑ ↓ para navegar</span>
              <span>Enter para abrir</span>
              <span>Esc para fechar</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
