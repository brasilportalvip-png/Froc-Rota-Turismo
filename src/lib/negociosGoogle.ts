/* eslint-disable @typescript-eslint/no-explicit-any */
/** Negócio do Google (Perfil da Empresa no Google), vindo do Places do próprio Google. */
export interface NegocioGoogle {
  id: string;
  nome: string;
  tipo: string;
  lat: number;
  lng: number;
  nota: number | null;
  avaliacoes: number;
  endereco: string;
  url: string;
}

export type CategoriaNegocio = 'hospedagem' | 'restaurantes' | 'atracoes';

export const TIPOS_GOOGLE: Record<CategoriaNegocio, { rotulo: string; tipos: string[] }> = {
  hospedagem: { rotulo: '🏨 Hotéis e pousadas', tipos: ['lodging'] },
  restaurantes: { rotulo: '🍽️ Restaurantes', tipos: ['restaurant'] },
  atracoes: { rotulo: '🎟️ Passeios e atrações', tipos: ['tourist_attraction'] },
};


/** Converte a resposta do Places (New) no formato do site; descarta o que vier sem posição. */
export function negociosDoPlaces(places: Array<Record<string, any>>): NegocioGoogle[] {
  const saida: NegocioGoogle[] = [];
  for (const p of places || []) {
    const loc = p.location;
    const lat = typeof loc?.lat === 'function' ? loc.lat() : loc?.lat;
    const lng = typeof loc?.lng === 'function' ? loc.lng() : loc?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const nome = String(p.displayName || '').trim();
    if (!nome) continue;
    const url = String(p.googleMapsURI || '');
    saida.push({
      id: String(p.id || `${lat},${lng}`),
      nome,
      tipo: String(p.primaryTypeDisplayName || ''),
      lat,
      lng,
      nota: typeof p.rating === 'number' ? p.rating : null,
      avaliacoes: Number(p.userRatingCount) || 0,
      endereco: String(p.formattedAddress || ''),
      url: /^https:\/\/(maps\.google\.com|www\.google\.com\/maps|maps\.app\.goo\.gl)/.test(url) ? url : '',
    });
  }
  return saida;
}

