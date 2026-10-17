import { HttpError } from './errors.js';

export function bodyObject(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new HttpError(400, 'Invalid request fields.');
  }
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max: number) {
  // eslint-disable-next-line no-control-regex -- Deliberately reject ASCII control characters in user text.
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new HttpError(400, `${label} must contain 1–${max} characters without control characters.`);
  }
  return value.trim();
}
export function email(value: unknown) {
  const normalized = text(value, 'Email', 254).toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(normalized)) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  return normalized;
}
export function password(value: unknown) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || Buffer.byteLength(value, 'utf8') > 512) {
    throw new HttpError(400, 'Password must be between 12 and 128 characters.');
  }
  return value;
}
export function groupId(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, 'Invalid group ID.');
  }
  return value;
}
export const currencies = ['EUR', 'GBP', 'USD'] as const;
export function currency(value: unknown) {
  const candidate = value ?? 'EUR';
  if (typeof candidate !== 'string' || !currencies.some(item => item === candidate)) throw new HttpError(400, 'Choose EUR, GBP or USD.');
  return candidate;
}
