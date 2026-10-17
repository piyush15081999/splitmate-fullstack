import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('compiled React and protected ledger work through HTTPS with secure sessions and SPA refresh', async ({ page, browser }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const base = 'https://localhost:5275';
  const member = await browser.newContext({ baseURL: base, ignoreHTTPSErrors: true });
  try {
    await page.goto('/register');
    await page.getByLabel('Your name').fill('Fictional Cloud User');
    const email = 'https-' + randomUUID() + '@example.test', password = 'Fictional HTTPS ' + randomUUID();
    await page.getByLabel('Email address').fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(page.locator('#groups')).toBeVisible();
    const cookie = (await page.context().cookies()).find(c => c.name === 'splitmate_session'); expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Strict' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('splitmate_session');
    const response = await page.request.get('/'); expect(response.headers()['content-security-policy']).toContain("script-src 'self'"); expect(response.headers()['strict-transport-security']).toContain('31536000');
    const me = await (await page.request.get('/api/auth/me')).json(); const headers = { Origin: base, 'X-CSRF-Token': me.csrfToken };
    await page.getByRole('button', { name: 'Create group', exact: true }).click(); await page.getByLabel('Group name', { exact: true }).fill('Cloud preview'); await page.getByRole('dialog').getByRole('button', { name: 'Create group', exact: true }).click();
    await expect(page).toHaveURL(/\/groups\/[a-f0-9-]+/); const id = new URL(page.url()).pathname.split('/')[2]!;
    const memberEmail = 'https-member-' + randomUUID() + '@example.test';
    const registered = await member.request.post('/api/auth/register', { headers: { Origin: base }, data: { displayName: 'Fictional Phone User', email: memberEmail, password } }); expect(registered.status()).toBe(201);
    const memberAuth = await registered.json(); const invited = await page.request.post('/api/groups/' + id + '/invitations', { headers, data: { email: memberEmail } }); expect(invited.status()).toBe(201);
    const invite = await invited.json(); expect((await member.request.post('/api/invitations/' + invite.invitation.id + '/respond', { headers: { Origin: base, 'X-CSRF-Token': memberAuth.csrfToken }, data: { decision: 'ACCEPT' } })).status()).toBe(200);
    await page.getByRole('button', { name: 'Refresh members', exact: true }).click(); await expect(page.locator('.member-list li')).toHaveCount(2);
    await page.getByRole('button', { name: 'Add expense', exact: true }).click(); const form = page.locator('form.expense-form');
    await form.getByLabel('Description', { exact: true }).fill('Shared HTTPS dinner'); await form.getByLabel('Amount', { exact: true }).fill('10.01'); await form.getByRole('button', { name: 'Save expense', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.expense-explorer .ledger-expense')).toHaveCount(1); await expect(page.locator('.expense-explorer')).toContainText('Equal split');
    await page.reload(); await expect(page.locator('.expense-explorer')).toContainText('Shared HTTPS dinner');
    const ledger = await (await page.request.get('/api/groups/' + id + '/ledger')).json(); expect(ledger.balances.reduce((n: number, b: { netMinor: number }) => n + b.netMinor, 0)).toBe(0);
    expect((await page.request.post('/api/groups', { headers: { Origin: base }, data: { name: 'No CSRF' } })).status()).toBe(403);
    expect((await page.request.post('/api/groups', { headers: { ...headers, Origin: 'https://evil.invalid' }, data: { name: 'Bad origin' } })).status()).toBe(403);
    const missing = await page.request.get('/api/missing'); expect(missing.status()).toBe(404); expect(missing.headers()['content-type']).toContain('application/json');
    expect((await page.request.get('/assets/does-not-exist.js')).status()).toBe(404);
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.logout-button').click(); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.getByLabel('Email address').fill(email); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.locator('#groups')).toBeVisible(); expect(errors).toEqual([]);
  } finally { await member.close(); }
});
