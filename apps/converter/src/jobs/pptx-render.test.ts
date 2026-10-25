// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HARDENED_PROFILE } from './libreoffice-profile.js';

const runMock = vi.hoisted(() => vi.fn());
vi.mock('../process.js', () => ({ run: runMock }));

const { presentationToPdf } = await import('./pptx-render.js');

describe('presentationToPdf profile seeding (F-19 / M-6)', () => {
  afterEach(() => runMock.mockReset());

  it('writes the hardened LibreOffice profile before running soffice', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cc-m6-'));
    const xcu = join(tmp, 'profile', 'user', 'registrymodifications.xcu');
    let seededContent: string | null = null;
    runMock.mockImplementation(() => {
      // The profile must already be in place when soffice is invoked.
      seededContent = existsSync(xcu) ? readFileSync(xcu, 'utf8') : null;
      writeFileSync(join(tmp, 'source.pdf'), 'pdf');
      return Promise.resolve('');
    });
    try {
      await presentationToPdf(join(tmp, 'source.pptx'), tmp);
      expect(runMock).toHaveBeenCalledOnce();
      expect(seededContent).toBe(HARDENED_PROFILE);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
