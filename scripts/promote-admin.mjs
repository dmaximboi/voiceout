/**
 * One-shot: promote an email to admin using .env.production.local
 * Usage: node scripts/promote-admin.mjs dmaximboy@gmail.com
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/promote-admin.mjs you@example.com');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'packages/db/package.json'));
const postgres = require('postgres');

const raw = readFileSync(join(root, '.env.production.local'), 'utf8');
const env = Object.fromEntries(
  raw
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const url = env.DATABASE_OWNER_URL || env.DATABASE_URL;
if (!url) {
  console.error('No DATABASE_URL in .env.production.local');
  process.exit(1);
}

const sql = postgres(url, { ssl: 'require', max: 1 });
const before = await sql`
  select id, email, handle, role from users where lower(email) = lower(${email})
`;
console.log('before', before);
if (!before.length) {
  const recent = await sql`
    select email, handle, role from users order by created_at desc limit 12
  `;
  console.log('no match; recent accounts:', recent);
  await sql.end();
  process.exit(2);
}
const after = await sql`
  update users
  set role = 'admin', updated_at = now()
  where lower(email) = lower(${email})
  returning id, email, handle, role
`;
console.log('after', after);
await sql.end();
