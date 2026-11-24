import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { FuturisticModalHeader } from './DesignSystem.tsx';

export const LegalComplianceModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  return (
    <div role="dialog" aria-modal="true" aria-label="Governança, LGPD, CDC e Termos de Uso" className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-xs overflow-y-auto p-4 md:p-8 flex justify-center items-start">
      <div className="w-full max-w-2xl bg-[#FFFFFF] rounded-2xl border-2 border-[#111111] shadow-2xl overflow-hidden my-6 froc-animate-modal">
        <FuturisticModalHeader
          title="Governança, LGPD, CDC e Termos de Uso"
          subtitle="Transparência jurídica e proteção ao turista Froc Rota"
          icon={<ShieldCheck className="w-5 h-5" />}
          onBack={onClose}
          onClose={onClose}
        />

        <div className="p-6 space-y-5 text-sm text-[#111111]/80 leading-relaxed">
          <section className="p-4 rounded-xl border border-[#111111]/15">
            <h4 className="font-extrabold text-[#111111]">
              1. Proteção de Dados Pessoais (LGPD — Lei nº 13.709/2018)
            </h4>
            <p className="mt-1">
              A Froc Rota Turismo coleta exclusivamente os dados necessários para autenticação,
              emissão de reservas, conciliação financeira e atendimento de concierge. Tokens de
              sessão não são persistidos em armazenamento local vulnerável, e o titular pode
              solicitar revisão ou exclusão de seus dados a qualquer momento.
            </p>
          </section>

          <section className="p-4 rounded-xl border border-[#111111]/15">
            <h4 className="font-extrabold text-[#111111]">
              2. Código de Defesa do Consumidor e Regras de Cancelamento
            </h4>
            <p className="mt-1">
              Todas as experiências, gastronomia e hospedagens exibem de forma clara o preço total,
              capacidade e política de cancelamento antes da contratação. Para compras à distância,
              aplica-se o direito de arrependimento de 7 dias previsto no art. 49 do CDC, respeitando
              as condições operacionais de datas iminentes informadas previamente.
            </p>
          </section>

          <section className="p-4 rounded-xl border border-[#111111]/15">
            <h4 className="font-extrabold text-[#111111]">
              3. Verificação de Fornecedores e Atividades de Risco (Cadastur)
            </h4>
            <p className="mt-1">
              Operadores de passeios náuticos, mergulho, buggys e guias passam por conferência de
              CNPJ/CPF e registro Cadastur / habilitação específica antes da ativação no marketplace.
            </p>
          </section>

          <section className="p-4 rounded-xl border border-[#111111]/15">
            <h4 className="font-extrabold text-[#111111]">
              4. Segurança Financeira e Serviços de Mapa
            </h4>
            <p className="mt-1">
              Dados completos de cartão bancário nunca trafegam ou são armazenados nos servidores da
              Froc Rota. Pagamentos são validados exclusivamente no servidor via webhooks assinados.
              Os recursos de mapa e geolocalização utilizam a Google Maps Platform sob os Termos de
              Serviço aplicáveis e mediante consentimento explícito de localização no navegador.
            </p>
          </section>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-5 py-2 rounded-xl froc-btn-neon text-xs font-extrabold"
            >
              Voltar e Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
