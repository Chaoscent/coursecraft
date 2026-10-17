// SPDX-License-Identifier: Apache-2.0
import type { ReportRow } from '@coursecraft/shared';
import type { AppContext, AuthState } from '../../http/context.js';
import { notFound } from '../../http/errors.js';
import type { PackageManifest } from '../library/manifest.js';
import { assertItem } from '../library/assignments.js';
import { learningStatus } from '../learning/projection.js';

/** Groups and all their descendants. */
async function withDescendants(ctx: AppContext, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const groups = await ctx.db.selectFrom('groups').select(['id', 'parent_id']).execute();
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups)
      if (g.parent_id && out.has(g.parent_id) && !out.has(g.id)) {
        out.add(g.id);
        grew = true;
      }
  }
  return [...out];
}

/** Every learner with an assignment (direct or via group) or an attempt, with their latest state. */
export async function itemReport(ctx: AppContext, itemId: string) {
  const item = await assertItem(ctx, itemId);
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
  for (const a of assignments) {
    if (!a.group_id) continue;
    const groups = await withDescendants(ctx, [a.group_id]);
    const members = await ctx.db
      .selectFrom('group_members')
      .select('user_id')
      .where('group_id', 'in', groups)
      .execute();
    for (const m of members) setDue(m.user_id, a.due_at);
  }
  const regs = await ctx.db
    .selectFrom('registrations')
    .selectAll()
    .where('library_item_id', '=', itemId)
    .orderBy('attempt', 'desc')
    .execute();
  const userIds = [...new Set([...due.keys(), ...regs.map((r) => r.user_id)])];
  const users = userIds.length
    ? await ctx.db
        .selectFrom('users')
        .select(['id', 'display_name', 'email'])
        .where('id', 'in', userIds)
        .where('deleted_at', 'is', null)
        .execute()
    : [];
  const now = Date.now();
  const rows: ReportRow[] = users.map((u) => {
    const mine = regs.filter((r) => r.user_id === u.id);
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

  const responses = await ctx.db
    .selectFrom('quiz_responses')
    .innerJoin('registrations', 'registrations.id', 'quiz_responses.registration_id')
    .select([
      'quiz_responses.question_id',
      'quiz_responses.description',
      'quiz_responses.interaction_type',
      'quiz_responses.success',
      'quiz_responses.needs_manual_grading',
      'quiz_responses.manual_score',
    ])
    .where('registrations.library_item_id', '=', itemId)
    .execute();
  const stats = new Map<
    string,
    {
      questionId: string;
      description: string;
      interactionType: string;
      answers: number;
      correct: number;
      pendingGrading: number;
    }
  >();
  for (const r of responses) {
    const s = stats.get(r.question_id) ?? {
      questionId: r.question_id,
      description: r.description,
      interactionType: r.interaction_type,
      answers: 0,
      correct: 0,
      pendingGrading: 0,
    };
    s.answers += 1;
    if (r.success) s.correct += 1;
    if (r.needs_manual_grading && r.manual_score === null) s.pendingGrading += 1;
    if (!s.description && r.description) s.description = r.description;
    stats.set(r.question_id, s);
  }
  return {
    item,
    rows,
    questions: [...stats.values()].sort((a, b) => a.questionId.localeCompare(b.questionId)),
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

export function reportCsv(rows: ReportRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows)
    lines.push(
      [
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
      ]
        .map(csvCell)
        .join(','),
    );
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

export async function gradingQueue(ctx: AppContext) {
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
