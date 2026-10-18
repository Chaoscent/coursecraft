// SPDX-License-Identifier: Apache-2.0
import type { OperatorTenant } from '@coursecraft/shared';
import type { BlobStore } from '@coursecraft/storage';
import type { Kysely } from 'kysely';
import { createTenant, deleteTenant, newSetupToken } from '../cli/tenants.js';
import type { Database } from '../db/schema.js';
import { AppError } from '../http/errors.js';
import { DEFAULT_TENANT_ID, runAsTenant } from '../tenancy/context.js';
import { usage } from '../tenancy/quotas.js';

export interface OperatorDeps {
  /** Owner of the tables (tenants). */
  migrator: Kysely<Database>;
  /** App role, inside one tenant at a time. */
  app: Kysely<Database>;
  blobs: BlobStore;
}

export async function listTenants(deps: OperatorDeps): Promise<OperatorTenant[]> {
  const rows = await deps.migrator.selectFrom('tenants').selectAll().orderBy('created_at').execute();
  const items: OperatorTenant[] = [];
  for (const row of rows) {
    const used = await runAsTenant({ id: row.id, publicOrigin: null, contentOrigin: null }, () =>
      usage({ db: deps.app }),
    );
    items.push({
      id: row.id,
      name: row.name,
      publicOrigin: row.public_origin,
      contentOrigin: row.content_origin,
      status: row.status,
      isDefault: row.id === DEFAULT_TENANT_ID,
      maxUsers: row.max_users,
      maxStorageMb: row.max_storage_mb,
      users: used.users,
      storageBytes: used.storageBytes,
      createdAt: row.created_at.toISOString(),
    });
  }
  return items;
}

export async function addTenant(
  deps: OperatorDeps,
  input: {
    name: string;
    publicOrigin: string;
    contentOrigin: string;
    maxUsers: number | null;
    maxStorageMb: number | null;
  },
) {
  let created;
  try {
    created = await createTenant(deps.migrator, deps.app, input);
  } catch (error) {
    // Validation (origins) and duplicate addresses become a readable answer.
    const message = error instanceof Error ? error.message : 'Invalid input';
    throw new AppError(/duplicate key/.test(message) ? 'conflict' : 'bad_request', message.slice(0, 300));
  }
  await deps.migrator
    .updateTable('tenants')
    .set({ max_users: input.maxUsers, max_storage_mb: input.maxStorageMb })
    .where('id', '=', created.id)
    .execute();
  return { id: created.id, token: created.token, expiresAt: created.expiresAt.toISOString() };
}

export async function updateTenant(
  deps: OperatorDeps,
  id: string,
  input: {
    name?: string | undefined;
    status?: 'active' | 'disabled' | undefined;
    maxUsers?: number | null | undefined;
    maxStorageMb?: number | null | undefined;
  },
): Promise<void> {
  if (id === DEFAULT_TENANT_ID && input.status === 'disabled')
    throw new AppError('bad_request', 'The default organisation cannot be switched off');
  const result = await deps.migrator
    .updateTable('tenants')
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.maxUsers !== undefined ? { max_users: input.maxUsers } : {}),
      ...(input.maxStorageMb !== undefined ? { max_storage_mb: input.maxStorageMb } : {}),
    })
    .where('id', '=', id)
    .executeTakeFirst();
  if (!result.numUpdatedRows) throw new AppError('not_found', 'Organisation not found');
}

export async function setupToken(deps: OperatorDeps, id: string) {
  const exists = await deps.migrator
    .selectFrom('tenants')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  if (!exists) throw new AppError('not_found', 'Organisation not found');
  const setup = await newSetupToken(deps.app, id);
  if (!setup) throw new AppError('conflict', 'Setup of this organisation is already complete');
  return { token: setup.token, expiresAt: setup.expiresAt.toISOString() };
}

export async function removeTenant(deps: OperatorDeps, id: string, confirmName: string): Promise<void> {
  const row = await deps.migrator
    .selectFrom('tenants')
    .select('name')
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new AppError('not_found', 'Organisation not found');
  if (row.name !== confirmName) throw new AppError('bad_request', 'The name does not match');
  try {
    await deleteTenant(deps.migrator, deps.blobs, id);
  } catch (error) {
    throw new AppError('bad_request', error instanceof Error ? error.message : 'Cannot delete');
  }
}
