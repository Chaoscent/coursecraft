// SPDX-License-Identifier: Apache-2.0
import type { LearningStatus } from '@coursecraft/shared';
import type { Kysely } from 'kysely';
import type { Completion, Database, Success } from '../../db/schema.js';

/**
 * Projects learning records (SCORM runtime data, xAPI statements) onto
 * registrations and quiz responses, the tables that reports read. Raw
 * records stay stored; projections can be rebuilt from them.
 */

export interface Outcome {
  completion?: Completion;
  success?: Success;
  scoreScaled?: number | null;
  addTimeMs?: number;
}

export interface ResponseRow {
  questionId: string;
  description: string;
  interactionType: string;
  response: string;
  success: boolean | null;
  scoreRaw: number | null;
  scoreMax: number | null;
  needsManualGrading: boolean;
}

const MAX_TEXT = 4000;
const clip = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** ISO 8601 duration (PT1H2M3.5S, also with days) → milliseconds. */
export function parseIsoDuration(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const m =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value,
    );
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return Math.round((((d ?? 0) * 24 + (h ?? 0)) * 60 * 60 + (min ?? 0) * 60 + (s ?? 0)) * 1000);
}

/** SCORM 1.2 CMITimespan HHHH:MM:SS.SS → milliseconds. */
export function parseScormTime(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const m = /^(\d{2,4}):(\d{2}):(\d{2})(\.\d{1,2})?$/.exec(value);
  if (!m) return 0;
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4] ?? 0)) * 1000);
}

