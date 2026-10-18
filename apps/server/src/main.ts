// SPDX-License-Identifier: Apache-2.0
import { convertDoneJobSchema, mailJobSchema, QUEUES } from '@coursecraft/shared';
import { loadConfig } from './config/env.js';
import { createContext } from './context-factory.js';
import { checkReadiness } from './db/readiness.js';
import { buildApp } from './http/app.js';
import { buildContentApp } from './http/content-app.js';
import { bossQueue, createBoss } from './jobs/queue.js';
import { expireStale, handleConvertDone } from './modules/conversions/service.js';
import { handleMailJob, sendDueReminders } from './modules/mail/service.js';
import { issueSetupToken } from './modules/setup/service.js';
import { serveMetrics } from './http/metrics.js';
import { claimRun } from './jobs/lease.js';
import { purgeRateLimits } from './http/rate-limit-store.js';
import { syncAllDirectories } from './modules/sso/sync.js';
import { purgeOldAttempts } from './modules/sso/throttle.js';

const CLEANUP_INTERVAL_MS = 15 * 60_000;
const CONVERSION_SWEEP_MS = 60_000;
const REMINDER_INTERVAL_MS = 60 * 60_000;

const config = loadConfig();
const boss = createBoss(config.databaseUrl);
const ctx = createContext(config, bossQueue(boss));
const { app, metrics } = await buildApp({ config, ctx, checkReadiness: () => checkReadiness(ctx.db) });
const contentApp = config.contentUrl ? await buildContentApp(config, ctx) : null;
ctx.log = app.log;
boss.on('error', (error: Error) => app.log.error({ err: error }, 'job queue error'));
await boss.start();
await boss.work(QUEUES.convertDone, { batchSize: 1 }, async ([job]) => {
  if (!job) return;
  const parsed = convertDoneJobSchema.safeParse(job.data);
  if (!parsed.success) return app.log.warn({ jobId: job.id }, 'invalid converter message dropped');
  await handleConvertDone(ctx, parsed.data);
});
await boss.work(QUEUES.mail, { batchSize: 1 }, async ([job]) => {
  if (!job) return;
  const parsed = mailJobSchema.safeParse(job.data);
  if (!parsed.success) return app.log.warn({ jobId: job.id }, 'invalid mail job dropped');
  // Errors propagate so the job is marked failed; the log never contains addresses or texts.
  await handleMailJob(ctx, parsed.data);
});

const setup = await issueSetupToken(ctx.db, { onlyIfMissing: config.setupTokenOnStart === 'if-missing' });
if (setup) {
  // Printed only to the container log; the database stores the hash.
  app.log.warn(
    `Setup required. Setup token: ${setup.token} (valid until ${setup.expiresAt.toISOString()}). ` +
      `Open ${config.publicUrl.origin}/setup to create the first administrator.`,
  );
}

metrics.addGauges(async () => {
  const [sessions, conversions] = await Promise.all([
    ctx.db
      .selectFrom('sessions')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('absolute_expires_at', '>', new Date())
      .executeTakeFirstOrThrow(),
    ctx.db
      .selectFrom('conversions')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('status', '=', 'pending')
      .executeTakeFirstOrThrow(),
  ]);
  return {
    coursecraft_active_sessions: Number(sessions.n),
    coursecraft_pending_conversions: Number(conversions.n),
  };
});
const metricsServer = config.metricsPort ? serveMetrics(metrics, config.host, config.metricsPort) : null;

const timers: NodeJS.Timeout[] = [];

/** Runs `task` every `ms`; with several replicas only one of them does it per round. */
function every(name: string, ms: number, task: () => Promise<void>): void {
  timers.push(
    setInterval(() => {
      claimRun(ctx.db, name, Math.floor(ms * 0.9))
        .then(async (mine) => {
          if (mine) await task();
        })
        .catch((error: unknown) => app.log.error({ err: error, job: name }, 'periodic job failed'));
    }, ms),
  );
}

every('cleanup', CLEANUP_INTERVAL_MS, async () => {
  const deleted = await ctx.sessions.deleteExpired();
  if (deleted) app.log.info({ deleted }, 'expired sessions removed');
  await purgeOldAttempts(ctx);
  await purgeRateLimits(ctx.db);
});
every('conversion-sweep', CONVERSION_SWEEP_MS, async () => {
  const expired = await expireStale(ctx);
  if (expired) app.log.warn({ expired }, 'conversions without converter answer given up');
});
every('due-reminders', REMINDER_INTERVAL_MS, async () => {
  const queued = await sendDueReminders(ctx);
  if (queued) app.log.info({ queued }, 'due-date reminders queued');
});
every('directory-sync', REMINDER_INTERVAL_MS, async () => {
  const deactivated = await syncAllDirectories(ctx);
  if (deactivated) app.log.warn({ deactivated }, 'accounts deactivated: gone from the directory');
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  for (const timer of timers) clearInterval(timer);
  metricsServer?.close();
  await app.close();
  await contentApp?.close();
  await boss.stop({ graceful: true, timeout: 20_000 });
  await ctx.db.destroy();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
if (contentApp) await contentApp.listen({ host: config.host, port: config.contentPort });
