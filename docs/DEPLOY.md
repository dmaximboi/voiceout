# Production deploy — VoiceOut (voiceout.xyz)

## Release safety (required)

**`main` = production only.** Do not push unfinished work straight to `main`.

| Branch | Purpose |
| --- | --- |
| `main` | Live site (Vercel production + what we deploy to Fly/Render) |
| `develop` | Integration / testing branch |
| `feature/...` | Day-to-day work |

**Flow**

1. Create a feature branch from `develop` (or work on `develop` for small fixes).
2. Push → open a **PR into `develop`**. Vercel builds a **Preview URL** — use that to verify.
3. After preview looks good, open a **PR `develop` → `main`**.
4. Only after that PR merges: production web updates; then run `fly deploy` (and Render if needed) from `main`.

**Checks before merging to `main`**

- Vercel preview build is green
- Smoke: login, record/upload, settings, feed play
- DB migrations applied only when intentional (and tested)

Local default for ongoing work: stay on `develop`.

---

| App | Host | Config |
| --- | --- | --- |
| `apps/web` | **Vercel** | `apps/web/vercel.json` |
| `apps/api` | **Fly.io** | `fly.toml` + `infra/Dockerfile.node` |
| `apps/backend` | **Render** | `render.yaml` + `infra/Dockerfile.node` |
| `apps/algo` | **Fly.io** | `apps/algo/fly.toml` + `apps/algo/Dockerfile` |
| Postgres | **Neon** | already migrated + gated |
| Redis | **Upstash** | `REDIS_URL` |
| Media | **Cloudflare R2** | `S3_*` |
| DNS / TLS | **Namecheap DNS** + Vercel/Fly HTTPS | `voiceout.xyz`, `api.voiceout.xyz` |

Secrets live in host dashboards (and local gitignored `.env.production.local`). Never commit `.env`, `.env.production.local`, or `detail.md`.

## 1) Fill remaining secrets

In `.env.production.local` you still need:

1. `S3_ACCESS_KEY` + `S3_SECRET_KEY` — [R2 API tokens](https://dash.cloudflare.com/?to=/:account/r2/overview)
2. `ALGO_URL` — after Fly algo is live (`https://voiceout-algo.fly.dev`)
3. Confirm `API_ORIGIN=https://api.voiceout.xyz` after Fly DNS

R2: bucket `voiceout`, region `auto`, account endpoint already in the pack (`*.r2.cloudflarestorage.com`).

## 2) Fly — algo

```bash
cd apps/algo
fly apps create voiceout-algo
fly secrets set ALGO_SERVICE_TOKEN=<same as API> --app voiceout-algo
fly deploy
fly secrets set ALGO_URL=https://voiceout-algo.fly.dev --app voiceout-api
```

Optional: `S3_ENDPOINT` so whisper allowlist trusts R2 hosts.

## 3) Fly — API

```bash
fly auth login
fly apps create voiceout-api
fly secrets set --app voiceout-api <paste from .env.production.local>
fly deploy
```

Point Cloudflare CNAME `api` → your `*.fly.dev` hostname.  
Set `WEB_ORIGIN=https://voiceout.xyz` and `API_ORIGIN=https://api.voiceout.xyz`.

## 4) Render — backend

1. [dashboard.render.com](https://dashboard.render.com) → New → Blueprint → this repo (`render.yaml`)  
   or Docker web service with `infra/Dockerfile.node` and start command from `render.yaml`  
2. Paste worker envs from `.env.production.local` (DB, Redis, S3, tokens, `ALGO_URL`, `API_ORIGIN`, `SKIP_MEDIA_PROBE=false`)

## 5) Vercel — web

1. [vercel.com/new](https://vercel.com/new) → import repo  
2. Root Directory: `apps/web`  
3. Env:

```bash
NEXT_PUBLIC_API_URL=/vo-api
NEXT_PUBLIC_WEB_ORIGIN=https://voiceout.xyz
API_ORIGIN=https://api.voiceout.xyz
```

4. Add domain `voiceout.xyz` → create Cloudflare DNS records Vercel shows  

Browser calls same-origin `/vo-api/*`; Next proxies to Fly. That is intentional — not MinIO.

## 6) OAuth / email / payments redirects

| Provider | Setting |
| --- | --- |
| Google | origin + callback on `https://voiceout.xyz` |
| GitHub | homepage + callback on `https://voiceout.xyz` |
| TikTok | production redirect `https://voiceout.xyz/auth/tiktok/callback` |
| Telegram | `/setdomain` `voiceout.xyz` |
| Resend | verify domain `voiceout.xyz` |
| Bachs | webhook **prefer** `https://api.voiceout.xyz/billing/webhooks/bachs` (also works via `https://voiceout.xyz/vo-api/billing/webhooks/bachs`) |

Payments live on the **API** (`apps/api` billing routes). Do **not** deploy `apps/payments` — it is a stub.

## 7) Smoke

- `https://voiceout.xyz` loads  
- `https://api.voiceout.xyz/health` → `{ ok: true }`  
- Register + verify email + upload voice post  

## Local Docker (optional)

`infra/docker-compose.yml` is **local only** (Postgres/Redis/MinIO). Production uses Neon / Upstash / R2. Do not copy MinIO keys into cloud hosts.
