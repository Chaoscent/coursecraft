// SPDX-License-Identifier: Apache-2.0
// Security audit (SECURITY_AUDIT.md, F-13 / P3): PPTX XML parsing runs in a
// worker thread with a bounded heap and a timeout, so a crafted or oversized
// upload cannot stall the app's event loop or exhaust its memory for every
// tenant on the replica. These checks prove the worker boundary: a normal
// deck parses off-thread, and a bad upload surfaces as a clean AppError
// instead of hanging or crashing the process.
import { describe, expect, it } from 'vitest';
import { PPTX_LIMITS } from '../../apps/server/src/modules/pptx/import.js';
import { parsePresentationInWorker } from '../../apps/server/src/modules/pptx/parse-worker-client.js';
import { buildPptx } from '../support/pptx.js';

describe('F-13 / P3: PPTX parsing in a worker thread', () => {
  it('parses a normal presentation off the main thread', async () => {
    const deck = await buildPptx({ slides: [{ shapes: [] }, { shapes: [] }] });
    const parsed = await parsePresentationInWorker(deck, PPTX_LIMITS, { lang: 'en', fileTitle: 'Deck' });
    expect(parsed.slides.length).toBe(2);
    expect(parsed.totalSlides).toBe(2);
  }, 60_000);

  it('rejects a non-presentation upload with a clean error, not a crash', async () => {
    const garbage = Buffer.from('this is not a zip file'.repeat(100));
    await expect(
      parsePresentationInWorker(garbage, PPTX_LIMITS, { lang: 'en', fileTitle: 'x' }),
    ).rejects.toMatchObject({ name: 'AppError' });
  }, 60_000);
});
