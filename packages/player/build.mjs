// SPDX-License-Identifier: Apache-2.0
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FONTS = new URL('../../apps/web/src/assets/fonts/', import.meta.url);
const OUT = new URL('./dist/', import.meta.url);
mkdirSync(new URL('fonts/', OUT), { recursive: true });

await build({
  entryPoints: ['src/standalone.ts'],
  outfile: 'dist/player.js',
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  banner: { js: '/* Lernwerk player. SPDX-License-Identifier: Apache-2.0 */' },
  logLevel: 'info',
});

// SCORM runtime for imported packages (content origin): wrapper + scorm-again.
await build({
  entryPoints: ['src/wrapper/scorm-wrapper.ts'],
  outfile: 'dist/scorm-wrapper.js',
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  banner: { js: '/* Lernwerk SCORM wrapper. SPDX-License-Identifier: Apache-2.0 */' },
  logLevel: 'info',
});
const scormAgain = new URL('../../node_modules/scorm-again/', import.meta.url);
copyFileSync(new URL('dist/scorm-again.min.js', scormAgain), new URL('scorm-again.min.js', OUT));
copyFileSync(new URL('LICENSE', scormAgain), new URL('scorm-again.LICENSE.txt', OUT));

for (const font of [
  'IBMPlexSans-Regular.woff2',
  'IBMPlexSans-Italic.woff2',
  'IBMPlexSans-Bold.woff2',
  'IBMPlexMono-Regular.woff2',
  'OFL.txt',
]) {
  copyFileSync(new URL(font, FONTS), new URL(`fonts/${font}`, OUT));
}
const css = ['./src/fonts.css', './src/player.css']
  .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))
  .join('\n');
writeFileSync(new URL('player.css', OUT), css);
