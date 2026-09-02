# VoiceOut

VoiceOut is a voice-first social app. People record short voice notes, add a caption, optionally attach photos, follow others, reply with voice or text, and listen in a home feed.

Site: [https://voiceout.xyz](https://voiceout.xyz)

## Stack

| Part | Role | Production host |
| --- | --- | --- |
| `apps/web` | Next.js PWA | Vercel |
| `apps/api` | HTTP API | Fly.io |
| `apps/backend` | Background workers | Render |
| `apps/algo` | Ranking (Python) | Railway |
| `packages/db` | Schema + migrations | Neon |
| `packages/shared` | Shared types | — |

Browser → `https://voiceout.xyz` → same-origin `/vo-api` → Fly API.

## Docs

- [Deploy (Vercel + Fly + Render + Railway)](docs/DEPLOY.md)
- [API overview](docs/API.md)

## Local development

1. Copy `.env.example` → `.env` and set `apps/web/.env.local` if needed.
2. Start local deps:

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis minio minio-init
```

3. Install and migrate:

```bash
pnpm install
pnpm db:migrate
pnpm db:gate
```

4. Optional algo:

```bash
cd apps/algo
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 5000
```

5. Run apps:

```bash
pnpm dev
```

- Web: http://localhost:3000  
- API: http://localhost:4000/health  

## Security notes

- Never commit `.env`, `.env.production.local`, or `detail.md`
- CI runs gitleaks + typecheck + tests + web build
- Production must use Neon app-role `DATABASE_URL`, Upstash `rediss://`, R2 keys, and `SKIP_MEDIA_PROBE=false`
