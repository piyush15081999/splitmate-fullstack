import { Router } from 'express';
import { Prisma, type PrismaClient } from './generated/prisma/client.js';
import { HttpError } from './errors.js';
import { bodyObject, email, groupId } from './validation.js';
import { recordActivity } from './activity.js';
import { lockLedger } from './ledger-lock.js';
import { expenseQuery, pagination } from './expense-query.js';
import { expenseSelect, groupLedger } from './ledger.js';
import { safeTotal } from './ledger-math.js';

const activitySelect = { id: true, groupId: true, actorId: true, actorName: true, action: true, referenceId: true, referenceType: true, data: true, createdAt: true } satisfies Prisma.ActivitySelect;
const invitationSelect = { id: true, status: true, createdAt: true, respondedAt: true, group: { select: { id: true, name: true, currency: true } }, inviter: { select: { id: true, displayName: true } } } satisfies Prisma.GroupInvitationSelect;
async function membership(tx: Prisma.TransactionClient, id: string, userId: string) {
  const member = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: id, userId } }, select: { role: true } });
  if (!member) throw new HttpError(404, 'Group not found.'); return member;
}
async function invitationWrite<T>(prisma: PrismaClient, action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) { if (attempt < 2) continue; throw new HttpError(409, 'The group changed. Refresh and retry.'); } throw error; }
  }
}
async function visibleNotifications(tx: Prisma.TransactionClient, userId: string): Promise<Prisma.NotificationWhereInput> {
  const groups = await tx.groupMember.findMany({ where: { userId }, select: { groupId: true } });
  const invitations = await tx.groupInvitation.findMany({ where: { inviteeId: userId }, select: { id: true } });
  return { userId, OR: [{ activity: { groupId: { in: groups.map(g => g.groupId) } } }, { activity: { action: 'GROUP_INVITED', referenceId: { in: invitations.map(i => i.id) } } }] };
}
export function createCollaborationRoutes(prisma: PrismaClient) {
  const router = Router();
  router.get('/groups/:id/expenses', async (req, res) => {
    const id = groupId(req.params.id).toLowerCase(), actor = res.locals.auth.user.id as string;
    const filter = expenseQuery(req.query);
    const result = await prisma.$transaction(async tx => {
      const member = await membership(tx, id, actor);
      if (filter.where.paidById && !await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: id, userId: filter.where.paidById } } })) throw new HttpError(400, 'Payer filter must be a group member.');
      const where = { groupId: id, ...filter.where };
      const total = await tx.expense.count({ where });
      const items = (await tx.expense.findMany({ where, select: expenseSelect, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }], skip: filter.skip, take: filter.pageSize })).map(e => ({ ...e, canEdit: e.createdById === actor || member.role === 'OWNER' }));
      return { items, total, page: filter.page, pageSize: filter.pageSize, totalPages: Math.ceil(total / filter.pageSize) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }); res.json(result);
  });
  router.get('/groups/:id/activity', async (req, res) => {
    const id = groupId(req.params.id).toLowerCase(), actor = res.locals.auth.user.id as string;
    if (Object.keys(req.query).some(k => !['page', 'pageSize'].includes(k))) throw new HttpError(400, 'Unknown activity filter.');
    const p = pagination(req.query);
    res.json(await prisma.$transaction(async tx => {
      await membership(tx, id, actor);
      const total = await tx.activity.count({ where: { groupId: id } });
      const items = await tx.activity.findMany({ where: { groupId: id }, select: activitySelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: p.skip, take: p.pageSize });
      return { items, total, page: p.page, pageSize: p.pageSize, totalPages: Math.ceil(total / p.pageSize) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  });
  router.get('/groups/:id/analytics', async (req, res) => {
    if (Object.keys(req.query).length) throw new HttpError(400, 'Analytics covers all recorded group dates; filters are not supported.');
    const id = groupId(req.params.id).toLowerCase(), actor = res.locals.auth.user.id as string;
    res.json(await prisma.$transaction(async tx => {
      const ledger = await groupLedger(tx, id, actor);
      const categories = new Map<string, { amount: bigint; count: number }>(), months = new Map<string, { amount: bigint; count: number }>(); let total = 0n;
      for (const e of ledger.expenses) {
        total += BigInt(e.amountMinor);
        for (const [map, key] of [[categories, e.category], [months, e.occurredAt.toISOString().slice(0, 7)]] as const) { const item = map.get(key) ?? { amount: 0n, count: 0 }; item.amount += BigInt(e.amountMinor); item.count++; map.set(key, item); }
      }
      const person = ledger.balances.find(b => b.userId === actor)!;
      return { currency: ledger.group.currency, totalMinor: safeTotal(total), expenseCount: ledger.expenses.length, byCategory: [...categories].sort(([a], [b]) => a.localeCompare(b)).map(([category, item]) => ({ category, amountMinor: safeTotal(item.amount), count: item.count })), monthly: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, item]) => ({ month, amountMinor: safeTotal(item.amount), count: item.count })), personal: { paidMinor: person.paidMinor, shareMinor: person.owedMinor, netMinor: person.netMinor, sentMinor: person.sentMinor, receivedMinor: person.receivedMinor }, members: ledger.balances.map(b => ({ userId: b.userId, displayName: ledger.group.members.find(m => m.userId === b.userId)!.user.displayName, paidMinor: b.paidMinor, shareMinor: b.owedMinor, netMinor: b.netMinor })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 }));
  });
  router.get('/notifications', async (req, res) => {
    if (Object.keys(req.query).some(k => !['page', 'pageSize', 'unread'].includes(k)) || req.query.unread !== undefined && (typeof req.query.unread !== 'string' || !['true', 'false'].includes(req.query.unread))) throw new HttpError(400, 'Invalid notification filters.');
    const p = pagination(req.query), actor = res.locals.auth.user.id as string;
    res.json(await prisma.$transaction(async tx => {
      const visible = await visibleNotifications(tx, actor), where = { ...visible, ...(req.query.unread === 'true' ? { readAt: null } : {}) };
      const total = await tx.notification.count({ where }), unreadCount = await tx.notification.count({ where: { ...visible, readAt: null } });
      const items = await tx.notification.findMany({ where, select: { id: true, readAt: true, createdAt: true, activity: { select: activitySelect } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: p.skip, take: p.pageSize });
      return { items, total, unreadCount, page: p.page, pageSize: p.pageSize, totalPages: Math.ceil(total / p.pageSize) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  });
  router.post('/notifications/:id/read', async (req, res) => {
    bodyObject(req.body, []); const id = groupId(req.params.id).toLowerCase(), actor = res.locals.auth.user.id as string;
    res.json(await prisma.$transaction(async tx => {
      const visible = await visibleNotifications(tx, actor);
      const notification = await tx.notification.findFirst({ where: { ...visible, id }, select: { id: true, readAt: true } });
      if (!notification) throw new HttpError(404, 'Notification not found.');
      await tx.notification.updateMany({ where: { id, userId: actor, readAt: null }, data: { readAt: new Date() } });
      return { notification: await tx.notification.findUniqueOrThrow({ where: { id }, select: { id: true, readAt: true } }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  });
  router.get('/invitations', async (req, res) => {
    if (Object.keys(req.query).some(k => !['page', 'pageSize'].includes(k))) throw new HttpError(400, 'Invalid invitation filters.');
    const p = pagination(req.query), actor = res.locals.auth.user.id as string;
    res.json(await prisma.$transaction(async tx => {
      const where = { inviteeId: actor, status: 'PENDING' };
      const total = await tx.groupInvitation.count({ where });
      const items = await tx.groupInvitation.findMany({ where, select: invitationSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: p.skip, take: p.pageSize });
      return { items, total, page: p.page, pageSize: p.pageSize, totalPages: Math.ceil(total / p.pageSize) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  });
  router.post('/groups/:id/invitations', async (req, res) => {
    const id = groupId(req.params.id).toLowerCase(), actor = res.locals.auth.user.id as string;
    const targetEmail = email(bodyObject(req.body, ['email']).email);
    const result = await invitationWrite(prisma, async tx => {
      await lockLedger(tx, id); const member = await membership(tx, id, actor);
      if (member.role !== 'OWNER') throw new HttpError(403, 'Only the owner may invite registered users.');
      const target = await tx.user.findUnique({ where: { email: targetEmail }, select: { id: true, passwordHash: true } });
      if (!target?.passwordHash) throw new HttpError(404, 'No registered user has that email address.');
      if (await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: id, userId: target.id } } })) throw new HttpError(409, 'This person is already a member.');
      const previous = await tx.groupInvitation.findUnique({ where: { groupId_inviteeId: { groupId: id, inviteeId: target.id } }, select: invitationSelect });
      if (previous) { if (previous.status !== 'PENDING') throw new HttpError(409, 'This invitation was already answered.'); return { invitation: previous, replayed: true }; }
      const invitation = await tx.groupInvitation.create({ data: { groupId: id, inviterId: actor, inviteeId: target.id }, select: invitationSelect });
      await recordActivity(tx, { groupId: id, actorId: actor, action: 'GROUP_INVITED', referenceType: 'INVITATION', referenceId: invitation.id, eventKey: `INVITED:${invitation.id}`, data: { groupName: invitation.group.name } }, [target.id]);
      return { invitation, replayed: false };
    }); res.status(result.replayed ? 200 : 201).json(result);
  });
  router.post('/invitations/:id/respond', async (req, res) => {
    const id = groupId(req.params.id).toLowerCase(), actor = res.locals.auth.user.id as string;
    const decision = bodyObject(req.body, ['decision']).decision;
    if (decision !== 'ACCEPT' && decision !== 'DECLINE') throw new HttpError(400, 'Choose ACCEPT or DECLINE.');
    const targetStatus = decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
    res.json(await invitationWrite(prisma, async tx => {
      const lookup = await tx.groupInvitation.findFirst({ where: { id, inviteeId: actor }, select: { groupId: true } });
      if (!lookup) throw new HttpError(404, 'Invitation not found.'); await lockLedger(tx, lookup.groupId);
      const invite = await tx.groupInvitation.findFirst({ where: { id, inviteeId: actor }, select: { groupId: true, status: true } });
      if (!invite) throw new HttpError(404, 'Invitation not found.');
      if (invite.status !== 'PENDING') { if (invite.status !== targetStatus) throw new HttpError(409, 'This invitation was already answered.'); return { invitation: await tx.groupInvitation.findUniqueOrThrow({ where: { id }, select: invitationSelect }), replayed: true }; }
      await tx.groupInvitation.update({ where: { id }, data: { status: targetStatus, respondedAt: new Date() } });
      if (decision === 'ACCEPT') {
        const existing = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: invite.groupId, userId: actor } } });
        if (!existing) { await tx.groupMember.create({ data: { groupId: invite.groupId, userId: actor } }); await recordActivity(tx, { groupId: invite.groupId, actorId: actor, action: 'MEMBER_ADDED', referenceId: actor, referenceType: 'USER', eventKey: `INVITE_MEMBER:${id}`, data: { userId: actor } }); }
      }
      await recordActivity(tx, { groupId: invite.groupId, actorId: actor, action: decision === 'ACCEPT' ? 'INVITATION_ACCEPTED' : 'INVITATION_DECLINED', referenceId: id, referenceType: 'INVITATION', eventKey: `INVITE_RESPONSE:${id}`, data: {} });
      return { invitation: await tx.groupInvitation.findUniqueOrThrow({ where: { id }, select: invitationSelect }), replayed: false };
    }));
  });
  return router;
}
