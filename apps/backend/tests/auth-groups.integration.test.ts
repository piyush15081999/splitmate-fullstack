import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../src/database.js';
import { createApp } from '../src/app.js';
import { tokenHash, verifyPassword } from '../src/security.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || new URL(connectionString).pathname !== '/splitmate_test') {
  throw new Error('Integration tests require TEST_DATABASE_URL pointing to the dedicated splitmate_test database. Never use the application database.');
}
const prisma = createDatabaseClient(connectionString);
const origin = 'http://localhost:5173';
const passphrase = 'a unique integration passphrase';
const users: string[] = [];
const groups: string[] = [];
const identities = new Map<string, Account>();
let app = createApp(async () => { await prisma.$queryRaw`SELECT 1`; }, { prisma, webOrigin: origin, secureCookies: false });
beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
beforeEach(() => { app = createApp(async () => { await prisma.$queryRaw`SELECT 1`; }, { prisma, webOrigin: origin, secureCookies: false }); });
afterAll(async () => {
  // Remove only records created by this suite. No truncation, no application DB reset.
  await prisma.$transaction([
    prisma.expenseShare.deleteMany({ where: { groupId: { in: groups } } }),
    prisma.settlement.deleteMany({ where: { groupId: { in: groups } } }),
    prisma.expense.deleteMany({ where: { groupId: { in: groups } } }),
    prisma.groupMember.deleteMany({ where: { groupId: { in: groups } } }),
    prisma.group.deleteMany({ where: { id: { in: groups } } }),
    prisma.user.deleteMany({ where: { id: { in: users } } }),
  ]);
  await prisma.$disconnect();
});
async function register() {
  const agent = request.agent(app);
  const email = `phase2-${randomUUID()}@example.test`;
  const response = await agent.post('/api/auth/register').set('Origin', origin).send({ displayName: ' Alex ', email, password: passphrase });
  expect(response.status).toBe(201);
  users.push(response.body.user.id);
  const cookies = response.headers['set-cookie'] as unknown as string[];
  const cookie = cookies[0]!.split(';')[0]!;
  const account = { agent, email, user: response.body.user as { id: string; email: string }, csrf: response.body.csrfToken as string, cookie, response };
  identities.set(email, account); return account;
}
type Account = Awaited<ReturnType<typeof register>>;
async function createGroup(account: Account, name = 'Our real group') {
  const response = await account.agent.post('/api/groups').set('Origin', origin).set('X-CSRF-Token', account.csrf).send({ name, currency: 'EUR' });
  expect(response.status).toBe(201);
  groups.push(response.body.group.id);
  return response.body.group as { id: string; name: string; members: { role: string; user: { id: string } }[] };
}
async function add(owner: Account, id: string, email: string) {
  const invite = await owner.agent.post(`/api/groups/${id}/invitations`).set('Origin', origin).set('X-CSRF-Token', owner.csrf).send({ email });
  if (invite.status !== 201) return invite;
  const target = identities.get(email.toLowerCase());
  if (!target) throw new Error('Test invitee is missing');
  return target.agent.post(`/api/invitations/${invite.body.invitation.id}/respond`).set('Origin', origin).set('X-CSRF-Token', target.csrf).send({ decision: 'ACCEPT' });
}
async function leave(account: Account, id: string) {
  return account.agent.post(`/api/groups/${id}/leave`).set('Origin', origin).set('X-CSRF-Token', account.csrf).send({});
}

