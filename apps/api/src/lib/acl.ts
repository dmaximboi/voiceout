const OPEN_GET = new Set([
  '/health',
  '/auth/csrf',
  '/auth/providers',
  '/feed',
  '/trending',
  '/users/suggestions',
  '/posts/:id',
  '/posts/:id/comments',
  '/media/:id/file',
  '/media/:id/playback-url',
  '/users/:handle',
  '/users/:handle/posts',
]);

const OPEN_POST = new Set(['/feed/listen', '/feed/seen']);

export function isOpenRoute(method: string, route: string) {
  const m = method.toUpperCase();
  if (route.startsWith('/internal/') || route.startsWith('/admin/')) return true;
  if (route === '/billing/webhooks/bachs') return true;
  if (
    route.startsWith('/auth/') &&
    route !== '/auth/me' &&
    route !== '/auth/resend-verify' &&
    route !== '/auth/device-link' &&
    route !== '/auth/switch-device' &&
    route !== '/auth/admin-stepup' &&
    route !== '/auth/admin-stepup/code' &&
    route !== '/auth/admin-stepup/status'
  ) {
    return true;
  }
  if (m === 'GET') return OPEN_GET.has(route);
  if (m === 'POST') return OPEN_POST.has(route);
  return false;
}
