import crypto from 'node:crypto';
import { adminDb } from './firebase-admin.js';
import { nextSeqId } from './firestore-helpers.js';

export interface DepartmentSpec {
  key: string;
  label: string;
  quota: number;
  specialties: string[];
  tools: string[];
  accessScope: string;
}

export const AGENT_DEPARTMENTS: DepartmentSpec[] = [
  {
    key: 'destinos_cultura',
    label: 'Destinos e Cultura',
    quota: 25,
    specialties: [
      'Curadoria Regional Nordeste',
      'Mapeamento de Praias e Ilhas',
      'Roteiros de Cachoeiras e Parques',
      'Patrimônio Histórico e UNESCO',
      'Calendário de Festas Populares',
    ],
    tools: ['read_destinations', 'verify_seasonality', 'map_coordinates'],
    accessScope: 'read_destinations_public',
  },
  {
    key: 'marketing_seo',
    label: 'Marketing e SEO',
    quota: 25,
    specialties: [
      'Redação Editorial Anti-Duplicidade',
      'Otimização Schema.org e Meta Tags',
      'Copywriting de Conversão Turística',
      'Roteiros para Redes Sociais',
      'Auditoria de CTR de Campanhas',
    ],
    tools: ['generate_copy', 'check_content_hash', 'analyze_campaign_metrics'],
    accessScope: 'read_catalog_and_campaigns',
  },
  {
    key: 'anunciantes_anuncios',
    label: 'Anunciantes e Anúncios',
    quota: 20,
    specialties: [
      'Validação Documental Cadastur',
      'Qualidade de Galeria e Vídeos',
      'Sincronização Google Business Profile',
      'Monitoramento de Vencimento de Planos',
    ],
    tools: ['inspect_listing', 'check_gbp_sync', 'check_plan_expiry'],
    accessScope: 'read_merchants_and_listings',
  },
  {
    key: 'voos_oportunidades',
    label: 'Voos e Oportunidades',
    quota: 20,
    specialties: [
      'Radar de Tarifas de Madrugada',
      'Comparação GDS / NDC',
      'Monitor de Queda de Preço',
      'Conexões e Aeroportos Alternativos',
    ],
    tools: ['query_amadeus', 'evaluate_price_alerts', 'check_idempotency'],
    accessScope: 'read_flight_feeds_and_alerts',
  },
  {
    key: 'hospedagens',
    label: 'Hospedagens',
    quota: 15,
    specialties: [
      'Disponibilidade em Pousadas e Resorts',
      'Auditoria de Comodidades e Tarifas',
      'Conectividade de Distribuidores Externos',
    ],
    tools: ['query_accommodations', 'verify_room_availability'],
    accessScope: 'read_accommodations',
  },
  {
    key: 'passeios_experiencias',
    label: 'Passeios e Experiências',
    quota: 15,
    specialties: [
      'Segurança Náutica e Lanchas',
      'Trilhas e Guias Credenciados',
      'Políticas de Cancelamento Climático',
    ],
    tools: ['query_experiences', 'check_nautical_compliance'],
    accessScope: 'read_experiences',
  },
  {
    key: 'atendimento_chat',
    label: 'Atendimento e Chat',
    quota: 20,
    specialties: [
      'Triagem de Chat em Tempo Real',
      'Assistência Pré-Reserva ao Turista',
      'Escalonamento para Atendente Humano',
      'Suporte ao Anunciante',
    ],
    tools: ['read_chat_context', 'read_catalog_for_chat', 'escalate_to_human'],
    accessScope: 'scoped_conversation_only',
  },
  {
    key: 'reservas_operacoes',
    label: 'Reservas e Operações',
    quota: 15,
    specialties: [
      'Confirmação de Vagas e Check-in',
      'Emissão de Vouchers e Bilhetes',
      'Prevenção de Overbooking',
    ],
    tools: ['inspect_booking_slots', 'dispatch_voucher_email'],
    accessScope: 'read_bookings_status',
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    quota: 10,
    specialties: [
      'Simulação de Markup e Remuneração',
      'Conciliação Mercado Pago',
      'Auditoria de Margem Líquida',
    ],
    tools: ['calculate_pricing_rule', 'read_ledger_summary'],
    accessScope: 'read_pricing_rules_approval_required',
  },
  {
    key: 'seguranca_auditoria',
    label: 'Segurança e Auditoria',
    quota: 10,
    specialties: [
      'Detecção de Fraude e Duplicidade',
      'Monitoramento de Chaves de Idempotência',
      'Auditoria LGPD e Permissões RBAC',
    ],
    tools: ['inspect_audit_logs', 'flag_anomalies'],
    accessScope: 'read_security_telemetry',
  },
  {
    key: 'internacionalizacao',
    label: 'Internacionalização',
    quota: 10,
    specialties: [
      'Localização PT-BR / EN / ES',
      'Conversão Cambial Transparente',
      'Receptivo para Turistas Estrangeiros',
    ],
    tools: ['translate_content', 'format_currency'],
    accessScope: 'read_public_catalog',
  },
  {
    key: 'administracao_inteligencia',
    label: 'Administração e Inteligência',
    quota: 15,
    specialties: [
      'Orquestração Central dos 200 Agentes',
      'Indicadores Executivos em Tempo Real',
      'Controle de Custos de IA',
    ],
    tools: ['orchestrate_fleet', 'compile_kpi_snapshot'],
    accessScope: 'admin_oversight_only',
  },
];

