import React, { useEffect, useRef, useState } from 'react';
import { Compass, ExternalLink, Star } from 'lucide-react';
import { getConsent } from '../lib/intent.ts';

/** ID público de afiliado da GetYourGuide (aparece em todos os links; não é segredo). */
export const GYG_PARTNER_ID = 'NC3UBVZ';
const GYG_SCRIPT = 'https://widget.getyourguide.com/dist/pa.umd.production.min.js';

export interface PasseioParceiro {
  codigo: string;
  titulo: string;
  imagem: string | null;
  nota: number | null;
  avaliacoes: number;
  duracaoMin: number | null;
  precoCents: number | null;
  moeda: string;
  url: string;
}

export function linkGetYourGuide(cidade: string): string {
  const q = encodeURIComponent(`${cidade}, Brasil`);
  return `https://www.getyourguide.com.br/s/?q=${q}&partner_id=${GYG_PARTNER_ID}&utm_medium=online_publisher&cmp=froc-rota`;
}

export function textoDuracao(min: number | null): string {
  if (!min) return '';
  if (min < 60) return `${min} min`;
  if (min % 1440 === 0) return `${min / 1440} dia${min >= 2880 ? 's' : ''}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function preco(cents: number | null, moeda: string): string {
  if (!cents) return '';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda || 'BRL', maximumFractionDigits: 0 }).format(cents / 100);
  } catch {
    return `${moeda} ${(cents / 100).toFixed(0)}`;
  }
}

/** Carrega o script da GetYourGuide uma vez só, e só com o consentimento de cookies (LGPD). */
function carregarScriptGyg(): void {
  if (typeof document === 'undefined' || document.querySelector(`script[src="${GYG_SCRIPT}"]`)) return;
  const s = document.createElement('script');
  s.async = true;
  s.defer = true;
  s.src = GYG_SCRIPT;
  s.setAttribute('data-gyg-partner-id', GYG_PARTNER_ID);
  document.head.appendChild(s);
}

interface Props {
  slug: string;
  cidade: string;
  /** Usado nos testes para não depender da rede. */
  inicial?: PasseioParceiro[];
}

/**
 * Passeios de parceiros afiliados (Viator + GetYourGuide), mostrados DEPOIS dos anunciantes do Froc Rota.
 * A reserva e o pagamento acontecem no site do parceiro; o Froc Rota recebe comissão.
 * Conteúdo marcado para não ser indexado (regra da Viator).
 */
export const PasseiosParceiros: React.FC<Props> = ({ slug, cidade, inicial }) => {
  const [viator, setViator] = useState<PasseioParceiro[]>(inicial || []);
  const [carregando, setCarregando] = useState(!inicial);
  const [consentiu, setConsentiu] = useState(() => getConsent() === 'yes');
  const widgetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (inicial) return;
    let ativo = true;
    setCarregando(true);
    fetch(`/api/passeios?d=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : { viator: [] }))
      .then((data: { viator?: PasseioParceiro[] }) => {
        if (ativo) setViator(Array.isArray(data.viator) ? data.viator : []);
      })
      .catch(() => {
        if (ativo) setViator([]);
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [slug, inicial]);

  useEffect(() => {
    const ouvir = (e: Event) => setConsentiu((e as CustomEvent).detail === 'yes');
    window.addEventListener('froc-consent', ouvir);
    return () => window.removeEventListener('froc-consent', ouvir);
  }, []);

  useEffect(() => {
    if (consentiu) carregarScriptGyg();
  }, [consentiu]);

  return (
    <section className="pt-4 border-t border-[#111111]/15" data-nosnippet="" data-testid="passeios-parceiros">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h3 className="text-lg font-semibold text-[#111111] inline-flex items-center gap-2">
          <Compass className="w-5 h-5" /> Mais passeios em {cidade}
        </h3>
      </div>
      <p className="text-[11px] text-[#111111]/60 mb-3">
        Passeios de parceiros (Viator e GetYourGuide). A reserva e o pagamento são feitos no site do parceiro, com
        cancelamento conforme as regras de cada um. O Froc Rota pode receber comissão.
      </p>

      {carregando ? (
        <div className="text-sm text-[#111111]/70">Buscando passeios…</div>
      ) : viator.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="passeios-viator">
          {viator.map((p) => (
            <a
              key={p.codigo || p.url}
              href={p.url}
              target="_blank"
              rel="sponsored noopener noreferrer"
              className="group p-3 rounded-xl border border-[#111111]/15 hover:border-[#111111] transition-colors flex gap-3 items-center bg-white"
            >
              {p.imagem ? (
                <img src={p.imagem} alt="" loading="lazy" className="w-20 h-20 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="w-20 h-20 rounded-lg bg-[#111111]/5 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#111111] line-clamp-2">{p.titulo}</div>
                <div className="text-[11px] text-[#111111]/70 mt-1 flex flex-wrap gap-x-2">
                  {p.nota ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Star className="w-3 h-3" /> {p.nota.toFixed(1)} ({p.avaliacoes})
                    </span>
                  ) : null}
                  {p.duracaoMin ? <span>{textoDuracao(p.duracaoMin)}</span> : null}
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-xs font-semibold text-[#111111] font-mono-tabular">
                    {p.precoCents ? `a partir de ${preco(p.precoCents, p.moeda)}` : ''}
                  </span>
                  <span className="text-[11px] font-bold text-[#111111] inline-flex items-center gap-1 whitespace-nowrap">
                    Ver e reservar <ExternalLink className="w-3 h-3" />
                  </span>
                </div>
                <div className="text-[10px] text-[#111111]/50 mt-0.5">via Viator</div>
              </div>
            </a>
          ))}
        </div>
      ) : null}

      {consentiu ? (
        <div className="mt-3" ref={widgetRef}>
          <div
            data-gyg-href="https://widget.getyourguide.com/default/activities.frame"
            data-gyg-locale-code="pt-BR"
            data-gyg-widget="activities"
            data-gyg-number-of-items="3"
            data-gyg-partner-id={GYG_PARTNER_ID}
            data-gyg-cmp="froc-rota"
            data-gyg-q={`${cidade}, Brasil`}
          />
        </div>
      ) : null}

      <a
        href={linkGetYourGuide(cidade)}
        target="_blank"
        rel="sponsored noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 border-[#111111] text-xs font-bold text-[#111111] hover:bg-[#111111]/5"
      >
        Ver passeios em {cidade} na GetYourGuide <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </section>
  );
};
