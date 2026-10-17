// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages,scripts}/**/*.test.ts'],
          environment: 'node',
          exclude: ['**/node_modules/**', '**/*.db.test.ts'],
        },
      },
      {
        test: {
          name: 'db',
          include: ['apps/**/*.db.test.ts', 'tests/security/**/*.test.ts', 'tests/integration/**/*.test.ts'],
          globalSetup: ['tests/support/global-setup.ts'],
          setupFiles: ['tests/support/egress-guard.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
