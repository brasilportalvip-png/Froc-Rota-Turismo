import React, { useEffect, useState } from 'react';
import { Bell, BellRing, CheckCircle2, Download, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import { FuturisticModalHeader } from './DesignSystem.tsx';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [notifStatus, setNotifStatus] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });

  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().catch(() => {});
    }
    const openGuide = () => setShowGuideModal(true);
    window.addEventListener('froc-open-pwa-guide', openGuide);
    return () => window.removeEventListener('froc-open-pwa-guide', openGuide);
  }, []);

  const handleInstallClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) {
        setShowGuideModal(true);
      }
      return;
    }
    setShowGuideModal(true);
  };

  const handleRequestNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotifStatus('unsupported');
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setNotifStatus(perm);
      if (perm === 'granted') {
        new Notification('Froc Rota Turismo', {
          body: 'Alertas de voo, promoções e chat em tempo real ativados!',
          icon: '/pwa-192x192.png',
        });
      }
    } catch {
      // ignore blocked browser notification dialog
    }
  };

  return (
    <>
      <div className="inline-flex items-center gap-1.5">
        {!isInstalled ? (
          <button
            type="button"
            onClick={handleInstallClick}
            className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold uppercase tracking-wide froc-btn-neon whitespace-nowrap shrink-0 min-h-[40px]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>INSTALAR FROC ROTA</span>
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-xl border border-[#111111] bg-[#39FF14]/25 px-3 py-1.5 text-[11px] font-bold text-[#111111] whitespace-nowrap">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>App Instalado</span>
          </span>
        )}

        {notifStatus !== 'unsupported' && (
          <button
            type="button"
            onClick={handleRequestNotifications}
            title={
              notifStatus === 'granted'
                ? 'Notificações Push ativadas'
                : 'Autorizar notificações de alertas de voos e mensagens'
            }
            aria-label="Autorizar notificações"
            className={`min-h-[40px] min-w-[40px] px-2.5 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
              notifStatus === 'granted'
                ? 'border-[#111111] bg-[#FFD700] text-[#111111]'
                : 'border-[#111111]/25 bg-white text-[#111111] hover:border-[#FF1493] hover:text-[#FF1493]'
            }`}
          >
            {notifStatus === 'granted' ? (
              <BellRing className="w-3.5 h-3.5" />
            ) : (
              <Bell className="w-3.5 h-3.5" />
            )}
            <span className="hidden xl:inline">
              {notifStatus === 'granted' ? 'Alertas Ativos' : 'Notificações'}
            </span>
          </button>
        )}
      </div>

      {showGuideModal && (
        <div role="dialog" aria-modal="true" aria-label="Instalar Froc Rota" className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-2xl bg-[#FFFFFF] border-2 border-[#111111] shadow-2xl overflow-hidden froc-animate-modal">
            <FuturisticModalHeader
              title="INSTALAR FROC ROTA"
              subtitle="Aplicativo PWA Android, iOS & Desktop"
              icon={<Smartphone className="w-4 h-4" />}
              onClose={() => setShowGuideModal(false)}
            />

            <div className="p-6 space-y-4 text-sm text-[#111111]">
              {isIOS ? (
                <div className="p-4 rounded-xl border border-[#111111]/20 bg-[#FFFFFF] space-y-2">
                  <div className="font-bold text-xs uppercase tracking-wide text-[#FF1493]">
                    📲 No iPhone / iPad (Safari)
                  </div>
                  <p className="text-xs leading-relaxed text-[#111111]/85">
                    1. Toque no ícone <strong>Compartilhar</strong> na barra inferior do Safari.
                    <br />
                    2. Role e toque em <strong>Adicionar à Tela de Início</strong>.
                    <br />
                    3. Confirme em <strong>Adicionar</strong> para abrir em tela cheia com cache offline.
                  </p>
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-[#111111]/20 bg-[#FFFFFF] space-y-2">
                  <div className="font-bold text-xs uppercase tracking-wide text-[#111111]">
                    📱 No Android (Chrome) ou Computador
                  </div>
                  <p className="text-xs leading-relaxed text-[#111111]/85">
                    {isInstallable
                      ? 'Seu navegador suporta instalação direta! Clique no botão verde abaixo para instalar imediatamente.'
                      : 'Quando o atalho automático não aparecer (modo anônimo, janela incorporada ou já pré-instalado), abra o menu ⋮ do Chrome/Edge e toque em "Instalar Froc Rota Turismo" ou "Adicionar à tela inicial".'}
                  </p>
                </div>
              )}

              <div className="p-4 rounded-xl border border-[#111111]/20 bg-[#111111] text-white space-y-2">
                <div className="font-bold text-xs text-[#FFD700]">
                  🔔 Notificações Push em Tempo Real
                </div>
                <p className="text-xs text-white/80">
                  Ative alertas do navegador para receber avisos do Radar de Voos, confirmações de reservas e mensagens do chat.
                </p>
                <button
                  type="button"
                  onClick={handleRequestNotifications}
                  className="px-3.5 py-2 rounded-lg froc-btn-gold text-xs font-bold"
                >
                  {notifStatus === 'granted'
                    ? '✅ Notificações Autorizadas'
                    : 'Autorizar Notificações Agora'}
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowGuideModal(false)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-[#111111]/25 text-xs font-bold text-[#111111] hover:bg-[#111111]/5"
                >
                  Fechar
                </button>
                {isInstallable && (
                  <button
                    type="button"
                    onClick={install}
                    className="min-h-[44px] px-5 py-2 rounded-xl froc-btn-neon text-xs font-bold"
                  >
                    Instalar Agora
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
