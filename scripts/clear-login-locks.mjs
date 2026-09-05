/**
 * Clear login locks so users can sign in after soft-lock bugs.
 * Usage: node scripts/clear-login-locks.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
const sql = postgres(url, { ssl: 'require', max: 1 });
const before = await sql`
  select email, handle, failed_login_count, locked_until
  from users
  where locked_until is not null or failed_login_count > 0
  order by updated_at desc
  limit 20
`;
console.log('before', before);
const cleared = await sql`
  update users
  set failed_login_count = 0, locked_until = null, updated_at = now()
  where locked_until is not null or failed_login_count > 0
  returning email, handle
`;
console.log('cleared', cleared.length, cleared);
await sql.end();
