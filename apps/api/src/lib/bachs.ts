import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../env.js';
import { STUDIO_PRICE_CENTS } from '@voiceout/shared';

export function bachsApiBase(env: Env) {
  if (env.BACHS_API_BASE.trim()) return env.BACHS_API_BASE.replace(/\/$/, '');
  return env.BACHS_API_KEY.startsWith('sk_live_')
    ? 'https://api.bachs.io'
    : 'https://sandbox-api.bachs.io';
}

export function bachsConfigured(env: Env) {
  return Boolean(env.BACHS_API_KEY.trim());
}

export async function getBachsCheckout(env: Env, checkoutId: string) {
  const res = await fetch(`${bachsApiBase(env)}/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${env.BACHS_API_KEY}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    checkout_id?: string;
    status?: string;
    payment_status?: string;
    error?: { message?: string };
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.error?.message || json.message || 'Could not read checkout');
  }
  return json;
}

export function bachsCheckoutPaid(session: { status?: string; payment_status?: string }) {
  const status = (session.status ?? '').toLowerCase();
  const payment = (session.payment_status ?? '').toLowerCase();
  return (
    payment === 'succeeded' ||
    status === 'completed' ||
    status === 'paid' ||
    status === 'succeeded'
  );
}

export function studioPriceAmount() {
  return (STUDIO_PRICE_CENTS / 100).toFixed(2);
}

export async function createBachsCheckout(
  env: Env,
  input: {
    email: string;
    name: string;
    userId: string;
    successUrl: string;
    cancelUrl: string;
    reference: string;
  },
) {
  const body: Record<string, unknown> = {
    customer: { email: input.email, name: input.name },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    reference: input.reference.slice(0, 128),
    metadata: { user_id: input.userId, purpose: 'studio' },
    expires_in_minutes: 60,
  };
  if (env.BACHS_STUDIO_PRODUCT_ID.trim()) {
    body.product_cart = [{ product_id: env.BACHS_STUDIO_PRODUCT_ID.trim(), quantity: 1 }];
  } else {
    body.pricing = { currency: 'USD', amount: studioPriceAmount() };
  }

  const res = await fetch(`${bachsApiBase(env)}/v1/checkout-sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.BACHS_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    checkout_id?: string;
    checkout_url?: string;
    error?: { message?: string };
    message?: string;
  };
  if (!res.ok || !json.checkout_id || !json.checkout_url) {
    throw new Error(json.error?.message || json.message || 'Could not start checkout');
  }
  return { checkoutId: json.checkout_id, checkoutUrl: json.checkout_url };
}

export function verifyBachsSignature(
  rawBody: string,
  secret: string,
  timestampHeader: string,
  signatureHeader: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!secret || !timestampHeader || !signatureHeader) return false;
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
