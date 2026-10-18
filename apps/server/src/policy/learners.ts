// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import type { AppContext, AuthState } from '../http/context.js';
import { notFound } from '../http/errors.js';

/** Whom a person may see as learners: everyone, or the members of some groups. */
export type LearnerScope =
  { all: true } | { all: false; groupIds: ReadonlySet<string>; userIds: ReadonlySet<string> };

const SETTING = 'trainer_scope';
const settingSchema = z.object({ mode: z.enum(['managed', 'all']) });
export type TrainerScopeMode = z.infer<typeof settingSchema>['mode'];

/**
 * `managed` (default): trainers see only the learners of groups they manage,
 * including subgroups. `all`: every trainer sees every learner, as in a small
 * organisation where that is wanted.
 */
export async function trainerScopeMode(ctx: AppContext): Promise<TrainerScopeMode> {
  const row = await ctx.db
    .selectFrom('settings')
    .select('value')
    .where('key', '=', SETTING)
    .executeTakeFirst();
  const parsed = settingSchema.safeParse(row?.value);
  return parsed.success ? parsed.data.mode : 'managed';
}

export async function saveTrainerScopeMode(
  ctx: AppContext,
  auth: AuthState,
  mode: TrainerScopeMode,
): Promise<void> {
  const value = JSON.stringify({ mode });
  await ctx.db
    .insertInto('settings')
    .values({ key: SETTING, value })
    .onConflict((oc) => oc.constraint('settings_pkey').doUpdateSet({ value, updated_at: new Date() }))
    .execute();
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'settings.trainer_scope_updated',
    targetType: 'settings',
    targetId: SETTING,
    meta: { mode },
  });
}

/** Learners (and groups) the caller may see. Administrators always see everyone. */
export async function learnerScope(ctx: AppContext, auth: AuthState): Promise<LearnerScope> {
  if (auth.roles.includes('admin')) return { all: true };
  if ((await trainerScopeMode(ctx)) === 'all') return { all: true };
  const managed = await ctx.db
    .selectFrom('group_managers')
    .select('group_id')
    .where('user_id', '=', auth.userId)
    .execute();
  const groupIds = new Set(managed.map((m) => m.group_id));
  if (groupIds.size) {
    // Subgroups belong to the managed group.
    const tree = await ctx.db.selectFrom('groups').select(['id', 'parent_id']).execute();
    let grew = true;
    while (grew) {
      grew = false;
      for (const g of tree)
        if (g.parent_id && groupIds.has(g.parent_id) && !groupIds.has(g.id)) {
          groupIds.add(g.id);
          grew = true;
        }
    }
  }
  const members = groupIds.size
    ? await ctx.db
        .selectFrom('group_members')
        .select('user_id')
        .where('group_id', 'in', [...groupIds])
        .execute()
    : [];
  return { all: false, groupIds, userIds: new Set(members.map((m) => m.user_id)) };
}

export const seesUser = (scope: LearnerScope, userId: string): boolean =>
  scope.all || scope.userIds.has(userId);
export const seesGroup = (scope: LearnerScope, groupId: string): boolean =>
  scope.all || scope.groupIds.has(groupId);

/** Refuses as "not found", so ids of people outside the scope do not leak. */
export function assertSeesAll(
  scope: LearnerScope,
  userIds: readonly string[],
  groupIds: readonly string[],
): void {
  if (scope.all) return;
  if (userIds.some((id) => !scope.userIds.has(id)) || groupIds.some((id) => !scope.groupIds.has(id)))
    throw notFound('Unknown user or group');
}
