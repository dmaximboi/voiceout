import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mediaObjects } from '@voiceout/db';
import { and, eq } from 'drizzle-orm';
import {
  MAX_AUDIO_BYTES,
  MAX_AVATAR_BYTES,
  MAX_POST_IMAGE_BYTES,
  canUseDurationCap,
  isAllowedAudioMime,
  isAllowedAvatarMime,
  matchesUploadMagic,
  uploadIntentSchema,
  type DurationCap,
} from '@voiceout/shared';
import { requireAuth, requireCsrf, requireInternal, requireVerifiedIdentity } from '../plugins/auth.js';
import { assertFlag } from '../lib/flags.js';
import { assertDailyQuota } from '../lib/quota.js';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { signedGet, signedPut, publicMediaUrl } from '../lib/s3.js';
import { viewerCanReadMedia } from '../lib/mediaAccess.js';
import { z } from 'zod';

export async function mediaRoutes(app: FastifyInstance) {
  const rawLimit = { parseAs: 'buffer' as const, bodyLimit: 42_000_000 };
  app.addContentTypeParser(/^audio\/.*/, rawLimit, (_req, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser(/^image\/.*/, rawLimit, (_req, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser('application/octet-stream', rawLimit, (_req, body, done) => {
    done(null, body);
  });

  app.post('/media/upload-url', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    requireAuth(req, reply);
    requireCsrf(req);
    assertFlag(app.env, 'KILL_UPLOADS');
    const body = uploadIntentSchema.parse(req.body);
    const imageKind = body.kind === 'avatar' || body.kind === 'post_image';
    // Avatars can be set right after signup, before email verify.
    if (body.kind !== 'avatar') requireVerifiedIdentity(req);
    if (imageKind) {
      if (!isAllowedAvatarMime(body.mime)) return reply.code(400).send({ error: 'Bad image type' });
      const maxBytes = body.kind === 'avatar' ? MAX_AVATAR_BYTES : MAX_POST_IMAGE_BYTES;
      if (body.bytes > maxBytes) return reply.code(400).send({ error: 'Image too large' });
    } else {
      requireVerifiedIdentity(req);
      if (!isAllowedAudioMime(body.mime)) return reply.code(400).send({ error: 'Bad audio type' });
      const cap = body.durationCap as DurationCap | undefined;
      if (!cap || !(cap in MAX_AUDIO_BYTES)) return reply.code(400).send({ error: 'Duration cap required' });
      if (body.kind === 'post_audio' && !canUseDurationCap(cap, req.authUser!.isStudio)) {
        return reply.code(403).send({ error: 'Voice studio required for that length', code: 'STUDIO_REQUIRED' });
      }
      if (body.bytes > MAX_AUDIO_BYTES[cap]) return reply.code(400).send({ error: 'Audio too large for cap' });
    }
    await assertDailyQuota(app.redis, 'upload', req.authUser!.id);
    const id = randomUUID();
    const objectId = randomUUID();
    const ext = imageKind ? mimeExt(body.mime) : audioExt(body.mime);
    const objectKey = `o/${objectId}/${id}.${ext}`;
    const [media] = await app.db
      .insert(mediaObjects)
      .values({
        id,
        userId: req.authUser!.id,
        objectKey,
        kind: body.kind,
        mime: body.mime.split(';')[0] ?? body.mime,
        bytes: body.bytes,
        durationCap: imageKind ? null : (body.durationCap ?? null),
        status: 'pending',
      })
      .returning();
    if (!media) return reply.code(500).send({ error: 'Failed' });
    const uploadUrl = await signedPut(app.env, app.s3, objectKey, body.mime.split(';')[0] ?? body.mime, body.bytes);
    return { mediaId: media.id, uploadUrl };
  });

  app.put(
    '/media/:id/bytes',
    { bodyLimit: 42_000_000, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      requireAuth(req, reply);
      requireCsrf(req);
      assertFlag(app.env, 'KILL_UPLOADS');
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const [media] = await app.db
        .select()
        .from(mediaObjects)
        .where(and(eq(mediaObjects.id, id), eq(mediaObjects.userId, req.authUser!.id)))
        .limit(1);
      if (!media) return reply.code(404).send({ error: 'Not found' });
      if (media.kind !== 'avatar') requireVerifiedIdentity(req);
      if (media.status !== 'pending') return reply.code(409).send({ error: 'File is locked' });
      const buf = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from((req.body as Uint8Array | undefined) ?? []);
      if (!buf.length) return reply.code(400).send({ error: 'Empty file' });
      if (!matchesUploadMagic(media.mime, buf)) {
        return reply.code(400).send({ error: 'File type does not match' });
      }
      const maxBytes = uploadMaxBytes(media.kind, media.durationCap);
      if (maxBytes && buf.length > maxBytes) return reply.code(400).send({ error: 'File too large' });
      await app.s3.send(
        new PutObjectCommand({
          Bucket: app.env.S3_BUCKET,
          Key: media.objectKey,
          Body: buf,
          ContentType: media.mime,
        }),
      );
      if (media.kind === 'avatar' || media.kind === 'post_image' || app.env.SKIP_MEDIA_PROBE) {
        await app.db.update(mediaObjects).set({ status: 'ready', bytes: buf.length }).where(eq(mediaObjects.id, id));
      } else {
        await app.db.update(mediaObjects).set({ bytes: buf.length }).where(eq(mediaObjects.id, id));
      }
      return { ok: true };
    },
  );

  app.get('/media/:id/file', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [media] = await app.db.select().from(mediaObjects).where(eq(mediaObjects.id, id)).limit(1);
    if (!media) return reply.code(404).send({ error: 'Not found' });
    const allowed = await viewerCanReadMedia(app.db, media, req.authUser?.id ?? null);
    if (!allowed) return reply.code(404).send({ error: 'Not found' });
    let obj;
    try {
      obj = await app.s3.send(new GetObjectCommand({ Bucket: app.env.S3_BUCKET, Key: media.objectKey }));
    } catch (err) {
      req.log.warn({ err, mediaId: id }, 'media get failed');
      return reply.code(404).send({ error: 'Not found' });
    }
    if (!obj.Body) return reply.code(404).send({ error: 'Not found' });
    const bytes = Buffer.from(await obj.Body.transformToByteArray());
    const ext = media.objectKey.includes('.') ? media.objectKey.slice(media.objectKey.lastIndexOf('.')) : '';
    reply.header('accept-ranges', 'bytes');
    reply.header('content-type', media.mime || 'application/octet-stream');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('content-disposition', `inline; filename="${id}${ext}"`);
    // Only avatars are world-cacheable. Other media can be owner-only (pending /
    // unpublished); public caches would leak bytes across users by URL.
    reply.header(
      'cache-control',
      media.kind === 'avatar' && media.status === 'ready'
        ? 'public, max-age=31536000, immutable'
        : 'private, no-store',
    );
    const range = parseRange(req.headers.range, bytes.length);
    if (range) {
      reply.code(206);
      reply.header('content-range', `bytes ${range.start}-${range.end}/${bytes.length}`);
      reply.header('content-length', String(range.end - range.start + 1));
      return reply.send(bytes.subarray(range.start, range.end + 1));
    }
    reply.header('content-length', String(bytes.length));
    return reply.send(bytes);
  });

  app.get('/media/:id/playback-url', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [media] = await app.db.select().from(mediaObjects).where(eq(mediaObjects.id, id)).limit(1);
    if (!media) return reply.code(404).send({ error: 'Not found' });
    const allowed = await viewerCanReadMedia(app.db, media, req.authUser?.id ?? null);
    if (!allowed) return reply.code(404).send({ error: 'Not found' });
    return { url: publicMediaUrl(media.id), durationMs: media.durationMs };
  });

  app.post('/internal/media/:id/status', async (req, reply) => {
    await requireInternal(app, req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        status: z.enum(['ready', 'rejected']),
        durationMs: z.number().int().positive().optional(),
        sha256: z.string().length(64).optional(),
      })
      .parse(req.body);
    await app.db
      .update(mediaObjects)
      .set({
        status: body.status,
        durationMs: body.durationMs ?? undefined,
        sha256: body.sha256 ?? undefined,
      })
      .where(eq(mediaObjects.id, id));
    return { ok: true };
  });

  app.get('/internal/media/:id', async (req, reply) => {
    await requireInternal(app, req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [media] = await app.db.select().from(mediaObjects).where(eq(mediaObjects.id, id)).limit(1);
    if (!media) return reply.code(404).send({ error: 'Not found' });
    const downloadUrl = await signedGet(app.env, app.s3, media.objectKey);
    return { media, downloadUrl };
  });
}

function mimeExt(mime: string) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

function audioExt(mime: string) {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/mp4') return 'm4a';
  if (base === 'audio/mpeg') return 'mp3';
  return 'webm';
}

function uploadMaxBytes(kind: string, durationCap: number | null) {
  if (kind === 'avatar') return MAX_AVATAR_BYTES;
  if (kind === 'post_image') return MAX_POST_IMAGE_BYTES;
  if (durationCap && durationCap in MAX_AUDIO_BYTES) {
    return MAX_AUDIO_BYTES[durationCap as DurationCap];
  }
  return MAX_AUDIO_BYTES[60];
}

function parseRange(header: string | undefined, size: number) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!m) return null;
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

void and;
void eq;
