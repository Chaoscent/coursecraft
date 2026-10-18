// SPDX-License-Identifier: Apache-2.0
import type { DirectorySyncResult } from '@coursecraft/shared';
import type { AppContext } from '../../http/context.js';
import { clientFor, subjectOf, tlsOptionsFor, type LdapConfig } from './ldap.js';
import { secretAad, type Row } from './service.js';

/** A directory answer that would remove more than this share of accounts is treated as a mistake. */
const MAX_REMOVED_SHARE = 0.5;
const MIN_REMOVED_FOR_GUARD = 5;

/**
 * Deactivates accounts that came in through this directory and no longer
 * appear in it (left the company, disabled there, moved out of the search
 * base). Accounts are never deleted and administrators are never touched, so
 * a wrong filter cannot lock everyone out; a result that would remove many
 * accounts at once is refused.
 */
export async function syncDirectory(ctx: AppContext, row: Row): Promise<DirectorySyncResult> {
  const c = row.config as unknown as LdapConfig & { syncFilter?: string };
  const filter = c.syncFilter || c.userFilter.replaceAll('{username}', '*');
  const client = clientFor(c);
  const present = new Set<string>();
  try {
    if (c.startTls) await client.startTLS(tlsOptionsFor(c));
    if (c.bindDn) {
      await client.bind(c.bindDn, row.secret ? ctx.box.open(row.secret, secretAad(row.id)) : '');
    }
    const { searchEntries } = await client.search(c.userBase, {
      scope: 'sub',
      filter,
      attributes: [c.subjectAttribute],
      explicitBufferAttributes: [c.subjectAttribute],
      paged: { pageSize: 500 },
    });
    for (const entry of searchEntries) {
      const subject = subjectOf(entry[c.subjectAttribute]);
      if (subject) present.add(subject);
    }
  } finally {
    await client.unbind().catch(() => undefined);
  }

  const linked = await ctx.db
    .selectFrom('user_identities')
    .innerJoin('users', 'users.id', 'user_identities.user_id')
    .select(['users.id as userId', 'user_identities.subject as subject'])
    .where('user_identities.provider_id', '=', row.id)
    .where('users.status', '=', 'active')
    .where('users.deleted_at', 'is', null)
    .execute();
  if (present.size === 0) return { checked: linked.length, deactivated: 0, skipped: 'empty' };

  const admins = new Set(
    (await ctx.db.selectFrom('user_roles').select('user_id').where('role', '=', 'admin').execute()).map(
      (r) => r.user_id,
    ),
  );
  const gone = linked.filter((l) => !present.has(l.subject) && !admins.has(l.userId));
  if (gone.length > MIN_REMOVED_FOR_GUARD && gone.length > linked.length * MAX_REMOVED_SHARE)
    return { checked: linked.length, deactivated: 0, skipped: 'too_many' };

  for (const { userId } of gone) {
    await ctx.db.updateTable('users').set({ status: 'disabled' }).where('id', '=', userId).execute();
    await ctx.sessions.revokeAll(userId);
    await ctx.audit.record({
      actorUserId: null,
      action: 'user.deactivated_directory',
      targetType: 'user',
      targetId: userId,
      meta: { provider: row.id },
    });
  }
  return { checked: linked.length, deactivated: gone.length, skipped: null };
}

/** Hourly run for every enabled directory provider that has the sync switched on. */
export async function syncAllDirectories(ctx: AppContext): Promise<number> {
  const rows = await ctx.db
    .selectFrom('sso_providers')
    .selectAll()
    .where('kind', '=', 'ldap')
    .where('enabled', '=', true)
    .execute();
  let deactivated = 0;
  for (const row of rows) {
    if ((row.config as { syncEnabled?: boolean }).syncEnabled !== true) continue;
    try {
      deactivated += (await syncDirectory(ctx, row)).deactivated;
    } catch (error) {
      ctx.log.warn({ err: error, provider: row.id }, 'directory sync failed');
    }
  }
  return deactivated;
}
