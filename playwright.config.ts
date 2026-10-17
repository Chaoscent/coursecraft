// SPDX-License-Identifier: Apache-2.0
// Runs inside the official Playwright image (scripts/ci/playwright.sh), which
// ships all browsers and their system libraries. App tests run only when a
// stack is available (scripts/ci/e2e.sh sets E2E_BASE_URL).
import { defineConfig, devices } from '@playwright/test';

const BROWSERS = {
  chromium: 'Desktop Chrome',
  firefox: 'Desktop Firefox',
  webkit: 'Desktop Safari',
} as const;
const appUrl = process.env['E2E_BASE_URL'];

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env['CI'],
  reporter: [['list']],
  use: { locale: 'de-DE', trace: 'retain-on-failure' },
  projects: [
    ...Object.entries(BROWSERS).map(([name, device]) => ({
      name: `samples-${name}`,
      testMatch: /design-samples\.spec\.ts/,
      use: { ...devices[device], baseURL: 'http://127.0.0.1:5173' },
    })),
    ...(appUrl
      ? [
          {
            name: 'app-setup',
            testMatch: /setup\.spec\.ts/,
            use: { ...devices['Desktop Chrome'], baseURL: appUrl },
          },
          ...Object.entries(BROWSERS).map(([name, device]) => ({
            name: `app-${name}`,
            testMatch: /app\/.*\.spec\.ts/,
            dependencies: ['app-setup'],
            use: {
              ...devices[device],
              baseURL: appUrl,
              // Synthetic microphone for the narration recording test.
              ...(name === 'chromium'
                ? {
                    launchOptions: {
                      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
                    },
                  }
                : {}),
            },
          })),
        ]
      : []),
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --strictPort',
    cwd: 'apps/web',
    url: 'http://127.0.0.1:5173/sample/editor.html',
    reuseExistingServer: false,
  },
});
