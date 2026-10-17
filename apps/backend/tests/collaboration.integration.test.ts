import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../src/database.js';
import { createApp } from '../src/app.js';
import { recordActivity } from '../src/activity.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/splitmate_test') throw new Error('Collaboration tests require the isolated splitmate_test database.');
const prisma = createDatabaseClient(url);
const origin = 'http://localhost:5173';
let app = createApp(async () => { await prisma.$queryRaw`SELECT 1`; }, { prisma, webOrigin: origin, secureCookies: false });
type Account = { id: string; email: string; cookie: string; csrf: string };
const accounts: Account[] = [], groups: string[] = [];
let id: string;
const owner = () => accounts[0]!;
function get(path: string, actor = owner()) { return request(app).get(`/api${path}`).set('Cookie', actor.cookie); }
function post(path: string, body: object, actor = owner(), key?: string) { const call = request(app).post(`/api${path}`).set('Cookie', actor.cookie).set('Origin', origin).set('X-CSRF-Token', actor.csrf); if (key) call.set('Idempotency-Key', key); return call.send(body); }
function expense(overrides: Record<string, unknown> = {}) { return { description: 'Shared dinner', amountMinor: 1001, paidById: owner().id, currency: 'EUR', date: '2026-01-15', category: 'FOOD', splitType: 'EQUAL', participants: [{ userId: accounts[1]!.id }], ...overrides }; }
function addExpense(body = expense(), key = randomUUID()) { return post(`/groups/${id}/expenses`, body, owner(), key); }
function invite() { return post(`/groups/${id}/invitations`, { email: accounts[2]!.email }); }
async function activity() { return (await get(`/groups/${id}/activity?pageSize=50`)).body.items as { id: string; action: string; actorId: string; referenceId: string; data: Record<string, unknown> }[]; }
beforeAll(async () => {
  for (let n = 0; n < 4; n++) {
    const email = `collaboration-${randomUUID()}@example.test`;
    const result = await request(app).post('/api/auth/register').set('Origin', origin).send({ displayName: `Collaboration user ${n}`, email, password: 'a unique collaboration integration passphrase' });
    expect(result.status).toBe(201); accounts.push({ id: result.body.user.id, email, csrf: result.body.csrfToken, cookie: (result.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]! });
  }
});
beforeEach(async () => {
  app = createApp(async () => { await prisma.$queryRaw`SELECT 1`; }, { prisma, webOrigin: origin, secureCookies: false });
  const result = await post('/groups', { name: 'Collaboration tests', currency: 'EUR' }); expect(result.status).toBe(201); id = result.body.group.id; groups.push(id);
  const invited = await post(`/groups/${id}/invitations`, { email: accounts[1]!.email }); expect(invited.status).toBe(201);
  expect((await post(`/invitations/${invited.body.invitation.id}/respond`, { decision: 'ACCEPT' }, accounts[1]!)).status).toBe(200);
});
afterAll(async () => {
  // Audit rows intentionally survive test identity/group deletion; test DB is isolated.
  await prisma.$transaction([
    prisma.settlementReversal.deleteMany({ where: { settlement: { groupId: { in: groups } } } }),
    prisma.settlement.deleteMany({ where: { groupId: { in: groups } } }),
    prisma.expenseShare.deleteMany({ where: { groupId: { in: groups } } }),
    prisma.expense.deleteMany({ where: { groupId: { in: groups } } }),
    prisma.groupMember.deleteMany({ where: { groupId: { in: groups } } }),
    prisma.group.deleteMany({ where: { id: { in: groups } } }),
    prisma.user.deleteMany({ where: { id: { in: accounts.map(a => a.id) } } }),
  ]); await prisma.$disconnect();
});
describe('Group activity and notifications', () => {
  it('records expense before/after snapshots and blocks SQL update/delete of audit rows', async () => {
    const created = await addExpense(); expect(created.status).toBe(201);
    const changed = await request(app).patch(`/api/groups/${id}/expenses/${created.body.expense.id}`).set('Cookie', owner().cookie).set('Origin', origin).set('X-CSRF-Token', owner().csrf).send({ ...expense({ description: 'Corrected dinner', amountMinor: 1200, paidById: accounts[1]!.id }), expectedVersion: 1 });
    expect(changed.status).toBe(200);
    const entries = await activity(), edit = entries.find(a => a.action === 'EXPENSE_UPDATED')!;
    expect(edit.actorId).toBe(owner().id); expect(edit.data.before).toMatchObject({ amountMinor: 1001, paidById: owner().id, version: 1 }); expect(edit.data.after).toMatchObject({ amountMinor: 1200, paidById: accounts[1]!.id, version: 2 });
    await expect(prisma.activity.update({ where: { id: edit.id }, data: { actorName: 'Forged' } })).rejects.toThrow();
    await expect(prisma.activity.delete({ where: { id: edit.id } })).rejects.toThrow();
  });
  it('deduplicates activity and recipient notifications under concurrent expense retries', async () => {
    const key = randomUUID(); const results = await Promise.all([addExpense(expense(), key), addExpense(expense(), key)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 201]);
    const entries = (await activity()).filter(a => a.action === 'EXPENSE_CREATED'); expect(entries).toHaveLength(1);
    expect(await prisma.notification.count({ where: { activityId: entries[0]!.id, userId: accounts[1]!.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { activityId: entries[0]!.id, userId: owner().id } })).toBe(0);
  });
  it('scopes reads and mark-as-read to the recipient and preserves the first read timestamp', async () => {
    await addExpense();
    const response = await get('/notifications', accounts[1]!); expect(response.status).toBe(200);
    const notification = response.body.items.find((n: { activity: { action: string } }) => n.activity.action === 'EXPENSE_CREATED');
    expect(notification).toBeTruthy(); expect((await post(`/notifications/${notification.id}/read`, {})).status).toBe(404);
    const first = await post(`/notifications/${notification.id}/read`, {}, accounts[1]!), again = await post(`/notifications/${notification.id}/read`, {}, accounts[1]!);
    expect(first.status).toBe(200); expect(again.body.notification.readAt).toBe(first.body.notification.readAt);
    const unread = await get('/notifications?unread=true', accounts[1]!); expect(unread.body.items.some((n: { id: string }) => n.id === notification.id)).toBe(false);
  });
  it('records repayments/reversals once without changing ledger invariants or exposing credentials', async () => {
    const created = await addExpense(), key = randomUUID(); const body = { fromUserId: accounts[1]!.id, toUserId: owner().id, amountMinor: 400, currency: 'EUR', date: '2026-01-16', mode: 'DIRECT' };
    const paid = await post(`/groups/${id}/settlements`, body, owner(), key); expect(paid.status).toBe(201);
    expect((await post(`/groups/${id}/settlements`, body, owner(), key)).status).toBe(200);
    const path = `/groups/${id}/settlements/${paid.body.settlement.id}/reverse`;
    expect((await post(path, { reason: 'Wrong record' })).status).toBe(200); expect((await post(path, { reason: 'Wrong record' })).status).toBe(200);
    const entries = await activity(); expect(entries.filter(a => a.action === 'REPAYMENT_RECORDED')).toHaveLength(1); expect(entries.filter(a => a.action === 'REPAYMENT_REVERSED')).toHaveLength(1);
    const ledger = await get(`/groups/${id}/ledger`); expect(ledger.body.expenses[0]).toEqual({ ...created.body.expense, canEdit: true }); expect(ledger.body.balances.reduce((sum: number, b: { netMinor: number }) => sum + b.netMinor, 0)).toBe(0);
    const sensitive = JSON.stringify({ entries, notifications: (await get('/notifications', accounts[1]!)).body });
    for (const key of ['passwordHash', 'csrfToken', 'tokenHash', 'requestHash', 'idempotencyKey', 'Cookie', owner().email]) expect(sensitive).not.toContain(key);
    expect((await get('/notifications', accounts[1]!)).body.items.filter((n: { activity: { action: string; groupId: string } }) => n.activity.action === 'REPAYMENT_RECORDED' && n.activity.groupId === id)).toHaveLength(1);
  });
  it('audits membership changes and revokes activity/notification access after leaving', async () => {
    await addExpense(expense({ participants: [{ userId: owner().id }] }));
    const ownNotifications = await get('/notifications', accounts[1]!); const membershipNotice = ownNotifications.body.items.find((n: { activity: { groupId: string; action: string } }) => n.activity.groupId === id && n.activity.action === 'EXPENSE_CREATED');
    expect((await post(`/groups/${id}/leave`, {}, accounts[1]!)).status).toBe(200);
    expect((await activity()).some(a => a.action === 'MEMBER_LEFT')).toBe(true);
    expect((await get(`/groups/${id}/activity`, accounts[1]!)).status).toBe(404);
    expect((await post(`/notifications/${membershipNotice.id}/read`, {}, accounts[1]!)).status).toBe(404);
    expect((await get('/notifications', accounts[1]!)).body.items.some((n: { id: string }) => n.id === membershipNotice.id)).toBe(false);
  });
  it('rolls back a financial write if its audit insertion fails', async () => {
    const existing = (await prisma.activity.findFirstOrThrow({ where: { groupId: id } })).eventKey; const expenseId = randomUUID();
    await expect(prisma.$transaction(async tx => {
      await tx.expense.create({ data: { id: expenseId, groupId: id, paidById: owner().id, amountMinor: 100, description: 'Must roll back', shares: { create: { userId: accounts[1]!.id, amountMinor: 100 } } } });
      await recordActivity(tx, { groupId: id, actorId: owner().id, action: 'EXPENSE_CREATED', referenceId: expenseId, referenceType: 'EXPENSE', eventKey: existing, data: {} }, 'GROUP');
    })).rejects.toThrow(); expect(await prisma.expense.findUnique({ where: { id: expenseId } })).toBeNull();
  });
});
describe('Real invitations and group authorization', () => {
  it('notifies a registered invitee but grants access only after acceptance; retries stay unique', async () => {
    const results = await Promise.all([invite(), invite()]); expect(results.map(r => r.status).sort()).toEqual([200, 201]); const invitationId = results[0]!.body.invitation.id;
    expect((await get('/invitations', accounts[2]!)).body.items.some((i: { id: string }) => i.id === invitationId)).toBe(true);
    expect((await get(`/groups/${id}/activity`, accounts[2]!)).status).toBe(404);
    const notifications = await get('/notifications', accounts[2]!); expect(notifications.body.items.filter((n: { activity: { referenceId: string } }) => n.activity.referenceId === invitationId)).toHaveLength(1);
    expect((await post(`/invitations/${invitationId}/respond`, { decision: 'ACCEPT' }, accounts[3]!)).status).toBe(404);
    const responses = await Promise.all([post(`/invitations/${invitationId}/respond`, { decision: 'ACCEPT' }, accounts[2]!), post(`/invitations/${invitationId}/respond`, { decision: 'ACCEPT' }, accounts[2]!)]);
    expect(responses.map(r => r.status)).toEqual([200, 200]); expect(await prisma.groupMember.count({ where: { groupId: id, userId: accounts[2]!.id } })).toBe(1);
    expect((await activity()).filter(a => a.action === 'INVITATION_ACCEPTED' && a.referenceId === invitationId)).toHaveLength(1);
    expect((await get(`/groups/${id}/activity`, accounts[2]!)).status).toBe(200);
    expect((await post(`/invitations/${invitationId}/respond`, { decision: 'DECLINE' }, accounts[2]!)).status).toBe(409);
  });
  it('declines without membership and restricts invitation creation to the owner', async () => {
    expect((await post(`/groups/${id}/invitations`, { email: accounts[2]!.email }, accounts[1]!)).status).toBe(403);
    expect((await post(`/groups/${id}/invitations`, { email: accounts[2]!.email }, accounts[3]!)).status).toBe(404);
    expect((await post(`/groups/${id}/invitations`, { email: accounts[1]!.email })).status).toBe(409);
    const invitation = await invite(); const path = `/invitations/${invitation.body.invitation.id}/respond`;
    expect((await post(path, { decision: 'DECLINE' }, accounts[2]!)).status).toBe(200); expect((await post(path, { decision: 'DECLINE' }, accounts[2]!)).body.replayed).toBe(true);
    expect(await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: id, userId: accounts[2]!.id } } })).toBeNull();
    expect((await post(path, { decision: 'ACCEPT' }, accounts[2]!)).status).toBe(409);
  });
  it('protects all new endpoints with session/CSRF and never exposes a foreign group', async () => {
    for (const path of ['/notifications', '/invitations', `/groups/${id}/activity`, `/groups/${id}/analytics`, `/groups/${id}/expenses`]) expect((await request(app).get(`/api${path}`)).status).toBe(401);
    for (const suffix of ['activity', 'analytics', 'expenses']) expect((await get(`/groups/${id}/${suffix}`, accounts[3]!)).status).toBe(404);
    expect((await request(app).post(`/api/groups/${id}/invitations`).set('Origin', origin).set('Cookie', owner().cookie).send({ email: accounts[2]!.email })).status).toBe(403);
    const invitation = await invite(); expect((await request(app).post(`/api/invitations/${invitation.body.invitation.id}/respond`).set('Origin', origin).set('Cookie', accounts[2]!.cookie).send({ decision: 'ACCEPT' })).status).toBe(403);
    expect((await request(app).post(`/api/notifications/${randomUUID()}/read`).set('Origin', origin).set('Cookie', owner().cookie).send({})).status).toBe(403);
  });
});
describe('Expense search, pagination and real analytics', () => {
  it('combines search/date/category/payer and paginates deterministically', async () => {
    for (let n = 0; n < 7; n++) expect((await addExpense(expense({ description: `Dinner ${n}`, date: `2026-01-${String(n + 10).padStart(2, '0')}` }))).status).toBe(201);
    await addExpense(expense({ description: 'Train ticket', category: 'TRANSPORT', date: '2026-02-01', paidById: accounts[1]!.id }));
    const first = await get(`/groups/${id}/expenses?q=DINNER&category=FOOD&from=2026-01-10&to=2026-01-16&paidById=${owner().id}&pageSize=5`);
    const second = await get(`/groups/${id}/expenses?q=dinner&category=FOOD&from=2026-01-10&to=2026-01-16&paidById=${owner().id}&pageSize=5&page=2`);
    expect(first.status).toBe(200); expect(first.body.total).toBe(7); expect(first.body.items).toHaveLength(5); expect(second.body.items).toHaveLength(2); expect(new Set([...first.body.items, ...second.body.items].map((e: { id: string }) => e.id)).size).toBe(7);
    expect((await get(`/groups/${id}/expenses?q=nonexistent`)).body.total).toBe(0);
    expect((await get(`/groups/${id}/expenses?q=${encodeURIComponent("' OR 1=1 --")}`)).body.total).toBe(0);
    expect((await get(`/groups/${id}/expenses?page=9999`)).body.items).toEqual([]);
  });
  it('rejects malformed filters and pagination and supports empty ledgers', async () => {
    for (const query of ['page=0', 'pageSize=51', 'from=2026-02-30', 'q=a&q=b', 'category=BAD', `paidById=${accounts[3]!.id}`, 'from=2026-03-01&to=2026-02-01', 'sort=unsafe']) expect((await get(`/groups/${id}/expenses?${query}`)).status).toBe(400);
    expect((await get(`/groups/${id}/expenses`)).body.items).toEqual([]);
    const analytics = await get(`/groups/${id}/analytics`); expect(analytics.status).toBe(200); expect(analytics.body.totalMinor).toBe(0); expect(analytics.body.byCategory).toEqual([]); expect(analytics.body.personal.netMinor).toBe(0);
  });
  it('computes complete spending and settlement-aware personal net independent of history filters', async () => {
    await addExpense(); await addExpense(expense({ description: 'Travel', category: 'TRANSPORT', amountMinor: 500, paidById: accounts[1]!.id, participants: [{ userId: owner().id }], date: '2026-02-01' }));
    expect((await post(`/groups/${id}/settlements`, { fromUserId: accounts[1]!.id, toUserId: owner().id, amountMinor: 200, currency: 'EUR', date: '2026-02-02' }, owner(), randomUUID())).status).toBe(201);
    const result = await get(`/groups/${id}/analytics`); expect(result.status).toBe(200);
    expect(result.body.totalMinor).toBe(1501); expect(result.body.expenseCount).toBe(2);
    expect(result.body.byCategory).toEqual([{ category: 'FOOD', amountMinor: 1001, count: 1 }, { category: 'TRANSPORT', amountMinor: 500, count: 1 }]);
    expect(result.body.monthly).toEqual([{ month: '2026-01', amountMinor: 1001, count: 1 }, { month: '2026-02', amountMinor: 500, count: 1 }]);
    expect(result.body.personal).toEqual({ paidMinor: 1001, shareMinor: 500, netMinor: 301, sentMinor: 0, receivedMinor: 200 });
    expect(result.body.members.reduce((sum: number, m: { netMinor: number }) => sum + m.netMinor, 0)).toBe(0);
    expect((await get(`/groups/${id}/expenses?category=FOOD`)).body.total).toBe(1); expect((await get(`/groups/${id}/analytics`)).body.totalMinor).toBe(1501);
    expect(JSON.stringify(result.body)).not.toMatch(/passwordHash|csrfToken|tokenHash|requestHash|idempotencyKey|@example/);
  });
});


