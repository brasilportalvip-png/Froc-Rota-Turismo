import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { ChatConversation, ChatMessage } from '../types.ts';
import { FuturisticModalHeader } from './DesignSystem.tsx';

interface RealtimeChatDrawerProps {
  onClose: () => void;
  defaultChannel?: 'tourist' | 'merchant' | 'admin';
  initialSubject?: string;
}

/**
 * Chat de atendimento.
 * Toda leitura e escrita passa pela API do servidor (/api/chat/...), que confere o dono da conversa.
 * As novidades chegam por consulta automática a cada poucos segundos — não depende das regras do
 * Firestore no navegador (antes, um erro de permissão ali apagava a conversa da tela).
 */
const MESSAGES_POLL_MS = 4000;
const LIST_POLL_MS = 15000;

const ROLE_LABEL: Record<ChatMessage['senderRole'], string> = {
  tourist: 'Cliente',
  merchant: 'Parceiro',
  admin: 'Equipe Froc Rota',
  ai_agent: 'Assistente IA',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Aberta',
  human_assigned: 'Com atendente',
  resolved: 'Resolvida',
};

const CHANNEL_LABEL: Record<string, string> = {
  tourist: 'Turista',
  merchant: 'Parceiro',
  admin: 'Equipe',
  ai_handoff: 'Equipe',
};

function sameMessages(a: ChatMessage[], b: ChatMessage[]) {
  if (a.length !== b.length) return false;
  return a.every((m, i) => m.id === b[i].id && m.text === b[i].text);
}

