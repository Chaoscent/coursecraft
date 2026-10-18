// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uploadTo } from '../support/courses.js';
import { scorm12Package } from '../support/packages.js';
import { createTestApp, trainersSeeEveryone, type Actor, type TestApp } from '../support/test-app.js';

let t: TestApp;
let admin: Actor;
let author: Actor;
let trainer: Actor;
let learner: Actor;
let one: string;
let two: string;
let three: string;
let pathId: string;

beforeAll(async () => {
  t = await createTestApp({ COURSECRAFT_CONTENT_URL: 'https://content.coursecraft.test' });
  await trainersSeeEveryone(t);
  admin = await t.actor(['admin']);
  author = await t.actor(['author']);
  trainer = await t.actor(['trainer']);
  learner = await t.actor(['learner']);
  const item = async (title: string) =>
    (await uploadTo(t, admin, '/api/library/import', 'p.zip', await scorm12Package({ title }))).json<{
      id: string;
    }>().id;
  [one, two, three] = [await item('Grundlagen'), await item('Aufbau'), await item('Abschluss')];
});
afterAll(async () => t.close());

const mine = async () =>
  (await t.request(learner, 'GET', '/api/learn/items')).json<{
    items: {
      id: string;
      title: string;
      locked: boolean;
      dueAt: string | null;
      path: { title: string; step: number; steps: number } | null;
    }[];
  }>().items;

async function pass(itemId: string) {
  const launch = await t.request(learner, 'POST', `/api/learn/items/${itemId}/launch`, { newAttempt: false });
  expect(launch.statusCode, launch.body).toBe(200);
  const { launchId } = launch.json<{ launchId: string }>();
  const res = await t.request(learner, 'POST', `/api/learn/launches/${launchId}/scorm`, {
    cmi: { core: { lesson_status: 'passed', score: { raw: '90', min: '0', max: '100' } } },
    finished: true,
  });
  expect(res.statusCode, res.body).toBe(200);
}

describe('learning paths', () => {
  it('are managed by library managers; trainers assign, authors only look', async () => {
    const body = { title: 'Einarbeitung', description: '', sequential: true, itemIds: [one, two, three] };
    expect((await t.request(trainer, 'POST', '/api/paths', body)).statusCode).toBe(403);
    expect((await t.request(admin, 'POST', '/api/paths', { ...body, itemIds: [one, one] })).statusCode).toBe(
      400,
    );
    const created = await t.request(admin, 'POST', '/api/paths', body);
    expect(created.statusCode, created.body).toBe(200);
    pathId = created.json<{ id: string }>().id;
    expect(created.json()).toMatchObject({ title: 'Einarbeitung', stepCount: 3 });
    expect(
      (await t.request(author, 'GET', `/api/paths/${pathId}`))
        .json<{ steps: { title: string }[] }>()
        .steps.map((s) => s.title),
    ).toEqual(['Grundlagen', 'Aufbau', 'Abschluss']);
    expect(
      (await t.request(author, 'POST', `/api/paths/${pathId}/assignments`, { userIds: [learner.userId] }))
        .statusCode,
    ).toBe(403);
  });

  it('show their courses in order, lock later steps and open them one by one', async () => {
    const due = new Date(Date.now() + 5 * 86_400_000).toISOString();
    expect((await t.request(admin, 'GET', '/api/learn/items')).statusCode).toBe(200);
    expect((await mine()).length).toBe(0);
    const assigned = await t.request(trainer, 'POST', `/api/paths/${pathId}/assignments`, {
      userIds: [learner.userId],
      dueAt: due,
    });
    expect(assigned.statusCode, assigned.body).toBe(200);

    const items = await mine();
    expect(items.map((i) => [i.title, i.path?.step, i.path?.steps, i.locked])).toEqual(
      [
        ['Abschluss', 3, 3, true],
        ['Aufbau', 2, 3, true],
        ['Grundlagen', 1, 3, false],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(items.every((i) => i.dueAt === due)).toBe(true);

    const locked = await t.request(learner, 'POST', `/api/learn/items/${two}/launch`, { newAttempt: false });
    expect(locked.statusCode).toBe(403);
    await pass(one);
    expect((await mine()).find((i) => i.id === two)?.locked).toBe(false);
    expect((await mine()).find((i) => i.id === three)?.locked).toBe(true);
    await pass(two);
    expect((await mine()).find((i) => i.id === three)?.locked).toBe(false);
  });

  it('keep a course open that is also assigned directly, and ignore archived paths', async () => {
    const other = await t.actor(['learner']);
    const second = (
      await t.request(admin, 'POST', '/api/paths', {
        title: 'Zweiter',
        description: '',
        sequential: true,
        itemIds: [one, two],
      })
    ).json<{ id: string }>().id;
    await t.request(trainer, 'POST', `/api/paths/${second}/assignments`, { userIds: [other.userId] });
    const items = async () =>
      (await t.request(other, 'GET', '/api/learn/items')).json<{ items: { id: string; locked: boolean }[] }>()
        .items;
    expect((await items()).find((i) => i.id === two)?.locked).toBe(true);
    await t.request(trainer, 'POST', `/api/library/${two}/assignments`, { userIds: [other.userId] });
    expect((await items()).find((i) => i.id === two)?.locked).toBe(false);

    await t.request(admin, 'PUT', `/api/paths/${second}`, {
      title: 'Zweiter',
      description: '',
      sequential: true,
      status: 'archived',
      itemIds: [one, two],
    });
    expect((await items()).map((i) => i.id)).toEqual([two]);
  });

  it('lets managers remove assignments and delete paths', async () => {
    const list = (await t.request(trainer, 'GET', `/api/paths/${pathId}/assignments`)).json<{
      items: { id: string }[];
    }>().items;
    expect(list).toHaveLength(1);
    expect(
      (await t.request(trainer, 'DELETE', `/api/paths/${pathId}/assignments/${list[0]?.id ?? ''}`))
        .statusCode,
    ).toBe(200);
    expect((await t.request(admin, 'DELETE', `/api/paths/${pathId}`)).statusCode).toBe(200);
    expect((await t.request(admin, 'GET', `/api/paths/${pathId}`)).statusCode).toBe(404);
  });
});
