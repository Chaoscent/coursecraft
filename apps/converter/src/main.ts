// SPDX-License-Identifier: Apache-2.0
import { PGBOSS_SCHEMA } from '@lernwerk/shared';
import { PgBoss } from 'pg-boss';
import { loadConfig } from './config.js';
import { beat, HEARTBEAT_INTERVAL_MS } from './heartbeat.js';

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

await boss.start();
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