function formatHour(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export const RealtimeChatDrawer: React.FC<RealtimeChatDrawerProps> = ({
  onClose,
  defaultChannel = 'tourist',
  initialSubject = '',
}) => {
  const { apiFetch, dbUser, isAnyAdmin, requestLogin, notify } = useApp();

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedConv, setSelectedConv] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('thread');

  const [newSubject, setNewSubject] = useState(initialSubject);
  const [newMsgText, setNewMsgText] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [showAttach, setShowAttach] = useState(false);
  const [askAi, setAskAi] = useState(true);
  const [sending, setSending] = useState(false);
  const [pendingText, setPendingText] = useState('');
  const [sendError, setSendError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const firstListLoad = useRef(true);

  const loadConversations = useCallback(
    async (silent = false) => {
      if (!dbUser) return;
      if (!silent) setLoadingList(true);
      try {
        const q = searchTerm.trim() ? `?q=${encodeURIComponent(searchTerm.trim())}` : '';
        const res = await apiFetch<{ conversations: ChatConversation[] }>(
          `/api/chat/conversations${q}`
        );
        const list = res.conversations || [];
        setConversations(list);
        setListError('');
        if (firstListLoad.current) {
          firstListLoad.current = false;
          setSelectedId((prev) => prev ?? (list[0]?.id ?? null));
        }
      } catch (err: unknown) {
        if (!silent) {
          setListError(err instanceof Error ? err.message : 'Erro ao carregar conversas.');
        }
      } finally {
        if (!silent) setLoadingList(false);
      }
    },
    [apiFetch, dbUser, searchTerm]
  );

  const loadMessages = useCallback(
    async (convId: number) => {
      if (!dbUser) return;
      try {
        const res = await apiFetch<{ conversation: ChatConversation; messages: ChatMessage[] }>(
          `/api/chat/conversations/${convId}/messages`
        );
        setSelectedConv(res.conversation);
        const next = res.messages || [];
        setMessages((prev) => (sameMessages(prev, next) ? prev : next));
      } catch {
        // falha passageira: a próxima consulta automática tenta de novo
      }
    },
    [apiFetch, dbUser]
  );

  // Lista de conversas: carrega ao abrir/buscar e atualiza sozinha.
  useEffect(() => {
    if (!dbUser) return;
    loadConversations(false);
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadConversations(true);
    }, LIST_POLL_MS);
    return () => window.clearInterval(t);
  }, [dbUser, loadConversations]);

  // Mensagens da conversa aberta: atualiza sozinha (respostas da equipe chegam aqui).
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setSelectedConv(null);
      return;
    }
    setMessages([]);
    loadMessages(selectedId);
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadMessages(selectedId);
    }, MESSAGES_POLL_MS);
    return () => window.clearInterval(t);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pendingText]);

  const openConversation = (id: number) => {
    setSelectedId(id);
    setMobileView('thread');
    setConfirmDelete(false);
    setSendError('');
  };

  // Conversa nova: limpa a tela; a primeira mensagem enviada abre o atendimento.
  const startNewConversation = () => {
    setSelectedId(null);
    setSelectedConv(null);
    setMessages([]);
    setConfirmDelete(false);
    setSendError('');
    setMobileView('thread');
  };

  // Quem é dono da conversa recebe resposta da IA (inclusive o admin testando o próprio chat).
  const isMine = !selectedConv || selectedConv.ownerUid === dbUser?.uid;
  const aiOn = askAi && isMine;

  const changeStatus = async (action: 'close' | 'reopen') => {
    if (!selectedConv) return;
    try {
      await apiFetch(`/api/chat/conversations/${selectedConv.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      const status = action === 'close' ? 'resolved' : 'open';
      setSelectedConv((c) => (c ? { ...c, status } : c));
      setConversations((list) => list.map((c) => (c.id === selectedConv.id ? { ...c, status } : c)));
      notify(action === 'close' ? 'Conversa encerrada.' : 'Conversa reaberta.', 'success');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Não foi possível atualizar a conversa.', 'error');
    }
  };

  const deleteConversation = async () => {
    if (!selectedConv) return;
    const id = selectedConv.id;
    try {
      await apiFetch(`/api/chat/conversations/${id}`, { method: 'DELETE' });
      setConversations((list) => list.filter((c) => c.id !== id));
      startNewConversation();
      notify('Conversa excluída da sua lista.', 'success');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Não foi possível excluir a conversa.', 'error');
    }
  };

  const createConversation = async (subject: string): Promise<ChatConversation> => {
    const res = await apiFetch<{ conversation: ChatConversation }>('/api/chat/conversations', {
      method: 'POST',
      body: JSON.stringify({ subject, channel: defaultChannel }),
    });
    setConversations((prev) =>
      prev.some((c) => c.id === res.conversation.id) ? prev : [res.conversation, ...prev]
    );
    setSelectedConv(res.conversation);
    setSelectedId(res.conversation.id);
    setMobileView('thread');
    return res.conversation;
  };

  const handleCreateConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbUser) {
      await requestLogin();
      return;
    }
    const subject = newSubject.trim() || 'Atendimento Froc Rota';
    try {
      await createConversation(subject);
      setNewSubject('');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao iniciar atendimento.', 'error');
    }
  };

  const handleSendMessage = async (e: React.FormEvent, requestHumanHandoff = false) => {
    e.preventDefault();
    if (sending) return;
    const text = newMsgText.trim() || (requestHumanHandoff ? 'Quero falar com um atendente.' : '');
    if (!text) return;

    setSending(true);
    setPendingText(text);
    setNewMsgText('');
    setSendError('');
    try {
      // Sem conversa aberta: a primeira mensagem já cria o atendimento.
      let convId = selectedId;
      if (!convId) {
        const conv = await createConversation(text.slice(0, 70));
        convId = conv.id;
      }
      const res = await apiFetch<{ messages: ChatMessage[] }>(
        `/api/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            text,
            attachmentUrl: attachmentUrl.trim() || undefined,
            askAi: !requestHumanHandoff && aiOn,
            requestHumanHandoff,
          }),
        }
      );
      if (res.messages?.length) {
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          return [...prev, ...res.messages.filter((m) => !ids.has(m.id))];
        });
      }
      setAttachmentUrl('');
      setShowAttach(false);
      await loadMessages(convId);
      loadConversations(true);
      if (requestHumanHandoff) notify('Pronto! Um atendente vai responder nesta conversa.', 'info');
    } catch (err: unknown) {
      setNewMsgText(text);
      const msg = err instanceof Error ? err.message : 'Falha ao enviar mensagem.';
      setSendError(msg);
      notify(msg, 'error');
    } finally {
      setPendingText('');
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/65 backdrop-blur-xs overflow-y-auto p-2 md:p-6 flex justify-center items-center">
      <div className="w-full max-w-5xl h-[92vh] md:h-[85vh] bg-[#FFFFFF] rounded-2xl border-2 border-[#111111] shadow-2xl flex flex-col overflow-hidden froc-animate-modal">
        <FuturisticModalHeader
          title="Atendimento Froc Rota"
          subtitle="Assistente IA na hora e equipe humana quando você precisar"
          icon={<MessageSquare className="w-5 h-5" />}
          onBack={onClose}
          onClose={onClose}
        />

        {!dbUser ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <MessageSquare className="w-10 h-10 text-[#111111]" />
            <h3 className="text-lg font-extrabold text-[#111111]">
              Entre para conversar com a Froc Rota
            </h3>
            <p className="text-sm text-[#111111]/75 max-w-md">
              Tire dúvidas sobre passeios, hospedagens, voos e reservas. Seu histórico fica salvo
              na sua conta.
            </p>
            <button
              type="button"
              onClick={requestLogin}
              className="min-h-[44px] px-5 py-2.5 rounded-xl froc-btn-neon text-xs font-extrabold"
            >
              Entrar na conta
            </button>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0">
            {/* Lista de conversas */}
            <div
              data-testid="chat-list"
              className={`md:col-span-4 border-r border-[#111111]/15 flex-col min-h-0 bg-white ${
                mobileView === 'list' ? 'flex' : 'hidden md:flex'
              }`}
            >
              <div className="p-3 border-b border-[#111111]/15 space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#111111]/70 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar conversa ou protocolo..."
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-[#111111]/15 bg-white text-xs"
                  />
                </div>
                <form onSubmit={handleCreateConversation} className="flex gap-1.5">
                  <input
                    value={newSubject}
                    onChange={(e) => setNewSubject(e.target.value)}
                    placeholder="Assunto da nova conversa..."
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#111111]/15 bg-white text-xs"
                  />
                  <button
                    type="submit"
                    title="Nova conversa"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-semibold shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nova</span>
                  </button>
                </form>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-[#111111]/10">
                {loadingList ? (
                  <div className="p-4 text-xs text-[#111111]/70">Carregando conversas...</div>
                ) : listError ? (
                  <div className="p-4 text-xs text-red-700 space-y-2">
                    <p>{listError}</p>
                    <button
                      type="button"
                      onClick={() => loadConversations(false)}
                      className="underline font-semibold"
                    >
                      Tentar de novo
                    </button>
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="p-5 text-xs text-[#111111]/70 text-center">
                    Nenhuma conversa ainda. Escreva sua mensagem ao lado para começar.
                  </div>
                ) : (
                  conversations.map((conv) => {
                    const unread = isAnyAdmin ? conv.unreadByStaff : conv.unreadByOwner;
                    const active = selectedId === conv.id;
                    return (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => openConversation(conv.id)}
                        className={`w-full text-left p-3.5 transition-colors ${
                          active ? 'bg-white border-l-4 border-[#111111]' : 'hover:bg-[#111111]/5'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] text-[#111111]/70">
                          <span className="font-mono-tabular font-semibold text-[#111111]">
                            {conv.conversationCode}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {unread > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-[#D9A441] text-[#111111] font-mono-tabular font-bold text-[10px]">
                                {unread}
                              </span>
                            )}
                            <span>{STATUS_LABEL[conv.status] || conv.status}</span>
                          </div>
                        </div>
                        <div className="text-xs font-semibold text-[#111111] mt-1 line-clamp-1">
                          {conv.subject}
                        </div>
                        {isAnyAdmin && (
                          <div className="text-[11px] text-[#111111]/70 mt-0.5">
                            {conv.ownerName} · {CHANNEL_LABEL[conv.channel] || conv.channel}
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Conversa */}
            <div
              data-testid="chat-thread"
              className={`md:col-span-8 flex-col min-h-0 ${
                mobileView === 'thread' ? 'flex' : 'hidden md:flex'
              }`}
            >
              <div className="px-4 py-3 border-b border-[#111111]/15 flex flex-wrap items-center justify-between gap-2 bg-white">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => setMobileView('list')}
                    className="md:hidden inline-flex items-center gap-1 text-xs font-semibold text-[#111111] shrink-0"
                    aria-label="Ver minhas conversas"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Conversas</span>
                  </button>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#111111] truncate">
                      {selectedConv?.subject || 'Nova conversa'}
                    </div>
                    {selectedConv && (
                      <div className="text-[11px] text-[#111111]/70 font-mono-tabular">
                        Protocolo {selectedConv.conversationCode} ·{' '}
                        {STATUS_LABEL[selectedConv.status] || selectedConv.status}
                        {isAnyAdmin ? ` · ${selectedConv.ownerName}` : ''}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {!isAnyAdmin && selectedConv && selectedConv.status === 'open' && (
                    <button
                      type="button"
                      disabled={sending}
                      onClick={(e) => handleSendMessage(e, true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#111111] text-[#111111] text-xs font-semibold hover:bg-[#111111]/5 disabled:opacity-60"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Falar com atendente</span>
                    </button>
                  )}
                  {selectedConv && selectedConv.status !== 'resolved' && (
                    <button
                      type="button"
                      onClick={() => changeStatus('close')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#111111]/30 text-[#111111] text-xs font-semibold hover:bg-[#111111]/5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Encerrar</span>
                    </button>
                  )}
                  {selectedConv && selectedConv.status === 'resolved' && (
                    <button
                      type="button"
                      onClick={() => changeStatus('reopen')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#111111]/30 text-[#111111] text-xs font-semibold hover:bg-[#111111]/5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Reabrir</span>
                    </button>
                  )}
                  {selectedConv && (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Excluir</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={startNewConversation}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-bold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nova conversa</span>
                  </button>
                </div>
              </div>

              {confirmDelete && selectedConv && (
                <div className="px-4 py-3 bg-red-50 border-b border-red-200 flex flex-wrap items-center justify-between gap-2 text-xs text-red-800" role="alertdialog" aria-label="Confirmar exclusão">
                  <span>Excluir esta conversa da sua lista? Essa ação não pode ser desfeita.</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-lg border border-red-300 font-semibold">
                      Cancelar
                    </button>
                    <button type="button" onClick={deleteConversation} className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold">
                      Sim, excluir
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
                {!selectedId && messages.length === 0 && !pendingText && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-[#111111]/75 px-4">
                    <Bot className="w-8 h-8 text-[#111111]" />
                    <p className="text-sm font-semibold text-[#111111]">
                      Olá{dbUser.name ? `, ${dbUser.name.split(' ')[0]}` : ''}! Como podemos ajudar?
                    </p>
                    <p className="text-xs max-w-sm">
                      Escreva sua dúvida abaixo. O assistente responde na hora e, se preferir, um
                      atendente da equipe continua a conversa.
                    </p>
                  </div>
                )}

                {messages.map((m) => {
                  const isMe = m.senderUid === dbUser.uid;
                  const isAi = m.senderRole === 'ai_agent';
                  return (
                    <div key={m.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                      <div className="text-[10px] text-[#111111]/70 mb-1 px-1">
                        {isMe
                          ? 'Você'
                          : m.senderRole === 'admin' && !isAnyAdmin
                          ? 'Equipe Froc Rota'
                          : m.senderRole === 'ai_agent'
                          ? 'Assistente IA'
                          : `${m.senderName} · ${ROLE_LABEL[m.senderRole] || ''}`}
                        {m.createdAt ? ` · ${formatHour(m.createdAt)}` : ''}
                      </div>
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed border-2 ${
                          isMe
                            ? 'bg-[#111111] text-white border-[#39FF14]'
                            : isAi
                            ? 'bg-[#FFFFFF] text-[#111111] border-[#FFD700]'
                            : 'bg-[#FFFFFF] text-[#111111] border-[#111111]/20'
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.text}</div>
                        {m.attachmentUrl && (
                          <a
                            href={m.attachmentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block mt-2 underline font-semibold text-[11px]"
                          >
                            Abrir anexo
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}

                {sendError && !pendingText && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800" role="alert" data-testid="chat-erro">
                    <strong>Não foi enviada:</strong> {sendError} Sua mensagem continua no campo abaixo — toque em Enviar para tentar de novo.
                  </div>
                )}
                {pendingText && (
                  <>
                    <div className="flex flex-col items-end opacity-70">
                      <div className="text-[10px] text-[#111111]/70 mb-1 px-1">Você · enviando...</div>
                      <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm border-2 bg-[#111111] text-white border-[#39FF14] whitespace-pre-wrap break-words">
                        {pendingText}
                      </div>
                    </div>
                    {aiOn && (
                      <div className="flex items-center gap-1.5 text-xs text-[#111111]/70" data-testid="chat-typing">
                        <Bot className="w-3.5 h-3.5" />
                        <span>Assistente digitando...</span>
                      </div>
                    )}
                  </>
                )}
                <div ref={bottomRef} />
              </div>

              <form
                onSubmit={(e) => handleSendMessage(e, false)}
                className="p-3 border-t border-[#111111]/15 bg-white space-y-2"
              >
                {showAttach && (
                  <input
                    type="url"
                    value={attachmentUrl}
                    onChange={(e) => setAttachmentUrl(e.target.value)}
                    placeholder="Cole o link (https) do comprovante, voucher ou foto..."
                    className="w-full px-3 py-1.5 rounded-xl border border-[#111111]/25 text-xs"
                  />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#111111]/70">
                  {isMine ? (
                    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={askAi}
                        onChange={(e) => setAskAi(e.target.checked)}
                      />
                      <Bot className="w-3.5 h-3.5 text-[#111111]" />
                      <span>Resposta na hora com o assistente IA</span>
                    </label>
                  ) : (
                    <span className="font-bold text-[#111111] bg-[#39FF14] px-2 py-0.5 rounded">
                      Respondendo como equipe Froc Rota
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowAttach((v) => !v)}
                    className="inline-flex items-center gap-1 text-[#FF1493] font-bold hover:underline"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    <span>{showAttach ? 'Ocultar anexo' : 'Anexar link'}</span>
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    value={newMsgText}
                    onChange={(e) => setNewMsgText(e.target.value)}
                    placeholder="Escreva sua mensagem..."
                    maxLength={2000}
                    className="flex-1 min-h-[44px] px-3.5 py-2.5 rounded-xl border border-[#111111]/25 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={sending || !newMsgText.trim()}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl froc-btn-neon text-xs font-extrabold disabled:opacity-60"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{sending ? 'Enviando...' : 'Enviar'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
