import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

const baseURL = 'http://localhost:5273';
const password = 'Local E2E unique passphrase 2026!';
async function register(page: Page, displayName: string, email: string) {
  await page.bringToFront();
  await page.goto('/register');
  await page.getByLabel('Your name').fill(displayName);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const [registered] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/auth/register') && r.request().method() === 'POST', { timeout: 30_000 }),
    page.getByRole('button', { name: 'Create account', exact: true }).click(),
  ]);
  if (registered.status() !== 201) await page.evaluate(() => { const input = document.querySelector<HTMLInputElement>('input[type="password"]'); if (input) input.value = ''; });
  expect(registered.status(), 'Registration response').toBe(201);
  await expect(page.locator('#groups')).toBeVisible();
  const response = await page.request.get('/api/auth/me');
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ user: { id: string }; csrfToken: string }>;
}
async function logout(page: Page) {
  await page.bringToFront();
  await page.locator('.logout-button').click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
}
async function login(page: Page, email: string) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const [signedIn] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST', { timeout: 30_000 }),
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ]);
  if (signedIn.status() !== 200) await page.evaluate(() => { const input = document.querySelector<HTMLInputElement>('input[type="password"]'); if (input) input.value = ''; });
  expect(signedIn.status(), 'Login response').toBe(200);
  await expect(page.locator('#groups')).toBeVisible();
}
type Ledger = {
  expenses: { id: string; paidById: string; amountMinor: number; shares: { userId: string; amountMinor: number }[] }[];
  balances: { userId: string; paidMinor: number; owedMinor: number; netMinor: number; sentMinor: number; receivedMinor: number }[];
  debts: { fromUserId: string; toUserId: string; amountMinor: number }[];
  settlements: { id: string; reversal: { reason: string } | null }[];
};
async function ledger(page: Page, id: string): Promise<Ledger> {
  const response = await page.request.get(`/api/groups/${id}/ledger`);
  expect(response.status()).toBe(200);
  const result: Ledger = await response.json();
  expect(result.balances.reduce((n, b) => n + b.netMinor, 0)).toBe(0);
  for (const expense of result.expenses) {
    expect(expense.shares.reduce((n, s) => n + s.amountMinor, 0)).toBe(expense.amountMinor);
    expect(expense.shares.every(s => Number.isSafeInteger(s.amountMinor))).toBe(true);
  }
  for (const balance of result.balances) {
    expect(balance.netMinor).toBe(balance.paidMinor - balance.owedMinor + balance.sentMinor - balance.receivedMinor);
  }
  return result;
}

