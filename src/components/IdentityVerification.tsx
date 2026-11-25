import React, { useState } from 'react';
import { Calendar, CheckCircle2, FileText, Send, Shield, ShieldCheck, UserCheck } from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { IdentityPublic } from '../types.ts';

/** Formata enquanto digita: 000.000.000-00 */
export function formatCpfInput(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

/** Mesmo cálculo do servidor (dígitos verificadores), para avisar antes de enviar. */
export function isValidCpfClient(value: string): boolean {
  const cpf = value.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/** Reduz a foto no navegador (máx. 1280px, JPEG) para caber no envio e não gastar internet. */
async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não foi possível abrir a foto.'));
      el.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Navegador sem suporte a fotos.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.8, 0.7, 0.6, 0.5]) {
      const data = canvas.toDataURL('image/jpeg', q);
      if (data.length < 650_000) return data;
    }
    throw new Error('Foto muito pesada. Tire outra com menos zoom.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const STATUS_TEXT: Record<IdentityPublic['status'], { title: string; tone: string }> = {
  none: { title: 'Verificação pendente', tone: '#FFD700' },
  pending: { title: 'Analisando suas fotos...', tone: '#FFD700' },
  approved: { title: 'Identidade verificada', tone: '#39FF14' },
  rejected: { title: 'Verificação não aprovada', tone: '#FF1493' },
  manual_review: { title: 'Em análise pela equipe', tone: '#FFD700' },
};

interface Props {
  /** Texto curto do motivo (ex.: "para reservar"). */
  purpose?: string;
  onApproved?: () => void;
  compact?: boolean;
}

