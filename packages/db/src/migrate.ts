import { config } from 'dotenv';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import { readdirSync, readFileSync } from 'node:fs';
import postgres from 'postgres';

const url = process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_OWNER_URL or DATABASE_URL is required');
  process.exit(1);
}

const dir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(dir, '../migrations');
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = postgres(url, { max: 1 });
for (const file of files) {
  const sqlText = readFileSync(join(migrationsDir, file), 'utf8');
  await client.unsafe(sqlText);
  console.log('applied', file);
}
await client.end();
console.log('migrations applied');
