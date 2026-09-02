import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const ALLOWED = new Set(['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash']);
const LIMITS: Record<string, number> = {
  id: 20,
  first_name: 64,
  last_name: 64,
  username: 32,
  photo_url: 512,
  auth_date: 12,
  hash: 64,
};

export type TelegramLogin = {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
};

export function validateTelegramLogin(
  input: unknown,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): TelegramLogin | null {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !botToken) return null;
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !ALLOWED.has(key))) return null;
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value);
    if (!text || text.length > (LIMITS[key] ?? 0)) return null;
    data[key] = text;
  }
  if (!/^[1-9]\d{0,19}$/.test(data.id ?? '') || !/^\d{1,12}$/.test(data.auth_date ?? '')) return null;
  if (!/^[a-fA-F0-9]{64}$/.test(data.hash ?? '')) return null;
  const authDate = Number(data.auth_date);
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds || nowSeconds - authDate > 600) return null;
  const check = Object.entries(data)
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  const supplied = Buffer.from(data.hash!, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return data as TelegramLogin;
}

function telegramBotId(token: string) {
  const id = token.split(':')[0] ?? '';
  return /^[1-9]\d{0,19}$/.test(id) ? id : undefined;
}

export type TelegramBotProfile = {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export function parseBotStartPayload(text: unknown) {
  if (typeof text !== 'string') return null;
  const match = text.trim().match(/^\/start(?:@[A-Za-z0-9_]{5,32})?\s+vo([a-f0-9]{32})$/);
  return match?.[1] ?? null;
}

export function telegramLoginFromUpdate(update: unknown): {
  loginId: string;
  profile: TelegramBotProfile & { phone?: string };
} | null {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return null;
  const message = (update as { message?: unknown }).message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const loginId = parseBotStartPayload((message as { text?: unknown }).text);
  const from = (message as { from?: unknown }).from;
  if (!loginId || !from || typeof from !== 'object' || Array.isArray(from)) return null;
  const raw = from as Record<string, unknown>;
  if (raw.is_bot === true) return null;
  const id = String(raw.id ?? '');
  if (!/^[1-9]\d{0,19}$/.test(id)) return null;
  const profile: TelegramBotProfile & { phone?: string } = { id };
  if (typeof raw.first_name === 'string' && raw.first_name && raw.first_name.length <= 64) {
    profile.first_name = raw.first_name;
  }
  if (typeof raw.last_name === 'string' && raw.last_name && raw.last_name.length <= 64) {
    profile.last_name = raw.last_name;
  }
  if (typeof raw.username === 'string' && /^[A-Za-z0-9_]{5,32}$/.test(raw.username)) {
    profile.username = raw.username;
  }
  const contact = (message as { contact?: unknown }).contact;
  if (contact && typeof contact === 'object' && !Array.isArray(contact)) {
    const c = contact as Record<string, unknown>;
    const phone = typeof c.phone_number === 'string' ? c.phone_number.replace(/[^\d+]/g, '') : '';
    const contactUserId = String(c.user_id ?? '');
    if (phone && (!contactUserId || contactUserId === id)) profile.phone = phone.slice(0, 32);
  }
  return { loginId, profile };
}

export function configuredAuthProviders(env: {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_BOT_USERNAME: string;
}) {
  const username = env.TELEGRAM_BOT_USERNAME.replace(/^@/, '');
  const telegramUsername = /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : undefined;
  const telegramId = telegramBotId(env.TELEGRAM_BOT_TOKEN);
  const telegram = Boolean(telegramId && telegramUsername);
  return {
    email: true,
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    telegram,
    telegramUsername: telegram ? telegramUsername : undefined,
    telegramBotId: telegram ? telegramId : undefined,
  };
}
