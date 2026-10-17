import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.js';

// OWASP's scrypt N=2^15, r=8, p=3 configuration, with bounded concurrency.
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
let activeHashes = 0;
async function derive(password: string, salt: string) {
  if (activeHashes >= 4) throw new HttpError(503, 'Authentication is busy. Please try again shortly.');
  activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, parameters, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally { activeHashes--; }
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$32768$8$3$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
const dummyHash = `scrypt$32768$8$3$${'0'.repeat(32)}$${'0'.repeat(128)}`;
export async function verifyPassword(password: string, encoded: string | null) {
  const parts = (encoded ?? dummyHash).split('$');
  const [algorithm, n, r, p, salt, hash] = parts;
  if (parts.length !== 6 || algorithm !== 'scrypt' || n !== '32768' || r !== '8' || p !== '3' || !salt || !/^[a-f0-9]{32}$/.test(salt) || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex')) && encoded !== null;
}
export const randomToken = () => randomBytes(32).toString('hex');
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function sessionCookie(header: string | undefined) {
  const candidates = header?.split(';').map(part => part.trim()).filter(part => part.startsWith('splitmate_session=')) ?? [];
  if (candidates.length !== 1) return null;
  const token = candidates[0]!.slice('splitmate_session='.length);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export function sameToken(actual: string | undefined, expected: string) {
  return !!actual && /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
export function createAuthLimiter(max = 20, windowMs = 15 * 60_000, label = 'authentication') {
  const entries = new Map<string, { count: number; until: number }>();
  return (key: string, now = Date.now()) => {
    for (const [ip, entry] of entries) if (entry.until <= now) entries.delete(ip);
    let entry = entries.get(key);
    if (!entry) {
      if (entries.size >= 1000) throw new HttpError(429, `Too many ${label} attempts. Try again later.`, Math.ceil(windowMs / 1000));
      entry = { count: 0, until: now + windowMs };
      entries.set(key, entry);
    }
    if (++entry.count > max) throw new HttpError(429, `Too many ${label} attempts. Try again later.`, Math.ceil(windowMs / 1000));
  };
}
