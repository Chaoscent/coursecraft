// SPDX-License-Identifier: Apache-2.0
import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_TENANT_ID } from '../db/migrations/sql-helpers.js';

export { DEFAULT_TENANT_ID };

/** The organisation a request or job works for. */
export interface TenantScope {
  id: string;
  /** Origins of this tenant; null means "use the installation's configured addresses". */
  publicOrigin: string | null;
  contentOrigin: string | null;
}

const storage = new AsyncLocalStorage<TenantScope>();

export const DEFAULT_SCOPE: TenantScope = { id: DEFAULT_TENANT_ID, publicOrigin: null, contentOrigin: null };

/** Runs `work` for one tenant: every query and stored file inside belongs to it. */
export function runAsTenant<T>(scope: TenantScope, work: () => T): T {
  return storage.run(scope, work);
}

/** Enters a tenant for the rest of the current asynchronous flow (request hooks). */
export function enterTenant(scope: TenantScope): void {
  storage.enterWith(scope);
}

export function currentScope(): TenantScope | undefined {
  return storage.getStore();
}
