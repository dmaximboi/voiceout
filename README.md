# VoiceOut

Voice-first social network. Posts are recorded voice notes plus required text. v1 is the public social core (no live rooms, no post images, no sticker studio, no payments).

## Apps

| Path | Role |
| --- | --- |
| `apps/web` | Next.js PWA (Vercel) |
| `apps/api` | Public REST API (Railway) |
| `apps/backend` | Workers: audio probe, trending jobs |
| `apps/algo` | Python ranking + trending |
| `apps/payments` | Stub only (v2) |

## Local development

1. Copy `.env.example` to `.env` in the repo root (compose reads it) and to `apps/web/.env.local`.
2. Start data stores:

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis minio minio-init
```

3. Install and migrate:

```bash
pnpm install
pnpm db:migrate
```

4. Run Python algo (optional; API falls back if it is down):

```bash
cd apps/algo
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 5000
```

5. Run Node apps:

```bash
pnpm dev
```

Web: http://localhost:3000  
API: http://localhost:4000/health  
MinIO console: http://localhost:9001 (minio / minio-secret)

## Full stack via Docker

```bash
docker compose -f infra/docker-compose.yml up --build
```

Open **http://localhost:2000** (host port 2000 maps to the gateway on 2005). API, web, algo, and workers are not published on the LAN.

## Auth

Email/password always. Google and Apple OAuth activate when the corresponding env vars are set.
