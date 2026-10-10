import { AsyncLocalStorage } from 'node:async_hooks';
import { dbFromClient, type Db, type SqlClient } from '@voiceout/db';

type Reserved = Awaited<ReturnType<SqlClient['reserve']>>;

export type RequestTx = {
  reserved: Reserved;
  db: Db;
  done: boolean;
  savepoints: number;
  timer?: ReturnType<typeof setTimeout>;
};

const als = new AsyncLocalStorage<RequestTx>();

/** Hard ceiling so a handler that never replies cannot pin a pool slot. */
const REQUEST_TX_MAX_MS = 150_000;

function activeTx(): RequestTx | null {
  const tx = als.getStore();
  return tx && !tx.done ? tx : null;
}

/**
 * `app.db` inside a request runs on that request's transaction (so `app.rls` /
 * `app.user_id` hold for every statement). Outside a request it is the plain pool,
 * where fail-closed RLS denies everything that is not explicitly opened.
 */
export function attachRequestDb(fallback: Db): Db {
  return new Proxy(fallback, {
    get(_target, prop) {
      const tx = activeTx();
      if (tx && prop === 'transaction') {
        return <T>(fn: (inner: Db) => Promise<T>) => savepoint(tx, fn);
      }
      const db = tx?.db ?? fallback;
      const value = Reflect.get(db, prop, db);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(db)
        : value;
    },
  }) as Db;
}

async function savepoint<T>(tx: RequestTx, fn: (inner: Db) => Promise<T>): Promise<T> {
  const name = `vo_sp_${++tx.savepoints}`;
  await tx.reserved.unsafe(`savepoint ${name}`);
  try {
    const out = await fn(tx.db);
    await tx.reserved.unsafe(`release savepoint ${name}`);
    return out;
  } catch (err) {
    await tx.reserved.unsafe(`rollback to savepoint ${name}`).catch(() => undefined);
    throw err;
  }
}

export async function beginRequestTx(client: SqlClient): Promise<RequestTx> {
  const reserved = await client.reserve();
  try {
    await reserved`begin`;
    await reserved`
      select
        set_config('app.rls', 'on', true),
        set_config('app.user_id', '', true),
        set_config('app.session_id', '', true),
        set_config('app.allow_password', '', true),
        set_config('idle_in_transaction_session_timeout', '60000', true)
    `;
  } catch (err) {
    await reserved`rollback`.catch(() => undefined);
    reserved.release();
    throw err;
  }
  // Reserved connections share the pool's parsers but do not expose `options`, which drizzle reads.
  const db = dbFromClient(Object.assign(reserved, { options: client.options }));
  const tx: RequestTx = { reserved, db, done: false, savepoints: 0 };
  tx.timer = setTimeout(() => void finishRequestTx(tx, false), REQUEST_TX_MAX_MS);
  tx.timer.unref?.();
  return tx;
}

/** Run `next` (Fastify's hook `done`) inside the request transaction scope. */
export function enterRequestTx(tx: RequestTx, next: () => void) {
  als.run(tx, next);
}

/** A failed commit rethrows so the client gets an error instead of a false success. */
export async function finishRequestTx(tx: RequestTx | undefined, commit: boolean) {
  if (!tx || tx.done) return;
  tx.done = true;
  if (tx.timer) clearTimeout(tx.timer);
  try {
    if (commit) await tx.reserved`commit`;
    else await tx.reserved`rollback`;
  } catch (err) {
    await tx.reserved`rollback`.catch(() => undefined);
    if (commit) throw err;
  } finally {
    tx.reserved.release();
  }
}
