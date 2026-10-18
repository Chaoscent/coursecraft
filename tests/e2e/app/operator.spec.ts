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
  await form.getByLabel('Kontaktperson').fill('Dora Dietrich');
  await form.getByLabel('Tarif').fill('Business');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog', { name: 'Setup-Token' })).toContainText(
    `https://${host}.courses.test/setup`,
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Schließen' }).last().click();

  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('0 / 25');
  await row.click();
  const side = page.getByRole('complementary', { name: 'Details' });
  await expect(side).toContainText('Dora Dietrich');
  await expect(side).toContainText('Business');
  await expect(side).toContainText('Noch kein Administrator');
  await page.getByRole('button', { name: 'Abschalten' }).click();
  await expect(row).toContainText('abgeschaltet');
  await page.getByRole('button', { name: 'Löschen …' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Endgültig löschen' })).toBeDisabled();
  await dialog.getByLabel('Name zur Bestätigung').fill(name);
  await dialog.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  await page.getByRole('button', { name: 'Installation' }).click();
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
  await expect(page.getByText('Eine Organisation')).toBeVisible();
  await page.getByRole('button', { name: 'Protokoll' }).click();
  await expect(
    page.getByRole('row').filter({ hasText: 'Organisation gelöscht' }).filter({ hasText: name }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page.getByRole('heading', { name: 'Betreiber-Anmeldung' })).toBeVisible();
});

test('the operator prepares plans while billing is switched off', async ({ page }) => {
  const plan = `Tarif ${Date.now()}`;
  await page.goto(URL);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.getByRole('row', { name: /Standard/ }).click();
  const side = page.getByRole('complementary', { name: 'Details' });
  await expect(side).toContainText('nicht über Stripe');
  await expect(side).toContainText('Abrechnung über Stripe ist ausgeschaltet');
  await expect(side.getByRole('button', { name: 'Zahlungslink …' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Tarife' }).click();
  await expect(page.getByRole('heading', { name: 'Tarife' })).toBeVisible();
  await expect(page.getByText('COURSECRAFT_STRIPE_SECRET_KEY')).toBeVisible();
  await page.getByRole('button', { name: 'Neuer Tarif …' }).click();
  let form = page.getByRole('dialog');
  await form.getByLabel('Name', { exact: true }).fill(plan);
  await form.getByLabel('Stripe-Preis-ID').fill('not a price');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await form.getByLabel('Stripe-Preis-ID').fill(`price_e2e${Date.now()}`);
  await form.getByLabel('Höchstens Benutzer').fill('10');
  await form.getByRole('button', { name: 'Speichern' }).click();
  const row = page.getByRole('row', { name: new RegExp(plan) });
  await expect(row).toContainText('unbegrenzt');
  await row.click();
  await page.getByRole('button', { name: 'Tarif bearbeiten …' }).click();
  form = page.getByRole('dialog');
  await form.getByLabel('Höchstens Speicher (MB)').fill('2048');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(row).toContainText('2 GB');
  await page.getByRole('button', { name: 'Tarif löschen' }).click();
  await expect(page.getByRole('row', { name: new RegExp(plan) })).toHaveCount(0);
  await page.getByRole('button', { name: 'Protokoll' }).click();
  await expect(
    page.getByRole('row').filter({ hasText: 'Tarif angelegt' }).filter({ hasText: plan }),
  ).toBeVisible();
});
