// SPDX-License-Identifier: Apache-2.0
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// Workspace packages ship TypeScript sources and are bundled; npm packages stay external.
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@coursecraft/'));

await build({
  entryPoints: [
    'src/main.ts',
    'src/cli.ts',
    'src/healthcheck.ts',
    'src/operator-main.ts',
    // PPTX parsing runs in a worker thread (SECURITY_AUDIT.md F-13); its own entry
    // so the spawn in parse-worker-client.ts can load it at dist/modules/pptx/.
    'src/modules/pptx/parse-worker.ts',
  ],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  external,
  logLevel: 'info',
});
