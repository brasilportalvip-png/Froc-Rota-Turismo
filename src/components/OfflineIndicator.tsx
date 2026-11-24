import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[85] flex items-center gap-2 rounded-xl bg-[#111111] border-2 border-[#FF1493] px-3.5 py-2 text-xs font-bold text-white shadow-xl">
      <WifiOff className="w-3.5 h-3.5 shrink-0 text-[#FF1493]" />
      <span>Modo Offline — Dados em cache PWA</span>
    </div>
  );
};
