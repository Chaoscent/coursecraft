// SPDX-License-Identifier: Apache-2.0
/** Container healthcheck: liveness of the local HTTP server. */
const port = process.env['LERNWERK_PORT'] ?? '3000';
try {
  const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(3000) });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}
