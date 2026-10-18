// SPDX-License-Identifier: Apache-2.0
import { learnerScope, seesUser } from '../../policy/learners.js';
import type { ReportRow } from '@coursecraft/shared';
import type { AppContext, AuthState } from '../../http/context.js';
import { notFound } from '../../http/errors.js';
import type { PackageManifest } from '../library/manifest.js';
import { assertItem } from '../library/assignments.js';
import { learningStatus } from '../learning/projection.js';

/** Rows per query for id lists: PostgreSQL allows at most 65,535 parameters per statement. */
const CHUNK = 5000;

const chunks = <T>(list: T[]): T[][] =>
  Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => list.slice(i * CHUNK, (i + 1) * CHUNK));

/** Every learner with an assignment (direct or via group) or an attempt, with their latest state. */
export async function itemReport(ctx: AppContext, auth: AuthState, itemId: string) {
  const item = await assertItem(ctx, itemId);
  const scope = await learnerScope(ctx, auth);
  const assignments = await ctx.db
    .selectFrom('assignments')
    .select(['user_id', 'group_id', 'due_at'])
    .where('library_item_id', '=', itemId)
    .execute();
  const due = new Map<string, Date | null>();
  const setDue = (userId: string, d: Date | null) => {
    const known = due.get(userId);
    if (known === undefined || (d && (!known || d < known))) due.set(userId, d);
  };
  for (const a of assignments) if (a.user_id) setDue(a.user_id, a.due_at);

  const groupAssignments = assignments.filter((a) => a.group_id);
  if (groupAssignments.length) {
    // One read of the group tree; each assignment then reaches its group and all subgroups.
    const tree = await ctx.db.selectFrom('groups').select(['id', 'parent_id']).execute();
    const children = new Map<string, string[]>();
    for (const g of tree)
      if (g.parent_id) children.set(g.parent_id, [...(children.get(g.parent_id) ?? []), g.id]);
    const descendants = (root: string): string[] => {
      const out = new Set([root]);
      const queue = [root];
      for (let id = queue.pop(); id !== undefined; id = queue.pop())
        for (const child of children.get(id) ?? []) {
          if (out.has(child)) continue;
          out.add(child);
          queue.push(child);
        }
      return [...out];
    };
    for (const a of groupAssignments) {
      const groupIds = descendants(a.group_id ?? '');
      const members = await ctx.db
        .selectFrom('group_members')
        .select('user_id')
        .where('group_id', 'in', groupIds)
        .execute();
      for (const m of members) setDue(m.user_id, a.due_at);
    }
  }

  const regs = await ctx.db
    .selectFrom('registrations')
    .selectAll()
    .where('library_item_id', '=', itemId)
    .orderBy('attempt', 'desc')
    .execute();
  const byUser = new Map<string, typeof regs>();
  for (const r of regs) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);

  const userIds = [...new Set([...due.keys(), ...byUser.keys()])].filter((id) => seesUser(scope, id));
  const users = (
    await Promise.all(
      chunks(userIds).map((ids) =>
        ctx.db
          .selectFrom('users')
          .select(['id', 'display_name', 'email'])
          .where('id', 'in', ids)
          .where('deleted_at', 'is', null)
          .execute(),
      ),
    )
  ).flat();
  const now = Date.now();
  const rows: ReportRow[] = users.map((u) => {
    const mine = byUser.get(u.id) ?? [];
    const latest = mine[0];
    const status = learningStatus(latest);
    const dueAt = due.get(u.id) ?? null;
    const done = status === 'completed' || status === 'passed';
    return {
      userId: u.id,
      displayName: u.display_name,
      email: u.email,
      status,
      scoreScaled: latest?.score_scaled ?? null,
      attempts: mine.length,
      timeSpentMs: mine.reduce((n, r) => n + Number(r.time_spent_ms), 0),
      dueAt: dueAt?.toISOString() ?? null,
      overdue: !!dueAt && !done && dueAt.getTime() < now,
      completedAt: latest?.completed_at?.toISOString() ?? null,
      lastActivityAt: latest?.last_activity_at.toISOString() ?? null,
    };
  });
  rows.sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Counted in the database: a popular course has hundreds of thousands of responses.
  const stats = await ctx.db
    .selectFrom('quiz_responses')
    .innerJoin('registrations', 'registrations.id', 'quiz_responses.registration_id')
    .select((eb) => [
      'quiz_responses.question_id',
      eb.fn.max('quiz_responses.description').as('description'),
      eb.fn.min('quiz_responses.interaction_type').as('interaction_type'),
      eb.fn.countAll<string>().as('answers'),
      eb.fn
        .sum<string>(eb.case().when('quiz_responses.success', '=', true).then(1).else(0).end())
        .as('correct'),
      eb.fn
        .sum<string>(
          eb
            .case()
            .when(
              eb.and([
                eb('quiz_responses.needs_manual_grading', '=', true),
                eb('quiz_responses.manual_score', 'is', null),
              ]),
            )
            .then(1)
            .else(0)
            .end(),
        )
        .as('pending'),
    ])
    .where('registrations.library_item_id', '=', itemId)
    // Statistics only over the learners the caller may see.
    .$if(!scope.all, (q) =>
      q.where('registrations.user_id', 'in', [...userIds, '00000000-0000-0000-0000-000000000000']),
    )
    .groupBy('quiz_responses.question_id')
    .orderBy('quiz_responses.question_id')
    .execute();
  return {
    item,
    rows,
    questions: stats.map((q) => ({
      questionId: q.question_id,
      description: q.description ?? '',
      interactionType: q.interaction_type ?? '',
      answers: Number(q.answers),
      correct: Number(q.correct),
      pendingGrading: Number(q.pending),
    })),
  };
}

