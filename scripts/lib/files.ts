// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';

/** Tracked and new (not ignored) files, relative to the repository root. */
export function repoFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  })
    .split('\0')
    .filter(Boolean);
}
