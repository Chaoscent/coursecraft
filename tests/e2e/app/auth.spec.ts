// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { ADMIN, login, watchPage } from '../support.js';

test.describe.configure({ mode: 'serial' });

const plainHttp = (baseURL?: string) => !!baseURL?.startsWith('http://');

/**
 * WebKit does not store `Secure` cookies for http://localhost (Chromium and
 * Firefox do). Documented workaround: HTTPS via a local reverse proxy
 * (docs/reverse-proxy/README.md). This test pins the behavior so the docs
 * get updated if WebKit changes.
 */
test('WebKit rejects the secure session cookie on plain-http localhost', async ({
  page,
  context,
  browserName,
  baseURL,
}) => {
  test.skip(browserName !== 'webkit' || !plainHttp(baseURL), 'only WebKit over http');
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(ADMIN.email);
  await page.getByLabel('Passwort').fill(ADMIN.password);
  // The server sets the cookie; WebKit drops it. What the page shows next depends on timing.
  const answered = page.waitForResponse((r) => r.url().endsWith('/api/auth/login') && r.ok());
  await page.getByRole('button', { name: 'Anmelden' }).click();
  expect(await (await answered).headerValue('set-cookie')).toContain('__Host-cc_session');
  expect((await context.cookies()).some((c) => c.name === '__Host-cc_session')).toBe(false);
});

test.describe('application', () => {
  test.beforeEach(({ browserName, baseURL }) => {
    test.skip(
      browserName === 'webkit' && plainHttp(baseURL),
      'WebKit needs HTTPS for secure cookies on localhost',
    );
  });

  test('session cookie is hardened and works on http://localhost', async ({ page, context, baseURL }) => {
    const problems = watchPage(page, baseURL ?? '');
    await login(page, ADMIN.email, ADMIN.password);
    const cookie = (await context.cookies()).find((c) => c.name === '__Host-cc_session');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Hauptmenü' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('wrong password shows an error and no session', async ({ page, context }) => {
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(ADMIN.email);
    await page.getByLabel('Passwort').fill('definitely wrong');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByRole('alert')).toContainText('falsch');
    expect((await context.cookies()).some((c) => c.name === '__Host-cc_session')).toBe(false);
  });

  test('admin creates a user, who must set an own password', async ({ page, browserName, baseURL }) => {
    const problems = watchPage(page, baseURL ?? '');
    const email = `learner-${browserName}-${Date.now()}@example.org`;
    await login(page, ADMIN.email, ADMIN.password);
    await page.getByRole('link', { name: 'Nutzer' }).click();
    await page.getByRole('button', { name: 'Neuer Nutzer …' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(`Learner ${browserName}`);
    await dialog.getByLabel('E-Mail').fill(email);
    await dialog.getByLabel('Vorläufiges Passwort').fill('temporary password 1');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('rowheader', { name: `Learner ${browserName}` })).toBeVisible();

    await page.getByRole('button', { name: 'Datei' }).click();
    await page.getByRole('menuitem', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel('E-Mail').fill(email);
    await page.getByLabel('Passwort').fill('temporary password 1');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByRole('heading', { name: 'Neues Passwort festlegen' })).toBeVisible();
    await page.getByLabel('Aktuelles Passwort').fill('temporary password 1');
    await page.getByRole('textbox', { name: 'Neues Passwort' }).fill('my own password 123');
    await page.getByLabel('Wiederholen').fill('my own password 123');
    await page.getByRole('button', { name: 'Passwort ändern' }).click();
    await expect(page.getByRole('heading', { name: 'Meine Kurse' })).toBeVisible();
    // Learners see no administration.
    await expect(page.getByRole('link', { name: 'Nutzer' })).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('administration pages render without errors; ? opens the shortcut list', async ({ page, baseURL }) => {
    const problems = watchPage(page, baseURL ?? '');
    await login(page, ADMIN.email, ADMIN.password);
    for (const [link, heading] of [
      ['Gruppen', 'Gruppen'],
      ['Audit-Log', 'Audit-Log'],
      ['Nutzer', 'Nutzer'],
    ] as const) {
      await page.getByRole('link', { name: link }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Datei' }).click();
    await page.getByRole('menuitem', { name: 'Konto …' }).click();
    await expect(page.getByRole('heading', { name: 'Konto' })).toBeVisible();
    await page.locator('body').press('?');
    await expect(page.getByRole('dialog', { name: 'Tastenkürzel' })).toBeVisible();
    expect(problems).toEqual([]);
  });
});
