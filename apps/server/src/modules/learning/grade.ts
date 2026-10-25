// SPDX-License-Identifier: Apache-2.0
import {
  describeResponse,
  loadCourse,
  quizResult,
  scoreQuestion,
  type Question,
  type QuestionResult,
  type QuizNode,
  type Response,
} from '@coursecraft/course-model';
import type { AppContext } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import type { Launch } from '../lrs/service.js';

export interface QuizSubmission {
  quizId: string;
  answers: { questionId: string; response: Response }[];
}
export interface GradeSubmission {
  quizzes: QuizSubmission[];
}
export interface GradeResult {
  /** True only when every quiz in the course was submitted and every question is auto-gradable. */
  verified: boolean;
  passed: boolean;
  scoreScaled: number | null;
}

/** Fixed questions and pools of a quiz, indexed for validation and scoring. */
function quizShape(quiz: QuizNode) {
  const byId = new Map<string, Question>();
  const fixedIds: string[] = [];
  const pools: { draw: number; memberIds: Set<string> }[] = [];
  for (const item of quiz.items) {
    if (item.type === 'question') {
      byId.set(item.question.id, item.question);
      fixedIds.push(item.question.id);
    } else {
      const members = new Set<string>();
      for (const q of item.questions) {
        byId.set(q.id, q);
        members.add(q.id);
      }
      pools.push({ draw: item.draw, memberIds: members });
    }
  }
  return { byId, fixedIds, pools };
}

const bad = (m: string) => new AppError('bad_request', m);

/**
 * Checks the submitted answers are exactly one legitimate attempt of the quiz:
 * every fixed question answered, each pool answered with `draw` distinct
 * members, nothing unknown or duplicated. Stops a learner from omitting hard
 * questions or inventing answers to inflate the score (SECURITY_AUDIT.md F-07).
 */
function validateAttempt(quiz: QuizNode, answers: QuizSubmission['answers']): Map<string, Response> {
  const shape = quizShape(quiz);
  const given = new Map<string, Response>();
  for (const a of answers) {
    if (given.has(a.questionId)) throw bad(`Duplicate answer for ${a.questionId}`);
    if (!shape.byId.has(a.questionId)) throw bad(`Unknown question ${a.questionId}`);
    given.set(a.questionId, a.response);
  }
  for (const id of shape.fixedIds) if (!given.has(id)) throw bad(`Missing answer for ${id}`);
  const poolAnswers = [...given.keys()].filter((id) => !shape.fixedIds.includes(id));
  let consumed = 0;
  for (const pool of shape.pools) {
    const fromPool = poolAnswers.filter((id) => pool.memberIds.has(id));
    if (fromPool.length !== pool.draw) throw bad('Pool answers do not match the draw');
    consumed += fromPool.length;
  }
  if (consumed !== poolAnswers.length) throw bad('Answer does not belong to any pool');
  return given;
}

/**
 * Grades a learner's own-course quiz attempt on the server, against the exact
 * published course version the launch runs (SECURITY_AUDIT.md F-07). The
 * registration's pass and score are set from the server's grading, and the
 * attempt is marked `verified` only when every quiz in the course was
 * submitted and every answered question is auto-gradable (no essays). A course
 * with an essay (or a missing quiz) stays unverified and its outcome is left
 * to the existing flow, so nothing is ever mis-graded.
 */
export async function gradeAttempt(
  ctx: AppContext,
  launch: Launch,
  submission: GradeSubmission,
): Promise<GradeResult> {
  if (launch.kind !== 'coursecraft') throw bad('Grading is only for the platform’s own courses');
  const pkg = await ctx.db
    .selectFrom('packages')
    .select(['source_course_id', 'source_version'])
    .where('id', '=', launch.packageId)
    .executeTakeFirst();
  if (!pkg?.source_course_id || pkg.source_version == null)
    return { verified: false, passed: false, scoreScaled: null };
  const version = await ctx.db
    .selectFrom('course_versions')
    .select('snapshot')
    .where('course_id', '=', pkg.source_course_id)
    .where('number', '=', pkg.source_version)
    .executeTakeFirst();
  if (!version) return { verified: false, passed: false, scoreScaled: null };

  const course = loadCourse(version.snapshot);
  const lang = course.languages.default;
  const quizNodes = new Map<string, QuizNode>();
  for (const node of Object.values(course.nodes)) if (node.kind === 'quiz') quizNodes.set(node.id, node);

  const submitted = new Map(submission.quizzes.map((q) => [q.quizId, q]));
  for (const id of submitted.keys()) if (!quizNodes.has(id)) throw bad(`Unknown quiz ${id}`);

  type Row = { questionId: string; type: string; response: Response; result: QuestionResult };
  type Graded = { quiz: QuizNode; rows: Row[] };
  const graded: Graded[] = [];
  for (const [quizId, quiz] of quizNodes) {
    const sub = submitted.get(quizId);
    if (!sub) continue; // A quiz the learner did not submit: handled by the coverage check below.
    const shape = quizShape(quiz);
    const given = validateAttempt(quiz, sub.answers);
    const rows: Row[] = [...given].map(([questionId, response]) => {
      const question = shape.byId.get(questionId) as Question;
      return { questionId, type: question.type, response, result: scoreQuestion(question, response, lang) };
    });
    graded.push({ quiz, rows });
  }

  const coversAll = quizNodes.size > 0 && submitted.size === quizNodes.size;
  const everyQuestionGradable = graded.every((g) => g.rows.every((r) => r.result.state !== 'pending'));
  const totals = graded.reduce(
    (acc, g) => ({
      score: acc.score + g.rows.reduce((n, r) => n + r.result.score, 0),
      max: acc.max + g.rows.reduce((n, r) => n + r.result.max, 0),
    }),
    { score: 0, max: 0 },
  );
  const allPassed = graded.every(
    (g) =>
      quizResult(
        g.quiz,
        g.rows.map((r) => r.result),
      ).passed,
  );
  const verified = coversAll && everyQuestionGradable && totals.max > 0;

  if (!verified) return { verified: false, passed: false, scoreScaled: null };

  const scoreScaled = totals.score / totals.max;
  await ctx.db.transaction().execute(async (tx) => {
    for (const g of graded)
      for (const r of g.rows) {
        const values = {
          response: describeResponse(r.response),
          interaction_type: r.type,
          success: r.result.state === 'correct' ? true : r.result.state === 'incorrect' ? false : null,
          score_raw: r.result.score,
          score_max: r.result.max,
          needs_manual_grading: false,
          answered_at: new Date(),
        };
        await tx
          .insertInto('quiz_responses')
          .values({ registration_id: launch.registrationId, question_id: r.questionId, ...values })
          .onConflict((oc) => oc.columns(['registration_id', 'question_id']).doUpdateSet(values))
          .execute();
      }
    await tx
      .updateTable('registrations')
      .set({
        completion: 'completed',
        success: allPassed ? 'passed' : 'failed',
        score_scaled: scoreScaled,
        verified: true,
        last_activity_at: new Date(),
        completed_at: new Date(),
      })
      .where('id', '=', launch.registrationId)
      .execute();
  });
  return { verified: true, passed: allPassed, scoreScaled };
}
