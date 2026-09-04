import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import {
  auditLogs,
  comments,
  mediaObjects,
  notifications,
  oauthAccounts,
  posts,
  reports,
  sessions,
  userKeys,
  users,
  type Db,
} from '@voiceout/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Env } from '../env.js';
import { deleteObject } from './s3.js';

const AES = 'aes-256-gcm';

export function dataKek(env: Env): Buffer {
  if (env.DATA_KEK.length >= 32) {
    if (/^[0-9a-f]{64}$/i.test(env.DATA_KEK)) return Buffer.from(env.DATA_KEK, 'hex');
    return createHash('sha256').update(env.DATA_KEK).digest();
  }
  return createHash('sha256').update(`vo-dev-kek:${env.JWT_SECRET}`).digest();
}

export function emailLookupHmac(env: Env, email: string): string {
  return createHmac('sha256', dataKek(env)).update(email.toLowerCase()).digest('hex');
}

function encryptBytes(key: Buffer, plain: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(AES, key, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const packed = Buffer.concat([body, cipher.getAuthTag()]);
  return { nonce: nonce.toString('base64'), ct: packed.toString('base64') };
}

function decryptBytes(key: Buffer, nonceB64: string, ctB64: string): Buffer {
  const packed = Buffer.from(ctB64, 'base64');
  const nonce = Buffer.from(nonceB64, 'base64');
  const tag = packed.subarray(packed.length - 16);
  const body = packed.subarray(0, packed.length - 16);
  const decipher = createDecipheriv(AES, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export async function asDbUser(db: Db, userId: string) {
  await db.execute(sql`select set_config('app.user_id', ${userId}, true)`);
}

export async function findLiveUserByEmail(db: Db, env: Env, email: string) {
  const normalized = email.toLowerCase();
  const hmac = emailLookupHmac(env, normalized);
  const [user] = await db
    .select()
    .from(users)
    .where(and(isNull(users.deletedAt), or(eq(users.emailHmac, hmac), eq(users.email, normalized))))
    .limit(1);
  return user ?? null;
}

async function loadOrCreateDek(db: Db, env: Env, userId: string): Promise<Buffer> {
  const [existing] = await db.select().from(userKeys).where(eq(userKeys.userId, userId)).limit(1);
  if (existing) {
    return decryptBytes(dataKek(env), existing.wrapNonce, existing.wrappedDek);
  }
  const dek = randomBytes(32);
  const wrapped = encryptBytes(dataKek(env), dek);
  await db
    .insert(userKeys)
    .values({
      userId,
      wrappedDek: wrapped.ct,
      wrapNonce: wrapped.nonce,
    })
    .onConflictDoNothing();
  const [row] = await db.select().from(userKeys).where(eq(userKeys.userId, userId)).limit(1);
  if (!row) throw new Error('user key missing');
  return decryptBytes(dataKek(env), row.wrapNonce, row.wrappedDek);
}

export async function ensureUserSealed(db: Db, env: Env, user: typeof users.$inferSelect) {
  if (user.deletedAt) return user;
  await asDbUser(db, user.id);
  const dek = await loadOrCreateDek(db, env, user.id);
  if (user.emailHmac && user.emailCt && user.emailNonce) return user;
  const packed = encryptBytes(dek, Buffer.from(user.email, 'utf8'));
  const [updated] = await db
    .update(users)
    .set({
      emailHmac: emailLookupHmac(env, user.email),
      emailCt: packed.ct,
      emailNonce: packed.nonce,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning();
  return updated ?? user;
}

export async function cryptographicallyEraseUser(
  db: Db,
  env: Env,
  s3: S3Client,
  userId: string,
  log?: { error: (obj: unknown, msg?: string) => void },
) {
  const media = await db.select().from(mediaObjects).where(eq(mediaObjects.userId, userId));

  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`select set_config('app.allow_password', 'on', true)`);
    await tx.execute(sql`select set_config('app.rls', 'off', true)`);
    await tx.delete(userKeys).where(eq(userKeys.userId, userId));
    await tx.delete(notifications).where(
      or(eq(notifications.userId, userId), eq(notifications.actorId, userId)),
    );
    await tx.delete(comments).where(eq(comments.authorId, userId));
    await tx.delete(posts).where(eq(posts.authorId, userId));
    await tx.delete(reports).where(
      or(eq(reports.reporterId, userId), and(eq(reports.targetType, 'user'), eq(reports.targetId, userId))),
    );
    await tx.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(oauthAccounts).where(eq(oauthAccounts.userId, userId));
    await tx.delete(mediaObjects).where(eq(mediaObjects.userId, userId));
    await tx.delete(users).where(eq(users.id, userId));
  });

  for (const row of media) {
    try {
      await deleteObject(env, s3, row.objectKey);
    } catch (err) {
      log?.error({ err, key: row.objectKey }, 'erasure media delete failed');
    }
  }
}
