import {
  formatCooldown,
  cooldownMsLeft,
  nameChangeAvailableAt,
  passwordChangeAvailableAt,
  NAME_CHANGE_MS,
  PASSWORD_CHANGE_MS,
  isStudioActive,
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
  passwordHash?: string | null;
}) {
  const nameAnchor = user.profileNameChangedAt;
  const passwordReady = !user.passwordHash
    ? new Date(0)
    : passwordChangeAvailableAt(user.createdAt, user.passwordChangedAt);
  return {
    nameChangeAvailableAt: nameAnchor
      ? nameChangeAvailableAt(user.createdAt, nameAnchor).toISOString()
      : new Date(0).toISOString(),
    passwordChangeAvailableAt: passwordReady.toISOString(),
  };
}

export async function toMeUser(
  db: Db,
  env: Env,
  s3: S3Client,
  user: UserRow,
) {
  const placeholderEmail = user.email.endsWith('@users.invalid');
  return {
    ...(await toPublicUser(db, env, s3, user)),
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    isEmailVerified: Boolean(user.emailVerifiedAt) && !placeholderEmail,
    needsRealEmail: placeholderEmail,
    phone: user.phone ?? null,
    role: user.role,
    hasPassword: Boolean(user.passwordHash),
    isStudio: isStudioActive(user.studioUntil),
    studioUntil: user.studioUntil?.toISOString() ?? null,
    ...profileLocks(user),
  };
}

export function assertNameChangeAllowed(user: { createdAt: Date; profileNameChangedAt: Date | null }) {
  // First rename is allowed with email code. Later renames keep the cooldown.
  if (!user.profileNameChangedAt) return;
  const left = cooldownMsLeft(user.profileNameChangedAt, NAME_CHANGE_MS);
  if (left <= 0) return;
  throw httpError(429, `You can change your name or username in ${formatCooldown(left)}`, {
    retryAfter: Math.ceil(left / 1000),
    availableAt: nameChangeAvailableAt(user.createdAt, user.profileNameChangedAt).toISOString(),
  });
}

export function assertPasswordChangeAllowed(user: {
  createdAt: Date;
  passwordChangedAt: Date | null;
  passwordHash?: string | null;
}) {
  // First password set (OAuth / Telegram) is always allowed.
  if (!user.passwordHash) return;
  const anchor = user.passwordChangedAt ?? user.createdAt;
  const left = cooldownMsLeft(anchor, PASSWORD_CHANGE_MS);
  if (left <= 0) return;
  throw httpError(429, `You can change your password in ${formatCooldown(left)}`, {
    retryAfter: Math.ceil(left / 1000),
    availableAt: passwordChangeAvailableAt(user.createdAt, user.passwordChangedAt).toISOString(),
  });
}
