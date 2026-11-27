import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { FuturisticModalHeader } from './DesignSystem.tsx';
import { EMPRESA_SITE } from '../lib/empresa.ts';

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
            <h4 className="font-extrabold text-[#111111]">Quem é o fornecedor</h4>
            <p className="mt-1">
              {EMPRESA_SITE.nomeFantasia} · Razão social {EMPRESA_SITE.razaoSocial} · CNPJ {EMPRESA_SITE.cnpj} ·{' '}
              {EMPRESA_SITE.cidade}/{EMPRESA_SITE.uf}. Endereço completo, e-mail e Cadastur em{' '}
              <a href="/contato" className="underline font-bold">Contato</a>.
            </p>
          </section>

          <section className="p-4 rounded-xl border border-[#111111]/15">
            <h4 className="font-extrabold text-[#111111]">
              1. Proteção de Dados Pessoais (LGPD — Lei nº 13.709/2018)
            </h4>
            <p className="mt-1">
              A Froc Rota Turismo coleta somente os dados necessários para criar e proteger sua conta,
              fazer reservas, pagar os parceiros e atender você. Você pode corrigir seus dados em Minha
              Conta e excluir a conta sozinho em Minha Conta → Dados &amp; Segurança → Excluir minha conta. Detalhes na{' '}
              <a href="/politica-de-privacidade" className="underline font-bold">Política de Privacidade</a>.
            </p>
          </section>

          <section className="p-4 rounded-xl border border-[#111111]/15">
            <h4 className="font-extrabold text-[#111111]">
              2. Código de Defesa do Consumidor e Regras de Cancelamento
            </h4>
            <p className="mt-1">
              Preço total, o que está incluído e a política de cancelamento aparecem antes do pagamento.
              Em até 7 dias da compra (art. 49 do CDC) você cancela pelo site com devolução integral,
              desde que o serviço ainda não tenha começado; depois disso vale a política da oferta. Veja os{' '}
              <a href="/termos-de-uso" className="underline font-bold">Termos de Uso</a>.
            </p>
          </section>

          <section className="p-4 rounded-xl border border-[#111111]/15">
            <h4 className="font-extrabold text-[#111111]">
              3. Verificação de Fornecedores e Atividades de Risco (Cadastur)
            </h4>
            <p className="mt-1">
              Todo anunciante passa por verificação de identidade (CPF, foto do documento e selfie)
              antes de publicar. Guias, agências e passeios de aventura devem ter Cadastur e as licenças
              exigidas por lei, e respondem pela execução do serviço.
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
