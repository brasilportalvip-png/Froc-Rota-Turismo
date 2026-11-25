import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User as FirebaseUser } from 'firebase/auth';
import {
  auth,
  googleAuthProvider,
} from '../lib/firebase.ts';
import { AppCurrency, AppLanguage, DbUser, Merchant } from '../types.ts';

interface ToastMessage {
  id: number;
  text: string;
  type: 'info' | 'success' | 'error';
}

interface AppContextValue {
  firebaseUser: FirebaseUser | null;
  dbUser: DbUser | null;
  merchant: Merchant | null;
  adminPermissions: string[];
  hasAdminPermission: (perm: string) => boolean;
  isAnyAdmin: boolean;
  authLoading: boolean;
  language: AppLanguage;
  currency: AppCurrency;
  setLanguage: (lang: AppLanguage) => void;
  setCurrency: (curr: AppCurrency) => void;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  apiFetch: <T>(url: string, options?: RequestInit) => Promise<T>;
  notify: (text: string, type?: 'info' | 'success' | 'error') => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [dbUser, setDbUser] = useState<DbUser | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [adminPermissions, setAdminPermissions] = useState<string[]>([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [language, setLanguageState] = useState<AppLanguage>('pt');
  const [currency, setCurrencyState] = useState<AppCurrency>('BRL');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback((text: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const syncProfile = useCallback(async (token: string, fbUser: FirebaseUser) => {
    try {
      const res = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          user: DbUser;
          merchant: Merchant | null;
          adminPermissions?: string[];
        };
        setDbUser(data.user);
        setMerchant(data.merchant);
        setAdminPermissions(data.adminPermissions || []);
        if (data.user.preferredLang) setLanguageState(data.user.preferredLang);
        if (data.user.preferredCurrency) setCurrencyState(data.user.preferredCurrency);

        if (
          fbUser.emailVerified &&
          (data.user.role === 'admin' || data.user.role === 'subadmin')
        ) {
          const tokenResult = await fbUser.getIdTokenResult();
          if (tokenResult.claims.frocAdmin !== true) {
            const refreshedToken = await fbUser.getIdToken(true);
            setIdToken(refreshedToken);
          }
        }
      }
    } catch (err) {
      console.error('Profile sync error:', err);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        const token = await user.getIdToken();
        setIdToken(token);
        await syncProfile(token, user);
      } else {
        setIdToken(null);
        setDbUser(null);
        setMerchant(null);
        setAdminPermissions([]);
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, [syncProfile]);

  const apiFetch = useCallback(
    async <T,>(url: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && options.body) {
        headers.set('Content-Type', 'application/json');
      }
      if (firebaseUser) {
        const freshToken = await firebaseUser.getIdToken();
        setIdToken(freshToken);
        headers.set('Authorization', `Bearer ${freshToken}`);
      } else if (idToken) {
        headers.set('Authorization', `Bearer ${idToken}`);
      }

      const res = await fetch(url, { ...options, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || `Erro HTTP ${res.status}`);
      }
      return data as T;
    },
    [firebaseUser, idToken]
  );

  const loginWithGoogle = useCallback(async () => {
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const token = await cred.user.getIdToken();
      setIdToken(token);
      await syncProfile(token, cred.user);
      notify('Sessão iniciada com segurança.', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Não foi possível entrar.';
      notify(msg, 'error');
    }
  }, [notify, syncProfile]);

  const logout = useCallback(async () => {
    await signOut(auth);
    setIdToken(null);
    setDbUser(null);
    setMerchant(null);
    setAdminPermissions([]);
    notify('Você saiu da sua conta.', 'info');
  }, [notify]);

  const refreshProfile = useCallback(async () => {
    if (firebaseUser) {
      const token = await firebaseUser.getIdToken();
      await syncProfile(token, firebaseUser);
    }
  }, [firebaseUser, syncProfile]);

  const setLanguage = useCallback(
    async (lang: AppLanguage) => {
      setLanguageState(lang);
      if (firebaseUser) {
        await apiFetch('/api/me', {
          method: 'PATCH',
          body: JSON.stringify({ preferredLang: lang }),
        }).catch(() => {});
      }
    },
    [apiFetch, firebaseUser]
  );

  const setCurrency = useCallback(
    async (curr: AppCurrency) => {
      setCurrencyState(curr);
      if (firebaseUser) {
        await apiFetch('/api/me', {
          method: 'PATCH',
          body: JSON.stringify({ preferredCurrency: curr }),
        }).catch(() => {});
      }
    },
    [apiFetch, firebaseUser]
  );

  const isAnyAdmin = dbUser?.role === 'admin' || dbUser?.role === 'subadmin';
  const hasAdminPermission = useCallback(
    (perm: string) => {
      if (!dbUser) return false;
      if (dbUser.role === 'admin' || adminPermissions.includes('*')) return true;
      return dbUser.role === 'subadmin' && adminPermissions.includes(perm);
    },
    [dbUser, adminPermissions]
  );

  return (
    <AppContext.Provider
      value={{
        firebaseUser,
        dbUser,
        merchant,
        adminPermissions,
        hasAdminPermission,
        isAnyAdmin,
        authLoading,
        language,
        currency,
        setLanguage,
        setCurrency,
        loginWithGoogle,
        logout,
        refreshProfile,
        apiFetch,
        notify,
      }}
    >
      {children}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[96] flex flex-col gap-2 max-w-sm">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={`px-4 py-3 rounded-xl border-2 shadow-xl text-sm font-bold froc-animate-popup ${
                t.type === 'error'
                  ? 'bg-[#FFFFFF] border-[#FF1493] text-[#111111]'
                  : t.type === 'success'
                  ? 'bg-[#111111] border-[#39FF14] text-[#FFFFFF]'
                  : 'bg-[#FFFFFF] border-[#111111] text-[#111111]'
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                style={{
                  backgroundColor:
                    t.type === 'error' ? '#FF1493' : t.type === 'success' ? '#39FF14' : '#FFD700',
                }}
              />
              {t.text}
            </div>
          ))}
        </div>
      )}
    </AppContext.Provider>
  );
};

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
