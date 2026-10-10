import { compressImage } from './compressImage';
import { withProcessing } from './processing';

const configured = process.env.NEXT_PUBLIC_API_URL;
if (!configured?.startsWith('/')) {
  throw new Error('NEXT_PUBLIC_API_URL must be a same-origin path such as /vo-api');
}
const API = configured;

let csrfToken: string | null = null;

export function clearCsrf() {
  csrfToken = null;
}

export async function ensureCsrf() {
  if (csrfToken) return csrfToken;
  const res = await fetch(`${API}/auth/csrf`, { credentials: 'include' });
  if (!res.ok) throw new Error('csrf');
  const data = (await res.json()) as { csrf: string };
  csrfToken = data.csrf;
  return csrfToken;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>;
  return {};
}

type ApiInit = RequestInit & { _csrfRetry?: boolean; _authRetry?: boolean };

let refreshing: Promise<boolean> | null = null;

/** One refresh for every request that saw the expired access token at the same moment. */
function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': (await ensureCsrf()) ?? '' },
      });
      clearCsrf();
      // 409: another tab already rotated it; the browser now holds the new cookies.
      return res.ok || res.status === 409;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const track =
    method !== 'GET' &&
    method !== 'HEAD' &&
    path !== '/auth/csrf' &&
    path !== '/auth/refresh' &&
    path !== '/notifications/read' &&
    path !== '/feed/events';
  if (track) return withProcessing(() => apiInner<T>(path, init));
  return apiInner<T>(path, init);
}

async function apiInner<T>(path: string, init: ApiInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = await ensureCsrf();
    headers.set('x-csrf-token', csrf);
  }
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  if (!res.ok) {
    let msg = res.statusText || 'Request failed';
    const extra = asJsonObject(await readJson(res));
    if (typeof extra.error === 'string') msg = extra.error;
    // Only an expired/missing session is retried; "wrong password" style 401s are answers.
    if (
      res.status === 401 &&
      msg === 'Unauthorized' &&
      !init._authRetry &&
      path !== '/auth/refresh' &&
      (await refreshSession())
    ) {
      return apiInner<T>(path, { ...init, _authRetry: true });
    }
    if (res.status === 403 && msg === 'CSRF' && !init._csrfRetry) {
      clearCsrf();
      return apiInner<T>(path, { ...init, _csrfRetry: true });
    }
    throw new ApiError(msg, res.status, extra);
  }
  if (res.status === 204) return undefined as T;
  const data = await readJson(res);
  if (data === undefined) throw new ApiError('Empty response', res.status);
  return data as T;
}

export async function uploadBytes(mediaId: string, file: Blob) {
  return withProcessing(async () => {
    const csrf = await ensureCsrf();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 120_000);
    try {
      const res = await fetch(`${API}/media/${mediaId}/bytes`, {
        method: 'PUT',
        credentials: 'include',
        signal: ac.signal,
        headers: {
          'x-csrf-token': csrf,
          'content-type': file.type || 'application/octet-stream',
        },
        body: file,
      });
      if (!res.ok) {
        let msg = res.statusText || 'Upload failed';
        const body = asJsonObject(await readJson(res));
        if (typeof body.error === 'string') msg = body.error;
        throw new ApiError(msg, res.status);
      }
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function uploadAvatar(file: File) {
  const photo = await withProcessing(() => compressImage(file));
  const intent = await api<{ mediaId: string }>('/media/upload-url', {
    method: 'POST',
    body: JSON.stringify({ kind: 'avatar', mime: photo.type || 'image/jpeg', bytes: photo.size }),
  });
  await uploadBytes(intent.mediaId, photo);
  await api('/users/me/avatar', {
    method: 'POST',
    body: JSON.stringify({ mediaId: intent.mediaId }),
  });
}

export async function uploadPostImage(file: File) {
  const photo = await withProcessing(() => compressImage(file));
  const intent = await api<{ mediaId: string }>('/media/upload-url', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'post_image',
      mime: photo.type || 'image/jpeg',
      bytes: photo.size,
    }),
  });
  await uploadBytes(intent.mediaId, photo);
  return intent.mediaId;
}

export async function uploadAudio(
  kind: 'post_audio' | 'comment_audio',
  file: Blob,
  durationCap: number,
) {
  const mime = file.type || 'audio/webm';
  const intent = await api<{ mediaId: string }>('/media/upload-url', {
    method: 'POST',
    body: JSON.stringify({ kind, mime, bytes: file.size, durationCap }),
  });
  await uploadBytes(intent.mediaId, file);
  return intent.mediaId;
}

export { API };
