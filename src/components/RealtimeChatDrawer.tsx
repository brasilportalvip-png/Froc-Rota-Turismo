import React, { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  UserCheck,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useApp } from '../context/AppContext.tsx';
import { firestoreDb, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import { ChatConversation, ChatMessage } from '../types.ts';
import { FuturisticModalHeader } from './DesignSystem.tsx';

interface RealtimeChatDrawerProps {
  onClose: () => void;
  defaultChannel?: 'tourist' | 'merchant' | 'admin';
  initialSubject?: string;
}

export const RealtimeChatDrawer: React.FC<RealtimeChatDrawerProps> = ({
  onClose,
  defaultChannel = 'tourist',
  initialSubject = '',
}) => {
  const { apiFetch, dbUser, firebaseUser, isAnyAdmin, lastRealtimeEvent, loginWithGoogle, notify } =
    useApp();

  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingList, setLoadingList] = useState(false);

  const [newSubject, setNewSubject] = useState(initialSubject);
  const [newMsgText, setNewMsgText] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [showAttach, setShowAttach] = useState(false);
  const [askAi, setAskAi] = useState(true);
  const [sending, setSending] = useState(false);
  const [firestoreLiveCount, setFirestoreLiveCount] = useState<number | null>(null);

  const loadConversations = useCallback(async () => {
    if (!dbUser) return;
    setLoadingList(true);
    try {
      const q = searchTerm.trim() ? `?q=${encodeURIComponent(searchTerm.trim())}` : '';
      const res = await apiFetch<{ conversations: ChatConversation[] }>(
        `/api/chat/conversations${q}`
      );
      setConversations(res.conversations || []);
      if (!selectedConv && res.conversations?.length > 0) {
        setSelectedConv(res.conversations[0]);
      }
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao carregar conversas.', 'error');
    } finally {
      setLoadingList(false);
    }
  }, [apiFetch, dbUser, notify, searchTerm, selectedConv]);

  const loadMessages = useCallback(
    async (convId: number) => {
      if (!dbUser) return;
      try {
        const res = await apiFetch<{ conversation: ChatConversation; messages: ChatMessage[] }>(
          `/api/chat/conversations/${convId}/messages`
        );
        setSelectedConv(res.conversation);
        setMessages(res.messages || []);
      } catch {
        // ignore transient fetch errors
      }
    },
    [apiFetch, dbUser]
  );

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (selectedConv?.id) {
      loadMessages(selectedConv.id);
    }
  }, [selectedConv?.id, loadMessages]);

  // WebSocket live event handler
  useEffect(() => {
    if (!lastRealtimeEvent || lastRealtimeEvent.type !== 'chat:message') return;
    const payload = lastRealtimeEvent.data as {
      conversationId?: number;
      message?: ChatMessage;
    };
    if (payload?.conversationId && payload.conversationId === selectedConv?.id && payload.message) {
      setMessages((prev) =>
        prev.some((m) => m.id === payload.message!.id) ? prev : [...prev, payload.message!]
      );
    }
    loadConversations();
  }, [lastRealtimeEvent, selectedConv?.id, loadConversations]);

  // Firestore real-time mirror listener scoped to authenticated ownerUid
  useEffect(() => {
    if (!firebaseUser?.uid || !firebaseUser.emailVerified) return;
    const convPath = 'conversations';
    const q = isAnyAdmin
      ? query(collection(firestoreDb, convPath))
      : query(collection(firestoreDb, convPath), where('ownerUid', '==', firebaseUser.uid));

    const unsub = onSnapshot(
      q,
      (snap) => {
        setFirestoreLiveCount(snap.size);
      },
      (err) => {
        // Only handle fatal permission errors via structured handler when user holds a verified email
        console.warn('Firestore chat snapshot warning:', err.message);
        if (err.message.includes('insufficient permissions')) {
          handleFirestoreError(err, OperationType.LIST, convPath);
        }
      }
    );
    return () => unsub();
  }, [firebaseUser?.uid, firebaseUser?.emailVerified, isAnyAdmin]);

  const handleCreateConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dbUser) {
      await loginWithGoogle();
      return;
    }
    const subject = newSubject.trim() || 'Atendimento Froc Rota Turismo';
    try {
      const res = await apiFetch<{ conversation: ChatConversation }>('/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({
          subject,
          channel: defaultChannel,
          initialMessage: `Olá! Gostaria de falar sobre: ${subject}`,
        }),
      });
      setNewSubject('');
      setConversations((prev) => [res.conversation, ...prev]);
      setSelectedConv(res.conversation);
      notify('Nova conversa em tempo real iniciada.', 'success');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Erro ao iniciar atendimento.', 'error');
    }
  };

  const handleSendMessage = async (e: React.FormEvent, requestHumanHandoff = false) => {
    e.preventDefault();
    if (!selectedConv) return;
    if (!newMsgText.trim() && !requestHumanHandoff) return;

    setSending(true);
    try {
      const res = await apiFetch<{ messages: ChatMessage[] }>(
        `/api/chat/conversations/${selectedConv.id}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            text: newMsgText.trim() || (requestHumanHandoff ? 'Solicito atendimento humano.' : ''),
            attachmentUrl: attachmentUrl.trim() || undefined,
            askAi: !requestHumanHandoff && askAi,
            requestHumanHandoff,
          }),
        }
      );
      if (res.messages?.length) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const merged = [...prev];
          for (const msg of res.messages) {
            if (!existingIds.has(msg.id)) merged.push(msg);
          }
          return merged;
        });
      }
      setNewMsgText('');
      setAttachmentUrl('');
      setShowAttach(false);
      await loadMessages(selectedConv.id);
      if (requestHumanHandoff) {
        notify('Atendente humano acionado na central Froc Rota.', 'info');
      }
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Falha ao enviar mensagem.', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/65 backdrop-blur-xs overflow-y-auto p-3 md:p-6 flex justify-center items-center">
      <div className="w-full max-w-5xl h-[85vh] bg-[#FFFFFF] rounded-2xl border-2 border-[#111111] shadow-2xl flex flex-col overflow-hidden froc-animate-modal">
        <FuturisticModalHeader
          title="Central de Chat em Tempo Real"
          subtitle={`WebSocket + Cloud Firestore · Froc Rota AI & Equipe Humana${
            firestoreLiveCount !== null ? ' · Sync ativo' : ''
          }`}
          icon={<MessageSquare className="w-5 h-5" />}
          onBack={onClose}
          onClose={onClose}
        />

        {!dbUser ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <MessageSquare className="w-10 h-10 text-[#111111]" />
            <h3 className="text-lg font-extrabold text-[#111111]">
              Entre para conversar com a Froc Rota em tempo real
            </h3>
            <p className="text-sm text-[#111111]/75 max-w-md">
              Histórico completo de mensagens entre turistas, parceiros, IA e atendentes humanos
              com notificações instantâneas e envio de comprovantes.
            </p>
            <button
              type="button"
              onClick={loginWithGoogle}
              className="min-h-[44px] px-5 py-2.5 rounded-xl froc-btn-neon text-xs font-extrabold"
            >
              Entrar com Google
            </button>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0">
            {/* Sidebar */}
            <div className="md:col-span-4 border-r border-[#111111]/15 flex flex-col min-h-0 bg-white">
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
                    placeholder="Novo assunto de atendimento..."
                    className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#111111]/15 bg-white text-xs"
                  />
                  <button
                    type="submit"
                    title="Nova conversa"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#111111] text-[#39FF14] text-xs font-semibold shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Abrir</span>
                  </button>
                </form>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-[#111111]/10">
                {loadingList ? (
                  <div className="p-4 text-xs text-[#111111]/70">Buscando conversas...</div>
                ) : conversations.length === 0 ? (
                  <div className="p-5 text-xs text-[#111111]/70 text-center">
                    Nenhuma conversa aberta. Digite um assunto acima e clique em Abrir.
                  </div>
                ) : (
                  conversations.map((conv) => {
                    const unread = isAnyAdmin ? conv.unreadByStaff : conv.unreadByOwner;
                    const active = selectedConv?.id === conv.id;
                    return (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => setSelectedConv(conv)}
                        className={`w-full text-left p-3.5 transition-colors ${
                          active ? 'bg-white border-l-4 border-[#111111]' : 'hover:bg-white/70'
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
                            <span>{conv.status === 'human_assigned' ? 'Humano' : conv.status}</span>
                          </div>
                        </div>
                        <div className="text-xs font-semibold text-[#111111] mt-1 line-clamp-1">
                          {conv.subject}
                        </div>
                        <div className="text-[11px] text-[#111111]/70 mt-0.5">
                          {conv.ownerName} · canal {conv.channel}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Thread Area */}
            <div className="md:col-span-8 flex flex-col min-h-0">
              {!selectedConv ? (
                <div className="flex-1 flex items-center justify-center p-6 text-sm text-[#111111]/70">
                  Selecione uma conversa ao lado ou abra um novo atendimento.
                </div>
              ) : (
                <>
                  <div className="px-5 py-3 border-b border-[#111111]/15 flex flex-wrap items-center justify-between gap-2 bg-white">
                    <div>
                      <div className="text-sm font-semibold text-[#111111]">
                        {selectedConv.subject}
                      </div>
                      <div className="text-[11px] text-[#111111]/70 font-mono-tabular">
                        Protocolo {selectedConv.conversationCode} · {selectedConv.ownerName} ·{' '}
                        {selectedConv.status}
                      </div>
                    </div>
                    {!isAnyAdmin && selectedConv.status !== 'human_assigned' && (
                      <button
                        type="button"
                        onClick={(e) => handleSendMessage(e, true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#111111] text-[#111111] text-xs font-semibold hover:bg-white"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Falar com Atendente Humano</span>
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
                    {messages.map((m) => {
                      const isMe = m.senderUid === dbUser.uid;
                      const isAi = m.senderRole === 'ai_agent';
                      return (
                        <div
                          key={m.id}
                          className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                        >
                          <div className="text-[10px] text-[#111111]/70 mb-1 px-1">
                            {m.senderName} ({m.senderRole === 'ai_agent' ? 'IA Especialista' : m.senderRole})
                          </div>
                          <div
                            className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed border-2 ${
                              isMe
                                ? 'bg-[#111111] text-white border-[#39FF14]'
                                : isAi
                                ? 'bg-[#FFFFFF] text-[#111111] border-[#FFD700]'
                                : 'bg-[#FFFFFF] text-[#111111] border-[#111111]/20'
                            }`}
                          >
                            <div className="whitespace-pre-wrap">{m.text}</div>
                            {m.attachmentUrl && (
                              <a
                                href={m.attachmentUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-block mt-2 underline font-semibold text-[11px]"
                              >
                                Abrir anexo HTTPS
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
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
                        placeholder="Cole um link HTTPS de comprovante, voucher ou foto..."
                        className="w-full px-3 py-1.5 rounded-xl border border-[#111111]/25 text-xs"
                      />
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#111111]/70">
                      {!isAnyAdmin ? (
                        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={askAi}
                            onChange={(e) => setAskAi(e.target.checked)}
                          />
                          <Bot className="w-3.5 h-3.5 text-[#111111]" />
                          <span>Resposta instantânea com Froc Rota AI</span>
                        </label>
                      ) : (
                        <span className="font-bold text-[#111111] bg-[#39FF14] px-2 py-0.5 rounded">
                          Respondendo como Atendente Oficial Froc Rota
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => setShowAttach((v) => !v)}
                        className="inline-flex items-center gap-1 text-[#FF1493] font-bold hover:underline"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        <span>{showAttach ? 'Ocultar anexo' : 'Anexar link HTTPS'}</span>
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <input
                        value={newMsgText}
                        onChange={(e) => setNewMsgText(e.target.value)}
                        placeholder="Escreva sua mensagem em tempo real..."
                        className="flex-1 min-h-[44px] px-3.5 py-2.5 rounded-xl border border-[#111111]/25 text-sm"
                      />
                      <button
                        type="submit"
                        disabled={sending}
                        className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl froc-btn-neon text-xs font-extrabold disabled:opacity-60"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{sending ? 'Enviando...' : 'Enviar'}</span>
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
