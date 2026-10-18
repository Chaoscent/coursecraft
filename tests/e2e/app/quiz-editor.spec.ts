// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { ADMIN, login, watchPage } from '../support.js';

test('author builds a quiz with several question types and previews it', async ({
  page,
  browserName,
  baseURL,
}, testInfo) => {
  const problems = watchPage(page, baseURL ?? '');
  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('link', { name: 'Kurse', exact: true }).click();
  await page.getByRole('button', { name: 'Neuer Kurs …' }).click();
  await page.getByRole('dialog').getByLabel('Titel').fill(`Quiz ${browserName} ${Date.now()}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByText('Folie 1 von 1')).toBeVisible();

  await page.getByRole('button', { name: 'Neues Quiz' }).click();
  await expect(page.getByRole('region', { name: 'Fragen' })).toBeVisible();

  // First question (single choice): prompt and correct answer.
  const prompt = page.getByRole('textbox', { name: 'Fragetext' });
  await prompt.fill('Welche Nummer ist der Notruf?');
  await page.getByRole('textbox', { name: 'Text von Antwort 1' }).fill('112');
  await page.getByRole('textbox', { name: 'Text von Antwort 2' }).fill('110');
  await page.getByRole('textbox', { name: 'Text von Antwort 3' }).fill('115');

  // Add a fill-in question with a blank.
  await page.getByRole('button', { name: 'Frage hinzufügen' }).click();
  await page.getByRole('menuitem', { name: 'Lückentext (Eingabe)' }).click();
  await page.getByRole('textbox', { name: 'Text mit Lücken' }).fill('Sammelplatz ist der {{b1}}.');
  await page.getByRole('textbox', { name: 'Akzeptierte Antworten' }).fill('Parkplatz');

  // Add a sequence question.
  await page.getByRole('button', { name: 'Frage hinzufügen' }).click();
  await page.getByRole('menuitem', { name: 'Reihenfolge' }).click();
  await expect(page.getByRole('textbox', { name: 'Element 3' })).toBeVisible();

  await page.getByRole('button', { name: /Welche Nummer/ }).click();
  await page.screenshot({ path: testInfo.outputPath('quiz-editor.png') });

  // Quiz settings in the properties panel.
  await page.getByRole('spinbutton', { name: 'Bestehensgrenze (%)' }).fill('50');

  // Completion rule: quiz passed.
  await page.getByRole('button', { name: 'Datei' }).click();
  await page.getByRole('menuitem', { name: 'Kurseinstellungen …' }).click();
  const settings = page.getByRole('dialog');
  await settings.getByRole('button', { name: /Abschluss/ }).click();
  await page.getByRole('option', { name: /Quiz bestanden/ }).click();
  await settings.getByRole('button', { name: 'Schließen' }).last().click();

  const saved = page.waitForResponse((r) => r.url().endsWith('/save') && r.status() === 200);
  await saved;
  await expect(page.getByRole('status').filter({ hasText: /^Gespeichert/ })).toBeVisible({ timeout: 10_000 });

  // Preview: answer the first two questions.
  await page.locator('body').press('F5');
  const preview = page.getByRole('dialog', { name: 'Vorschau' });
  await preview.getByRole('button', { name: 'Weiter' }).click();
  await preview.getByRole('button', { name: 'Quiz starten' }).click();
  await preview.getByRole('radio', { name: '112' }).check();
  await page.screenshot({ path: testInfo.outputPath('quiz-player.png') });
  await preview.getByRole('button', { name: 'Antworten' }).click();
  await expect(preview.getByText('Richtig.')).toBeVisible();
  await preview.getByRole('button', { name: 'Nächste Frage' }).click();
  await preview.getByRole('textbox', { name: 'Lücke 1' }).fill('parkplatz');
  await preview.getByRole('button', { name: 'Antworten' }).click();
  await expect(preview.getByText('Richtig.')).toBeVisible();
  await preview.getByRole('button', { name: 'Schließen' }).click();

  await page.reload();
  await page.getByRole('button', { name: /^2 / }).click();
  await expect(page.getByRole('region', { name: 'Fragen' }).getByRole('button')).toContainText([
    'Welche Nummer ist der Notruf?',
  ]);
  expect(problems).toEqual([]);
});
