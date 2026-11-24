import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const resolvedProjectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  firebaseConfig.projectId;

const app = getApps().length
  ? getApp()
  : initializeApp({
      projectId: resolvedProjectId,
    });

export const adminAuth = getAuth(app);
