import React, { useState } from 'react';
import { useApp } from '../context/AppContext.tsx';

/** Admin: trocar a foto real de um destino (se a escolhida automaticamente não ficou boa). */
export const AdminFotosPanel: React.FC = () => {
  const { apiFetch, notify } = useApp();
  const [slug, setSlug] = useState('');
  const [arquivo, setArquivo] = useState('');
  const [foto, setFoto] = useState<{ url500: string; author: string; license: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    try {
      const r = await apiFetch<{ foto: { url500: string; author: string; license: string } }>('/api/admin/fotos', {
        method: 'POST',
        body: JSON.stringify({ slug: slug.trim(), arquivo: arquivo.trim() }),
      });
      setFoto(r.foto);
      notify('Foto do destino trocada.', 'success');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Não foi possível trocar a foto.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form onSubmit={salvar} className="p-4 rounded-xl border-2 border-[#111111]/15 bg-white space-y-2 text-xs" data-testid="admin-fotos">
      <div className="font-extrabold text-sm text-[#111111]">Fotos reais dos destinos</div>
      <p className="text-[#111111]/70">
        As fotos vêm do Wikimedia Commons (livres, com crédito do fotógrafo). Para trocar a de um destino, abra a foto no
        commons.wikimedia.org e cole o link aqui.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="destino (ex.: rio-de-janeiro)"
          className="px-3 py-2 rounded-lg border border-[#111111]/25"
        />
        <input
          value={arquivo}
          onChange={(e) => setArquivo(e.target.value)}
          placeholder="link da foto no Wikimedia Commons"
          className="md:col-span-2 px-3 py-2 rounded-lg border border-[#111111]/25"
        />
      </div>
      <button type="submit" disabled={salvando || !slug || !arquivo} className="px-4 py-2 rounded-lg bg-[#111111] text-[#39FF14] font-bold disabled:opacity-50">
        {salvando ? 'Salvando...' : 'Trocar foto'}
      </button>
      {foto && (
        <div className="flex items-center gap-3 pt-1">
          <img src={foto.url500} alt="" className="w-24 h-16 object-cover rounded" referrerPolicy="no-referrer" />
          <span className="text-[#111111]/70">
            {foto.author} · {foto.license}
          </span>
        </div>
      )}
    </form>
  );
};
