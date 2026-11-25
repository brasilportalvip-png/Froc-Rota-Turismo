import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Eye, EyeOff, Play, ShieldCheck } from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';

interface IdentityItem {
  uid: string;
  email: string;
  fullName: string;
  cpfMasked: string;
  birthDate: string;
  status: string;
  reason: string | null;
  submittedAt: string | null;
  aiResult: { observacao?: string; sinaisDeFraude?: string[]; confianca?: number } | null;
}

interface AgentReport {
  date: string;
  resumo: string;
  alertas: string[];
  acoes: string[];
  numbers: Record<string, number | string>;
}

interface HiddenReview {
  id: number;
  comment: string;
  rating: number;
  hiddenReason?: string;
  createdAt: string;
}

const NUMBER_LABELS: Record<string, string> = {
  bookingsConfirmed: 'Reservas confirmadas (24h)',
  gmvCents: 'Vendas (R$)',
  commissionCents: 'Comissão Froc (R$)',
  planCharges: 'Planos cobrados',
  planChargesCents: 'Receita de planos (R$)',
  identityPendingReview: 'Identidades na fila',
  identityRejected24h: 'Identidades reprovadas (24h)',
  merchantsPendingReview: 'Parceiros na fila',
  bookingsPendingOver24h: 'Reservas sem pagamento +24h',
  newUsers24h: 'Novos usuários (24h)',
};

