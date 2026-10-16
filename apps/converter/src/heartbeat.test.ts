// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { beat, HEARTBEAT_MAX_AGE_MS, isAlive } from './heartbeat.js';

describe('heartbeat', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'lw-hb-')), 'beat');

  it('is dead before the first beat', () => {
    expect(isAlive(file)).toBe(false);
  });

  it('is alive right after a beat and dead once stale', () => {
    beat(file);
    expect(isAlive(file)).toBe(true);
    expect(isAlive(file, Date.now() + HEARTBEAT_MAX_AGE_MS + 1)).toBe(false);
  });
});
