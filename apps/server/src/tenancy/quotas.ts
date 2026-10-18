// SPDX-License-Identifier: Apache-2.0
import type { AppContext } from '../http/context.js';
import { AppError } from '../http/errors.js';
import { currentScope, DEFAULT_TENANT_ID } from './context.js';

/** Users and stored bytes of the current organisation (row-level security scopes the sums). */
export async function usage(ctx: Pick<AppContext, 'db'>): Promise<{ users: number; storageBytes: number }> {
  const [users, assets, packages] = await Promise.all([
    ctx.db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow(),
    ctx.db
      .selectFrom('assets')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('size'), eb.lit(0)).as('n'))
      .executeTakeFirstOrThrow(),
    ctx.db
      .selectFrom('packages')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('size'), eb.lit(0)).as('n'))
      .executeTakeFirstOrThrow(),
  ]);
  return { users: Number(users.n), storageBytes: Number(assets.n) + Number(packages.n) };
}

const quotasOf = (ctx: AppContext) => ctx.tenants.quotas(currentScope()?.id ?? DEFAULT_TENANT_ID);

/** Before a new account: the organisation's user limit, if the operator set one. */
export async function assertUserQuota(ctx: AppContext): Promise<void> {
  const { maxUsers } = await quotasOf(ctx);
  if (maxUsers === null) return;
  if ((await usage(ctx)).users >= maxUsers)
    throw new AppError('quota_exceeded', 'The user limit of this organisation is reached');
}

/** Before storing a file of `bytes`: the organisation's storage limit, if set. */
export async function assertStorageQuota(ctx: AppContext, bytes: number): Promise<void> {
  const { maxStorageMb } = await quotasOf(ctx);
  if (maxStorageMb === null) return;
  if ((await usage(ctx)).storageBytes + bytes > maxStorageMb * 1024 * 1024)
    throw new AppError('quota_exceeded', 'The storage limit of this organisation is reached');
}
