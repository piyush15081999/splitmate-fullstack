import { HttpError } from './errors.js';
import { bodyObject, groupId, text } from './validation.js';

export const maxAmountMinor = 2_147_483_647;
export const categories = ['FOOD', 'TRANSPORT', 'HOUSING', 'UTILITIES', 'ENTERTAINMENT', 'OTHER'] as const;
export type SplitType = 'EQUAL' | 'EXACT' | 'PERCENTAGE';
export type Share = { userId: string; amountMinor: number; percentageBps: number | null };
export function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, `${label} must be an integer between ${min} and ${max}.`);
  return value;
}
export function expenseDate(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, 'Date must be YYYY-MM-DD.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HttpError(400, 'Enter a valid calendar date.');
  return value;
}
export function splitAmount(amount: number, mode: SplitType, raw: unknown): Share[] {
  integer(amount, 'Amount in minor units', 1, maxAmountMinor);
  if (!['EQUAL', 'EXACT', 'PERCENTAGE'].includes(mode)) throw new HttpError(400, 'Choose an equal, exact or percentage split.');
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) throw new HttpError(400, 'Choose between 1 and 100 participants.');
  const participants = raw.map(item => {
    const body = bodyObject(item, mode === 'EQUAL' ? ['userId'] : mode === 'EXACT' ? ['userId', 'amountMinor'] : ['userId', 'percentageBps']);
    return { userId: groupId(body.userId).toLowerCase(), value: mode === 'EQUAL' ? 1 : integer(mode === 'EXACT' ? body.amountMinor : body.percentageBps, mode === 'EXACT' ? 'Exact share' : 'Percentage basis points', 0, mode === 'EXACT' ? maxAmountMinor : 10000) };
  }).sort((a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
  if (new Set(participants.map(p => p.userId)).size !== participants.length) throw new HttpError(400, 'Participants must be unique.');
  const total = BigInt(amount);
  const sum = participants.reduce((sum, p) => sum + BigInt(p.value), 0n);
  if (mode === 'EXACT' && sum !== total) throw new HttpError(400, 'Exact shares must total the expense amount.');
  if (mode === 'PERCENTAGE' && sum !== 10000n) throw new HttpError(400, 'Percentages must total exactly 100.00% (10000 basis points).');
  if (mode === 'EXACT') return participants.map(p => ({ userId: p.userId, amountMinor: p.value, percentageBps: null }));
  const denominator = mode === 'EQUAL' ? BigInt(participants.length) : 10000n;
  const weighted = participants.map(p => {
    const product = total * BigInt(p.value);
    return { userId: p.userId, amountMinor: Number(product / denominator), remainder: product % denominator, percentageBps: mode === 'PERCENTAGE' ? p.value : null };
  });
  const remaining = amount - weighted.reduce((sum, p) => sum + p.amountMinor, 0);
  const ranked = [...weighted].sort((a, b) => a.remainder === b.remainder ? (a.userId < b.userId ? -1 : 1) : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < remaining; i++) ranked[i]!.amountMinor++;
  return weighted.map(({ remainder: _remainder, ...share }) => share);
}
export function parseExpense(raw: unknown) {
  const body = bodyObject(raw, ['description', 'amountMinor', 'currency', 'paidById', 'participants', 'date', 'category', 'splitType']);
  const description = text(body.description, 'Description', 200);
  const amountMinor = integer(body.amountMinor, 'Amount in minor units', 1, maxAmountMinor);
  if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) throw new HttpError(400, 'Currency must match the group currency.');
  if (typeof body.category !== 'string' || !categories.some(value => value === body.category)) throw new HttpError(400, 'Choose a supported category.');
  const splitType = body.splitType as SplitType;
  const shares = splitAmount(amountMinor, splitType, body.participants);
  return { description, amountMinor, currency: body.currency, paidById: groupId(body.paidById).toLowerCase(), date: expenseDate(body.date), category: body.category, splitType, shares };
}
export function safeTotal(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new HttpError(409, 'Ledger totals exceed the supported integer range.');
  return Number(value);
}
type LedgerExpense = { amountMinor: number; paidById: string; shares: { userId: string; amountMinor: number }[] };
export function calculateBalances(userIds: string[], expenses: LedgerExpense[]) {
  const amounts = new Map(userIds.map(id => [id, { paid: 0n, owed: 0n }]));
  const direct = new Map<string, { fromUserId: string; toUserId: string; amount: bigint }>();
  for (const expense of expenses) {
    const payer = amounts.get(expense.paidById);
    if (!payer || expense.shares.length === 0 || expense.shares.reduce((sum, share) => sum + BigInt(share.amountMinor), 0n) !== BigInt(expense.amountMinor)) throw new HttpError(409, 'This group has incomplete historical expense shares. Repair the historical records before using its ledger.');
    payer.paid += BigInt(expense.amountMinor);
    for (const share of expense.shares) {
      const participant = amounts.get(share.userId);
      if (!participant) throw new HttpError(409, 'Historical expense membership is inconsistent.');
      participant.owed += BigInt(share.amountMinor);
      if (share.userId !== expense.paidById && share.amountMinor > 0) {
        const key = `${share.userId}:${expense.paidById}`;
        const debt = direct.get(key) ?? { fromUserId: share.userId, toUserId: expense.paidById, amount: 0n };
        debt.amount += BigInt(share.amountMinor); direct.set(key, debt);
      }
    }
  }
  const balances = [...amounts].map(([userId, value]) => ({ userId, paidMinor: safeTotal(value.paid), owedMinor: safeTotal(value.owed), netMinor: safeTotal(value.paid - value.owed) }));
  if (balances.reduce((sum, balance) => sum + BigInt(balance.netMinor), 0n) !== 0n) throw new HttpError(409, 'Group balances do not reconcile.');
  return { balances, debts: [...direct.values()].map(debt => ({ fromUserId: debt.fromUserId, toUserId: debt.toUserId, amountMinor: safeTotal(debt.amount) })) };
}
