import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createSql(url: string) {
  return postgres(url, { max: 12, idle_timeout: 20, connect_timeout: 8 });
}

export function dbFromClient(client: postgres.Sql) {
  return drizzle(client, { schema });
}

export function createDb(url: string) {
  return dbFromClient(createSql(url));
}

export type SqlClient = postgres.Sql;
export type Db = ReturnType<typeof createDb>;
export * from './schema.js';
