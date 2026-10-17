import { describe, expect, it } from 'vitest';
import { financialLedger, simplifyDebts } from '../src/debts.js';
const ids = ['a', 'b', 'c', 'zero'];
const expense = (paidById: string, userId: string, amountMinor: number) => ({ paidById, amountMinor, shares: [{ userId, amountMinor }] });
describe('Settlement-aware debt calculations', () => {
  it('nets bilateral debts without changing original shares', () => {
    const expenses = [expense('a', 'b', 1001), expense('b', 'a', 201)];
    const before = JSON.stringify(expenses), result = financialLedger(ids, expenses, []);
    expect(result.debts).toEqual([{ fromUserId: 'b', toUserId: 'a', amountMinor: 800 }]);
    expect(JSON.stringify(expenses)).toBe(before);
  });
  it('applies partial/full repayment and ignores a reversed repayment', () => {
    const expenses = [expense('a', 'b', 1001)];
    const payment = { fromUserId: 'b', toUserId: 'a', amountMinor: 400 };
    expect(financialLedger(ids, expenses, [payment]).balances.map(b => b.netMinor)).toEqual([601, -601, 0, 0]);
    expect(financialLedger(ids, expenses, [payment, { ...payment, amountMinor: 601 }]).debts).toEqual([]);
    expect(financialLedger(ids, expenses, [{ ...payment, reversal: { reason: 'Incorrect' } }]).debts[0]!.amountMinor).toBe(1001);
  });
  it('simplifies a three-person chain and excludes zero-balance members', () => {
    const result = financialLedger(ids, [expense('a', 'b', 101), expense('b', 'c', 101)], []);
    expect(result.balances.map(b => b.netMinor)).toEqual([101, 0, -101, 0]);
    expect(result.simplifiedDebts).toEqual([{ fromUserId: 'c', toUserId: 'a', amountMinor: 101 }]);
    const repaid = financialLedger(ids, [expense('a', 'b', 101), expense('b', 'c', 101)], [{ fromUserId: 'c', toUserId: 'a', amountMinor: 101 }]);
    expect(repaid.balances.every(b => b.netMinor === 0)).toBe(true); expect(repaid.simplifiedDebts).toEqual([]);
  });
  it('removes cycles in the optional view and handles an empty/zero ledger', () => {
    const result = financialLedger(ids, [expense('a', 'b', 10), expense('b', 'c', 10), expense('c', 'a', 10)], []);
    expect(result.debts).toHaveLength(3); expect(result.simplifiedDebts).toEqual([]);
    expect(simplifyDebts([])).toEqual([]); expect(financialLedger(ids, [], []).simplifiedDebts).toEqual([]);
  });
  it('uses deterministic UUID ties and exact minor units at large boundaries', () => {
    const balances = [{ userId: 'a', netMinor: 2147483647 }, { userId: 'b', netMinor: -2147483646 }, { userId: 'c', netMinor: -1 }, { userId: 'd', netMinor: 0 }];
    expect(simplifyDebts(balances)).toEqual(simplifyDebts([...balances].reverse()));
    expect(simplifyDebts(balances).reduce((sum, d) => sum + d.amountMinor, 0)).toBe(2147483647);
    expect(simplifyDebts([{ userId: 'z', netMinor: -1 }, { userId: 'a', netMinor: -1 }, { userId: 'c', netMinor: 2 }])[0]!.fromUserId).toBe('a');
  });
  it('preserves every net and zero sum across varied integer ledgers', () => {
    for (let value = 1; value < 200; value++) {
      const balances = [{ userId: 'a', netMinor: value }, { userId: 'b', netMinor: 0 - Math.floor(value / 2) }, { userId: 'c', netMinor: 0 - (value - Math.floor(value / 2)) }];
      const plan = simplifyDebts(balances);
      for (const balance of balances) expect(plan.reduce((sum, d) => sum + (d.toUserId === balance.userId ? d.amountMinor : d.fromUserId === balance.userId ? -d.amountMinor : 0), 0)).toBe(balance.netMinor);
    }
  });
  it('rejects unsafe, inconsistent or duplicate balance inputs and corrupt settlements', () => {
    for (const balances of [[{ userId: 'a', netMinor: 1 }], [{ userId: 'a', netMinor: .1 }], [{ userId: 'a', netMinor: 0 }, { userId: 'a', netMinor: 0 }]]) expect(() => simplifyDebts(balances)).toThrow();
    expect(() => financialLedger(ids, [], [{ fromUserId: 'outside', toUserId: 'a', amountMinor: 1 }])).toThrow();
  });
});
