// SPDX-License-Identifier: Apache-2.0
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// Workspace packages ship TypeScript sources and are bundled; npm packages stay external.
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@lernwerk/'));

await build({
  entryPoints: ['src/main.ts', 'src/healthcheck.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  external,
  logLevel: 'info',
});
