import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, createAuthLimiter, randomToken, sameToken, sessionCookie, tokenHash } from '../src/security.js';
import { bodyObject, currency, email, groupId, password, text } from '../src/validation.js';

describe('Password and session primitives', () => {
  it('salts hashes uniquely and verifies the correct password only', async () => {
    const value = 'a long unique passphrase';
    const first = await hashPassword(value);
    const second = await hashPassword(value);
    expect(first).not.toBe(second);
    expect(first).not.toContain(value);
    expect(await verifyPassword(value, first)).toBe(true);
    expect(await verifyPassword('wrong long passphrase', first)).toBe(false);
    expect(await verifyPassword(value, null)).toBe(false);
    expect(await verifyPassword(value, 'malformed')).toBe(false);
  });
  it('accepts one valid opaque cookie and rejects duplicate/malformed tokens', () => {
    const token = randomToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash(token)).not.toBe(token);
    expect(sessionCookie(`other=x; splitmate_session=${token}`)).toBe(token);
    expect(sessionCookie(`splitmate_session=${token}; splitmate_session=${token}`)).toBeNull();
    expect(sessionCookie('splitmate_session=%ZZ')).toBeNull();
    expect(sessionCookie(undefined)).toBeNull();
    expect(sameToken(token, token)).toBe(true);
    expect(sameToken(randomToken(), token)).toBe(false);
    expect(sameToken('short', token)).toBe(false);
  });
  it('limits attempts and expires the attempt window', () => {
    const limit = createAuthLimiter(2, 1000);
    limit('one', 0); limit('one', 1);
    expect(() => limit('one', 2)).toThrow('Too many');
    expect(() => limit('two', 3)).not.toThrow();
    expect(() => limit('one', 1001)).not.toThrow();
  });
});
describe('Input validation', () => {
  it('normalizes identities and rejects unsafe or unsupported inputs', () => {
    expect(email(' Alex@Example.Test ')).toBe('alex@example.test');
    expect(text(' Home ', 'Name', 100)).toBe('Home');
    expect(password('  twelve character password  ')).toBe('  twelve character password  ');
    expect(currency(undefined)).toBe('EUR');
    expect(() => password('short')).toThrow();
    expect(() => email('not-an-email')).toThrow();
    expect(() => text('bad\nname', 'Name', 100)).toThrow();
    expect(() => currency('BTC')).toThrow();
    expect(() => groupId('invalid')).toThrow();
    expect(() => bodyObject({ role: 'OWNER' }, ['email'])).toThrow();
    expect(() => bodyObject([], [])).toThrow();
  });
});
