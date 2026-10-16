// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { ADMIN, watchPage } from './support.js';

test('first start: setup wizard creates the administrator', async ({ page, baseURL }) => {
  const problems = watchPage(page, baseURL ?? '');
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel('Setup-Token').fill(process.env['E2E_SETUP_TOKEN'] ?? '');
  await page.getByLabel('Name').fill(ADMIN.name);
  await page.getByLabel('E-Mail').fill(ADMIN.email);
  await page.getByLabel('Passwort', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Wiederholen').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Konto anlegen' }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole('heading', { name: 'Nutzer' })).toBeVisible();
  expect(problems).toEqual([]);
});
