// SPDX-License-Identifier: Apache-2.0
import { convertDoneJobSchema, exportJobSchema, mailJobSchema, QUEUES } from '@coursecraft/shared';
import { loadConfig } from './config/env.js';
import { createContext } from './context-factory.js';
import { assertSessionPooling } from './db/connection.js';
import { checkReadiness } from './db/readiness.js';
import { buildApp } from './http/app.js';
import { buildContentApp } from './http/content-app.js';
import { bossQueue, createBoss } from './jobs/queue.js';
import { expireStale, handleConvertDone } from './modules/conversions/service.js';
import { handleMailJob, sendDueReminders, sendPathReminders } from './modules/mail/service.js';
import { handleExportJob, purgeExports } from './modules/exports/jobs.js';
import { issueSetupToken } from './modules/setup/service.js';
import { serveMetrics } from './http/metrics.js';
import { currentScope, DEFAULT_SCOPE, DEFAULT_TENANT_ID, runAsTenant } from './tenancy/context.js';
import { forEachTenant } from './tenancy/directory.js';
import { claimRun } from './jobs/lease.js';
import { purgeRateLimits } from './http/rate-limit-store.js';
import { syncAllDirectories } from './modules/sso/sync.js';
import { purgeOldAttempts } from './modules/sso/throttle.js';

const CLEANUP_INTERVAL_MS = 15 * 60_000;
const CONVERSION_SWEEP_MS = 60_000;
const REMINDER_INTERVAL_MS = 60 * 60_000;

const config = loadConfig();
// The tenant lives in the database session: refuse to serve several organisations without one.
if (config.tenancy === 'multi') await assertSessionPooling(config.databaseUrl);
const boss = createBoss(config.databaseUrl);
const ctx = createContext(config, bossQueue(boss));
const { app, metrics } = await buildApp({ config, ctx, checkReadiness: () => checkReadiness(ctx.db) });
const contentApp =
  config.contentUrl || config.tenancy === 'multi' ? await buildContentApp(config, ctx) : null;
ctx.log = app.log;
boss.on('error', (error: Error) => app.log.error({ err: error }, 'job queue error'));
await boss.start();
await boss.work(QUEUES.exportBuild, { batchSize: 1 }, async ([job]) => {
  if (!job) return;
  const parsed = exportJobSchema.safeParse(job.data);
  if (!parsed.success) return app.log.warn({ jobId: job.id }, 'invalid export job dropped');
  await inTenantOf(parsed.data.tenantId, () => handleExportJob(ctx, parsed.data));
});

/** Runs a job for the tenant it was queued for; jobs of removed tenants are dropped. */
async function inTenantOf(tenantId: string | undefined, work: () => Promise<void>): Promise<void> {
  const scope = tenantId ? await ctx.tenants.byId(tenantId) : DEFAULT_SCOPE;
  if (!scope) {
    app.log.warn({ tenantId }, 'job for an unknown tenant dropped');
    return;
  }
  await runAsTenant(scope, work);
}

await boss.work(QUEUES.convertDone, { batchSize: 1 }, async ([job]) => {
  if (!job) return;
  const parsed = convertDoneJobSchema.safeParse(job.data);
  if (!parsed.success) return app.log.warn({ jobId: job.id }, 'invalid converter message dropped');
  await inTenantOf(parsed.data.tenantId, () => handleConvertDone(ctx, parsed.data));
});
await boss.work(QUEUES.mail, { batchSize: 1 }, async ([job]) => {
  if (!job) return;
  const parsed = mailJobSchema.safeParse(job.data);
  if (!parsed.success) return app.log.warn({ jobId: job.id }, 'invalid mail job dropped');
  // Errors propagate so the job is marked failed; the log never contains addresses or texts.
  await inTenantOf(parsed.data.tenantId, () => handleMailJob(ctx, parsed.data));
});

// With several tenants each one gets its token when the operator creates it (coursecraft tenant create).
const setup =
  config.tenancy === 'single'
    ? await issueSetupToken(ctx.db, { onlyIfMissing: config.setupTokenOnStart === 'if-missing' })
    : null;
if (setup) {
  // Printed only to the container log; the database stores the hash.
  app.log.warn(
    `Setup required. Setup token: ${setup.token} (valid until ${setup.expiresAt.toISOString()}). ` +
      `Open ${config.publicUrl.origin}/setup to create the first administrator.`,
  );
}

metrics.addGauges(async () => {
  let activeSessions = 0;
  let pendingConversions = 0;
  await forEachTenant(
    config,
    ctx.tenants,
    async () => {
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
      activeSessions += Number(sessions.n);
      pendingConversions += Number(conversions.n);
    },
    () => undefined,
  );
  return {
    coursecraft_active_sessions: activeSessions,
    coursecraft_pending_conversions: pendingConversions,
    coursecraft_tenants: config.tenancy === 'single' ? 1 : (await ctx.tenants.active()).length,
  };
});
const metricsServer = config.metricsPort ? serveMetrics(metrics, config.host, config.metricsPort) : null;

const timers: NodeJS.Timeout[] = [];

/**
 * Runs `task` every `ms` for every tenant; with several replicas only one of
 * them does it per round.
 */
function every(name: string, ms: number, task: () => Promise<void>): void {
  timers.push(
    setInterval(() => {
      claimRun(ctx.db, name, Math.floor(ms * 0.9))
        .then(async (mine) => {
          if (!mine) return;
          await forEachTenant(config, ctx.tenants, task, (scope, error) =>
            app.log.error({ err: error, job: name, tenant: scope.id }, 'periodic job failed for a tenant'),
          );
        })
        .catch((error: unknown) => app.log.error({ err: error, job: name }, 'periodic job failed'));
    }, ms),
  );
}

every('cleanup', CLEANUP_INTERVAL_MS, async () => {
  const deleted = await ctx.sessions.deleteExpired();
  if (deleted) app.log.info({ deleted }, 'expired sessions removed');
  await purgeOldAttempts(ctx);
  await purgeExports(ctx);
});
every('rate-limit-purge', CLEANUP_INTERVAL_MS, async () => {
  // Shared by all tenants; one run is enough (the default tenant's round).
  if ((currentScope()?.id ?? DEFAULT_TENANT_ID) === DEFAULT_TENANT_ID) await purgeRateLimits(ctx.db);
});
every('conversion-sweep', CONVERSION_SWEEP_MS, async () => {
  const expired = await expireStale(ctx);
  if (expired) app.log.warn({ expired }, 'conversions without converter answer given up');
});
every('due-reminders', REMINDER_INTERVAL_MS, async () => {
  const queued = (await sendDueReminders(ctx)) + (await sendPathReminders(ctx));
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
