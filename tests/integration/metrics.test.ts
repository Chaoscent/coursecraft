// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/http/app.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

let t: TestApp;
let render: () => Promise<string>;

beforeAll(async () => {
  t = await createTestApp();
  // The test app does not expose its Metrics; build a second app on the same context.
  const { app, metrics } = await buildApp({
    config: t.ctx.config,
    ctx: t.ctx,
    logger: false,
    checkReadiness: () => Promise.resolve({ database: true, migrations: true }),
  });
  await app.ready();
  metrics.addGauges(() => Promise.resolve({ coursecraft_test_gauge: 7 }));
  metrics.addGauges(() => Promise.reject(new Error('broken gauge')));
  await app.inject({ method: 'GET', url: '/healthz' });
  await app.inject({ method: 'GET', url: '/healthz' });
  await app.inject({ method: 'GET', url: '/does/not/exist/123' });
  render = () => metrics.render();
});
afterAll(() => t.close());

describe('metrics', () => {
  it('counts requests by route template and status, never by concrete path', async () => {
    const text = await render();
    expect(text).toContain('coursecraft_http_requests_total{method="GET",route="/healthz",status="200"} 2');
    expect(text).toContain('route="unmatched"');
    expect(text).not.toContain('/does/not/exist');
  });

  it('renders durations as a histogram and the process numbers', async () => {
    const text = await render();
    expect(text).toContain(
      'coursecraft_http_request_duration_seconds_count{method="GET",route="/healthz"} 2',
    );
    expect(text).toMatch(
      /coursecraft_http_request_duration_seconds_bucket\{method="GET",route="\/healthz",le="\+Inf"\} 2/,
    );
    expect(text).toContain('process_resident_memory_bytes ');
    expect(text).toContain('coursecraft_test_gauge 7');
  });
});
