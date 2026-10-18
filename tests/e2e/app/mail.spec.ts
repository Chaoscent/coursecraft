// SPDX-License-Identifier: Apache-2.0
// Password reset page and SMTP settings page. The E2E stack has no mail
// server: the settings are saved but never used.
import { expect, test } from '@playwright/test';
import { ADMIN, login, watchPage } from '../support.js';

test('the reset page answers the same for any address; an administrator saves SMTP settings', async ({
  page,
  baseURL,
}) => {
  const problems = watchPage(page, baseURL ?? '');
  await page.goto('/login');
  await page.getByRole('link', { name: 'Passwort vergessen?' }).click();
  await page.getByLabel('E-Mail').fill('niemand@example.org');
  await page.getByRole('button', { name: 'Link senden' }).click();
  await expect(
    page.getByText('Wenn ein Konto zu dieser Adresse existiert, ist ein Link unterwegs.'),
  ).toBeVisible();

  // A link with a token shows the password form and keeps the token out of the address sent to the server.
  // Settled first: WebKit reports requests cut off by a navigation as page errors.
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.goto('/reset-password#' + 'x'.repeat(43));
  await expect(page.getByRole('heading', { name: 'Neues Passwort festlegen' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Neues Passwort', exact: true }).fill('a long new password');
  await page.getByRole('textbox', { name: 'Wiederholen' }).fill('a long new password');
  await page.getByRole('button', { name: 'Passwort speichern' }).click();
  await expect(page.getByRole('alert')).toContainText('Die Eingaben sind unvollständig oder ungültig.');

  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('link', { name: 'E-Mail', exact: true }).click();
  await page.getByLabel('Server').fill('mail.example.org');
  await page.getByLabel('Absender').fill('Coursecraft <noreply@example.org>');
  await page.getByRole('textbox', { name: 'Passwort', exact: true }).fill('smtp-pass');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Gespeichert.')).toBeVisible();
  await expect(page.getByText('Gespeichert. Leer lassen, um es zu behalten.')).toBeVisible();
  expect(await page.content()).not.toContain('smtp-pass');
  expect(problems.filter((p) => !p.includes('400'))).toEqual([]);
});
