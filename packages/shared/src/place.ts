export const COUNTRIES = [
  { code: 'NG', name: 'Nigeria' },
  { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'EG', name: 'Egypt' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'UG', name: 'Uganda' },
  { code: 'CM', name: 'Cameroon' },
  { code: 'CI', name: 'Côte d’Ivoire' },
  { code: 'SN', name: 'Senegal' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'IE', name: 'Ireland' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'PT', name: 'Portugal' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'IN', name: 'India' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'PH', name: 'Philippines' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'QA', name: 'Qatar' },
  { code: 'CN', name: 'China' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
] as const;

const COUNTRY_CODES = new Set<string>(COUNTRIES.map((row) => row.code));

export function parseCountryCode(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase() ?? '';
  return COUNTRY_CODES.has(code) ? code : null;
}

export function countryName(code: string | null | undefined): string {
  const parsed = parseCountryCode(code);
  return COUNTRIES.find((row) => row.code === parsed)?.name ?? '';
}

export function formatPlace(city: string | null | undefined, country: string | null | undefined): string {
  const town = city?.trim() ?? '';
  const nation = countryName(country) || country?.trim() || '';
  if (town && nation) return `${town}, ${nation}`;
  return town || nation;
}
