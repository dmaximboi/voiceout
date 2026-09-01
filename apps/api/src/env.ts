import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().url(),
  API_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  COOKIE_SECRET: z.string().min(32),
  JWT_SECRET: z.string().min(32),
  ALGO_URL: z.string().url(),
  ALGO_SERVICE_TOKEN: z.string().min(16),
  INTERNAL_SERVICE_TOKEN: z.string().min(16),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  S3_PUBLIC_URL: z.string().optional().default(''),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GITHUB_CLIENT_ID: z.string().optional().default(''),
  GITHUB_CLIENT_SECRET: z.string().optional().default(''),
  TIKTOK_CLIENT_KEY: z.string().optional().default(''),
  TIKTOK_CLIENT_SECRET: z.string().optional().default(''),
  APPLE_CLIENT_ID: z.string().optional().default(''),
  APPLE_TEAM_ID: z.string().optional().default(''),
  APPLE_KEY_ID: z.string().optional().default(''),
  APPLE_PRIVATE_KEY: z.string().optional().default(''),
  RESEND_API_KEY: z.string().optional().default(''),
  MAIL_FROM: z.string().optional().default('VoiceOut <noreply@localhost>'),
  ADMIN_TOKEN: z.string().optional().default(''),
  PUBLIC_ORIGIN: z.string().optional().default(''),
  JWT_SECRET_PREV: z.string().optional().default(''),
  JWT_ISS: z.string().optional().default('voiceout'),
  JWT_AUD: z.string().optional().default('voiceout-api'),
  DATA_KEK: z.string().optional().default(''),
  KILL_UPLOADS: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  KILL_OAUTH: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  KILL_TRANSCRIBE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  SKIP_MEDIA_PROBE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.DATA_KEK.length < 32) {
    throw new Error('DATA_KEK must be set in production (32+ characters)');
  }
  return parsed.data;
}
