/** Only allow in-app paths so login redirects cannot leave VoiceOut. */
export function safeNextPath(value: string | null | undefined, fallback = '/') {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  // Browsers drop tabs/newlines while parsing, so "/\t/evil.com" would become "//evil.com".
  if (/[\u0000-\u0020\u007f]/.test(value)) return fallback;
  if (value.includes('://')) return fallback;
  const path = value.slice(0, 200);
  if (path === '/record' || path.startsWith('/record?')) return fallback;
  return path;
}
