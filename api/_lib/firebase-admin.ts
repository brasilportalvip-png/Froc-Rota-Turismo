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
  // import.meta.dirname não existe em todo Node/empacotamento: sem ele, path.resolve(undefined)
  // derrubava a função inteira ao carregar (500 FUNCTION_INVOCATION_FAILED).
  const here = typeof import.meta.dirname === 'string' ? import.meta.dirname : null;
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    ...(here ? [path.resolve(here, '../../firebase-applet-config.json')] : []),
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

/**
 * Motivo de o Firebase Admin não estar pronto (null = ok). A função não pode cair ao carregar:
 * com a chave ausente ou inválida, as rotas respondem 503 com o motivo e /api/health mostra o problema.
 */
export let firebaseInitError: string | null = serviceAccount
  ? null
  : process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim()
    ? 'FIREBASE_SERVICE_ACCOUNT_KEY está preenchida, mas não é um JSON válido de conta de serviço.'
    : 'FIREBASE_SERVICE_ACCOUNT_KEY não está configurada na Vercel.';

function createApp() {
  if (getApps().length) return getApp();
  if (serviceAccount) {
    try {
      return initializeApp({ credential: cert(serviceAccount), projectId: resolvedFirebaseProjectId });
    } catch (err) {
      firebaseInitError = `FIREBASE_SERVICE_ACCOUNT_KEY inválida: ${err instanceof Error ? err.message : String(err)}`;
      console.error(firebaseInitError);
    }
  }
  return initializeApp({ credential: applicationDefault(), projectId: resolvedFirebaseProjectId });
}

const app = createApp();

export const adminAuth = getAuth(app);
export const adminDb =
  resolvedFirestoreDatabaseId && resolvedFirestoreDatabaseId !== '(default)'
    ? getFirestore(app, resolvedFirestoreDatabaseId)
    : getFirestore(app);

/** Situação do Firebase Admin para o /api/health (sem expor segredos). */
export async function getFirebaseStatus(timeoutMs = 6000) {
  const base = {
    projectId: resolvedFirebaseProjectId,
    databaseId: resolvedFirestoreDatabaseId,
    serviceAccount: serviceAccount ? 'configurada' : 'ausente',
  };
  if (firebaseInitError) return { ok: false, ...base, error: firebaseInitError };
  try {
    await Promise.race([
      adminDb.collection('_meta').limit(1).get(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`sem resposta do Firestore em ${timeoutMs / 1000}s`)), timeoutMs)),
    ]);
    return { ok: true, ...base };
  } catch (err) {
    return { ok: false, ...base, error: err instanceof Error ? err.message.split('\n')[0].slice(0, 300) : String(err) };
  }
}
