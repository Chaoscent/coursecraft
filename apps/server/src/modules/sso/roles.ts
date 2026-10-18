// SPDX-License-Identifier: Apache-2.0
import { SSO_ROLES } from '@coursecraft/shared';
import type { AppContext } from '../../http/context.js';
import type { Row } from './service.js';

type Role = (typeof SSO_ROLES)[number];

export interface GroupRole {
  group: string;
  role: Role;
}

/** Group values as sent by a provider: one string, a list, or nothing; compared case-insensitively. */
export function groupValues(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list.filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase());
}

/**
 * With group mappings configured, the identity provider (directory, OIDC,
 * SAML) decides the Coursecraft roles at every sign-in: the provider's default
 * role plus the roles of matching groups. Administrator is never granted or
 * removed here.
 */
export async function syncRoles(
  ctx: AppContext,
  userId: string,
  row: Row,
  groupRoles: readonly GroupRole[],
  groups: readonly string[],
): Promise<void> {
  if (!groupRoles.length) return;
  const wanted = new Set<Role>([row.default_role]);
  for (const m of groupRoles) if (groups.includes(m.group.toLowerCase())) wanted.add(m.role);
  const stored = await ctx.db.selectFrom('user_roles').select('role').where('user_id', '=', userId).execute();
  const current = new Set(stored.map((r) => r.role).filter((r): r is Role => SSO_ROLES.some((x) => x === r)));
  const remove = [...current].filter((r) => !wanted.has(r));
  const add = [...wanted].filter((r) => !current.has(r));
  if (!remove.length && !add.length) return;
  await ctx.db.transaction().execute(async (tx) => {
    if (remove.length)
      await tx.deleteFrom('user_roles').where('user_id', '=', userId).where('role', 'in', remove).execute();
    if (add.length)
      await tx
        .insertInto('user_roles')
        .values(add.map((role) => ({ user_id: userId, role })))
        .execute();
    await ctx.audit.record(
      {
        actorUserId: userId,
        action: 'user.roles_synced',
        targetType: 'user',
        targetId: userId,
        meta: { provider: row.id, added: add, removed: remove },
      },
      tx,
    );
  });
  await ctx.sessions.markRotate(userId);
}