describe('Authentication against PostgreSQL', () => {
  it('registers with a salted hash, HttpOnly cookie and hashed persisted session', async () => {
    const account = await register();
    expect(account.response.headers['set-cookie']![0]).toContain('HttpOnly');
    expect(account.response.headers['set-cookie']![0]).toContain('SameSite=Strict');
    expect(account.response.headers['cache-control']).toBe('no-store');
    expect(account.response.body.user).toEqual({ id: account.user.id, email: account.email, displayName: 'Alex' });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: account.user.id } });
    expect(user.passwordHash).not.toBe(passphrase);
    expect(await verifyPassword(passphrase, user.passwordHash)).toBe(true);
    const token = account.cookie.split('=')[1]!;
    const session = await prisma.session.findUniqueOrThrow({ where: { tokenHash: tokenHash(token) } });
    expect(session.tokenHash).not.toBe(token);
    expect(session.csrfToken).toBe(account.csrf);
    const me = await account.agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).not.toHaveProperty('passwordHash');
  });
  it('normalizes email and rejects duplicate registration', async () => {
    const account = await register();
    const duplicate = await request(app).post('/api/auth/register').set('Origin', origin).send({ displayName: 'Other', email: ` ${account.email.toUpperCase()} `, password: passphrase });
    expect(duplicate.status).toBe(409);
  });
  it.each([
    { displayName: '', email: 'valid@example.test', password: passphrase },
    { displayName: 'Alex', email: 'invalid', password: passphrase },
    { displayName: 'Alex', email: 'valid@example.test', password: 'short' },
    { displayName: 'Alex', email: 'valid@example.test', password: 'a'.repeat(129) },
    { displayName: 'Alex', email: 'valid@example.test', password: passphrase, role: 'OWNER' },
  ])('rejects invalid registration %#', async body => {
    expect((await request(app).post('/api/auth/register').set('Origin', origin).send(body)).status).toBe(400);
  });
  it('returns the same error for unknown email and wrong password', async () => {
    const account = await register();
    const wrong = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: account.email, password: 'wrong but long password' });
    const missing = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: 'unknown@example.test', password: passphrase });
    expect(wrong.status).toBe(401); expect(missing.status).toBe(401); expect(wrong.body).toEqual(missing.body);
  });
  it('rotates the current browser session on login and revokes it on logout', async () => {
    const account = await register();
    const login = await account.agent.post('/api/auth/login').set('Origin', origin).send({ email: account.email.toUpperCase(), password: passphrase });
    expect(login.status).toBe(200);
    expect(login.headers['set-cookie']![0]).not.toContain(account.cookie);
    expect((await request(app).get('/api/auth/me').set('Cookie', account.cookie)).status).toBe(401);
    expect((await account.agent.post('/api/auth/logout').set('Origin', origin).send({})).status).toBe(403);
    const logout = await account.agent.post('/api/auth/logout').set('Origin', origin).set('X-CSRF-Token', login.body.csrfToken).send({});
    expect(logout.status).toBe(204);
    expect(logout.headers['set-cookie']![0]).toContain('Expires=Thu, 01 Jan 1970');
    expect((await account.agent.get('/api/auth/me')).status).toBe(401);
    expect(await prisma.session.count({ where: { userId: account.user.id } })).toBe(0);
  });
  it('rejects missing, forged, malformed and expired session cookies', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', `splitmate_session=${'a'.repeat(64)}`)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', 'splitmate_session=%xx')).status).toBe(401);
    const account = await register();
    await prisma.session.updateMany({ where: { userId: account.user.id }, data: { expiresAt: new Date(0) } });
    expect((await account.agent.get('/api/auth/me')).status).toBe(401);
  });
  it('does not allow claiming a legacy account without a password', async () => {
    const email = `legacy-${randomUUID()}@example.test`;
    const user = await prisma.user.create({ data: { displayName: 'Legacy', email } }); users.push(user.id);
    expect((await request(app).post('/api/auth/login').set('Origin', origin).send({ email, password: passphrase })).status).toBe(401);
    expect((await request(app).post('/api/auth/register').set('Origin', origin).send({ displayName: 'Claim', email, password: passphrase })).status).toBe(409);
  });
  it('blocks missing/cross-site Origin, non-JSON forms and CSRF without changing data', async () => {
    expect((await request(app).post('/api/auth/login').send({})).status).toBe(403);
    expect((await request(app).post('/api/auth/register').set('Origin', 'http://evil.test').send({})).status).toBe(403);
    expect((await request(app).post('/api/auth/login').set('Origin', origin).type('form').send({ email: 'x' })).status).toBe(415);
    const account = await register();
    expect((await account.agent.post('/api/groups').set('Origin', origin).send({ name: 'blocked' })).status).toBe(403);
    expect((await account.agent.post('/api/groups').set('Origin', origin).set('X-CSRF-Token', 'a'.repeat(64)).send({ name: 'blocked' })).status).toBe(403);
    expect(await prisma.groupMember.count({ where: { userId: account.user.id } })).toBe(0);
  });
  it('throttles authentication attempts', async () => {
    for (let index = 0; index < 20; index++) expect((await request(app).post('/api/auth/login').set('Origin', origin).send({})).status).toBe(400);
    const response = await request(app).post('/api/auth/login').set('Origin', origin).send({});
    expect(response.status).toBe(429); expect(response.headers['retry-after']).toBe('900');
  });
});

