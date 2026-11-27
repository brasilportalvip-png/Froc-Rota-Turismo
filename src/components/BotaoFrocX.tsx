import React from 'react';
import { Navigation } from 'lucide-react';
import { linkFrocX, type PontoFrocX } from '../lib/frocX.ts';

interface Props {
  destino?: PontoFrocX;
  origem?: PontoFrocX;
  texto?: string;
  className?: string;
}

/** Botão "Ir de Froc X": abre o app de corridas da Froc com o lugar já preenchido. */
export const BotaoFrocX: React.FC<Props> = ({ destino, origem, texto = 'Ir de Froc X', className }) => (
  <a
    href={linkFrocX({ destino, origem })}
    target="_blank"
    rel="noopener noreferrer"
    data-testid="botao-froc-x"
    className={
      className ||
      'min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#111111] text-white text-xs font-extrabold hover:opacity-90'
    }
  >
    <Navigation className="w-3.5 h-3.5" />
    <span>{texto}</span>
  </a>
);
