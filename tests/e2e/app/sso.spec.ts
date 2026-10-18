// SPDX-License-Identifier: Apache-2.0
// Single sign-on in the UI. The provider points at a closed loopback port, so
// the test covers configuration, the sign-in button and the error path without
// any network; the full flow runs in tests/integration/sso.test.ts.
import { expect, test } from '@playwright/test';
import { ADMIN, login, watchPage } from '../support.js';

test('administrator sets up a provider; the login page offers it and shows why a sign-in failed', async ({
  page,
  baseURL,
  browserName,
}) => {
  const problems = watchPage(page, baseURL ?? '');
  const name = `Firmen-Login ${browserName} ${Date.now()}`;
  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('link', { name: 'Single Sign-on' }).click();
  await page.getByRole('button', { name: 'Neuer Anbieter …' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Aussteller (Issuer-URL)').fill('http://127.0.0.1:9');
  await form.getByLabel('Client-ID').fill('coursecraft');
  await form.getByRole('textbox', { name: 'Client-Geheimnis' }).fill('sso-secret-5555');
  await form.getByRole('button', { name: 'Speichern' }).click();
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  expect(await page.content()).not.toContain('sso-secret');

  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('link', { name: `Anmelden mit ${name}` }).click();
  await expect(page).toHaveURL(/\/login\?sso_error=failed/);
  await expect(page.getByText('Die Anmeldung beim Anbieter ist fehlgeschlagen.')).toBeVisible();

  // Clean up so later tests see an ordinary login page.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/sso');
  await page.getByRole('row', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: 'Löschen' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  expect(problems.filter((p) => !p.includes('401'))).toEqual([]);
});

test('a directory provider adds a sign-in method to the login page without changing the default', async ({
  page,
  baseURL,
  browserName,
}) => {
  const problems = watchPage(page, baseURL ?? '');
  const name = `Verzeichnis ${browserName} ${Date.now()}`;
  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('link', { name: 'Single Sign-on' }).click();
  await page.getByRole('button', { name: 'Neuer Anbieter …' }).click();
  const form = page.getByRole('dialog');
  // The select is a React Aria listbox.
  await form.getByRole('button', { name: /Protokoll/ }).click();
  await page.getByRole('option', { name: 'LDAP / Active Directory' }).click();
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Server-Adresse').fill('ldaps://127.0.0.1:9');
  await form.getByLabel('Suchbasis').fill('DC=example,DC=org');
  await form.getByRole('textbox', { name: 'Passwort des Dienstkontos' }).fill('bind-secret-7777');
  await form.getByLabel('Gruppen und Rollen').fill('CN=Trainer,DC=example,DC=org => trainer');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
  expect(await page.content()).not.toContain('bind-secret');

  await page.context().clearCookies();
  await page.goto('/login');
  await expect(page.getByLabel('E-Mail')).toBeVisible();
  await page.getByRole('button', { name: /Anmelden bei/ }).click();
  await page.getByRole('option', { name }).click();
  await page.getByLabel('Benutzername').fill('m.muster');
  await page.getByRole('textbox', { name: 'Passwort', exact: true }).fill('irgendwas');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('falsch');

  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/sso');
  await page.getByRole('row', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: 'Löschen' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  expect(problems.filter((p) => !p.includes('401'))).toEqual([]);
});

test('a Windows sign-in provider adds a link to the protected proxy path', async ({
  page,
  baseURL,
  browserName,
}) => {
  const problems = watchPage(page, baseURL ?? '');
  const name = `Windows ${browserName} ${Date.now()}`;
  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('link', { name: 'Single Sign-on' }).click();
  await page.getByRole('button', { name: 'Neuer Anbieter …' }).click();
  const form = page.getByRole('dialog');
  await form.getByRole('button', { name: /Protokoll/ }).click();
  await page.getByRole('option', { name: 'Windows-Anmeldung (Reverse-Proxy)' }).click();
  await form.getByLabel('Name', { exact: true }).fill(name);
  await form.getByLabel('Vertrauenswürdige Proxys').fill('10.0.0.5\n192.168.0.0/16');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();

  await page.context().clearCookies();
  await page.goto('/login');
  await expect(page.getByRole('link', { name: `Anmelden mit ${name}` })).toHaveAttribute(
    'href',
    /^\/api\/auth\/proxy\/[0-9a-f-]{36}\/login$/,
  );
  // Reached directly, without the proxy: refused with a reason, never signed in.
  await page.getByRole('link', { name: `Anmelden mit ${name}` }).click();
  await expect(page).toHaveURL(/\/login\?sso_error=denied/);

  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/sso');
  await page.getByRole('row', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: 'Löschen' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  expect(problems.filter((p) => !p.includes('401'))).toEqual([]);
});
