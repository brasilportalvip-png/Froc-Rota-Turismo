import React, { useEffect, useState } from 'react';
import { sendPasswordResetEmail, updatePassword } from 'firebase/auth';
import { auth } from '../lib/firebase.ts';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Lock, ShieldCheck, X } from 'lucide-react';

export interface FuturisticModalHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onBack?: () => void;
  onClose: () => void;
  actions?: React.ReactNode;
}

export const FuturisticModalHeader: React.FC<FuturisticModalHeaderProps> = ({
  title,
  subtitle,
  icon,
  onBack,
  onClose,
  actions,
}) => {
  return (
    <div className="bg-[#111111] text-[#FFFFFF] shrink-0">
      <div className="px-4 md:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="min-h-[44px] min-w-[44px] px-2.5 rounded-lg border border-white/20 text-white hover:border-[#39FF14] hover:text-[#39FF14] transition-colors inline-flex items-center justify-center gap-1 text-xs font-semibold shrink-0"
              aria-label="Voltar"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Voltar</span>
            </button>
          )}
          {icon && (
            <div className="w-9 h-9 rounded-lg bg-white/10 border border-[#FFD700]/40 flex items-center justify-center text-[#FFD700] shrink-0">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-base md:text-lg font-bold tracking-tight truncate">{title}</h2>
            {subtitle && <p className="text-[11px] text-white/75 truncate">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {actions}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="min-h-[44px] min-w-[44px] rounded-lg border border-white/20 text-white hover:border-[#FF1493] hover:text-[#FF1493] transition-colors flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className="h-[3px] w-full froc-prism-bar" />
    </div>
  );
};

export const AnimatedCounter: React.FC<{
  value: number;
  suffix?: string;
  prefix?: string;
  durationMs?: number;
}> = ({ value, suffix = '', prefix = '', durationMs = 700 }) => {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || durationMs <= 0) {
      setDisplay(value);
      return;
    }

    let rafId = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [value, durationMs]);

  return (
    <span className="font-mono-tabular">
      {prefix}
      {display.toLocaleString('pt-BR')}
      {suffix}
    </span>
  );
};

export function evaluatePasswordStrength(pwd: string): {
  score: number;
  label: string;
  color: string;
} {
  if (!pwd) return { score: 0, label: 'Digite uma senha', color: '#E5E7EB' };
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
  if (/[0-9]/.test(pwd)) score += 1;
  if (/[^A-Za-z0-9]/.test(pwd) && pwd.length >= 10) score += 1;

  if (score <= 1) return { score: 1, label: 'Fraca (mín. 8 caracteres)', color: '#FF1493' };
  if (score === 2) return { score: 2, label: 'Moderada', color: '#FFD700' };
  if (score === 3) return { score: 3, label: 'Forte', color: '#39FF14' };
  return { score: 4, label: 'Muito forte', color: '#39FF14' };
}

export interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  showStrength?: boolean;
  error?: string | null;
  autoComplete?: string;
}

