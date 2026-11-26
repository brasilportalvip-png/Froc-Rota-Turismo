import React from 'react';

/** Crédito do fotógrafo (exigido pela licença livre das fotos do Wikimedia Commons). */
export const FotoCredito: React.FC<{ credito?: { author?: string; license?: string; pageUrl?: string } | null; className?: string }> = ({
  credito,
  className = '',
}) => {
  if (!credito?.pageUrl) return null;
  return (
    <a
      href={credito.pageUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`block text-[9px] leading-tight text-[#111111]/55 truncate hover:underline ${className}`}
    >
      Foto: {credito.author || 'autor'} · {credito.license || 'licença livre'} · Wikimedia Commons
    </a>
  );
};
