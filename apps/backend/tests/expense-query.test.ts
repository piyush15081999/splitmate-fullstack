import { describe, expect, it } from 'vitest';
import { expenseQuery, pagination } from '../src/expense-query.js';
describe('Server-side expense query validation', () => {
  it('defaults and bounds pagination', () => {
    expect(pagination({})).toEqual({ page: 1, pageSize: 10, skip: 0 });
    expect(pagination({ page: '3', pageSize: '25' })).toEqual({ page: 3, pageSize: 25, skip: 50 });
    for (const query of [{ page: '0' }, { page: '-1' }, { page: '1.2' }, { page: ['1'] }, { page: '10001' }, { pageSize: '51' }, { pageSize: '0' }]) expect(() => pagination(query)).toThrow();
  });
  it('combines case-insensitive text, payer and inclusive calendar date filters', () => {
    const result = expenseQuery({ q: ' Dinner ', category: 'FOOD', paidById: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', from: '2026-01-01', to: '2026-01-31' });
    expect(result.where.description).toEqual({ contains: 'Dinner', mode: 'insensitive' });
    expect(result.where.paidById).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(result.where.occurredAt?.gte?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(result.where.occurredAt?.lt?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
  it('rejects invalid dates, reversed ranges, repeated values, unsupported filters and control characters', () => {
    for (const query of [{ from: '2026-02-30' }, { from: '2026-02-02', to: '2026-02-01' }, { category: 'INVALID' }, { paidById: 'bad' }, { q: ['a', 'b'] }, { q: 'x'.repeat(201) }, { q: '\u0000' }, { orderBy: 'amountMinor' }]) expect(() => expenseQuery(query)).toThrow();
  });
  it('keeps potentially hostile search strings as parameter values, not executable query structure', () => {
    const q = "' OR 1=1; DROP TABLE Expense;--";
    expect(expenseQuery({ q }).where.description?.contains).toBe(q);
  });
});
