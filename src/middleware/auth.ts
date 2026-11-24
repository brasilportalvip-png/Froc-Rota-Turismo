import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { and, eq } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { adminPermissions, users } from '../db/schema.ts';

const ADMIN_BOOTSTRAP_EMAIL = 'brasilportalvip@gmail.com';

export interface AuthRequest extends Request {
  authUser?: DecodedIdToken;
  dbUser?: typeof users.$inferSelect;
  adminPermissions?: string[];
}

export async function getOrCreateDbUser(decoded: DecodedIdToken) {
  const email = decoded.email || `${decoded.uid}@froc.local`;
  const name = decoded.name || email.split('@')[0] || 'Viajante';
  // Papel de administrador só com e-mail confirmado pelo provedor (igual às regras do Firestore:
  // request.auth.token.email_verified == true). Sem a confirmação, qualquer conta com o e-mail
  // digitado viraria admin/subadmin.
  const emailVerified = decoded.email_verified === true;
  const isBootstrapAdmin = email.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL && emailVerified;

  try {
    const existing = await db.select().from(users).where(eq(users.uid, decoded.uid)).limit(1);
    const subAdminRows = await db
      .select()
      .from(adminPermissions)
      .where(and(eq(adminPermissions.email, email.toLowerCase()), eq(adminPermissions.active, true)))
      .limit(1);

    const isSubAdmin = emailVerified && subAdminRows.length > 0;

    if (existing.length > 0) {
      const current = existing[0];
      if (isBootstrapAdmin && current.role !== 'admin') {
        const updated = await db
          .update(users)
          .set({ role: 'admin', email, name })
          .where(eq(users.id, current.id))
          .returning();
        return updated[0];
      }
      if (isSubAdmin && current.role !== 'admin' && current.role !== 'subadmin') {
        const updated = await db
          .update(users)
          .set({ role: 'subadmin', email, name })
          .where(eq(users.id, current.id))
          .returning();
        return updated[0];
      }
      return current;
    }

    const assignedRole = isBootstrapAdmin ? 'admin' : isSubAdmin ? 'subadmin' : 'tourist';
    const inserted = await db
      .insert(users)
      .values({
        uid: decoded.uid,
        email,
        name,
        role: assignedRole,
        lgpdConsentAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: { email, name },
      })
      .returning();

    return inserted[0];
  } catch (error) {
    console.error('Failed to sync user profile:', error);
    throw new Error('Authentication profile sync failed.', { cause: error });
  }
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.authUser = decodedToken;
    req.dbUser = await getOrCreateDbUser(decodedToken);
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await adminAuth.verifyIdToken(token);
      req.authUser = decodedToken;
      req.dbUser = await getOrCreateDbUser(decodedToken);
    } catch {
      // Proceed unauthenticated for optional public routes
    }
  }
  next();
};

export const requireAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.dbUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if ((req.dbUser.role === 'admin' || req.dbUser.role === 'subadmin') && req.authUser?.email_verified !== true) {
    return res.status(403).json({ error: 'Forbidden: e-mail não verificado para acesso administrativo' });
  }
  if (req.dbUser.role === 'admin') {
    req.adminPermissions = ['*'];
    return next();
  }
  if (req.dbUser.role === 'subadmin') {
    const rows = await db
      .select()
      .from(adminPermissions)
      .where(
        and(
          eq(adminPermissions.email, req.dbUser.email.toLowerCase()),
          eq(adminPermissions.active, true)
        )
      )
      .limit(1);
    if (rows.length > 0) {
      req.adminPermissions = rows[0].permissionsJson;
      return next();
    }
  }
  return res.status(403).json({ error: 'Forbidden: Administrator access required' });
};

export const requireAdminPermission = (permission: string) => {
  const check = (req: AuthRequest, res: Response, next: NextFunction) => {
    const perms = req.adminPermissions ?? [];
    if (perms.includes('*') || perms.includes(permission)) {
      return next();
    }
    return res.status(403).json({ error: `Forbidden: Missing admin permission '${permission}'` });
  };
  // Marca a permissão exigida: o teste confere que toda rota /admin/ exige uma.
  return Object.assign(check, { adminPermission: permission });
};

// Simple sliding-window rate limiter per IP
const rateBuckets: Record<string, { count: number; resetAt: number }> = {};

export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip || 'unknown'}:${req.baseUrl}`;
    const now = Date.now();
    const bucket = rateBuckets[key];
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets[key] = { count: 1, resetAt: now + windowMs };
      return next();
    }
    if (bucket.count >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    bucket.count += 1;
    next();
  };
}
