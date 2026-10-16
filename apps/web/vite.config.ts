// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    // Inline nothing: the CSP forbids data: scripts and inline styles stay external.
    assetsInlineLimit: 0,
    sourcemap: true,
  },
});
