import { parseCountryCode } from '@voiceout/shared';

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  country_code?: string;
};

export async function reversePlace(lat: number, lng: number): Promise<{ city: string; country: string } | null> {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('format', 'json');
    url.searchParams.set('zoom', '10');
    const res = await fetch(url, {
      headers: { 'user-agent': 'VoiceOut/1.0 (place)' },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: NominatimAddress };
    const city = (data.address?.city || data.address?.town || data.address?.village || data.address?.municipality || '')
      .trim()
      .slice(0, 80);
    const country = parseCountryCode(data.address?.country_code ?? '') ?? '';
    if (!city && !country) return null;
    return { city, country };
  } catch {
    return null;
  }
}
