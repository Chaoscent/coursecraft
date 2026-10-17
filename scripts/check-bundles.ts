// SPDX-License-Identifier: Apache-2.0
/**
 * Size budgets for the built bundles (gzip, what travels over the wire):
 * the web app's first load (entry script plus everything index.html
 * preloads), its biggest on-demand chunk, and the course player.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const BUDGET = {
  webFirstLoad: 330 * KB,
  webChunk: 260 * KB,
  player: 80 * KB,
} as const;

const gzipSize = (file: string) => gzipSync(readFileSync(file)).length;
const kb = (n: number) => `${(n / KB).toFixed(1)} KB`;

const problems: string[] = [];
const check = (label: string, size: number, budget: number) => {
  console.log(`${size > budget ? 'OVER' : 'ok  '} ${label}: ${kb(size)} (budget ${kb(budget)})`);
  if (size > budget) problems.push(label);
};

const webDir = 'apps/web/dist';
if (existsSync(join(webDir, 'index.html'))) {
  const html = readFileSync(join(webDir, 'index.html'), 'utf8');
  const first = new Set(
    [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1] ?? '').filter(Boolean),
  );
  check(
    `web first load (${first.size} files)`,
    [...first].reduce((sum, f) => sum + gzipSize(join(webDir, f)), 0),
    BUDGET.webFirstLoad,
  );
  const largest = readdirSync(join(webDir, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ f, size: gzipSize(join(webDir, 'assets', f)) }))
    .sort((a, b) => b.size - a.size)[0];
  if (largest) check(`web largest chunk (${largest.f})`, largest.size, BUDGET.webChunk);
} else {
  problems.push('apps/web/dist is missing: run pnpm build first');
}

const player = 'packages/player/dist/player.js';
if (existsSync(player)) check('player', gzipSize(player), BUDGET.player);
else problems.push('packages/player/dist is missing: run pnpm build first');

if (problems.length) {
  console.error(`Bundle budget exceeded or bundles missing: ${problems.join(', ')}`);
  process.exit(1);
}
console.log('Bundle budgets passed.');
