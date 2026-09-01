import {
  formatCooldown,
  cooldownMsLeft,
  nameChangeAvailableAt,
  passwordChangeAvailableAt,
  NAME_CHANGE_MS,
  PASSWORD_CHANGE_MS,
} from '@voiceout/shared';
import { httpError } from './http.js';
import { toPublicUser } from './users.js';
import { users, type Db } from '@voiceout/db';
import type { Env } from '../env.js';
import type { S3Client } from '@aws-sdk/client-s3';

type UserRow = typeof users.$inferSelect;

export function profileLocks(user: {
  createdAt: Date;
  profileNameChangedAt: Date | null;
  passwordChangedAt: Date | null;
}) {
  return {
    nameChangeAvailableAt: nameChangeAvailableAt(user.createdAt, user.profileNameChangedAt).toISOString(),
    passwordChangeAvailableAt: passwordChangeAvailableAt(user.createdAt, user.passwordChangedAt).toISOString(),
  };
}

export async function toMeUser(
  db: Db,
  env: Env,
  s3: S3Client,
  user: UserRow,
) {
  return {
    ...(await toPublicUser(db, env, s3, user)),
    email: user.email,
    hasPassword: Boolean(user.passwordHash),
    ...profileLocks(user),
  };
}

export function assertNameChangeAllowed(user: { createdAt: Date; profileNameChangedAt: Date | null }) {
  const anchor = user.profileNameChangedAt ?? user.createdAt;
  const left = cooldownMsLeft(anchor, NAME_CHANGE_MS);
  if (left <= 0) return;
  throw httpError(429, `You can change your name or username in ${formatCooldown(left)}`, {
    retryAfter: Math.ceil(left / 1000),
    availableAt: nameChangeAvailableAt(user.createdAt, user.profileNameChangedAt).toISOString(),
  });
}

export function assertPasswordChangeAllowed(user: { createdAt: Date; passwordChangedAt: Date | null }) {
  const anchor = user.passwordChangedAt ?? user.createdAt;
  const left = cooldownMsLeft(anchor, PASSWORD_CHANGE_MS);
  if (left <= 0) return;
  throw httpError(429, `You can change your password in ${formatCooldown(left)}`, {
    retryAfter: Math.ceil(left / 1000),
    availableAt: passwordChangeAvailableAt(user.createdAt, user.passwordChangedAt).toISOString(),
  });
}
