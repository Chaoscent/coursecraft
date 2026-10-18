// SPDX-License-Identifier: Apache-2.0
// SCORM conformance in a real LMS (scripts/ci/test-moodle.sh): the package
// goes through Moodle's own upload and player; the script then checks what
// Moodle recorded.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ADMIN } from '../support.js';
import { exportPackage, takeQuiz } from '../support-export.js';

const MOODLE = process.env['E2E_MOODLE_URL'] ?? '';

test.describe.configure({ mode: 'serial' });
test.beforeEach(() => test.skip(!MOODLE, 'Needs the Moodle of scripts/ci/test-moodle.sh'));

async function signIn(page: Page) {
  // Moodle's scripts reset the form while loading: fill it once they are done.
  await page.goto(`${MOODLE}/login/index.php`, { waitUntil: 'networkidle' });
  if (!(await page.locator('#username').isVisible())) return;
  await page.locator('#username').fill('admin');
  // By name: Moodle's show-password toggle carries the same label.
  await page.locator('#password').fill('Admin-pass-123!');
  await expect(page.locator('#password')).toHaveValue('Admin-pass-123!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login\//);
}

for (const [format, name] of [
  ['scorm12', 'Coursecraft SCORM 1.2'],
  ['scorm2004-4', 'Coursecraft SCORM 2004'],
] as const) {
  test(`${name}: Moodle imports the package and records the learner's attempt`, async ({
    page,
    request,
    baseURL,
  }, testInfo) => {
    test.setTimeout(180_000);
    const zip = await exportPackage(request, baseURL ?? '', ADMIN.email, ADMIN.password, format, true);
    const file = testInfo.outputPath(`${format}.zip`);
    mkdirSync(testInfo.outputDir, { recursive: true });
    writeFileSync(file, zip);

    await signIn(page);
    await page.goto(`${MOODLE}/course/search.php?search=coursecraft`);
    await page.getByRole('link', { name: 'Coursecraft conformance' }).click();
    const courseId = new URL(page.url()).searchParams.get('id');
    await page.goto(`${MOODLE}/course/modedit.php?add=scorm&course=${courseId}&section=0&return=0`);
    await page.getByLabel('Name', { exact: true }).fill(name);
    // Moodle's file picker: "Add…" → "Upload a file".
    await page.getByRole('button', { name: 'Add...' }).first().click();
    const picker = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'File picker' }) })
      .first();
    await picker.getByRole('link', { name: 'Upload a file' }).click();
    await picker.locator('input[type=file]').setInputFiles(file);
    await picker.getByRole('button', { name: 'Upload this file' }).click();
    await expect(page.getByText(`${format}.zip`).first()).toBeVisible();
    await page.getByRole('button', { name: 'Save and display' }).click();
    // Moodle validated the manifest; an invalid package stays on the form with an error.
    await expect(page.getByRole('heading', { name })).toBeVisible();

    await page.getByRole('button', { name: 'Enter' }).click();
    const course = page.frameLocator('#scorm_object');
    await expect(course.getByRole('heading', { level: 1 })).toContainText(`Export ${format}`);
    await takeQuiz(course);
    // Leaving the player ends the attempt (LMSFinish / Terminate).
    await page.getByRole('link', { name: 'Exit activity' }).click();
    await expect(page.getByRole('heading', { name: 'Coursecraft conformance' })).toBeVisible();
  });
}
