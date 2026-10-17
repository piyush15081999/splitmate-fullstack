const dateFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
// Calendar dates stay on their recorded UTC day; audit timestamps explicitly say UTC.
export function formatDate(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? dateFormat.format(date) : 'Unknown date'; }
export function formatDateTime(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? dateFormat.format(date) + ', ' + timeFormat.format(date) + ' UTC' : 'Unknown date'; }
export function formatMonth(value: string) { const date = new Date(value + '-01T00:00:00Z'); return Number.isFinite(date.getTime()) ? monthFormat.format(date) : 'Unknown month'; }
export function splitLabel(value: string) { return ({ EQUAL: 'Equal split', EXACT: 'Exact amounts', PERCENTAGE: 'Percentage split', LEGACY: 'Legacy split' } as Record<string, string>)[value] ?? 'Unknown split'; }
