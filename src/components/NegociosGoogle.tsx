import React, { useState } from 'react';
import { AdvancedMarker, InfoWindow, Pin, useAdvancedMarkerRef, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';

import { negociosDoPlaces, TIPOS_GOOGLE, type CategoriaNegocio, type NegocioGoogle } from '../lib/negociosGoogle.ts';

export { negociosDoPlaces, TIPOS_GOOGLE };
export type { CategoriaNegocio, NegocioGoogle };

const ZOOM_MINIMO = 11;

/** Marcador azul de um negócio do Google, com o resumo e o link para o Google Maps. */
export const MarcadorNegocio: React.FC<{ n: NegocioGoogle }> = ({ n }) => {
  const [ref, marker] = useAdvancedMarkerRef();
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <AdvancedMarker ref={ref} position={{ lat: n.lat, lng: n.lng }} title={n.nome} onClick={() => setAberto(true)}>
        <Pin background="#1A73E8" borderColor="#FFFFFF" glyphColor="#FFFFFF" scale={0.85} />
      </AdvancedMarker>
      {aberto && (
        <InfoWindow anchor={marker} onCloseClick={() => setAberto(false)}>
          <div className="text-[#111111] max-w-[220px]">
            <div className="text-sm font-extrabold">{n.nome}</div>
            {n.tipo ? <div className="text-[11px] text-[#111111]/70">{n.tipo}</div> : null}
            {n.nota ? (
              <div className="text-[11px] mt-0.5">
                ⭐ {n.nota.toFixed(1)} ({n.avaliacoes} avaliações no Google)
              </div>
            ) : null}
            {n.endereco ? <div className="text-[11px] text-[#111111]/70 mt-0.5">{n.endereco}</div> : null}
            {n.url ? (
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="inline-block mt-1.5 text-[11px] font-bold underline">
                Ver no Google Maps
              </a>
            ) : null}
          </div>
        </InfoWindow>
      )}
    </>
  );
};

const cache = new Map<string, NegocioGoogle[]>();

/**
 * Botões sobre o mapa: buscam no Google os negócios da área que está na tela
 * (só quando a pessoa pede, para não gastar a cota do Google à toa).
 */
export const BuscaNegociosGoogle: React.FC<{ onResultado: (lista: NegocioGoogle[], categoria: CategoriaNegocio | null) => void }> = ({ onResultado }) => {
  const map = useMap();
  const places = useMapsLibrary('places');
  const [buscando, setBuscando] = useState<CategoriaNegocio | null>(null);
  const [ativa, setAtiva] = useState<CategoriaNegocio | null>(null);
  const [aviso, setAviso] = useState('');

  const buscar = async (cat: CategoriaNegocio) => {
    if (!map || !places) return;
    if (ativa === cat) {
      setAtiva(null);
      setAviso('');
      onResultado([], null);
      return;
    }
    const zoom = map.getZoom() ?? 4;
    const c = map.getCenter();
    if (!c || zoom < ZOOM_MINIMO) {
      setAviso('Aproxime o mapa da cidade (zoom) para ver os negócios do Google.');
      return;
    }
    const chave = `${cat}:${c.lat().toFixed(2)},${c.lng().toFixed(2)}`;
    setBuscando(cat);
    setAviso('');
    try {
      let lista = cache.get(chave);
      if (!lista) {
        const { places: achados } = await (places as unknown as {
          Place: { searchNearby: (r: unknown) => Promise<{ places: Array<Record<string, any>> }> };
        }).Place.searchNearby({
          fields: ['id', 'displayName', 'location', 'rating', 'userRatingCount', 'googleMapsURI', 'primaryTypeDisplayName', 'formattedAddress'],
          locationRestriction: { center: { lat: c.lat(), lng: c.lng() }, radius: zoom >= 14 ? 1500 : 5000 },
          includedPrimaryTypes: TIPOS_GOOGLE[cat].tipos,
          maxResultCount: 20,
          rankPreference: 'POPULARITY',
          language: 'pt-BR',
          region: 'br',
        });
        lista = negociosDoPlaces(achados);
        cache.set(chave, lista);
      }
      setAtiva(cat);
      onResultado(lista, cat);
      if (!lista.length) setAviso('Nenhum negócio desse tipo nesta área do mapa.');
    } catch {
      setAviso('Não foi possível buscar no Google agora. Tente de novo em instantes.');
    } finally {
      setBuscando(null);
    }
  };

  return (
    <div className="absolute left-2 right-2 bottom-2 z-[5] flex flex-col items-start gap-1.5 pointer-events-none" data-testid="busca-negocios-google">
      <div className="flex flex-wrap gap-1.5 pointer-events-auto">
        {(Object.keys(TIPOS_GOOGLE) as CategoriaNegocio[]).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => void buscar(cat)}
            disabled={!map || !places || buscando !== null}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold shadow border ${
              ativa === cat ? 'bg-[#1A73E8] text-white border-[#1A73E8]' : 'bg-white text-[#111111] border-[#111111]/20'
            } disabled:opacity-60`}
          >
            {buscando === cat ? 'Buscando…' : TIPOS_GOOGLE[cat].rotulo}
          </button>
        ))}
      </div>
      {aviso ? <div className="pointer-events-auto text-[11px] bg-white/95 text-[#111111] px-2 py-1 rounded shadow">{aviso}</div> : null}
    </div>
  );
};
