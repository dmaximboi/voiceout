export function clampLimit(raw: unknown, fallback = 20, max = 50) {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : typeof raw === 'number' ? raw : fallback;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}
