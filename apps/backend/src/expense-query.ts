import { HttpError } from './errors.js';
import { expenseDate, categories } from './ledger-math.js';
import { groupId } from './validation.js';
export function pagination(query: Record<string, unknown>) {
  const number = (key: string, fallback: number, max: number) => {
    const raw = query[key]; if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !/^[1-9]\d{0,5}$/.test(raw) || Number(raw) > max) throw new HttpError(400, `Invalid ${key}.`);
    return Number(raw);
  };
  const page = number('page', 1, 10000), pageSize = number('pageSize', 10, 50);
  return { page, pageSize, skip: (page - 1) * pageSize };
}
export function expenseQuery(query: Record<string, unknown>) {
  if (Object.keys(query).some(k => !['q', 'from', 'to', 'category', 'paidById', 'page', 'pageSize'].includes(k))) throw new HttpError(400, 'Unknown expense filter.');
  // eslint-disable-next-line no-control-regex -- Deliberately reject ASCII control characters in query values.
  const string = (key: string) => { const raw = query[key]; if (raw === undefined || raw === '') return undefined; if (typeof raw !== 'string' || raw.length > 200 || /[\u0000-\u001f\u007f]/.test(raw)) throw new HttpError(400, `Invalid ${key}.`); return raw.trim(); };
  const q = string('q'), from = string('from'), to = string('to'), category = string('category'), paidById = string('paidById');
  if (from) expenseDate(from); if (to) expenseDate(to);
  if (from && to && from > to) throw new HttpError(400, 'Start date must not be after end date.');
  if (category && !categories.includes(category as typeof categories[number])) throw new HttpError(400, 'Choose a supported category.');
  if (paidById) groupId(paidById);
  const end = to ? new Date(`${to}T00:00:00.000Z`) : undefined; if (end) end.setUTCDate(end.getUTCDate() + 1);
  return { ...pagination(query), where: { ...(q ? { description: { contains: q, mode: 'insensitive' as const } } : {}), ...(category ? { category } : {}), ...(paidById ? { paidById: paidById.toLowerCase() } : {}), ...(from || end ? { occurredAt: { ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(end ? { lt: end } : {}) } } : {}) } };
}
