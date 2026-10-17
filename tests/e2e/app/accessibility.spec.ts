// SPDX-License-Identifier: Apache-2.0
// Automated accessibility audit (axe-core, WCAG 2.1 A/AA) of the main screens in
// the light and dark theme. Automated checks find about a third of the
// problems; keyboard and screen reader behaviour is covered by the other specs.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, login } from '../support.js';

test.beforeEach(({ browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'One engine is enough for the rule checks');
  test.skip(!!baseURL && !baseURL.startsWith('http'), 'needs the stack');
});

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: Page, label: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.passes.length, `${label}: rules actually ran`).toBeGreaterThan(10);
    const summary = results.violations.map(
      (v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`,
    );
    expect(summary, `${label} (${scheme})`).toEqual([]);
  }
}

test('login, reset and setup-free public pages', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  await audit(page, 'login');
  await page.goto('/reset-password');
  await expect(page.getByRole('heading', { name: 'Passwort vergessen' })).toBeVisible();
  await audit(page, 'reset request');
});

test('administration and management pages', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, ADMIN.email, ADMIN.password);
  const pages: string[] = [
    '/',
    '/account',
    '/author',
    '/library',
    '/paths',
    '/grading',
    '/admin/users',
    '/admin/groups',
    '/admin/audit',
    '/admin/sso',
    '/admin/mail',
    '/admin/ai',
  ];
  for (const path of pages) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first(), path).toBeVisible();
    await audit(page, path);
  }
});

test('editor, quiz editor, dialogs and the preview', async ({ page, browserName }) => {
  test.setTimeout(180_000);
  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('link', { name: 'Kurse', exact: true }).click();
  await page.getByRole('button', { name: 'Neuer Kurs …' }).click();
  await page.getByRole('dialog').getByLabel('Titel').fill(`A11y ${browserName} ${Date.now()}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Folie 1 von 1')).toBeVisible();
  await audit(page, 'slide editor');

  for (const tab of ['Einfügen', 'Ansicht']) {
    await page.getByRole('tab', { name: tab }).click();
    await audit(page, `ribbon ${tab}`);
  }
  await page.getByRole('tab', { name: 'Start' }).click();

  for (const [button, check] of [
    ['Neue Interaktion', 'Darstellung'],
    ['Neues Quiz', 'Fragen'],
    ['Neue Umfrage', 'Titel'],
  ] as const) {
    await page.getByRole('button', { name: button }).click();
    await expect(page.getByLabel(check).first()).toBeVisible();
    await audit(page, button);
  }

  await page.getByRole('button', { name: 'Datei', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Kurseinstellungen …' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await audit(page, 'settings dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).last().click();

  await page.locator('body').press('F5');
  await expect(page.getByRole('dialog', { name: 'Vorschau' })).toBeVisible();
  await audit(page, 'preview');
  // The nodes added above: interaction, then quiz.
  const preview = page.getByRole('dialog', { name: 'Vorschau' });
  await preview.getByRole('button', { name: 'Weiter', exact: true }).last().click();
  await expect(preview.getByRole('button', { name: /Eintrag 1/ })).toBeVisible();
  await audit(page, 'preview: interaction');
  await preview.getByRole('button', { name: 'Weiter', exact: true }).last().click();
  await expect(preview.getByRole('button', { name: 'Quiz starten' })).toBeVisible();
  await audit(page, 'preview: quiz start');
  await preview.getByRole('button', { name: 'Quiz starten' }).click();
  await audit(page, 'preview: question');
});

test('the audit itself finds missing labels, low contrast and missing alternatives', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => {
    const bad = document.createElement('div');
    const input = document.createElement('input');
    const img = document.createElement('img');
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const text = document.createElement('p');
    text.textContent = 'Hard to read';
    text.style.color = '#cccccc';
    text.style.background = '#ffffff';
    bad.append(input, img, text);
    document.body.append(bad);
  });
  const ids = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id);
  expect(ids).toEqual(expect.arrayContaining(['label', 'image-alt', 'color-contrast']));
});
