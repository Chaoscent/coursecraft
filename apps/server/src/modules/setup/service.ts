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
): Promise<{ token: string; expiresAt: Date } | null> {
  if (!(await isSetupRequired({ db }))) return null;
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SETUP_TOKEN_HOURS * 3_600_000);
  await db
    .insertInto('setup_state')
    .values({ id: 1, token_hash: hashToken(token), token_expires_at: expiresAt })
    .onConflict((oc) =>
      oc.column('id').doUpdateSet({ token_hash: hashToken(token), token_expires_at: expiresAt }),
    )
    .execute();
  return { token, expiresAt };
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
