// SPDX-License-Identifier: Apache-2.0
// Security audit (SECURITY_AUDIT.md, F-05): the tenant is set transaction-
// locally (set_config(…, true)), so it travels with each transaction and is
// correct behind a connection pooler. Runs its own throwaway PostgreSQL and
// two PgBouncers (session and transaction mode, testcontainers) and checks
// that the production TenantDriver runs every query as its own tenant through
// each. Before the root fix, the transaction-mode case leaked to the other
// organisation. Never point this at a real installation.
import { randomUUID } from 'node:crypto';
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../apps/server/src/db/connection.js';
import { runAsTenant } from '../../apps/server/src/tenancy/context.js';

const PASSWORD = 'pooler-probe-password-0123456789';
let network: StartedNetwork;
let postgres: StartedTestContainer;
const bouncers: StartedTestContainer[] = [];
const urls = { direct: '', session: '', transaction: '' };

function bouncer(mode: 'session' | 'transaction') {
  return new GenericContainer('edoburu/pgbouncer:latest')
    .withNetwork(network)
    .withEnvironment({
      DB_HOST: 'db',
      DB_PORT: '5432',
      DB_USER: 'postgres',
      DB_PASSWORD: PASSWORD,
      DB_NAME: 'postgres',
      AUTH_TYPE: 'scram-sha-256',
      POOL_MODE: mode,
      DEFAULT_POOL_SIZE: '4',
      LISTEN_PORT: '5432',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
}

const url = (c: StartedTestContainer) =>
  `postgres://postgres:${PASSWORD}@${c.getHost()}:${c.getMappedPort(5432)}/postgres`;

beforeAll(async () => {
  network = await new Network().start();
  postgres = await new GenericContainer('postgres:17-trixie')
    .withNetwork(network)
    .withNetworkAliases('db')
    .withEnvironment({ POSTGRES_PASSWORD: PASSWORD })
    .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();
  urls.direct = url(postgres);
  const [session, transaction] = await Promise.all([bouncer('session'), bouncer('transaction')]);
  bouncers.push(session, transaction);
  urls.session = url(session);
  urls.transaction = url(transaction);
}, 180_000);

afterAll(async () => {
  for (const b of bouncers) await b.stop();
  await postgres?.stop();
  await network?.stop();
});

describe('F-05: tenant setting and connection poolers', () => {
  /** Alternates queries of tenant A (driver a) and tenant B (driver b); returns the tenant each query ran as. */
  async function alternate(connectionString: string) {
    const a = createDatabase(connectionString, { tenancy: 'multi', max: 1 });
    const b = createDatabase(connectionString, { tenancy: 'multi', max: 1 });
    const tenants = { a: randomUUID(), b: randomUUID() };
    const tenantOf = (db: typeof a, id: string) =>
      runAsTenant({ id, publicOrigin: null, contentOrigin: null }, async () => {
        const row = await db
          .selectNoFrom((eb) => eb.fn<string>('current_setting', [eb.val('app.tenant_id')]).as('t'))
          .executeTakeFirstOrThrow();
        return row.t;
      });
    try {
      const runs: { wanted: string; got: string }[] = [];
      for (let i = 0; i < 4; i++) {
        runs.push({ wanted: tenants.a, got: await tenantOf(a, tenants.a) });
        runs.push({ wanted: tenants.b, got: await tenantOf(b, tenants.b) });
      }
      return { tenants, runs };
    } finally {
      await a.destroy();
      await b.destroy();
    }
  }

  it('control: on a direct connection every query runs as its own tenant', async () => {
    const { runs } = await alternate(urls.direct);
    expect(runs.every((r) => r.got === r.wanted)).toBe(true);
  });

  it('the TenantDriver runs every query as its own tenant behind a transaction pooler', async () => {
    // The regression this guards: before the transaction-local fix, alternating
    // tenants here returned the OTHER organisation's id through PgBouncer.
    const { runs } = await alternate(urls.transaction);
    expect(runs.every((r) => r.got === r.wanted)).toBe(true);
  });

  it('the TenantDriver runs every query as its own tenant behind a session pooler', async () => {
    const { runs } = await alternate(urls.session);
    expect(runs.every((r) => r.got === r.wanted)).toBe(true);
  });
});
