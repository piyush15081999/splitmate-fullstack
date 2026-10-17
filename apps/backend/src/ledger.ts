import { createHash } from 'node:crypto';
import { Router } from 'express';
import { Prisma, type PrismaClient } from './generated/prisma/client.js';
import { HttpError } from './errors.js';
import { groupId } from './validation.js';
import { parseExpense, safeTotal } from './ledger-math.js';
import { financialLedger } from './debts.js';
import { createSettlementRoutes, settlementSelect } from './settlements.js';
import { lockLedger } from './ledger-lock.js';
import { recordActivity, expenseSnapshot } from './activity.js';

const userSelect = { id: true, displayName: true } as const;
export const expenseSelect = {
  id: true, groupId: true, description: true, amountMinor: true, paidById: true,
  occurredAt: true, createdAt: true, category: true, splitType: true, createdById: true, version: true, editedAt: true,
  paidBy: { select: { user: { select: userSelect } } },
  shares: { orderBy: { userId: 'asc' }, select: { userId: true, amountMinor: true, percentageBps: true, member: { select: { user: { select: userSelect } } } } },
} satisfies Prisma.ExpenseSelect;
type Transaction = Prisma.TransactionClient;
export async function groupLedger(tx: Transaction, id: string, actorId: string) {
  const group = await tx.group.findFirst({ where: { id, members: { some: { userId: actorId } } }, select: { id: true, name: true, currency: true, members: { orderBy: { userId: 'asc' }, select: { userId: true, user: { select: userSelect } } } } });
  if (!group) throw new HttpError(404, 'Group not found.');
  const membership = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: id, userId: actorId } }, select: { role: true } });
  const records = await tx.expense.findMany({ where: { groupId: id }, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }], select: expenseSelect });
  const expenses = records.map(expense => ({ ...expense, canEdit: expense.createdById === actorId || membership?.role === 'OWNER' }));
  const settlements = (await tx.settlement.findMany({ where: { groupId: id }, orderBy: [{ settledAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }], select: settlementSelect })).map(s => ({ ...s, canReverse: !s.reversal && (s.createdById === actorId || membership?.role === 'OWNER') }));
  return { group, expenses, settlements, ...financialLedger(group.members.map(member => member.userId), expenses, settlements) };
}
export async function createExpense(prisma: PrismaClient, actorId: string, id: string, key: string, raw: unknown) {
  const input = parseExpense(raw);
  const requestHash = createHash('sha256').update(JSON.stringify({ groupId: id, ...input })).digest('hex');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        await lockLedger(tx, id);
        const group = await tx.group.findFirst({ where: { id, members: { some: { userId: actorId } } }, select: { currency: true, members: { select: { userId: true } } } });
        if (!group) throw new HttpError(404, 'Group not found.');
        if (input.currency !== group.currency) throw new HttpError(400, 'Expense currency must match the group currency.');
        const ids = new Set(group.members.map(member => member.userId));
        if (!ids.has(input.paidById) || input.shares.some(share => !ids.has(share.userId))) throw new HttpError(400, 'The payer and every participant must belong to this group.');
        const previous = await tx.expense.findFirst({ where: { createdById: actorId, idempotencyKey: key }, select: { requestHash: true, ...expenseSelect } });
        if (previous) {
          if (previous.requestHash !== requestHash) throw new HttpError(409, 'This idempotency key was already used for a different expense.');
          const { requestHash: _hash, ...expense } = previous;
          return { expense, replayed: true };
        }
        const expense = await tx.expense.create({ data: {
          groupId: id, description: input.description, amountMinor: input.amountMinor, paidById: input.paidById,
          occurredAt: new Date(`${input.date}T00:00:00.000Z`), category: input.category, splitType: input.splitType,
          createdById: actorId, idempotencyKey: key, requestHash,
          shares: { create: input.shares },
        }, select: expenseSelect });
        await recordActivity(tx, { groupId: id, actorId, action: 'EXPENSE_CREATED', referenceType: 'EXPENSE', referenceId: expense.id, eventKey: `EXPENSE_CREATED:${expense.id}`, data: { after: expenseSnapshot(expense) } }, 'GROUP');
        return { expense, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
        if (attempt < 2) continue;
        throw new HttpError(409, 'The ledger changed. Retry with the same idempotency key.');
      }
      throw error;
    }
  }
  throw new HttpError(409, 'Retry with the same idempotency key.');
}
export function createLedgerRoutes(prisma: PrismaClient) {
  const router = Router();
  router.use(createSettlementRoutes(prisma, groupLedger));
  router.patch('/groups/:id/expenses/:expenseId', async (req, res) => {
    const id = groupId(req.params.id).toLowerCase();
    const expenseId = groupId(req.params.expenseId).toLowerCase();
    const actorId = res.locals.auth.user.id as string;
    const { expectedVersion, ...raw } = req.body ?? {};
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new HttpError(400, 'A valid expectedVersion is required.');
    const input = parseExpense(raw);
    const expense = await prisma.$transaction(async tx => {
      await lockLedger(tx, id);
      const membership = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: id, userId: actorId } }, select: { role: true, group: { select: { currency: true, members: { select: { userId: true } } } } } });
      if (!membership) throw new HttpError(404, 'Group not found.');
      const current = await tx.expense.findFirst({ where: { id: expenseId, groupId: id }, select: expenseSelect });
      if (!current) throw new HttpError(404, 'Expense not found.');
      if (current.createdById !== actorId && membership.role !== 'OWNER') throw new HttpError(403, 'Only the person who recorded this expense or the group owner may edit it.');
      if (current.version !== expectedVersion) throw new HttpError(409, 'This expense changed. Close this form, refresh the ledger and reopen it before editing.');
      if (input.currency !== membership.group.currency) throw new HttpError(400, 'Expense currency must match the group currency.');
      const ids = new Set(membership.group.members.map(member => member.userId));
      if (!ids.has(input.paidById) || input.shares.some(share => !ids.has(share.userId))) throw new HttpError(400, 'The payer and every participant must belong to this group.');
      const changed = await tx.expense.updateMany({ where: { id: expenseId, groupId: id, version: expectedVersion }, data: { description: input.description, amountMinor: input.amountMinor, paidById: input.paidById, occurredAt: new Date(`${input.date}T00:00:00.000Z`), category: input.category, splitType: input.splitType, version: { increment: 1 }, editedAt: new Date() } });
      if (changed.count !== 1) throw new HttpError(409, 'This expense changed. Refresh the ledger before editing.');
      await tx.expenseShare.deleteMany({ where: { expenseId } });
      await tx.expenseShare.createMany({ data: input.shares.map(share => ({ ...share, expenseId, groupId: id })) });
      const updated = await tx.expense.findUniqueOrThrow({ where: { id: expenseId }, select: expenseSelect });
      await recordActivity(tx, { groupId: id, actorId, action: 'EXPENSE_UPDATED', referenceId: expenseId, referenceType: 'EXPENSE', eventKey: `EXPENSE_UPDATED:${expenseId}:${updated.version}`, data: { before: expenseSnapshot(current), after: expenseSnapshot(updated) } });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ expense });
  });
  router.post('/groups/:id/expenses', async (req, res) => {
    const id = groupId(req.params.id).toLowerCase();
    const header = req.get('Idempotency-Key');
    if (!header) throw new HttpError(400, 'An Idempotency-Key UUID header is required.');
    const key = groupId(header).toLowerCase();
    const result = await createExpense(prisma, res.locals.auth.user.id as string, id, key, req.body);
    res.status(result.replayed ? 200 : 201).json(result);
  });
  router.get('/groups/:id/ledger', async (req, res) => {
    const ledger = await prisma.$transaction(tx => groupLedger(tx, groupId(req.params.id).toLowerCase(), res.locals.auth.user.id as string), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    res.json(ledger);
  });
  router.get('/ledger', async (_req, res) => {
    const actorId = res.locals.auth.user.id as string;
    const result = await prisma.$transaction(async tx => {
      const memberships = await tx.groupMember.findMany({ where: { userId: actorId }, select: { groupId: true } });
      const totals = new Map<string, { owedToMe: bigint; iOwe: bigint; net: bigint }>();
      const recent: (Prisma.ExpenseGetPayload<{ select: typeof expenseSelect }> & { currency: string; groupName: string })[] = [];
      for (const membership of memberships) {
        const ledger = await groupLedger(tx, membership.groupId, actorId);
        const total = totals.get(ledger.group.currency) ?? { owedToMe: 0n, iOwe: 0n, net: 0n };
        for (const debt of ledger.debts) {
          if (debt.toUserId === actorId) total.owedToMe += BigInt(debt.amountMinor);
          if (debt.fromUserId === actorId) total.iOwe += BigInt(debt.amountMinor);
        }
        total.net += BigInt(ledger.balances.find(balance => balance.userId === actorId)!.netMinor);
        totals.set(ledger.group.currency, total);
        recent.push(...ledger.expenses.map(expense => ({ ...expense, currency: ledger.group.currency, groupName: ledger.group.name })));
      }
      recent.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));
      return { totals: [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, total]) => ({ currency, owedToMeMinor: safeTotal(total.owedToMe), iOweMinor: safeTotal(total.iOwe), netMinor: safeTotal(total.net) })), expenses: recent.slice(0, 10) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
    res.json(result);
  });
  return router;
}
