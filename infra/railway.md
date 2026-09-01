# Railway / Vercel service map (v1)
# web     -> Vercel (apps/web)
# api     -> Railway from apps/api
# backend -> Railway worker from apps/backend
# algo    -> Railway from apps/algo Dockerfile
# postgres + redis -> Railway plugins
# object storage -> Cloudflare R2 or AWS S3

# Required on API + backend + algo:
# DATABASE_URL
# REDIS_URL
# JWT_SECRET          (32+ chars, random)
# COOKIE_SECRET       (32+ chars, random)
# ALGO_SERVICE_TOKEN  (16+ chars, same on api/backend/algo)
# INTERNAL_SERVICE_TOKEN (16+ chars, same on api/backend)
# S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY S3_REGION
# S3_FORCE_PATH_STYLE=true for MinIO/R2 path-style
# WEB_ORIGIN API_ORIGIN ALGO_URL
# SKIP_MEDIA_PROBE=false in production
#
# Optional:
# GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
# APPLE_CLIENT_ID APPLE_TEAM_ID APPLE_KEY_ID APPLE_PRIVATE_KEY
# RESEND_API_KEY MAIL_FROM     (password reset + verify email)
# ADMIN_TOKEN                  (Bearer token for /admin/reports)
