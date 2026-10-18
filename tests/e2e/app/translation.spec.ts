// SPDX-License-Identifier: Apache-2.0
// XLIFF round trip in the editor: export, translate outside, import.
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { ADMIN, login, watchPage } from '../support.js';

test('author exports XLIFF, a translator fills the targets, the import adds the language', async ({
  page,
  baseURL,
  browserName,
}) => {
  const problems = watchPage(page, baseURL ?? '');
  const title = `Übersetzung ${browserName} ${Date.now()}`;
  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('link', { name: 'Kurse', exact: true }).click();
  await page.getByRole('button', { name: 'Neuer Kurs …' }).click();
  await page.getByRole('dialog').getByLabel('Titel').fill(title);
  await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();

  await page.getByRole('button', { name: 'Datei', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Übersetzung (XLIFF) …' }).click();
  const dialog = page.getByRole('dialog', { name: 'Übersetzung' });
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'XLIFF exportieren' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.de-en\.xlf$/);
  const xml = await readFile((await download.path()) ?? '', 'utf8');
  expect(xml).toContain('<xliff');
  expect(xml).toContain('srcLang="de"');
  expect(xml).toContain(title);

  // The "translator": every plain source gets a target.
  const translated = xml.replace(/<source>([^<]*)<\/source>/g, '<source>$1</source><target>EN $1</target>');
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Übersetzte Datei importieren …' }).click();
  await (
    await chooser
  ).setFiles({ name: 'kurs.en.xlf', mimeType: 'application/xml', buffer: Buffer.from(translated) });
  await expect(dialog.getByText(/Sprache „en“: \d+ Texte übernommen/)).toBeVisible();

  const saved = await page.waitForResponse((r) => r.url().endsWith('/save') && r.status() === 200);
  expect(saved.ok()).toBe(true);
  await dialog.getByRole('button', { name: 'Schließen' }).last().click();
  const courseId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  const doc = (await (await page.request.get(`/api/courses/${courseId}`)).json()) as {
    course: { languages: { available: string[] }; meta: { title: Record<string, string> } };
  };
  expect(doc.course.languages.available).toEqual(['de', 'en']);
  expect(doc.course.meta.title['en']).toBe(`EN ${title}`);

  // A file that is not XLIFF is refused without changes.
  const again = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Datei', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Übersetzung (XLIFF) …' }).click();
  await dialog.getByRole('button', { name: 'Übersetzte Datei importieren …' }).click();
  await (
    await again
  ).setFiles({
    name: 'evil.xlf',
    mimeType: 'application/xml',
    buffer: Buffer.from('<html><script>x</script></html>'),
  });
  await expect(dialog.getByText('Das ist keine lesbare XLIFF-Datei.')).toBeVisible();
  expect(problems).toEqual([]);
});
