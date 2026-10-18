// SPDX-License-Identifier: Apache-2.0
// Trainers see only the learners of the groups they manage (and subgroups).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uploadTo } from '../support/courses.js';
import { scorm12Package } from '../support/packages.js';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';

let t: TestApp;
let admin: Actor;
let trainer: Actor;
let idle: Actor;
let item: string;
const users: Record<'l1' | 'l1a' | 'l2', { id: string; email: string }> = {} as never;
const groups: Record<'g1' | 'g1a' | 'g2', string> = {} as never;

async function group(name: string, parentId: string | null = null): Promise<string> {
  const res = await t.request(admin, 'POST', '/api/groups', { name, parentId });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ id: string }>().id;
}

beforeAll(async () => {
  t = await createTestApp({ COURSECRAFT_CONTENT_URL: 'https://content.coursecraft.test' });
  admin = await t.actor(['admin']);
  trainer = await t.actor(['trainer']);
  idle = await t.actor(['trainer']);
  groups.g1 = await group('Vertrieb');
  groups.g1a = await group('Vertrieb Nord', groups.g1);
  groups.g2 = await group('Buchhaltung');
  for (const [key, g] of [
    ['l1', groups.g1],
    ['l1a', groups.g1a],
    ['l2', groups.g2],
  ] as const) {
    users[key] = await t.createUser(['learner']);
    await t.request(admin, 'POST', `/api/groups/${g}/members`, { userIds: [users[key].id] });
  }
  expect(
    (await t.request(admin, 'PUT', `/api/groups/${groups.g1}/managers`, { userIds: [trainer.userId] }))
      .statusCode,
  ).toBe(200);
  item = (
    await uploadTo(t, admin, '/api/library/import', 'p.zip', await scorm12Package({ title: 'Kurs' }))
  ).json<{
    id: string;
  }>().id;
  await t.request(admin, 'POST', `/api/library/${item}/assignments`, {
    userIds: [users.l1.id, users.l1a.id, users.l2.id],
    groupIds: [],
    dueAt: null,
  });
});
afterAll(() => t.close());

const ids = <T extends { id?: string; userId?: string; targetId?: string }>(list: T[]) =>
  list.map((x) => x.userId ?? x.targetId ?? x.id).sort();

describe('trainer scope', () => {
  it('shows a trainer only the managed group with its subgroup and their members', async () => {
    const g = (await t.request(trainer, 'GET', '/api/groups')).json<{ items: { id: string }[] }>().items;
    expect(ids(g)).toEqual([groups.g1, groups.g1a].sort());
    const dir = (await t.request(trainer, 'GET', '/api/directory/users')).json<{ items: { id: string }[] }>()
      .items;
    expect(ids(dir)).toEqual([users.l1.id, users.l1a.id].sort());
    const report = (await t.request(trainer, 'GET', `/api/reports/items/${item}`)).json<{
      rows: { userId: string }[];
    }>().rows;
    expect(ids(report)).toEqual([users.l1.id, users.l1a.id].sort());
    const assignments = (await t.request(trainer, 'GET', `/api/library/${item}/assignments`)).json<{
      items: { targetId: string }[];
    }>().items;
    expect(ids(assignments)).toEqual([users.l1.id, users.l1a.id].sort());
    // The administrator still sees everyone.
    const all = (await t.request(admin, 'GET', `/api/reports/items/${item}`)).json<{ rows: unknown[] }>()
      .rows;
    expect(all).toHaveLength(3);
  });

  it('refuses to assign, unassign or show certificates outside the scope', async () => {
    const body = (userIds: string[], groupIds: string[]) => ({ userIds, groupIds, dueAt: null });
    expect(
      (await t.request(trainer, 'POST', `/api/library/${item}/assignments`, body([users.l2.id], [])))
        .statusCode,
    ).toBe(404);
    expect(
      (await t.request(trainer, 'POST', `/api/library/${item}/assignments`, body([], [groups.g2])))
        .statusCode,
    ).toBe(404);
    expect(
      (await t.request(trainer, 'POST', `/api/library/${item}/assignments`, body([], [groups.g1a])))
        .statusCode,
    ).toBe(200);
    const foreign = (await t.request(admin, 'GET', `/api/library/${item}/assignments`))
      .json<{ items: { id: string; targetId: string }[] }>()
      .items.find((a) => a.targetId === users.l2.id);
    expect(
      (await t.request(trainer, 'DELETE', `/api/library/${item}/assignments/${foreign?.id ?? ''}`))
        .statusCode,
    ).toBe(404);
    const reg = await t.ctx.db
      .insertInto('registrations')
      .values({
        user_id: users.l2.id,
        library_item_id: item,
        attempt: 1,
        package_id: await packageOf(item),
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
    const cert = await t.ctx.db
      .insertInto('certificates')
      .values({
        registration_id: reg.id,
        user_id: users.l2.id,
        library_item_id: item,
        serial: 'CC-TEST-SCOP-E001',
        learner_name: 'L2',
        item_title: 'Kurs',
        completed_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect((await t.request(trainer, 'GET', `/api/certificates/${cert.id}/pdf`)).statusCode).toBe(404);
    expect((await t.request(admin, 'GET', `/api/certificates/${cert.id}/pdf`)).statusCode).toBe(200);
  });

  it('shows nobody to a trainer without groups, and everyone after switching to "all"', async () => {
    expect((await t.request(idle, 'GET', '/api/directory/users')).json<{ items: unknown[] }>().items).toEqual(
      [],
    );
    expect((await t.request(trainer, 'PUT', '/api/settings/trainer-scope', { mode: 'all' })).statusCode).toBe(
      403,
    );
    expect((await t.request(admin, 'PUT', '/api/settings/trainer-scope', { mode: 'all' })).statusCode).toBe(
      200,
    );
    expect(
      (await t.request(idle, 'GET', '/api/directory/users')).json<{ items: unknown[] }>().items.length,
    ).toBeGreaterThanOrEqual(3);
    await t.request(admin, 'PUT', '/api/settings/trainer-scope', { mode: 'managed' });
  });

  it('lets only administrators set managers, and only trainers can be managers', async () => {
    expect(
      (await t.request(trainer, 'PUT', `/api/groups/${groups.g2}/managers`, { userIds: [trainer.userId] }))
        .statusCode,
    ).toBe(403);
    expect(
      (await t.request(admin, 'PUT', `/api/groups/${groups.g2}/managers`, { userIds: [users.l1.id] }))
        .statusCode,
    ).toBe(400);
    expect((await t.request(admin, 'GET', `/api/groups/${groups.g1}/managers`)).json()).toEqual({
      userIds: [trainer.userId],
    });
    expect((await t.request(null, 'GET', `/api/groups/${groups.g1}/managers`)).statusCode).toBe(401);
  });
});

async function packageOf(itemId: string): Promise<string> {
  const row = await t.ctx.db
    .selectFrom('library_items')
    .select('package_id')
    .where('id', '=', itemId)
    .executeTakeFirstOrThrow();
  return row.package_id;
}
