import React, { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  Calculator,
  FileCheck2,
  Lock,
  MessageSquare,
  Newspaper,
  Play,
  Plus,
  Shield,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  AdminPermissionRecord,
  AgentTask,
  AiAgent,
  Booking,
  ConciergeRequest,
  EditorialPost,
  FinancialLedgerEntry,
  Merchant,
  MerchantPlan,
  MerchantSubscriptionRow,
  PopupTemplate,
  PriceBreakdown,
  PricingRule,
} from '../types.ts';
import { useApp } from '../context/AppContext.tsx';
import { AdminTrustPanel } from './AdminTrustPanel.tsx';
import { AdminRadarPanel } from './AdminRadarPanel.tsx';
import { formatMoney } from '../i18n/translations.ts';
import { FuturisticModalHeader, SecurityPinCard } from './DesignSystem.tsx';

interface AdminOverview {
  metrics: {
    usersCount: number;
    merchantsCount: number;
    destinationsCount: number;
    listingsCount: number;
    bookingsCount: number;
    gmvCents: number;
    commissionRevenueCents: number;
  };
  merchants: Merchant[];
  plans: MerchantPlan[];
  bookings: Booking[];
  conciergeRequests: ConciergeRequest[];
  reports: Array<{ id: number; targetType: string; targetId: number; reason: string; status: string }>;
  auditLogs: Array<{ id: number; actorEmail: string | null; action: string; entityType: string; entityId: string; createdAt: string }>;
}

interface AgentsPayload {
  summary: {
    totalAgents: number;
    idleCount: number;
    runningCount: number;
    waitingCount: number;
    errorAgentsCount: number;
    totalTasksCompleted: number;
    totalAiCostUsd: number;
    departmentBreakdown: Record<string, number>;
  };
  agents: AiAgent[];
  recentTasks: AgentTask[];
}

interface FinancePayload {
  rules: PricingRule[];
  ledger: FinancialLedgerEntry[];
  subscriptions: MerchantSubscriptionRow[];
  totals: {
    grossCents: number;
    platformRevenueCents: number;
    paymentFeesCents: number;
    taxesCents: number;
    estimatedMarginCents: number;
  };
}

interface IntegrationsPayload {
  travel: Array<{ provider: string; configured: boolean; notes: string }>;
  payments: {
    mercadopago: {
      configured: boolean;
      webhookSecretConfigured?: boolean;
      publicKeyConfigured?: boolean;
      mode: string;
      splitSupported?: boolean;
    };
  };
  googleBusinessOAuth: { configured: boolean; redirectUri: string };
  mercadoPagoOAuth: { configured: boolean; redirectUri: string };
  connectedAccounts: Array<{
    id: number;
    provider: string;
    externalAccountName: string | null;
    status: string;
  }>;
  ai: {
    configured: boolean;
    model: string;
    backupKeyConfigured?: boolean;
    sdkCompatLine?: string;
    cascadeModels?: string[];
    totalRequests?: number;
    totalFailovers?: number;
    healthyRoutesCount?: number;
    totalRoutesCount?: number;
    overallStatus?: string;
    routes?: Array<{
      routeId: string;
      model: string;
      keySlot: string;
      state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      consecutiveFailures: number;
      totalSuccesses: number;
      totalFailures: number;
      failoverRecoveries: number;
      lastLatencyMs: number | null;
      cooldownRemainingSec: number;
    }>;
  };
  security?: {
    httpsStrictHeaders: boolean;
    noStoreApiCache: boolean;
    strictCorsOriginAllowlist: boolean;
    maxJsonBodyBytes: number;
    prototypeAndNoSqlSanitizer: boolean;
    ssrfUrlFilter: boolean;
    aiPromptInjectionGuard: boolean;
    webhookHmacAndReplayWindowSec: number;
    oauthHmacSignedState: boolean;
    rbacVerifiedEmailRequired: boolean;
    mercadoPagoWebhookSecretConfigured: boolean;
    oauthCustomSecretConfigured: boolean;
  };
}

const ALL_SUBADMIN_PERMS = [
  'overview',
  'merchants',
  'finance',
  'agents',
  'editorial',
  'chat',
  'integrations',
  'security',
];

