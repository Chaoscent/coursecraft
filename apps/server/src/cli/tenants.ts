// SPDX-License-Identifier: Apache-2.0
import type { BlobStore } from '@coursecraft/storage';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/schema.js';
import { issueSetupToken } from '../modules/setup/service.js';
import { DEFAULT_TENANT_ID, runAsTenant } from '../tenancy/context.js';

/** An origin as the browser sends it: https (http only for localhost), no path. */
const originSchema = z
  .url()
  .transform((value) => new URL(value))
  .refine(
    (url) => url.protocol === 'https:' || url.hostname === 'localhost',
    'https is required (http only for localhost)',
  )
  .refine(
    (url) => url.pathname === '/' && !url.search && !url.hash && !url.username,
    'An origin without path',
  )
  .transform((url) => url.origin);

export const newTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    publicOrigin: originSchema,
    contentOrigin: originSchema,
  })
  .refine((t) => t.publicOrigin !== t.contentOrigin, {
    message: 'The content origin must differ from the public origin',
    path: ['contentOrigin'],
  });

export interface TenantRow {
  id: string;
  name: string;
  publicOrigin: string | null;
  contentOrigin: string | null;
  status: string;
}

/**
 * Creates an organisation (with the migrator role, which alone may change
 * tenants) and hands out its one-time setup token (with the app role, inside
 * the new tenant).
 */
export async function createTenant(
  migrator: Kysely<Database>,
  app: Kysely<Database>,
  input: z.input<typeof newTenantSchema>,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const tenant = newTenantSchema.parse(input);
  const { id } = await migrator
    .insertInto('tenants')
    .values({ name: tenant.name, public_origin: tenant.publicOrigin, content_origin: tenant.contentOrigin })
    .returning('id')
    .executeTakeFirstOrThrow();
  const setup = await newSetupToken(app, id);
  if (!setup) throw new Error('The new tenant has no setup state');
  return { id, ...setup };
}

export function newSetupToken(app: Kysely<Database>, tenantId: string) {
  return runAsTenant({ id: tenantId, publicOrigin: null, contentOrigin: null }, () => issueSetupToken(app));
}

export async function listTenants(db: Kysely<Database>): Promise<TenantRow[]> {
  const rows = await db
    .selectFrom('tenants')
    .select(['id', 'name', 'public_origin', 'content_origin', 'status'])
    .orderBy('created_at')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    publicOrigin: r.public_origin,
    contentOrigin: r.content_origin,
    status: r.status,
  }));
}

export async function setTenantStatus(
  migrator: Kysely<Database>,
  id: string,
  status: 'active' | 'disabled',
): Promise<void> {
  if (id === DEFAULT_TENANT_ID && status === 'disabled')
    throw new Error('The default tenant cannot be disabled');
  const result = await migrator
    .updateTable('tenants')
    .set({ status })
    .where('id', '=', id)
    .executeTakeFirst();
  if (!result.numUpdatedRows) throw new Error(`No tenant ${id}`);
}

/**
 * Removes an organisation for good: every row (foreign keys cascade from the
 * tenant) and every stored file below its prefix. Audit entries go too; keep
 * a backup if records must be retained.
 */
export async function deleteTenant(migrator: Kysely<Database>, blobs: BlobStore, id: string): Promise<void> {
  if (id === DEFAULT_TENANT_ID) throw new Error('The default tenant cannot be deleted');
  const result = await migrator.deleteFrom('tenants').where('id', '=', id).executeTakeFirst();
  if (!result.numDeletedRows) throw new Error(`No tenant ${id}`);
  await blobs.removePrefix(`tenants/${id}`);
}
