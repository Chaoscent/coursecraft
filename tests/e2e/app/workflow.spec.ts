// SPDX-License-Identifier: Apache-2.0
// Authoring workflow: learning content is one click away in the ribbon, and
// the usual shortcut adds a slide.
import { expect, test } from '@playwright/test';
import { ADMIN, login, watchPage } from '../support.js';

test.beforeEach(({ browserName, baseURL }) => {
  test.skip(
    browserName === 'webkit' && !!baseURL?.startsWith('http://'),
    'WebKit needs HTTPS for secure cookies on localhost',
  );
});

test('the ribbon offers quiz, survey, interaction and dialog; Ctrl+M adds a slide', async ({
  page,
  baseURL,
  browserName,
}) => {
  const problems = watchPage(page, baseURL ?? '');
  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('link', { name: 'Kurse', exact: true }).click();
  await page.getByRole('button', { name: 'Neuer Kurs …' }).click();
  await page.getByRole('dialog').getByLabel('Titel').fill(`Ablauf ${browserName} ${Date.now()}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Folie 1 von 1')).toBeVisible();

  await page.getByRole('tab', { name: 'Einfügen' }).click();
  const group = page.getByRole('group', { name: 'Lerninhalte' });
  for (const name of ['Quiz', 'Umfrage', 'Interaktion', 'Dialog']) {
    await expect(group.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await group.getByRole('button', { name: 'Quiz', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Fragen' })).toBeVisible();
  await group.getByRole('button', { name: 'Interaktion', exact: true }).click();
  await expect(page.getByLabel('Darstellung')).toBeVisible();

  const slides = page.getByRole('complementary', { name: 'Folien' }).getByRole('listitem');
  const before = await slides.count();
  await page.getByRole('listitem').first().click();
  await page.keyboard.press('Control+m');
  await expect(slides).toHaveCount(before + 1);
  expect(problems).toEqual([]);
});

test('password fields can be revealed with the eye button', async ({ page }) => {
  await page.goto('/login');
  const field = page.getByLabel('Passwort', { exact: true });
  await expect(field).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Anzeigen' }).click();
  await expect(field).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Verbergen' }).click();
  await expect(field).toHaveAttribute('type', 'password');
});

test('an administrator names the trainers of a group', async ({ page, browserName }) => {
  const name = `Team ${browserName} ${Date.now()}`;
  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('link', { name: 'Gruppen' }).click();
  await expect(page.getByText('Alle Trainer sehen alle Lernenden')).toBeVisible();
  await page.getByRole('button', { name: 'Neue Gruppe …' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('row', { name: new RegExp(name) }).click();
  await expect(page.getByRole('complementary', { name: 'Betreut von' })).toBeVisible();
  await expect(page.getByText('Diese Trainer sehen die Lernenden der Gruppe')).toBeVisible();
});
