import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Plane, Sparkles, X } from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { formatMoney } from '../i18n/translations.ts';
import {
  canOffer,
  firstName,
  getConsent,
  markOffered,
  OFFER_THRESHOLD,
  setConsent,
  topInterest,
} from '../lib/intent.ts';

interface Suggestion {
  destino: string;
  headline: string;
  message: string;
  actions: Array<{ type: 'destino' | 'voo' | 'concierge' | 'oferta' | 'guia'; label: string; value: string }>;
  offers: Array<{ slug: string; title: string; priceCents: number }>;
}

interface Props {
  onOpenDestination: (appSlug: string) => void;
  onOpenOffer: (slug: string) => void;
  /** Não aparece por cima de janelas abertas (reserva, painel, etc.). */
  blocked: boolean;
  /** Avisa o app quando está na tela, para os outros pop-ups esperarem. */
  onVisibleChange?: (visible: boolean) => void;
}

/**
 * A IA percebe o interesse (o que a pessoa lê, abre e busca) e, quando ele fica forte,
 * oferece a viagem certa com o nome e a saudação da hora. No máximo 1 vez por destino por dia.
 */
export const IntentOpportunity: React.FC<Props> = ({ onOpenDestination, onOpenOffer, blocked, onVisibleChange }) => {
  const { dbUser, currency } = useApp();
  const [consent, setConsentState] = useState(getConsent());
  const [s, setS] = useState<Suggestion | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    onVisibleChange?.(consent === null || Boolean(s));
  }, [consent, s, onVisibleChange]);

  const check = useCallback(async () => {
    if (busy.current || blocked || getConsent() !== 'yes') return;
    const top = topInterest();
    if (!top || top.score < OFFER_THRESHOLD || !canOffer(top.slug)) return;
    busy.current = true;
    try {
      const r = await fetch('/api/intent/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: top.slug, localHour: new Date().getHours(), firstName: firstName(dbUser?.name) }),
      });
      if (r.ok) {
        const data = (await r.json()) as Suggestion;
        markOffered(top.slug);
        setS(data);
      }
    } catch {
      // sem internet: tenta na próxima interação
    } finally {
      busy.current = false;
    }
  }, [blocked, dbUser?.name]);

  useEffect(() => {
    const onInterest = () => {
      // pequena pausa: a sugestão chega depois que a pessoa termina o clique/leitura
      setTimeout(() => void check(), 1500);
    };
    window.addEventListener('froc-interest', onInterest);
    return () => window.removeEventListener('froc-interest', onInterest);
  }, [check]);

  const act = (a: Suggestion['actions'][number]) => {
    setS(null);
    if (a.type === 'destino') onOpenDestination(a.value);
    else if (a.type === 'oferta') onOpenOffer(a.value);
    else if (a.type === 'guia') window.location.href = `/destinos/${a.value}`;
    else if (a.type === 'voo') {
      const url = new URL(window.location.href);
      url.searchParams.set('voo', a.value);
      window.history.replaceState(null, '', url.toString());
      window.dispatchEvent(new CustomEvent('froc-voo', { detail: { iata: a.value } }));
      document.getElementById('viagens')?.scrollIntoView({ behavior: 'smooth' });
    } else if (a.type === 'concierge') {
      window.dispatchEvent(new CustomEvent('froc-concierge', { detail: { destino: a.value } }));
      document.getElementById('concierge')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  if (consent === null) {
    return (
      <div
        role="dialog"
        aria-label="Privacidade"
        className="fixed bottom-3 inset-x-3 md:left-auto md:right-4 md:max-w-md z-[80] bg-white border-2 border-[#111111] rounded-2xl shadow-2xl p-4 space-y-3"
      >
        <p className="text-xs text-[#111111]">
          <strong>Sugestões feitas para você.</strong> Com sua permissão, guardamos <em>neste aparelho</em> os destinos
          que você vê e lê, para a nossa IA sugerir viagens do seu interesse. Você pode mudar quando quiser.{' '}
          <a href="/politica-de-privacidade" className="underline">
            Política de Privacidade
          </a>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setConsent('yes');
              setConsentState('yes');
            }}
            className="flex-1 min-h-[42px] rounded-xl froc-btn-neon text-xs font-extrabold"
          >
            Aceitar
          </button>
          <button
            type="button"
            onClick={() => {
              setConsent('no');
              setConsentState('no');
            }}
            className="flex-1 min-h-[42px] rounded-xl border border-[#111111]/25 text-xs font-bold"
          >
            Agora não
          </button>
        </div>
      </div>
    );
  }

  if (!s || blocked) return null;

  return (
    <div
      role="dialog"
      aria-label="Oportunidade de viagem"
      className="fixed bottom-3 inset-x-3 md:left-auto md:right-4 md:max-w-sm z-[80] rounded-2xl overflow-hidden border-2 border-[#111111] shadow-2xl bg-white froc-animate-modal"
    >
      <div className="bg-gradient-to-br from-[#0d1b33] to-[#1d3b63] text-white p-4 relative">
        <button
          type="button"
          onClick={() => setS(null)}
          aria-label="Fechar"
          className="absolute top-2 right-2 w-9 h-9 rounded-full hover:bg-white/10 inline-flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
        <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-widest text-[#FFD700]">
          <Sparkles className="w-3.5 h-3.5" /> Sugestão da Froc Rota AI
        </span>
        <p className="text-lg font-extrabold leading-snug pr-8">{s.headline}</p>
        <p className="text-xs text-white/85 mt-1">{s.message}</p>
      </div>
      {s.offers.length > 0 && (
        <ul className="px-4 pt-3 space-y-1.5">
          {s.offers.map((o) => (
            <li key={o.slug}>
              <button
                type="button"
                onClick={() => {
                  setS(null);
                  onOpenOffer(o.slug);
                }}
                className="w-full text-left text-xs flex items-center justify-between gap-2 hover:underline"
              >
                <span className="inline-flex items-center gap-1 font-semibold">
                  <MapPin className="w-3 h-3" /> {o.title}
                </span>
                <span className="font-mono-tabular font-bold shrink-0">{formatMoney(o.priceCents, currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="p-4 grid gap-2">
        {s.actions
          .filter((a) => a.type !== 'guia')
          .map((a, i) => (
            <button
              key={a.label}
              type="button"
              onClick={() => act(a)}
              className={`min-h-[42px] rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-1.5 ${
                i === 0 ? 'froc-btn-neon' : 'border border-[#111111]/25 text-[#111111]'
              }`}
            >
              {a.type === 'voo' && <Plane className="w-3.5 h-3.5" />}
              {a.label}
            </button>
          ))}
      </div>
    </div>
  );
};
