import React, { useEffect, useState } from 'react';
import { Megaphone, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';

interface Analise {
  lanceBps: number;
  posicao: number;
  total: number;
  sugestaoTopoBps: number;
  sugestaoTop3Bps: number;
  dica: string;
  minBps: number;
  maxBps: number;
}

const pct = (bps: number) => `${(bps / 100).toFixed(1).replace('.0', '').replace('.', ',')}%`;

/** Leilão de comissão: o anunciante escolhe de 14% a 25%; quem oferece mais aparece primeiro. */
export const LeilaoComissao: React.FC = () => {
  const { apiFetch, notify } = useApp();
  const [dados, setDados] = useState<Analise | null>(null);
  const [lance, setLance] = useState(1400);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    apiFetch<Analise>('/api/merchant/leilao')
      .then((d) => {
        setDados(d);
        setLance(d.lanceBps);
      })
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : 'Não foi possível carregar o leilão.'));
  }, [apiFetch]);

  const salvar = async (bps: number) => {
    setSalvando(true);
    try {
      const d = await apiFetch<Analise>('/api/merchant/leilao', { method: 'PATCH', body: JSON.stringify({ bidBps: bps }) });
      setDados(d);
      setLance(d.lanceBps);
      notify(`Lance salvo: ${pct(d.lanceBps)} de comissão. Você está em ${d.posicao}º lugar.`, 'success');
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : 'Não foi possível salvar o lance.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  if (erro) return <div className="p-4 rounded-xl border border-[#111111]/15 text-xs text-red-700">{erro}</div>;
  if (!dados) return <div className="p-4 rounded-xl border border-[#111111]/15 text-xs text-[#111111]/60 animate-pulse">Carregando leilão…</div>;

  const mudou = lance !== dados.lanceBps;
  return (
    <section className="p-4 md:p-5 rounded-2xl border-2 border-[#111111] bg-white space-y-3" data-testid="leilao">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-[#111111] inline-flex items-center gap-2">
          <Megaphone className="w-4 h-4" /> Leilão de comissão
        </h3>
        <span className="px-2.5 py-1 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-extrabold">
          {dados.posicao}º de {dados.total} nos seus destinos
        </span>
      </div>
      <p className="text-xs text-[#111111]/75">
        Você escolhe quanto paga de comissão por reserva, de {pct(dados.minBps)} a {pct(dados.maxBps)}. Quem oferece mais aparece primeiro na
        vitrine e nas buscas do mesmo destino. A comissão só é cobrada quando há reserva paga.
      </p>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={dados.minBps}
          max={dados.maxBps}
          step={50}
          value={lance}
          onChange={(e) => setLance(Number(e.target.value))}
          aria-label="Comissão oferecida"
          className="flex-1 accent-[#111111]"
        />
        <span className="w-16 text-right text-lg font-extrabold font-mono-tabular text-[#111111]">{pct(lance)}</span>
      </div>
      <div className="p-3 rounded-xl bg-[#39FF14]/10 border border-[#39FF14] text-xs text-[#111111] flex gap-2">
        <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="space-y-2">
          <p>
            <strong>Sugestão da IA:</strong> {dados.dica}
          </p>
          <div className="flex flex-wrap gap-2">
            {dados.posicao > 1 && dados.sugestaoTopoBps > dados.lanceBps && (
              <button
                type="button"
                disabled={salvando}
                onClick={() => salvar(dados.sugestaoTopoBps)}
                className="px-3 py-1.5 rounded-lg bg-[#111111] text-[#39FF14] font-bold disabled:opacity-50"
              >
                Ir para o 1º lugar ({pct(dados.sugestaoTopoBps)})
              </button>
            )}
            {dados.total > 3 && dados.posicao > 3 && dados.sugestaoTop3Bps < dados.sugestaoTopoBps && (
              <button
                type="button"
                disabled={salvando}
                onClick={() => salvar(dados.sugestaoTop3Bps)}
                className="px-3 py-1.5 rounded-lg border-2 border-[#111111] font-bold disabled:opacity-50"
              >
                Ficar entre os 3 primeiros ({pct(dados.sugestaoTop3Bps)})
              </button>
            )}
          </div>
        </div>
      </div>
      <button
        type="button"
        disabled={!mudou || salvando}
        onClick={() => salvar(lance)}
        className="w-full min-h-[44px] rounded-xl froc-btn-neon text-xs font-extrabold disabled:opacity-50"
      >
        {salvando ? 'Salvando…' : mudou ? `Salvar lance de ${pct(lance)}` : `Lance atual: ${pct(dados.lanceBps)}`}
      </button>
    </section>
  );
};
