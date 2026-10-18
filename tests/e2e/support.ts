// SPDX-License-Identifier: Apache-2.0
import { expect, type Page } from '@playwright/test';

export const ADMIN = { email: 'admin@example.org', password: 'admin password for e2e', name: 'E2E Admin' };

/** Fails the test on console errors, page errors and requests to other origins. */
export function watchPage(page: Page, origin: string, ...allowed: string[]): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    // A missing xAPI state document is a 404 by specification (first launch, nothing to resume).
    const expected404 = m.text().includes('404') && m.location().url.includes('/xapi/activities/state');
    // WebKit reports its own native <select> rendering (inline styles of the browser's internal
    // shadow tree) as a style-src violation, even for a bare <select>. Nothing is blocked
    // visibly; real violations from our code still fail in Chromium and Firefox.
    const webkitSelect =
      page.context().browser()?.browserType().name() === 'webkit' &&
      m.text().startsWith('Refused to apply a stylesheet because its hash, its nonce,');
    if (m.type() === 'error' && !m.text().includes('401') && !expected404 && !webkitSelect)
      problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    const url = r.url();
    if (![origin, ...allowed, 'data:', 'blob:'].some((prefix) => url.startsWith(prefix)))
      problems.push(`external: ${r.url()}`);
  });
  return problems;
}

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Hauptmenü' })).toBeVisible();
}
