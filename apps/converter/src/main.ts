// SPDX-License-Identifier: Apache-2.0
import {
  mediaJobSchema,
  PGBOSS_SCHEMA,
  pptxRenderJobSchema,
  QUEUES,
  type ConvertDoneJob,
} from '@coursecraft/shared';
import { PgBoss } from 'pg-boss';
import { loadConfig } from './config.js';
import { beat, HEARTBEAT_INTERVAL_MS } from './heartbeat.js';
import { convertMedia, UnsupportedMediaError } from './jobs/media.js';
import { renderPresentation } from './jobs/pptx-render.js';
import { ProcessError } from './process.js';

// Outputs must stay deletable by the app, which shares only the group.
process.umask(0o007);
const config = loadConfig();

// Schema and queues are created by the migrate service; this role has no DDL rights.
const boss = new PgBoss({
  connectionString: config.databaseUrl,
  schema: PGBOSS_SCHEMA,
  max: 2,
  migrate: false,
  createSchema: false,
  supervise: false,
  schedule: false,
});
boss.on('error', (error) => console.error('job queue error', error.message));

function errorCode(error: unknown): ConvertDoneJob['error'] {
  if (error instanceof UnsupportedMediaError) return 'unsupported';
  if (error instanceof ProcessError && error.timedOut) return 'timeout';
  return 'failed';
}

async function report(done: ConvertDoneJob): Promise<void> {
  await boss.send(QUEUES.convertDone, done, { retryLimit: 3, retryDelay: 5 });
}

await boss.start();
const options = { batchSize: 1, localConcurrency: config.concurrency };

await boss.work(QUEUES.pptxRender, options, async ([job]) => {
  const parsed = pptxRenderJobSchema.safeParse(job?.data);
  if (!parsed.success) return console.error('invalid render job dropped');
  const started = Date.now();
  try {
    const outputs = await renderPresentation(config.workDir, parsed.data);
    console.log(`rendered ${outputs.length} slides in ${Date.now() - started} ms`);
    await report({ jobId: parsed.data.jobId, queue: QUEUES.pptxRender, ok: true, outputs });
  } catch (error) {
    console.error('render failed', error instanceof Error ? error.message : error);
    await report({
      jobId: parsed.data.jobId,
      queue: QUEUES.pptxRender,
      ok: false,
      error: errorCode(error),
      outputs: [],
    });
  }
});

await boss.work(QUEUES.media, options, async ([job]) => {
  const parsed = mediaJobSchema.safeParse(job?.data);
  if (!parsed.success) return console.error('invalid media job dropped');
  try {
    const result = await convertMedia(config.workDir, parsed.data);
    await report({ jobId: parsed.data.jobId, queue: QUEUES.media, ok: true, ...result });
  } catch (error) {
    console.error('media conversion failed', error instanceof Error ? error.message : error);
    await report({
      jobId: parsed.data.jobId,
      queue: QUEUES.media,
      ok: false,
      error: errorCode(error),
      outputs: [],
    });
  }
});

beat(config.heartbeatFile);
const timer = setInterval(() => beat(config.heartbeatFile), HEARTBEAT_INTERVAL_MS);
console.log('converter ready');

const shutdown = async () => {
  clearInterval(timer);
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
