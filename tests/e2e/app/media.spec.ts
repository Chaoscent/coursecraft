// SPDX-License-Identifier: Apache-2.0
// Presentation import, narration and timeline against the real converter
// (LibreOffice, pdf.js, ffmpeg) in the compose stack.
import { expect, test, type Page } from '@playwright/test';
import { solidPng } from '../../support/png.js';
import { body, buildPptx, para, picture, shape, table, textBox, timing, title } from '../../support/pptx.js';
import { sineWav } from '../../support/wav.js';
import { unzip } from '../support-export.js';
import { ADMIN, login, watchPage } from '../support.js';

test.beforeEach(({ browserName, baseURL }) => {
  test.skip(
    browserName === 'webkit' && !!baseURL?.startsWith('http://'),
    'WebKit needs HTTPS for secure cookies on localhost',
  );
});

const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function presentation(): Promise<Buffer> {
  return buildPptx({
    title: 'Erste Hilfe am Arbeitsplatz',
    slides: [
      {
        shapes: [title(2, 'Notruf absetzen'), body(3, [para(['112 wählen']), para(['Ruhe bewahren'])])],
        notes: 'Kurz die fünf W-Fragen erklären.',
      },
      {
        shapes: [
          title(2, 'Formen'),
          shape(
            4,
            'ellipse',
            { x: 100, y: 220, w: 240, h: 240 },
            { scheme: 'accent1', text: [para(['Kreis'])] },
          ),
          picture(5, 'rId7', { x: 760, y: 220, w: 400, h: 225 }, 'Blaue Fläche'),
          textBox(6, { x: 100, y: 560, w: 800, h: 60 }, [para(['Kommt später'])]),
        ],
        images: { rId7: { name: 'image1.png', bytes: solidPng(320, 180, [37, 99, 235]) } },
        timing: timing([[6, 10, 'clickEffect']]),
      },
      { shapes: [title(2, 'Tabelle'), table(3, { x: 100, y: 200, w: 600, h: 120 })] },
    ],
  });
}

async function newCourse(page: Page, name: string): Promise<string> {
  await page.getByRole('link', { name: 'Kurse', exact: true }).click();
  await page.getByRole('button', { name: 'Neuer Kurs …' }).click();
  await page.getByRole('dialog').getByLabel('Titel').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

test('author imports a presentation: slides, notes, animations and rendered slide images', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const problems = watchPage(page, baseURL ?? '');
  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole('link', { name: 'Kurse', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'PPTX importieren …' }).click();
  await (
    await chooser
  ).setFiles({ name: 'erste-hilfe.pptx', mimeType: PPTX_TYPE, buffer: await presentation() });

  const dialog = page.getByRole('dialog', { name: 'Präsentation importieren' });
  await expect(dialog.getByText('Import abgeschlossen.')).toBeVisible({ timeout: 90_000 });
  await expect(dialog.getByRole('list', { name: 'Hinweise zum Import' })).toContainText('Folie 3:');
  await dialog.getByRole('button', { name: 'Kurs öffnen' }).click();

  await expect(page.getByRole('navigation', { name: 'Hauptmenü' })).toContainText(
    'Erste Hilfe am Arbeitsplatz',
  );
  const slides = page.getByRole('complementary', { name: 'Folien' });
  for (const name of ['Notruf absetzen', 'Formen', 'Tabelle']) await expect(slides).toContainText(name);

  // The second slide keeps its elements; the animated text box starts later.
  await slides.getByText('Formen', { exact: true }).first().click();
  const timelineRegion = page.getByRole('region', { name: 'Zeitleiste' });
  await expect(timelineRegion.getByRole('slider', { name: 'TextBox 6: Einblenden' })).toHaveAttribute(
    'aria-valuetext',
    '1,0 s',
  );

  // The table slide shows the rendered image by default.
  await slides.getByText('Tabelle', { exact: true }).first().click();
  const props = page.getByRole('complementary', { name: 'Eigenschaften' });
  await expect(props.getByRole('checkbox', { name: 'Folienbild statt Elementen anzeigen' })).toBeChecked();
  const preview = props.locator('img').first();
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1920);
  expect(problems).toEqual([]);
});

test('author adds narration from a file and times an element on the timeline', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const problems = watchPage(page, baseURL ?? '');
  await login(page, ADMIN.email, ADMIN.password);
  const courseId = await newCourse(page, `Narration ${Date.now()}`);

  const props = page.getByRole('complementary', { name: 'Eigenschaften' });
  const chooser = page.waitForEvent('filechooser');
  await props.getByRole('button', { name: 'Datei …', exact: true }).click();
  await (await chooser).setFiles({ name: 'ton.wav', mimeType: 'audio/wav', buffer: sineWav(2) });
  await expect(props.getByText('ton.m4a')).toBeVisible({ timeout: 60_000 });

  const timelineRegion = page.getByRole('region', { name: 'Zeitleiste' });
  await expect(
    timelineRegion.getByRole('img', { name: /^Wellenform des Sprechertexts, 2,\d s$/ }),
  ).toBeVisible();
  const start = timelineRegion.getByRole('slider', { name: 'Title: Einblenden' });
  await start.focus();
  const saved = page.waitForResponse((r) => r.url().endsWith('/save') && r.status() === 200);
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(start).toHaveAttribute('aria-valuetext', '0,5 s');
  await saved;
  await expect(page.getByRole('status').filter({ hasText: 'Gespeichert' })).toBeVisible();

  // The export carries narration, duration and timing.
  const zip = await page.request.get(`/api/courses/${courseId}/export?format=html5`);
  expect(zip.ok()).toBe(true);
  const files = await unzip(await zip.body());
  const courseJs = files.get('data/course.js')?.toString('utf8') ?? '';
  expect(courseJs).toContain('"narration"');
  expect(courseJs).toContain('"startMs":500');
  expect([...files.keys()].some((name) => name.endsWith('.m4a'))).toBe(true);
  expect(problems).toEqual([]);
});

test.describe('recording', () => {
  // Chromium gets a fake microphone from the Playwright configuration.
  test.use({
    permissions: async ({ browserName }, use) => use(browserName === 'chromium' ? ['microphone'] : []),
  });

  test('author records narration in the browser', async ({ page, browserName, baseURL }) => {
    test.skip(browserName !== 'chromium', 'Fake microphone only in Chromium');
    test.setTimeout(120_000);
    const problems = watchPage(page, baseURL ?? '');
    await login(page, ADMIN.email, ADMIN.password);
    await newCourse(page, `Aufnahme ${Date.now()}`);
    const props = page.getByRole('complementary', { name: 'Eigenschaften' });
    await props.getByRole('button', { name: 'Aufnehmen' }).click();
    const stop = props.getByRole('button', { name: /^Stopp/ });
    await expect(stop).toHaveText(/Stopp \(2,\d s\)/, { timeout: 10_000 });
    await stop.click();
    await expect(props.getByText('Aufnahme.m4a')).toBeVisible({ timeout: 60_000 });
    expect(problems).toEqual([]);
  });
});
