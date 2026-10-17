// SPDX-License-Identifier: Apache-2.0
import type { MyPath } from '@coursecraft/shared';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';

export interface PathStep {
  pathId: string;
  pathTitle: string;
  sequential: boolean;
  /** 0-based among the steps that are still active. */
  index: number;
  total: number;
  itemId: string;
  dueAt: Date | null;
}

/** Active steps of the paths assigned to a user (directly or through groups). */
export async function assignedPathSteps(
  db: Kysely<Database>,
  userId: string,
  groupIds: string[],
): Promise<PathStep[]> {
  const assignments = await db
    .selectFrom('path_assignments')
    .innerJoin('learning_paths', 'learning_paths.id', 'path_assignments.path_id')
    .select([
      'learning_paths.id',
      'learning_paths.title',
      'learning_paths.sequential',
      'path_assignments.due_at',
    ])
    .where('learning_paths.status', '=', 'active')
    .where((eb) =>
      eb.or([
        eb('path_assignments.user_id', '=', userId),
        ...(groupIds.length ? [eb('path_assignments.group_id', 'in', groupIds)] : []),
      ]),
    )
    .execute();
  if (!assignments.length) return [];
  const paths = new Map<string, { title: string; sequential: boolean; dueAt: Date | null }>();
  for (const a of assignments) {
    const known = paths.get(a.id);
    if (!known) paths.set(a.id, { title: a.title, sequential: a.sequential, dueAt: a.due_at });
    else if (a.due_at && (!known.dueAt || a.due_at < known.dueAt)) known.dueAt = a.due_at;
  }
  const rows = await db
    .selectFrom('path_steps')
    .innerJoin('library_items', 'library_items.id', 'path_steps.library_item_id')
    .select(['path_steps.path_id', 'path_steps.library_item_id'])
    .where('path_steps.path_id', 'in', [...paths.keys()])
    .where('library_items.status', '=', 'active')
    .orderBy('path_steps.path_id')
    .orderBy('path_steps.position')
    .execute();
  const byPath = new Map<string, string[]>();
  for (const r of rows) byPath.set(r.path_id, [...(byPath.get(r.path_id) ?? []), r.library_item_id]);
  const out: PathStep[] = [];
  for (const [pathId, itemIds] of byPath) {
    const p = paths.get(pathId);
    if (!p) continue;
    itemIds.forEach((itemId, index) =>
      out.push({
        pathId,
        pathTitle: p.title,
        sequential: p.sequential,
        index,
        total: itemIds.length,
        itemId,
        dueAt: p.dueAt,
      }),
    );
  }
  return out.sort((a, b) => a.pathTitle.localeCompare(b.pathTitle) || a.index - b.index);
}

/** Items the user has passed, or completed without a failed result (any attempt). */
async function doneItems(db: Kysely<Database>, userId: string, itemIds: string[]): Promise<Set<string>> {
  if (!itemIds.length) return new Set();
  const rows = await db
    .selectFrom('registrations')
    .select('library_item_id')
    .where('user_id', '=', userId)
    .where('library_item_id', 'in', itemIds)
    .where('success', '!=', 'failed')
    .where((eb) => eb.or([eb('success', '=', 'passed'), eb('completion', '=', 'completed')]))
    .execute();
  return new Set(rows.map((r) => r.library_item_id));
}

/**
 * Items that cannot be started yet: reachable only through sequential paths
 * whose earlier steps are not done. Anything assigned directly, or through a
 * path that is not sequential, is open.
 */
export async function lockedItems(
  db: Kysely<Database>,
  userId: string,
  steps: PathStep[],
  direct: Set<string>,
): Promise<Set<string>> {
  const itemIds = [...new Set(steps.filter((s) => s.sequential).map((s) => s.itemId))];
  const done = await doneItems(db, userId, itemIds);
  const byPath = new Map<string, PathStep[]>();
  for (const s of steps) byPath.set(s.pathId, [...(byPath.get(s.pathId) ?? []), s]);
  const open = new Set(direct);
  const lockedSomewhere = new Set<string>();
  for (const list of byPath.values()) {
    list.forEach((s, i) => {
      const blocked = s.sequential && list.slice(0, i).some((earlier) => !done.has(earlier.itemId));
      if (blocked) lockedSomewhere.add(s.itemId);
      else open.add(s.itemId);
    });
  }
  return new Set([...lockedSomewhere].filter((id) => !open.has(id)));
}

export function pathOf(steps: PathStep[], itemId: string): MyPath | null {
  const s = steps.find((x) => x.itemId === itemId);
  return s
    ? { id: s.pathId, title: s.pathTitle, step: s.index + 1, steps: s.total, sequential: s.sequential }
    : null;
}
