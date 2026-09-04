import { eq, sql } from 'drizzle-orm';
import { users, type Db } from '@voiceout/db';
import type { Env } from '../env.js';

type BootstrapUser = typeof users.$inferSelect;

export function parseAdminEmails(env: Env): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Promote bootstrap admins listed in ADMIN_EMAILS (comma-separated). */
export async function ensureBootstrapAdmin(db: Db, env: Env, user: BootstrapUser): Promise<BootstrapUser> {
  const emails = parseAdminEmails(env);
  if (!emails.has(user.email.toLowerCase())) return user;
  if (user.role === 'admin') return user;
  await db.execute(sql`select set_config('app.rls', 'off', true)`);
  const [updated] = await db
    .update(users)
    .set({ role: 'admin', updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();
  return updated ?? { ...user, role: 'admin' };
}
