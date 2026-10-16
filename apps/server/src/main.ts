// SPDX-License-Identifier: Apache-2.0
import { loadConfig } from './config/env.js';
import { createContext } from './context-factory.js';
import { checkReadiness } from './db/readiness.js';
import { buildApp } from './http/app.js';
import { issueSetupToken } from './modules/setup/service.js';

const CLEANUP_INTERVAL_MS = 15 * 60_000;

const config = loadConfig();
const ctx = createContext(config);
const { app } = await buildApp({ config, ctx, checkReadiness: () => checkReadiness(ctx.db) });

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

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  clearInterval(cleanup);
  await app.close();
  await ctx.db.destroy();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
