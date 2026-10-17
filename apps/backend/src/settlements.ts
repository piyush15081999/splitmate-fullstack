import { createHash } from 'node:crypto';
import { Router } from 'express';
import { Prisma, type PrismaClient } from './generated/prisma/client.js';
import { HttpError } from './errors.js';
import { bodyObject, groupId, text } from './validation.js';
import { expenseDate, integer, maxAmountMinor } from './ledger-math.js';
import { lockLedger } from './ledger-lock.js';
import type { Debt } from './debts.js';
import { recordActivity } from './activity.js';

const user = { id: true, displayName: true } as const;
export const settlementSelect = {
  id: true, groupId: true, fromUserId: true, toUserId: true, amountMinor: true, mode: true,
  settledAt: true, createdAt: true, createdById: true, createdBy: { select: user },
  from: { select: { user: { select: user } } }, to: { select: { user: { select: user } } },
  reversal: { select: { id: true, reason: true, createdAt: true, createdById: true, createdBy: { select: user } } },
} satisfies Prisma.SettlementSelect;
type ReadLedger = (tx: Prisma.TransactionClient, id: string, actor: string) => Promise<{ group: { currency: string; members: { userId: string }[] }; debts: Debt[]; balances: { userId: string; netMinor: number }[] }>;
async function write<T>(prisma: PrismaClient, action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) {
        if (attempt < 2) continue;
        throw new HttpError(409, 'The ledger changed. Refresh and retry with the same request key.');
      }
      throw error;
    }
  }
}
export function createSettlementRoutes(prisma: PrismaClient, readLedger: ReadLedger) {
  const router = Router();
  router.post('/groups/:id/settlements', async (req, res) => {
    const id = groupId(req.params.id).toLowerCase(), actor = res.locals.auth.user.id as string;
    const header = req.get('Idempotency-Key');
    if (!header) throw new HttpError(400, 'An Idempotency-Key UUID header is required.');
    const key = groupId(header).toLowerCase();
    const body = bodyObject(req.body, ['fromUserId', 'toUserId', 'amountMinor', 'currency', 'date', 'mode']);
    const input = { fromUserId: groupId(body.fromUserId).toLowerCase(), toUserId: groupId(body.toUserId).toLowerCase(), amountMinor: integer(body.amountMinor, 'Repayment amount', 1, maxAmountMinor), currency: body.currency, date: expenseDate(body.date), mode: body.mode ?? 'DIRECT' };
    if (input.fromUserId === input.toUserId) throw new HttpError(400, 'Payer and receiver must be different people.');
    if (typeof input.mode !== 'string' || !['DIRECT', 'SIMPLIFIED'].includes(input.mode)) throw new HttpError(400, 'Choose DIRECT or SIMPLIFIED repayments.');
    const hash = createHash('sha256').update(JSON.stringify({ groupId: id, ...input })).digest('hex');
    const result = await write(prisma, async tx => {
      await lockLedger(tx, id);
      const membership = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: id, userId: actor } }, select: { role: true } });
      if (!membership) throw new HttpError(404, 'Group not found.');
      if (actor !== input.fromUserId && actor !== input.toUserId && membership.role !== 'OWNER') throw new HttpError(403, 'Only the payer, receiver or group owner may record this repayment.');
      const previous = await tx.settlement.findUnique({ where: { createdById_idempotencyKey: { createdById: actor, idempotencyKey: key } }, select: { ...settlementSelect, requestHash: true } });
      if (previous) {
        if (previous.requestHash !== hash) throw new HttpError(409, 'This request key was used for a different repayment.');
        const { requestHash: _hash, ...settlement } = previous;
        return { settlement, replayed: true };
      }
      const ledger = await readLedger(tx, id, actor);
      if (input.currency !== ledger.group.currency) throw new HttpError(400, 'Repayment currency must match the group currency.');
      const ids = new Set(ledger.group.members.map(member => member.userId));
      if (!ids.has(input.fromUserId) || !ids.has(input.toUserId)) throw new HttpError(400, 'Payer and receiver must belong to this group.');
      const from = ledger.balances.find(b => b.userId === input.fromUserId)!, to = ledger.balances.find(b => b.userId === input.toUserId)!;
      const maximum = input.mode === 'DIRECT' ? ledger.debts.find(d => d.fromUserId === input.fromUserId && d.toUserId === input.toUserId)?.amountMinor ?? 0 : Math.min(Math.max(0, -from.netMinor), Math.max(0, to.netMinor));
      if (input.amountMinor > maximum) throw new HttpError(409, 'This exceeds the current repayable amount for these people and repayment mode. Refresh the ledger.');
      const settlement = await tx.settlement.create({ data: { groupId: id, fromUserId: input.fromUserId, toUserId: input.toUserId, amountMinor: input.amountMinor, mode: input.mode as string, settledAt: new Date(`${input.date}T00:00:00.000Z`), createdById: actor, idempotencyKey: key, requestHash: hash }, select: settlementSelect });
      await recordActivity(tx, { groupId: id, actorId: actor, action: 'REPAYMENT_RECORDED', referenceId: settlement.id, referenceType: 'SETTLEMENT', eventKey: `REPAYMENT_RECORDED:${settlement.id}`, data: { fromUserId: settlement.fromUserId, toUserId: settlement.toUserId, amountMinor: settlement.amountMinor, date: input.date, mode: settlement.mode } }, 'GROUP');
      return { settlement, replayed: false };
    });
    res.status(result.replayed ? 200 : 201).json(result);
  });
  router.post('/groups/:id/settlements/:settlementId/reverse', async (req, res) => {
    const id = groupId(req.params.id).toLowerCase(), settlementId = groupId(req.params.settlementId).toLowerCase(), actor = res.locals.auth.user.id as string;
    const reason = text(bodyObject(req.body, ['reason']).reason, 'Reversal reason', 300);
    const result = await write(prisma, async tx => {
      await lockLedger(tx, id);
      const membership = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: id, userId: actor } }, select: { role: true } });
      if (!membership) throw new HttpError(404, 'Group not found.');
      const settlement = await tx.settlement.findFirst({ where: { id: settlementId, groupId: id }, select: settlementSelect });
      if (!settlement) throw new HttpError(404, 'Repayment not found.');
      if (settlement.createdById !== actor && membership.role !== 'OWNER') throw new HttpError(403, 'Only the recorder or group owner may reverse this repayment.');
      if (settlement.reversal) {
        if (settlement.reversal.reason !== reason) throw new HttpError(409, 'This repayment is already reversed. Its audit record cannot be changed.');
        return { settlement, replayed: true };
      }
      await tx.settlementReversal.create({ data: { settlementId, createdById: actor, reason } });
      await recordActivity(tx, { groupId: id, actorId: actor, action: 'REPAYMENT_REVERSED', referenceId: settlementId, referenceType: 'SETTLEMENT', eventKey: `REPAYMENT_REVERSED:${settlementId}`, data: { reason, fromUserId: settlement.fromUserId, toUserId: settlement.toUserId, amountMinor: settlement.amountMinor, date: settlement.settledAt.toISOString().slice(0, 10) } });
      return { settlement: await tx.settlement.findUniqueOrThrow({ where: { id: settlementId }, select: settlementSelect }), replayed: false };
    });
    res.json(result);
  });
  return router;
}
