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
