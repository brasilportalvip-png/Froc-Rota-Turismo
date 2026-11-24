import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellOff, Pause, Sparkles, X } from 'lucide-react';
import { PopupTemplate } from '../types.ts';
import { ResilientImage } from './ResilientImage.tsx';

interface PromoPopupEngineProps {
  blockedByOverlay: boolean;
  userAudience: 'all' | 'tourists' | 'merchants';
  onAction: (targetAction: string) => void;
}

const DISABLE_STORAGE_KEY = 'froc_rota_popups_disabled_v1';
const LAST_SHOWN_STORAGE_KEY = 'froc_rota_last_popup_at_v1';
export const POPUP_VISIBLE_DURATION_MS = 6000;
export const MIN_POPUP_INTERVAL_MS = 3 * 60 * 1000; // 3 minutos
export const MAX_POPUP_INTERVAL_MS = 7 * 60 * 1000; // 7 minutos

export function getRandomPopupIntervalMs(): number {
  return (
    MIN_POPUP_INTERVAL_MS +
    Math.floor(Math.random() * (MAX_POPUP_INTERVAL_MS - MIN_POPUP_INTERVAL_MS + 1))
  );
}

const VARIANT_STYLES: Record<
  string,
  {
    shell: string;
    badge: string;
    cta: string;
    title: string;
    body: string;
    closeBtn: string;
    bar: string;
  }
> = {
  'neon-emerald': {
    shell: 'bg-[#FFFFFF] border-2 border-[#111111] shadow-[0_18px_45px_-12px_rgba(57,255,20,0.45)]',
    badge: 'bg-[#39FF14] text-[#111111] border border-[#111111]',
    cta: 'froc-btn-neon',
    title: 'text-[#111111]',
    body: 'text-[#111111]/80',
    closeBtn: 'bg-[#FFFFFF] text-[#111111] border border-[#111111] hover:bg-[#39FF14]',
    bar: 'bg-[#39FF14]',
  },
  'pink-pulse': {
    shell: 'bg-[#FFFFFF] border-2 border-[#FF1493] shadow-[0_18px_45px_-12px_rgba(255,20,147,0.4)]',
    badge: 'bg-[#FF1493] text-[#FFFFFF] border border-[#111111]',
    cta: 'froc-btn-pink',
    title: 'text-[#111111]',
    body: 'text-[#111111]/80',
    closeBtn: 'bg-[#FFFFFF] text-[#111111] border border-[#111111] hover:bg-[#FF1493] hover:text-white',
    bar: 'bg-[#FF1493]',
  },
  'gold-luxury': {
    shell: 'bg-[#FFFFFF] border-2 border-[#111111] shadow-[0_18px_45px_-12px_rgba(255,215,0,0.5)]',
    badge: 'bg-[#FFD700] text-[#111111] border border-[#111111]',
    cta: 'froc-btn-gold',
    title: 'text-[#111111]',
    body: 'text-[#111111]/80',
    closeBtn: 'bg-[#FFFFFF] text-[#111111] border border-[#111111] hover:bg-[#FFD700]',
    bar: 'bg-[#FFD700]',
  },
  'obsidian-neon': {
    shell: 'bg-[#111111] border-2 border-[#39FF14] shadow-[0_18px_45px_-10px_rgba(17,17,17,0.65)]',
    badge: 'bg-[#39FF14] text-[#111111]',
    cta: 'froc-btn-neon',
    title: 'text-[#FFFFFF]',
    body: 'text-white/85',
    closeBtn: 'bg-[#111111] text-[#FFFFFF] border border-white/30 hover:border-[#FF1493] hover:text-[#FF1493]',
    bar: 'bg-[#39FF14]',
  },
  'prism-tropical': {
    shell: 'bg-[#FFFFFF] border-2 border-[#111111] shadow-[0_20px_50px_-14px_rgba(17,17,17,0.35)]',
    badge: 'bg-[#111111] text-[#FFD700] border border-[#FFD700]',
    cta: 'froc-btn-gold',
    title: 'text-[#111111]',
    body: 'text-[#111111]/80',
    closeBtn: 'bg-[#FFFFFF] text-[#111111] border border-[#111111] hover:bg-[#39FF14]',
    bar: 'froc-prism-bar',
  },
};

