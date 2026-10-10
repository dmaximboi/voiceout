import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  return argon2id({
    password: plain,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 19456,
    hashLength: 32,
    outputType: 'encoded',
  });
}

/** Constant-time dummy so a missing account takes the same path as a bad password. */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=3,p=1$A6evOJErAMIwL9kDni1Odw$VM3F1zbbqkXn2tOJM7gPFujuEkgHcdr0CuuqvQzrpxI';

export async function verifyPasswordOrDummy(hash: string | null | undefined, plain: string): Promise<boolean> {
  if (hash) return verifyPassword(hash, plain);
  await verifyPassword(DUMMY_PASSWORD_HASH, plain);
  return false;
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: plain, hash });
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
