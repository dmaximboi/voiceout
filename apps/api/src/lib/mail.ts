import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../env.js';
import {
  buildMailContent,
  renderMailHtml,
  renderMailText,
  type MailKind,
} from './mailTemplates.js';

export async function sendMail(
  env: Env,
  log: FastifyBaseLogger,
  opts: {
    to: string;
    subject?: string;
    text?: string;
    html?: string;
    url?: string;
    kind?: MailKind;
    code?: string;
  },
) {
  const templated = opts.kind
    ? (() => {
        const content = buildMailContent(opts.kind!, { url: opts.url, code: opts.code });
        return {
          subject: content.subject,
          text: renderMailText(content),
          html: renderMailHtml(env, content),
        };
      })()
    : null;

  const subject = opts.subject ?? templated?.subject;
  const text = opts.text ?? templated?.text;
  const html = opts.html ?? templated?.html;
  if (!subject || !text) {
    log.error({ to: opts.to }, 'email missing subject/text');
    return { sent: false as const };
  }

  if (!env.RESEND_API_KEY) {
    log.info({ to: opts.to, subject, url: opts.url }, 'email not sent (no RESEND_API_KEY)');
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
      subject,
      text,
      ...(html ? { html } : {}),
    }),
  });
  if (!res.ok) {
    log.error({ status: res.status, body: await res.text() }, 'resend failed');
    return { sent: false as const };
  }
  const payload = (await res.json().catch(() => ({}))) as { id?: string };
  log.info({ to: opts.to, subject, resendId: payload.id }, 'resend ok');
  return { sent: true as const };
}
