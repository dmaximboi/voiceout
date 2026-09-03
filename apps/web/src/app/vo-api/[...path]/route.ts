import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function apiOrigin() {
  const api = process.env.API_ORIGIN?.trim();
  if (!api) return null;
  return api.replace(/\/$/, '');
}

type CookieOpts = NonNullable<Parameters<NextResponse['cookies']['set']>[2]>;

function cookiesFrom(res: Response): string[] {
  if (typeof res.headers.getSetCookie === 'function') {
    const list = res.headers.getSetCookie();
    if (list.length > 0) return list;
  }
  const raw = res.headers.get('set-cookie');
  if (!raw) return [];
  return raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
}

function applyCookie(res: NextResponse, raw: string) {
  const cleaned = raw.replace(/;\s*Domain=[^;]*/gi, '');
  const parts = cleaned.split(';').map((p) => p.trim()).filter(Boolean);
  const first = parts[0];
  if (!first) return;
  const eq = first.indexOf('=');
  if (eq < 1) return;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1);
  const opts: CookieOpts = { path: '/' };
  for (const part of parts.slice(1)) {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey?.trim().toLowerCase() ?? '';
    const val = rest.join('=').trim();
    if (key === 'httponly') opts.httpOnly = true;
    else if (key === 'secure') opts.secure = true;
    else if (key === 'path' && val) opts.path = val;
    else if (key === 'samesite' && val) {
      const s = val.toLowerCase();
      if (s === 'lax' || s === 'strict' || s === 'none') opts.sameSite = s;
    } else if (key === 'max-age' && val) opts.maxAge = Number(val);
    else if (key === 'expires' && val) opts.expires = new Date(val);
  }
  res.cookies.set(name, value, opts);
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    const API = apiOrigin();
    if (!API) {
      return NextResponse.json(
        { error: 'API temporarily unavailable' },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }
    const { path } = await ctx.params;
    if (path.some((p) => !p || p === '.' || p === '..' || p.includes('\\') || p.includes('\0'))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
    }
    const incoming = new URL(req.url);
    const target = `${API}/${path.map(encodeURIComponent).join('/')}${incoming.search}`;
    const headers = new Headers();
    const cookie = req.headers.get('cookie');
    if (cookie) headers.set('cookie', cookie);
    const contentType = req.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    const csrf = req.headers.get('x-csrf-token');
    if (csrf) headers.set('x-csrf-token', csrf);
    const range = req.headers.get('range');
    if (range) headers.set('range', range);
    const idem = req.headers.get('idempotency-key');
    if (idem) headers.set('idempotency-key', idem);
    // Bachs (and similar) webhooks need signature headers intact.
    for (const name of ['x-bachs-signature', 'x-bachs-timestamp', 'x-webhook-signature', 'x-webhook-timestamp']) {
      const value = req.headers.get(name);
      if (value) headers.set(name, value);
    }
    const auth = req.headers.get('authorization');
    if (auth && path[0] !== 'internal' && path[0] !== 'admin') headers.set('authorization', auth);
    headers.set('x-request-id', req.headers.get('x-request-id') ?? crypto.randomUUID());
    headers.set('x-forwarded-host', incoming.host);
    headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));
    // Always pass a client IP so API rate limits are not shared as 127.0.0.1.
    const forwardedFor = req.headers.get('x-forwarded-for');
    const realIp =
      req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-real-ip') ||
      req.headers.get('x-vercel-forwarded-for');
    if (forwardedFor) {
      headers.set('x-forwarded-for', forwardedFor);
    } else if (realIp) {
      headers.set('x-forwarded-for', realIp);
    } else {
      // Local/dev fallback: separate buckets per browser UA when IP is the Next server.
      const ua = (req.headers.get('user-agent') ?? 'local').slice(0, 64);
      headers.set('x-forwarded-for', `127.0.0.1`);
      headers.set('x-vo-client', ua);
    }
    headers.set('accept', req.headers.get('accept') ?? '*/*');

    const method = req.method;
    const body = method === 'GET' || method === 'HEAD' ? undefined : await req.arrayBuffer();

    const upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
    });

    const out = new Headers();
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === 'transfer-encoding' || lower === 'content-encoding' || lower === 'set-cookie') return;
      out.set(key, value);
    });
    if (!out.has('cache-control')) out.set('cache-control', 'no-store');

    const response =
      upstream.status >= 300 && upstream.status < 400
        ? new NextResponse(null, { status: upstream.status, headers: out })
        : new NextResponse(upstream.body, { status: upstream.status, headers: out });

    for (const cookieHeader of cookiesFrom(upstream)) {
      applyCookie(response, cookieHeader);
    }

    return response;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Server error' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
