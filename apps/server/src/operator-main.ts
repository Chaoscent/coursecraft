// SPDX-License-Identifier: Apache-2.0
import { createDatabase } from './db/connection.js';
import { buildOperatorApp } from './operator/app.js';
import { loadOperatorConfig } from './operator/config.js';
import { blobStoreFromEnv } from './storage.js';
import { StripeClient } from './modules/billing/stripe.js';

const config = loadOperatorConfig();
const migrator = createDatabase(config.migratorDatabaseUrl, { max: 2 });
// Inside one organisation at a time (row-level security), never without one.
const appDb = createDatabase(config.databaseUrl, { max: 2, tenancy: 'multi' });
const app = await buildOperatorApp(config, {
  migrator,
  app: appDb,
  blobs: blobStoreFromEnv(),
  publicUrl: config.publicUrl,
  release: config.release,
  tenancy: config.tenancy,
  storage: config.storage,
  stripe: config.stripeSecretKey ? new StripeClient(config.stripeSecretKey, config.stripeApiBase) : undefined,
});

const shutdown = async () => {
  await app.close();
  await migrator.destroy();
  await appDb.destroy();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

await app.listen({ host: config.host, port: config.port });
