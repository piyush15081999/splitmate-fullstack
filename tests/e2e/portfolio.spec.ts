import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';

// Real API records in the isolated test database only. Never seeds the user's app.
test('fictional portfolio data renders real dashboard, ledger and responsive expense form', async ({ page, browser }) => {
  const partner = await browser.newContext({ baseURL: 'http://localhost:5273' });
  const third = await browser.newContext({ baseURL: 'http://localhost:5273' });
  const origin = 'http://localhost:5273';
  const suffix = randomUUID();
  async function account(request: APIRequestContext, displayName: string, local: string) {
    const email = `${local}-${suffix}@example.test`;
    const response = await request.post('/api/auth/register', { headers: { Origin: origin }, data: { displayName, email, password: `Fictional demo ${randomUUID()}` } });
    expect(response.status()).toBe(201);
    return { ...await response.json() as { user: { id: string }; csrfToken: string }, email, request };
  }
  try {
    const alex = await account(page.request, 'Alex Morgan', 'alex');
    const jamie = await account(partner.request, 'Jamie Chen', 'jamie');
    const robin = await account(third.request, 'Robin Taylor', 'robin');
    const headers = { Origin: origin, 'X-CSRF-Token': alex.csrfToken };
    async function group(name: string) {
      const response = await page.request.post('/api/groups', { headers, data: { name, currency: 'EUR' } });
      expect(response.status()).toBe(201);
      const { group } = await response.json() as { group: { id: string } };
      for (const person of [jamie, robin]) {
        const invited = await page.request.post(`/api/groups/${group.id}/invitations`, { headers, data: { email: person.email } });
        expect(invited.status()).toBe(201);
        const { invitation } = await invited.json() as { invitation: { id: string } };
        const accepted = await person.request.post(`/api/invitations/${invitation.id}/respond`, { headers: { Origin: origin, 'X-CSRF-Token': person.csrfToken }, data: { decision: 'ACCEPT' } });
        expect(accepted.status()).toBe(200);
      }
      return group.id;
    }
    const house = await group('Cedar House');
    const trip = await group('Lisbon weekend');
    for (const bill of [
      { group: house, description: 'Weekly groceries', amountMinor: 6789, paidById: alex.user.id, category: 'FOOD', date: '2026-10-16' },
      { group: house, description: 'October electricity', amountMinor: 12450, paidById: jamie.user.id, category: 'UTILITIES', date: '2026-10-12' },
      { group: house, description: 'Shared home supplies', amountMinor: 3240, paidById: alex.user.id, category: 'HOUSING', date: '2026-09-28' },
      { group: trip, description: 'Dinner by the waterfront', amountMinor: 9600, paidById: alex.user.id, category: 'FOOD', date: '2026-10-10' },
      { group: trip, description: 'Train tickets', amountMinor: 4800, paidById: robin.user.id, category: 'TRANSPORT', date: '2026-10-09' },
      { group: trip, description: 'Museum afternoon', amountMinor: 3600, paidById: jamie.user.id, category: 'ENTERTAINMENT', date: '2026-10-11' },
    ]) {
      const { group, ...data } = bill;
      const saved = await page.request.post(`/api/groups/${group}/expenses`, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { ...data, currency: 'EUR', splitType: 'EQUAL', participants: [alex, jamie, robin].map(p => ({ userId: p.user.id })) } });
      expect(saved.status()).toBe(201);
    }
    await page.goto('/');
    await expect(page.locator('#groups')).toContainText('Cedar House');
    await expect(page.locator('.ledger-expense')).toHaveCount(6);
    await expect(page.locator('.ledger-expense').first()).toContainText('Equal split');
    await expect(page.locator('.ledger-expense').first()).toContainText('16 Oct 2026');
    await page.screenshot({ path: test.info().outputPath('dashboard.png'), animations: 'disabled', timeout: 60_000 });
    await page.goto(`/groups/${house}`);
    await expect(page.locator('.member-list li')).toHaveCount(3);
    await expect(page.locator('.analytics-section')).toContainText('Oct 2026');
    await page.screenshot({ path: test.info().outputPath('group-ledger.png'), animations: 'disabled', timeout: 60_000 });
    await page.locator('.expense-explorer .ledger-expense').first().locator('summary').click();
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    await page.locator('form.expense-form').getByLabel('Description', { exact: true }).fill('Saturday brunch');
    await page.locator('form.expense-form').getByLabel('Amount', { exact: true }).fill('42.50');
    await expect(page.locator('form.expense-form')).toContainText('Equal split');
    await page.screenshot({ path: test.info().outputPath('expense-form.png'), animations: 'disabled', timeout: 60_000 });
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('mobile.png'), animations: 'disabled', timeout: 60_000 });
  } finally { await partner.close(); await third.close(); }
});