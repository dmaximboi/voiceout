import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { posts, type Db } from '@voiceout/db';
import { SHARE_CODE_MAX, SHARE_CODE_MIN } from '@voiceout/shared';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateShareCode(length = 10): string {
  const n = Math.min(SHARE_CODE_MAX, Math.max(SHARE_CODE_MIN, length));
  const bytes = randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i]! % ALPHABET.length]!;
  return out;
}

export function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function looksLikeShareCode(value: string) {
  return /^[A-Za-z0-9]{8,12}$/.test(value) && !looksLikeUuid(value);
}

/** Accept share codes or UUIDs from public post URLs. */
export function postIdParamSchema() {
  return z.string().min(8).max(64);
}

export async function resolvePostRef(db: Db, ref: string): Promise<string | null> {
  if (looksLikeUuid(ref)) return ref;
  if (!looksLikeShareCode(ref)) return null;
  const [row] = await db.select({ id: posts.id }).from(posts).where(eq(posts.shareCode, ref)).limit(1);
  return row?.id ?? null;
}
