// SPDX-License-Identifier: Apache-2.0
// LMS end to end: publish an own course, import a SCORM package, assign both,
// learn as a learner on the content origin, check the report.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { scorm12Package } from '../../support/packages.js';
import { createCourse } from '../support-export.js';
import { ADMIN, login, watchPage } from '../support.js';

const CONTENT = process.env['E2E_CONTENT_URL'] ?? '';

test.beforeEach(() => {
  test.skip(!CONTENT, 'Needs the content origin of the E2E stack');
});

async function prepare(request: APIRequestContext, baseURL: string, tag: string) {
  const { id: courseId, headers } = await createCourse(
    request,
    baseURL,
    ADMIN.email,
    ADMIN.password,
    `Brandschutz ${tag}`,
    true,
  );
  const published = await request.post('/api/library/publish', { headers, data: { courseId } });
  expect(published.ok(), await published.text()).toBe(true);
  const ownItem = ((await published.json()) as { id: string }).id;

  const imported = await request.post('/api/library/import', {
    headers,
    multipart: {
      file: {
        name: 'scorm.zip',
        mimeType: 'application/zip',
        buffer: await scorm12Package({ title: `SCORM ${tag}` }),
      },
    },
  });
  expect(imported.ok(), await imported.text()).toBe(true);
  const scormItem = ((await imported.json()) as { id: string }).id;

  const learner = {
    email: `learner-${tag}@example.org`,
    password: 'learner password e2e',
    name: `Lea ${tag}`,
  };
  const user = await request.post('/api/users', {
    headers,
    data: {
      email: learner.email,
      displayName: learner.name,
      password: learner.password,
      roles: ['learner'],
      locale: 'de',
    },
  });
  expect(user.ok(), await user.text()).toBe(true);
  const userId = ((await user.json()) as { id: string }).id;
  for (const item of [ownItem, scormItem]) {
    const assigned = await request.post(`/api/library/${item}/assignments`, {
      headers,
      data: { userIds: [userId], dueAt: '2099-12-31T22:59:00Z' },
    });
    expect(assigned.ok(), await assigned.text()).toBe(true);
  }
  return { ownItem, scormItem, learner };
}