describe('Group permissions against PostgreSQL', () => {
  it('protects group endpoints without a session', async () => {
    const id = randomUUID();
    expect((await request(app).get('/api/groups')).status).toBe(401);
    expect((await request(app).get(`/api/groups/${id}`)).status).toBe(401);
    expect((await request(app).get(`/api/groups/${id}/members`)).status).toBe(401);
    for (const path of ['/api/groups', `/api/groups/${id}/members`, `/api/groups/${id}/leave`]) expect((await request(app).post(path).set('Origin', origin).send({})).status).toBe(401);
  });
  it('creates an owner membership atomically and lists only the actor’s groups', async () => {
    const owner = await register(); const outsider = await register();
    const group = await createGroup(owner);
    expect(group.members).toEqual([expect.objectContaining({ role: 'OWNER', user: expect.objectContaining({ id: owner.user.id }) })]);
    const own = await owner.agent.get('/api/groups');
    expect(own.body.groups).toEqual([expect.objectContaining({ id: group.id, memberCount: 1, role: 'OWNER' })]);
    expect((await outsider.agent.get('/api/groups')).body.groups).toEqual([]);
    expect((await outsider.agent.get(`/api/groups/${group.id}`)).status).toBe(404);
    expect((await outsider.agent.get(`/api/groups/${group.id}/members`)).status).toBe(404);
    expect((await add(outsider, group.id, owner.email)).status).toBe(404);
    expect((await leave(outsider, group.id)).status).toBe(404);
  });
  it('adds an existing user, shares member details, and refuses member privilege escalation', async () => {
    const owner = await register(); const member = await register(); const third = await register(); const group = await createGroup(owner);
    expect((await add(owner, group.id, member.email.toUpperCase())).status).toBe(200);
    expect((await add(owner, group.id, member.email)).status).toBe(409);
    expect((await member.agent.get('/api/groups')).body.groups[0].role).toBe('MEMBER');
    const detail = await member.agent.get(`/api/groups/${group.id}`);
    expect(detail.status).toBe(200); expect(detail.body.group.members).toHaveLength(2); expect(detail.text).not.toContain('passwordHash');
    expect((await member.agent.get(`/api/groups/${group.id}/members`)).body.members).toHaveLength(2);
    expect((await add(member, group.id, third.email)).status).toBe(403);
    expect((await add(owner, group.id, 'not-registered@example.test')).status).toBe(404);
    expect((await member.agent.post(`/api/groups/${group.id}/members`).set('Origin', origin).set('X-CSRF-Token', member.csrf).send({ email: third.email, role: 'OWNER' })).status).toBe(400);
  });
  it('lets a member leave, revokes access and prevents the owner abandoning members', async () => {
    const owner = await register(); const member = await register(); const group = await createGroup(owner); await add(owner, group.id, member.email);
    expect((await leave(owner, group.id)).status).toBe(409);
    expect((await leave(member, group.id)).status).toBe(200);
    expect((await member.agent.get(`/api/groups/${group.id}`)).status).toBe(404);
    expect((await member.agent.get('/api/groups')).body.groups).toEqual([]);
    expect((await leave(owner, group.id)).status).toBe(200);
    expect(await prisma.group.findUnique({ where: { id: group.id } })).toBeNull();
  });
  it('preserves membership and group when financial history exists', async () => {
    const owner = await register(); const member = await register(); const group = await createGroup(owner); await add(owner, group.id, member.email);
    await prisma.expense.create({ data: { groupId: group.id, paidById: owner.user.id, description: 'Historical record', amountMinor: 1234, shares: { create: { userId: member.user.id, amountMinor: 1234 } } } });
    expect((await leave(member, group.id)).status).toBe(409);
    expect(await prisma.groupMember.count({ where: { groupId: group.id } })).toBe(2);
    const solo = await createGroup(owner, 'Historical solo group');
    await prisma.expense.create({ data: { groupId: solo.id, paidById: owner.user.id, description: 'Historical solo record', amountMinor: 10, shares: { create: { userId: owner.user.id, amountMinor: 10 } } } });
    expect((await leave(owner, solo.id)).status).toBe(409);
  });
  it('retires immediate membership and requires explicit invitation acceptance', async () => {
    const owner = await register(); const member = await register(); const group = await createGroup(owner);
    expect((await owner.agent.post(`/api/groups/${group.id}/members`).set('Origin', origin).set('X-CSRF-Token', owner.csrf).send({ email: member.email })).status).toBe(410);
    const invite = () => owner.agent.post(`/api/groups/${group.id}/invitations`).set('Origin', origin).set('X-CSRF-Token', owner.csrf).send({ email: member.email });
    const responses = await Promise.all([invite(), invite()]); expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
    expect(await prisma.groupMember.count({ where: { groupId: group.id, userId: member.user.id } })).toBe(0);
    expect((await member.agent.get(`/api/groups/${group.id}`)).status).toBe(404);
    const accepted = await member.agent.post(`/api/invitations/${responses[0]!.body.invitation.id}/respond`).set('Origin', origin).set('X-CSRF-Token', member.csrf).send({ decision: 'ACCEPT' });
    expect(accepted.status).toBe(200); expect(await prisma.groupMember.count({ where: { groupId: group.id, userId: member.user.id } })).toBe(1);
  });
  it('validates identifiers, group fields and ignores no ownership overposting', async () => {
    const owner = await register();
    expect((await owner.agent.get('/api/groups/not-a-uuid')).status).toBe(400);
    for (const body of [{ name: '' }, { name: 'Valid', currency: 'BTC' }, { name: 'Valid', userId: randomUUID() }]) {
      expect((await owner.agent.post('/api/groups').set('Origin', origin).set('X-CSRF-Token', owner.csrf).send(body)).status).toBe(400);
    }
    expect(await prisma.groupMember.count({ where: { userId: owner.user.id } })).toBe(0);
  });
});


