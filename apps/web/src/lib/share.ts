export function postPath(id: string) {
  return `/post/${id}`;
}

export function postShareUrl(
  id: string,
  opts?: { origin?: string; via?: string | null },
) {
  const origin = opts?.origin ?? (typeof window === 'undefined' ? '' : window.location.origin);
  const via = opts?.via ? `?via=${encodeURIComponent(opts.via)}` : '';
  return `${origin}${postPath(id)}${via}`;
}
