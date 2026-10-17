import type { Prisma } from './generated/prisma/client.js';

type Action = 'GROUP_CREATED' | 'MEMBER_ADDED' | 'MEMBER_LEFT' | 'GROUP_INVITED' | 'INVITATION_ACCEPTED' | 'INVITATION_DECLINED' | 'EXPENSE_CREATED' | 'EXPENSE_UPDATED' | 'REPAYMENT_RECORDED' | 'REPAYMENT_REVERSED';
type Event = { groupId: string; actorId: string; action: Action; referenceId: string; referenceType: 'GROUP' | 'USER' | 'EXPENSE' | 'SETTLEMENT' | 'INVITATION'; eventKey: string; data: Prisma.InputJsonValue };
export async function recordActivity(tx: Prisma.TransactionClient, event: Event, notify: 'GROUP' | string[] = []) {
  const actor = await tx.user.findUniqueOrThrow({ where: { id: event.actorId }, select: { displayName: true } });
  const activity = await tx.activity.create({ data: { ...event, actorName: actor.displayName }, select: { id: true } });
  const recipients = notify === 'GROUP' ? (await tx.groupMember.findMany({ where: { groupId: event.groupId, userId: { not: event.actorId } }, select: { userId: true } })).map(m => m.userId) : [...new Set(notify)].filter(id => id !== event.actorId);
  if (recipients.length) await tx.notification.createMany({ data: recipients.map(userId => ({ userId, activityId: activity.id })), skipDuplicates: true });
  return activity;
}

// Explicit financial allowlist: never serialize Prisma records, auth headers or raw request bodies.
export function expenseSnapshot(expense: { description: string; amountMinor: number; paidById: string; occurredAt: Date; category: string; splitType: string; version: number; shares: { userId: string; amountMinor: number; percentageBps: number | null }[] }) {
  return { description: expense.description, amountMinor: expense.amountMinor, paidById: expense.paidById, date: expense.occurredAt.toISOString().slice(0, 10), category: expense.category, splitType: expense.splitType, version: expense.version, shares: expense.shares.map(s => ({ userId: s.userId, amountMinor: s.amountMinor, percentageBps: s.percentageBps })) };
}