test('learner completes an own course (cmi5) and a SCORM package; trainer sees the report', async ({
  page,
  request,
  baseURL,
  browserName,
}) => {
  test.setTimeout(120_000);
  const tag = `${browserName}-${Date.now()}`;
  const { ownItem, scormItem, learner } = await prepare(request, baseURL ?? '', tag);
  const problems = watchPage(page, baseURL ?? '', CONTENT);

  // New accounts start with a temporary password.
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(learner.email);
  await page.getByLabel('Passwort').fill(learner.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.getByLabel('Aktuelles Passwort').fill(learner.password);
  await page.getByRole('textbox', { name: 'Neues Passwort', exact: true }).fill('learner own password');
  await page.getByLabel('Wiederholen').fill('learner own password');
  await page.getByRole('button', { name: 'Passwort ändern' }).click();
  await expect(page.getByRole('navigation', { name: 'Hauptmenü' })).toBeVisible();
  const table = page.getByRole('grid', { name: 'Meine Kurse' });
  await expect(table).toContainText(`Brandschutz ${tag}`);
  await expect(table).toContainText(`SCORM ${tag}`);

  // Own course: runs on the content origin, reports through the built-in LRS.
  await page
    .getByRole('row', { name: new RegExp(`Brandschutz ${tag}`) })
    .getByRole('button', { name: 'Starten' })
    .click();
  const course = page.frameLocator(`iframe[title="Brandschutz ${tag}"]`);
  await course.getByRole('button', { name: 'Weiter' }).click();
  await course.getByRole('button', { name: 'Weiter' }).click();
  await course.getByRole('button', { name: 'Quiz starten' }).click();
  await course.getByRole('radio', { name: '112' }).check();
  await course.getByRole('button', { name: 'Antworten' }).click();
  await course.getByRole('button', { name: 'Nächste Frage' }).click();
  await course.getByRole('radio', { name: 'Wahr' }).check();
  await course.getByRole('button', { name: 'Antworten' }).click();
  await course.getByRole('button', { name: 'Nächste Frage' }).click();
  await course.getByRole('textbox', { name: 'Lücke 1' }).fill('Parkplatz');
  await course.getByRole('button', { name: 'Antworten' }).click();
  await course.getByRole('button', { name: 'Nächste Frage' }).click();
  await expect(course.getByText('Bestanden.')).toBeVisible();
  expect(await page.locator('iframe').getAttribute('src')).toMatch(new RegExp(`^${CONTENT}/launch/`));
  await page.getByRole('button', { name: 'Schließen' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Brandschutz ${tag}`) })).toContainText('Bestanden');

  // SCORM package: wrapper on the content origin, data stored through the host page.
  await page
    .getByRole('row', { name: new RegExp(`SCORM ${tag}`) })
    .getByRole('button', { name: 'Starten' })
    .click();
  const sco = page.frameLocator(`iframe[title="SCORM ${tag}"]`).frameLocator('#sco');
  await expect(sco.getByText(`Besuch 1, Lernender ${learner.name}`)).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().endsWith('/scorm') && r.ok());
  await sco.getByRole('button', { name: 'Abschließen' }).click();
  await expect(sco.getByText('Fertig')).toBeVisible();
  await saved;
  await page.getByRole('button', { name: 'Schließen' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`SCORM ${tag}`) })).toContainText('Bestanden');

  // A passed course offers a certificate as PDF.
  const certificate = page.waitForEvent('download');
  await page
    .getByRole('row', { name: new RegExp(`SCORM ${tag}`) })
    .getByRole('button', { name: 'Zertifikat' })
    .click();
  const pdf = await certificate;
  expect(pdf.suggestedFilename()).toMatch(/^CC-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}\.pdf$/);

  // Reopening resumes with the stored suspend data.
  await page
    .getByRole('row', { name: new RegExp(`SCORM ${tag}`) })
    .getByRole('button', { name: 'Ansehen' })
    .click();
  await expect(sco.getByText(/^Besuch 2/)).toBeVisible();
  await page.getByRole('button', { name: 'Schließen' }).click();
  expect(problems).toEqual([]);

  // Report as administrator.
  const report = (await (await request.get(`/api/reports/items/${scormItem}`)).json()) as {
    rows: { displayName: string; status: string; scoreScaled: number; timeSpentMs: number }[];
  };
  expect(report.rows.find((r) => r.displayName === learner.name)).toMatchObject({
    status: 'passed',
    scoreScaled: 0.8,
    timeSpentMs: 150_000,
  });
  const own = (await (await request.get(`/api/reports/items/${ownItem}`)).json()) as {
    rows: { displayName: string; status: string }[];
    questions: { answers: number }[];
  };
  expect(own.rows.find((r) => r.displayName === learner.name)).toMatchObject({ status: 'passed' });
  expect(own.questions).toHaveLength(3);
});

test('administrator assigns and reads reports in the UI', async ({ page, request, baseURL, browserName }) => {
  const tag = `ui-${browserName}-${Date.now()}`;
  const { scormItem } = await prepare(request, baseURL ?? '', tag);
  const problems = watchPage(page, baseURL ?? '');
  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('link', { name: 'Bibliothek' }).click();
  const row = page.getByRole('row', { name: new RegExp(`SCORM ${tag}`) });
  await row.click();
  await page.getByRole('button', { name: 'Zuweisen …' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('grid', { name: 'Bestehende Zuweisungen' })).toContainText(`Lea ${tag}`);
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).last().click();
  await page.getByRole('button', { name: 'Bericht' }).click();
  await expect(page).toHaveURL(new RegExp(`/library/${scormItem}/report$`));
  await expect(page.getByRole('grid', { name: 'Lernende' })).toContainText(`Lea ${tag}`);
  await expect(page.getByRole('grid', { name: 'Lernende' })).toContainText('Nicht begonnen');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV exportieren' }).click();
  expect((await download).suggestedFilename()).toBe('report.csv');
  expect(problems).toEqual([]);
});