export interface AiAgentDoc {
  id: number;
  code: string;
  name: string;
  department: string;
  specialty: string;
  objective: string;
  instructions: string;
  allowedToolsJson: string[];
  accessScope: string;
  supervisorEmail: string;
  state: 'idle' | 'running' | 'waiting' | 'error';
  tasksCompleted: number;
  errorCount: number;
  avgDurationMs: number;
  estimatedCostUsdMicro: number;
  requiresFinancialApproval: boolean;
  lastError: string | null;
  lastRunAt: string | null;
  updatedAt: string;
}

export interface AgentTaskDoc {
  id: number;
  taskCode: string;
  agentId: number;
  agentCode: string;
  triggerType: string;
  eventName: string;
  title: string;
  status: string;
  inputJson: Record<string, unknown>;
  resultSummary: string | null;
  errorMessage: string | null;
  durationMs: number;
  aiCostUsdMicro: number;
  createdAt: string;
  completedAt: string | null;
}

export const SENSITIVE_FINANCIAL_ACTIONS = new Set([
  'execute_payment',
  'issue_flight_ticket',
  'cancel_booking',
  'refund_payment',
  'change_payout',
]);

export function requiresHumanFinancialApproval(
  requestedAction?: string,
  explicitApproval?: boolean
): boolean {
  return Boolean(
    requestedAction && SENSITIVE_FINANCIAL_ACTIONS.has(requestedAction) && !explicitApproval
  );
}

export function build200AgentSpecs(): AiAgentDoc[] {
  const now = new Date().toISOString();
  const records: AiAgentDoc[] = [];
  let idx = 1;
  for (const dept of AGENT_DEPARTMENTS) {
    for (let i = 1; i <= dept.quota; i++) {
      const code = `AGT-${String(idx).padStart(3, '0')}`;
      const spec = dept.specialties[(i - 1) % dept.specialties.length];
      records.push({
        id: idx,
        code,
        name: `${dept.label} #${String(i).padStart(2, '0')} · ${spec.split(' ')[0]}`,
        department: dept.label,
        specialty: spec,
        objective: `Executar tarefas automatizadas por evento de ${spec.toLowerCase()} com rigor de dados reais.`,
        instructions: `Atuar estritamente no escopo ${dept.accessScope}. Nunca inventar preços ou realizar mutações financeiras sem aprovação explícita.`,
        allowedToolsJson: dept.tools,
        accessScope: dept.accessScope,
        supervisorEmail: 'brasilportalvip@gmail.com',
        state: 'idle',
        tasksCompleted: 0,
        errorCount: 0,
        avgDurationMs: 280 + ((idx * 17) % 320),
        estimatedCostUsdMicro: 0,
        requiresFinancialApproval: true,
        lastError: null,
        lastRunAt: null,
        updatedAt: now,
      });
      idx += 1;
    }
  }
  return records;
}

export async function ensure200AgentsSeeded() {
  const existing = await adminDb.collection('agents').count().get();
  if (existing.data().count >= 200) {
    return;
  }

  const records = build200AgentSpecs();
  const batch = adminDb.batch();
  for (const rec of records) {
    batch.set(adminDb.collection('agents').doc(rec.code), rec, { merge: true });
  }
  await batch.commit();
}

