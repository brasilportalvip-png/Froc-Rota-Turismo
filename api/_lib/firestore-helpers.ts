import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin.ts';

export async function nextSeqId(counterName: string): Promise<number> {
  const ref = adminDb.collection('_counters').doc(counterName);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data()?.seq ?? 0) : 0;
    const next = current + 1;
    tx.set(ref, { seq: next }, { merge: true });
    return next;
  });
}

export function toIso(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

export function serializeDoc<T extends Record<string, unknown>>(doc: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (v instanceof Timestamp) {
      out[k] = v.toDate().toISOString();
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export async function getAllDocs<T extends Record<string, unknown>>(
  collectionName: string
): Promise<T[]> {
  const snap = await adminDb.collection(collectionName).get();
  return snap.docs.map((d) => serializeDoc(d.data() as T));
}
