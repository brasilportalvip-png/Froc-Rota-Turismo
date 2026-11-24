import React, { useState } from 'react';
import { Compass } from 'lucide-react';

interface ResilientImageProps {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}

export const ResilientImage: React.FC<ResilientImageProps> = ({
  src,
  alt,
  className = '',
  priority = false,
}) => {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#111111] text-white p-6 border border-[#39FF14]/40 ${className}`}
        role="img"
        aria-label={alt}
      >
        <Compass className="w-8 h-8 text-[#FFD700] mb-2" />
        <span className="text-xs font-semibold text-center line-clamp-2 max-w-[20ch]">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
