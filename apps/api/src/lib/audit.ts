import type { FastifyRequest } from 'fastify';
import { auditLogs, type Db } from '@voiceout/db';

export async function writeAudit(
  db: Db,
  req: FastifyRequest,
  action: string,
  userId: string | null = req.authUser?.id ?? null,
  meta?: Record<string, unknown>,
) {
  try {
    await db.insert(auditLogs).values({ userId, action, ip: req.ip, meta });
  } catch (err) {
    req.log.error({ err, action }, 'audit insert failed');
  }
}
