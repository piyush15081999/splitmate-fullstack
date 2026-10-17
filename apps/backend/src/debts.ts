import { HttpError } from './errors.js';
import { calculateBalances, safeTotal } from './ledger-math.js';

export type Debt = { fromUserId: string; toUserId: string; amountMinor: number };
type Balance = { userId: string; netMinor: number };
type Repayment = Debt & { reversal?: unknown };

/** Greedy deterministic matching; preserves nets, not necessarily minimum payment count. */
export function simplifyDebts(balances: Balance[]): Debt[] {
  if (new Set(balances.map(b => b.userId)).size !== balances.length || balances.some(b => !Number.isSafeInteger(b.netMinor)) || balances.reduce((sum, b) => sum + BigInt(b.netMinor), 0n) !== 0n) throw new HttpError(409, 'Group balances do not reconcile.');
  const ranked = (sign: number) => balances.filter(b => Math.sign(b.netMinor) === sign).map(b => ({ id: b.userId, amount: BigInt(b.netMinor) * BigInt(sign) })).sort((a, b) => a.amount === b.amount ? a.id.localeCompare(b.id) : a.amount > b.amount ? -1 : 1);
  const debtors = ranked(-1), creditors = ranked(1), result: Debt[] = [];
  let d = 0, c = 0;
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d]!, creditor = creditors[c]!;
    const amount = debtor.amount < creditor.amount ? debtor.amount : creditor.amount;
    result.push({ fromUserId: debtor.id, toUserId: creditor.id, amountMinor: safeTotal(amount) });
    debtor.amount -= amount; creditor.amount -= amount;
    if (debtor.amount === 0n) d++;
    if (creditor.amount === 0n) c++;
  }
  return result;
}

export function financialLedger(userIds: string[], expenses: Parameters<typeof calculateBalances>[1], settlements: Repayment[]) {
  const original = calculateBalances(userIds, expenses);
  const balances = original.balances.map(b => ({ ...b, sentMinor: 0, receivedMinor: 0 }));
  const sent = new Map(userIds.map(id => [id, 0n])), received = new Map(sent);
  const pairs = new Map<string, { low: string; high: string; amount: bigint }>();
  const add = (from: string, to: string, amount: bigint) => {
    const [low, high] = [from, to].sort() as [string, string];
    const key = `${low}:${high}`, pair = pairs.get(key) ?? { low, high, amount: 0n };
    pair.amount += from === low ? amount : -amount; pairs.set(key, pair);
  };
  for (const debt of original.debts) add(debt.fromUserId, debt.toUserId, BigInt(debt.amountMinor));
  for (const payment of settlements) {
    if (payment.reversal) continue;
    if (!sent.has(payment.fromUserId) || !received.has(payment.toUserId) || payment.fromUserId === payment.toUserId || !Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0) throw new HttpError(409, 'Historical settlement data is inconsistent.');
    const amount = BigInt(payment.amountMinor);
    sent.set(payment.fromUserId, sent.get(payment.fromUserId)! + amount);
    received.set(payment.toUserId, received.get(payment.toUserId)! + amount);
    add(payment.fromUserId, payment.toUserId, -amount);
  }
  for (const b of balances) {
    b.sentMinor = safeTotal(sent.get(b.userId)!); b.receivedMinor = safeTotal(received.get(b.userId)!);
    b.netMinor = safeTotal(BigInt(b.paidMinor) - BigInt(b.owedMinor) + sent.get(b.userId)! - received.get(b.userId)!);
  }
  const debts = [...pairs.values()].filter(p => p.amount !== 0n).map(p => ({ fromUserId: p.amount > 0n ? p.low : p.high, toUserId: p.amount > 0n ? p.high : p.low, amountMinor: safeTotal(p.amount > 0n ? p.amount : -p.amount) })).sort((a, b) => a.fromUserId.localeCompare(b.fromUserId) || a.toUserId.localeCompare(b.toUserId));
  // Check the bilateral graph independently against the ledger's actual member nets.
  for (const b of balances) {
    const implied = debts.reduce((sum, debt) => sum + (debt.toUserId === b.userId ? BigInt(debt.amountMinor) : debt.fromUserId === b.userId ? -BigInt(debt.amountMinor) : 0n), 0n);
    if (implied !== BigInt(b.netMinor)) throw new HttpError(409, 'Debt suggestions do not reconcile.');
  }
  return { balances, debts, simplifiedDebts: simplifyDebts(balances) };
}
