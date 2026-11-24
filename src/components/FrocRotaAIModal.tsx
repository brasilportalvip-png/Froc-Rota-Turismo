import React, { useState } from 'react';
import { Compass, Send } from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { formatMoney } from '../i18n/translations.ts';
import { FuturisticModalHeader } from './DesignSystem.tsx';

interface AiResult {
  reply: string;
  recommendedDestinations: Array<{
    slug: string;
    name: string;
    state: string;
    avgBudgetDayBrl: number;
    reason: string;
  }>;
  recommendedListings: Array<{
    id: number;
    slug: string;
    title: string;
    moduleType: string;
    priceBrl: number;
    city: string;
  }>;
  suggestedItinerary: Array<{
    day: number;
    title: string;
    activities: string[];
  }>;
}

interface FrocRotaAIModalProps {
  initialPrompt?: string;
  onClose: () => void;
  onSelectDestinationSlug: (slug: string) => void;
  onSelectListingSlug: (slug: string) => void;
}

export const FrocRotaAIModal: React.FC<FrocRotaAIModalProps> = ({
  initialPrompt = '',
  onClose,
  onSelectDestinationSlug,
  onSelectListingSlug,
}) => {
  const { apiFetch, currency, dbUser, language, notify } = useApp();
  const [query, setQuery] = useState(initialPrompt);
  const [budgetBrl, setBudgetBrl] = useState('3000');
  const [travelers, setTravelers] = useState('2');
  const [saveItinerary, setSaveItinerary] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiResult | null>(null);

  const examples = [
    'Tenho R$ 3.000 e quero viajar com minha família. Para onde posso ir?',
    'Estou em Paraty. Quero passeios de lancha e hospedagem no centro histórico.',
    'Quero um roteiro de 3 dias em Fernando de Noronha com mergulho e gastronomia.',
  ];

  const handleAsk = async (e?: React.FormEvent, overrideQuery?: string) => {
    e?.preventDefault();
    const text = (overrideQuery ?? query).trim();
    if (!text) return;
    setLoading(true);
    try {
      const res = await apiFetch<AiResult>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          query: text,
          language,
          budgetBrl: budgetBrl ? Number(budgetBrl) : undefined,
          travelers: travelers ? Number(travelers) : undefined,
          saveItinerary: Boolean(dbUser && saveItinerary),
        }),
      });
      setResult(res);
      if (dbUser && saveItinerary && res.suggestedItinerary.length > 0) {
        notify('Roteiro salvo automaticamente em Minha Conta.', 'success');
      }
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Falha na Froc Rota AI.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Froc Rota AI — Assistente de Viagens" className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs overflow-y-auto p-4 md:p-8 flex justify-center items-start">
      <div className="w-full max-w-3xl bg-[#FFFFFF] rounded-2xl border-2 border-[#111111] shadow-2xl overflow-hidden my-4 froc-animate-modal">
        <FuturisticModalHeader
          title="Froc Rota AI — Assistente de Viagens 2030+"
          subtitle="Recomendações e roteiros baseados exclusivamente nos dados reais da plataforma"
          icon={<Compass className="w-5 h-5" />}
          onBack={onClose}
          onClose={onClose}
        />

        <div className="p-6 space-y-5">
          <form onSubmit={(e) => handleAsk(e)} className="space-y-3">
            <textarea
              rows={3}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pergunte sobre destinos, orçamento, passeios de barco, restaurantes ou peça um roteiro completo..."
              className="w-full px-4 py-3 rounded-xl border-2 border-[#111111]/20 text-sm focus:outline-none focus:border-[#39FF14]"
            />

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-xs font-bold text-[#111111] mb-1">
                  Orçamento total (R$)
                </label>
                <input
                  type="number"
                  min={200}
                  value={budgetBrl}
                  onChange={(e) => setBudgetBrl(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#111111]/25 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#111111] mb-1">Viajantes</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={travelers}
                  onChange={(e) => setTravelers(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#111111]/25 text-sm font-mono-tabular"
                />
              </div>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 py-2.5 rounded-xl border border-[#111111]/25 text-xs font-bold text-[#111111] hover:bg-[#111111]/5"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={loading}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl froc-btn-neon text-sm font-extrabold"
              >
                <Send className="w-4 h-4" />
                <span>{loading ? 'Analisando...' : 'Planejar Agora'}</span>
              </button>
            </div>

            {dbUser && (
              <label className="inline-flex items-center gap-2 text-xs text-[#111111]/75 font-semibold">
                <input
                  type="checkbox"
                  checked={saveItinerary}
                  onChange={(e) => setSaveItinerary(e.target.checked)}
                />
                <span>Salvar roteiro sugerido no meu perfil</span>
              </label>
            )}
          </form>

          {!result && !loading && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-[#111111]/70">Sugestões rápidas:</div>
              <div className="flex flex-col gap-2">
                {examples.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => {
                      setQuery(ex);
                      handleAsk(undefined, ex);
                    }}
                    className="text-left px-3.5 py-2.5 rounded-lg bg-white hover:bg-[#ECEAE3] text-xs text-[#111111] border border-[#111111]/15 transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-6 pt-4 border-t border-[#111111]/15">
              <div className="p-4 rounded-xl bg-white border border-[#111111]/15 text-sm text-[#111111] leading-relaxed">
                {result.reply}
              </div>

              {result.recommendedDestinations.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[#111111]/70 mb-2.5">
                    Destinos reais compatíveis
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {result.recommendedDestinations.map((d) => (
                      <button
                        key={d.slug}
                        type="button"
                        onClick={() => {
                          onClose();
                          onSelectDestinationSlug(d.slug);
                        }}
                        className="text-left p-3.5 rounded-lg border border-[#111111]/15 hover:border-[#111111] transition-colors"
                      >
                        <div className="flex justify-between items-center text-sm font-semibold text-[#111111]">
                          <span>
                            {d.name}, {d.state}
                          </span>
                          <span className="font-mono-tabular text-xs text-[#111111]">
                            {formatMoney(d.avgBudgetDayBrl * 100, currency)}/dia
                          </span>
                        </div>
                        <p className="text-xs text-[#111111]/70 mt-1">{d.reason}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {result.recommendedListings.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[#111111]/70 mb-2.5">
                    Experiências, restaurantes e hospedagens recomendadas
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {result.recommendedListings.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => {
                          onClose();
                          onSelectListingSlug(l.slug);
                        }}
                        className="text-left p-3.5 rounded-lg border border-[#111111]/15 hover:border-[#111111] transition-colors"
                      >
                        <div className="text-[11px] text-[#111111]/70">
                          {l.moduleType} · {l.city}
                        </div>
                        <div className="text-sm font-semibold text-[#111111] mt-0.5">{l.title}</div>
                        <div className="text-xs font-mono-tabular text-[#111111] font-semibold mt-1">
                          {formatMoney(l.priceBrl * 100, currency)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {result.suggestedItinerary.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[#111111]/70 mb-2.5">
                    Roteiro sugerido dia a dia
                  </h4>
                  <div className="space-y-3">
                    {result.suggestedItinerary.map((day) => (
                      <div key={day.day} className="p-4 rounded-lg border border-[#111111]/15">
                        <div className="text-sm font-semibold text-[#111111]">
                          Dia {day.day} — {day.title}
                        </div>
                        <ul className="mt-2 space-y-1 text-xs text-[#111111]/70">
                          {day.activities.map((act, i) => (
                            <li key={i}>· {act}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
