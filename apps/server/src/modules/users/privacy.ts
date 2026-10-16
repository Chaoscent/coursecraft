// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { AppContext } from '../../http/context.js';

/**
 * Personal data export and erasure (GDPR Art. 15, 17, 20). Modules that store
 * personal data register a contributor so export and deletion stay complete.
 */
export interface PrivacyContributor {
  name: string;
  export(db: Kysely<Database>, userId: string): Promise<unknown>;
  erase(db: Kysely<Database>, userId: string): Promise<void>;
}

const contributors: PrivacyContributor[] = [];

export function registerPrivacyContributor(contributor: PrivacyContributor): void {
  if (!contributors.some((c) => c.name === contributor.name)) contributors.push(contributor);
}

export async function exportUserData(
  ctx: Pick<AppContext, 'db'>,
  userId: string,
): Promise<Record<string, unknown>> {
  const user = await ctx.db
    .selectFrom('users')
    .select(['id', 'email', 'display_name', 'locale', 'status', 'created_at', 'updated_at', 'last_login_at'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  const roles = await ctx.db.selectFrom('user_roles').select('role').where('user_id', '=', userId).execute();
  const groups = await ctx.db
    .selectFrom('group_members')
    .innerJoin('groups', 'groups.id', 'group_members.group_id')
    .select(['groups.id', 'groups.name'])
    .where('group_members.user_id', '=', userId)
    .execute();
  const sessions = await ctx.db
    .selectFrom('sessions')
    .select(['created_at', 'last_seen_at', 'user_agent'])
    .where('user_id', '=', userId)
    .execute();
  const audit = await ctx.db
    .selectFrom('audit_log')
    .select(['at', 'action', 'target_type', 'target_id', 'meta'])
    .where('actor_user_id', '=', userId)
    .orderBy('at', 'asc')
    .execute();

  const data: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    profile: user,
    roles: roles.map((r) => r.role),
    groups,
    sessions,
    activity: audit,
  };
  for (const contributor of contributors) data[contributor.name] = await contributor.export(ctx.db, userId);
  return data;
}

/**
 * Erases personal data. The user row stays as a tombstone without personal
 * fields, so audit entries keep a stable reference.
 */
export async function eraseUser(tx: Kysely<Database>, userId: string): Promise<void> {
  for (const contributor of contributors) await contributor.erase(tx, userId);
  await tx.deleteFrom('sessions').where('user_id', '=', userId).execute();
  await tx.deleteFrom('login_challenges').where('user_id', '=', userId).execute();
  await tx.deleteFrom('group_members').where('user_id', '=', userId).execute();
  await tx.deleteFrom('user_roles').where('user_id', '=', userId).execute();
  await tx
    .updateTable('users')
    .set({
      email: `deleted-${userId}@invalid`,
      display_name: 'Deleted user',
      password_hash: null,
      totp_secret: null,
      totp_last_step: null,
      status: 'disabled',
      last_login_at: null,
      deleted_at: new Date(),
      updated_at: new Date(),
    })
    .where('id', '=', userId)
    .execute();
}
