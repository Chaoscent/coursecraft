// SPDX-License-Identifier: Apache-2.0
// Learning path in the UI: build it, assign it, the learner sees the second
// course locked until the first one is done.
import { expect, test } from '@playwright/test';
import { scorm12Package } from '../../support/packages.js';
import { ADMIN, login, watchPage } from '../support.js';

const CONTENT = process.env['E2E_CONTENT_URL'] ?? '';

test.beforeEach(({ browserName, baseURL }) => {
  test.skip(
    browserName === 'webkit' && !!baseURL?.startsWith('http://'),
    'WebKit needs HTTPS for secure cookies on localhost',
  );
  test.skip(!CONTENT, 'Needs the content origin of the E2E stack');
});

test('administrator builds and assigns a path; the learner finds the later course locked', async ({
  page,
  baseURL,
  browserName,
}) => {
  test.setTimeout(120_000);
  const tag = `${browserName}-${Date.now()}`;
  const problems = watchPage(page, baseURL ?? '', CONTENT);
  await login(page, ADMIN.email, ADMIN.password);
  const csrf = (await (await page.request.get('/api/session')).json()) as { session: { csrfToken: string } };
  const headers = { origin: baseURL ?? '', 'x-csrf-token': csrf.session.csrfToken };
  const upload = async (title: string) => {
    const res = await page.request.post('/api/library/import', {
      headers,
      multipart: {
        file: { name: 'p.zip', mimeType: 'application/zip', buffer: await scorm12Package({ title }) },
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
  };
  await upload(`Erster ${tag}`);
  await upload(`Zweiter ${tag}`);
  const learner = { email: `path-${tag}@example.org`, password: 'learner password e2e', name: `Pia ${tag}` };
  const created = await page.request.post('/api/users', {
    headers,
    data: {
      email: learner.email,
      displayName: learner.name,
      password: learner.password,
      roles: ['learner'],
      locale: 'de',
    },
  });
  expect(created.ok(), await created.text()).toBe(true);

  await page.getByRole('link', { name: 'Lernpfade' }).click();
  await page.getByRole('button', { name: 'Neuer Pfad …' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Name').fill(`Pfad ${tag}`);
  await form.getByRole('button', { name: `„Erster ${tag}“ hinzufügen` }).click();
  await form.getByRole('button', { name: `„Zweiter ${tag}“ hinzufügen` }).click();
  await expect(form.getByRole('list', { name: 'Kurse' })).toContainText(`1. Erster ${tag}`);
  await form.getByRole('button', { name: 'Speichern' }).click();
  const row = page.getByRole('row', { name: new RegExp(`Pfad ${tag}`) });
  await expect(row).toContainText('Der Reihe nach');
  await row.click();
  await page.getByRole('button', { name: 'Zuweisen …' }).click();
  const assign = page.getByRole('dialog');
  await assign.getByLabel('Person suchen').fill(learner.name.slice(0, 6));
  // React Aria hides the native input; the label is what people click.
  await assign.locator('label', { hasText: learner.email }).click();
  await assign.getByRole('button', { name: 'Zuweisen', exact: true }).click();
  await expect(assign.getByRole('grid', { name: 'Bestehende Zuweisungen' })).toContainText(learner.name);
  await assign.getByRole('button', { name: 'Schließen', exact: true }).last().click();
  expect(problems).toEqual([]);

  // The learner sees the path position and cannot start the second course yet.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(learner.email);
  await page.getByLabel('Passwort').fill(learner.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.getByLabel('Aktuelles Passwort').fill(learner.password);
  await page.getByRole('textbox', { name: 'Neues Passwort', exact: true }).fill('learner own password');
  await page.getByLabel('Wiederholen').fill('learner own password');
  await page.getByRole('button', { name: 'Passwort ändern' }).click();
  const table = page.getByRole('grid', { name: 'Meine Kurse' });
  await expect(table).toContainText(`Pfad „Pfad ${tag}“, Schritt 1 von 2`);
  const first = page.getByRole('row', { name: new RegExp(`Erster ${tag}`) });
  const second = page.getByRole('row', { name: new RegExp(`Zweiter ${tag}`) });
  await expect(first.getByRole('button', { name: 'Starten' })).toBeEnabled();
  await expect(second.getByRole('button', { name: 'Starten' })).toBeDisabled();
  await expect(second).toContainText('Gesperrt');
});