export const AdminMasterPanel: React.FC<{
  onClose: () => void;
  onOpenChat: () => void;
}> = ({ onClose, onOpenChat }) => {
  const { apiFetch, currency, dbUser, hasAdminPermission, notify } = useApp();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [finance, setFinance] = useState<FinancePayload | null>(null);
  const [agentsData, setAgentsData] = useState<AgentsPayload | null>(null);
  const [posts, setPosts] = useState<EditorialPost[]>([]);
  const [popups, setPopups] = useState<PopupTemplate[]>([]);
  const [popupCategories, setPopupCategories] = useState<string[]>([]);
  const [popupCatFilter, setPopupCatFilter] = useState<string>('all');
  const [newPopTitle, setNewPopTitle] = useState('');
  const [newPopDesc, setNewPopDesc] = useState('');
  const [newPopCta, setNewPopCta] = useState('Ver agora');
  const [newPopCat, setNewPopCat] = useState('Novidades');
  const [newPopAction, setNewPopAction] = useState('section:#marketplace');
  const [newPopVariant, setNewPopVariant] = useState('neon-emerald');
  const [newPopDuration, setNewPopDuration] = useState('6000');
  const [integrations, setIntegrations] = useState<IntegrationsPayload | null>(null);
  const [subAdmins, setSubAdmins] = useState<AdminPermissionRecord[]>([]);

  const getDefaultAllowedTab = ():
    | 'merchants'
    | 'finance'
    | 'agents'
    | 'editorial'
    | 'popups'
    | 'concierge'
    | 'subadmins'
    | 'integrations'
    | 'audit' => {
    if (hasAdminPermission('merchants')) return 'merchants';
    if (hasAdminPermission('finance')) return 'finance';
    if (hasAdminPermission('agents')) return 'agents';
    if (hasAdminPermission('editorial')) return 'editorial';
    if (hasAdminPermission('overview')) return 'concierge';
    if (hasAdminPermission('integrations')) return 'integrations';
    if (hasAdminPermission('security')) return 'audit';
    if (dbUser?.role === 'admin') return 'subadmins';
    return 'merchants';
  };

  const [tab, setTab] = useState<
    'merchants' | 'trust' | 'radar' | 'finance' | 'agents' | 'editorial' | 'popups' | 'concierge' | 'subadmins' | 'integrations' | 'audit'
  >(getDefaultAllowedTab);

  // Forms & filters
  const [proposalDraft, setProposalDraft] = useState<Record<number, { summary: string; amount: string }>>({});

  // Finance rule & simulator
  const [ruleName, setRuleName] = useState('');
  const [ruleCat, setRuleCat] = useState('flights');
  const [ruleType, setRuleType] = useState<'fixed' | 'percent' | 'hybrid'>('fixed');
  const [ruleFixedBrl, setRuleFixedBrl] = useState('200');
  const [rulePercent, setRulePercent] = useState('0');
  const [simCategory, setSimCategory] = useState('flights');
  const [simCostBrl, setSimCostBrl] = useState('1000');
  const [simResult, setSimResult] = useState<PriceBreakdown | null>(null);

  // Agents filter & manual dispatch
  const [agentDeptFilter, setAgentDeptFilter] = useState('all');
  const [dispatchDept, setDispatchDept] = useState('Voos e Oportunidades');
  const [dispatchTitle, setDispatchTitle] = useState('');
  const [dispatchAction, setDispatchAction] = useState('analyze_radar');
  const [dispatchApproval, setDispatchApproval] = useState(false);

  // Editorial manual post form
  const [postTitle, setPostTitle] = useState('');
  const [postCategory, setPostCategory] = useState('Destinos & Praias');
  const [postBody, setPostBody] = useState('');
  const [postCover, setPostCover] = useState('/src/assets/images/dest_rio_coastline_1795530549216.jpg');

  // Sub-admin RBAC form
  const [subEmail, setSubEmail] = useState('');
  const [subLabel, setSubLabel] = useState('Gerente Operacional');
  const [subPerms, setSubPerms] = useState<string[]>(['overview', 'editorial', 'chat']);

  const loadAllAdmin = useCallback(async () => {
    try {
      const loaders: Promise<void>[] = [];

      if (hasAdminPermission('overview')) {
        loaders.push(
          apiFetch<AdminOverview>('/api/admin/overview').then((ov) => {
            setData(ov);
          })
        );
      } else {
        const emptyOverview: AdminOverview = {
          metrics: {
            usersCount: 0,
            merchantsCount: 0,
            destinationsCount: 0,
            listingsCount: 0,
            bookingsCount: 0,
            gmvCents: 0,
            commissionRevenueCents: 0,
          },
          merchants: [],
          plans: [],
          bookings: [],
          conciergeRequests: [],
          reports: [],
          auditLogs: [],
        };
        if (hasAdminPermission('merchants')) {
          loaders.push(
            apiFetch<{
              merchants: Merchant[];
              listings: unknown[];
            }>('/api/admin/merchants').then((res) => {
              setData({
                ...emptyOverview,
                merchants: res.merchants || [],
                metrics: {
                  ...emptyOverview.metrics,
                  merchantsCount: res.merchants?.length || 0,
                  listingsCount: res.listings?.length || 0,
                },
              });
            })
          );
        } else {
          setData(emptyOverview);
        }
      }

      if (hasAdminPermission('finance')) {
        loaders.push(
          apiFetch<FinancePayload>('/api/admin/finance')
            .then(setFinance)
            .catch(() => {})
        );
      }
      if (hasAdminPermission('agents')) {
        const q =
          agentDeptFilter !== 'all'
            ? `?department=${encodeURIComponent(agentDeptFilter)}`
            : '';
        loaders.push(
          apiFetch<AgentsPayload>(`/api/admin/agents${q}`)
            .then(setAgentsData)
            .catch(() => {})
        );
      }
      if (hasAdminPermission('editorial')) {
        loaders.push(
          apiFetch<{ posts: EditorialPost[] }>('/api/admin/posts')
            .then((r) => setPosts(r.posts || []))
            .catch(() => {})
        );
        loaders.push(
          apiFetch<{ popups: PopupTemplate[]; categories: string[] }>('/api/admin/popups')
            .then((r) => {
              setPopups(r.popups || []);
              setPopupCategories(r.categories || []);
            })
            .catch(() => {})
        );
      }
      if (hasAdminPermission('integrations')) {
        loaders.push(
          apiFetch<IntegrationsPayload>('/api/admin/integrations')
            .then(setIntegrations)
            .catch(() => {})
        );
      }
      if (dbUser?.role === 'admin') {
        loaders.push(
          apiFetch<{ subAdmins: AdminPermissionRecord[] }>('/api/admin/permissions')
            .then((r) => setSubAdmins(r.subAdmins || []))
            .catch(() => {})
        );
      }
      await Promise.all(loaders);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Acesso administrativo negado.', 'error');
      onClose();
    }
  }, [agentDeptFilter, apiFetch, dbUser?.role, hasAdminPermission, notify, onClose]);

  useEffect(() => {
    loadAllAdmin();
  }, [loadAllAdmin]);

  const runPricingSimulation = useCallback(async () => {
    try {
      const res = await apiFetch<{ breakdown: PriceBreakdown }>('/api/pricing/preview', {
        method: 'POST',
        body: JSON.stringify({
          category: simCategory,
          supplierCostCents: Math.round(Number(simCostBrl || 0) * 100),
        }),
      });
      setSimResult(res.breakdown);
    } catch {
      // ignore invalid numbers
    }
  }, [apiFetch, simCategory, simCostBrl]);

  useEffect(() => {
    if (tab === 'finance') {
      runPricingSimulation();
    }
  }, [tab, runPricingSimulation]);

  const verifyMerchant = async (id: number, status: 'verified' | 'rejected' | 'ai') => {
    try {
      await apiFetch(`/api/admin/merchants/${id}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      notify(status === 'ai' ? 'A IA verificou o parceiro de novo.' : `Parceiro marcado como ${status === 'verified' ? 'aprovado' : 'reprovado'}.`, 'success');
      await loadAllAdmin();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao verificar.', 'error');
    }
  };



  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/pricing-rules', {
        method: 'POST',
        body: JSON.stringify({
          name: ruleName,
          category: ruleCat,
          markupType: ruleType,
          markupFixedBrl: Number(ruleFixedBrl),
          markupPercent: Number(rulePercent),
        }),
      });
      setRuleName('');
      notify('Regra de remuneração criada no Motor Financeiro!', 'success');
      await loadAllAdmin();
      await runPricingSimulation();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao criar regra.', 'error');
    }
  };

  const handleSubscriptionStatus = async (subId: number, status: string) => {
    try {
      await apiFetch(`/api/admin/subscriptions/${subId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      notify(`Assinatura atualizada para ${status}.`, 'success');
      await loadAllAdmin();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao atualizar assinatura.', 'error');
    }
  };

  const handleDispatchAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ task: AgentTask }>('/api/admin/agents/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          department: dispatchDept,
          title: dispatchTitle,
          requestedAction: dispatchAction,
          explicitApproval: dispatchApproval,
        }),
      });
      setDispatchTitle('');
      notify(
        res.task.status === 'awaiting_approval'
          ? `Trava financeira acionada: tarefa ${res.task.agentCode} aguardando aprovação humana!`
          : `Agente ${res.task.agentCode} concluiu a tarefa com auditoria.`,
        res.task.status === 'awaiting_approval' ? 'info' : 'success'
      );
      await loadAllAdmin();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao acionar agente.', 'error');
    }
  };

  const handleRunDailyFivePosts = async () => {
    try {
      const res = await apiFetch<{ created: EditorialPost[]; date: string }>(
        '/api/admin/posts/run-daily',
        { method: 'POST', body: JSON.stringify({}) }
      );
      notify(
        `Lote editorial do dia ${res.date}: ${res.created.length} novas publicações únicas geradas.`,
        'success'
      );
      await loadAllAdmin();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro no lote diário.', 'error');
    }
  };

  const handleCreateManualPost = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/posts', {
        method: 'POST',
        body: JSON.stringify({
          title: postTitle,
          category: postCategory,
          body: postBody,
          coverImage: postCover,
          riskTier: 'commercial_review',
        }),
      });
      setPostTitle('');
      setPostBody('');
      notify('Post criado na fila editorial (verificado contra duplicidade)!', 'success');
      await loadAllAdmin();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Bloqueado pela anti-duplicidade.', 'error');
    }
  };

  const handlePostStatus = async (id: number, status: 'published' | 'rejected') => {
    try {
      await apiFetch(`/api/admin/posts/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      notify(`Publicação marcada como ${status}.`, 'success');
      await loadAllAdmin();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao atualizar publicação.', 'error');
    }
  };

  const handleSaveSubAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/permissions', {
        method: 'POST',
        body: JSON.stringify({
          email: subEmail,
          label: subLabel,
          permissions: subPerms,
        }),
      });
      setSubEmail('');
      notify('Permissões de sub-administrador salvas com auditoria!', 'success');
      await loadAllAdmin();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar permissões.', 'error');
    }
  };

  const sendConciergeProposal = async (id: number) => {
    const draft = proposalDraft[id];
    if (!draft?.summary) return;
    try {
      await apiFetch(`/api/admin/concierge/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'proposal_sent',
          proposalSummary: draft.summary,
          proposalAmountBrl: Number(draft.amount || 0),
        }),
      });
      notify('Proposta enviada ao turista.', 'success');
      await loadAllAdmin();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao enviar proposta.', 'error');
    }
  };

  const handleCreatePopup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/popups', {
        method: 'POST',
        body: JSON.stringify({
          title: newPopTitle,
          description: newPopDesc,
          ctaLabel: newPopCta,
          category: newPopCat,
          targetAction: newPopAction,
          visualVariant: newPopVariant,
          durationMs: Number(newPopDuration) || 6000,
        }),
      });
      setNewPopTitle('');
      setNewPopDesc('');
      notify('Novo modelo de pop-up cadastrado e auditado!', 'success');
      await loadAllAdmin();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao criar pop-up.', 'error');
    }
  };

  const handleTogglePopup = async (p: PopupTemplate, changes: Partial<PopupTemplate>) => {
    try {
      await apiFetch(`/api/admin/popups/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      });
      notify(`Pop-up ${p.code} atualizado.`, 'success');
      await loadAllAdmin();
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao atualizar pop-up.', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[85] bg-black/65 backdrop-blur-xs overflow-y-auto p-4 md:p-8 flex justify-center items-start">
      <div className="w-full max-w-6xl bg-[#FFFFFF] rounded-2xl border-2 border-[#111111] shadow-2xl overflow-hidden my-4 froc-animate-modal">
        <FuturisticModalHeader
          title={`Centro de Comando — Administrador ${dbUser?.role === 'admin' ? 'Master' : 'Delegado'}`}
          subtitle={`${dbUser?.email || ''} · Governança RBAC, Motor Financeiro, 200 Agentes IA, Pop-ups & Chat`}
          icon={<Shield className="w-5 h-5" />}
          onBack={onClose}
          onClose={onClose}
          actions={
            hasAdminPermission('chat') ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenChat();
                }}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl froc-btn-gold text-xs font-extrabold"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Caixa de Chat Ao Vivo</span>
              </button>
            ) : undefined
          }
        />

        {!data ? (
          <div className="p-10 text-center text-sm font-bold text-[#111111]/70">
            Carregando governança...
          </div>
        ) : (
          <div className="p-6 md:p-8 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-2xl bg-[#FFFFFF] border border-[#111111]/20">
                <div className="text-xs font-bold text-[#111111]/65">GMV Confirmado</div>
                <div className="text-xl font-extrabold font-mono-tabular mt-1 text-[#111111]">
                  {formatMoney(data.metrics.gmvCents, currency)}
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-[#111111] text-[#FFFFFF] border border-[#39FF14]">
                <div className="text-xs font-bold text-[#39FF14]">Receita Comissões</div>
                <div className="text-xl font-extrabold font-mono-tabular mt-1">
                  {formatMoney(data.metrics.commissionRevenueCents, currency)}
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-[#FFFFFF] border border-[#111111]/20">
                <div className="text-xs font-bold text-[#111111]/65">Parceiros / Ofertas</div>
                <div className="text-xl font-extrabold font-mono-tabular mt-1 text-[#111111]">
                  {data.metrics.merchantsCount} / {data.metrics.listingsCount}
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-[#FFFFFF] border border-[#FFD700]">
                <div className="text-xs font-bold text-[#111111]/65">Agentes Ativos / Usuários</div>
                <div className="text-xl font-extrabold font-mono-tabular mt-1 text-[#111111]">
                  {agentsData?.summary.totalAgents ?? 200} IA · {data.metrics.usersCount} usr
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 border-b border-[#111111]/15 pb-4">
              {[
                { id: 'merchants', label: 'Parceiros', show: hasAdminPermission('merchants') },
                { id: 'radar', label: '📡 Radar de Parceiros', show: hasAdminPermission('merchants') },
                {
                  id: 'trust',
                  label: '🛡️ Verificações & Relatórios IA',
                  show: hasAdminPermission('security') || hasAdminPermission('agents') || hasAdminPermission('merchants'),
                },
                { id: 'finance', label: 'Motor Financeiro & Planos', show: hasAdminPermission('finance') },
                { id: 'agents', label: '🤖 200 Agentes IA', show: hasAdminPermission('agents') },
                { id: 'editorial', label: `📰 5 Posts Diários (${posts.length})`, show: hasAdminPermission('editorial') },
                { id: 'popups', label: `📣 Pop-ups (${popups.length})`, show: hasAdminPermission('editorial') },
                { id: 'concierge', label: `Concierge (${data.conciergeRequests.length})`, show: hasAdminPermission('overview') },
                { id: 'subadmins', label: 'Sub-Admins RBAC', show: dbUser?.role === 'admin' },
                { id: 'integrations', label: 'Integrações', show: hasAdminPermission('integrations') },
                { id: 'audit', label: '🔐 Auditoria & Segurança', show: hasAdminPermission('security') },
              ]
                .filter((x) => x.show)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id as typeof tab)}
                    className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                      tab === t.id
                        ? 'bg-[#111111] text-[#39FF14] border border-[#111111]'
                        : 'bg-[#FFFFFF] border border-[#111111]/20 text-[#111111]/75 hover:border-[#111111]'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
            </div>

            {tab === 'merchants' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-3">
                  <h3 className="text-sm font-semibold text-[#111111]">
                    Anunciantes, Fornecedores &amp; Cadastur
                  </h3>
                  {data.merchants.map((m) => (
                    <div
                      key={m.id}
                      className="p-4 rounded-xl border border-[#111111]/15 flex flex-wrap items-center justify-between gap-4 text-xs"
                    >
                      <div>
                        <div className="text-sm font-semibold text-[#111111]">
                          {m.tradeName} ({m.companyName})
                        </div>
                        <div className="text-[#111111]/70 mt-0.5">
                          Doc: {m.documentNumber} · Cadastur: {m.cadasturNumber || 'N/I'} ·
                          Status: <strong>{m.verificationStatus}</strong>
                          {m.verificationReason ? <> · {m.verificationReason}</> : null}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => verifyMerchant(m.id, 'verified')}
                          className="px-3 py-1.5 rounded-lg bg-[#111111] text-[#39FF14] font-semibold"
                        >
                          Aprovar
                        </button>
                        <button
                          type="button"
                          onClick={() => verifyMerchant(m.id, 'rejected')}
                          className="px-3 py-1.5 rounded-lg border border-[#FECACA] text-[#991B1B] font-semibold"
                        >
                          Rejeitar
                        </button>
                        <button
                          type="button"
                          onClick={() => verifyMerchant(m.id, 'ai')}
                          className="px-3 py-1.5 rounded-lg border border-[#111111]/25 font-semibold"
                        >
                          Verificar com IA
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

              </div>
            )}

            {tab === 'trust' && <AdminTrustPanel />}

            {tab === 'radar' && <AdminRadarPanel />}

            {tab === 'finance' && finance && (
              <div className="space-y-6">
                {/* Live Calculator */}
                <div className="p-4 rounded-xl bg-white border border-[#111111]/15 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-[#111111] flex items-center gap-2">
                      <Calculator className="w-4 h-4 text-[#111111]" />
                      <span>Simulador Configurável do Motor Financeiro</span>
                    </div>
                    <div className="flex gap-2 text-xs">
                      <select
                        value={simCategory}
                        onChange={(e) => {
                          setSimCategory(e.target.value);
                          setSimCostBrl(e.target.value === 'accommodation' ? '100' : '1000');
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-[#111111]/15 bg-white"
                      >
                        <option value="flights">Passagens (+R$ 200)</option>
                        <option value="accommodation">Hospedagem (+R$ 50)</option>
                        <option value="experience">Passeios / Serviços (12%)</option>
                      </select>
                      <input
                        type="number"
                        value={simCostBrl}
                        onChange={(e) => setSimCostBrl(e.target.value)}
                        className="w-24 px-2.5 py-1.5 rounded-lg border border-[#111111]/15 bg-white font-mono-tabular"
                      />
                    </div>
                  </div>
                  {simResult && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs font-mono-tabular">
                      <div className="p-2.5 rounded-lg bg-white border border-[#111111]/15">
                        <span className="text-[#111111]/70 block">Fornecedor</span>
                        <strong>{formatMoney(simResult.supplierCostCents, currency)}</strong>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-[#111111]/15">
                        <span className="text-[#111111]/70 block">Taxa Froc Rota</span>
                        <strong className="text-[#111111]">
                          +{formatMoney(simResult.platformRemunerationCents, currency)}
                        </strong>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-[#111111]/15">
                        <span className="text-[#111111]/70 block">Preço Final Cliente</span>
                        <strong>{formatMoney(simResult.finalClientCents, currency)}</strong>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-[#111111]/15">
                        <span className="text-[#111111]/70 block">Gateway + Tributos Est.</span>
                        <strong>
                          {formatMoney(simResult.paymentFeeCents + simResult.taxCents, currency)}
                        </strong>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-[#111111]/15">
                        <span className="text-[#111111]/70 block">Margem Líquida Est.</span>
                        <strong className="text-[#111111]">
                          {formatMoney(simResult.estimatedMarginCents, currency)}
                        </strong>
                      </div>
                    </div>
                  )}
                </div>

                {/* Rules & Create Rule */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-[#111111]">
                      Regras de Precificação Ativas ({finance.rules.length})
                    </h4>
                    <form
                      onSubmit={handleCreateRule}
                      className="p-3.5 rounded-xl border border-[#111111]/15 grid grid-cols-2 gap-2 text-xs"
                    >
                      <input
                        required
                        value={ruleName}
                        onChange={(e) => setRuleName(e.target.value)}
                        placeholder="Nome da regra"
                        className="col-span-2 px-3 py-1.5 rounded-lg border border-[#111111]/15"
                      />
                      <select
                        value={ruleCat}
                        onChange={(e) => setRuleCat(e.target.value)}
                        className="px-2 py-1.5 rounded-lg border border-[#111111]/15 bg-white"
                      >
                        <option value="flights">flights</option>
                        <option value="accommodation">accommodation</option>
                        <option value="experience">experience</option>
                        <option value="concierge">concierge</option>
                      </select>
                      <select
                        value={ruleType}
                        onChange={(e) => setRuleType(e.target.value as typeof ruleType)}
                        className="px-2 py-1.5 rounded-lg border border-[#111111]/15 bg-white"
                      >
                        <option value="fixed">Valor Fixo (R$)</option>
                        <option value="percent">Percentual (%)</option>
                        <option value="hybrid">Híbrido (R$ + %)</option>
                      </select>
                      <input
                        type="number"
                        value={ruleFixedBrl}
                        onChange={(e) => setRuleFixedBrl(e.target.value)}
                        placeholder="Fixo R$"
                        className="px-2 py-1.5 rounded-lg border border-[#111111]/15 font-mono-tabular"
                      />
                      <input
                        type="number"
                        value={rulePercent}
                        onChange={(e) => setRulePercent(e.target.value)}
                        placeholder="Percent %"
                        className="px-2 py-1.5 rounded-lg border border-[#111111]/15 font-mono-tabular"
                      />
                      <button
                        type="submit"
                        className="col-span-2 py-2 rounded-lg bg-[#111111] text-[#39FF14] font-semibold"
                      >
                        Salvar Nova Regra
                      </button>
                    </form>

                    {finance.rules.map((r) => (
                      <div
                        key={r.id}
                        className="p-3 rounded-lg border border-[#111111]/15 text-xs flex justify-between"
                      >
                        <div>
                          <div className="font-semibold">
                            {r.name} ({r.category})
                          </div>
                          <div className="text-[#111111]/70 font-mono-tabular">
                            {r.ruleCode} · {r.markupType} · Fixo R${' '}
                            {(r.markupFixedCents / 100).toFixed(0)} + {(r.markupBps / 100).toFixed(1)}%
                          </div>
                        </div>
                        <span className={r.active ? 'text-[#111111] font-semibold' : 'text-[#991B1B]'}>
                          {r.active ? 'Ativa' : 'Inativa'}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Ledger & Subscriptions */}
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-semibold text-[#111111] mb-2">
                        Assinaturas Comerciais ({finance.subscriptions.length})
                      </h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {finance.subscriptions.map(({ subscription, merchantName, planName }) => (
                          <div
                            key={subscription.id}
                            className="p-3 rounded-lg border border-[#111111]/15 flex flex-wrap justify-between items-center gap-2 text-xs"
                          >
                            <span>
                              <strong>{merchantName}</strong> · {planName} · {subscription.status}
                            </span>
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleSubscriptionStatus(subscription.id, 'courtesy')}
                                className="px-2 py-1 rounded bg-[#ECFDF5] text-[#065F46] font-semibold"
                              >
                                Cortesia 30d
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSubscriptionStatus(subscription.id, 'suspended')}
                                className="px-2 py-1 rounded bg-[#FFF5F5] text-[#991B1B] font-semibold"
                              >
                                Suspender
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-[#111111] mb-2">
                        Razão Financeiro Imutável ({finance.ledger.length})
                      </h4>
                      <div className="space-y-1.5 max-h-56 overflow-y-auto">
                        {finance.ledger.map((e) => (
                          <div
                            key={e.id}
                            className="p-2.5 rounded-lg border border-[#111111]/15 text-[11px] font-mono-tabular flex justify-between"
                          >
                            <span>
                              <strong>{e.referenceCode}</strong> · {e.operationType} ({e.ruleCode})
                            </span>
                            <span>
                              Cliente {formatMoney(e.finalClientCents, currency)} · Froc{' '}
                              {formatMoney(e.platformRemunerationCents, currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'agents' && agentsData && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-white border border-[#111111]/15">
                    <span className="text-[#111111]/70">Agentes Especialistas</span>
                    <div className="text-lg font-semibold font-mono-tabular">
                      {agentsData.summary.totalAgents}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white border border-[#111111]/15">
                    <span className="text-[#111111]/70">Ociosos / Executando</span>
                    <div className="text-lg font-semibold font-mono-tabular">
                      {agentsData.summary.idleCount} / {agentsData.summary.runningCount}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white border border-[#111111]/15">
                    <span className="text-[#111111]/70">Aguardando / Erros</span>
                    <div className="text-lg font-semibold font-mono-tabular">
                      {agentsData.summary.waitingCount} / {agentsData.summary.errorAgentsCount}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white border border-[#111111]/15">
                    <span className="text-[#111111]/70">Tarefas Concluídas</span>
                    <div className="text-lg font-semibold font-mono-tabular text-[#111111]">
                      {agentsData.summary.totalTasksCompleted}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white border border-[#111111]/15">
                    <span className="text-[#111111]/70">Custo IA Acumulado</span>
                    <div className="text-lg font-semibold font-mono-tabular">
                      ${agentsData.summary.totalAiCostUsd}
                    </div>
                  </div>
                </div>

                {/* Orchestrator Dispatcher + Financial Lock Demo */}
                <form
                  onSubmit={handleDispatchAgent}
                  className="p-4 rounded-xl bg-white border border-[#111111]/15 grid grid-cols-1 md:grid-cols-5 gap-3 items-end text-xs"
                >
                  <div>
                    <label className="block font-semibold mb-1">Departamento</label>
                    <select
                      value={dispatchDept}
                      onChange={(e) => setDispatchDept(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-lg border border-[#111111]/15 bg-white"
                    >
                      {[
                        'Destinos e Cultura',
                        'Marketing e SEO',
                        'Anunciantes e Anúncios',
                        'Voos e Oportunidades',
                        'Hospedagens',
                        'Passeios e Experiências',
                        'Atendimento e Chat',
                        'Reservas e Operações',
                        'Financeiro',
                        'Segurança e Auditoria',
                        'Internacionalização',
                        'Administração e Inteligência',
                      ].map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block font-semibold mb-1">Tarefa ao Orquestrador</label>
                    <input
                      required
                      value={dispatchTitle}
                      onChange={(e) => setDispatchTitle(e.target.value)}
                      placeholder="Ex: Auditar tarifas madrugada ou sugerir otimização"
                      className="w-full px-3 py-2 rounded-lg border border-[#111111]/15 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Ação Solicitada</label>
                    <select
                      value={dispatchAction}
                      onChange={(e) => setDispatchAction(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-lg border border-[#111111]/15 bg-white"
                    >
                      <option value="analyze_radar">Análise / Recomendação (Segura)</option>
                      <option value="execute_payment">Executar Pagamento (Requer Trava)</option>
                      <option value="issue_flight_ticket">Emitir Passagem (Requer Trava)</option>
                      <option value="cancel_booking">Cancelar Reserva (Requer Trava)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={dispatchApproval}
                        onChange={(e) => setDispatchApproval(e.target.checked)}
                      />
                      <span>Aprovação humana explícita</span>
                    </label>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-[#111111] text-[#39FF14] font-semibold"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Acionar Agente</span>
                    </button>
                  </div>
                </form>

                {/* Filter + Grid */}
                <div className="flex items-center justify-between gap-4">
                  <h4 className="text-sm font-semibold text-[#111111] flex items-center gap-2">
                    <Bot className="w-4 h-4 text-[#111111]" />
                    <span>Corpo de 200 Agentes por Departamento</span>
                  </h4>
                  <select
                    value={agentDeptFilter}
                    onChange={(e) => setAgentDeptFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-lg border border-[#111111]/15 text-xs bg-white"
                  >
                    <option value="all">Todos os 12 Departamentos (200)</option>
                    {Object.keys(agentsData.summary.departmentBreakdown).map((dept) => (
                      <option key={dept} value={dept}>
                        {dept} ({agentsData.summary.departmentBreakdown[dept]})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto">
                  {agentsData.agents.map((a) => (
                    <div
                      key={a.id}
                      className="p-3 rounded-lg border border-[#111111]/15 text-xs space-y-1"
                    >
                      <div className="flex justify-between font-mono-tabular">
                        <strong className="text-[#111111]">{a.code}</strong>
                        <span>
                          {a.state} · {a.tasksCompleted} ok
                        </span>
                      </div>
                      <div className="font-semibold text-[#111111]">{a.name}</div>
                      <div className="text-[11px] text-[#111111]/70">{a.department}</div>
                    </div>
                  ))}
                </div>

                {agentsData.recentTasks.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-semibold text-[#111111]/70">
                      Últimas Execuções &amp; Travas Auditadas
                    </h4>
                    {agentsData.recentTasks.slice(0, 8).map((tk) => (
                      <div
                        key={tk.id}
                        className="p-2.5 rounded-lg border border-[#111111]/15 flex justify-between text-xs font-mono-tabular"
                      >
                        <span>
                          <strong>{tk.agentCode}</strong> · {tk.title}
                        </span>
                        <span
                          className={
                            tk.status === 'awaiting_approval' ? 'text-[#92400E] font-bold' : 'text-[#111111]'
                          }
                        >
                          {tk.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'editorial' && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-white border border-[#111111]/15">
                  <div>
                    <h4 className="text-sm font-semibold text-[#111111] flex items-center gap-2">
                      <Newspaper className="w-4 h-4 text-[#111111]" />
                      <span>Motor Editorial Diário — 5 Publicações Originais / Dia</span>
                    </h4>
                    <p className="text-xs text-[#111111]/70 mt-0.5">
                      Garante hash SHA-256 único, similaridade máxima Jaccard &lt; 0,65 e zero repetição de fotos no mesmo dia.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRunDailyFivePosts}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Completar 5 Posts de Hoje</span>
                  </button>
                </div>

                <form
                  onSubmit={handleCreateManualPost}
                  className="p-4 rounded-xl border border-[#111111]/15 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs"
                >
                  <input
                    required
                    value={postTitle}
                    onChange={(e) => setPostTitle(e.target.value)}
                    placeholder="Título inédito da publicação"
                    className="px-3 py-2 rounded-lg border border-[#111111]/15"
                  />
                  <input
                    required
                    value={postCategory}
                    onChange={(e) => setPostCategory(e.target.value)}
                    placeholder="Categoria editorial"
                    className="px-3 py-2 rounded-lg border border-[#111111]/15"
                  />
                  <input
                    required
                    value={postCover}
                    onChange={(e) => setPostCover(e.target.value)}
                    placeholder="Imagem licenciada (/src/assets/images/...)"
                    className="px-3 py-2 rounded-lg border border-[#111111]/15"
                  />
                  <textarea
                    required
                    rows={2}
                    value={postBody}
                    onChange={(e) => setPostBody(e.target.value)}
                    placeholder="Corpo original do artigo..."
                    className="md:col-span-2 px-3 py-2 rounded-lg border border-[#111111]/15"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-[#D9A441] text-[#111111] font-semibold"
                  >
                    Testar Anti-Duplicidade &amp; Enviar à Fila
                  </button>
                </form>

                <div className="space-y-2.5">
                  {posts.map((p) => (
                    <div
                      key={p.id}
                      className="p-4 rounded-xl border border-[#111111]/15 flex flex-wrap items-center justify-between gap-4 text-xs"
                    >
                      <div>
                        <div className="font-mono-tabular text-[#111111]/70">
                          {p.publishDate} · {p.category} · {p.riskTier} · Status:{' '}
                          <strong>{p.status}</strong>
                        </div>
                        <div className="text-sm font-semibold text-[#111111] mt-0.5">{p.title}</div>
                      </div>
                      <div className="flex gap-2">
                        {p.status !== 'published' && (
                          <button
                            type="button"
                            onClick={() => handlePostStatus(p.id, 'published')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#111111] text-[#39FF14] font-semibold"
                          >
                            <FileCheck2 className="w-3.5 h-3.5" />
                            <span>Aprovar &amp; Publicar</span>
                          </button>
                        )}
                        {p.status !== 'rejected' && (
                          <button
                            type="button"
                            onClick={() => handlePostStatus(p.id, 'rejected')}
                            className="px-3 py-1.5 rounded-lg border border-[#FECACA] text-[#991B1B] font-semibold"
                          >
                            Reprovar
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'popups' && (
              <div className="space-y-6">
                <div className="p-4 rounded-2xl bg-[#111111] text-white border-2 border-[#FF1493] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold flex items-center gap-2 text-[#FFD700]">
                      <Sparkles className="w-4 h-4" />
                      <span>Biblioteca de Pop-ups Promocionais ({popups.length} modelos)</span>
                    </h4>
                    <p className="text-xs text-white/80 mt-0.5">
                      Exibição de 6 segundos · intervalo inteligente de 3 a 7 minutos entre pop-ups · 1 por vez com fechar (X) e opt-out.
                    </p>
                  </div>
                  <select
                    value={popupCatFilter}
                    onChange={(e) => setPopupCatFilter(e.target.value)}
                    className="min-h-[40px] px-3 py-1.5 rounded-xl bg-white text-[#111111] text-xs font-bold"
                  >
                    <option value="all">Todas as categorias ({popups.length})</option>
                    {popupCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <form
                  onSubmit={handleCreatePopup}
                  className="p-4 rounded-2xl border border-[#111111]/20 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs bg-[#FFFFFF]"
                >
                  <input
                    required
                    value={newPopTitle}
                    onChange={(e) => setNewPopTitle(e.target.value)}
                    placeholder="Título do novo modelo de pop-up"
                    className="px-3 py-2 rounded-xl border border-[#111111]/25"
                  />
                  <select
                    value={newPopCat}
                    onChange={(e) => setNewPopCat(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-[#111111]/25 bg-white"
                  >
                    {(popupCategories.length ? popupCategories : ['Novidades', 'Eventos']).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={newPopVariant}
                    onChange={(e) => setNewPopVariant(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-[#111111]/25 bg-white"
                  >
                    <option value="neon-emerald">Neon Verde (#39FF14)</option>
                    <option value="pink-pulse">Rosa Pink (#FF1493)</option>
                    <option value="gold-luxury">Dourado Ouro (#FFD700)</option>
                    <option value="obsidian-neon">Obsidian + Neon</option>
                    <option value="prism-tropical">Prisma Tropical</option>
                  </select>
                  <input
                    required
                    value={newPopDesc}
                    onChange={(e) => setNewPopDesc(e.target.value)}
                    placeholder="Descrição objetiva sem números fictícios..."
                    className="md:col-span-2 px-3 py-2 rounded-xl border border-[#111111]/25"
                  />
                  <div className="flex gap-2">
                    <input
                      required
                      value={newPopCta}
                      onChange={(e) => setNewPopCta(e.target.value)}
                      placeholder="CTA"
                      className="w-24 px-2.5 py-2 rounded-xl border border-[#111111]/25"
                    />
                    <input
                      type="number"
                      min={2000}
                      max={12000}
                      value={newPopDuration}
                      onChange={(e) => setNewPopDuration(e.target.value)}
                      placeholder="ms"
                      className="w-20 px-2.5 py-2 rounded-xl border border-[#111111]/25 font-mono-tabular"
                    />
                    <button
                      type="submit"
                      className="flex-1 px-3 py-2 rounded-xl froc-btn-neon font-bold"
                    >
                      Criar Pop-up
                    </button>
                  </div>
                </form>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                  {popups
                    .filter((p) => popupCatFilter === 'all' || p.category === popupCatFilter)
                    .map((p) => (
                      <div
                        key={p.id}
                        className="p-3.5 rounded-xl border border-[#111111]/20 bg-white text-xs space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono-tabular font-bold text-[#111111]">
                            {p.emoji} {p.code} · {p.category}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              p.active
                                ? 'bg-[#39FF14] text-[#111111]'
                                : 'bg-[#FF1493]/15 text-[#FF1493]'
                            }`}
                          >
                            {p.active ? 'Ativo' : 'Pausado'}
                          </span>
                        </div>
                        <div className="font-bold text-sm text-[#111111]">{p.title}</div>
                        <p className="text-[#111111]/75 line-clamp-2">{p.description}</p>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#111111]/10">
                          <span className="font-mono-tabular text-[11px] text-[#111111]/65">
                            {p.durationMs}ms · prio {p.priority} · {p.validUntil}
                          </span>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleTogglePopup(p, { durationMs: p.durationMs === 6000 ? 8000 : 6000 })}
                              className="px-2 py-1 rounded border border-[#111111]/25 font-semibold hover:bg-[#FFD700]/30"
                            >
                              {p.durationMs === 6000 ? '8.0s' : '6.0s'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleTogglePopup(p, { active: !p.active })}
                              className={`px-2.5 py-1 rounded font-bold ${
                                p.active
                                  ? 'border border-[#FF1493] text-[#FF1493]'
                                  : 'bg-[#39FF14] text-[#111111]'
                              }`}
                            >
                              {p.active ? 'Pausar' : 'Ativar'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {tab === 'concierge' && (
              <div className="space-y-4">
                {data.conciergeRequests.map((c) => (
                  <div key={c.id} className="p-4 rounded-xl border border-[#111111]/15 text-xs space-y-3">
                    <div className="flex justify-between font-semibold text-sm">
                      <span>
                        {c.requestCode} — {c.originCity} → {c.destinationPref}
                      </span>
                      <span className="font-mono-tabular">
                        Orçamento: {formatMoney(c.budgetCents, currency)} · {c.status}
                      </span>
                    </div>
                    <p className="text-[#111111]/70">
                      {c.startDate} a {c.endDate} · {c.travelersCount} viajantes · {c.tripStyle}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        placeholder="Resumo da proposta completa..."
                        value={proposalDraft[c.id]?.summary ?? c.proposalSummary ?? ''}
                        onChange={(e) =>
                          setProposalDraft((prev) => ({
                            ...prev,
                            [c.id]: {
                              summary: e.target.value,
                              amount: prev[c.id]?.amount ?? '',
                            },
                          }))
                        }
                        className="flex-1 px-3 py-2 rounded-lg border border-[#111111]/15"
                      />
                      <input
                        type="number"
                        placeholder="Valor R$"
                        value={proposalDraft[c.id]?.amount ?? ''}
                        onChange={(e) =>
                          setProposalDraft((prev) => ({
                            ...prev,
                            [c.id]: {
                              summary: prev[c.id]?.summary ?? '',
                              amount: e.target.value,
                            },
                          }))
                        }
                        className="w-28 px-3 py-2 rounded-lg border border-[#111111]/15 font-mono-tabular"
                      />
                      <button
                        type="button"
                        onClick={() => sendConciergeProposal(c.id)}
                        className="px-4 py-2 rounded-lg bg-[#111111] text-[#39FF14] font-semibold"
                      >
                        Enviar Proposta
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'subadmins' && dbUser?.role === 'admin' && (
              <div className="space-y-6">
                <form
                  onSubmit={handleSaveSubAdmin}
                  className="p-4 rounded-xl bg-white border border-[#111111]/15 space-y-3 text-xs"
                >
                  <div className="font-semibold text-sm text-[#111111] flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#111111]" />
                    <span>Delegar Sub-Administrador Secundário (Apenas Master)</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      required
                      type="email"
                      value={subEmail}
                      onChange={(e) => setSubEmail(e.target.value)}
                      placeholder="E-mail Google do sub-administrador"
                      className="px-3 py-2 rounded-lg border border-[#111111]/15 bg-white"
                    />
                    <input
                      required
                      value={subLabel}
                      onChange={(e) => setSubLabel(e.target.value)}
                      placeholder="Cargo / Função"
                      className="px-3 py-2 rounded-lg border border-[#111111]/15 bg-white"
                    />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {ALL_SUBADMIN_PERMS.map((p) => (
                      <label key={p} className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={subPerms.includes(p)}
                          onChange={(e) =>
                            setSubPerms((prev) =>
                              e.target.checked ? [...prev, p] : prev.filter((x) => x !== p)
                            )
                          }
                        />
                        <span>{p}</span>
                      </label>
                    ))}
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-[#111111] text-[#39FF14] font-semibold"
                  >
                    Conceder Permissões RBAC
                  </button>
                </form>

                <div className="space-y-2">
                  {subAdmins.map((sa) => (
                    <div
                      key={sa.id}
                      className="p-3.5 rounded-xl border border-[#111111]/15 flex flex-wrap justify-between text-xs"
                    >
                      <div>
                        <strong>{sa.email}</strong> ({sa.label})
                      </div>
                      <div className="font-mono-tabular text-[#111111]">
                        {sa.permissionsJson.join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'integrations' && integrations && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {integrations.travel.map((i) => (
                    <div key={i.provider} className="p-4 rounded-xl border border-[#111111]/15">
                      <div className="flex justify-between font-semibold">
                        <span>{i.provider}</span>
                        <span className={i.configured ? 'text-[#111111]' : 'text-[#92400E]'}>
                          {i.configured ? 'Conectado' : 'Aguardando credenciais'}
                        </span>
                      </div>
                      <p className="text-[#111111]/70 mt-1">{i.notes}</p>
                    </div>
                  ))}
                  <div className="p-4 rounded-xl border border-[#111111]/15">
                    <div className="flex justify-between font-semibold">
                      <span>Google Business Profile OAuth</span>
                      <span className={integrations.googleBusinessOAuth.configured ? 'text-[#111111]' : 'text-[#92400E]'}>
                        {integrations.googleBusinessOAuth.configured ? 'Configurado' : 'Aguardando credenciais'}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono-tabular text-[#111111]/70 mt-1 break-all">
                      Callback: {integrations.googleBusinessOAuth.redirectUri}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl border border-[#111111]/15 space-y-1">
                    <div className="flex justify-between font-semibold">
                      <span>Mercado Pago (Gateway Único + OAuth Seller)</span>
                      <span className={integrations.payments.mercadopago.configured ? 'text-[#111111]' : 'text-[#92400E]'}>
                        {integrations.payments.mercadopago.configured
                          ? 'Produção (Token Ativo)'
                          : 'Modo Sandbox Server-Verified'}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono-tabular text-[#111111]/70 break-all">
                      Public Key: {integrations.payments.mercadopago.publicKeyConfigured ? 'Configurada' : 'Pendente'} · Webhook HMAC:{' '}
                      {integrations.payments.mercadopago.webhookSecretConfigured ? 'Ativo' : 'Pendente'}
                    </p>
                    <p className="text-[11px] font-mono-tabular text-[#111111]/70 break-all">
                      Callback OAuth: {integrations.mercadoPagoOAuth.redirectUri}
                    </p>
                  </div>
                </div>

                {/* Motor Anti-Quedas Gemini & Escudo de Segurança */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 rounded-2xl border-2 border-[#111111] bg-white space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-bold">
                        <Sparkles className="w-4 h-4 text-[#FF1493]" />
                        <span>Motor Anti-Quedas Gemini (Failover & Circuit Breaker)</span>
                      </div>
                      {hasAdminPermission('security') && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await apiFetch('/api/admin/security/reset-ai-circuit', { method: 'POST' });
                              notify('Circuit breakers Gemini reiniciados com sucesso.', 'success');
                              loadAllAdmin();
                            } catch (err) {
                              notify(
                                err instanceof Error ? err.message : 'Erro ao reiniciar circuitos.',
                                'error'
                              );
                            }
                          }}
                          className="px-2.5 py-1 rounded-lg bg-[#111111] text-[#39FF14] font-semibold hover:opacity-90"
                        >
                          Resetar Circuitos
                        </button>
                      )}
                    </div>
                    <p className="text-[#111111]/75 font-mono-tabular text-[11px]">
                      SDK: {integrations.ai.sdkCompatLine || '@google/genai 3.6+'} · Rotas saudáveis:{' '}
                      {integrations.ai.healthyRoutesCount ?? 0}/{integrations.ai.totalRoutesCount ?? 0} · Failovers:{' '}
                      {integrations.ai.totalFailovers ?? 0} · Chave Backup:{' '}
                      {integrations.ai.backupKeyConfigured ? 'Ativa' : 'Opcional (pendente)'}
                    </p>
                    <div className="space-y-1.5">
                      {(integrations.ai.routes || []).map((r) => (
                        <div
                          key={r.routeId}
                          className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#111111]/5 font-mono-tabular text-[11px]"
                        >
                          <span>
                            <strong>{r.model}</strong> ({r.keySlot})
                          </span>
                          <span>
                            {r.state} · OK {r.totalSuccesses} / Err {r.totalFailures}
                            {r.lastLatencyMs !== null ? ` · ${r.lastLatencyMs}ms` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {integrations.security && (
                    <div className="p-4 rounded-2xl border-2 border-[#111111] bg-white space-y-2.5">
                      <div className="flex items-center gap-2 font-bold">
                        <Shield className="w-4 h-4 text-[#39FF14]" />
                        <span>Sistema de Segurança Robusto (Camadas Ativas)</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono-tabular">
                        <div className="p-2 rounded-lg bg-[#111111]/5">
                          Headers + no-store: {integrations.security.httpsStrictHeaders ? 'Ativo' : 'Off'}
                        </div>
                        <div className="p-2 rounded-lg bg-[#111111]/5">
                          CORS Allowlist: {integrations.security.strictCorsOriginAllowlist ? 'Ativo' : 'Off'}
                        </div>
                        <div className="p-2 rounded-lg bg-[#111111]/5">
                          Sanitizador NoSQL/Proto: {integrations.security.prototypeAndNoSqlSanitizer ? 'Ativo' : 'Off'}
                        </div>
                        <div className="p-2 rounded-lg bg-[#111111]/5">
                          Filtro SSRF & XSS URL: {integrations.security.ssrfUrlFilter ? 'Ativo' : 'Off'}
                        </div>
                        <div className="p-2 rounded-lg bg-[#111111]/5">
                          Guard Prompt IA: {integrations.security.aiPromptInjectionGuard ? 'Ativo' : 'Off'}
                        </div>
                        <div className="p-2 rounded-lg bg-[#111111]/5">
                          Webhook Replay Guard: {integrations.security.webhookHmacAndReplayWindowSec}s
                        </div>
                        <div className="p-2 rounded-lg bg-[#111111]/5">
                          RBAC E-mail Verificado: {integrations.security.rbacVerifiedEmailRequired ? 'Ativo' : 'Off'}
                        </div>
                        <div className="p-2 rounded-lg bg-[#111111]/5">
                          Limite JSON Body: {Math.round(integrations.security.maxJsonBodyBytes / 1024)}KB
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'audit' && (
              <div className="space-y-4">
                <SecurityPinCard
                  title="Chave Mestra & Proteção RBAC Admin"
                  onSuccessMessage={(msg) => notify(msg, 'success')}
                />
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  <div className="p-3 rounded-xl bg-[#111111] text-[#39FF14] border border-[#111111] text-xs font-bold flex items-center gap-2">
                    <Lock className="w-4 h-4 text-[#FFD700]" />
                    <span>
                      Registro imutável de auditoria financeira, RBAC, OAuth, agentes IA, pop-ups e anti-duplicidade.
                    </span>
                  </div>
                  {data.auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 rounded-xl border border-[#111111]/20 bg-white flex flex-wrap justify-between gap-2 text-xs font-mono-tabular"
                    >
                      <span>
                        <strong>{log.action}</strong> · {log.entityType} #{log.entityId}
                      </span>
                      <span className="text-[#111111]/65">
                        {log.actorEmail || 'system'} · {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
