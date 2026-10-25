// SPDX-License-Identifier: Apache-2.0
import { Worker } from 'node:worker_threads';
import type { ErrorCode } from '@coursecraft/shared';
import { AppError } from '../../http/errors.js';
import type { ZipLimits } from '../../lib/zip.js';
import type { ParsedPresentation } from './parse.js';
import type { ParseWorkerRequest, ParseWorkerResponse } from './parse-worker.js';

const PARSE_TIMEOUT_MS = 60_000;
const MAX_HEAP_MB = 512;

/**
 * Resolves the worker entry in both run modes (SECURITY_AUDIT.md F-13):
 * - production (esbuild bundle): this module is flattened into `dist/<entry>.js`
 *   at the bundle root, and the worker is its own entry at `dist/modules/pptx/`;
 * - development and tests (tsx): run the TypeScript sibling directly.
 */
function workerEntry(): { url: URL; tsx: boolean } {
  if (import.meta.url.includes('/dist/'))
    return { url: new URL('./modules/pptx/parse-worker.js', import.meta.url), tsx: false };
  return { url: new URL('./parse-worker.ts', import.meta.url), tsx: true };
}

/**
 * Parses a presentation in a separate thread with a bounded heap and a
 * timeout, so a crafted or oversized file cannot stall the event loop or
 * exhaust the app's memory for every tenant on the replica (F-13). A heap or
 * time limit maps to `payload_too_large`; parse errors keep their own code.
 */
export function parsePresentationInWorker(
  bytes: Buffer,
  limits: ZipLimits,
  options: { lang: string; fileTitle: string },
): Promise<ParsedPresentation> {
  const { url, tsx } = workerEntry();
  return new Promise<ParsedPresentation>((resolve, reject) => {
    const worker = new Worker(url, {
      resourceLimits: { maxOldGenerationSizeMb: MAX_HEAP_MB },
      execArgv: tsx ? ['--import', 'tsx'] : [],
    });
    let settled = false;
    const finish = (run: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      run();
    };
    const timer = setTimeout(
      () =>
        finish(() => reject(new AppError('payload_too_large', 'The presentation took too long to import'))),
      PARSE_TIMEOUT_MS,
    );
    worker.on('message', (response: ParseWorkerResponse) => {
      if (response.ok) finish(() => resolve(response.result));
      else
        finish(() =>
          reject(
            new AppError(
              (response.appErrorCode as ErrorCode | undefined) ?? 'invalid_file',
              response.message || 'The presentation could not be imported',
            ),
          ),
        );
    });
    // A heap-limit breach (ERR_WORKER_OUT_OF_MEMORY) or any crash lands here.
    worker.on('error', () =>
      finish(() =>
        reject(new AppError('payload_too_large', 'The presentation is too large or complex to import')),
      ),
    );
    worker.on('exit', (code) => {
      if (code !== 0)
        finish(() => reject(new AppError('payload_too_large', 'The presentation could not be imported')));
    });
    worker.postMessage({ bytes, limits, options } satisfies ParseWorkerRequest);
  });
}
