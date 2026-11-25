import { adminDb } from './firebase-admin.js';
import { nextSeqId } from './firestore-helpers.js';

export async function recordAuditLog(params: {
  actorUserId?: number | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId: string | number;
  details?: Record<string, unknown>;
}) {
  try {
    const id = await nextSeqId('audit_logs');
    await adminDb
      .collection('audit_logs')
      .doc(String(id))
      .set({
        id,
        actorUserId: params.actorUserId ?? null,
        actorEmail: params.actorEmail ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: String(params.entityId),
        detailsJson: params.details ?? {},
        createdAt: new Date().toISOString(),
      });
  } catch (error) {
    console.error('Audit log write failed:', error);
  }
}
