// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { repoFiles } from './lib/files.js';

const SOURCE = /\.(ts|tsx|js|mjs|cjs|css|html|sh|sql|ya?ml)$/;
const NAMED = new Set(['Dockerfile', 'Caddyfile']);
const HEADER = 'SPDX-License-Identifier: Apache-2.0';

/** Third-party files that carry their own license notice. */
const EXEMPT = [/^apps\/web\/src\/assets\/(fonts|icons)\//, /^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/];

const missing = repoFiles()
  .filter((f) => existsSync(f))
  .filter((f) => SOURCE.test(f) || NAMED.has(basename(f)) || basename(f).endsWith('.Dockerfile'))
  .filter((f) => !EXEMPT.some((re) => re.test(f)))
  .filter(
    (f) =>
      !readFileSync(f, 'utf8')
        .split('\n')
        .slice(0, 3)
        .some((line) => line.includes(HEADER)),
  );

if (missing.length) {
  console.error(`Missing "${HEADER}" in the first lines of:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log('SPDX header check passed.');