export const PromoPopupEngine: React.FC<PromoPopupEngineProps> = ({
  blockedByOverlay,
  userAudience,
  onAction,
}) => {
  const [templates, setTemplates] = useState<PopupTemplate[]>([]);
  const [disabled, setDisabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISABLE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [engaged, setEngaged] = useState(false);
  const [activePopup, setActivePopup] = useState<PopupTemplate | null>(null);
  const [pausedByHover, setPausedByHover] = useState(false);
  const shownCodesRef = useRef<Set<string>>(new Set());
  const hasShownPopupRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load verified templates from API
  useEffect(() => {
    fetch('/api/popups')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.popups && Array.isArray(d.popups)) {
          setTemplates(d.popups);
        }
      })
      .catch(() => {});
  }, []);

  // Wait for user engagement (minimum 8s dwell + active scroll or interaction)
  useEffect(() => {
    let minDwellDone = false;
    let scrolledOrInteracted = false;
    const maybeEngage = () => {
      if (minDwellDone && scrolledOrInteracted) {
        setEngaged(true);
      }
    };

    const dwellTimer = setTimeout(() => {
      minDwellDone = true;
      maybeEngage();
    }, 8000);

    const markActivity = () => {
      scrolledOrInteracted = true;
      maybeEngage();
    };

    window.addEventListener('scroll', markActivity, { passive: true, once: true });
    window.addEventListener('pointerdown', markActivity, { passive: true, once: true });

    return () => {
      clearTimeout(dwellTimer);
      window.removeEventListener('scroll', markActivity);
      window.removeEventListener('pointerdown', markActivity);
    };
  }, []);

  const eligibleTemplates = useMemo(() => {
    return templates
      .filter((t) => t.active && (t.audience === 'all' || t.audience === userAudience))
      .sort((a, b) => b.priority - a.priority);
  }, [templates, userAudience]);

  const pickNextPopup = useCallback((): PopupTemplate | null => {
    if (eligibleTemplates.length === 0) return null;
    const unseen = eligibleTemplates.filter((t) => !shownCodesRef.current.has(t.code));
    const pool = unseen.length > 0 ? unseen : eligibleTemplates;
    if (unseen.length === 0) {
      shownCodesRef.current.clear();
    }
    const chosen = pool[Math.floor(Math.random() * Math.min(pool.length, 6))];
    if (chosen) {
      shownCodesRef.current.add(chosen.code);
    }
    return chosen ?? null;
  }, [eligibleTemplates]);

  const isFormElementFocused = () => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  };

  // Distribution scheduler: 6s per visible pop-up and 3 to 7 minutes interval from one to the next
  useEffect(() => {
    if (disabled || !engaged || eligibleTemplates.length === 0) {
      setActivePopup(null);
      return;
    }
    if (blockedByOverlay) {
      setActivePopup(null);
      return;
    }

    const computeNextDelayMs = (): number => {
      if (hasShownPopupRef.current) {
        return getRandomPopupIntervalMs(); // 3 a 7 minutos (180s - 420s)
      }
      try {
        const lastRaw = sessionStorage.getItem(LAST_SHOWN_STORAGE_KEY);
        if (lastRaw) {
          const elapsed = Date.now() - Number(lastRaw);
          if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MAX_POPUP_INTERVAL_MS) {
            const targetInterval = getRandomPopupIntervalMs();
            if (elapsed < targetInterval) {
              return targetInterval - elapsed;
            }
          }
        }
      } catch {
        // ignore sessionStorage access errors
      }
      return 9000;
    };

    const scheduleNextPopup = (delayMs: number) => {
      nextTimerRef.current = setTimeout(() => {
        if (blockedByOverlay || isFormElementFocused()) {
          scheduleNextPopup(15000);
          return;
        }
        const next = pickNextPopup();
        if (next) {
          hasShownPopupRef.current = true;
          try {
            sessionStorage.setItem(LAST_SHOWN_STORAGE_KEY, String(Date.now()));
          } catch {
            // ignore sessionStorage quota errors
          }
          setActivePopup(next);
        }
      }, delayMs);
    };

    if (!activePopup) {
      scheduleNextPopup(computeNextDelayMs());
    } else if (!pausedByHover) {
      const visibleMs = Math.max(
        POPUP_VISIBLE_DURATION_MS,
        Math.min(12000, activePopup.durationMs || POPUP_VISIBLE_DURATION_MS)
      );
      hideTimerRef.current = setTimeout(() => {
        setActivePopup(null);
      }, visibleMs);
    }

    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (nextTimerRef.current) clearTimeout(nextTimerRef.current);
    };
  }, [disabled, engaged, blockedByOverlay, activePopup, pausedByHover, eligibleTemplates.length, pickNextPopup]);

  const handleDisableAll = () => {
    setDisabled(true);
    setActivePopup(null);
    try {
      localStorage.setItem(DISABLE_STORAGE_KEY, '1');
    } catch {
      // ignore storage quota errors
    }
  };

  if (disabled) {
    return (
      <div className="fixed bottom-4 left-4 z-[60]">
        <button
          type="button"
          onClick={() => {
            setDisabled(false);
            try {
              localStorage.removeItem(DISABLE_STORAGE_KEY);
            } catch {
              // ignore
            }
          }}
          className="px-3 py-2 rounded-xl bg-[#FFFFFF] border border-[#111111] text-[11px] font-bold text-[#111111] shadow-md hover:bg-[#39FF14] transition-colors inline-flex items-center gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Ativar Sugestões ({templates.length})</span>
        </button>
      </div>
    );
  }

  if (!activePopup || blockedByOverlay) {
    return null;
  }

  const style = VARIANT_STYLES[activePopup.visualVariant] ?? VARIANT_STYLES['neon-emerald'];

  return (
    <aside
      aria-live="polite"
      aria-label={`Destaque ${activePopup.category}`}
      onMouseEnter={() => setPausedByHover(true)}
      onMouseLeave={() => setPausedByHover(false)}
      className={`fixed bottom-4 right-4 z-[65] w-[calc(100vw-2rem)] max-w-sm rounded-2xl overflow-hidden froc-animate-popup ${style.shell}`}
    >
      <div className={`h-1.5 w-full ${style.bar}`} />

      <div className="p-3.5 flex gap-3 items-start">
        <div className="w-20 h-20 rounded-xl overflow-hidden shrink-0 border border-[#111111]/20 relative">
          <ResilientImage
            src={activePopup.imageUrl}
            alt={activePopup.title}
            className="w-full h-full object-cover"
          />
          <span className="absolute bottom-1 left-1 text-xs bg-[#111111]/85 text-white px-1.5 py-0.5 rounded-md">
            {activePopup.emoji}
          </span>
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${style.badge}`}>
              {activePopup.category}
            </span>
            <button
              type="button"
              onClick={() => setActivePopup(null)}
              aria-label="Fechar pop-up"
              className={`min-h-[32px] min-w-[32px] rounded-lg flex items-center justify-center transition-colors ${style.closeBtn}`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <h4 className={`text-sm font-bold leading-snug line-clamp-2 ${style.title}`}>
            {activePopup.title}
          </h4>
          <p className={`text-[11px] leading-snug line-clamp-2 ${style.body}`}>
            {activePopup.description}
          </p>

          <div className="pt-1 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                const action = activePopup.targetAction;
                setActivePopup(null);
                onAction(action);
              }}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap ${style.cta}`}
            >
              {activePopup.ctaLabel} →
            </button>

            <button
              type="button"
              onClick={handleDisableAll}
              title="Desativar notificações promocionais"
              className={`inline-flex items-center gap-1 text-[10px] font-semibold opacity-75 hover:opacity-100 ${style.title}`}
            >
              {pausedByHover ? <Pause className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
              <span>Desativar</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
