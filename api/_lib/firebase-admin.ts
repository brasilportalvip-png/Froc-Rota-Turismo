import fs from 'node:fs';
import path from 'node:path';
import { applicationDefault, cert, getApp, getApps, initializeApp, ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

interface AppletFirebaseConfig {
  projectId: string;
  firestoreDatabaseId?: string;
}

const DEFAULT_PROJECT_ID = 'gen-lang-client-0017976966';
const DEFAULT_DATABASE_ID = 'ai-studio-frocrotaturismo-3e6c725f-0ee8-4ca4-9cfb-564735f03a69';

function loadAppletConfig(): AppletFirebaseConfig {
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(import.meta.dirname, '../../firebase-applet-config.json'),
  ];

  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<AppletFirebaseConfig>;
        if (parsed.projectId) {
          return {
            projectId: parsed.projectId,
            firestoreDatabaseId: parsed.firestoreDatabaseId || DEFAULT_DATABASE_ID,
          };
        }
      }
    } catch {
      // ignore read errors and fallback
    }
  }

  return {
    projectId: DEFAULT_PROJECT_ID,
    firestoreDatabaseId: DEFAULT_DATABASE_ID,
  };
}

function parseServiceAccountFromEnv(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (!raw) return null;

  try {
    const jsonStr = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    if (typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed as unknown as ServiceAccount;
  } catch (err) {
    console.error('Invalid FIREBASE_SERVICE_ACCOUNT_KEY JSON:', err);
    return null;
  }
}

const appletConfig = loadAppletConfig();
const serviceAccount = parseServiceAccountFromEnv();

export const resolvedFirebaseProjectId =
  process.env.FIREBASE_PROJECT_ID?.trim() ||
  (serviceAccount as { project_id?: string } | null)?.project_id ||
  appletConfig.projectId;

export const resolvedFirestoreDatabaseId =
  process.env.FIREBASE_DATABASE_ID?.trim() ||
  appletConfig.firestoreDatabaseId ||
  DEFAULT_DATABASE_ID;

const app = getApps().length
  ? getApp()
  : initializeApp(
      serviceAccount
        ? {
            credential: cert(serviceAccount),
            projectId: resolvedFirebaseProjectId,
          }
        : {
            credential: applicationDefault(),
            projectId: resolvedFirebaseProjectId,
          }
    );

export const adminAuth = getAuth(app);
export const adminDb =
  resolvedFirestoreDatabaseId && resolvedFirestoreDatabaseId !== '(default)'
    ? getFirestore(app, resolvedFirestoreDatabaseId)
    : getFirestore(app);
