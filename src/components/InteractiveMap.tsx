import React, { useMemo, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
} from '@vis.gl/react-google-maps';
import { Compass, Navigation, MapPin } from 'lucide-react';
import { Destination, Listing } from '../types.ts';
import { useApp } from '../context/AppContext.tsx';
import { formatMoney } from '../i18n/translations.ts';

export interface MapMarkerItem {
  id: string;
  kind: 'destination' | 'experience' | 'gastronomy' | 'accommodation';
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
  priceCents?: number;
  onSelect: () => void;
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

const PIN_COLORS: Record<
  MapMarkerItem['kind'],
  { bg: string; border: string; glyph: string }
> = {
  destination: { bg: '#111111', border: '#FFD700', glyph: '#FFD700' },
  experience: { bg: '#39FF14', border: '#111111', glyph: '#111111' },
  gastronomy: { bg: '#FF1493', border: '#FFFFFF', glyph: '#FFFFFF' },
  accommodation: { bg: '#FFD700', border: '#111111', glyph: '#111111' },
};

const MarkerWithPopup: React.FC<{
  item: MapMarkerItem;
  distanceKm?: number | null;
  currency: 'BRL' | 'USD' | 'EUR';
}> = ({ item, distanceKm, currency }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(false);
  const colors = PIN_COLORS[item.kind];

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: item.lat, lng: item.lng }}
        onClick={() => setOpen(true)}
        title={item.title}
      >
        <Pin background={colors.bg} borderColor={colors.border} glyphColor={colors.glyph} />
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow anchor={marker} maxWidth={260} onCloseClick={() => setOpen(false)}>
          <div className="p-1 text-[#111111]">
            <div className="text-[11px] font-bold text-[#FF1493]">
              {item.subtitle}
              {distanceKm != null ? ` · ${distanceKm.toFixed(1)} km` : ''}
            </div>
            <h4 className="font-extrabold text-sm mt-0.5 leading-snug">{item.title}</h4>
            {item.priceCents != null && (
              <div className="mt-1 text-xs font-bold text-[#111111] font-mono-tabular">
                {formatMoney(item.priceCents, currency)}
              </div>
            )}
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className="px-2.5 py-1.5 rounded-md bg-[#39FF14] text-[#111111] text-xs font-extrabold hover:brightness-95"
              >
                Abrir detalhes
              </button>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded-md border border-[#111111]/20 text-xs font-bold text-[#111111] hover:bg-[#111111]/5"
              >
                Rota
              </a>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
};

interface InteractiveMapProps {
  destinations: Destination[];
  listings: Listing[];
  onSelectDestination: (dest: Destination) => void;
  onSelectListing: (listing: Listing) => void;
}