describe('Authenticated personal analytics', () => {
  it('uses the session user, rejects impersonation parameters and reconciles all summaries', async () => {
    const initialOwner = (await get('/ledger')).body.totals.find((v: { currency: string }) => v.currency === 'EUR')?.netMinor ?? 0;
    const initialMember = (await get('/ledger', accounts[1]!)).body.totals.find((v: { currency: string }) => v.currency === 'EUR')?.netMinor ?? 0;
    await addExpense(expense({ participants: [{ userId: owner().id, amountMinor: 301 }, { userId: accounts[1]!.id, amountMinor: 700 }], splitType: 'EXACT' }));
    const a = (await get(`/groups/${id}/analytics`)).body;
    const b = (await get(`/groups/${id}/analytics`, accounts[1]!)).body;
    expect(a.personal).toMatchObject({ paidMinor: 1001, shareMinor: 301, netMinor: 700 });
    expect(b.personal).toMatchObject({ paidMinor: 0, shareMinor: 700, netMinor: -700 });
    expect(a.totalMinor).toBe(b.totalMinor); expect(a.personal).not.toEqual(b.personal);
    expect(a.members.reduce((sum: number, m: { netMinor: number }) => sum + m.netMinor, 0)).toBe(0);
    expect(a.byCategory.reduce((sum: number, c: { amountMinor: number }) => sum + c.amountMinor, 0)).toBe(a.totalMinor);
    expect(a.monthly.reduce((sum: number, m: { amountMinor: number }) => sum + m.amountMinor, 0)).toBe(a.totalMinor);
    expect((await get(`/groups/${id}/analytics?userId=${accounts[1]!.id}`)).status).toBe(400);
    const overview = (await get('/ledger')).body;
    expect(overview.totals.find((v: { currency: string }) => v.currency === 'EUR').netMinor).toBe(initialOwner + 700);
    const other = (await get('/ledger', accounts[1]!)).body;
    expect(other.totals.find((v: { currency: string }) => v.currency === 'EUR').netMinor).toBe(initialMember - 700);
  });
});
