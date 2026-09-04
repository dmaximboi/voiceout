export function postPath(shareCodeOrId: string) {
  return `/post/${shareCodeOrId}`;
}

export function postShareUrl(
  shareCodeOrId: string,
  opts?: { origin?: string; via?: string | null },
) {
  const origin = opts?.origin ?? (typeof window === 'undefined' ? '' : window.location.origin);
  const via = opts?.via ? `?via=${encodeURIComponent(opts.via)}` : '';
  return `${origin}${postPath(shareCodeOrId)}${via}`;
}
