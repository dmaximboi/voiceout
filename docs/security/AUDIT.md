# VoiceOut v1 security audit

This is a design-and-configuration audit of this repository, not a pentest of Vercel/Railway.

## Threat model

| Actor | Goal | Controls |
| --- | --- | --- |
| Anonymous visitor | Browse public posts | Cookie-less GET; no mutations |
| Registered user | Post/comment/react/follow | Auth cookies, CSRF header, rate limits |
| Attacker | Steal sessions | httpOnly cookies, 15m access JWT, rotating refresh, lockout, idle logout |
| Attacker | Upload malware as "audio" | MIME allowlist, size caps by duration, ffprobe duration check |
| Attacker | CSRF from another site | `x-csrf-token` must match `vo_csrf` cookie |
| Attacker | Enumerate / scrape | Search and auth rate limits; deny-by-default auth |
| Attacker | Rank manipulation | Trending is server-side; diverse sentiment does not global-trend |
| Insider / SSRF | Hit algo directly | Algo is on internal `data_net` only; token required; Whisper URLs allowlisted |

## Edge and isolation (`app_net`)

Full stack: `docker compose -f infra/docker-compose.yml up --build` then open **http://localhost:2000**.

- Host publishes **only** `2000 → gateway:2005`. Nginx listens on 2005 inside the network; browsers never see `:3000`, `:4000`, or `:5000`.
- `app_net` is the public bridge (web + API + gateway). `data_net` is `internal: true` (Postgres, Redis, MinIO, algo, migrate).
- API/backend join both networks. Algo is not reachable from the gateway.
- Containers have memory/CPU/PID caps, `no-new-privileges`, `init`, and app services drop all Linux capabilities.
- Compose API uses `voiceout_app` (not the Postgres owner), so RLS binds.
- Daily `pnpm dev` still uses loopback Postgres/Redis/MinIO on `:3000` / `:4000`.

## Auth

- Passwords: Argon2id via `hash-wasm` (memory 19456 KiB).
- Login lockout after 8 failures (15 minutes).
- Refresh tokens hashed (SHA-256) in `sessions`; rotation on refresh.
- Access JWT has `iss`/`aud`; optional `JWT_SECRET_PREV` for rotation.
- OAuth state cookie compared on callback.
- Apple/Google disabled until env is set (no open redirect to empty client).
- Routes are deny-by-default; public GETs and `/auth/*` (except `/auth/me`) are allowlisted.
- `ADMIN_TOKEN` compared with timing-safe equality; `users.role` (`user` / `moderator` / `admin`) is an alternative.

## Upload pipeline

- Client never sends audio through the JSON API (except same-origin `/media/:id/bytes` with CSRF).
- Presigned PUT is scoped to a server-generated object key.
- Max bytes enforced per duration cap; 40 uploads / 30 posts per user per day.
- Worker rejects empty/short bodies and over-cap duration (`DURATION_PROBE_SLACK_MS`).
- ffprobe binary name is allowlisted. Whisper download hosts are allowlisted.
- Playback URLs expire (15 minutes). `KILL_UPLOADS` / `KILL_OAUTH` / `KILL_TRANSCRIBE` kill switches.

## Injection / XSS

- Drizzle parameterized SQL.
- Captions/comments stripped of `<>`.
- UI renders text as React text nodes, not `dangerouslySetInnerHTML`.
- Next.js: CSP, `X-Frame-Options: DENY`, nosniff, limited Permissions-Policy (mic self only).

## OWASP ASVS-inspired checklist (v1)

- [x] Unique handles and emails
- [x] Password complexity + hashing
- [x] Session expiration + last-seen + idle logout
- [x] CSRF on cookie mutations (including `/feed/seen` and `/auth/refresh`)
- [x] CORS allowlist (`WEB_ORIGIN` only)
- [x] Rate limiting (Redis-backed; fail closed)
- [x] Authorization on delete post / follow / media ownership
- [x] Block/mute hide graph edges from feed
- [x] Reports stored for later moderation
- [x] Secrets via env; `.env` gitignored
- [x] Audit log rows for register/login/admin/delete
- [x] Account delete hard-removes the user row and cascaded content (`DELETE /users/me`; S3 objects deleted)
- [ ] Email verification (deferred)
- [ ] Admin moderation UI (deferred)
- [ ] WebAuthn (deferred)

## CI

- `pnpm audit --prod --audit-level=critical` (fails the job on critical), `pip-audit`, Gitleaks, unit tests for ranking/sentiment and shared schemas.

## Residual risk (production-only)

- TLS to the world, HSTS, DB TLS, encryption at rest, backups/PITR, IAM roles, Secrets Manager, VPC/WAF, MFA, mTLS.
- Browser MediaRecorder codecs vary; probe must stay on in production (`SKIP_MEDIA_PROBE=false`).
- Production must set `DATA_KEK` separately from `JWT_SECRET` (and eventually a KMS). Dev may derive the wrap key from `JWT_SECRET`.
- Crypto-shred covers sealed email ciphertext in later backups. Backups taken while email was still plaintext still contain that email until those backups expire.
- Signed URL leak in a screenshot is time-bounded but real; do not make the bucket public.
- Trending can still be brigaded; dominance + windowing reduces cheap spikes, it does not stop coordinated abuse.
- Apple/Google OAuth needs production redirect URIs and a paid Apple developer account.
- Local `pnpm dev` still uses the Postgres owner unless you point `DATABASE_URL` at `voiceout_app` after `pnpm db:gate`.
