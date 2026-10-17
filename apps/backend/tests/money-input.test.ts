import { describe, expect, it } from 'vitest';
import { decimalUnits, money } from '../../frontend/src/money.js';
describe('Browser money input and display', () => {
  it('parses decimal digits exactly, including 0.29 and the Int boundary', () => {
    expect(decimalUnits('0.29')).toBe(29);
    expect(decimalUnits('10.01')).toBe(1001);
    expect(decimalUnits('21474836.47')).toBe(2147483647);
    expect(decimalUnits('100.00', 10000)).toBe(10000);
    for (const value of ['1.001', '1e3', '-1', 'NaN', '', '21474836.48']) expect(() => decimalUnits(value)).toThrow();
  });
  it('formats negative cents and very large safe integers without losing cents', () => {
    expect(money(-1, 'EUR')).toBe('-€0.01');
    expect(money(1001, 'EUR')).toBe('€10.01');
    expect(money(Number.MAX_SAFE_INTEGER, 'EUR')).toBe('€90,071,992,547,409.91');
    expect(() => money(1.5, 'EUR')).toThrow();
  });
});
