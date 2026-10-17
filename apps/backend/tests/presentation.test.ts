import { expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMonth, splitLabel } from '../../frontend/src/presentation.js';
it('preserves recorded calendar days and formats audit timestamps in UTC', () => {
  expect(formatDate('2026-10-16T00:00:00.000Z')).toBe('16 Oct 2026');
  expect(formatDateTime('2026-10-16T00:30:00+02:00')).toBe('15 Oct 2026, 22:30 UTC');
  expect(formatMonth('2026-10')).toBe('Oct 2026');
});
it('uses human split labels and safe fallbacks for historical values', () => {
  expect(splitLabel('EQUAL')).toBe('Equal split'); expect(splitLabel('EXACT')).toBe('Exact amounts');
  expect(splitLabel('PERCENTAGE')).toBe('Percentage split'); expect(splitLabel('LEGACY')).toBe('Legacy split');
  expect(splitLabel('unexpected')).toBe('Unknown split'); expect(formatDate('invalid')).toBe('Unknown date');
});
