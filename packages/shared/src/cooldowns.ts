import { NAME_CHANGE_MS, PASSWORD_CHANGE_MS } from './constants.js';

export function availableAt(anchor: Date | string, windowMs: number) {
  return new Date(new Date(anchor).getTime() + windowMs);
}

export function cooldownMsLeft(anchor: Date | string, windowMs: number, now = Date.now()) {
  return Math.max(0, availableAt(anchor, windowMs).getTime() - now);
}

export function formatCooldown(ms: number) {
  if (ms <= 0) return 'now';
  const day = 86_400_000;
  const hour = 3_600_000;
  const minute = 60_000;
  if (ms >= day) {
    const n = Math.ceil(ms / day);
    return n === 1 ? '1 day' : `${n} days`;
  }
  if (ms >= hour) {
    const n = Math.ceil(ms / hour);
    return n === 1 ? '1 hour' : `${n} hours`;
  }
  const n = Math.max(1, Math.ceil(ms / minute));
  return n === 1 ? '1 minute' : `${n} minutes`;
}

export function nameChangeAvailableAt(createdAt: Date | string, lastChangedAt: Date | string | null) {
  return availableAt(lastChangedAt ?? createdAt, NAME_CHANGE_MS);
}

export function passwordChangeAvailableAt(createdAt: Date | string, lastChangedAt: Date | string | null) {
  return availableAt(lastChangedAt ?? createdAt, PASSWORD_CHANGE_MS);
}
