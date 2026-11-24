import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Erro inesperado na interface.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Froc Rota ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let friendly = 'Ocorreu uma instabilidade temporária ao sincronizar seus dados.';
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string; operationType?: string };
        if (parsed.error) {
          friendly = `Falha segura (${parsed.operationType || 'dados'}): ${parsed.error}`;
        }
      } catch {
        // non-JSON error
      }

      return (
        <div className="min-h-screen bg-white flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-2xl border-2 border-[#FFD700] shadow-xl p-6 space-y-4">
            <div className="inline-block px-2.5 py-1 rounded bg-[#111111] text-[#39FF14] text-[10px] font-extrabold uppercase tracking-wider">
              🛡️ Proteção Froc Rota
            </div>
            <h2 className="text-lg font-extrabold text-[#111111]">Recuperação Segura Froc Rota</h2>
            <p className="text-sm text-[#111111]/75">{friendly}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="froc-btn-neon px-5 py-2.5 rounded-xl text-xs font-extrabold"
            >
              Recarregar Plataforma
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
