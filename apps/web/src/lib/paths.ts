/** Only allow in-app paths so login redirects cannot leave VoiceOut. */
export function safeNextPath(value: string | null | undefined, fallback = '/') {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (value.includes('://')) return fallback;
  const path = value.slice(0, 200);
  if (path === '/record' || path.startsWith('/record?')) return fallback;
  return path;
}
