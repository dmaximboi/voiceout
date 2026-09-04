import type { Env } from '../env.js';

export type MailKind =
  | 'verify_email'
  | 'reset_password'
  | 'name_change_code'
  | 'email_link_code'
  | 'admin_stepup_code';

type MailContent = {
  subject: string;
  preview: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  url?: string;
  code?: string;
};

function logoUrl(env: Env) {
  const base = (env.PUBLIC_ORIGIN || env.WEB_ORIGIN).replace(/\/$/, '');
  return `${base}/logo.png`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildMailContent(kind: MailKind, opts: { url?: string; code?: string }): MailContent {
  switch (kind) {
    case 'verify_email':
      return {
        subject: 'Confirm your VoiceOut email',
        preview: 'One tap to verify your VoiceOut account.',
        heading: 'Welcome to VoiceOut',
        body: 'Confirm your email so you can post, rename your username, and keep your account safe.',
        ctaLabel: 'Verify email',
        url: opts.url,
      };
    case 'reset_password':
      return {
        subject: 'Reset your VoiceOut password',
        preview: 'Use this link to choose a new password.',
        heading: 'Reset your password',
        body: 'This link expires in one hour. If you did not ask for a reset, you can ignore this email.',
        ctaLabel: 'Choose a new password',
        url: opts.url,
      };
    case 'name_change_code':
      return {
        subject: 'Your VoiceOut username code',
        preview: 'Use this code to confirm a username change.',
        heading: 'Confirm username change',
        body: 'Enter this code in Settings. It expires in 10 minutes.',
        code: opts.code,
      };
    case 'email_link_code':
      return {
        subject: 'Confirm your email for VoiceOut',
        preview: 'Use this code to add your email.',
        heading: 'Confirm your email',
        body: 'Enter this code to link your email to VoiceOut. It expires in 10 minutes.',
        code: opts.code,
      };
    case 'admin_stepup_code':
      return {
        subject: 'VoiceOut panel confirmation code',
        preview: 'Your confirmation code for the admin panel.',
        heading: 'Panel confirmation',
        body: 'Enter this code to unlock sensitive admin actions. It expires in 10 minutes.',
        code: opts.code,
      };
  }
}

export function renderMailHtml(env: Env, content: MailContent) {
  const logo = escapeHtml(logoUrl(env));
  const heading = escapeHtml(content.heading);
  const body = escapeHtml(content.body);
  const preview = escapeHtml(content.preview);
  const cta = content.ctaLabel ? escapeHtml(content.ctaLabel) : '';
  const url = content.url ? escapeHtml(content.url) : '';
  const code = content.code ? escapeHtml(content.code) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:#f7f3ee;color:#1c1917;font-family:Georgia,'Times New Roman',serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f3ee;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#fffaf4;border:1px solid #eadfce;border-radius:24px;padding:28px 24px;">
          <tr>
            <td align="center" style="padding-bottom:18px;">
              <img src="${logo}" width="56" height="56" alt="VoiceOut" style="display:block;border-radius:14px;" />
            </td>
          </tr>
          <tr>
            <td align="center" style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#8a7460;padding-bottom:8px;">
              VoiceOut
            </td>
          </tr>
          <tr>
            <td align="center" style="font-size:26px;line-height:1.25;font-weight:700;color:#0a2540;padding-bottom:12px;">
              ${heading}
            </td>
          </tr>
          <tr>
            <td align="center" style="font-size:16px;line-height:1.55;color:#4a4038;padding-bottom:22px;">
              ${body}
            </td>
          </tr>
          ${
            code
              ? `<tr><td align="center" style="padding-bottom:22px;"><div style="display:inline-block;background:#f1e7da;border-radius:16px;padding:14px 22px;font-size:28px;letter-spacing:0.28em;font-weight:700;color:#0a2540;font-family:ui-monospace,Menlo,Consolas,monospace;">${code}</div></td></tr>`
              : ''
          }
          ${
            url && cta
              ? `<tr><td align="center" style="padding-bottom:18px;"><a href="${url}" style="display:inline-block;background:#0a2540;color:#fffaf4;text-decoration:none;border-radius:999px;padding:14px 22px;font-size:15px;font-weight:700;font-family:system-ui,-apple-system,Segoe UI,sans-serif;">${cta}</a></td></tr>
                 <tr><td align="center" style="font-size:12px;line-height:1.5;color:#8a7460;word-break:break-all;">Or open<br>${url}</td></tr>`
              : ''
          }
          <tr>
            <td align="center" style="padding-top:24px;font-size:12px;line-height:1.5;color:#9a8774;">
              Voice-first social. Made for real voices.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderMailText(content: MailContent) {
  const lines = [content.heading, '', content.body];
  if (content.code) lines.push('', `Code: ${content.code}`);
  if (content.url) lines.push('', content.url);
  lines.push('', 'VoiceOut');
  return lines.join('\n');
}
