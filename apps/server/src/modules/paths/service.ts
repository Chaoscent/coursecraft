// SPDX-License-Identifier: Apache-2.0
import type { Assignment, PathDetail, PathInput, PathSummary } from '@coursecraft/shared';
import type { AppContext, AuthState } from '../../http/context.js';
import { badRequest, notFound } from '../../http/errors.js';

const toSummary = (r: {
  id: string;
  title: string;
  description: string;
  sequential: boolean;
  status: 'active' | 'archived';
  updated_at: Date;
  stepCount: number;
  assignmentCount: number;
}): PathSummary => ({
  id: r.id,
  title: r.title,
  description: r.description,
  sequential: r.sequential,
  status: r.status,
  stepCount: r.stepCount,
  assignmentCount: r.assignmentCount,
  updatedAt: r.updated_at.toISOString(),
});

async function counts(ctx: AppContext, ids: string[]) {
  if (!ids.length) return { steps: new Map<string, number>(), assignments: new Map<string, number>() };
  const [steps, assignments] = await Promise.all([
    ctx.db
      .selectFrom('path_steps')
      .select(['path_id', (eb) => eb.fn.countAll<string>().as('n')])
      .where('path_id', 'in', ids)
      .groupBy('path_id')
      .execute(),
    ctx.db
      .selectFrom('path_assignments')
      .select(['path_id', (eb) => eb.fn.countAll<string>().as('n')])
      .where('path_id', 'in', ids)
      .groupBy('path_id')
      .execute(),
  ]);
  return {
    steps: new Map(steps.map((r) => [r.path_id, Number(r.n)])),
    assignments: new Map(assignments.map((r) => [r.path_id, Number(r.n)])),
  };
}

export async function listPaths(ctx: AppContext): Promise<PathSummary[]> {
  const rows = await ctx.db.selectFrom('learning_paths').selectAll().orderBy('title').execute();
  const c = await counts(
    ctx,
    rows.map((r) => r.id),
  );
  return rows.map((r) =>
    toSummary({ ...r, stepCount: c.steps.get(r.id) ?? 0, assignmentCount: c.assignments.get(r.id) ?? 0 }),
  );
}

export async function getPath(ctx: AppContext, id: string): Promise<PathDetail> {
  const row = await ctx.db.selectFrom('learning_paths').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw notFound('Path not found');
  const steps = await ctx.db
    .selectFrom('path_steps')
    .innerJoin('library_items', 'library_items.id', 'path_steps.library_item_id')
    .select(['path_steps.library_item_id', 'library_items.title'])
    .where('path_steps.path_id', '=', id)
    .orderBy('path_steps.position')
    .execute();
  const c = await counts(ctx, [id]);
  return {
    ...toSummary({ ...row, stepCount: steps.length, assignmentCount: c.assignments.get(id) ?? 0 }),
    steps: steps.map((s) => ({ itemId: s.library_item_id, title: s.title })),
  };
}

async function assertItems(ctx: AppContext, itemIds: string[]): Promise<void> {
  const found = await ctx.db.selectFrom('library_items').select('id').where('id', 'in', itemIds).execute();
  if (found.length !== itemIds.length) throw badRequest('Unknown library item');
}

export async function savePath(
  ctx: AppContext,
  auth: AuthState,
  id: string | null,
  input: PathInput,
): Promise<string> {
  await assertItems(ctx, input.itemIds);
  const pathId = await ctx.db.transaction().execute(async (tx) => {
    const fields = {
      title: input.title,
      description: input.description,
      sequential: input.sequential,
      status: input.status,
    };
    let target = id;
    if (target) {
      const updated = await tx
        .updateTable('learning_paths')
        .set({ ...fields, updated_at: new Date() })
        .where('id', '=', target)
        .executeTakeFirst();
      if (!updated.numUpdatedRows) throw notFound('Path not found');
      await tx.deleteFrom('path_steps').where('path_id', '=', target).execute();
    } else {
      target = (
        await tx
          .insertInto('learning_paths')
          .values({ ...fields, created_by: auth.userId })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    }
    const pathKey = target;
    await tx
      .insertInto('path_steps')
      .values(
        input.itemIds.map((itemId, position) => ({ path_id: pathKey, position, library_item_id: itemId })),
      )
      .execute();
    await ctx.audit.record(
      {
        actorUserId: auth.userId,
        action: id ? 'path.updated' : 'path.created',
        targetType: 'learning_path',
        targetId: target,
        meta: { steps: input.itemIds.length, sequential: input.sequential },
      },
      tx,
    );
    return target;
  });
  return pathId;
}

export async function deletePath(ctx: AppContext, auth: AuthState, id: string): Promise<void> {
  const deleted = await ctx.db.deleteFrom('learning_paths').where('id', '=', id).executeTakeFirst();
  if (!deleted.numDeletedRows) throw notFound('Path not found');
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'path.deleted',
    targetType: 'learning_path',
    targetId: id,
  });
}

export async function listPathAssignments(ctx: AppContext, id: string): Promise<Assignment[]> {
  const rows = await ctx.db
    .selectFrom('path_assignments')
    .leftJoin('users', 'users.id', 'path_assignments.user_id')
    .leftJoin('groups', 'groups.id', 'path_assignments.group_id')
    .select([
      'path_assignments.id',
      'path_assignments.user_id',
      'path_assignments.group_id',
      'path_assignments.due_at',
      'path_assignments.created_at',
      'users.display_name',
      'groups.name as group_name',
    ])
    .where('path_assignments.path_id', '=', id)
    .orderBy('path_assignments.created_at')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    targetType: r.user_id ? ('user' as const) : ('group' as const),
    targetId: r.user_id ?? r.group_id ?? '',
    targetName: r.display_name ?? r.group_name ?? '',
    dueAt: r.due_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function createPathAssignments(
  ctx: AppContext,
  auth: AuthState,
  id: string,
  input: { userIds: string[]; groupIds: string[]; dueAt: string | null },
): Promise<number> {
  const path = await ctx.db.selectFrom('learning_paths').select('id').where('id', '=', id).executeTakeFirst();
  if (!path) throw notFound('Path not found');
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
      for (const target of ids) {
        const existing = await tx
          .selectFrom('path_assignments')
          .select('id')
          .where('path_id', '=', id)
          .where(column, '=', target)
          .executeTakeFirst();
        if (existing)
          await tx
            .updateTable('path_assignments')
            .set({ due_at: dueAt })
            .where('id', '=', existing.id)
            .execute();
        else
          await tx
            .insertInto('path_assignments')
            .values({ path_id: id, [column]: target, due_at: dueAt, created_by: auth.userId })
            .execute();
        count += 1;
      }
    }
  });
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'path.assigned',
    targetType: 'learning_path',
    targetId: id,
    meta: { users: users.length, groups: groups.length },
  });
  return count;
}

export async function deletePathAssignment(
  ctx: AppContext,
  auth: AuthState,
  id: string,
  assignmentId: string,
): Promise<void> {
  const deleted = await ctx.db
    .deleteFrom('path_assignments')
    .where('id', '=', assignmentId)
    .where('path_id', '=', id)
    .executeTakeFirst();
  if (!deleted.numDeletedRows) throw notFound('Assignment not found');
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'path.unassigned',
    targetType: 'learning_path',
    targetId: id,
  });
}
