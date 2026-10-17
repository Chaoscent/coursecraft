// SPDX-License-Identifier: Apache-2.0
import type { Role, User } from '@coursecraft/shared';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';

/** Whitelist: public sort keys → columns. User input never names a column. */
const SORT_COLUMNS = {
  name: 'users.display_name',
  email: 'users.email',
  created: 'users.created_at',
  lastLogin: 'users.last_login_at',
} as const;

export type UserSortKey = keyof typeof SORT_COLUMNS;

export interface UserFilter {
  q?: string | undefined;
  role?: Role | undefined;
  status?: 'active' | 'disabled' | undefined;
  groupId?: string | undefined;
  sort: UserSortKey;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/** Escapes LIKE wildcards so search input matches literally. */
export function likePattern(input: string): string {
  return `%${input.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listUsers(
  db: Kysely<Database>,
  filter: UserFilter,
): Promise<{ items: User[]; total: number }> {
  let query = db.selectFrom('users').where('users.deleted_at', 'is', null);
  if (filter.q) {
    const pattern = likePattern(filter.q);
    query = query.where((eb) =>
      eb.or([eb('users.display_name', 'ilike', pattern), eb('users.email', 'ilike', pattern)]),
    );
  }
  if (filter.status) query = query.where('users.status', '=', filter.status);
  if (filter.role) {
    const role = filter.role;
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('user_roles')
          .select('user_roles.user_id')
          .whereRef('user_roles.user_id', '=', 'users.id')
          .where('user_roles.role', '=', role),
      ),
    );
  }
  if (filter.groupId) {
    const groupId = filter.groupId;
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('group_members')
          .select('group_members.user_id')
          .whereRef('group_members.user_id', '=', 'users.id')
          .where('group_members.group_id', '=', groupId),
      ),
    );
  }

  const { total } = await query
    .select((eb) => eb.fn.countAll<string>().as('total'))
    .executeTakeFirstOrThrow();
  const rows = await query
    .select(['users.id'])
    .orderBy(SORT_COLUMNS[filter.sort], filter.dir)
    .orderBy('users.id')
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize)
    .execute();
  return {
    items: await loadUsers(
      db,
      rows.map((r) => r.id),
    ),
    total: Number(total),
  };
}

/** Loads users with roles and groups, preserving the order of `ids`. */
export async function loadUsers(db: Kysely<Database>, ids: string[]): Promise<User[]> {
  if (!ids.length) return [];
  const users = await db
    .selectFrom('users')
    .select([
      'id',
      'email',
      'display_name',
      'status',
      'locale',
      'totp_last_step',
      'last_login_at',
      'created_at',
    ])
    .where('id', 'in', ids)
    .execute();
  const roles = await db
    .selectFrom('user_roles')
    .select(['user_id', 'role'])
    .where('user_id', 'in', ids)
    .execute();
  const groups = await db
    .selectFrom('group_members')
    .innerJoin('groups', 'groups.id', 'group_members.group_id')
    .select(['group_members.user_id', 'groups.id', 'groups.name'])
    .where('group_members.user_id', 'in', ids)
    .orderBy('groups.name')
    .execute();
  const byId = new Map(users.map((u) => [u.id, u]));
  return ids.flatMap((id) => {
    const u = byId.get(id);
    if (!u) return [];
    return [
      {
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        status: u.status,
        locale: u.locale,
        roles: roles.filter((r) => r.user_id === id).map((r) => r.role),
        groups: groups.filter((g) => g.user_id === id).map((g) => ({ id: g.id, name: g.name })),
        totpEnabled: u.totp_last_step !== null,
        lastLoginAt: u.last_login_at?.toISOString() ?? null,
        createdAt: u.created_at.toISOString(),
      },
    ];
  });
}

export async function countActiveAdmins(db: Kysely<Database>, excludingUserId?: string): Promise<number> {
  let query = db
    .selectFrom('user_roles')
    .innerJoin('users', 'users.id', 'user_roles.user_id')
    .where('user_roles.role', '=', 'admin')
    .where('users.status', '=', 'active')
    .where('users.deleted_at', 'is', null);
  if (excludingUserId) query = query.where('users.id', '!=', excludingUserId);
  const row = await query.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
  return Number(row.n);
}