export async function dispatchAgentTask(params: {
  department: string;
  triggerType: 'event' | 'schedule' | 'request';
  eventName: string;
  title: string;
  input?: Record<string, unknown>;
  requestedAction?: string;
  explicitApproval?: boolean;
  executor?: () => Promise<string>;
}): Promise<AgentTaskDoc | null> {
  await ensure200AgentsSeeded();

  const candidatesSnap = await adminDb
    .collection('agents')
    .where('department', '==', params.department)
    .get();
  const candidates = candidatesSnap.docs.map((d) => d.data() as AiAgentDoc);
  const agent = candidates[Math.floor(Math.random() * Math.max(1, candidates.length))];
  if (!agent) {
    // Sem agente cadastrado o trabalho real ainda precisa acontecer (ex.: verificar identidade).
    if (params.executor) await params.executor();
    return null;
  }

  const taskCode = `TSK-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const start = Date.now();
  const now = new Date().toISOString();

  if (requiresHumanFinancialApproval(params.requestedAction, params.explicitApproval)) {
    const id = await nextSeqId('agent_tasks');
    const task: AgentTaskDoc = {
      id,
      taskCode,
      agentId: agent.id,
      agentCode: agent.code,
      triggerType: params.triggerType,
      eventName: params.eventName,
      title: params.title,
      status: 'awaiting_approval',
      inputJson: params.input ?? {},
      resultSummary: `Bloqueado pela trava financeira: ação "${params.requestedAction}" exige aprovação humana/servidor.`,
      errorMessage: null,
      durationMs: Date.now() - start,
      aiCostUsdMicro: 0,
      createdAt: now,
      completedAt: null,
    };

    await Promise.all([
      adminDb.collection('agent_tasks').doc(String(id)).set(task),
      adminDb.collection('agents').doc(agent.code).set(
        { state: 'waiting', lastRunAt: now, updatedAt: now },
        { merge: true }
      ),
    ]);
    return task;
  }

  try {
    const summary = params.executor
      ? await params.executor()
      : `Evento "${params.eventName}" processado por ${agent.code} (${agent.specialty}).`;

    const durationMs = Math.max(15, Date.now() - start);
    const aiCostUsdMicro = params.triggerType === 'request' ? 120 : 40;
    const id = await nextSeqId('agent_tasks');
    const completedAt = new Date().toISOString();

    const task: AgentTaskDoc = {
      id,
      taskCode,
      agentId: agent.id,
      agentCode: agent.code,
      triggerType: params.triggerType,
      eventName: params.eventName,
      title: params.title,
      status: 'completed',
      inputJson: params.input ?? {},
      resultSummary: summary,
      errorMessage: null,
      durationMs,
      aiCostUsdMicro,
      createdAt: now,
      completedAt,
    };

    await Promise.all([
      adminDb.collection('agent_tasks').doc(String(id)).set(task),
      adminDb
        .collection('agents')
        .doc(agent.code)
        .set(
          {
            state: 'idle',
            tasksCompleted: (agent.tasksCompleted || 0) + 1,
            estimatedCostUsdMicro: (agent.estimatedCostUsdMicro || 0) + aiCostUsdMicro,
            avgDurationMs: durationMs,
            lastRunAt: completedAt,
            updatedAt: completedAt,
          },
          { merge: true }
        ),
    ]);

    return task;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
    const id = await nextSeqId('agent_tasks');
    const failAt = new Date().toISOString();
    await Promise.all([
      adminDb.collection('agent_tasks').doc(String(id)).set({
        id,
        taskCode,
        agentId: agent.id,
        agentCode: agent.code,
        triggerType: params.triggerType,
        eventName: params.eventName,
        title: params.title,
        status: 'failed',
        inputJson: params.input ?? {},
        resultSummary: null,
        errorMessage: errMsg,
        durationMs: Date.now() - start,
        aiCostUsdMicro: 0,
        createdAt: now,
        completedAt: null,
      }),
      adminDb
        .collection('agents')
        .doc(agent.code)
        .set(
          {
            state: 'error',
            errorCount: (agent.errorCount || 0) + 1,
            lastError: errMsg,
            lastRunAt: failAt,
            updatedAt: failAt,
          },
          { merge: true }
        ),
    ]);
    return null;
  }
}
