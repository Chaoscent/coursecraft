// SPDX-License-Identifier: Apache-2.0
// Runs inside the official Playwright image (scripts/ci/playwright.sh), which
// ships all browsers and their system libraries.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env['CI'],
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5173' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --strictPort',
    cwd: 'apps/web',
    url: 'http://127.0.0.1:5173/sample/editor.html',
    reuseExistingServer: false,
  },
});
