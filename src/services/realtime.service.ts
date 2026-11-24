import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';

let wss: WebSocketServer | null = null;

export interface RealtimeEventPayload {
  type: 'chat:message' | 'agent:task' | 'notification:new' | 'editorial:published';
  channel?: string;
  targetUid?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export function initRealtimeWebSocketServer(httpServer: Server) {
  if (wss) return wss;

  wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wss.on('connection', (socket) => {
    socket.send(
      JSON.stringify({
        type: 'connection:ready',
        timestamp: new Date().toISOString(),
      })
    );
  });

  return wss;
}

export function broadcastRealtimeEvent(event: Omit<RealtimeEventPayload, 'timestamp'>) {
  if (!wss) return;
  const serialized = JSON.stringify({
    ...event,
    timestamp: new Date().toISOString(),
  });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(serialized);
    }
  }
}

/**
 * Aviso de mensagem nova numa conversa. O WebSocket /ws não tem login e entrega para todos os
 * conectados: por isso o aviso leva só os identificadores, nunca o texto nem quem escreveu.
 * Quem tem acesso à conversa busca as mensagens pela API autenticada.
 */
export function chatMessageNotice(conversation: { id: number; conversationCode: string }) {
  return {
    type: 'chat:message' as const,
    channel: conversation.conversationCode,
    data: { conversationId: conversation.id },
  };
}
