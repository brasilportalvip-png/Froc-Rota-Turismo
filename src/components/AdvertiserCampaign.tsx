import React, { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { getConsent } from '../lib/intent.ts';

const KEY = 'froc_adv_campaign_v1';
const EVERY_MS = 3 * 86400000;

function recentlyShown(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(KEY) || 0) < EVERY_MS;
  } catch {
    return true;
  }
}

interface Props {
  blocked: boolean;
  isMerchant: boolean;
  onAdvertise: () => void;
  onVisibleChange?: (visivel: boolean) => void;
}

/**
 * Chamada para anunciantes: aparece quando a pessoa já rolou boa parte do site ou vai sair da página
 * (no computador), no máximo a cada 3 dias. Texto verdadeiro, sem números inventados.
 */
export const AdvertiserCampaign: React.FC<Props> = ({ blocked, isMerchant, onAdvertise, onVisibleChange }) => {
  const [open, setOpen] = useState(false);

  // Avisa o site que este aviso está na tela (para os outros pop-ups esperarem a vez).
  useEffect(() => {
    onVisibleChange?.(open && !blocked);
  }, [open, blocked, onVisibleChange]);

  useEffect(() => {
    if (isMerchant || recentlyShown()) return;
    const show = () => {
      if (getConsent() === null || recentlyShown()) return; // primeiro o aviso de privacidade
      try {
        localStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* ok */
      }
      setOpen(true);
      cleanup();
    };
    const onScroll = () => {
      const h = document.documentElement;
      if ((h.scrollTop + window.innerHeight) / h.scrollHeight > 0.6) show();
    };
    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) show();
    };
    const cleanup = () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('mouseout', onLeave);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('mouseout', onLeave);
    return cleanup;
  }, [isMerchant]);

  if (!open || blocked) return null;

  return (
    <div
      role="dialog"
      aria-label="Anuncie na Froc Rota"
      className="fixed bottom-3 left-3 right-3 md:right-auto md:max-w-md z-[70] rounded-2xl border-2 border-[#FFD700] bg-[#0d1b33] text-white shadow-2xl p-4 pr-12 froc-animate-modal"
    >
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Fechar"
        className="absolute top-2 right-2 w-9 h-9 rounded-full hover:bg-white/10 inline-flex items-center justify-center"
      >
        <X className="w-4 h-4" />
      </button>
      <p className="text-xs font-extrabold uppercase tracking-widest text-[#FFD700] inline-flex items-center gap-1.5">
        <Megaphone className="w-3.5 h-3.5" /> Para negócios de turismo
      </p>
      <p className="text-base font-extrabold leading-snug mt-1">
        Quem está aqui está planejando uma viagem. Seu barco, pousada ou restaurante pode ser a escolha dele.
      </p>
      <p className="text-xs text-white/80 mt-1">
        Página própria no Google, vitrine premium, sugestões da IA e pagamento direto no seu Mercado Pago.
      </p>
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onAdvertise();
          }}
          className="min-h-[42px] px-4 rounded-xl bg-[#FFD700] text-[#111111] text-xs font-extrabold"
        >
          Quero anunciar
        </button>
        <a href="/anuncie" className="min-h-[42px] px-4 rounded-xl border border-white/40 text-xs font-bold inline-flex items-center">
          Ver planos
        </a>
      </div>
    </div>
  );
};
