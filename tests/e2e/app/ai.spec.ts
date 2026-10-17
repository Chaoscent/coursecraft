// SPDX-License-Identifier: Apache-2.0
// Phase 7: the optional AI adapter. The E2E stack has no AI service: the
// provider points at a closed loopback port, so the test checks the
// configuration, the exact preview and the error path without any egress.
import { expect, test } from '@playwright/test';
import { ADMIN, login, watchPage } from '../support.js';

test.beforeEach(({ browserName, baseURL }) => {
  test.skip(
    browserName === 'webkit' && !!baseURL?.startsWith('http://'),
    'WebKit needs HTTPS for secure cookies on localhost',
  );
});

test('admin sets up a provider; an author reviews the exact request before sending', async ({
  page,
  baseURL,
  browserName,
}, testInfo) => {
  test.setTimeout(90_000);
  const problems = watchPage(page, baseURL ?? '');
  const name = `Lokales Modell ${browserName} ${Date.now()}`;
  await login(page, ADMIN.email, ADMIN.password);

  await page.getByRole('link', { name: 'KI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'KI-Anbieter' })).toBeVisible();
  await page.getByRole('button', { name: 'Neuer Anbieter …' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Basis-URL').fill('http://127.0.0.1:9/v1');
  await form.getByLabel('Modell').fill('e2e-model');
  await form.getByLabel('API-Schlüssel').fill('sk-e2e-secret-4321');
  await form.getByRole('button', { name: 'Speichern' }).click();
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('•••• 4321');
  await expect(page.getByText('sk-e2e-secret')).toHaveCount(0);

  // Author side: a new course, the title text selected.
  await page.getByRole('link', { name: 'Kurse', exact: true }).click();
  await page.getByRole('button', { name: 'Neuer Kurs …' }).click();
  await page.getByRole('dialog').getByLabel('Titel').fill(`KI ${browserName} ${Date.now()}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();
  await page.getByRole('list', { name: 'Objekte' }).getByRole('button').first().click();

  await page.getByRole('button', { name: 'KI-Assistent' }).click();
  const assistant = page.getByRole('dialog', { name: 'KI-Assistent' });
  await assistant.getByRole('button', { name: /Anbieter$/ }).click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await assistant.getByLabel('Ausgangstext').fill('Brandschutz ist Teamarbeit.');
  await assistant.getByRole('button', { name: 'Anfrage ansehen …' }).click();

  await expect(assistant.getByText('http://127.0.0.1:9/v1/chat/completions')).toBeVisible();
  const body = assistant.getByRole('textbox', { name: 'Anfrage (JSON)' });
  await expect(body).toHaveValue(/"model": "e2e-model"/);
  await expect(body).toHaveValue(/Brandschutz ist Teamarbeit\./);
  expect(await body.inputValue()).not.toContain('sk-e2e');
  await page.screenshot({ path: testInfo.outputPath('ai-preview.png') });

  await assistant.getByRole('button', { name: 'Senden' }).click();
  await expect(
    assistant.getByText('Der KI-Dienst hat nicht oder nicht verwertbar geantwortet.'),
  ).toBeVisible();
  await assistant.getByRole('button', { name: 'Abbrechen' }).click();

  // The audit log records the attempt with metadata only.
  await page.goto('/admin/audit');
  await expect(page.getByRole('grid').getByText('ai.request').first()).toBeVisible();
  // The expected 502 from the unreachable provider (Chromium logs it without the URL).
  expect(problems.filter((p) => !p.includes('/api/ai/run') && !p.includes('status of 502'))).toEqual([]);
});
