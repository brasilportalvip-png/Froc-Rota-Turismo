import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
  User as FirebaseUser,
} from 'firebase/auth';
import { Lock, Send } from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { FuturisticModalHeader, PasswordField } from './DesignSystem.tsx';

type Mode = 'login' | 'signup' | 'reset';

/** Mensagens do Firebase em português simples. */
export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  const map: Record<string, string> = {
    'auth/invalid-email': 'E-mail inválido.',
    'auth/missing-password': 'Digite a senha.',
    'auth/weak-password': 'Senha fraca: use pelo menos 8 caracteres.',
    'auth/email-already-in-use': 'Este e-mail já tem conta. Use "Entrar" ou "Esqueci a senha".',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/user-disabled': 'Esta conta foi bloqueada. Fale com o suporte.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    'auth/popup-closed-by-user': 'Janela do Google fechada antes de terminar.',
    'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Libere pop-ups e tente de novo.',
    'auth/operation-not-allowed': 'Este tipo de login ainda não está ligado no Firebase.',
    'auth/network-request-failed': 'Sem conexão. Verifique a internet.',
    'auth/account-exists-with-different-credential': 'Este e-mail já entra por outro método (senha ou Google).',
  };
  return map[code] || 'Não foi possível entrar agora. Tente novamente.';
}

interface Props {
  onClose: () => void;
  onAuthenticated: (user: FirebaseUser, message: string) => Promise<void>;
}

export const AuthModal: React.FC<Props> = ({ onClose, onAuthenticated }) => {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (mode === 'reset') {
      void run(async () => {
        await sendPasswordResetEmail(auth, cleanEmail);
        setInfo(`Se ${cleanEmail} tiver conta, enviamos o link para criar nova senha. Veja também o spam.`);
      });
      return;
    }
    if (mode === 'signup') {
      if (name.trim().split(/\s+/).length < 2) {
        setError('Informe nome e sobrenome.');
        return;
      }
      if (password.length < 8) {
        setError('Senha fraca: use pelo menos 8 caracteres.');
        return;
      }
      void run(async () => {
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        await updateProfile(cred.user, { displayName: name.trim() });
        await sendEmailVerification(cred.user);
        await onAuthenticated(
          cred.user,
          `Conta criada! Enviamos um link de confirmação para ${cleanEmail}.`
        );
      });
      return;
    }
    void run(async () => {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      await onAuthenticated(cred.user, 'Sessão iniciada com segurança.');
    });
  };

  const google = () =>
    run(async () => {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      await onAuthenticated(cred.user, 'Sessão iniciada com segurança.');
    });

  const title = mode === 'signup' ? 'Criar conta' : mode === 'reset' ? 'Recuperar senha' : 'Entrar';

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md bg-[#FFFFFF] rounded-2xl border-2 border-[#111111] shadow-2xl overflow-hidden my-4 froc-animate-modal">
        <FuturisticModalHeader
          title={title}
          subtitle="Froc Rota Turismo"
          icon={<Lock className="w-4 h-4" />}
          onClose={onClose}
        />
        <div className="p-6 space-y-4">
          {mode !== 'reset' && (
            <div className="grid grid-cols-2 gap-2" role="tablist">
              {(['login', 'signup'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => {
                    setMode(m);
                    setError(null);
                    setInfo(null);
                  }}
                  className={`min-h-[44px] rounded-xl border text-xs font-bold ${
                    mode === m
                      ? 'border-[#111111] bg-[#111111] text-[#39FF14]'
                      : 'border-[#111111]/25 text-[#111111]'
                  }`}
                >
                  {m === 'login' ? 'Já tenho conta' : 'Criar conta'}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={submit} className="space-y-3" noValidate>
            {mode === 'signup' && (
              <div className="space-y-1.5">
                <label htmlFor="auth-name" className="block text-xs font-bold text-[#111111]">
                  Nome completo
                </label>
                <input
                  id="auth-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-[#111111]/25 text-sm"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="auth-email" className="block text-xs font-bold text-[#111111]">
                E-mail
              </label>
              <div className="relative">
                <Send className="w-4 h-4 text-[#111111]/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 min-h-[44px] rounded-xl border border-[#111111]/25 text-sm"
                />
              </div>
            </div>
            {mode !== 'reset' && (
              <PasswordField
                id="auth-password"
                label="Senha"
                value={password}
                onChange={setPassword}
                showStrength={mode === 'signup'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={mode === 'signup' ? 'Mínimo 8 caracteres' : 'Sua senha'}
              />
            )}

            {error && (
              <p role="alert" className="text-xs font-semibold text-[#FF1493]">
                {error}
              </p>
            )}
            {info && (
              <p role="status" className="text-xs font-semibold text-[#111111] bg-[#39FF14]/20 border border-[#111111]/20 rounded-lg p-2.5">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !email.trim() || (mode !== 'reset' && !password)}
              className="w-full min-h-[46px] py-3 rounded-xl froc-btn-neon text-sm font-extrabold disabled:opacity-50"
            >
              {busy
                ? 'Aguarde...'
                : mode === 'signup'
                ? 'Criar conta'
                : mode === 'reset'
                ? 'Enviar link de nova senha'
                : 'Entrar'}
            </button>
          </form>

          {mode === 'login' && (
            <button
              type="button"
              onClick={() => {
                setMode('reset');
                setError(null);
                setInfo(null);
              }}
              className="w-full text-xs font-semibold text-[#111111] underline underline-offset-2"
            >
              Esqueci a senha
            </button>
          )}
          {mode === 'reset' && (
            <button
              type="button"
              onClick={() => setMode('login')}
              className="w-full text-xs font-semibold text-[#111111] underline underline-offset-2"
            >
              Voltar para entrar
            </button>
          )}

          {mode !== 'reset' && (
            <>
              <div className="flex items-center gap-3 text-[11px] text-[#111111]/60">
                <div className="h-px flex-1 bg-[#111111]/15" /> ou <div className="h-px flex-1 bg-[#111111]/15" />
              </div>
              <button
                type="button"
                onClick={google}
                disabled={busy}
                className="w-full min-h-[46px] py-3 rounded-xl border-2 border-[#111111] text-sm font-bold text-[#111111] hover:bg-[#111111]/5 disabled:opacity-50"
              >
                Continuar com Google
              </button>
            </>
          )}
          <p className="text-[11px] text-[#111111]/65 leading-relaxed">
            Para reservar ou anunciar, a Froc Rota confirma seu e-mail e sua identidade (CPF + foto do
            documento + selfie). Isso protege turistas e parceiros contra fraude.
          </p>
        </div>
      </div>
    </div>
  );
};