export const PasswordField: React.FC<PasswordFieldProps> = ({
  id,
  label,
  value,
  onChange,
  placeholder = 'Digite sua senha segura',
  showStrength = false,
  error = null,
  autoComplete = 'new-password',
}) => {
  // Always hidden by default; never auto-revealed
  const [visible, setVisible] = useState(false);
  const strength = showStrength ? evaluatePasswordStrength(value) : null;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-bold text-[#111111]">
        {label}
      </label>
      <div className="relative">
        <Lock className="w-4 h-4 text-[#111111]/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={`w-full pl-9 pr-12 py-2.5 min-h-[44px] rounded-xl border text-sm text-[#111111] bg-white focus:outline-none transition-colors ${
            error
              ? 'border-[#FF1493] focus:ring-2 focus:ring-[#FF1493]/30'
              : 'border-[#111111]/25 focus:border-[#111111] focus:ring-2 focus:ring-[#39FF14]/40'
          }`}
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visible}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[38px] min-w-[38px] rounded-lg flex items-center justify-center text-[#111111] hover:bg-[#111111]/5 transition-colors"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      {showStrength && strength && value.length > 0 && (
        <div className="space-y-1 pt-0.5">
          <div className="grid grid-cols-4 gap-1 h-1.5">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className="rounded-full transition-colors"
                style={{
                  backgroundColor: strength.score >= step ? strength.color : '#E5E7EB',
                  border: strength.score >= step ? '1px solid #111111' : 'none',
                }}
              />
            ))}
          </div>
          <div className="text-[11px] font-semibold text-[#111111]">
            Força da senha: <span>{strength.label}</span>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs font-semibold text-[#FF1493]">
          {error}
        </p>
      )}
    </div>
  );
};

export const SecurityPinCard: React.FC<{
  title?: string;
  onSuccessMessage?: (msg: string) => void;
}> = ({
  title = 'Senha da conta',
  onSuccessMessage,
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const strength = evaluatePasswordStrength(password);
  const mismatch =
    confirmPassword.length > 0 && password !== confirmPassword
      ? 'As senhas digitadas não coincidem.'
      : null;

  // Troca de senha DE VERDADE na conta (Firebase Authentication).
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (password.length < 8 || strength.score < 2) {
      setErrorMsg('Use ao menos 8 caracteres combinando letras maiúsculas, minúsculas ou números.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('A confirmação da senha não coincide.');
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      setErrorMsg('Entre na sua conta para trocar a senha.');
      return;
    }
    if (!user.providerData.some((p) => p.providerId === 'password')) {
      setErrorMsg('Sua conta entra pelo Google: a senha é a da sua conta Google.');
      return;
    }
    setSaving(true);
    try {
      await updatePassword(user, password);
      setPassword('');
      setConfirmPassword('');
      setSavedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      onSuccessMessage?.('Senha alterada com sucesso.');
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/requires-recent-login') {
        setErrorMsg('Por segurança, saia e entre de novo na conta e repita a troca — ou use "Receber link por e-mail".');
      } else if (code === 'auth/weak-password') {
        setErrorMsg('Senha fraca. Use pelo menos 8 caracteres com letras e números.');
      } else {
        setErrorMsg('Não foi possível trocar a senha agora. Tente novamente.');
      }
    } finally {
      setSaving(false);
    }
  };

  const enviarLink = async () => {
    const email = auth.currentUser?.email;
    if (!email) {
      setErrorMsg('Entre na sua conta para receber o link.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      onSuccessMessage?.(`Enviamos um link para ${email} para você criar uma nova senha.`);
    } catch {
      setErrorMsg('Não foi possível enviar o link agora. Tente novamente.');
    }
  };

  return (
    <form
      onSubmit={handleSave}
      className="p-5 rounded-2xl border border-[#111111] bg-[#FFFFFF] space-y-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-[#111111]" />
          <div>
            <h4 className="text-sm font-bold text-[#111111]">{title}</h4>
            <p className="text-xs text-[#111111]/70">
              Troque a senha que você usa para entrar na Froc Rota.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PasswordField
          id="froc-sec-password"
          label="Nova senha"
          value={password}
          onChange={(val) => {
            setPassword(val);
            setErrorMsg(null);
          }}
          showStrength
        />
        <PasswordField
          id="froc-sec-password-confirm"
          label="Confirmar senha"
          value={confirmPassword}
          onChange={(val) => {
            setConfirmPassword(val);
            setErrorMsg(null);
          }}
          placeholder="Repita exatamente a senha"
          error={mismatch}
        />
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl border border-[#FF1493] bg-[#FF1493]/5 text-xs font-semibold text-[#111111]">
          {errorMsg}
        </div>
      )}

      {savedAt && (
        <div className="p-3 rounded-xl border border-[#111111] bg-[#39FF14]/20 text-xs font-semibold text-[#111111] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Senha alterada às {savedAt}.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={enviarLink}
          className="min-h-[44px] px-4 py-2 rounded-xl border border-[#111111]/30 text-xs font-bold text-[#111111] hover:bg-[#111111]/5 mr-auto"
        >
          Receber link por e-mail
        </button>
        {(password || confirmPassword) && (
          <button
            type="button"
            onClick={() => {
              setPassword('');
              setConfirmPassword('');
              setErrorMsg(null);
            }}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-[#111111]/30 text-xs font-bold text-[#111111] hover:bg-[#111111]/5"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="min-h-[44px] px-5 py-2 rounded-xl froc-btn-neon text-xs font-bold disabled:opacity-60"
        >
          {saving ? 'Salvando...' : 'Trocar senha'}
        </button>
      </div>
    </form>
  );
};
