// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { ADMIN, login, watchPage } from '../support.js';

test.describe.configure({ mode: 'serial' });

test.describe('application', () => {
  test('session cookie is hardened and survives a reload', async ({ page, context, baseURL }) => {
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
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
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

    await page.getByRole('navigation', { name: 'Hauptmenü' }).getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel('E-Mail').fill(email);
    await page.getByLabel('Passwort').fill('temporary password 1');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
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
    await page.getByRole('navigation', { name: 'Hauptmenü' }).getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Konto …' }).click();
    await expect(page.getByRole('heading', { name: 'Konto' })).toBeVisible();
    await page.locator('body').press('?');
    await expect(page.getByRole('dialog', { name: 'Tastenkürzel' })).toBeVisible();
    expect(problems).toEqual([]);
  });
});
