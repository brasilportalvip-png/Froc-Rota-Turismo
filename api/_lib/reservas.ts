/**
 * Regras de reserva compartilhadas (criação, cancelamento, webhook e rotina diária).
 */
import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin.js';

export interface BookingDoc {
  id: number;
  bookingCode: string;
  userId: number;
  userUid?: string;
  listingId: number;
  merchantId?: number;
  slotId?: number | null;
  guestsCount: number;
  status: string;
  grossAmountCents: number;
  paymentRef?: string | null;
  expiresAt?: string | null;
  checkoutUrl?: string | null;
}

/** Data AAAA-MM-DD válida. */
export function dataValida(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T12:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** Hoje no fuso de Brasília (AAAA-MM-DD). */
export function hojeBrasil(now = Date.now()): string {
  return new Date(now - 3 * 3600000).toISOString().slice(0, 10);
}

/**
 * Valida datas da reserva. Retorna mensagem de erro (ou null se ok) e o número de diárias.
 */
export function validarDatas(params: { checkInDate: unknown; checkOutDate?: unknown; hospedagem: boolean; now?: number }): {
  erro: string | null;
  noites: number;
} {
  const { checkInDate, checkOutDate, hospedagem } = params;
  if (!dataValida(checkInDate)) return { erro: 'Data de entrada inválida.', noites: 0 };
  if (checkInDate < hojeBrasil(params.now)) return { erro: 'A data escolhida já passou.', noites: 0 };
  if (!hospedagem) return { erro: null, noites: 1 };
  if (!checkOutDate) return { erro: 'Informe a data de saída.', noites: 0 };
  if (!dataValida(checkOutDate)) return { erro: 'Data de saída inválida.', noites: 0 };
  const noites = Math.round((Date.parse(`${checkOutDate}T12:00:00Z`) - Date.parse(`${checkInDate}T12:00:00Z`)) / 86400000);
  if (noites < 1) return { erro: 'A saída precisa ser depois da entrada.', noites: 0 };
  if (noites > 60) return { erro: 'Reservas de até 60 diárias.', noites: 0 };
  return { erro: null, noites };
}

/** Devolve as vagas da reserva para venda (dentro de uma transação já aberta — leituras antes!). */
export async function lerVaga(tx: Transaction, slotId?: number | null) {
  if (!slotId) return null;
  const ref = adminDb.collection('availability_slots').doc(String(slotId));
  const snap = await tx.get(ref);
  return snap.exists ? { ref, disponiveis: Number(snap.data()?.availableSpots ?? 0) } : null;
}

/**
 * Reservas não pagas dentro do prazo voltam para venda (status "expired").
 * Chamado ao reservar a mesma oferta, ao abrir "Minhas viagens" e na rotina diária.
 */
export async function liberarReservasVencidas(filtro: { listingId?: number; userId?: number } = {}, now = Date.now()): Promise<number> {
  let q = adminDb.collection('bookings').where('status', '==', 'pending_payment');
  if (filtro.listingId) q = q.where('listingId', '==', filtro.listingId);
  if (filtro.userId) q = q.where('userId', '==', filtro.userId);
  const snap = await q.get();
  const nowIso = new Date(now).toISOString();
  let liberadas = 0;
  for (const d of snap.docs) {
    const b = d.data() as BookingDoc;
    if (!b.expiresAt || b.expiresAt > nowIso) continue;
    const ok = await adminDb.runTransaction(async (tx) => {
      const fresh = await tx.get(d.ref);
      const fb = fresh.data() as BookingDoc | undefined;
      if (!fb || fb.status !== 'pending_payment') return false;
      const vaga = await lerVaga(tx, fb.slotId);
      tx.update(d.ref, { status: 'expired', updatedAt: nowIso });
      tx.set(adminDb.collection('payments').doc(String(fb.id)), { status: 'expired', updatedAt: nowIso }, { merge: true });
      if (vaga) tx.update(vaga.ref, { availableSpots: vaga.disponiveis + Number(fb.guestsCount || 0) });
      return true;
    });
    if (ok) liberadas++;
  }
  return liberadas;
}
