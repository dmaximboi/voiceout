# Public HTTP API (proxied from the web app at `/vo-api`)

Base (local): `http://localhost:4000`  
Base (prod via site): `https://voiceout.xyz/vo-api`  
Direct API (prod): `https://api.voiceout.xyz`

## Auth

| Method | Path |
| --- | --- |
| POST | `/auth/register` |
| POST | `/auth/login` |
| POST | `/auth/logout` |
| GET | `/auth/me` |
| GET | `/auth/csrf` |
| POST | `/auth/refresh` |
| GET/POST | `/auth/google`, `/auth/github`, `/auth/tiktok`, `/auth/telegram` |
| POST | `/auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password` |

## Users & social

| Method | Path |
| --- | --- |
| GET/PATCH | `/users/me` |
| GET | `/users/:handle` |
| POST | `/users/:id/follow`, `/unfollow`, `/block`, `/mute` |

## Posts & feed

| Method | Path |
| --- | --- |
| GET | `/feed`, `/feed/trending` |
| POST | `/posts` |
| GET | `/posts/:id` |
| POST | `/posts/:id/react`, `/comment`, `/bookmark` |

## Media

| Method | Path |
| --- | --- |
| POST | `/media/upload-url` |
| GET | `/media/:id/file` |

## Billing

| Method | Path |
| --- | --- |
| POST | `/billing/studio/checkout` |
| POST | `/billing/webhooks/bachs` |

## Admin (role-gated)

| Method | Path |
| --- | --- |
| GET/POST | `/admin/*` |

## Health

| Method | Path |
| --- | --- |
| GET | `/health` |
