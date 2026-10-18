// SPDX-License-Identifier: Apache-2.0
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Development: API on the local server, same origin for the browser.
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  build: {
    // Nothing is inlined: the CSP forbids inline scripts, data: scripts and inline styles.
    assetsInlineLimit: 0,
    sourcemap: true,
    rollupOptions: {
      // The operator console is a separate page, served only by the operator process.
      input: { main: 'index.html', operator: 'operator.html' },
    },
  },
});
