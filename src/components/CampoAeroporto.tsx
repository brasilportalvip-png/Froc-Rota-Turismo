import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MapPin, Plane } from 'lucide-react';
import { acharAeroporto, buscarAeroportos, rotuloAeroporto, type Aeroporto } from '../../api/_lib/aeroportos.ts';

interface Props {
  label: string;
  value: string; // código IATA (aeroporto ou cidade)
  onChange: (codigo: string) => void;
  placeholder?: string;
  testId?: string;
}

/** Campo de cidade/aeroporto com sugestões (o cliente digita "Natal", "São Paulo"… e escolhe na lista). */
export const CampoAeroporto: React.FC<Props> = ({ label, value, onChange, placeholder, testId }) => {
  const id = useId();
  const atual = acharAeroporto(value);
  const [texto, setTexto] = useState(atual ? rotuloAeroporto(atual) : value);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const caixa = useRef<HTMLDivElement | null>(null);

  // Quando o código muda por fora (ex.: link do blog com ?voo=GIG, botão de inverter), atualiza o texto.
  useEffect(() => {
    const a = acharAeroporto(value);
    setTexto(a ? rotuloAeroporto(a) : value);
  }, [value]);

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  const sugestoes = useMemo(() => (aberto ? buscarAeroportos(texto, 8) : []), [aberto, texto]);

  const escolher = (a: Aeroporto) => {
    onChange(a.codigo);
    setTexto(rotuloAeroporto(a));
    setAberto(false);
  };

  const sair = () => {
    // Se a pessoa digitou e saiu sem escolher, usa a primeira sugestão; se apagou, volta ao que estava.
    window.setTimeout(() => {
      setAberto(false);
      const a = acharAeroporto(value);
      const primeira = buscarAeroportos(texto, 1)[0];
      if (a && texto === rotuloAeroporto(a)) return;
      if (primeira && texto.trim()) escolher(primeira);
      else setTexto(a ? rotuloAeroporto(a) : '');
    }, 150);
  };

  return (
    <div ref={caixa} className="relative" data-testid={testId}>
      <label htmlFor={id} className="block text-xs font-bold text-[#111111] mb-1">
        {label}
      </label>
      <div className="relative">
        <MapPin className="w-4 h-4 text-[#111111]/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          id={id}
          role="combobox"
          aria-expanded={aberto && sugestoes.length > 0}
          aria-controls={`${id}-lista`}
          aria-autocomplete="list"
          autoComplete="off"
          required
          value={texto}
          placeholder={placeholder || 'Digite a cidade'}
          onFocus={(e) => {
            e.currentTarget.select();
            setAberto(true);
            setAtivo(0);
          }}
          onChange={(e) => {
            setTexto(e.target.value);
            setAberto(true);
            setAtivo(0);
          }}
          onBlur={sair}
          onKeyDown={(e) => {
            if (!sugestoes.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setAtivo((i) => Math.min(sugestoes.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setAtivo((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              escolher(sugestoes[ativo]);
            } else if (e.key === 'Escape') {
              setAberto(false);
            }
          }}
          className="w-full min-h-[48px] pl-9 pr-3 py-2.5 rounded-xl border-2 border-[#111111]/15 text-sm font-semibold focus:border-[#111111] outline-none bg-white"
        />
      </div>
      {aberto && sugestoes.length > 0 && (
        <ul
          id={`${id}-lista`}
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-80 overflow-y-auto rounded-xl border-2 border-[#111111] bg-white shadow-xl"
        >
          {sugestoes.map((a, i) => (
            <li
              key={a.codigo}
              role="option"
              aria-selected={i === ativo}
              onMouseDown={(e) => {
                e.preventDefault();
                escolher(a);
              }}
              onMouseEnter={() => setAtivo(i)}
              className={`px-3 py-2.5 cursor-pointer flex items-center gap-3 border-b last:border-b-0 border-[#111111]/10 ${
                i === ativo ? 'bg-[#39FF14]/20' : 'bg-white'
              }`}
            >
              {a.todos ? <MapPin className="w-4 h-4 shrink-0 text-[#111111]" /> : <Plane className="w-4 h-4 shrink-0 text-[#111111]/70" />}
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-[#111111] truncate">
                  {a.cidade} - {a.uf}
                </span>
                <span className="block text-[11px] text-[#111111]/65 truncate">
                  {a.todos ? 'Todos os aeroportos' : `Aeroporto ${a.nome}`}
                </span>
              </span>
              <span className="text-xs font-mono-tabular font-extrabold text-[#111111]/70">{a.codigo}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
