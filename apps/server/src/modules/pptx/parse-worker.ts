// SPDX-License-Identifier: Apache-2.0
// Worker thread for PPTX parsing (SECURITY_AUDIT.md F-13). The XML parse is
// CPU- and memory-heavy and runs on untrusted author uploads, so it must not
// block the app's event loop or exhaust its heap. The worker is spawned with
// a memory limit and a timeout by parse-worker-client.ts; here it just parses
// and posts the serialisable result back.
import { parentPort } from 'node:worker_threads';
import { AppError } from '../../http/errors.js';
import { ZipArchive, type ZipLimits } from '../../lib/zip.js';
import { parsePresentation, type ParsedPresentation } from './parse.js';

export interface ParseWorkerRequest {
  bytes: Uint8Array;
  limits: ZipLimits;
  options: { lang: string; fileTitle: string };
}

export type ParseWorkerResponse =
  { ok: true; result: ParsedPresentation } | { ok: false; appErrorCode?: string; message: string };

if (parentPort) {
  const port = parentPort;
  port.on('message', (request: ParseWorkerRequest) => {
    void (async () => {
      try {
        // Wrap the transferred bytes without another copy.
        const buffer = Buffer.from(request.bytes.buffer, request.bytes.byteOffset, request.bytes.byteLength);
        const zip = await ZipArchive.open(buffer, request.limits);
        try {
          const result = await parsePresentation(zip, request.options);
          port.postMessage({ ok: true, result } satisfies ParseWorkerResponse);
        } finally {
          zip.close();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Presentation could not be parsed';
        const response: ParseWorkerResponse =
          error instanceof AppError
            ? { ok: false, appErrorCode: error.code, message }
            : { ok: false, message };
        port.postMessage(response);
      }
    })();
  });
}
