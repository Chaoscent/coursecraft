// SPDX-License-Identifier: Apache-2.0
// Security audit (SECURITY_AUDIT.md, F-07 / P10): the server grades the
// platform's own courses itself, against the published course version, instead
// of trusting the learner's browser. A result is "verified" only when every
// quiz in the course was submitted and every question is auto-gradable; a
// course with an essay (or a missing quiz) stays unverified so nothing is ever
// mis-graded. Never point this at a real installation.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../../apps/server/src/crypto/tokens.js';
import { gradeAttempt, type GradeSubmission } from '../../apps/server/src/modules/learning/grade.js';
import { applyOutcome } from '../../apps/server/src/modules/learning/projection.js';
import type { Launch } from '../../apps/server/src/modules/lrs/service.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../packages/course-model/fixtures/v1-sample.json', import.meta.url)),
    'utf8',
  ),
) as Record<string, unknown>;

type Json = Record<string, unknown>;
const clone = (): Json => structuredClone(FIXTURE);
const quiz1Of = (c: Json) => (c['nodes'] as Json)['quiz1'] as { items: unknown[] };
const withoutEssay = (c: Json): Json => {
  const q = quiz1Of(c);
  q.items = q.items.filter(
    (it) =>
      !(
        typeof it === 'object' &&
        it !== null &&
        (it as Json)['type'] === 'question' &&
        ((it as Json)['question'] as Json)['id'] === 'q5'
      ),
  );
  return c;
};

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

