// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';

const PAGES = ['/sample/editor.html', '/sample/manage.html'];

for (const path of PAGES) {
  for (const theme of ['light', 'dark']) {
    test(`${path} (${theme}) loads offline without errors`, async ({ page, baseURL }) => {
      const problems: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(`console: ${m.text()}`);
      });
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      // Any request leaving the dev server is an external request.
      await page.route('**/*', (route) =>
        route
          .request()
          .url()
          .startsWith(baseURL ?? '')
          ? route.continue()
          : route.abort(),
      );
      page.on('requestfailed', (r) => problems.push(`failed: ${r.url()}`));

      await page.goto(`${path}?theme=${theme}`);
      await page.evaluate(() => document.fonts.ready);

      expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
      const fonts = await page.evaluate(() =>
        [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')),
      );
      expect(fonts).toContain('IBM Plex Sans');
      // Inline style attributes would break under the production CSP.
      expect(await page.locator('[style]').count()).toBe(0);
      expect(problems).toEqual([]);
    });
  }
}
