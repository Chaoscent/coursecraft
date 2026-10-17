// SPDX-License-Identifier: Apache-2.0
import { convertDoneJobSchema, QUEUES } from '@lernwerk/shared';
import { loadConfig } from './config/env.js';
import { createContext } from './context-factory.js';
import { checkReadiness } from './db/readiness.js';
import { buildApp } from './http/app.js';
import { bossQueue, createBoss } from './jobs/queue.js';
import { expireStale, handleConvertDone } from './modules/conversions/service.js';
import { issueSetupToken } from './modules/setup/service.js';

const CLEANUP_INTERVAL_MS = 15 * 60_000;
const CONVERSION_SWEEP_MS = 60_000;

const config = loadConfig();
const boss = createBoss(config.databaseUrl);
const ctx = createContext(config, bossQueue(boss));
const { app } = await buildApp({ config, ctx, checkReadiness: () => checkReadiness(ctx.db) });
ctx.log = app.log;
boss.on('error', (error: Error) => app.log.error({ err: error }, 'job queue error'));
await boss.start();
await boss.work(QUEUES.convertDone, { batchSize: 1 }, async ([job]) => {
  if (!job) return;
  const parsed = convertDoneJobSchema.safeParse(job.data);
  if (!parsed.success) return app.log.warn({ jobId: job.id }, 'invalid converter message dropped');
  await handleConvertDone(ctx, parsed.data);
});

const setup = await issueSetupToken(ctx.db);
if (setup) {
  // Printed only to the container log; the database stores the hash.
  app.log.warn(
    `Setup required. Setup token: ${setup.token} (valid until ${setup.expiresAt.toISOString()}). ` +
      `Open ${config.publicUrl.origin}/setup to create the first administrator.`,
  );
}

const cleanup = setInterval(() => {
  ctx.sessions
    .deleteExpired()
    .then((n) => n && app.log.info({ deleted: n }, 'expired sessions removed'))
    .catch((error: unknown) => app.log.error({ err: error }, 'session cleanup failed'));
}, CLEANUP_INTERVAL_MS);
const sweep = setInterval(() => {
  expireStale(ctx)
    .then((n) => n && app.log.warn({ expired: n }, 'conversions without converter answer given up'))
    .catch((error: unknown) => app.log.error({ err: error }, 'conversion sweep failed'));
}, CONVERSION_SWEEP_MS);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  clearInterval(cleanup);
  clearInterval(sweep);
  await app.close();
  await boss.stop({ graceful: true, timeout: 20_000 });
  await ctx.db.destroy();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
