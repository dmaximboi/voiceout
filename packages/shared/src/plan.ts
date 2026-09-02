import { DURATION_CAPS, type DurationCap } from './constants.js';

export const FREE_DURATION_CAPS = [30, 60, 120] as const satisfies readonly DurationCap[];
export const STUDIO_DURATION_CAPS = DURATION_CAPS;
export const STUDIO_PRICE_CENTS = 100;
export const STUDIO_PRICE_LABEL = '$1';

export function isStudioActive(studioUntil: Date | string | null | undefined, now = Date.now()) {
  if (!studioUntil) return false;
  const ms = studioUntil instanceof Date ? studioUntil.getTime() : Date.parse(studioUntil);
  return Number.isFinite(ms) && ms > now;
}

export function allowedDurationCaps(isStudio: boolean): DurationCap[] {
  return isStudio ? [...STUDIO_DURATION_CAPS] : [...FREE_DURATION_CAPS];
}

export function canUseDurationCap(cap: number, isStudio: boolean) {
  return allowedDurationCaps(isStudio).includes(cap as DurationCap);
}
