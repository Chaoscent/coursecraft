// SPDX-License-Identifier: Apache-2.0
import { PGBOSS_SCHEMA, type QueueName } from '@coursecraft/shared';
import { PgBoss } from 'pg-boss';
import { currentScope, DEFAULT_TENANT_ID } from '../tenancy/context.js';

export interface SendOptions {
  /** The job fails (and is not retried) when not finished in time. */
  expireInSeconds?: number;
}

/** Submits background jobs. Payloads hold ids and parameters only. */
export interface JobQueue {
  send(queue: QueueName, data: object, options?: SendOptions): Promise<void>;
}

/** Job queue on PostgreSQL. Schema and queues are created by the migrate step. */
export function createBoss(databaseUrl: string): PgBoss {
  return new PgBoss({
    connectionString: databaseUrl,
    schema: PGBOSS_SCHEMA,
    max: 3,
    migrate: false,
    createSchema: false,
    supervise: true,
    schedule: false,
  });
}

/** Adds the tenant of the current scope, so the worker handles the job for the same organisation. */
export function withTenant(data: object): object {
  const id = currentScope()?.id;
  return id && id !== DEFAULT_TENANT_ID ? { ...data, tenantId: id } : data;
}

export function bossQueue(boss: PgBoss): JobQueue {
  return {
    async send(queue, data, options = {}) {
      await boss.send(queue, withTenant(data), { retryLimit: 0, ...options });
    },
  };
}

/** Records jobs instead of sending them (tests, or a setup without job queue). */
export class RecordingQueue implements JobQueue {
  readonly sent: { queue: QueueName; data: object; options: SendOptions }[] = [];

  send(queue: QueueName, data: object, options: SendOptions = {}): Promise<void> {
    this.sent.push({ queue, data: withTenant(data), options });
    return Promise.resolve();
  }
}
