import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../src/database.js';
import { createApp } from '../src/app.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/splitmate_test') throw new Error('Ledger tests require the dedicated splitmate_test database.');
const prisma = createDatabaseClient(url);
const origin = 'http://localhost:5173';
let app = createApp(async () => { await prisma.$queryRaw`SELECT 1`; }, { prisma, webOrigin: origin, secureCookies: false });
type Account = { id: string; email: string; csrf: string; cookie: string };
const accounts: Account[] = [];
const groupIds: string[] = [];
let group: { id: string; currency: string };
const actor = () => accounts[0]!;
async function makeGroup(currency = 'EUR') {
  const response = await request(app).post('/api/groups').set('Origin', origin).set('Cookie', actor().cookie).set('X-CSRF-Token', actor().csrf).send({ name: 'Ledger integration', currency });
  expect(response.status).toBe(201); groupIds.push(response.body.group.id);
  for (const account of accounts.slice(1, 3)) {
    const invite = await request(app).post(`/api/groups/${response.body.group.id}/invitations`).set('Origin', origin).set('Cookie', actor().cookie).set('X-CSRF-Token', actor().csrf).send({ email: account.email });
    expect(invite.status).toBe(201);
    expect((await request(app).post(`/api/invitations/${invite.body.invitation.id}/respond`).set('Origin', origin).set('Cookie', account.cookie).set('X-CSRF-Token', account.csrf).send({ decision: 'ACCEPT' })).status).toBe(200);
  }
  return response.body.group as { id: string; currency: string };
}
beforeAll(async () => {
  for (let index = 0; index < 4; index++) {
    const email = `ledger-${randomUUID()}@example.test`;
    const response = await request(app).post('/api/auth/register').set('Origin', origin).send({ email, displayName: `Ledger user ${index}`, password: 'a unique ledger integration passphrase' });
    expect(response.status).toBe(201);
    accounts.push({ id: response.body.user.id, email, csrf: response.body.csrfToken, cookie: (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]! });
  }
});
beforeEach(async () => {
  app = createApp(async () => { await prisma.$queryRaw`SELECT 1`; }, { prisma, webOrigin: origin, secureCookies: false }); group = await makeGroup(); });