test('real collaboration and ledger lifecycle preserves consent, precision and access boundaries', async ({ page, browser }) => {
  const memberContext = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
  const outsiderContext = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
  const member = await memberContext.newPage(), outsider = await outsiderContext.newPage();
  const errors: string[] = [];
  const serverFailures: string[] = [];
  for (const p of [page, member, outsider]) {
    p.on('pageerror', e => errors.push(e.message));
    p.on('response', response => { if (response.url().startsWith(baseURL + '/api/') && response.status() >= 500) serverFailures.push(response.request().method() + ' ' + new URL(response.url()).pathname + ' ' + response.status()); });
  }
  const suffix = randomUUID();
  const ownerEmail = `owner-${suffix}@example.test`;
  const memberEmail = `member-${suffix}@example.test`;
  try {
    const ownerAuth = await register(page, 'E2E Owner', ownerEmail);
    const memberAuth = await register(member, 'E2E Member', memberEmail);
    const outsiderAuth = await register(outsider, 'E2E Outsider', `outsider-${suffix}@example.test`);
    const cookie = (await page.context().cookies()).find(c => c.name === 'splitmate_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', secure: false });
    expect(await page.evaluate(() => document.cookie)).not.toContain('splitmate_session');
    await logout(page); await login(page, ownerEmail);

    await page.getByRole('button', { name: 'Create group', exact: true }).click();
    await page.getByLabel('Group name', { exact: true }).fill(`E2E home ${suffix}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Create group', exact: true }).click();
    await expect(page).toHaveURL(/\/groups\/[a-f0-9-]+/);
    const groupId = new URL(page.url()).pathname.split('/')[2]!;
    await expect(page.locator('.member-list li')).toHaveCount(1);
    await page.locator('.invite-member-form input').fill(memberEmail);
    await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
    await expect(page.locator('.invite-member')).toContainText('Invitation sent');
    expect((await member.request.get(`/api/groups/${groupId}`)).status()).toBe(404);
    await expect(page.locator('.member-list li')).toHaveCount(1);
    await member.bringToFront();
    await member.getByRole('button', { name: /^Notifications/ }).click();
    await member.getByRole('button', { name: 'Mark as read', exact: true }).first().click();
    await expect(member.getByRole('dialog')).toContainText('Notification marked as read.');
    await member.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    // Confirmation is a meaningful permission boundary, not an implicit join.
    expect((await member.request.get(`/api/groups/${groupId}/ledger`)).status()).toBe(404);
    await member.getByRole('button', { name: 'Confirm join', exact: true }).click();
    await expect(member.getByRole('dialog')).toContainText('Invitation accepted');
    await member.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.bringToFront();
    await page.getByRole('button', { name: 'Refresh members', exact: true }).click();
    await expect(page.locator('.member-list li')).toHaveCount(2);

    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    const form = page.locator('form.expense-form');
    await form.getByLabel('Description', { exact: true }).fill('E2E dinner');
    await form.getByLabel('Amount', { exact: true }).fill('10.01');
    await form.getByRole('combobox', { name: 'Paid by', exact: true }).selectOption(memberAuth.user.id);
    await form.getByRole('combobox', { name: 'Category', exact: true }).selectOption('FOOD');
    await form.getByLabel('Date', { exact: true }).fill('2026-10-15');
    await form.getByRole('button', { name: 'Save expense', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.expense-explorer .ledger-expense')).toHaveCount(1);
    const created = await ledger(page, groupId);
    expect(created.expenses[0]!.paidById).toBe(memberAuth.user.id);
    await page.locator('.expense-explorer .ledger-expense summary').click();
    await page.locator('.expense-explorer').getByRole('button', { name: 'Edit expense', exact: true }).click();
    await page.locator('form.expense-form').getByRole('combobox', { name: 'Paid by', exact: true }).selectOption(ownerAuth.user.id);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async () => (await ledger(page, groupId)).expenses[0]!.paidById).toBe(ownerAuth.user.id);
    const corrected = await ledger(page, groupId);
    expect(corrected.expenses).toHaveLength(1);
    expect(corrected.expenses[0]!.id).toBe(created.expenses[0]!.id);
    const owed = corrected.expenses[0]!.shares.find(s => s.userId === memberAuth.user.id)!.amountMinor;
    expect([500, 501]).toContain(owed);
    const ownerAnalytics = await (await page.request.get(`/api/groups/${groupId}/analytics`)).json();
    const memberAnalytics = await (await member.request.get(`/api/groups/${groupId}/analytics`)).json();
    expect(ownerAnalytics.personal).toMatchObject({ paidMinor: 1001, netMinor: owed });
    expect(memberAnalytics.personal).toMatchObject({ paidMinor: 0, shareMinor: owed, netMinor: -owed });
    await expect(page.locator('.insight-stats')).toContainText('1 expense');
    await expect(page.locator('.analytics-section')).not.toContainText('1 expenses');

    await page.getByRole('button', { name: 'Settle Up', exact: true }).click();
    await page.locator('.settlement-form').getByLabel('Amount', { exact: true }).fill('1.00');
    await page.locator('.settlement-form').getByRole('button', { name: 'Record repayment', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.settlement-record')).toHaveCount(1);
    const settled = await ledger(page, groupId);
    expect(settled.balances.find(b => b.userId === ownerAuth.user.id)!.netMinor).toBe(owed - 100);
    await page.getByRole('button', { name: 'Reverse repayment', exact: true }).click();
    await page.getByLabel('Reason', { exact: true }).fill('E2E correction: repayment recorded by mistake');
    await page.getByRole('button', { name: 'Confirm reversal', exact: true }).click();
    await expect(page.locator('.reversal-audit')).toContainText('E2E correction');
    await page.reload();
    await expect(page.locator('.reversal-audit')).toBeVisible();
    expect((await ledger(page, groupId)).balances).toEqual(corrected.balances);

    for (const suffix of ['', '/members', '/ledger', '/expenses', '/activity', '/analytics']) {
      expect((await outsider.request.get(`/api/groups/${groupId}${suffix}`)).status()).toBe(404);
    }
    await outsider.bringToFront();
    await outsider.goto(`/groups/${groupId}`);
    await expect(outsider.getByRole('alert')).toContainText('Group not found.');
    const me = await (await page.request.get('/api/auth/me')).json();
    const mutation = { name: 'Forbidden CSRF group', currency: 'EUR' };
    expect((await page.request.post('/api/groups', { headers: { Origin: baseURL }, data: mutation })).status()).toBe(403);
    expect((await page.request.post('/api/groups', { headers: { Origin: 'http://evil.invalid', 'X-CSRF-Token': me.csrfToken }, data: mutation })).status()).toBe(403);
    expect((await page.request.get(`/api/groups/${groupId}/analytics?userId=${memberAuth.user.id}`)).status()).toBe(400);
    expect((await outsider.request.post(`/api/groups/${groupId}/settlements`, { headers: { Origin: baseURL, 'X-CSRF-Token': outsiderAuth.csrfToken, 'Idempotency-Key': randomUUID() }, data: { fromUserId: memberAuth.user.id, toUserId: ownerAuth.user.id, amountMinor: 1, currency: 'EUR', date: '2026-10-15' } })).status()).toBe(404);
    await page.bringToFront();
    await page.screenshot({ path: test.info().outputPath('group-desktop.png'), fullPage: true, animations: 'disabled', timeout: 60_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('group-mobile.png'), fullPage: true, animations: 'disabled', timeout: 60_000 });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await logout(page);
    await page.goto(`/groups/${groupId}`);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    expect((await page.request.get(`/api/groups/${groupId}/ledger`)).status()).toBe(401);
    expect(errors).toEqual([]);
    expect(serverFailures, 'No unexpected API failures').toEqual([]);
  } finally {
    await memberContext.close(); await outsiderContext.close();
  }
});
