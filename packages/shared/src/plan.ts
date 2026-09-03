import { DURATION_CAPS, type DurationCap } from './constants.js';

export const FREE_DURATION_CAPS = [30, 60, 120] as const satisfies readonly DurationCap[];

export const PLAN_TIERS = ['basic', 'verified', 'gold'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const PLAN_DAYS = 30;

export const PLAN_TIER_RANK: Record<PlanTier, number> = {
  basic: 1,
  verified: 2,
  gold: 3,
};

export type PlanBadge = 'blue' | 'gold' | null;

export const PLAN_DEFINITIONS: Record<
  PlanTier,
  {
    priceCents: number;
    priceLabel: string;
    title: string;
    benefits: readonly string[];
    maxDurationCap: DurationCap;
    badge: PlanBadge;
    nameAccent: boolean;
    maxCaptionLength: number;
    maxCommentLength: number;
  }
> = {
  basic: {
    priceCents: 100,
    priceLabel: '$1',
    title: 'Voice',
    benefits: ['Record up to 5 minutes'],
    maxDurationCap: 300,
    badge: null,
    nameAccent: false,
    maxCaptionLength: 500,
    maxCommentLength: 500,
  },
  verified: {
    priceCents: 300,
    priceLabel: '$3',
    title: 'Verified',
    benefits: ['Blue tick on your profile', 'Record up to 15 minutes'],
    maxDurationCap: 900,
    badge: 'blue',
    nameAccent: false,
    maxCaptionLength: 500,
    maxCommentLength: 500,
  },
  gold: {
    priceCents: 500,
    priceLabel: '$5',
    title: 'Gold',
    benefits: ['Gold tick and gold name', 'Record up to 30 minutes', 'Longer captions and comments'],
    maxDurationCap: 1800,
    badge: 'gold',
    nameAccent: true,
    maxCaptionLength: 1000,
    maxCommentLength: 1000,
  },
};

/** @deprecated use PLAN_DEFINITIONS.basic.priceCents */
export const STUDIO_PRICE_CENTS = PLAN_DEFINITIONS.basic.priceCents;
/** @deprecated use PLAN_DEFINITIONS.basic.priceLabel */
export const STUDIO_PRICE_LABEL = PLAN_DEFINITIONS.basic.priceLabel;

export function planPurpose(tier: PlanTier) {
  return `plan_${tier}` as const;
}

export function tierFromPurpose(purpose: string): PlanTier | null {
  if (purpose === 'plan_basic' || purpose === 'studio') return 'basic';
  if (purpose === 'plan_verified') return 'verified';
  if (purpose === 'plan_gold') return 'gold';
  return null;
}

export function isPlanActive(
  planUntil: Date | string | null | undefined,
  now = Date.now(),
): boolean {
  if (!planUntil) return false;
  const ms = planUntil instanceof Date ? planUntil.getTime() : Date.parse(planUntil);
  return Number.isFinite(ms) && ms > now;
}

export function activePlanTier(
  planTier: PlanTier | string | null | undefined,
  planUntil: Date | string | null | undefined,
  now = Date.now(),
): PlanTier | null {
  if (!planTier || !isPlanActive(planUntil, now)) return null;
  return PLAN_TIERS.includes(planTier as PlanTier) ? (planTier as PlanTier) : null;
}

/** Any paid plan active (backwards compat with isStudio). */
export function isStudioActive(
  planUntil: Date | string | null | undefined,
  now = Date.now(),
): boolean {
  return isPlanActive(planUntil, now);
}

export function planBadge(tier: PlanTier | null | undefined): PlanBadge {
  if (!tier) return null;
  return PLAN_DEFINITIONS[tier].badge;
}

export function allowedDurationCaps(tier: PlanTier | null | undefined): DurationCap[] {
  if (!tier) return [...FREE_DURATION_CAPS];
  const max = PLAN_DEFINITIONS[tier].maxDurationCap;
  return DURATION_CAPS.filter((cap) => cap <= max);
}

export function canUseDurationCap(cap: number, tier: PlanTier | null | undefined): boolean {
  return allowedDurationCaps(tier).includes(cap as DurationCap);
}

export function maxCaptionLength(tier: PlanTier | null | undefined): number {
  if (!tier) return PLAN_DEFINITIONS.basic.maxCaptionLength;
  return PLAN_DEFINITIONS[tier].maxCaptionLength;
}

export function maxCommentLength(tier: PlanTier | null | undefined): number {
  if (!tier) return PLAN_DEFINITIONS.basic.maxCommentLength;
  return PLAN_DEFINITIONS[tier].maxCommentLength;
}

export function comparePlanTier(a: PlanTier, b: PlanTier): number {
  return PLAN_TIER_RANK[a] - PLAN_TIER_RANK[b];
}

export function planList() {
  return PLAN_TIERS.map((tier) => ({
    tier,
    ...PLAN_DEFINITIONS[tier],
  }));
}
