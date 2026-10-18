// SPDX-License-Identifier: Apache-2.0
// The operator console of the E2E stack (compose profile "operator").
import { expect, test } from '@playwright/test';

const URL = process.env['E2E_OPERATOR_URL'] ?? '';
const PASSWORD = process.env['E2E_OPERATOR_PASSWORD'] ?? '';

test.beforeEach(({ browserName }) => {
  test.skip(!URL || !PASSWORD, 'Needs the operator console of the E2E stack');
  // One browser is enough: the console is a small page of the same design system.
  test.skip(browserName !== 'chromium', 'Chromium only');
});

test('the operator signs in, adds an organisation, switches it off and deletes it', async ({ page }) => {
  const name = `Firma ${Date.now()}`;
  const host = `f${Date.now()}`;
  await page.goto(URL);
  await page.getByLabel('Passwort').fill('wrong password');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Organisationen' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Standard/ })).toBeVisible();

  await page.getByRole('button', { name: 'Neue Organisation …' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Adresse', { exact: true }).fill(`https://${host}.courses.test`);
  await form.getByLabel('Adresse für Kurse').fill(`https://${host}.content.test`);
  await form.getByLabel('Höchstens Benutzer').fill('25');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog', { name: 'Setup-Token' })).toContainText(
    `https://${host}.courses.test/setup`,
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).last().click();

  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('0 / 25');
  await row.click();
  await page.getByRole('button', { name: 'Abschalten' }).click();
  await expect(row).toContainText('abgeschaltet');
  await page.getByRole('button', { name: 'Löschen …' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Endgültig löschen' })).toBeDisabled();
  await dialog.getByLabel('Name zur Bestätigung').fill(name);
  await dialog.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page.getByRole('heading', { name: 'Betreiber-Anmeldung' })).toBeVisible();
});