/** Painel do Admin: fila de identidades, avaliações ocultadas pela IA e relatórios diários dos agentes. */
export const AdminTrustPanel: React.FC = () => {
  const { apiFetch, hasAdminPermission, notify } = useApp();
  const [queue, setQueue] = useState<IdentityItem[]>([]);
  const [filter, setFilter] = useState('manual_review');
  const [photos, setPhotos] = useState<Record<string, { document: string | null; selfie: string | null }>>({});
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [hidden, setHidden] = useState<HiddenReview[]>([]);
  const [running, setRunning] = useState(false);

  const canSecurity = hasAdminPermission('security');
  const canAgents = hasAdminPermission('agents');
  const canMerchants = hasAdminPermission('merchants');

  const load = useCallback(async () => {
    const jobs: Promise<void>[] = [];
    if (canSecurity)
      jobs.push(
        apiFetch<{ items: IdentityItem[] }>(`/api/admin/identity?status=${filter}`)
          .then((r) => setQueue(r.items || []))
          .catch(() => {})
      );
    if (canAgents)
      jobs.push(
        apiFetch<{ reports: AgentReport[] }>('/api/admin/agent-reports')
          .then((r) => setReports(r.reports || []))
          .catch(() => {})
      );
    if (canMerchants)
      jobs.push(
        apiFetch<{ reviews: HiddenReview[] }>('/api/admin/reviews/hidden')
          .then((r) => setHidden(r.reviews || []))
          .catch(() => {})
      );
    await Promise.all(jobs);
  }, [apiFetch, canAgents, canMerchants, canSecurity, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const showPhotos = async (uid: string) => {
    try {
      const r = await apiFetch<{ document: string | null; selfie: string | null }>(`/api/admin/identity/${uid}/images`);
      setPhotos((p) => ({ ...p, [uid]: r }));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao abrir fotos.', 'error');
    }
  };

  const decide = async (uid: string, decision: 'approved' | 'rejected' | 'release_cpf') => {
    try {
      await apiFetch(`/api/admin/identity/${uid}`, { method: 'PATCH', body: JSON.stringify({ decision }) });
      notify(decision === 'approved' ? 'Identidade aprovada.' : decision === 'rejected' ? 'Identidade reprovada.' : 'CPF liberado.', 'success');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao decidir.', 'error');
    }
  };

  const runDaily = async () => {
    setRunning(true);
    try {
      await apiFetch('/api/admin/agents/run-daily', { method: 'POST' });
      notify('Rotina dos agentes executada.', 'success');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao rodar.', 'error');
    } finally {
      setRunning(false);
    }
  };

  const restoreReview = async (id: number) => {
    try {
      await apiFetch(`/api/admin/reviews/${id}`, { method: 'PATCH', body: JSON.stringify({ hidden: false }) });
      notify('Avaliação publicada de novo.', 'success');
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro.', 'error');
    }
  };

  const latest = reports[0];

  return (
    <div className="space-y-8">
      {canAgents && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-[#111111] inline-flex items-center gap-2">
              <Bot className="w-4 h-4" /> Relatório diário dos agentes
            </h3>
            <button
              type="button"
              onClick={runDaily}
              disabled={running}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-bold disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              {running ? 'Rodando...' : 'Rodar agora'}
            </button>
          </div>
          {!latest ? (
            <p className="text-xs text-[#111111]/70">
              O primeiro relatório sai na rotina automática diária (ou toque em "Rodar agora").
            </p>
          ) : (
            <div className="p-4 rounded-2xl border-2 border-[#111111] bg-white space-y-3 text-xs text-[#111111]">
              <div className="font-bold">{new Date(`${latest.date}T12:00:00`).toLocaleDateString('pt-BR')}</div>
              <p className="text-sm">{latest.resumo}</p>
              {latest.alertas?.length > 0 && (
                <div>
                  <div className="font-bold text-[#FF1493]">Atenção</div>
                  <ul className="list-disc pl-5">{latest.alertas.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
              )}
              {latest.acoes?.length > 0 && (
                <div>
                  <div className="font-bold">O que fazer</div>
                  <ul className="list-disc pl-5">{latest.acoes.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-2 border-t border-[#111111]/15">
                {Object.entries(NUMBER_LABELS).map(([k, label]) => {
                  const v = Number(latest.numbers?.[k] ?? 0);
                  return (
                    <div key={k} className="p-2 rounded-lg border border-[#111111]/15">
                      <div className="text-[10px] text-[#111111]/65">{label}</div>
                      <div className="font-mono-tabular font-bold">
                        {k.endsWith('Cents') ? (v / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : v}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {canSecurity && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-[#111111] inline-flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Verificação de identidade (CPF + fotos)
            </h3>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="min-h-[40px] px-2 rounded-lg border border-[#111111]/25 text-xs bg-white"
              aria-label="Filtrar verificações"
            >
              <option value="manual_review">Aguardando a equipe</option>
              <option value="approved">Aprovadas</option>
              <option value="rejected">Reprovadas</option>
              <option value="all">Todas</option>
            </select>
          </div>
          {queue.length === 0 ? (
            <p className="text-xs text-[#111111]/70">Nada aqui.</p>
          ) : (
            queue.map((item) => (
              <div key={item.uid} className="p-4 rounded-xl border border-[#111111]/20 bg-white space-y-2 text-xs text-[#111111]">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold">{item.fullName}</div>
                    <div className="text-[#111111]/70">
                      {item.email} · CPF {item.cpfMasked} · Nasc. {item.birthDate}
                    </div>
                  </div>
                  <span className="font-bold">{item.status}</span>
                </div>
                {item.reason && <div className="text-[#111111]/80">IA: {item.reason}</div>}
                {item.aiResult?.observacao && <div className="text-[#111111]/70">Obs.: {item.aiResult.observacao}</div>}
                {photos[item.uid] ? (
                  <div className="grid grid-cols-2 gap-2">
                    {photos[item.uid].document && <img src={photos[item.uid].document!} alt="Documento" className="w-full max-h-64 object-contain rounded-lg border" />}
                    {photos[item.uid].selfie && <img src={photos[item.uid].selfie!} alt="Selfie" className="w-full max-h-64 object-contain rounded-lg border" />}
                  </div>
                ) : (
                  <button type="button" onClick={() => showPhotos(item.uid)} className="min-h-[40px] px-3 rounded-lg border border-[#111111]/25 font-bold">
                    Ver fotos
                  </button>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => decide(item.uid, 'approved')} className="min-h-[40px] px-3 rounded-lg bg-[#111111] text-[#39FF14] font-bold">
                    Aprovar
                  </button>
                  <button type="button" onClick={() => decide(item.uid, 'rejected')} className="min-h-[40px] px-3 rounded-lg border border-[#FF1493] text-[#111111] font-bold">
                    Reprovar
                  </button>
                  <button type="button" onClick={() => decide(item.uid, 'release_cpf')} className="min-h-[40px] px-3 rounded-lg border border-[#111111]/25 font-bold">
                    Liberar CPF desta conta
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {canMerchants && (
        <section className="space-y-3">
          <h3 className="text-sm font-extrabold text-[#111111] inline-flex items-center gap-2">
            <EyeOff className="w-4 h-4" /> Avaliações ocultadas pela IA ({hidden.length})
          </h3>
          {hidden.length === 0 ? (
            <p className="text-xs text-[#111111]/70">Nenhuma.</p>
          ) : (
            hidden.map((r) => (
              <div key={r.id} className="p-3 rounded-xl border border-[#111111]/20 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <div>“{r.comment}” · {r.rating}★</div>
                  <div className="text-[#111111]/65">Motivo: {r.hiddenReason || '—'}</div>
                </div>
                <button type="button" onClick={() => restoreReview(r.id)} className="min-h-[40px] inline-flex items-center gap-1 px-3 rounded-lg border border-[#111111]/25 font-bold">
                  <Eye className="w-3.5 h-3.5" /> Publicar
                </button>
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
};
