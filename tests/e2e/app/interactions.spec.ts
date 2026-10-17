// SPDX-License-Identifier: Apache-2.0
// Phase 6: interactions, dialog simulation and screen recording (against the
// real converter in the compose stack).
import { expect, test, type Page } from '@playwright/test';
import { solidPng } from '../../support/png.js';
import { ADMIN, login, watchPage } from '../support.js';

test.beforeEach(({ browserName, baseURL }) => {
  test.skip(
    browserName === 'webkit' && !!baseURL?.startsWith('http://'),
    'WebKit needs HTTPS for secure cookies on localhost',
  );
});

async function newCourse(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: 'Kurse', exact: true }).click();
  await page.getByRole('button', { name: 'Neuer Kurs …' }).click();
  await page.getByRole('dialog').getByLabel('Titel').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();
}

async function waitSaved(page: Page) {
  await page.waitForResponse((r) => r.url().endsWith('/save') && r.status() === 200);
  await expect(page.getByRole('status').filter({ hasText: /^Gespeichert/ })).toBeVisible({ timeout: 10_000 });
}

test('author builds tabs and a branching dialog; the preview plays both', async ({
  page,
  baseURL,
  browserName,
}, testInfo) => {
  test.setTimeout(90_000);
  const problems = watchPage(page, baseURL ?? '');
  await login(page, ADMIN.email, ADMIN.password);
  await newCourse(page, `Interaktionen ${browserName} ${Date.now()}`);

  // Interaction: tabs that must all be opened.
  await page.getByRole('button', { name: 'Neue Interaktion' }).click();
  await page.getByRole('combobox', { name: 'Darstellung' }).selectOption('tabs');
  await page.getByRole('textbox', { name: 'Titel 1' }).fill('Erkennen');
  await page.getByRole('textbox', { name: 'Text 1' }).fill('Brand erkennen und melden.');
  await page.getByRole('textbox', { name: 'Titel 2' }).fill('Retten');
  await page.getByRole('textbox', { name: 'Titel 3' }).fill('Löschen');
  await page.getByText('Alle Einträge müssen geöffnet werden').click();

  // Dialog: needs a portrait first.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Neuer Dialog (Porträt wählen)' }).click();
  await (
    await chooser
  ).setFiles({ name: 'figur.png', mimeType: 'image/png', buffer: solidPng(60, 80, [40, 90, 160]) });
  const scenes = page.getByRole('region', { name: 'Szenen' });
  await expect(scenes).toBeVisible();
  const details = page.getByRole('region', { name: 'Details' });
  await details.getByRole('textbox', { name: 'Aussage' }).fill('Es brennt im Lager!');
  await details.getByRole('textbox', { name: 'Antworttext 1' }).fill('Ich alarmiere die Feuerwehr.');
  await details.getByRole('textbox', { name: 'Antworttext 2' }).fill('Ich warte erst einmal ab.');
  // A follow-up scene for the first response.
  await details.getByRole('button', { name: 'Neue Folgeszene' }).first().click();
  await details.getByRole('textbox', { name: 'Aussage' }).fill('Gut. Und jetzt?');
  await details.getByRole('button', { name: 'Antwort hinzufügen' }).click();
  await details.getByRole('textbox', { name: 'Antworttext 1' }).fill('Gebäude räumen.');
  await details.getByRole('spinbutton', { name: 'Punkte 1' }).fill('2');
  await expect(scenes.getByRole('button', { name: /Gut\. Und jetzt\?/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dialog-editor.png') });
  await waitSaved(page);

  // Preview from the first slide.
  await page.getByRole('button', { name: /^1 / }).first().click();
  await page.locator('body').press('F5');
  const preview = page.getByRole('dialog', { name: 'Vorschau' });
  const next = preview.getByRole('button', { name: 'Weiter', exact: true }).last();
  await next.click();
  await expect(preview.getByRole('tab', { name: 'Erkennen' })).toHaveAttribute('aria-selected', 'true');
  await expect(preview.getByText('Brand erkennen und melden.')).toBeVisible();
  await expect(preview.getByText('Öffnen Sie alle Einträge, um fortzufahren.')).toBeVisible();
  // Free navigation (the default) never blocks, but the node counts as viewed only when all tabs were opened.
  const current = preview.locator('.lw-outline-item[aria-current="step"]');
  await expect(current).not.toHaveClass(/lw-viewed/);
  await preview.getByRole('tab', { name: 'Retten' }).click();
  await preview.getByRole('tab', { name: 'Retten' }).press('ArrowRight');
  await expect(preview.getByRole('tab', { name: 'Löschen' })).toBeFocused();
  await expect(current).toHaveClass(/lw-viewed/);
  await next.click();

  await expect(preview.getByText('Es brennt im Lager!', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Ich alarmiere die Feuerwehr.' }).click();
  await expect(preview.getByText('Gut. Und jetzt?', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Gebäude räumen.' }).click();
  await expect(preview.getByRole('heading', { name: 'Gut gemacht' })).toBeVisible();
  await expect(preview.getByText('3 von 3 Punkten')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dialog-player.png') });
  await preview.getByRole('button', { name: 'Gespräch wiederholen' }).click();
  await preview.getByRole('button', { name: 'Ich warte erst einmal ab.' }).click();
  await expect(preview.getByRole('heading', { name: 'Versuchen Sie es noch einmal' })).toBeVisible();
  await preview.getByRole('button', { name: 'Schließen' }).click();
  expect(problems).toEqual([]);
});

test('author records the screen, trims the clip and inserts it as MP4 + WebM with poster', async ({
  page,
  baseURL,
  browserName,
}) => {
  test.setTimeout(120_000);
  // The test browser has no screen to share: an animated canvas stands in for it.
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const g = canvas.getContext('2d');
      let frame = 0;
      const draw = () => {
        if (!g) return;
        g.fillStyle = `hsl(${(frame += 4) % 360} 70% 50%)`;
        g.fillRect(0, 0, 320, 180);
        requestAnimationFrame(draw);
      };
      draw();
      return Promise.resolve(canvas.captureStream(25));
    };
  });
  const problems = watchPage(page, baseURL ?? '');
  await login(page, ADMIN.email, ADMIN.password);
  await newCourse(page, `Aufnahme ${browserName} ${Date.now()}`);

  await page.getByRole('tab', { name: 'Einfügen' }).click();
  await page.getByRole('button', { name: 'Bildschirm', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Bildschirmaufnahme' });
  await dialog.getByText('Mikrofon aufnehmen').click();
  await dialog.getByRole('button', { name: 'Aufnahme starten' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: /Aufnahme läuft: [2-9]/ })).toBeVisible({
    timeout: 10_000,
  });
  await dialog.getByRole('button', { name: 'Aufnahme beenden' }).click();
  await expect(dialog.getByLabel('Vorschau')).toBeVisible();
  await dialog.getByLabel('Ende (s)').fill('0,5');
  await dialog.getByLabel('Anfang (s)').fill('1');
  await expect(dialog.getByText('Das Ende muss nach dem Anfang')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Einfügen' })).toBeDisabled();
  await dialog.getByLabel('Anfang (s)').fill('0,5');
  await dialog.getByLabel('Ende (s)').fill('1,5');
  await dialog.getByRole('button', { name: 'Einfügen' }).click();
  await expect(dialog).toBeHidden({ timeout: 90_000 });

  // The canvas and the slide thumbnail both render the slide.
  const video = page.locator('.lw-canvas video').first();
  await expect(video).toBeAttached();
  await expect(video).toHaveAttribute('poster', /\/assets\/[0-9a-f]{64}$/);
  const types = await video.locator('source').evaluateAll((s) => s.map((e) => e.getAttribute('type')));
  expect(types).toEqual(['video/webm', 'video/mp4']);
  const duration = await video.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<number>((resolve) => {
        if (v.readyState >= 1) resolve(v.duration);
        else v.addEventListener('loadedmetadata', () => resolve(v.duration), { once: true });
        v.load();
      }),
  );
  expect(duration).toBeGreaterThan(0.6);
  expect(duration).toBeLessThan(1.6);
  expect(problems).toEqual([]);
});
