import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth, adminDb } from './firebase-admin.js';
import { nextSeqId } from './firestore-helpers.js';
import { ApiRequest, ApiResponse, getHeader, sendJson } from './http.js';

export const ADMIN_BOOTSTRAP_EMAIL = 'brasilportalvip@gmail.com';

export interface DbUserDoc {
  id: number;
  uid: string;
  email: string;
  name: string;
  displayName?: string;
  role: 'tourist' | 'merchant' | 'concierge' | 'admin' | 'subadmin';
  preferredLang: 'pt' | 'en' | 'es';
  preferredCurrency: 'BRL' | 'USD' | 'EUR';
  phone: string | null;
  lgpdConsentAt: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface AdminPermissionDoc {
  id: number;
  email: string;
  label: string;
  permissionsJson: string[];
  grantedByEmail: string;
  active: boolean;
  createdAt: string;
}

export interface AuthContext {
  authUser: DecodedIdToken;
  dbUser: DbUserDoc;
  adminPermissions: string[];
}

export function isVerifiedAdminIdentity(params: {
  emailVerified?: boolean;
  role?: string;
}): boolean {
  if (params.emailVerified !== true) return false;
  return params.role === 'admin' || params.role === 'subadmin';
}

export function hasAdminPermission(perms: string[], requiredPermission: string): boolean {
  if (perms.includes('*')) return true;
  return perms.includes(requiredPermission);
}

export async function getOrCreateDbUser(decoded: DecodedIdToken): Promise<{
  user: DbUserDoc;
  permissions: string[];
}> {
  const email = (decoded.email || `${decoded.uid}@froc.local`).trim();
  const normalizedEmail = email.toLowerCase();
  const name = decoded.name || email.split('@')[0] || 'Viajante';
  const emailVerified = decoded.email_verified === true;

  const isBootstrapAdmin =
    emailVerified && normalizedEmail === ADMIN_BOOTSTRAP_EMAIL;

  const permSnap = emailVerified
    ? await adminDb.collection('admin_permissions').doc(normalizedEmail).get()
    : null;
  const permData =
    permSnap && permSnap.exists
      ? (permSnap.data() as AdminPermissionDoc)
      : null;
  const isActiveSubAdmin = Boolean(emailVerified && permData && permData.active === true);

  const userRef = adminDb.collection('users').doc(decoded.uid);
  const existingSnap = await userRef.get();

  let user: DbUserDoc;

  if (existingSnap.exists) {
    const current = existingSnap.data() as DbUserDoc;
    let nextRole = current.role;

    if (isBootstrapAdmin && current.role !== 'admin') {
      nextRole = 'admin';
    } else if (isActiveSubAdmin && current.role !== 'admin' && current.role !== 'subadmin') {
      nextRole = 'subadmin';
    } else if (!emailVerified && (current.role === 'admin' || current.role === 'subadmin')) {
      // Unverified email cannot hold active admin/subadmin privileges
      nextRole = 'tourist';
    } else if (current.role === 'subadmin' && !isActiveSubAdmin) {
      nextRole = 'tourist';
    } else if (current.role === 'admin' && !isBootstrapAdmin) {
      // Administrador geral é só o dono. Qualquer outro "admin" gravado no banco perde o poder total.
      nextRole = isActiveSubAdmin ? 'subadmin' : 'tourist';
    }

    if (nextRole !== current.role || current.email !== email || current.name !== name) {
      const updates: Partial<DbUserDoc> = {
        role: nextRole,
        email,
        name,
        displayName: name,
        updatedAt: new Date().toISOString(),
      };
      await userRef.set(updates, { merge: true });
      user = { ...current, ...updates };
    } else {
      user = current;
    }
  } else {
    const id = await nextSeqId('users');
    const assignedRole: DbUserDoc['role'] = isBootstrapAdmin
      ? 'admin'
      : isActiveSubAdmin
      ? 'subadmin'
      : 'tourist';
    const now = new Date().toISOString();
    user = {
      id,
      uid: decoded.uid,
      email,
      name,
      displayName: name,
      role: assignedRole,
      preferredLang: 'pt',
      preferredCurrency: 'BRL',
      phone: null,
      lgpdConsentAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await userRef.set(user);
  }

  let permissions: string[] = [];
  const shouldBeAdminClaim =
    emailVerified &&
    (user.role === 'admin' || (user.role === 'subadmin' && Boolean(permData?.active)));

  if (emailVerified && user.role === 'admin') {
    permissions = ['*'];
    await adminDb
      .collection('admins')
      .doc(decoded.uid)
      .set(
        {
          uid: decoded.uid,
          email: normalizedEmail,
          permissions: ['*'],
          grantedBy: ADMIN_BOOTSTRAP_EMAIL,
          updatedAt: new Date(),
        },
        { merge: true }
      );
  } else if (emailVerified && user.role === 'subadmin' && permData?.active) {
    permissions = Array.isArray(permData.permissionsJson) ? permData.permissionsJson : [];
    await adminDb
      .collection('admins')
      .doc(decoded.uid)
      .set(
        {
          uid: decoded.uid,
          email: normalizedEmail,
          permissions,
          grantedBy: permData.grantedByEmail || ADMIN_BOOTSTRAP_EMAIL,
          updatedAt: new Date(),
        },
        { merge: true }
      );
  } else if (decoded.frocAdmin === true) {
    await adminDb.collection('admins').doc(decoded.uid).delete().catch(() => {});
  }

  const currentAdminClaim = decoded.frocAdmin === true;
  if (currentAdminClaim !== shouldBeAdminClaim) {
    await adminAuth
      .setCustomUserClaims(decoded.uid, { frocAdmin: shouldBeAdminClaim })
      .catch(() => {});
  }

  return { user, permissions };
}

export async function authenticateRequest(
  req: ApiRequest,
  res: ApiResponse
): Promise<AuthContext | null> {
  const authHeader = getHeader(req, 'authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendJson(res, 401, { error: 'Unauthorized: Missing token' });
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    sendJson(res, 401, { error: 'Unauthorized: Missing token' });
    return null;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const { user, permissions } = await getOrCreateDbUser(decoded);
    return {
      authUser: decoded,
      dbUser: user,
      adminPermissions: permissions,
    };
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    sendJson(res, 401, { error: 'Unauthorized: Invalid token' });
    return null;
  }
}

export async function optionalAuthenticateRequest(req: ApiRequest): Promise<AuthContext | null> {
  const authHeader = getHeader(req, 'authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const { user, permissions } = await getOrCreateDbUser(decoded);
    return {
      authUser: decoded,
      dbUser: user,
      adminPermissions: permissions,
    };
  } catch {
    return null;
  }
}

export async function requireAdminContext(
  req: ApiRequest,
  res: ApiResponse,
  requiredPermission?: string
): Promise<AuthContext | null> {
  const ctx = await authenticateRequest(req, res);
  if (!ctx) return null;

  if (ctx.authUser.email_verified !== true) {
    sendJson(res, 403, { error: 'Forbidden: Verified email required for administrator access' });
    return null;
  }

  if (ctx.dbUser.role !== 'admin' && ctx.dbUser.role !== 'subadmin') {
    sendJson(res, 403, { error: 'Forbidden: Administrator access required' });
    return null;
  }

  if (ctx.dbUser.role === 'subadmin' && ctx.adminPermissions.length === 0) {
    sendJson(res, 403, { error: 'Forbidden: Sub-administrator has no active permissions' });
    return null;
  }

  if (requiredPermission && !hasAdminPermission(ctx.adminPermissions, requiredPermission)) {
    sendJson(res, 403, {
      error: `Forbidden: Missing admin permission '${requiredPermission}'`,
    });
    return null;
  }

  return ctx;
}