describe('Authenticated mutation throttling', () => {
  it('limits writes per authenticated user and still allows logout', async () => {
    const account = await register();
    for (let n = 0; n < 120; n++) expect((await account.agent.post(`/api/groups/${randomUUID()}/leave`).set('Origin', origin).set('X-CSRF-Token', account.csrf).send({})).status).toBe(404);
    const limited = await account.agent.post('/api/groups').set('Origin', origin).set('X-CSRF-Token', account.csrf).send({ name: 'Blocked group' });
    expect(limited.status).toBe(429); expect(limited.headers['retry-after']).toBe('60');
    expect((await account.agent.post('/api/auth/logout').set('Origin', origin).set('X-CSRF-Token', account.csrf).send({})).status).toBe(204);
  });
});


it('enforces PostgreSQL statement timeouts and rolls back cancelled writes', async () => {
  const settings = await prisma.$queryRaw<{ statement_timeout: string }[]>`SHOW statement_timeout`;
  expect(settings[0]!.statement_timeout).toBe('10s');
  const id = randomUUID(); groups.push(id);
  await expect(prisma.$transaction(async tx => {
    await tx.group.create({ data: { id, name: 'Cancelled transaction', currency: 'EUR' } });
    await tx.$executeRaw`SET LOCAL statement_timeout = '50ms'`;
    await tx.$queryRaw`SELECT 1::integer AS value FROM pg_sleep(0.2)`;
  })).rejects.toThrow(/statement timeout/);
  expect(await prisma.group.findUnique({ where: { id } })).toBeNull();
});

it('sets Secure cookies when HTTPS cookie mode is enabled', async () => {
  app = createApp(async () => { await prisma.$queryRaw`SELECT 1`; }, { prisma, webOrigin: origin, secureCookies: true });
  const account = await register();
  expect(account.response.headers['set-cookie']![0]).toContain('Secure');
  expect(account.response.headers['set-cookie']![0]).toContain('HttpOnly');
  expect(account.response.headers['set-cookie']![0]).toContain('SameSite=Strict');
});

it('retains a secure database session across application instance replacement', async () => {
  const webOrigin = 'https://splitmate.example';
  const first = createApp(async () => {}, { prisma, webOrigin, secureCookies: true }, { production: true, trustProxy: 1 });
  const response = await request(first).post('/api/auth/register').set('Origin', webOrigin).set('X-Forwarded-Proto', 'https').send({ displayName: 'Fictional Restart User', email: 'restart-' + randomUUID() + '@example.test', password: passphrase });
  expect(response.status).toBe(201); users.push(response.body.user.id);
  const cookie = response.headers['set-cookie']![0]!.split(';')[0]!;
  const restarted = createApp(async () => {}, { prisma, webOrigin, secureCookies: true }, { production: true, trustProxy: 1 });
  const me = await request(restarted).get('/api/auth/me').set('Cookie', cookie).set('X-Forwarded-Proto', 'https');
  expect(me.status).toBe(200); expect(me.body.user.id).toBe(response.body.user.id); expect(me.body.csrfToken).toBe(response.body.csrfToken);
  expect((await request(restarted).post('/api/auth/logout').set('Origin', webOrigin).set('Cookie', cookie).set('X-CSRF-Token', me.body.csrfToken).send({})).status).toBe(204);
  expect((await request(first).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
});
it('uses the nearest forwarded client address for Render limits without trusting earlier spoofed entries', async () => {
  const webOrigin = 'https://splitmate.example';
  const instance = createApp(async () => {}, { prisma, webOrigin, secureCookies: true }, { production: true, trustProxy: 1 });
  for (let i = 0; i < 20; i++) expect((await request(instance).post('/api/auth/login').set('Origin', webOrigin).set('X-Forwarded-For', '203.0.113.1, 198.51.100.10').send({})).status).toBe(400);
  expect((await request(instance).post('/api/auth/login').set('Origin', webOrigin).set('X-Forwarded-For', '203.0.113.2, 198.51.100.10').send({})).status).toBe(429);
  expect((await request(instance).post('/api/auth/login').set('Origin', webOrigin).set('X-Forwarded-For', '198.51.100.11').send({})).status).toBe(400);
});
