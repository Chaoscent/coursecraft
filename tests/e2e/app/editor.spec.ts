// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { ADMIN, login, watchPage } from '../support.js';

test.beforeEach(({ browserName, baseURL }) => {
  test.skip(
    browserName === 'webkit' && !!baseURL?.startsWith('http://'),
    'WebKit needs HTTPS for secure cookies on localhost',
  );
});

test('author creates, edits and saves a course; changes survive a reload', async ({
  page,
  browserName,
  baseURL,
}, testInfo) => {
  const problems = watchPage(page, baseURL ?? '');
  const title = `Editor ${browserName} ${Date.now()}`;
  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('link', { name: 'Kurse', exact: true }).click();
  await page.getByRole('button', { name: 'Neuer Kurs …' }).click();
  await page.getByRole('dialog').getByLabel('Titel').fill(title);
  await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('navigation', { name: 'Hauptmenü' })).toContainText(title);
  await expect(page.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();

  // Insert a text box and type into it.
  await page.getByRole('tab', { name: 'Einfügen' }).click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Textinhalt' });
  await expect(editor).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Hallo aus dem Editor');
  await page.keyboard.press('Escape');

  // Insert a shape and move it with the keyboard.
  await page.getByRole('button', { name: 'Form' }).click();
  await page.getByRole('menuitem', { name: 'Ellipse' }).click();
  const x = page.getByRole('textbox', { name: 'Position X' });
  await expect(x).toHaveValue('320');
  await page.locator('body').press('Shift+ArrowRight');
  await expect(x).toHaveValue('330');
  await page.locator('body').press('ControlOrMeta+z');
  await expect(x).toHaveValue('320');
  await page.locator('body').press('ControlOrMeta+y');
  await expect(x).toHaveValue('330');

  // New slide via ribbon; wait for the save that follows.
  await page.getByRole('tab', { name: 'Start' }).click();
  const saved = page.waitForResponse((r) => r.url().endsWith('/save') && r.status() === 200);
  await page.getByRole('button', { name: 'Neue Folie' }).first().click();
  await expect(page.getByText('Folie 2 von 2')).toBeVisible();
  await saved;
  await expect(page.getByRole('status').filter({ hasText: /^Gespeichert/ })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: testInfo.outputPath('editor.png') });

  await page.reload();
  await expect(page.getByText('Folie 1 von 2')).toBeVisible();
  // Thumbnail and canvas both render the slide.
  await expect(
    page.locator('[data-slide] .lw-el-text').filter({ hasText: 'Hallo aus dem Editor' }),
  ).toHaveCount(2);
  await expect(page.locator('[data-slide] .lw-el-shape')).toHaveCount(2);

  // Preview runs the real player.
  await page.locator('body').press('F5');
  const preview = page.getByRole('dialog', { name: 'Vorschau' });
  await expect(preview.getByText('Hallo aus dem Editor')).toBeVisible();
  await preview.getByRole('button', { name: 'Weiter' }).click();
  await expect(preview.getByText('2 von 2')).toBeVisible();
  await preview.getByRole('button', { name: 'Schließen' }).click();

  // Export dialog downloads a SCORM package.
  await page.getByRole('button', { name: 'Veröffentlichen' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Herunterladen' }).click();
  expect((await download).suggestedFilename()).toMatch(/scorm12\.zip$/);
  expect(problems).toEqual([]);
});

test('a second session sees the course read-only while it is being edited', async ({ browser, baseURL }) => {
  const first = await browser.newPage();
  await login(first, ADMIN.email, ADMIN.password);
  await first.getByRole('link', { name: 'Kurse', exact: true }).click();
  await first.getByRole('button', { name: 'Neuer Kurs …' }).click();
  await first.getByRole('dialog').getByLabel('Titel').fill(`Lock ${Date.now()}`);
  await first.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
  await expect(first.getByText('Folie 1 von 1')).toBeVisible();
  const url = first.url();

  const context = await browser.newContext({ baseURL: baseURL ?? '' });
  const second = await context.newPage();
  await login(second, ADMIN.email, ADMIN.password);
  await second.goto(url);
  await expect(second.getByText(/wird gerade bearbeitet/)).toBeVisible();
  await expect(second.getByText('Nur lesen')).toBeVisible();
  await context.close();
  await first.close();
});
