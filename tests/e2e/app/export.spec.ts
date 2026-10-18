// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ADMIN } from '../support.js';
import { exportCourse, serveLms } from '../support-export.js';

test('SCORM 1.2 package reports progress and completion to the LMS', async ({ page, request, baseURL }) => {
  const files = await exportCourse(request, baseURL ?? '', ADMIN.email, ADMIN.password, 'scorm12');
  const external = await serveLms(page, files);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('http://lms.test/harness/scorm12.html');
  const sco = page.frameLocator('#sco');
  await expect(sco.getByRole('heading', { level: 1 })).toContainText('Export scorm12');
  await expect(sco.getByText('1 von 2')).toBeVisible();
  await sco.getByRole('button', { name: 'Weiter' }).click();
  await expect(sco.getByText('2 von 2')).toBeVisible();
  await expect(sco.getByText('Inhalt der zweiten Folie')).toBeVisible();

  const status = await page.evaluate(
    () =>
      (window as unknown as { API: { cmi: { core: { lesson_status: string } } } }).API.cmi.core.lesson_status,
  );
  expect(status).toBe('completed');
  const log = await page.evaluate(() => (window as unknown as { lmsLog: [string, string][] }).lmsLog);
  expect(log[0]?.[0]).toBe('LMSInitialize');
  expect(log).toContainEqual(['cmi.core.lesson_status', 'incomplete']);
  expect(log.some(([k, v]) => k === 'cmi.suspend_data' && v.includes('"v":[0,1]'))).toBe(true);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('SCORM 1.2 package resumes at the bookmark', async ({ page, request, baseURL }) => {
  const files = await exportCourse(request, baseURL ?? '', ADMIN.email, ADMIN.password, 'scorm12');
  await serveLms(page, files);
  await page.goto(`http://lms.test/harness/scorm12.html?suspend=${encodeURIComponent('{"l":1,"v":[0,1]}')}`);
  await expect(page.frameLocator('#sco').getByText('2 von 2')).toBeVisible();
});

test('HTML5 package runs from the file system without network', async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  const files = await exportCourse(request, baseURL ?? '', ADMIN.email, ADMIN.password, 'html5');
  const dir = testInfo.outputPath('html5');
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
  const external: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => !r.url().startsWith('file://') && external.push(r.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`file://${join(dir, 'index.html')}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Export html5');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('Inhalt der zweiten Folie')).toBeVisible();
  await page.getByRole('button', { name: 'Textansicht' }).click();
  await expect(page.getByRole('heading', { name: 'Zweite Folie' })).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
