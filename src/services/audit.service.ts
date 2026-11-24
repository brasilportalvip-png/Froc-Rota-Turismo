import { db } from '../db/index.ts';
import { auditLogs } from '../db/schema.ts';

export async function recordAuditLog(params: {
  actorUserId?: number | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId: string | number;
  details?: Record<string, unknown>;
}) {
  try {
    await db.insert(auditLogs).values({
      actorUserId: params.actorUserId ?? null,
      actorEmail: params.actorEmail ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: String(params.entityId),
      detailsJson: params.details ?? {},
    });
  } catch (error) {
    console.error('Audit log write failed:', error);
  }
}
