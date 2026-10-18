// SPDX-License-Identifier: Apache-2.0
import { hmac } from '../../crypto/tokens.js';
import type { AppContext } from '../../http/context.js';

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const WINDOW_MS = LOCK_MINUTES * 60_000;

const keyOf = (ctx: AppContext, account: string): string =>
  hmac(ctx.config.ipPepper, `directory:${account.trim().toLowerCase()}`);

/**
 * Per-account guard in front of the directory. The directory has its own
 * lockout; without this guard, guessing passwords for a name from many
 * addresses would lock the real person out of the whole company network.
 * Unknown names are counted too, so the answer never reveals which exist.
 */
export async function isLocked(ctx: AppContext, providerId: string, account: string): Promise<boolean> {
  const row = await ctx.db
    .selectFrom('directory_attempts')
    .select('locked_until')
    .where('provider_id', '=', providerId)
    .where('account_hash', '=', keyOf(ctx, account))
    .executeTakeFirst();
  return !!row?.locked_until && row.locked_until > new Date();
}

export async function recordFailure(ctx: AppContext, providerId: string, account: string): Promise<void> {
  const key = keyOf(ctx, account);
  const now = new Date();
  const row = await ctx.db
    .selectFrom('directory_attempts')
    .select(['failures', 'updated_at'])
    .where('provider_id', '=', providerId)
    .where('account_hash', '=', key)
    .executeTakeFirst();
  const recent = row && now.getTime() - row.updated_at.getTime() < WINDOW_MS;
  const failures = (recent ? row.failures : 0) + 1;
  const lock = failures >= MAX_FAILURES;
  const values = {
    failures: lock ? 0 : failures,
    locked_until: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null,
    updated_at: now,
  };
  await ctx.db
    .insertInto('directory_attempts')
    .values({ provider_id: providerId, account_hash: key, ...values })
    .onConflict((oc) => oc.columns(['provider_id', 'account_hash']).doUpdateSet(values))
    .execute();
  if (lock)
    await ctx.audit.record({
      actorUserId: null,
      action: 'auth.directory_locked',
      targetType: 'sso_provider',
      targetId: providerId,
    });
}

export async function clearFailures(ctx: AppContext, providerId: string, account: string): Promise<void> {
  await ctx.db
    .deleteFrom('directory_attempts')
    .where('provider_id', '=', providerId)
    .where('account_hash', '=', keyOf(ctx, account))
    .execute();
}

/** Counters of the last day are enough to answer "is this name being guessed". */
export async function purgeOldAttempts(ctx: AppContext): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 3_600_000);
  const result = await ctx.db
    .deleteFrom('directory_attempts')
    .where('updated_at', '<', cutoff)
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
