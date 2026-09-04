import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../env.js';

export async function sendMail(
  env: Env,
  log: FastifyBaseLogger,
  opts: { to: string; subject: string; text: string; url?: string },
) {
  if (!env.RESEND_API_KEY) {
    log.info({ to: opts.to, subject: opts.subject, url: opts.url }, 'email not sent (no RESEND_API_KEY)');
    return { sent: false as const };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
    }),
  });
  if (!res.ok) {
    log.error({ status: res.status, body: await res.text() }, 'resend failed');
    return { sent: false as const };
  }
  const payload = (await res.json().catch(() => ({}))) as { id?: string };
  log.info({ to: opts.to, subject: opts.subject, resendId: payload.id }, 'resend ok');
  return { sent: true as const };
}
