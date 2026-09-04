import {
  formatCooldown,
  cooldownMsLeft,
  handleChangeAvailableAt,
  avatarChangeAvailableAt,
  passwordChangeAvailableAt,
  HANDLE_CHANGE_MS,
  PASSWORD_CHANGE_MS,
  activePlanTier,
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
  avatarChangedAt?: Date | null;
  passwordChangedAt: Date | null;
  passwordHash?: string | null;
}) {
  const handleAnchor = user.profileNameChangedAt;
  const avatarAnchor = user.avatarChangedAt ?? null;
  const passwordReady = !user.passwordHash
    ? new Date(0)
    : passwordChangeAvailableAt(user.createdAt, user.passwordChangedAt);
  return {
    /** Handle change availability (display name is always free). */
    nameChangeAvailableAt: handleAnchor
      ? handleChangeAvailableAt(user.createdAt, handleAnchor).toISOString()
      : new Date(0).toISOString(),
    avatarChangeAvailableAt: avatarAnchor
      ? avatarChangeAvailableAt(user.createdAt, avatarAnchor).toISOString()
      : new Date(0).toISOString(),
    passwordChangeAvailableAt: passwordReady.toISOString(),
  };
}

export async function toMeUser(db: Db, env: Env, s3: S3Client, user: UserRow) {
  const placeholderEmail = user.email.endsWith('@users.invalid');
  const tier = activePlanTier(user.planTier, user.studioUntil);
  const until = user.studioUntil?.toISOString() ?? null;
  return {
    ...(await toPublicUser(db, env, s3, user)),
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    isEmailVerified: Boolean(user.emailVerifiedAt) && !placeholderEmail,
    needsRealEmail: placeholderEmail,
    phone: user.phone ?? null,
    role: user.role,
    hasPassword: Boolean(user.passwordHash),
    planTier: tier,
    planUntil: until,
    isStudio: Boolean(tier),
    studioUntil: until,
    ...profileLocks(user),
  };
}

export function assertHandleChangeAllowed(user: { createdAt: Date; profileNameChangedAt: Date | null }) {
  if (!user.profileNameChangedAt) return;
  const left = cooldownMsLeft(user.profileNameChangedAt, HANDLE_CHANGE_MS);
  if (left <= 0) return;
  throw httpError(429, `You can change your username in ${formatCooldown(left)}`, {
    retryAfter: Math.ceil(left / 1000),
    availableAt: handleChangeAvailableAt(user.createdAt, user.profileNameChangedAt).toISOString(),
  });
}

/** @deprecated use assertHandleChangeAllowed */
export function assertNameChangeAllowed(user: { createdAt: Date; profileNameChangedAt: Date | null }) {
  assertHandleChangeAllowed(user);
}

export function assertAvatarChangeAllowed(user: {
  createdAt: Date;
  avatarChangedAt: Date | null;
}) {
  if (!user.avatarChangedAt) return;
  const left = cooldownMsLeft(user.avatarChangedAt, HANDLE_CHANGE_MS);
  if (left <= 0) return;
  throw httpError(429, `You can change your photo in ${formatCooldown(left)}`, {
    retryAfter: Math.ceil(left / 1000),
    availableAt: avatarChangeAvailableAt(user.createdAt, user.avatarChangedAt).toISOString(),
  });
}

export function assertPasswordChangeAllowed(user: {
  createdAt: Date;
  passwordChangedAt: Date | null;
  passwordHash?: string | null;
}) {
  if (!user.passwordHash) return;
  const anchor = user.passwordChangedAt ?? user.createdAt;
  const left = cooldownMsLeft(anchor, PASSWORD_CHANGE_MS);
  if (left <= 0) return;
  throw httpError(429, `You can change your password in ${formatCooldown(left)}`, {
    retryAfter: Math.ceil(left / 1000),
    availableAt: passwordChangeAvailableAt(user.createdAt, user.passwordChangedAt).toISOString(),
  });
}
