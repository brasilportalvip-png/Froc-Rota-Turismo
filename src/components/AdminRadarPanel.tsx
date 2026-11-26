import React, { useCallback, useEffect, useState } from 'react';
import { APIProvider, useMapsLibrary } from '@vis.gl/react-google-maps';
import { ExternalLink, MapPin, Search, Send, Sparkles, Star } from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';

/**
 * Radar de parceiros: encontra negócios de turismo REAIS no Google Maps para a equipe convidar.
 * Regras do Google Maps: só o "place_id" fica guardado; nome, telefone e site são lidos na hora.
 * O convite é enviado pela própria equipe (WhatsApp), nunca disparo automático.
 */

const CATEGORIAS = [
  { id: 'barco', label: 'Passeio de barco / lancha', q: 'passeio de barco' },
  { id: 'passeio', label: 'Passeios e agências de turismo', q: 'agência de passeios turísticos' },
  { id: 'pousada', label: 'Pousadas e hotéis', q: 'pousada' },
  { id: 'casa', label: 'Casas e apartamentos de temporada', q: 'aluguel de temporada' },
  { id: 'restaurante', label: 'Restaurantes', q: 'restaurante' },
  { id: 'guia', label: 'Guias de turismo', q: 'guia de turismo' },
  { id: 'aventura', label: 'Aventura (rafting, trilha, voo livre)', q: 'turismo de aventura' },
  { id: 'transfer', label: 'Transfer e receptivo', q: 'transfer turístico' },
];

interface Found {
  placeId: string;
  name: string;
  address: string;
  phone: string;
  website: string;
  rating: number | null;
  ratings: number;
  mapsUrl: string;
}
interface Prospect {
  id: number;
  placeId: string;
  destino: string;
  categoria: string;
  status: string;
  note: string;
  createdAt: string;
}
interface DestinoOpt {
  slug: string;
  nome: string;
  uf: string;
}

const FIELDS = ['id', 'displayName', 'formattedAddress', 'nationalPhoneNumber', 'websiteURI', 'rating', 'userRatingCount', 'googleMapsURI', 'businessStatus'];

function toFound(p: Record<string, unknown>): Found {
  return {
    placeId: String(p.id || ''),
    name: String(p.displayName || ''),
    address: String(p.formattedAddress || ''),
    phone: String(p.nationalPhoneNumber || ''),
    website: String(p.websiteURI || ''),
    rating: typeof p.rating === 'number' ? p.rating : null,
    ratings: Number(p.userRatingCount || 0),
    mapsUrl: String(p.googleMapsURI || ''),
  };
}