export const IdentityVerification: React.FC<Props> = ({ purpose = 'para reservar e anunciar', onApproved, compact }) => {
  const {
    apiFetch,
    dbUser,
    emailVerified,
    identity,
    notify,
    recheckEmailVerified,
    refreshProfile,
    requestLogin,
    resendVerificationEmail,
  } = useApp();
  const [fullName, setFullName] = useState(dbUser?.name || '');
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [docPreview, setDocPreview] = useState<string | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'document' | 'selfie' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!dbUser) {
    return (
      <div className="p-4 rounded-2xl border-2 border-[#111111] bg-white space-y-2">
        <p className="text-sm font-bold text-[#111111]">Entre na sua conta {purpose}.</p>
        <button type="button" onClick={() => void requestLogin()} className="min-h-[44px] px-4 rounded-xl froc-btn-neon text-xs font-extrabold">
          Entrar ou criar conta
        </button>
      </div>
    );
  }

  if (dbUser.role === 'admin' || dbUser.role === 'subadmin') return null;

  if (!emailVerified) {
    return (
      <div className="p-4 rounded-2xl border-2 border-[#111111] bg-white space-y-3">
        <div className="flex items-start gap-2.5">
          <Send className="w-5 h-5 shrink-0 text-[#111111]" />
          <div>
            <p className="text-sm font-extrabold text-[#111111]">Confirme seu e-mail</p>
            <p className="text-xs text-[#111111]/75">
              Enviamos um link para <strong>{dbUser.email}</strong>. Clique nele e depois toque em "Já confirmei".
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              if (await recheckEmailVerified()) notify('E-mail confirmado!', 'success');
            }}
            className="min-h-[44px] px-4 rounded-xl froc-btn-neon text-xs font-extrabold"
          >
            Já confirmei
          </button>
          <button
            type="button"
            onClick={() => void resendVerificationEmail()}
            className="min-h-[44px] px-4 rounded-xl border border-[#111111]/25 text-xs font-bold text-[#111111]"
          >
            Reenviar e-mail
          </button>
        </div>
      </div>
    );
  }

  const status = identity?.status ?? 'none';
  const info = STATUS_TEXT[status];

  if (status === 'approved') {
    return compact ? null : (
      <div className="p-3.5 rounded-2xl border-2 border-[#111111] bg-[#39FF14]/15 flex items-center gap-2.5">
        <CheckCircle2 className="w-5 h-5 text-[#111111]" />
        <div className="text-xs text-[#111111]">
          <strong>Identidade verificada</strong>
          {identity?.cpfMasked ? <> · CPF {identity.cpfMasked}</> : null}
        </div>
      </div>
    );
  }

  if (status === 'manual_review' || status === 'pending') {
    return (
      <div className="p-4 rounded-2xl border-2 border-[#111111] bg-white space-y-2">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-[#111111]" />
          <p className="text-sm font-extrabold text-[#111111]">{info.title}</p>
        </div>
        <p className="text-xs text-[#111111]/75">
          Nossa equipe vai conferir suas fotos. Você recebe uma notificação quando terminar.
        </p>
        <button
          type="button"
          onClick={() => void refreshProfile()}
          className="min-h-[40px] px-3 rounded-xl border border-[#111111]/25 text-xs font-bold text-[#111111]"
        >
          Atualizar situação
        </button>
      </div>
    );
  }

  const upload = async (kind: 'document' | 'selfie', file: File | undefined) => {
    if (!file) return;
    setError(null);
    setUploading(kind);
    try {
      const data = await compressImage(file);
      await apiFetch('/api/identity/image', { method: 'POST', body: JSON.stringify({ kind, image: data }) });
      if (kind === 'document') setDocPreview(data);
      else setSelfiePreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar a foto.');
    } finally {
      setUploading(null);
    }
  };

  const hasDoc = Boolean(docPreview || identity?.hasDocumentImage);
  const hasSelfie = Boolean(selfiePreview || identity?.hasSelfieImage);
  const cpfOk = isValidCpfClient(cpf);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!cpfOk) {
      setError('CPF inválido. Confira os números.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{ identity: IdentityPublic }>('/api/identity/submit', {
        method: 'POST',
        body: JSON.stringify({ fullName, cpf, birthDate }),
      });
      await refreshProfile();
      if (res.identity.status === 'approved') {
        notify('Identidade verificada! Você já pode continuar.', 'success');
        onApproved?.();
      } else if (res.identity.status === 'rejected') {
        setError(res.identity.reason || 'Não aprovado. Tire fotos novas e tente de novo.');
        setDocPreview(null);
        setSelfiePreview(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na verificação.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="p-4 rounded-2xl border-2 border-[#111111] bg-white space-y-3">
      <div className="flex items-start gap-2.5">
        {status === 'rejected' ? (
          <Shield className="w-5 h-5 shrink-0 text-[#FF1493]" />
        ) : (
          <ShieldCheck className="w-5 h-5 shrink-0 text-[#111111]" />
        )}
        <div>
          <p className="text-sm font-extrabold text-[#111111]">
            {status === 'rejected' ? info.title : `Verifique sua identidade ${purpose}`}
          </p>
          <p className="text-xs text-[#111111]/75">
            {status === 'rejected' && identity?.reason
              ? identity.reason
              : 'Obrigatório: CPF verdadeiro, foto do documento (RG ou CNH) e uma selfie. A IA confere na hora.'}
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label htmlFor="kyc-name" className="block text-xs font-bold text-[#111111] mb-1">
            Nome completo (igual ao documento)
          </label>
          <input
            id="kyc-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            required
            className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-[#111111]/25 text-sm"
          />
        </div>
        <div>
          <label htmlFor="kyc-cpf" className="block text-xs font-bold text-[#111111] mb-1">
            CPF
          </label>
          <input
            id="kyc-cpf"
            inputMode="numeric"
            value={cpf}
            onChange={(e) => setCpf(formatCpfInput(e.target.value))}
            placeholder="000.000.000-00"
            required
            aria-invalid={cpf.length === 14 && !cpfOk}
            className={`w-full px-3 py-2.5 min-h-[44px] rounded-xl border text-sm ${
              cpf.length === 14 && !cpfOk ? 'border-[#FF1493]' : 'border-[#111111]/25'
            }`}
          />
          {cpf.length === 14 && !cpfOk && (
            <p className="text-[11px] font-semibold text-[#FF1493] mt-1">CPF inválido.</p>
          )}
        </div>
        <div>
          <label htmlFor="kyc-birth" className="block text-xs font-bold text-[#111111] mb-1">
            Data de nascimento
          </label>
          <input
            id="kyc-birth"
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            required
            className="w-full px-3 py-2.5 min-h-[44px] rounded-xl border border-[#111111]/25 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(
          [
            { kind: 'document' as const, label: 'Foto do documento', hint: 'RG ou CNH, frente com foto', icon: FileText, done: hasDoc, preview: docPreview, capture: 'environment' as const },
            { kind: 'selfie' as const, label: 'Selfie', hint: 'Rosto de frente, boa luz', icon: UserCheck, done: hasSelfie, preview: selfiePreview, capture: 'user' as const },
          ]
        ).map((f) => (
          <label
            key={f.kind}
            className={`relative flex flex-col items-center justify-center text-center gap-1 p-3 min-h-[120px] rounded-xl border-2 border-dashed cursor-pointer ${
              f.done ? 'border-[#111111] bg-[#39FF14]/10' : 'border-[#111111]/30'
            }`}
          >
            {f.preview ? (
              <img src={f.preview} alt={f.label} className="w-full h-20 object-cover rounded-lg" />
            ) : (
              <f.icon className="w-6 h-6 text-[#111111]" />
            )}
            <span className="text-xs font-bold text-[#111111]">
              {uploading === f.kind ? 'Enviando...' : f.done ? `${f.label} ✓` : f.label}
            </span>
            <span className="text-[10px] text-[#111111]/65">{f.hint}</span>
            <input
              type="file"
              accept="image/*"
              capture={f.capture}
              className="sr-only"
              onChange={(e) => void upload(f.kind, e.target.files?.[0])}
            />
          </label>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-xs font-semibold text-[#FF1493]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !!uploading || !hasDoc || !hasSelfie || !cpfOk || !birthDate || fullName.trim().split(/\s+/).length < 2}
        className="w-full min-h-[46px] py-3 rounded-xl froc-btn-neon text-sm font-extrabold disabled:opacity-50"
      >
        {submitting ? 'A IA está conferindo...' : 'Enviar para verificação'}
      </button>
      <p className="text-[10px] text-[#111111]/60 leading-relaxed">
        Seus dados ficam protegidos (LGPD): o CPF é guardado mascarado e as fotos só são vistas pela análise
        anti-fraude.
      </p>
    </form>
  );
};
