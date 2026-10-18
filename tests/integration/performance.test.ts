// SPDX-License-Identifier: Apache-2.0
// Large amounts of data: reports, learner portal, big courses. The limits are
// roughly ten times what a laptop needs: they catch queries that grow
// with the square of the data or run once per row, not small slowdowns.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDoc, openCourse, uploadTo } from '../support/courses.js';
import { scorm12Package } from '../support/packages.js';
import { createTestApp, trainersSeeEveryone, type Actor, type TestApp } from '../support/test-app.js';

let t: TestApp;
let admin: Actor;
let trainer: Actor;

beforeAll(async () => {
  t = await createTestApp({ COURSECRAFT_CONTENT_URL: 'https://content.coursecraft.test' });
  await trainersSeeEveryone(t);
  admin = await t.actor(['admin']);
  trainer = await t.actor(['trainer']);
});
afterAll(async () => t.close());

async function timed<T>(label: string, limitMs: number, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await work();
  const took = performance.now() - started;
  expect(took, `${label} took ${Math.round(took)} ms`).toBeLessThan(limitMs);
  return result;
}

const inChunks = async <T>(rows: T[], size: number, write: (chunk: T[]) => Promise<unknown>) => {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
};

describe('reports with many learners', () => {
  const LEARNERS = 6000;
  let itemId: string;

  beforeAll(async () => {
    const imported = await uploadTo(
      t,
      admin,
      '/api/library/import',
      'p.zip',
      await scorm12Package({ title: 'Großer Kurs' }),
    );
    itemId = imported.json<{ id: string }>().id;
    const item = await t.ctx.db
      .selectFrom('library_items')
      .select('package_id')
      .where('id', '=', itemId)
      .executeTakeFirstOrThrow();
    const users = Array.from({ length: LEARNERS }, (_, i) => ({
      id: randomUUID(),
      email: `bulk-${i}@perf.example.org`,
      display_name: `Lernende ${String(i).padStart(5, '0')}`,
    }));
    await inChunks(users, 2000, (chunk) => t.ctx.db.insertInto('users').values(chunk).execute());
    const group = await t.ctx.db
      .insertInto('groups')
      .values({ name: 'Alle' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const sub = await t.ctx.db
      .insertInto('groups')
      .values({ name: 'Unter', parent_id: group.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await inChunks(users, 5000, (chunk) =>
      t.ctx.db
        .insertInto('group_members')
        .values(chunk.map((u) => ({ group_id: sub.id, user_id: u.id })))
        .execute(),
    );
    await t.ctx.db
      .insertInto('assignments')
      .values({ library_item_id: itemId, group_id: group.id })
      .execute();
    const regs = users.map((u) => ({
      id: randomUUID(),
      user_id: u.id,
      library_item_id: itemId,
      package_id: item.package_id,
      attempt: 1,
      completion: 'completed' as const,
      success: 'passed' as const,
      score_scaled: 0.8,
      time_spent_ms: 120_000,
    }));
    await inChunks(regs, 2000, (chunk) => t.ctx.db.insertInto('registrations').values(chunk).execute());
    const responses = regs.flatMap((r) =>
      Array.from({ length: 8 }, (_, q) => ({
        registration_id: r.id,
        question_id: `q${q}`,
        description: `Frage ${q}`,
        interaction_type: 'choice',
        success: q % 2 === 0,
        score_raw: 1,
        score_max: 1,
      })),
    );
    await inChunks(responses, 5000, (chunk) => t.ctx.db.insertInto('quiz_responses').values(chunk).execute());
  }, 180_000);

  it('builds the item report, with question statistics and CSV, in a few seconds', async () => {
    const report = await timed('item report', 1500, () =>
      t.request(trainer, 'GET', `/api/reports/items/${itemId}`),
    );
    expect(report.statusCode, report.body).toBe(200);
    const body = report.json<{
      rows: { status: string }[];
      questions: { questionId: string; answers: number; correct: number }[];
    }>();
    expect(body.rows.length).toBeGreaterThanOrEqual(LEARNERS);
    expect(body.questions).toHaveLength(8);
    expect(body.questions[0]).toMatchObject({ questionId: 'q0', answers: LEARNERS, correct: LEARNERS });
    expect(body.questions[1]).toMatchObject({ answers: LEARNERS, correct: 0 });
    const csv = await timed('report CSV', 1500, () =>
      t.request(trainer, 'GET', `/api/reports/items/${itemId}/csv`),
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.body.split('\r\n').length).toBeGreaterThan(LEARNERS);
  });

  it('lists users and the audit log by page without reading everything', async () => {
    const page = await timed('user list', 500, () =>
      t.request(admin, 'GET', '/api/users?page=1&pageSize=50&q=Lernende'),
    );
    expect(page.statusCode, page.body).toBe(200);
    expect(page.json<{ items: unknown[] }>().items).toHaveLength(50);
    expect(
      (await timed('audit log', 500, () => t.request(admin, 'GET', '/api/audit?pageSize=50'))).statusCode,
    ).toBe(200);
  });
});

describe('learner portal with many assigned courses', () => {
  it('lists 300 assigned courses with their state quickly', async () => {
    const learner = await t.actor(['learner']);
    const imported = await uploadTo(
      t,
      admin,
      '/api/library/import',
      'p.zip',
      await scorm12Package({ title: 'Basis' }),
    );
    const base = await t.ctx.db
      .selectFrom('library_items')
      .select('package_id')
      .where('id', '=', imported.json<{ id: string }>().id)
      .executeTakeFirstOrThrow();
    const items = Array.from({ length: 300 }, (_, i) => ({
      id: randomUUID(),
      package_id: base.package_id,
      title: `Kurs ${String(i).padStart(3, '0')}`,
    }));
    await t.ctx.db.insertInto('library_items').values(items).execute();
    await t.ctx.db
      .insertInto('assignments')
      .values(items.map((i) => ({ library_item_id: i.id, user_id: learner.userId })))
      .execute();
    await t.ctx.db
      .insertInto('registrations')
      .values(
        items.slice(0, 150).map((i) => ({
          user_id: learner.userId,
          library_item_id: i.id,
          package_id: base.package_id,
          attempt: 1,
          completion: 'completed' as const,
        })),
      )
      .execute();
    const res = await timed('my courses', 1500, () => t.request(learner, 'GET', '/api/learn/items'));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ items: { status: string }[] }>().items).toHaveLength(300);
  });
});

describe('a course with 300 slides', () => {
  it('saves, loads and exports in reasonable time', async () => {
    const author = await t.actor(['author']);
    const { id, doc } = await openCourse(t, author);
    const first = doc.course.structure.chapters[0]?.nodeIds[0] ?? '';
    const template = doc.course.nodes[first];
    expect(template).toBeTruthy();
    const slides = Array.from({ length: 300 }, (_, i) => {
      const copy = structuredClone(template) as Record<string, unknown> & {
        id: string;
        title: Record<string, string>;
      };
      copy.id = `s-perf-${i}`;
      copy.title = { de: `Folie ${i}` };
      return copy;
    });
    const chapter = doc.course.structure.chapters[0];
    const structure = {
      ...doc.course.structure,
      chapters: [{ ...chapter, nodeIds: [first, ...slides.map((s) => s.id)] }],
    };
    const saved = await timed('save 300 slides', 2500, () =>
      t.request(author, 'POST', `/api/courses/${id}/save`, { rev: doc.rev, structure, upsertNodes: slides }),
    );
    expect(saved.statusCode, saved.body).toBe(200);
    const loaded = await timed('load course', 500, () => getDoc(t, author, id));
    expect(Object.keys(loaded.course.nodes)).toHaveLength(301);
    const exported = await timed('export HTML5', 1500, () =>
      t.request(author, 'GET', `/api/courses/${id}/export?format=html5`),
    );
    expect(exported.statusCode).toBe(200);
  }, 60_000);
});
