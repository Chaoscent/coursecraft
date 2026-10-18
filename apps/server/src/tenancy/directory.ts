// SPDX-License-Identifier: Apache-2.0
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { AppConfig } from '../config/env.js';
import type { Database } from '../db/schema.js';
import { DEFAULT_SCOPE, runAsTenant, type TenantScope } from './context.js';

const CACHE_MS = 30_000;

interface Entry {
  scope: TenantScope;
  active: boolean;
}

/**
 * Tenants by address, cached briefly: every request needs this lookup, and
 * tenants change rarely (a disabled tenant stops answering within the cache
 * time).
 */
export class TenantDirectory {
  readonly #db: Kysely<Database>;
  #loaded = 0;
  #byOrigin = new Map<string, Entry>();
  #byId = new Map<string, Entry>();
  #loading: Promise<void> | null = null;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async #refresh(): Promise<void> {
    if (Date.now() - this.#loaded < CACHE_MS) return;
    this.#loading ??= this.#db
      .selectFrom('tenants')
      .select(['id', 'public_origin', 'content_origin', 'status'])
      .execute()
      .then((rows) => {
        const byOrigin = new Map<string, Entry>();
        const byId = new Map<string, Entry>();
        for (const row of rows) {
          const entry = {
            scope: { id: row.id, publicOrigin: row.public_origin, contentOrigin: row.content_origin },
            active: row.status === 'active',
          };
          byId.set(row.id, entry);
          if (row.public_origin) byOrigin.set(row.public_origin, entry);
          if (row.content_origin) byOrigin.set(row.content_origin, entry);
        }
        this.#byOrigin = byOrigin;
        this.#byId = byId;
        this.#loaded = Date.now();
      })
      .finally(() => {
        this.#loading = null;
      });
    await this.#loading;
  }

  /** Forgets the cache (after a tenant was created or changed in this process). */
  invalidate(): void {
    this.#loaded = 0;
  }

  async byOrigin(origin: string): Promise<Entry | null> {
    await this.#refresh();
    return this.#byOrigin.get(origin) ?? null;
  }

  async byId(id: string): Promise<TenantScope | null> {
    await this.#refresh();
    return this.#byId.get(id)?.scope ?? null;
  }

  /** Tenants that periodic work runs for. */
  async active(): Promise<TenantScope[]> {
    await this.#refresh();
    return [...this.#byId.values()].filter((e) => e.active).map((e) => e.scope);
  }
}

/**
 * First hook of every request: decides the tenant from the address the
 * browser used. The rest of the request (hooks, handler, every query) runs in
 * that tenant's scope. A single installation always uses the default tenant.
 */
export function tenantHook(config: AppConfig, directory: TenantDirectory) {
  return (request: FastifyRequest, reply: FastifyReply, done: (error?: Error) => void): void => {
    if (config.tenancy === 'single') {
      runAsTenant(DEFAULT_SCOPE, done);
      return;
    }
    // Probes call the pod by its IP address; they touch no tenant data.
    const path = request.url.split('?')[0];
    if (path === '/healthz' || path === '/readyz') {
      done();
      return;
    }
    const origin = `${request.protocol}://${request.host}`;
    directory.byOrigin(origin).then(
      (entry) => {
        if (!entry) {
          void reply
            .status(404)
            .send({ error: { code: 'not_found', message: 'Unknown address', requestId: request.id } });
          return;
        }
        if (!entry.active) {
          void reply.status(503).send({
            error: { code: 'unavailable', message: 'This site is switched off', requestId: request.id },
          });
          return;
        }
        runAsTenant(entry.scope, done);
      },
      (error: unknown) => done(error instanceof Error ? error : new Error('tenant lookup failed')),
    );
  };
}

/** Runs `task` once per active tenant, each in its own scope; one tenant failing does not stop the others. */
export async function forEachTenant(
  config: AppConfig,
  directory: TenantDirectory,
  task: (scope: TenantScope) => Promise<void>,
  onError: (scope: TenantScope, error: unknown) => void,
): Promise<void> {
  const scopes = config.tenancy === 'single' ? [DEFAULT_SCOPE] : await directory.active();
  for (const scope of scopes) {
    try {
      await runAsTenant(scope, () => task(scope));
    } catch (error) {
      onError(scope, error);
    }
  }
}