export const InteractiveMap: React.FC<InteractiveMapProps> = ({
  destinations,
  listings,
  onSelectDestination,
  onSelectListing,
}) => {
  const { language, currency, notify } = useApp();
  const [layerFilter, setLayerFilter] = useState<'all' | MapMarkerItem['kind']>('all');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

  const markers = useMemo<MapMarkerItem[]>(() => {
    const destMarkers: MapMarkerItem[] = destinations.map((d) => ({
      id: `dest-${d.id}`,
      kind: 'destination',
      title: `${d.name} (${d.state})`,
      subtitle: `Destino · ${d.region}`,
      lat: d.lat,
      lng: d.lng,
      priceCents: d.avgBudgetDayCents,
      onSelect: () => onSelectDestination(d),
    }));

    const listMarkers: MapMarkerItem[] = listings.map((l) => ({
      id: `list-${l.id}`,
      kind: l.moduleType,
      title: l.title,
      subtitle:
        l.moduleType === 'experience'
          ? 'Experiência'
          : l.moduleType === 'gastronomy'
          ? 'Gastronomia'
          : 'Hospedagem',
      lat: l.lat,
      lng: l.lng,
      priceCents: l.priceCents,
      onSelect: () => onSelectListing(l),
    }));

    const all = [...destMarkers, ...listMarkers];
    return layerFilter === 'all' ? all : all.filter((m) => m.kind === layerFilter);
  }, [destinations, listings, layerFilter, onSelectDestination, onSelectListing]);

  const sortedByProximity = useMemo(() => {
    const origin = userCoords ?? { lat: -15.79, lng: -47.88 };
    return markers
      .map((m) => ({
        ...m,
        distanceKm: haversineKm(origin.lat, origin.lng, m.lat, m.lng),
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 6);
  }, [markers, userCoords]);

  const locateMe = () => {
    if (!navigator.geolocation) {
      notify('Geolocalização não suportada neste navegador.', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        notify('Localização atualizada na bússola turística.', 'success');
      },
      () => {
        notify('Permissão de localização não concedida.', 'error');
      }
    );
  };

  return (
    <div className="froc-luminous-border rounded-2xl bg-white overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#111111]/10 bg-white">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'all', label: 'Tudo no Mapa' },
            { id: 'destination', label: 'Destinos' },
            { id: 'experience', label: 'Experiências' },
            { id: 'gastronomy', label: 'Gastronomia' },
            { id: 'accommodation', label: 'Hospedagem' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setLayerFilter(tab.id as typeof layerFilter)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                layerFilter === tab.id
                  ? 'bg-[#111111] text-[#39FF14]'
                  : 'bg-white border border-[#111111]/15 text-[#111111]/75 hover:border-[#111111]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={locateMe}
          className="froc-btn-neon inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs whitespace-nowrap shrink-0"
        >
          <Navigation className="w-3.5 h-3.5" />
          <span>📍 Perto de mim</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-8 h-[420px] lg:h-[480px] relative bg-[#111111]/5">
          {apiKey && !mapFailed ? (
            <APIProvider
              apiKey={apiKey}
              language={language === 'en' ? 'en' : language === 'es' ? 'es' : 'pt-BR'}
              region="BR"
              onError={() => setMapFailed(true)}
            >
              <GoogleMap
                mapId="DEMO_MAP_ID"
                defaultCenter={userCoords ?? { lat: -14.235, lng: -44.925 }}
                defaultZoom={4}
                gestureHandling="greedy"
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                className="w-full h-full"
              >
                {userCoords && (
                  <AdvancedMarker position={userCoords} title="Sua localização atual">
                    <Pin background="#FF1493" borderColor="#FFFFFF" glyphColor="#FFFFFF" />
                  </AdvancedMarker>
                )}
                {markers.map((item) => (
                  <MarkerWithPopup
                    key={item.id}
                    item={item}
                    currency={currency}
                    distanceKm={
                      userCoords
                        ? haversineKm(userCoords.lat, userCoords.lng, item.lat, item.lng)
                        : null
                    }
                  />
                ))}
              </GoogleMap>
            </APIProvider>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-white">
              <Compass className="w-10 h-10 text-[#111111] mb-3" />
              <p className="text-sm font-extrabold text-[#111111]">
                Bússola Geográfica Froc Rota 2030+
              </p>
              <p className="text-xs text-[#111111]/70 mt-1 max-w-md">
                Configure `VITE_GOOGLE_MAPS_API_KEY` para renderizar os blocos visuais do Google Maps. Enquanto isso, consulte ao lado as distâncias calculadas e rotas diretas.
              </p>
            </div>
          )}
        </div>

        <div className="lg:col-span-4 border-t lg:border-t-0 lg:border-l border-[#111111]/10 p-5 flex flex-col justify-between bg-white">
          <div>
            <h3 className="font-sans text-xs font-extrabold tracking-wide text-[#FF1493] uppercase mb-3">
              {userCoords ? 'Mais próximos de você' : 'Pontos georreferenciados'}
            </h3>
            <div className="divide-y divide-[#111111]/10">
              {sortedByProximity.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onSelect}
                  className="w-full py-3 text-left hover:bg-[#39FF14]/10 transition-colors px-2 -mx-2 rounded-lg flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs text-[#FF1493] font-bold truncate">{item.subtitle}</div>
                    <div className="text-sm font-extrabold text-[#111111] truncate mt-0.5">
                      {item.title}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-mono-tabular text-[#111111] font-extrabold">
                      {item.distanceKm.toFixed(0)} km
                    </div>
                    <div className="text-[11px] text-[#111111]/65 font-semibold inline-flex items-center gap-0.5">
                      <MapPin className="w-3 h-3 text-[#FF1493]" />
                      <span>Ver</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-[#111111]/10 text-xs text-[#111111]/70 font-medium">
            Coordenadas reais integradas ao catálogo PostgreSQL com cálculo de distância e rotas Google Maps.
          </div>
        </div>
      </div>
    </div>
  );
};
