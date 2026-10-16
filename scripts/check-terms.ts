// SPDX-License-Identifier: Apache-2.0
/**
 * Clean-room guard: the name of the commercial reference product must not
 * appear in files or commit messages. Stored encoded so that this script
 * does not contain it either.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { repoFiles } from './lib/files.js';

const FORBIDDEN = ['aXNwcmluZw=='].map((b64) => Buffer.from(b64, 'base64').toString('utf8'));
const pattern = new RegExp(FORBIDDEN.join('|'), 'i');

const hits: string[] = [];
for (const file of repoFiles()) {
  if (!existsSync(file)) continue;
  if (pattern.test(file)) hits.push(`${file} (file name)`);
  const content = readFileSync(file);
  if (content.includes(0)) continue; // binary
  content
    .toString('utf8')
    .split('\n')
    .forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${file}:${i + 1}`);
    });
}

let log = '';
try {
  log = execFileSync('git', ['log', '--format=%H %B'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  // No commits yet.
}
for (const line of log.split('\n')) if (pattern.test(line)) hits.push(`commit message: ${line.slice(0, 12)}`);

if (hits.length) {
  console.error(`Forbidden product name found:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log('Forbidden-term check passed.');
