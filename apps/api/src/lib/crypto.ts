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