function whatsappLink(phone: string, text: string): string | null {
  const d = phone.replace(/\D/g, '');
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith('55') ? d : `55${d}`}?text=${encodeURIComponent(text)}`;
}

const RadarInner: React.FC = () => {
  const { apiFetch, notify } = useApp();
  const places = useMapsLibrary('places') as unknown as {
    Place: {
      searchByText: (r: Record<string, unknown>) => Promise<{ places: Array<Record<string, unknown>> }>;
      new (o: { id: string }): { fetchFields: (o: { fields: string[] }) => Promise<unknown> } & Record<string, unknown>;
    };
  } | null;
  const [destinos, setDestinos] = useState<DestinoOpt[]>([]);
  const [destino, setDestino] = useState('paraty');
  const [cat, setCat] = useState('barco');
  const [found, setFound] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [details, setDetails] = useState<Record<string, Found>>({});
  const [invite, setInvite] = useState<{ placeId: string; text: string } | null>(null);

  const loadProspects = useCallback(async () => {
    try {
      const r = await apiFetch<{ prospects: Prospect[] }>('/api/admin/prospects');
      setProspects(r.prospects || []);
    } catch {
      /* sem permissão ou offline */
    }
  }, [apiFetch]);

  useEffect(() => {
    fetch('/api/brasil/destinos')
      .then((r) => r.json())
      .then((d: { destinos?: DestinoOpt[] }) => setDestinos(d.destinos || []))
      .catch(() => {});
    void loadProspects();
  }, [loadProspects]);

  const dest = destinos.find((d) => d.slug === destino);
  const catInfo = CATEGORIAS.find((c) => c.id === cat)!;

  const search = async () => {
    if (!places || !dest) return;
    setSearching(true);
    setError(null);
    try {
      const { places: list } = await places.Place.searchByText({
        textQuery: `${catInfo.q} em ${dest.nome} ${dest.uf}`,
        fields: FIELDS,
        language: 'pt-BR',
        region: 'br',
        maxResultCount: 20,
      });
      setFound((list || []).filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY').map(toFound));
    } catch (err) {
      setError(
        'O Google Maps recusou a busca. Ative a "Places API (New)" no Google Cloud para a mesma chave do mapa (VITE_GOOGLE_MAPS_API_KEY).'
      );
      console.error(err);
    } finally {
      setSearching(false);
    }
  };

  const loadDetails = async (placeId: string) => {
    if (!places || details[placeId]) return;
    try {
      const p = new places.Place({ id: placeId });
      await p.fetchFields({ fields: FIELDS.filter((f) => f !== 'id') });
      setDetails((d) => ({ ...d, [placeId]: toFound({ ...p, id: placeId }) }));
    } catch {
      /* lugar removido do Maps */
    }
  };

  const save = async (f: Found) => {
    try {
      await apiFetch('/api/admin/prospects', {
        method: 'POST',
        body: JSON.stringify({ placeId: f.placeId, destino: destino, categoria: cat }),
      });
      notify(`${f.name} salvo no radar.`, 'success');
      await loadProspects();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao salvar.', 'error');
    }
  };

  const makeInvite = async (f: Found, destinoSlug: string, categoria: string) => {
    try {
      const r = await apiFetch<{ text: string }>('/api/admin/prospects/invite', {
        method: 'POST',
        body: JSON.stringify({ businessName: f.name, destino: destinoSlug, categoria }),
      });
      setInvite({ placeId: f.placeId, text: r.text });
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao gerar convite.', 'error');
    }
  };

  const setStatus = async (p: Prospect, status: string) => {
    try {
      await apiFetch(`/api/admin/prospects/${p.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await loadProspects();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro.', 'error');
    }
  };

  const savedIds = new Set(prospects.map((p) => p.placeId));

  const card = (f: Found, actions: React.ReactNode) => (
    <div key={f.placeId} className="p-3 rounded-xl border border-[#111111]/15 bg-white text-xs space-y-1.5">
      <div className="flex flex-wrap justify-between gap-2">
        <strong className="text-sm">{f.name}</strong>
        {f.rating !== null && (
          <span className="inline-flex items-center gap-0.5 font-bold">
            <Star className="w-3 h-3" /> {f.rating.toFixed(1)} ({f.ratings} no Google)
          </span>
        )}
      </div>
      <div className="text-[#111111]/70 inline-flex items-center gap-1">
        <MapPin className="w-3 h-3" /> {f.address}
      </div>
      <div className="flex flex-wrap gap-3">
        {f.phone && <span>📞 {f.phone}</span>}
        {f.website && (
          <a href={f.website} target="_blank" rel="noopener noreferrer" className="underline">
            site
          </a>
        )}
        {f.mapsUrl && (
          <a href={f.mapsUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
            Google Maps <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">{actions}</div>
      {invite?.placeId === f.placeId && (
        <div className="mt-2 p-2.5 rounded-lg bg-[#39FF14]/10 border border-[#111111]/15 space-y-2">
          <textarea
            value={invite.text}
            onChange={(e) => setInvite({ placeId: f.placeId, text: e.target.value })}
            rows={6}
            className="w-full p-2 rounded-lg border border-[#111111]/20 text-xs"
            aria-label="Mensagem de convite"
          />
          <div className="flex flex-wrap gap-2">
            {whatsappLink(f.phone, invite.text) ? (
              <a
                href={whatsappLink(f.phone, invite.text)!}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[36px] px-3 rounded-lg bg-[#111111] text-[#39FF14] font-bold inline-flex items-center gap-1"
              >
                <Send className="w-3.5 h-3.5" /> Abrir no WhatsApp
              </a>
            ) : (
              <span className="text-[#111111]/70">Sem celular no Google: copie o texto e envie pelo site ou e-mail do negócio.</span>
            )}
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(invite.text)}
              className="min-h-[36px] px-3 rounded-lg border border-[#111111]/25 font-bold"
            >
              Copiar texto
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-2xl border-2 border-[#111111] bg-white space-y-3">
        <h3 className="text-sm font-extrabold inline-flex items-center gap-2">
          <Search className="w-4 h-4" /> Radar de parceiros: negócios reais no Google Maps
        </h3>
        <p className="text-xs text-[#111111]/70">
          Escolha o destino e o tipo de negócio. A lista vem do Google Maps; você salva os que quer convidar e a IA escreve o
          convite. O envio é feito por você.
        </p>
        <div className="grid sm:grid-cols-3 gap-2">
          <select
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            className="min-h-[42px] px-2 rounded-lg border border-[#111111]/25 text-xs bg-white"
            aria-label="Destino"
          >
            {destinos.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.nome} ({d.uf})
              </option>
            ))}
          </select>
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="min-h-[42px] px-2 rounded-lg border border-[#111111]/25 text-xs bg-white"
            aria-label="Tipo de negócio"
          >
            {CATEGORIAS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={search}
            disabled={!places || searching}
            className="min-h-[42px] rounded-lg bg-[#111111] text-[#39FF14] text-xs font-extrabold disabled:opacity-50"
          >
            {searching ? 'Buscando…' : !places ? 'Carregando Google Maps…' : 'Buscar no Google Maps'}
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs font-semibold text-[#FF1493]">
            {error}
          </p>
        )}
        <div className="grid md:grid-cols-2 gap-2">
          {found.map((f) =>
            card(
              f,
              <>
                <button
                  type="button"
                  disabled={savedIds.has(f.placeId)}
                  onClick={() => void save(f)}
                  className="min-h-[36px] px-3 rounded-lg border border-[#111111]/25 font-bold disabled:opacity-50"
                >
                  {savedIds.has(f.placeId) ? 'No radar ✓' : 'Salvar no radar'}
                </button>
                <button
                  type="button"
                  onClick={() => void makeInvite(f, destino, cat)}
                  className="min-h-[36px] px-3 rounded-lg froc-btn-neon font-bold inline-flex items-center gap-1"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Convite com IA
                </button>
              </>
            )
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-extrabold">Meu radar ({prospects.length})</h3>
        {prospects.length === 0 && <p className="text-xs text-[#111111]/70">Nenhum negócio salvo ainda.</p>}
        {prospects.map((p) => {
          const f = details[p.placeId];
          return (
            <div key={p.id} className="p-3 rounded-xl border border-[#111111]/15 bg-white text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">
                  {p.destino} · {CATEGORIAS.find((c) => c.id === p.categoria)?.label || p.categoria}
                </span>
                <select
                  value={p.status}
                  onChange={(e) => void setStatus(p, e.target.value)}
                  className="min-h-[36px] px-2 rounded-lg border border-[#111111]/25 bg-white"
                  aria-label="Situação do contato"
                >
                  <option value="novo">Novo</option>
                  <option value="contatado">Contatado</option>
                  <option value="interessado">Interessado</option>
                  <option value="recusou">Recusou / não contatar</option>
                  <option value="anunciante">Virou anunciante 🎉</option>
                </select>
              </div>
              {f ? (
                card(
                  f,
                  <button
                    type="button"
                    onClick={() => void makeInvite(f, p.destino, p.categoria)}
                    disabled={p.status === 'recusou'}
                    className="min-h-[36px] px-3 rounded-lg froc-btn-neon font-bold disabled:opacity-50"
                  >
                    Convite com IA
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => void loadDetails(p.placeId)}
                  className="min-h-[36px] px-3 rounded-lg border border-[#111111]/25 font-bold"
                >
                  Ver dados do Google
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const AdminRadarPanel: React.FC = () => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) {
    return <p className="text-xs text-[#111111]/70">Falta a chave VITE_GOOGLE_MAPS_API_KEY na Vercel para usar o radar.</p>;
  }
  return (
    <APIProvider apiKey={apiKey} language="pt-BR" region="BR">
      <RadarInner />
    </APIProvider>
  );
};