/** Seeds an own-course package + registration for a snapshot; returns a Launch for it. */
async function seed(snapshot: Json): Promise<{ launch: Launch; registrationId: string; token: string }> {
  const user = await t.createUser(['learner']);
  const course = await t.ctx.db
    .insertInto('courses')
    .values({
      title: 'Own course',
      owner_id: user.id,
      format_version: 1,
      meta: JSON.stringify(snapshot['meta'] ?? {}),
      settings: JSON.stringify(snapshot['settings'] ?? {}),
      languages: JSON.stringify(snapshot['languages']),
      structure: JSON.stringify(snapshot['structure']),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await t.ctx.db
    .insertInto('course_versions')
    .values({ course_id: course.id, number: 1, snapshot: JSON.stringify(snapshot) })
    .execute();
  const pkg = await t.ctx.db
    .insertInto('packages')
    .values({
      kind: 'coursecraft',
      title: 'Own course',
      launch_path: 'index.html',
      manifest: JSON.stringify({}),
      size: 0,
      source_course_id: course.id,
      source_version: 1,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const item = await t.ctx.db
    .insertInto('library_items')
    .values({ package_id: pkg.id, title: 'Own course', source_course_id: course.id, created_by: user.id })
    .returning('id')
    .executeTakeFirstOrThrow();
  const reg = await t.ctx.db
    .insertInto('registrations')
    .values({ user_id: user.id, library_item_id: item.id, package_id: pkg.id, attempt: 1 })
    .returning('id')
    .executeTakeFirstOrThrow();
  const launch: Launch = {
    id: 'launch',
    registrationId: reg.id,
    userId: user.id,
    packageId: pkg.id,
    kind: 'coursecraft',
    manifest: {} as never,
    mode: 'normal',
    fetchUsed: false,
    actorKey: `account:test|${user.id}`,
  };
  // A launch token so the HTTP grade route can resolve this launch.
  const future = new Date(Date.now() + 60 * 60_000);
  const session = await t.ctx.db
    .insertInto('sessions')
    .values({
      token_hash: hashToken(randomBytes(16).toString('hex')),
      user_id: user.id,
      idle_expires_at: future,
      absolute_expires_at: future,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const token = randomBytes(32).toString('base64url');
  await t.ctx.db
    .insertInto('launch_tokens')
    .values({
      token_hash: hashToken(token),
      registration_id: reg.id,
      user_id: user.id,
      session_id: session.id,
      package_id: pkg.id,
      expires_at: future,
      absolute_expires_at: future,
    })
    .execute();
  return { launch, registrationId: reg.id, token };
}

const registration = (id: string) =>
  t.ctx.db
    .selectFrom('registrations')
    .select(['success', 'completion', 'score_scaled', 'verified'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

// A valid full attempt of the essay-free quiz1 (q1 single choice, q2 fill-in, pool answered by q3).
const correct = (): GradeSubmission => ({
  quizzes: [
    {
      quizId: 'quiz1',
      answers: [
        { questionId: 'q1', response: { type: 'singleChoice', choiceId: 'a' } },
        { questionId: 'q2', response: { type: 'fillInBlanks', blanks: { b1: 'Ausgang' } } },
        { questionId: 'q3', response: { type: 'trueFalse', value: true } },
      ],
    },
  ],
});

describe('F-07 / P10: server-side grading of own courses', () => {
  it('verifies and passes a fully correct, fully auto-gradable attempt', async () => {
    const { launch, registrationId } = await seed(withoutEssay(clone()));
    const result = await gradeAttempt(t.ctx, launch, correct());
    expect(result).toEqual({ verified: true, passed: true, scoreScaled: 1 });
    expect(await registration(registrationId)).toMatchObject({
      verified: true,
      success: 'passed',
      completion: 'completed',
      score_scaled: 1,
    });
  });

  it('grades wrong answers as a verified fail, not a pass', async () => {
    const { launch, registrationId } = await seed(withoutEssay(clone()));
    const wrong = correct();
    wrong.quizzes[0]!.answers[0] = { questionId: 'q1', response: { type: 'singleChoice', choiceId: 'b' } };
    const result = await gradeAttempt(t.ctx, launch, wrong);
    // 2 of 3 correct = 67% < 75% passing.
    expect(result.verified).toBe(true);
    expect(result.passed).toBe(false);
    expect((await registration(registrationId)).success).toBe('failed');
  });

  it('leaves a course containing an essay unverified (self-reported)', async () => {
    const { launch, registrationId } = await seed(clone()); // quiz1 still has the essay q5
    const withEssay = correct();
    withEssay.quizzes[0]!.answers.push({ questionId: 'q5', response: { type: 'essay', text: 'an answer' } });
    const result = await gradeAttempt(t.ctx, launch, withEssay);
    expect(result.verified).toBe(false);
    // The registration is not force-graded; it keeps its default (self-reported) outcome.
    expect(await registration(registrationId)).toMatchObject({ verified: false, success: 'unknown' });
  });

  it('rejects an attempt that omits a required question', async () => {
    const { launch } = await seed(withoutEssay(clone()));
    const short = correct();
    short.quizzes[0]!.answers = short.quizzes[0]!.answers.slice(0, 1); // only q1
    await expect(gradeAttempt(t.ctx, launch, short)).rejects.toThrow(/Missing answer|Pool answers/);
  });

  it('rejects an answer to a question that is not in the quiz', async () => {
    const { launch } = await seed(withoutEssay(clone()));
    const bogus = correct();
    bogus.quizzes[0]!.answers.push({
      questionId: 'does-not-exist',
      response: { type: 'trueFalse', value: true },
    });
    await expect(gradeAttempt(t.ctx, launch, bogus)).rejects.toThrow(/Unknown question/);
  });

  it('accepts either member of a question pool', async () => {
    const { launch, registrationId } = await seed(withoutEssay(clone()));
    const viaQ4 = correct();
    // Answer the pool with q4 (numeric, accepted 1..3) instead of q3.
    viaQ4.quizzes[0]!.answers[2] = { questionId: 'q4', response: { type: 'numeric', value: 2 } };
    const result = await gradeAttempt(t.ctx, launch, viaQ4);
    expect(result).toMatchObject({ verified: true, passed: true });
    expect((await registration(registrationId)).verified).toBe(true);
  });

  it('rejects answering more pool questions than the draw allows', async () => {
    const { launch } = await seed(withoutEssay(clone()));
    const both = correct();
    both.quizzes[0]!.answers.push({ questionId: 'q4', response: { type: 'numeric', value: 2 } });
    await expect(gradeAttempt(t.ctx, launch, both)).rejects.toThrow(/Pool answers do not match/);
  });

  it('does not verify when the course has a quiz the learner did not submit', async () => {
    const snapshot = withoutEssay(clone());
    const nodes = snapshot['nodes'] as Json;
    nodes['quiz2'] = {
      kind: 'quiz',
      id: 'quiz2',
      title: { de: 'Zweites Quiz' },
      items: [
        {
          type: 'question',
          question: {
            id: 'q9',
            type: 'trueFalse',
            prompt: { de: { type: 'doc', content: [] } },
            correct: true,
          },
        },
      ],
      settings: { passingPercent: 75 },
    };
    (((snapshot['structure'] as Json)['chapters'] as Json[])[1]!['nodeIds'] as string[]).push('quiz2');
    const { launch, registrationId } = await seed(snapshot);
    const result = await gradeAttempt(t.ctx, launch, correct()); // only quiz1 submitted
    expect(result.verified).toBe(false);
    expect((await registration(registrationId)).verified).toBe(false);
  });

  it('grades through the HTTP launch route (token in the path, JSON body)', async () => {
    const { registrationId, token } = await seed(withoutEssay(clone()));
    const res = await t.app.inject({
      method: 'POST',
      url: `/launch/${token}/grade`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(correct()),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ verified: true, passed: true });
    expect((await registration(registrationId)).verified).toBe(true);
  });

  it('a forged xAPI pass cannot override a verified server grade', async () => {
    const { launch, registrationId } = await seed(withoutEssay(clone()));
    const wrong = correct();
    wrong.quizzes[0]!.answers[0] = { questionId: 'q1', response: { type: 'singleChoice', choiceId: 'b' } };
    await gradeAttempt(t.ctx, launch, wrong); // verified fail
    // Now a client statement claims a pass with a perfect score.
    await applyOutcome(t.ctx.db, registrationId, { success: 'passed', scoreScaled: 1 }, []);
    const reg = await registration(registrationId);
    expect(reg.success).toBe('failed');
    expect(reg.score_scaled).not.toBe(1);
  });
});