afterAll(async () => {
  await prisma.$transaction([
    prisma.settlementReversal.deleteMany({ where: { settlement: { groupId: { in: groupIds } } } }),
    prisma.settlement.deleteMany({ where: { groupId: { in: groupIds } } }),
    prisma.expenseShare.deleteMany({ where: { groupId: { in: groupIds } } }),
    prisma.expense.deleteMany({ where: { groupId: { in: groupIds } } }),
    prisma.groupMember.deleteMany({ where: { groupId: { in: groupIds } } }),
    prisma.group.deleteMany({ where: { id: { in: groupIds } } }),
    prisma.user.deleteMany({ where: { id: { in: accounts.map(account => account.id) } } }),
  ]);
  await prisma.$disconnect();
});
function payload(overrides: Record<string, unknown> = {}) {
  return { description: 'Shared dinner', amountMinor: 1001, currency: 'EUR', paidById: actor().id, participants: accounts.slice(0, 3).map(account => ({ userId: account.id })), date: '2026-10-14', category: 'FOOD', splitType: 'EQUAL', ...overrides };
}
function post(body = payload(), key: string | null = randomUUID(), account = actor(), id = group.id) {
  const call = request(app).post(`/api/groups/${id}/expenses`).set('Origin', origin).set('Cookie', account.cookie).set('X-CSRF-Token', account.csrf);
  if (key) call.set('Idempotency-Key', key);
  return call.send(body);
}
function ledger(account = actor(), id = group.id) { return request(app).get(`/api/groups/${id}/ledger`).set('Cookie', account.cookie); }
function edit(id: string, overrides: Record<string, unknown> = {}, account = actor(), expectedVersion = 1) {
  return request(app).patch(`/api/groups/${group.id}/expenses/${id}`).set('Origin', origin).set('Cookie', account.cookie).set('X-CSRF-Token', account.csrf).send({ ...payload(overrides), expectedVersion });
}
describe('Expense corrections', () => {
  it('corrects the payer, keeps the expense ID and recalculates zero-sum balances', async () => {
    const original = (await post()).body.expense;
    const result = await edit(original.id, { paidById: accounts[1]!.id });
    expect(result.status).toBe(200); expect(result.body.expense.id).toBe(original.id);
    expect(result.body.expense.version).toBe(2); expect(result.body.expense.editedAt).toBeTruthy();
    const updated = (await ledger()).body;
    expect(updated.balances.find((b: { userId: string }) => b.userId === actor().id).paidMinor).toBe(0);
    expect(updated.balances.find((b: { userId: string }) => b.userId === accounts[1]!.id).paidMinor).toBe(1001);
    expect(updated.balances.reduce((sum: number, b: { netMinor: number }) => sum + b.netMinor, 0)).toBe(0);
    expect(await prisma.expense.count({ where: { groupId: group.id } })).toBe(1);
  });
  it('replaces participants and exact/percentage shares atomically', async () => {
    const original = (await post()).body.expense;
    const exact = await edit(original.id, { amountMinor: 700, splitType: 'EXACT', participants: [{ userId: actor().id, amountMinor: 700 }] });
    expect(exact.status).toBe(200); expect(exact.body.expense.shares).toHaveLength(1);
    const percentage = await edit(original.id, { amountMinor: 101, splitType: 'PERCENTAGE', participants: accounts.slice(0, 2).map(account => ({ userId: account.id, percentageBps: 5000 })) }, actor(), 2);
    expect(percentage.status).toBe(200);
    expect(percentage.body.expense.shares.map((s: { amountMinor: number }) => s.amountMinor)).toEqual([51, 50]);
  });
  it('allows the recorder and owner, but rejects another member and outsider', async () => {
    const original = (await post(payload(), randomUUID(), accounts[1]!)).body.expense;
    expect((await edit(original.id, { description: 'Recorder correction' }, accounts[1]!)).status).toBe(200);
    expect((await edit(original.id, {}, accounts[2]!, 2)).status).toBe(403);
    expect((await edit(original.id, {}, accounts[3]!, 2)).status).toBe(404);
    expect((await edit(original.id, { description: 'Owner correction' }, actor(), 2)).status).toBe(200);
    const hidden = await ledger(accounts[2]!); expect(hidden.body.expenses[0].canEdit).toBe(false);
    expect((await ledger()).body.expenses[0].canEdit).toBe(true);
  });
  it('requires authentication, CSRF and the expense to belong to the addressed group', async () => {
    const original = (await post()).body.expense;
    const path = `/api/groups/${group.id}/expenses/${original.id}`;
    expect((await request(app).patch(path).set('Origin', origin).send({ ...payload(), expectedVersion: 1 })).status).toBe(401);
    expect((await request(app).patch(path).set('Origin', origin).set('Cookie', actor().cookie).send({ ...payload(), expectedVersion: 1 })).status).toBe(403);
    expect((await edit(randomUUID())).status).toBe(404);
    const other = await makeGroup();
    expect((await request(app).patch(`/api/groups/${other.id}/expenses/${original.id}`).set('Origin', origin).set('Cookie', actor().cookie).set('X-CSRF-Token', actor().csrf).send({ ...payload(), expectedVersion: 1 })).status).toBe(404);
  });
  it('rejects invalid corrections without changing existing expense or shares', async () => {
    const original = (await post()).body.expense;
    for (const input of [{ paidById: accounts[3]!.id }, { currency: 'GBP' }, { amountMinor: 0 }, { splitType: 'EXACT', participants: [{ userId: actor().id, amountMinor: 1 }] }, { participants: [{ userId: accounts[3]!.id }] }]) expect((await edit(original.id, input)).status).toBe(400);
    expect((await ledger()).body.expenses[0]).toEqual({ ...original, canEdit: true });
  });
  it('prevents stale and concurrent edits from overwriting each other', async () => {
    const original = (await post()).body.expense;
    const results = await Promise.all([edit(original.id, { description: 'First correction' }), edit(original.id, { description: 'Second correction' })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await edit(original.id)).status).toBe(409);
    expect((await ledger()).body.expenses[0].version).toBe(2);
  });
  it('rolls back expense metadata and replaced shares if the commit-time total check fails', async () => {
    const original = (await post()).body.expense;
    await expect(prisma.$transaction(async tx => {
      await tx.expense.update({ where: { id: original.id }, data: { paidById: accounts[1]!.id, version: { increment: 1 } } });
      await tx.expenseShare.deleteMany({ where: { expenseId: original.id } });
      await tx.expenseShare.create({ data: { expenseId: original.id, groupId: group.id, userId: actor().id, amountMinor: 1 } });
    })).rejects.toThrow();
    expect((await ledger()).body.expenses[0]).toEqual({ ...original, canEdit: true });
  });
  it('keeps creation retries idempotent after a correction without reverting the bill', async () => {
    const key = randomUUID(); const original = (await post(payload(), key)).body.expense;
    expect((await edit(original.id, { paidById: accounts[1]!.id })).status).toBe(200);
    const replay = await post(payload(), key);
    expect(replay.status).toBe(200); expect(replay.body.expense.paidById).toBe(accounts[1]!.id);
    expect(replay.body.expense.version).toBe(2);
  });
});
describe('Real expense creation, integrity and authorization', () => {
  it('writes expense and balanced shares atomically with metadata and creator', async () => {
    const response = await post(); expect(response.status).toBe(201);
    expect(response.body.replayed).toBe(false);
    const expense = response.body.expense;
    expect(expense.category).toBe('FOOD'); expect(expense.createdById).toBe(actor().id); expect(expense.occurredAt).toBe('2026-10-14T00:00:00.000Z');
    expect(expense.shares.map((share: { amountMinor: number }) => share.amountMinor)).toEqual([334, 334, 333]);
    expect(expense).not.toHaveProperty('requestHash'); expect(expense).not.toHaveProperty('idempotencyKey');
    expect(await prisma.expense.count({ where: { groupId: group.id } })).toBe(1);
    expect(await prisma.expenseShare.count({ where: { groupId: group.id } })).toBe(3);
  });
  it('allows any member to create, a different payer, and a payer excluded from shares', async () => {
    const response = await post(payload({ paidById: accounts[2]!.id, participants: [{ userId: actor().id }] }), randomUUID(), accounts[1]!);
    expect(response.status).toBe(201); expect(response.body.expense.createdById).toBe(accounts[1]!.id);
    const balances = (await ledger()).body.balances as { userId: string; netMinor: number }[];
    expect(balances.find(balance => balance.userId === accounts[2]!.id)!.netMinor).toBe(1001);
    expect(balances.find(balance => balance.userId === actor().id)!.netMinor).toBe(-1001);
  });
  it('accepts exact and percentage splits whose persisted shares total the amount', async () => {
    const exact = await post(payload({ splitType: 'EXACT', participants: accounts.slice(0, 3).map((account, index) => ({ userId: account.id, amountMinor: [500, 501, 0][index] })) }));
    expect(exact.status).toBe(201);
    const percent = await post(payload({ splitType: 'PERCENTAGE', participants: accounts.slice(0, 3).map((account, index) => ({ userId: account.id, percentageBps: [3333, 3333, 3334][index] })) }));
    expect(percent.status).toBe(201);
    for (const result of [exact, percent]) expect(result.body.expense.shares.reduce((sum: number, share: { amountMinor: number }) => sum + share.amountMinor, 0)).toBe(1001);
  });
  it('rejects anonymous/nonmember writes and reads, with no leaked expenses', async () => {
    expect((await request(app).post(`/api/groups/${group.id}/expenses`).set('Origin', origin).send(payload())).status).toBe(401);
    expect((await request(app).get(`/api/groups/${group.id}/ledger`)).status).toBe(401);
    expect((await post(payload(), randomUUID(), accounts[3]!)).status).toBe(404);
    expect((await ledger(accounts[3]!)).status).toBe(404);
    const overview = await request(app).get('/api/ledger').set('Cookie', accounts[3]!.cookie);
    expect(overview.body).toEqual({ totals: [], expenses: [] });
    expect(await prisma.expense.count({ where: { groupId: group.id } })).toBe(0);
  });
  it('rejects nonmember payers and participants without partial writes', async () => {
    expect((await post(payload({ paidById: accounts[3]!.id }))).status).toBe(400);
    expect((await post(payload({ participants: [{ userId: accounts[3]!.id }] }))).status).toBe(400);
    expect(await prisma.expense.count({ where: { groupId: group.id } })).toBe(0);
    expect(await prisma.expenseShare.count({ where: { groupId: group.id } })).toBe(0);
  });
  it.each([
    { amountMinor: 0 }, { amountMinor: 12.34 }, { amountMinor: '1001' }, { amountMinor: 2147483648 },
    { currency: 'GBP' }, { category: 'INVALID' }, { date: '2026-02-30' }, { participants: [] },
    { splitType: 'EXACT', participants: [] }, { splitType: 'PERCENTAGE', participants: [] },
  ])('rejects invalid expense input %#', async override => {
    expect((await post(payload(override))).status).toBe(400);
    expect(await prisma.expense.count({ where: { groupId: group.id } })).toBe(0);
  });
  it('requires idempotency, CSRF and correct split totals', async () => {
    expect((await post(payload(), null)).status).toBe(400);
    expect((await request(app).post(`/api/groups/${group.id}/expenses`).set('Cookie', actor().cookie).set('Origin', origin).set('Idempotency-Key', randomUUID()).send(payload())).status).toBe(403);
    for (const mode of ['EXACT', 'PERCENTAGE']) expect((await post(payload({ splitType: mode, participants: [{ userId: actor().id, ...(mode === 'EXACT' ? { amountMinor: 1000 } : { percentageBps: 9999 }) }] }))).status).toBe(400);
  });
  it('replays the same normalized request and rejects a key with different content', async () => {
    const key = randomUUID(); const body = payload();
    const first = await post(body, key); const again = await post({ ...body, participants: [...body.participants].reverse() }, key);
    expect(first.status).toBe(201); expect(again.status).toBe(200); expect(again.body.replayed).toBe(true); expect(again.body.expense.id).toBe(first.body.expense.id);
    expect((await post({ ...body, description: 'A different dinner' }, key)).status).toBe(409);
    expect(await prisma.expense.count({ where: { groupId: group.id } })).toBe(1);
  });
  it('deduplicates simultaneous submissions and survives subsequent retries', async () => {
    const key = randomUUID(); const body = payload();
    const responses = await Promise.all([post(body, key), post(body, key)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    expect(responses[0]!.body.expense.id).toBe(responses[1]!.body.expense.id);
    expect((await post(body, key)).status).toBe(200);
    expect(await prisma.expense.count({ where: { groupId: group.id } })).toBe(1);
  });
  it('scopes keys to creator and prevents reusing one across groups with different content', async () => {
    const key = randomUUID(); expect((await post(payload(), key)).status).toBe(201);
    expect((await post(payload(), key, accounts[1]!)).status).toBe(201);
    const other = await makeGroup(); expect((await post(payload(), key, actor(), other.id)).status).toBe(409);
  });
  it('rolls back an expense and its shares when the deferred database check fails', async () => {
    const id = randomUUID(); let inserted = false;
    await expect(prisma.$transaction(async tx => {
      await tx.expense.create({ data: { id, groupId: group.id, paidById: actor().id, description: 'Must roll back', amountMinor: 1001, shares: { create: { userId: actor().id, amountMinor: 1000 } } } });
      inserted = true;
    })).rejects.toThrow();
    expect(inserted).toBe(true); expect(await prisma.expense.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.expenseShare.count({ where: { expenseId: id } })).toBe(0);
  });
  it('rejects deleting or changing one share out of balance and retains the committed values', async () => {
    const response = await post(); const expense = response.body.expense;
    await expect(prisma.expenseShare.update({ where: { expenseId_userId: { expenseId: expense.id, userId: expense.shares[0].userId } }, data: { amountMinor: 1 } })).rejects.toThrow();
    await expect(prisma.expenseShare.delete({ where: { expenseId_userId: { expenseId: expense.id, userId: expense.shares[0].userId } } })).rejects.toThrow();
    expect((await ledger()).body.expenses[0].shares.reduce((sum: number, share: { amountMinor: number }) => sum + share.amountMinor, 0)).toBe(1001);
  });
  it('calculates zero-sum balances, direct reciprocal debts and currency-separated summaries', async () => {
    expect((await post(payload({ amountMinor: 1200 }))).status).toBe(201);
    expect((await post(payload({ amountMinor: 200, paidById: accounts[1]!.id, participants: [{ userId: actor().id }, { userId: accounts[1]!.id }] }))).status).toBe(201);
    const result = await ledger(); expect(result.status).toBe(200);
    const balances = result.body.balances as { userId: string; netMinor: number }[];
    expect(balances.find(balance => balance.userId === actor().id)!.netMinor).toBe(700);
    expect(balances.reduce((sum, balance) => sum + balance.netMinor, 0)).toBe(0);
    expect(result.body.debts).toContainEqual({ fromUserId: accounts[1]!.id, toUserId: actor().id, amountMinor: 300 });
    expect(result.body.debts).not.toContainEqual({ fromUserId: actor().id, toUserId: accounts[1]!.id, amountMinor: 100 });
    const sterling = await makeGroup('GBP');
    expect((await post(payload({ currency: 'GBP', amountMinor: 900 }), randomUUID(), actor(), sterling.id)).status).toBe(201);
    const overview = await request(app).get('/api/ledger').set('Cookie', actor().cookie);
    // Earlier tests have EUR history; the GBP bucket must still be independent and exact.
    expect(overview.body.totals).toContainEqual({ currency: 'GBP', owedToMeMinor: 600, iOweMinor: 0, netMinor: 600 });
    expect(overview.body.totals.filter((total: { currency: string }) => total.currency === 'EUR')).toHaveLength(1);
  });
  it('blocks leaving after recording a ledger obligation', async () => {
    expect((await post()).status).toBe(201);
    const response = await request(app).post(`/api/groups/${group.id}/leave`).set('Origin', origin).set('Cookie', accounts[1]!.cookie).set('X-CSRF-Token', accounts[1]!.csrf).send({});
    expect(response.status).toBe(409);
    expect((await ledger(accounts[1]!)).status).toBe(200);
  });
});

function repay(overrides: Record<string, unknown> = {}, key: string | null = randomUUID(), account = actor(), id = group.id) {
  const call = request(app).post(`/api/groups/${id}/settlements`).set('Origin', origin).set('Cookie', account.cookie).set('X-CSRF-Token', account.csrf);
  if (key) call.set('Idempotency-Key', key);
  return call.send({ fromUserId: accounts[1]!.id, toUserId: actor().id, amountMinor: 1001, currency: 'EUR', date: '2026-10-15', mode: 'DIRECT', ...overrides });
}
function reverse(id: string, reason = 'Recorded by mistake', account = actor()) {
  return request(app).post(`/api/groups/${group.id}/settlements/${id}/reverse`).set('Origin', origin).set('Cookie', account.cookie).set('X-CSRF-Token', account.csrf).send({ reason });
}
describe('Recorded repayments, audit history and financial invariants', () => {
  beforeEach(async () => { expect((await post(payload({ participants: [{ userId: accounts[1]!.id }] }))).status).toBe(201); });
  it('records partial then full repayment and refreshes group/dashboard balances', async () => {
    const before = (await ledger()).body.expenses;
    const partial = await repay({ amountMinor: 400 }); expect(partial.status).toBe(201);
    expect(partial.body.settlement.createdById).toBe(actor().id);
    expect(partial.body.settlement).not.toHaveProperty('requestHash'); expect(partial.body.settlement).not.toHaveProperty('idempotencyKey');
    const after = (await ledger()).body;
    expect(after.balances.find((b: { userId: string }) => b.userId === actor().id).netMinor).toBe(601);
    expect(after.debts).toEqual([{ fromUserId: accounts[1]!.id, toUserId: actor().id, amountMinor: 601 }]);
    expect(after.expenses).toEqual(before);
    expect((await repay({ amountMinor: 601 })).status).toBe(201);
    const complete = (await ledger()).body;
    expect(complete.balances.every((b: { netMinor: number }) => b.netMinor === 0)).toBe(true);
    expect(complete.debts).toEqual([]); expect(complete.simplifiedDebts).toEqual([]); expect(complete.settlements).toHaveLength(2);
    const overview = await request(app).get('/api/ledger').set('Cookie', actor().cookie); expect(overview.status).toBe(200);
  });
  it('reverses once with immutable audit information and restores balances', async () => {
    const paid = await repay(); const id = paid.body.settlement.id;
    expect((await reverse(id)).status).toBe(200);
    const history = (await ledger()).body;
    expect(history.settlements).toHaveLength(1); expect(history.settlements[0].amountMinor).toBe(1001);
    expect(history.settlements[0].reversal.reason).toBe('Recorded by mistake');
    expect(history.settlements[0].reversal.createdById).toBe(actor().id);
    expect(history.settlements[0].canReverse).toBe(false);
    expect(history.debts[0].amountMinor).toBe(1001);
    expect((await reverse(id)).body.replayed).toBe(true);
    expect((await reverse(id, 'Changed reason')).status).toBe(409);
    expect(await prisma.settlementReversal.count({ where: { settlementId: id } })).toBe(1);
    await expect(prisma.settlement.update({ where: { id }, data: { amountMinor: 1 } })).rejects.toThrow();
    await expect(prisma.settlementReversal.update({ where: { settlementId: id }, data: { reason: 'Overwrite audit' } })).rejects.toThrow();
  });
  it('permits payer, receiver or owner but not an unrelated member to record', async () => {
    expect((await repay({ amountMinor: 1 }, randomUUID(), accounts[2]!)).status).toBe(403);
    expect((await repay({ amountMinor: 1 }, randomUUID(), accounts[1]!)).status).toBe(201);
    // Make the non-owner member a receiver as well.
    expect((await post(payload({ paidById: accounts[2]!.id, amountMinor: 500, participants: [{ userId: accounts[1]!.id }] }))).status).toBe(201);
    expect((await repay({ toUserId: accounts[2]!.id, amountMinor: 500 }, randomUUID(), accounts[2]!)).status).toBe(201);
    expect((await repay({ amountMinor: 1 })).status).toBe(201);
  });
  it('permits only recorder/owner reversal and scopes IDs to the group', async () => {
    const paid = await repay({}, randomUUID(), accounts[1]!); const id = paid.body.settlement.id;
    expect((await reverse(id, 'Not mine', accounts[2]!)).status).toBe(403);
    expect((await reverse(id, 'Outside', accounts[3]!)).status).toBe(404);
    const other = await makeGroup();
    expect((await request(app).post(`/api/groups/${other.id}/settlements/${id}/reverse`).set('Origin', origin).set('Cookie', actor().cookie).set('X-CSRF-Token', actor().csrf).send({ reason: 'Wrong group' })).status).toBe(404);
    expect((await reverse(id, 'Recorder correction', accounts[1]!)).status).toBe(200);
    const next = await repay({}, randomUUID(), accounts[1]!);
    expect((await reverse(next.body.settlement.id, 'Owner correction')).status).toBe(200);
  });
  it('requires authentication, membership, Origin, CSRF and creation key', async () => {
    const path = `/api/groups/${group.id}/settlements`;
    expect((await request(app).post(path).set('Origin', origin).send({})).status).toBe(401);
    expect((await repay({}, randomUUID(), accounts[3]!)).status).toBe(404);
    expect((await repay({}, null)).status).toBe(400);
    expect((await request(app).post(path).set('Origin', origin).set('Cookie', actor().cookie).send({})).status).toBe(403);
    expect((await request(app).post(path).set('Origin', 'https://outside.test').set('Cookie', actor().cookie).set('X-CSRF-Token', actor().csrf).send({})).status).toBe(403);
    const paid = await repay();
    expect((await request(app).post(`${path}/${paid.body.settlement.id}/reverse`).set('Origin', origin).send({ reason: 'No auth' })).status).toBe(401);
    expect((await request(app).post(`${path}/${paid.body.settlement.id}/reverse`).set('Origin', origin).set('Cookie', actor().cookie).send({ reason: 'No csrf' })).status).toBe(403);
  });
  it.each([{ amountMinor: 0 }, { amountMinor: -1 }, { amountMinor: 1.5 }, { amountMinor: '10' }, { amountMinor: 2147483648 }, { currency: 'GBP' }, { date: '2026-02-30' }, { mode: 'INVALID' }, { mode: ['DIRECT'] }])('rejects malformed repayment %# without writes', async input => {
    expect((await repay(input)).status).toBe(400);
    expect(await prisma.settlement.count({ where: { groupId: group.id } })).toBe(0);
  });
  it('rejects self-payment, outsiders, overpayment and wrong-direction repayments', async () => {
    expect((await repay({ toUserId: accounts[1]!.id })).status).toBe(400);
    expect((await repay({ fromUserId: accounts[3]!.id })).status).toBe(400);
    expect((await repay({ toUserId: accounts[3]!.id })).status).toBe(400);
    expect((await repay({ amountMinor: 1002 })).status).toBe(409);
    expect((await repay({ fromUserId: actor().id, toUserId: accounts[1]!.id })).status).toBe(409);
    expect((await repay({ fromUserId: accounts[2]!.id, mode: 'SIMPLIFIED', amountMinor: 1 })).status).toBe(409);
  });
  it('deduplicates concurrent retries and rejects conflicting reuse across content/groups', async () => {
    const key = randomUUID(); const results = await Promise.all([repay({}, key), repay({}, key)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 201]);
    expect(results[0]!.body.settlement.id).toBe(results[1]!.body.settlement.id);
    expect((await repay({ amountMinor: 1 }, key)).status).toBe(409);
    const other = await makeGroup(); expect((await repay({}, key, actor(), other.id)).status).toBe(409);
    expect(await prisma.settlement.count({ where: { groupId: group.id } })).toBe(1);
  });
  it('does not reapply an idempotent request after its repayment was reversed', async () => {
    const key = randomUUID(), paid = await repay({}, key); await reverse(paid.body.settlement.id);
    const replay = await repay({}, key); expect(replay.status).toBe(200); expect(replay.body.settlement.reversal).toBeTruthy();
    expect((await ledger()).body.debts[0].amountMinor).toBe(1001);
  });
  it('prevents concurrent distinct requests from over-settling', async () => {
    const results = await Promise.all([repay({ amountMinor: 700 }), repay({ amountMinor: 700 })]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    const current = (await ledger()).body; expect(current.debts[0].amountMinor).toBe(301);
    expect(current.balances.reduce((sum: number, b: { netMinor: number }) => sum + b.netMinor, 0)).toBe(0);
  });
  it('deduplicates concurrent reversals and rejects an empty audit reason', async () => {
    const paid = await repay(), id = paid.body.settlement.id;
    expect((await reverse(id, ' ')).status).toBe(400);
    const results = await Promise.all([reverse(id), reverse(id)]); expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(await prisma.settlementReversal.count({ where: { settlementId: id } })).toBe(1);
  });
  it('rolls back repayment insertion if its audit write fails inside a transaction', async () => {
    const id = randomUUID();
    await expect(prisma.$transaction(async tx => {
      await tx.settlement.create({ data: { id, groupId: group.id, fromUserId: accounts[1]!.id, toUserId: actor().id, amountMinor: 1001 } });
      await tx.settlementReversal.create({ data: { settlementId: id, createdById: actor().id, reason: '' } });
    })).rejects.toThrow();
    expect(await prisma.settlement.findUnique({ where: { id } })).toBeNull();
    expect((await ledger()).body.debts[0].amountMinor).toBe(1001);
  });
  it('supports three-person simplified repayment without rewriting shares and conserves nets', async () => {
    // B owes A 1001; C owes B 1001. B has zero net and must be left out of the plan.
    expect((await post(payload({ paidById: accounts[1]!.id, participants: [{ userId: accounts[2]!.id }] }))).status).toBe(201);
    const before = (await ledger()).body;
    expect(before.simplifiedDebts).toEqual([{ fromUserId: accounts[2]!.id, toUserId: actor().id, amountMinor: 1001 }]);
    expect((await repay({ fromUserId: accounts[2]!.id })).status).toBe(409);
    const paid = await repay({ fromUserId: accounts[2]!.id, mode: 'SIMPLIFIED' }); expect(paid.status).toBe(201);
    const after = (await ledger()).body; expect(after.expenses).toEqual(before.expenses);
    expect(after.balances.every((b: { netMinor: number }) => b.netMinor === 0)).toBe(true); expect(after.simplifiedDebts).toEqual([]);
    expect((await repay({ fromUserId: accounts[2]!.id, mode: 'SIMPLIFIED', amountMinor: 1 })).status).toBe(409);
    expect((await reverse(paid.body.settlement.id)).status).toBe(200);
    expect((await ledger()).body.simplifiedDebts).toEqual(before.simplifiedDebts);
  });
});
