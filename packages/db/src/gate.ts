import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const envPath = resolve(root, '.env');
config({ path: envPath });

const ownerUrl = process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL;
if (!ownerUrl) {
  console.error('DATABASE_OWNER_URL or DATABASE_URL is required');
  process.exit(1);
}

const appUser = ident(process.env.DATABASE_APP_USER || 'voiceout_app');
let appPassword = process.env.DATABASE_APP_PASSWORD || '';
if (!appPassword) {
  appPassword = randomBytes(24).toString('base64url');
}

const parsed = new URL(ownerUrl.replace(/^postgres(ql)?:/, 'http:'));
const dbName = ident(decodeURIComponent(parsed.pathname.replace(/^\//, '') || 'voiceout'));
const host = parsed.hostname || 'localhost';
const port = parsed.port || '5432';
const appUrl = `postgres://${encodeURIComponent(appUser)}:${encodeURIComponent(appPassword)}@${host}:${port}/${dbName}`;
const passwordLiteral = `'${appPassword.replace(/'/g, "''")}'`;

const sql = postgres(ownerUrl, { max: 1 });

await sql.unsafe(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appUser}') THEN
    CREATE ROLE ${appUser} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${passwordLiteral};
  ELSE
    ALTER ROLE ${appUser} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${passwordLiteral};
  END IF;
END
$$;
`);

await sql.unsafe(`REVOKE ALL ON DATABASE ${dbName} FROM PUBLIC`);
await sql.unsafe(`GRANT CONNECT ON DATABASE ${dbName} TO ${appUser}`);
await sql.unsafe('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${appUser}`);
await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appUser}`);
await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appUser}`);
await sql.unsafe(
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appUser}`,
);
await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${appUser}`);
await sql.end();

upsertEnv({
  DATABASE_OWNER_URL: ownerUrl,
  DATABASE_APP_USER: appUser,
  DATABASE_APP_PASSWORD: appPassword,
  DATABASE_URL: appUrl,
});

console.log('database gate ready: app role can only read and write rows, owner URL stays on DATABASE_OWNER_URL');

function ident(name: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error('invalid identifier');
  }
  return name;
}

function upsertEnv(values: Record<string, string>) {
  let text = '';
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    text = '';
  }
  const lines = text.split(/\r?\n/);
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const m = /^([A-Z0-9_]+)=/.exec(line);
    if (!m?.[1] || !(m[1] in values)) return line;
    seen.add(m[1]);
    return `${m[1]}=${values[m[1]]}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  writeFileSync(envPath, `${next.join('\n').replace(/\n*$/, '\n')}`);
}
