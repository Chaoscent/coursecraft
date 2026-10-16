// SPDX-License-Identifier: Apache-2.0
import { loadConfig } from './config/env.js';
import { createDatabase } from './db/connection.js';
import { checkReadiness } from './db/readiness.js';
import { buildApp } from './http/app.js';

const config = loadConfig();
const db = createDatabase(config.databaseUrl);
const { app } = await buildApp({ config, checkReadiness: () => checkReadiness(db) });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
