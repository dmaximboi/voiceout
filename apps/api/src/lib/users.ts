import {
  blocks,
  follows,
  mediaObjects,
  users,
  type Db,
} from '@voiceout/db';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { PublicUser } from '@voiceout/shared';
import { activePlanTier, planBadge, PLAN_DEFINITIONS } from '@voiceout/shared';
import type { Env } from '../env.js';
import { publicMediaUrl } from './s3.js';
import type { S3Client } from '@aws-sdk/client-s3';

export async function toPublicUser(
  db: Db,
  env: Env,
  s3: S3Client,
  row: Pick<
    typeof users.$inferSelect,
    'id' | 'handle' | 'displayName' | 'bio' | 'avatarMediaId' | 'createdAt' | 'planTier' | 'studioUntil'
  >,
): Promise<PublicUser> {
  const [counts] = await db
    .select({
      followers: sql<number>`(select count(*) from follows where followee_id = ${row.id})::int`,
      following: sql<number>`(select count(*) from follows where follower_id = ${row.id})::int`,
    })
    .from(users)
    .where(eq(users.id, row.id));

  let avatarUrl: string | null = null;
  if (row.avatarMediaId) {
    const [media] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, row.avatarMediaId))
      .limit(1);
    if (media && media.status === 'ready') {
      avatarUrl = publicMediaUrl(media.id);
    }
  }
  void env;
  void s3;

  const tier = activePlanTier(row.planTier, row.studioUntil);

  return {
    id: row.id,
    handle: row.handle,
    displayName: row.displayName,
    bio: row.bio,
    avatarUrl,
    followerCount: counts?.followers ?? 0,
    followingCount: counts?.following ?? 0,
    createdAt: row.createdAt.toISOString(),
    planBadge: planBadge(tier),
    nameAccent: tier ? PLAN_DEFINITIONS[tier].nameAccent : false,
  };
}

export async function toPublicUsers(
  db: Db,
  env: Env,
  s3: S3Client,
  rows: Parameters<typeof toPublicUser>[3][],
): Promise<Map<string, PublicUser>> {
  const out = new Map<string, PublicUser>();
  if (rows.length === 0) return out;
  const ids = rows.map((row) => row.id);
  const avatarIds = rows.flatMap((row) => (row.avatarMediaId ? [row.avatarMediaId] : []));
  const [followerRows, followingRows, avatarRows] = await Promise.all([
    db
      .select({ id: follows.followeeId, n: sql<number>`count(*)::int` })
      .from(follows)
      .where(inArray(follows.followeeId, ids))
      .groupBy(follows.followeeId),
    db
      .select({ id: follows.followerId, n: sql<number>`count(*)::int` })
      .from(follows)
      .where(inArray(follows.followerId, ids))
      .groupBy(follows.followerId),
    avatarIds.length
      ? db.select().from(mediaObjects).where(inArray(mediaObjects.id, avatarIds))
      : Promise.resolve([] as (typeof mediaObjects.$inferSelect)[]),
  ]);
  const followers = new Map(followerRows.map((row) => [row.id, row.n]));
  const following = new Map(followingRows.map((row) => [row.id, row.n]));
  const avatars = new Map(avatarRows.map((row) => [row.id, row]));
  void env;
  void s3;
  for (const row of rows) {
    const media = row.avatarMediaId ? avatars.get(row.avatarMediaId) : undefined;
    const tier = activePlanTier(row.planTier, row.studioUntil);
    out.set(row.id, {
      id: row.id,
      handle: row.handle,
      displayName: row.displayName,
      bio: row.bio,
      avatarUrl: media && media.status === 'ready' ? publicMediaUrl(media.id) : null,
      followerCount: followers.get(row.id) ?? 0,
      followingCount: following.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
      planBadge: planBadge(tier),
      nameAccent: tier ? PLAN_DEFINITIONS[tier].nameAccent : false,
    });
  }
  return out;
}

export function deletedPublicUser(id: string): PublicUser {
  return {
    id,
    handle: 'deleted',
    displayName: 'Deleted account',
    bio: null,
    avatarUrl: null,
    followerCount: 0,
    followingCount: 0,
    createdAt: new Date(0).toISOString(),
    planBadge: null,
    nameAccent: false,
  };
}

export async function isBlocked(db: Db, a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function isFollowing(db: Db, followerId: string, followeeId: string) {
  const rows = await db
    .select()
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
    .limit(1);
  return rows.length > 0;
}
