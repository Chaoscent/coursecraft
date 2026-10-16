// SPDX-License-Identifier: Apache-2.0
import { expect, type Page } from '@playwright/test';

export const ADMIN = { email: 'admin@example.org', password: 'admin password for e2e', name: 'E2E Admin' };

/** Fails the test on console errors, page errors and requests to other origins. */
export function watchPage(page: Page, origin: string): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401')) problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('request', (r) => {
    if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:'))
      problems.push(`external: ${r.url()}`);
  });
  return problems;
}

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByRole('navigation', { name: 'Hauptmenü' })).toBeVisible();
}
