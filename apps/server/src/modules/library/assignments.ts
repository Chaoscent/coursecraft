// SPDX-License-Identifier: Apache-2.0
import type { Assignment } from '@coursecraft/shared';
import type { AppContext, AuthState } from '../../http/context.js';
import { badRequest, notFound } from '../../http/errors.js';

export async function assertItem(ctx: AppContext, id: string): Promise<{ id: string; title: string }> {
  const item = await ctx.db
    .selectFrom('library_items')
    .select(['id', 'title'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!item) throw notFound('Library item not found');
  return item;
}

export async function listAssignments(ctx: AppContext, itemId: string): Promise<Assignment[]> {
  await assertItem(ctx, itemId);
  const rows = await ctx.db
    .selectFrom('assignments')
    .leftJoin('users', 'users.id', 'assignments.user_id')
    .leftJoin('groups', 'groups.id', 'assignments.group_id')
    .select([
      'assignments.id',
      'assignments.user_id',
      'assignments.group_id',
      'assignments.due_at',
      'assignments.created_at',
      'users.display_name',
      'groups.name',
    ])
    .where('assignments.library_item_id', '=', itemId)
    .orderBy('assignments.created_at')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    targetType: r.user_id ? ('user' as const) : ('group' as const),
    targetId: (r.user_id ?? r.group_id) as string,
    targetName: (r.user_id ? r.display_name : r.name) ?? '',
    dueAt: r.due_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  }));
}

/** Assigns an item to users and groups; existing assignments of the same target get the new due date. */
export async function createAssignments(
  ctx: AppContext,
  auth: AuthState,
  itemId: string,
  input: { userIds: string[]; groupIds: string[]; dueAt: string | null },
): Promise<number> {
  await assertItem(ctx, itemId);
  const users = input.userIds.length
    ? await ctx.db
        .selectFrom('users')
        .select('id')
        .where('id', 'in', input.userIds)
        .where('deleted_at', 'is', null)
        .execute()
    : [];
  const groups = input.groupIds.length
    ? await ctx.db.selectFrom('groups').select('id').where('id', 'in', input.groupIds).execute()
    : [];
  if (users.length !== new Set(input.userIds).size || groups.length !== new Set(input.groupIds).size)
    throw badRequest('Unknown user or group');
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;
  let count = 0;
  await ctx.db.transaction().execute(async (tx) => {
    for (const [column, ids] of [
      ['user_id', users.map((u) => u.id)],
      ['group_id', groups.map((g) => g.id)],
    ] as const) {
      for (const id of ids) {
        const existing = await tx
          .selectFrom('assignments')
          .select('id')
          .where('library_item_id', '=', itemId)
          .where(column, '=', id)
          .executeTakeFirst();
        if (existing)
          await tx.updateTable('assignments').set({ due_at: dueAt }).where('id', '=', existing.id).execute();
        else
          await tx
            .insertInto('assignments')
            .values({ library_item_id: itemId, [column]: id, due_at: dueAt, created_by: auth.userId })
            .execute();
        count += 1;
      }
    }
  });
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'assignment.created',
    targetType: 'library_item',
    targetId: itemId,
    meta: { users: users.length, groups: groups.length },
  });
  return count;
}

export async function deleteAssignment(
  ctx: AppContext,
  auth: AuthState,
  itemId: string,
  assignmentId: string,
) {
  const result = await ctx.db
    .deleteFrom('assignments')
    .where('id', '=', assignmentId)
    .where('library_item_id', '=', itemId)
    .executeTakeFirst();
  if (!result.numDeletedRows) throw notFound('Assignment not found');
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'assignment.deleted',
    targetType: 'library_item',
    targetId: itemId,
  });
}