export function learningStatus(
  row: { completion: Completion; success: Success } | undefined,
): LearningStatus {
  if (!row) return 'not_started';
  if (row.success === 'passed') return 'passed';
  if (row.success === 'failed') return 'failed';
  if (row.completion === 'completed') return 'completed';
  return 'in_progress';
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** SCORM runtime data (scorm-again JSON) → outcome and responses. */
export function fromScorm(
  kind: 'scorm12' | 'scorm2004',
  cmiInput: Record<string, unknown>,
  options: { masteryScore: number | null; finished: boolean },
): { outcome: Outcome; responses: ResponseRow[] } {
  const cmi = obj(cmiInput);
  const outcome: Outcome = {};
  const responses: ResponseRow[] = [];
  const interactions = Object.values(obj(cmi['interactions'])).map(obj);

  if (kind === 'scorm12') {
    const core = obj(cmi['core']);
    const status = core['lesson_status'];
    const score = obj(core['score']);
    const raw = num(score['raw']);
    const min = num(score['min']) ?? 0;
    const max = num(score['max']) ?? 100;
    if (raw !== null && max > min) outcome.scoreScaled = clamp01((raw - min) / (max - min));
    if (status === 'passed' || status === 'failed' || status === 'completed')
      outcome.completion = 'completed';
    else if (status === 'incomplete' || status === 'browsed') outcome.completion = 'incomplete';
    if (status === 'passed') outcome.success = 'passed';
    if (status === 'failed') outcome.success = 'failed';
    // With a mastery score the LMS decides from the score (SCORM 1.2 RTE 3.4.4).
    if (options.masteryScore !== null && outcome.scoreScaled !== undefined && outcome.scoreScaled !== null)
      outcome.success = outcome.scoreScaled >= options.masteryScore ? 'passed' : 'failed';
    if (options.finished) outcome.addTimeMs = parseScormTime(core['session_time']);
    for (const i of interactions)
      if (typeof i['id'] === 'string' && i['id'])
        responses.push({
          questionId: clip(i['id']),
          description: '',
          interactionType: clip(i['type']) || 'other',
          response: clip(i['student_response']),
          success: i['result'] === 'correct' ? true : i['result'] === 'wrong' ? false : null,
          scoreRaw: null,
          scoreMax: null,
          needsManualGrading: false,
        });
  } else {
    const completion = cmi['completion_status'];
    const success = cmi['success_status'];
    const score = obj(cmi['score']);
    const scaled = num(score['scaled']);
    if (scaled !== null) outcome.scoreScaled = clamp01(scaled);
    if (completion === 'completed') outcome.completion = 'completed';
    else if (completion === 'incomplete') outcome.completion = 'incomplete';
    if (success === 'passed' || success === 'failed') outcome.success = success;
    if (options.finished) outcome.addTimeMs = parseIsoDuration(cmi['session_time']);
    for (const i of interactions)
      if (typeof i['id'] === 'string' && i['id'])
        responses.push({
          questionId: clip(i['id']),
          description: clip(i['description']),
          interactionType: clip(i['type']) || 'other',
          response: clip(i['learner_response']),
          success: i['result'] === 'correct' ? true : i['result'] === 'incorrect' ? false : null,
          scoreRaw: null,
          scoreMax: null,
          needsManualGrading: false,
        });
  }
  return { outcome, responses };
}

const VERB = 'http://adlnet.gov/expapi/verbs/';

/** One xAPI statement → outcome and, for answered questions, a response row. */
export function fromStatement(statement: Record<string, unknown>): {
  outcome: Outcome;
  response: ResponseRow | null;
} {
  const verb = obj(statement['verb'])['id'];
  const result = obj(statement['result']);
  const object = obj(statement['object']);
  const outcome: Outcome = {};
  const scaled = num(obj(result['score'])['scaled']);
  if (verb === `${VERB}completed`) outcome.completion = 'completed';
  if (verb === `${VERB}passed`) outcome.success = 'passed';
  if (verb === `${VERB}failed`) outcome.success = 'failed';
  if (result['completion'] === true) outcome.completion = 'completed';
  if (scaled !== null && verb !== `${VERB}answered`) outcome.scoreScaled = clamp01(scaled);
  if (verb === `${VERB}terminated`) outcome.addTimeMs = parseIsoDuration(result['duration']);
  if (verb === `${VERB}initialized` || verb === `${VERB}launched`) outcome.completion ??= 'incomplete';

  let response: ResponseRow | null = null;
  if (verb === `${VERB}answered` && typeof object['id'] === 'string') {
    const definition = obj(object['definition']);
    const description = Object.values(obj(definition['description']))[0];
    const type = clip(definition['interactionType']) || 'other';
    const score = obj(result['score']);
    const success = typeof result['success'] === 'boolean' ? result['success'] : null;
    response = {
      questionId: clip(object['id']),
      description: clip(description),
      interactionType: type,
      response: clip(result['response']),
      success,
      scoreRaw: num(score['raw']),
      scoreMax: num(score['max']),
      needsManualGrading: type === 'long-fill-in' && success === null,
    };
  }
  return { outcome, response };
}

/** Writes an outcome; completion and success never move backwards. */
export async function applyOutcome(
  db: Kysely<Database>,
  registrationId: string,
  outcome: Outcome,
  responses: readonly ResponseRow[],
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const reg = await tx
      .selectFrom('registrations')
      .select(['completion', 'success', 'completed_at', 'time_spent_ms', 'verified'])
      .where('id', '=', registrationId)
      .forUpdate()
      .executeTakeFirst();
    if (!reg) return;
    const completion = reg.completion === 'completed' ? 'completed' : (outcome.completion ?? reg.completion);
    // A server-graded attempt (F-07) is authoritative: client-reported pass/score from
    // xAPI/SCORM must not change it. Progress and time may still advance.
    const success = reg.verified
      ? reg.success
      : reg.success === 'passed'
        ? 'passed'
        : (outcome.success ?? reg.success);
    await tx
      .updateTable('registrations')
      .set({
        completion,
        success,
        ...(!reg.verified && outcome.scoreScaled !== undefined ? { score_scaled: outcome.scoreScaled } : {}),
        time_spent_ms: Number(reg.time_spent_ms) + (outcome.addTimeMs ?? 0),
        last_activity_at: new Date(),
        ...(completion === 'completed' && !reg.completed_at ? { completed_at: new Date() } : {}),
      })
      .where('id', '=', registrationId)
      .execute();
    for (const r of responses) {
      const values = {
        description: r.description,
        interaction_type: r.interactionType,
        response: r.response,
        success: r.success,
        score_raw: r.scoreRaw,
        score_max: r.scoreMax,
        needs_manual_grading: r.needsManualGrading,
        answered_at: new Date(),
      };
      await tx
        .insertInto('quiz_responses')
        .values({ registration_id: registrationId, question_id: r.questionId, ...values })
        .onConflict((oc) => oc.columns(['registration_id', 'question_id']).doUpdateSet(values))
        .execute();
    }
  });
}
