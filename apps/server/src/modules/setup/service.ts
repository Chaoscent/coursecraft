// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { hashToken, randomToken, safeEqual } from '../../crypto/tokens.js';
import type { Database } from '../../db/schema.js';
import type { AppContext } from '../../http/context.js';

export const SETUP_TOKEN_HOURS = 24;

export async function isSetupRequired(ctx: { db: Kysely<Database> }): Promise<boolean> {
  const row = await ctx.db
    .selectFrom('setup_state')
    .select('completed_at')
    .where('id', '=', 1)
    .executeTakeFirst();
  return !row?.completed_at;
}

/**
 * Creates a new one-time setup token (invalidating any previous one) while
 * setup is incomplete. Returns null once setup is done.
 */
export async function issueSetupToken(
  db: Kysely<Database>,
  options: { onlyIfMissing?: boolean } = {},
): Promise<{ token: string; expiresAt: Date } | null> {
  if (!(await isSetupRequired({ db }))) return null;
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SETUP_TOKEN_HOURS * 3_600_000);
  const values = { token_hash: hashToken(token), token_expires_at: expiresAt };
  const row = await db
    .insertInto('setup_state')
    .values({ id: 1, ...values })
    .onConflict((oc) => {
      const update = oc.constraint('setup_state_pkey').doUpdateSet(values);
      // Several replicas start together: only the first one hands out a token, the
      // others must not invalidate it (the database holds nothing but its hash).
      return options.onlyIfMissing
        ? update.where((eb) =>
            eb.or([eb('setup_state.token_hash', 'is', null), eb('setup_state.token_expires_at', '<=', now)]),
          )
        : update;
    })
    .returning('id')
    .executeTakeFirst();
  return row ? { token, expiresAt } : null;
}

/** Consumes the setup token inside the given transaction; false if invalid. */
export async function consumeSetupToken(tx: Kysely<Database>, token: string): Promise<boolean> {
  const row = await tx
    .selectFrom('setup_state')
    .select(['completed_at', 'token_hash', 'token_expires_at'])
    .where('id', '=', 1)
    .forUpdate()
    .executeTakeFirst();
  if (!row || row.completed_at || !row.token_hash || !row.token_expires_at) return false;
  if (row.token_expires_at <= new Date() || !safeEqual(row.token_hash, hashToken(token))) return false;
  await tx
    .updateTable('setup_state')
    .set({ completed_at: new Date(), token_hash: null, token_expires_at: null })
    .where('id', '=', 1)
    .execute();
  return true;
}

export type SetupContext = Pick<AppContext, 'db'>;