/** Byte order mark: spreadsheet programs then read the file as UTF-8. */
const BOM = String.fromCharCode(0xfeff);
const CSV_HEADER = [
  'Name',
  'E-Mail',
  'Status',
  'Score (%)',
  'Attempts',
  'Time (min)',
  'Due',
  'Overdue',
  'Completed',
  'Last activity',
];

/** CSV cell; values starting with formula characters are prefixed so spreadsheets do not evaluate them. */
export function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per learner, the same columns for CSV and XLSX. */
export function reportTable(rows: ReportRow[]): { header: string[]; cells: (string | number | null)[][] } {
  return {
    header: CSV_HEADER,
    cells: rows.map((r) => [
      r.displayName,
      r.email,
      r.status,
      r.scoreScaled === null ? null : Math.round(r.scoreScaled * 100),
      r.attempts,
      Math.round(r.timeSpentMs / 60_000),
      r.dueAt,
      r.overdue ? 'yes' : 'no',
      r.completedAt,
      r.lastActivityAt,
    ]),
  };
}

export function reportCsv(rows: ReportRow[]): string {
  const { header, cells } = reportTable(rows);
  const lines = [header.join(','), ...cells.map((row) => row.map(csvCell).join(','))];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

export async function gradingQueue(ctx: AppContext, auth: AuthState) {
  const scope = await learnerScope(ctx, auth);
  const rows = await ctx.db
    .selectFrom('quiz_responses')
    .innerJoin('registrations', 'registrations.id', 'quiz_responses.registration_id')
    .innerJoin('library_items', 'library_items.id', 'registrations.library_item_id')
    .innerJoin('users', 'users.id', 'registrations.user_id')
    .select([
      'quiz_responses.registration_id',
      'quiz_responses.question_id',
      'quiz_responses.description',
      'quiz_responses.response',
      'quiz_responses.score_max',
      'quiz_responses.answered_at',
      'library_items.title',
      'users.display_name',
    ])
    .where('quiz_responses.needs_manual_grading', '=', true)
    .where('quiz_responses.manual_score', 'is', null)
    .$if(!scope.all, (q) =>
      q.where('registrations.user_id', 'in', [
        ...(scope.all ? [] : scope.userIds),
        '00000000-0000-0000-0000-000000000000',
      ]),
    )
    .orderBy('quiz_responses.answered_at')
    .limit(500)
    .execute();
  return rows.map((r) => ({
    registrationId: r.registration_id,
    questionId: r.question_id,
    itemTitle: r.title,
    learnerName: r.display_name,
    description: r.description,
    response: r.response,
    scoreMax: r.score_max,
    answeredAt: r.answered_at.toISOString(),
  }));
}

/**
 * Records a manual grade and recomputes the registration score from all
 * scored responses; with a mastery score the pass state follows.
 */
export async function grade(
  ctx: AppContext,
  auth: AuthState,
  input: { registrationId: string; questionId: string; score: number },
): Promise<void> {
  const owner = await ctx.db
    .selectFrom('registrations')
    .select('user_id')
    .where('id', '=', input.registrationId)
    .executeTakeFirst();
  if (!owner || !seesUser(await learnerScope(ctx, auth), owner.user_id)) throw notFound('Response not found');
  await ctx.db.transaction().execute(async (tx) => {
    const response = await tx
      .selectFrom('quiz_responses')
      .select(['score_max'])
      .where('registration_id', '=', input.registrationId)
      .where('question_id', '=', input.questionId)
      .where('needs_manual_grading', '=', true)
      .executeTakeFirst();
    if (!response) throw notFound('Response not found');
    const score = response.score_max !== null ? Math.min(input.score, response.score_max) : input.score;
    await tx
      .updateTable('quiz_responses')
      .set({ manual_score: score, graded_by: auth.userId, graded_at: new Date(), success: score > 0 })
      .where('registration_id', '=', input.registrationId)
      .where('question_id', '=', input.questionId)
      .execute();
    const all = await tx
      .selectFrom('quiz_responses')
      .select(['score_raw', 'score_max', 'manual_score', 'needs_manual_grading'])
      .where('registration_id', '=', input.registrationId)
      .execute();
    const scored = all.filter((r) => r.score_max !== null && r.score_max > 0);
    if (!scored.length || scored.some((r) => r.needs_manual_grading && r.manual_score === null)) return;
    const max = scored.reduce((n, r) => n + (r.score_max ?? 0), 0);
    const got = scored.reduce((n, r) => n + (r.manual_score ?? r.score_raw ?? 0), 0);
    const scaled = Math.min(1, Math.max(0, got / max));
    const reg = await tx
      .selectFrom('registrations')
      .innerJoin('packages', 'packages.id', 'registrations.package_id')
      .select(['packages.manifest'])
      .where('registrations.id', '=', input.registrationId)
      .executeTakeFirstOrThrow();
    const mastery = (reg.manifest as unknown as PackageManifest).masteryScore;
    await tx
      .updateTable('registrations')
      .set({
        score_scaled: scaled,
        ...(mastery !== null ? { success: scaled >= mastery ? 'passed' : 'failed' } : {}),
      })
      .where('id', '=', input.registrationId)
      .execute();
  });
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'grading.graded',
    targetType: 'registration',
    targetId: input.registrationId,
  });
}
