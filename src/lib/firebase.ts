import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Em testes (Node) import.meta.env não existe; no site o Vite preenche.
const env: Record<string, string | undefined> = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

const resolvedFirebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId:
    env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || firebaseConfig.appId,
  ...(env.VITE_FIREBASE_DATABASE_URL
    ? { databaseURL: env.VITE_FIREBASE_DATABASE_URL }
    : {}),
  ...(env.VITE_FIREBASE_MEASUREMENT_ID || firebaseConfig.measurementId
    ? { measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || firebaseConfig.measurementId }
    : {}),
};

const app = getApps().length ? getApp() : initializeApp(resolvedFirebaseConfig);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
