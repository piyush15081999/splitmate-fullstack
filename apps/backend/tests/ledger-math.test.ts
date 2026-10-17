import { describe, expect, it } from 'vitest';
import { calculateBalances, expenseDate, maxAmountMinor, parseExpense, safeTotal, splitAmount } from '../src/ledger-math.js';
const ids = [1, 2, 3].map(value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`);
const participants = ids.map(userId => ({ userId }));
describe('Deterministic minor-unit splits', () => {
  it('allocates equal remainders by ascending UUID, independent of input order', () => {
    expect(splitAmount(1001, 'EQUAL', [...participants].reverse()).map(share => share.amountMinor)).toEqual([334, 334, 333]);
    expect(splitAmount(1, 'EQUAL', participants).map(share => share.amountMinor)).toEqual([1, 0, 0]);
  });
  it('keeps totals exact for many boundary amounts and participant counts', () => {
    for (const amount of [1, 2, 3, 99, 1000, 1001, maxAmountMinor]) {
      for (let count = 1; count <= 3; count++) expect(splitAmount(amount, 'EQUAL', participants.slice(0, count)).reduce((sum, share) => sum + share.amountMinor, 0)).toBe(amount);
    }
  });
  it('accepts exact shares including zero and requires the exact sum', () => {
    expect(splitAmount(1001, 'EXACT', participants.map((p, i) => ({ ...p, amountMinor: [500, 501, 0][i] }))).map(share => share.amountMinor)).toEqual([500, 501, 0]);
    expect(() => splitAmount(1001, 'EXACT', participants.map(p => ({ ...p, amountMinor: 333 })))).toThrow('total');
    expect(() => splitAmount(100, 'EXACT', [{ userId: ids[0], amountMinor: -1 }])).toThrow();
    expect(() => splitAmount(100, 'EXACT', [{ userId: ids[0], amountMinor: 1.5 }])).toThrow();
  });
  it('uses largest fractional remainders for percentages, with UUID tie-breaking', () => {
    const result = splitAmount(1001, 'PERCENTAGE', participants.map((p, i) => ({ ...p, percentageBps: [3333, 3333, 3334][i] })));
    expect(result.map(share => share.amountMinor)).toEqual([334, 333, 334]);
    expect(result.map(share => share.percentageBps)).toEqual([3333, 3333, 3334]);
    expect(splitAmount(1, 'PERCENTAGE', participants.map((p, i) => ({ ...p, percentageBps: [5000, 5000, 0][i] }))).map(share => share.amountMinor)).toEqual([1, 0, 0]);
  });
  it('avoids overflow in percentage products at the PostgreSQL Int limit', () => {
    const shares = splitAmount(maxAmountMinor, 'PERCENTAGE', [{ userId: ids[0], percentageBps: 9999 }, { userId: ids[1], percentageBps: 1 }]);
    expect(shares.reduce((sum, share) => sum + share.amountMinor, 0)).toBe(maxAmountMinor);
  });
  it.each([9999, 10001, 0])('rejects percentage total %i', total => {
    expect(() => splitAmount(100, 'PERCENTAGE', [{ userId: ids[0], percentageBps: total }])).toThrow();
  });
  it('rejects duplicate/empty participants, floats, strings, overflows and invalid modes', () => {
    expect(() => splitAmount(10, 'EQUAL', [])).toThrow();
    expect(() => splitAmount(10, 'EQUAL', [participants[0], participants[0]])).toThrow('unique');
    expect(() => splitAmount(10, 'EQUAL', [{ userId: 'invalid' }])).toThrow();
    expect(() => splitAmount(10, 'EQUAL', [{ userId: ids[0], amountMinor: 10 }])).toThrow();
    for (const amount of [0, -1, .5, maxAmountMinor + 1, Number.NaN]) expect(() => splitAmount(amount, 'EQUAL', participants)).toThrow();
    expect(() => splitAmount(10, 'BOGUS' as 'EQUAL', participants)).toThrow();
    expect(() => splitAmount(100, 'PERCENTAGE', [{ userId: ids[0], percentageBps: 10000.5 }])).toThrow();
  });
});
describe('Ledger dates and balances', () => {
  it('validates actual UTC calendar dates, including leap years', () => {
    expect(expenseDate('2024-02-29')).toBe('2024-02-29');
    for (const date of ['2026-02-29', '2026-13-01', '2026-04-31', '2026-1-1', '2026-01-01T00:00:00Z']) expect(() => expenseDate(date)).toThrow();
  });
  it('calculates paid minus owed and retains direct reciprocal debts without rerouting', () => {
    const result = calculateBalances(ids, [
      { amountMinor: 1200, paidById: ids[0]!, shares: ids.map(userId => ({ userId, amountMinor: 400 })) },
      { amountMinor: 200, paidById: ids[1]!, shares: [{ userId: ids[0]!, amountMinor: 100 }, { userId: ids[1]!, amountMinor: 100 }] },
    ]);
    expect(result.balances.map(balance => balance.netMinor)).toEqual([700, -300, -400]);
    expect(result.balances.reduce((sum, balance) => sum + balance.netMinor, 0)).toBe(0);
    expect(result.debts).toContainEqual({ fromUserId: ids[1], toUserId: ids[0], amountMinor: 400 });
    expect(result.debts).toContainEqual({ fromUserId: ids[0], toUserId: ids[1], amountMinor: 100 });
  });
  it('supports a payer excluded from the participants and no-expense groups', () => {
    const result = calculateBalances(ids, [{ amountMinor: 100, paidById: ids[0]!, shares: [{ userId: ids[1]!, amountMinor: 100 }] }]);
    expect(result.balances.map(balance => balance.netMinor)).toEqual([100, -100, 0]);
    expect(calculateBalances(ids, []).debts).toEqual([]);
  });
  it('refuses incomplete legacy totals rather than inventing obligations', () => {
    expect(() => calculateBalances(ids, [{ amountMinor: 100, paidById: ids[0]!, shares: [] }])).toThrow('historical');
    expect(() => safeTotal(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow('integer range');
  });
  it('parses metadata without accepting ownership or unknown field overposting', () => {
    const input = { description: ' Food ', amountMinor: 100, currency: 'EUR', paidById: ids[0], participants, splitType: 'EQUAL', date: '2026-10-14', category: 'FOOD' };
    expect(parseExpense(input).description).toBe('Food');
    expect(() => parseExpense({ ...input, createdById: ids[1] })).toThrow();
    expect(() => parseExpense({ ...input, category: 'INVALID' })).toThrow();
  });
});


it('conserves precision across deterministic percentage partitions and aggregate boundaries', () => {
  for (const amount of [1, 99, 1001, maxAmountMinor]) for (let first = 0; first <= 10000; first += 137) {
    const shares = splitAmount(amount, 'PERCENTAGE', [{ userId: ids[0], percentageBps: first }, { userId: ids[1], percentageBps: 10000 - first }]);
    expect(shares.reduce((n, share) => n + BigInt(share.amountMinor), 0n)).toBe(BigInt(amount));
    expect(shares.every(share => Number.isSafeInteger(share.amountMinor) && share.amountMinor >= 0)).toBe(true);
  }
  expect(safeTotal(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  expect(() => safeTotal(BigInt(Number.MIN_SAFE_INTEGER) - 1n)).toThrow();
  const expense = { amountMinor: maxAmountMinor, paidById: ids[0]!, shares: [{ userId: ids[1]!, amountMinor: maxAmountMinor }] };
  const balances = calculateBalances(ids, [expense, expense, expense]).balances;
  expect(balances.map(b => b.netMinor)).toEqual([6442450941, -6442450941, 0]);
});
