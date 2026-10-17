// Parse decimal text as digits, without multiplying floating-point values.
export function decimalUnits(value: string, max = 2147483647) {
  const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error('Use a decimal amount with at most two decimal places.');
  const result = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (result > BigInt(max)) throw new Error('The amount is too large.');
  return Number(result);
}
export function money(minor: number, currency: string) {
  if (!Number.isSafeInteger(minor)) throw new Error('Money must use safe integer minor units.');
  const units = BigInt(minor);
  const whole = units / 100n;
  const fraction = ((units < 0n ? -units : units) % 100n).toString().padStart(2, '0');
  // Formatting the whole as BigInt preserves cents even near MAX_SAFE_INTEGER.
  const parts = new Intl.NumberFormat('en-IE', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).formatToParts(units < 0n && whole === 0n ? -0 : whole);
  return parts.map(part => part.type === 'fraction' ? fraction : part.value).join('');
}
