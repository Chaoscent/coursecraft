// SPDX-License-Identifier: Apache-2.0
// Security audit (SECURITY_AUDIT.md, F-05): the tenant is set per database
// session. Behind a transaction-mode pooler that leaks between connections.
// Runs its own throwaway PostgreSQL and two PgBouncers (testcontainers):
// - shows the leak with the production TenantDriver,
// - validates the DRAFTED startup check `assertSessionPooling` (copied from
//   the draft in SECURITY_AUDIT.md; replace with an import once it exists).
// Never point this at a real installation.
import { randomUUID } from 'node:crypto';
// eslint-disable-next-line no-restricted-imports -- audit test: the drafted check uses pg directly, like db/connection.ts
import pg from 'pg';
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

/** DRAFT (SECURITY_AUDIT.md F-05): fails fast unless every connection keeps its own session state. */
async function assertSessionPooling(connectionString: string): Promise<void> {
  const clients = [new pg.Client({ connectionString }), new pg.Client({ connectionString })];
  await Promise.all(clients.map((c) => c.connect()));
  try {
    const markers = clients.map(() => randomUUID());
    const pids: number[] = [];
    // Sequential on purpose: a pooler hands the server connection just released by A to B.
    for (const [i, c] of clients.entries()) {
      const { rows } = await c.query<{ pid: number }>(
        "select set_config('app.pooler_probe', $1, false), pg_backend_pid() as pid",
        [markers[i]],
      );
      pids.push(rows[0]?.pid ?? -1);
    }
    for (let round = 0; round < 3; round++)
      for (const [i, c] of clients.entries()) {
        const { rows } = await c.query<{ v: string | null; pid: number }>(
          "select current_setting('app.pooler_probe', true) as v, pg_backend_pid() as pid",
        );
        if (rows[0]?.v !== markers[i] || rows[0]?.pid !== pids[i])
          throw new Error(
            'The database connection does not keep session state between statements ' +
              '(a pooler in transaction or statement mode?). Several organisations need session ' +
              'pooling or a direct connection; see SECURITY.md.',
          );
      }
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}

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

  it('the production TenantDriver runs queries as the OTHER tenant behind a transaction pooler', async () => {
    const { tenants, runs } = await alternate(urls.transaction);
    const wrong = runs.filter((r) => r.got !== r.wanted);
    expect(wrong.length).toBeGreaterThan(0);
    // Not an error or an empty value: the other organisation's id, so RLS would show its rows.
    for (const r of wrong) expect(r.got).toBe(r.wanted === tenants.a ? tenants.b : tenants.a);
  });

  it('the drafted startup check passes on a direct connection', async () => {
    await expect(assertSessionPooling(urls.direct)).resolves.toBeUndefined();
  });

  it('the drafted startup check passes behind a session-mode pooler', async () => {
    await expect(assertSessionPooling(urls.session)).resolves.toBeUndefined();
  });

  it('the drafted startup check fails fast behind a transaction-mode pooler', async () => {
    await expect(assertSessionPooling(urls.transaction)).rejects.toThrow(/does not keep session state/);
  });
});
