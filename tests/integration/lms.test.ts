// SPDX-License-Identifier: Apache-2.0
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContentApp } from '../../apps/server/src/http/content-app.js';
import { openCourse, uploadTo } from '../support/courses.js';
import { scorm12Package, scorm2004Package, tincanPackage, zipFiles } from '../support/packages.js';
import { createTestApp, ORIGIN, type Actor, type TestApp } from '../support/test-app.js';

const CONTENT = 'https://content.lernwerk.test';
let t: TestApp;
let content: FastifyInstance;
let admin: Actor;
let author: Actor;
let trainer: Actor;
let learner: Actor;
let outsider: Actor;
let parentGroup: string;

beforeAll(async () => {
  t = await createTestApp({ LERNWERK_CONTENT_URL: CONTENT });
  content = await buildContentApp(t.ctx.config, t.ctx);
  await content.ready();
  admin = await t.actor(['admin']);
  author = await t.actor(['author']);
  trainer = await t.actor(['trainer']);
  learner = await t.actor(['learner']);
  outsider = await t.actor(['learner']);
  // Assignment to a parent group reaches members of its subgroups.
  parentGroup = (await t.request(admin, 'POST', '/api/groups', { name: 'Werk' })).json<{ id: string }>().id;
  const child = (
    await t.request(admin, 'POST', '/api/groups', { name: 'Lager', parentId: parentGroup })
  ).json<{ id: string }>().id;
  await t.request(admin, 'POST', `/api/groups/${child}/members`, { userIds: [learner.userId] });
});
afterAll(async () => {
  await content.close();
  await t.close();
});

async function importPackage(bytes: Buffer, actor = admin) {
  return uploadTo(t, actor, '/api/library/import', 'paket.zip', bytes);
}

async function assign(itemId: string, body: Record<string, unknown> = { groupIds: [parentGroup] }) {
  const res = await t.request(trainer, 'POST', `/api/library/${itemId}/assignments`, body);
  expect(res.statusCode, res.body).toBe(200);
}

async function launchItem(itemId: string, actor = learner, newAttempt = false) {
  const res = await t.request(actor, 'POST', `/api/learn/items/${itemId}/launch`, { newAttempt });
  if (actor === learner && res.statusCode !== 200) throw new Error(`launch: ${res.statusCode} ${res.body}`);
  return res;
}

const tokenOf = (url: string) => /\/launch\/([A-Za-z0-9_-]{43})\//.exec(url)?.[1] ?? '';

function lrs(
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  type = 'application/json',
) {
  return content.inject({
    method,
    url: `/launch/${token}/xapi/${path}`,
    headers: { 'x-experience-api-version': '1.0.3', ...(body !== undefined ? { 'content-type': type } : {}) },
    ...(body !== undefined ? { payload: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

describe('library', () => {
  it('imports SCORM 1.2, SCORM 2004 and Tin Can packages with their launch data', async () => {
    const s12 = await importPackage(await scorm12Package({ mastery: 70 }));
    expect(s12.statusCode, s12.body).toBe(200);
    expect(s12.json()).toMatchObject({ kind: 'scorm12', title: 'Fremdkurs SCORM', multipleUnits: false });
    const s2004 = (await importPackage(await scorm2004Package())).json();
    expect(s2004).toMatchObject({ kind: 'scorm2004', title: 'Kurs 2004', multipleUnits: true });
    const pkg = await t.ctx.db
      .selectFrom('packages')
      .innerJoin('library_items', 'library_items.package_id', 'packages.id')
      .select(['packages.manifest', 'packages.launch_path'])
      .where('library_items.id', '=', s2004.id)
      .executeTakeFirstOrThrow();
    expect(pkg.launch_path).toBe('index.html');
    expect(pkg.manifest).toMatchObject({ launchQuery: 'mode=a', masteryScore: 0.7 });
    expect((await importPackage(await tincanPackage())).json()).toMatchObject({
      kind: 'xapi',
      title: 'Brandschutz xAPI',
    });
  });

  it('refuses unsafe or unknown packages, and imports only for library managers', async () => {
    expect((await importPackage(await zipFiles({ 'index.html': 'x' }))).statusCode).toBe(415);
    expect(
      (await importPackage(await scorm12Package({ href: 'https://evil.example/x.html' }))).statusCode,
    ).toBe(422);
    expect((await importPackage(await scorm12Package({ href: '../../etc/passwd' }))).statusCode).toBe(422);
    expect((await importPackage(Buffer.from('not a zip'))).statusCode).toBe(422);
    expect((await importPackage(await scorm12Package(), author)).statusCode).toBe(403);
    expect((await t.request(learner, 'GET', '/api/library')).statusCode).toBe(403);
    expect((await t.request(trainer, 'GET', '/api/library')).json()).toMatchObject({
      foreignPackagesEnabled: true,
    });
  });

  it('refuses third-party packages without a content origin', async () => {
    const t2 = await createTestApp();
    try {
      const a = await t2.actor(['admin']);
      expect((await uploadTo(t2, a, '/api/library/import', 'p.zip', await scorm12Package())).statusCode).toBe(
        403,
      );
    } finally {
      await t2.close();
    }
  });

  it('publishes an own course as cmi5; publishing again updates the same item', async () => {
    const { id: courseId } = await openCourse(t, author, 'Eigener Kurs');
    const first = await t.request(author, 'POST', '/api/library/publish', { courseId });
    expect(first.statusCode, first.body).toBe(200);
    const second = (await t.request(author, 'POST', '/api/library/publish', { courseId })).json<{
      id: string;
      version: number;
    }>();
    expect(second.id).toBe(first.json<{ id: string }>().id);
    expect(second.version).toBe(2);
    expect((await t.request(outsider, 'POST', '/api/library/publish', { courseId })).statusCode).toBe(403);
    const other = await t.actor(['author']);
    expect((await t.request(other, 'POST', '/api/library/publish', { courseId })).statusCode).toBe(404);
  });
});

describe('SCORM launch and reports', () => {
  it('assigned learners launch through the wrapper; runtime data drives status, score and report', async () => {
    const itemId = (await importPackage(await scorm12Package({ mastery: 70 }))).json<{ id: string }>().id;
    await assign(itemId, { groupIds: [parentGroup], dueAt: '2020-01-01T00:00:00Z' });

    const mine = (await t.request(learner, 'GET', '/api/learn/items')).json<{
      items: { id: string; status: string }[];
    }>();
    expect(mine.items.find((i) => i.id === itemId)).toMatchObject({ status: 'not_started' });
    expect(
      (await t.request(outsider, 'GET', '/api/learn/items')).json<{ items: unknown[] }>().items,
    ).toHaveLength(0);
    expect((await launchItem(itemId, outsider)).statusCode).toBe(404);

    const launch = (await launchItem(itemId)).json<{
      launchId: string;
      url: string;
      kind: string;
      cmi: unknown;
    }>();
    expect(launch.kind).toBe('scorm12');
    expect(launch.url).toMatch(new RegExp(`^${CONTENT}/launch/[A-Za-z0-9_-]{43}/_lw/wrapper\\.html$`));
    expect(launch.cmi).toEqual({});

    const wrapper = await content.inject({ url: new URL(launch.url).pathname });
    expect(wrapper.statusCode).toBe(200);
    expect(wrapper.headers['content-security-policy']).toContain(`frame-ancestors ${ORIGIN}`);
    expect(wrapper.body).toContain(`data-app-origin="${ORIGIN}"`);
    const sco = await content.inject({ url: `/launch/${tokenOf(launch.url)}/content/index.html` });
    expect(sco.statusCode).toBe(200);
    expect(sco.headers['content-security-policy']).toContain("'unsafe-inline'");
    expect(sco.headers['set-cookie']).toBeUndefined();

    const commit = (cmi: unknown, finished = false) =>
      t.request(learner, 'POST', `/api/learn/launches/${launch.launchId}/scorm`, { cmi, finished });
    expect((await commit({ suspend_data: '1', core: { lesson_status: 'incomplete' } })).statusCode).toBe(200);
    // Score 60 is below the mastery score: failed although the SCO says passed.
    await commit(
      {
        core: {
          lesson_status: 'passed',
          score: { raw: '60', min: '0', max: '100' },
          session_time: '00:02:30',
        },
        interactions: { 0: { id: 'frage-1', type: 'choice', student_response: 'b', result: 'correct' } },
      },
      true,
    );
    expect(
      (await t.request(outsider, 'POST', `/api/learn/launches/${launch.launchId}/scorm`, { cmi: {} }))
        .statusCode,
    ).toBe(404);

    const report = (await t.request(trainer, 'GET', `/api/reports/items/${itemId}`)).json<{
      rows: { userId: string; status: string; scoreScaled: number; timeSpentMs: number; overdue: boolean }[];
      questions: { questionId: string; answers: number; correct: number }[];
    }>();
    expect(report.rows.find((r) => r.userId === learner.userId)).toMatchObject({
      status: 'failed',
      scoreScaled: 0.6,
      timeSpentMs: 150_000,
      overdue: true,
    });
    expect(report.questions).toEqual([
      expect.objectContaining({ questionId: 'frage-1', answers: 1, correct: 1 }),
    ]);

    // Resume hands the stored runtime data back.
    const again = (await launchItem(itemId)).json<{ cmi: Record<string, unknown> }>();
    expect(again.cmi['core']).toMatchObject({ lesson_status: 'passed' });

    const csv = await t.request(trainer, 'GET', `/api/reports/items/${itemId}/csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('failed');
    expect((await t.request(learner, 'GET', `/api/reports/items/${itemId}`)).statusCode).toBe(403);
  });
});

describe('cmi5 launch and LRS', () => {
  async function ownItem() {
    const { id: courseId } = await openCourse(t, author, `cmi5 ${Date.now()}`);
    const itemId = (await t.request(author, 'POST', '/api/library/publish', { courseId })).json<{
      id: string;
    }>().id;
    await assign(itemId, { userIds: [learner.userId] });
    const launch = (await launchItem(itemId)).json<{
      launchId: string;
      registrationId: string;
      url: string;
    }>();
    const url = new URL(launch.url);
    return {
      itemId,
      launch,
      url,
      token: tokenOf(launch.url),
      actor: JSON.parse(url.searchParams.get('actor') ?? '{}') as Record<string, unknown>,
    };
  }

  it('serves the course with a strict policy and implements the cmi5 launch protocol', async () => {
    const { url, token, actor, launch } = await ownItem();
    expect(url.origin).toBe(CONTENT);
    expect(url.searchParams.get('endpoint')).toBe(`${CONTENT}/launch/${token}/xapi/`);
    expect(url.searchParams.get('registration')).toBe(launch.registrationId);
    const page = await content.inject({ url: url.pathname });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-security-policy']).toContain("script-src 'self';");

    const fetch1 = await content.inject({ method: 'POST', url: `/launch/${token}/fetch` });
    expect(fetch1.json()).toHaveProperty('auth-token');
    expect((await content.inject({ method: 'POST', url: `/launch/${token}/fetch` })).json()).toMatchObject({
      'error-code': '1',
    });

    const activityId = url.searchParams.get('activityId') ?? '';
    const query = new URLSearchParams({
      activityId,
      agent: JSON.stringify(actor),
      registration: launch.registrationId,
      stateId: 'LMS.LaunchData',
    });
    const launchData = await lrs(token, 'GET', `activities/state?${query.toString()}`);
    expect(launchData.statusCode).toBe(200);
    expect(launchData.json()).toMatchObject({ launchMode: 'Normal', moveOn: 'Completed' });

    query.set('stateId', 'resume');
    expect((await lrs(token, 'PUT', `activities/state?${query.toString()}`, { a: 1 })).statusCode).toBe(204);
    expect((await lrs(token, 'POST', `activities/state?${query.toString()}`, { b: 2 })).statusCode).toBe(204);
    expect((await lrs(token, 'GET', `activities/state?${query.toString()}`)).json()).toEqual({ a: 1, b: 2 });
    const foreignAgent = new URLSearchParams(query);
    foreignAgent.set('agent', JSON.stringify({ mbox: 'mailto:x@example.org' }));
    expect((await lrs(token, 'GET', `activities/state?${foreignAgent.toString()}`)).statusCode).toBe(403);
  });

  it('stores statements of the launched learner only and projects results', async () => {
    const { token, actor, launch, itemId } = await ownItem();
    const context = { registration: launch.registrationId };
    const answered = {
      actor,
      verb: { id: 'http://adlnet.gov/expapi/verbs/answered' },
      object: {
        id: 'urn:lernwerk:course:x/quiz/essay',
        definition: { interactionType: 'long-fill-in', description: { de: 'Beschreiben Sie' } },
      },
      result: { response: 'Meine Antwort', score: { raw: 0, max: 4 } },
      context,
    };
    const passed = {
      actor,
      verb: { id: 'http://adlnet.gov/expapi/verbs/passed' },
      object: { id: 'urn:x' },
      result: { score: { scaled: 0.5 } },
      context,
    };
    const stored = await lrs(token, 'POST', 'statements', [answered, passed]);
    expect(stored.statusCode, stored.body).toBe(200);
    const [answerId] = stored.json<string[]>();
    expect((await lrs(token, 'GET', `statements?statementId=${answerId}`)).json()).toMatchObject({
      id: answerId,
      version: '1.0.3',
    });
    // Same id, different content: conflict. Same content again: accepted.
    expect((await lrs(token, 'POST', 'statements', { ...passed, id: answerId })).statusCode).toBe(409);

    expect(
      (await lrs(token, 'POST', 'statements', { ...passed, actor: { mbox: 'mailto:x@example.org' } }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await lrs(token, 'POST', 'statements', {
          ...passed,
          context: { registration: '00000000-0000-4000-8000-000000000000' },
        })
      ).statusCode,
    ).toBe(403);
    expect((await lrs(token, 'POST', 'statements', { actor })).statusCode).toBe(400);

    const mine = (await t.request(learner, 'GET', '/api/learn/items')).json<{
      items: { id: string; status: string; scoreScaled: number }[];
    }>();
    expect(mine.items.find((i) => i.id === itemId)).toMatchObject({ status: 'passed', scoreScaled: 0.5 });

    // Essay waits for manual grading.
    const queue = (await t.request(trainer, 'GET', '/api/grading')).json<{
      items: { registrationId: string; questionId: string; response: string }[];
    }>();
    const entry = queue.items.find((i) => i.registrationId === launch.registrationId);
    expect(entry).toMatchObject({ response: 'Meine Antwort' });
    expect((await t.request(learner, 'GET', '/api/grading')).statusCode).toBe(403);
    const graded = await t.request(trainer, 'POST', '/api/grading', {
      registrationId: launch.registrationId,
      questionId: entry?.questionId,
      score: 3,
    });
    expect(graded.statusCode, graded.body).toBe(200);
    const reg = await t.ctx.db
      .selectFrom('registrations')
      .select('score_scaled')
      .where('id', '=', launch.registrationId)
      .executeTakeFirstOrThrow();
    expect(reg.score_scaled).toBe(0.75);
  });

  it('rejects unknown, revoked and foreign launch tokens and unsafe paths', async () => {
    const { token, launch } = await ownItem();
    expect((await content.inject({ url: `/launch/${token}/../../../etc/passwd` })).statusCode).toBe(404);
    expect((await content.inject({ url: `/launch/${token}/%2e%2e/%2e%2e/etc/passwd` })).statusCode).toBe(404);
    expect((await content.inject({ url: `/launch/${'a'.repeat(43)}/index.html` })).statusCode).toBe(404);
    // Cookies are ignored on the content origin.
    const withCookie = await content.inject({
      url: `/launch/${'a'.repeat(43)}/index.html`,
      cookies: { '__Host-lw_session': learner.cookie },
    });
    expect(withCookie.statusCode).toBe(404);
    expect(
      (await t.request(learner, 'POST', `/api/learn/launches/${launch.launchId}/heartbeat`)).statusCode,
    ).toBe(200);
    expect(
      (await t.request(outsider, 'POST', `/api/learn/launches/${launch.launchId}/heartbeat`)).statusCode,
    ).toBe(404);
    expect((await t.request(learner, 'POST', `/api/learn/launches/${launch.launchId}/end`)).statusCode).toBe(
      200,
    );
    expect((await content.inject({ url: `/launch/${token}/index.html` })).statusCode).toBe(404);
  });

  it('ends launches with the session (logout)', async () => {
    const session = await t.login(learner.email);
    const { id: courseId } = await openCourse(t, author, 'Logout');
    const itemId = (await t.request(author, 'POST', '/api/library/publish', { courseId })).json<{
      id: string;
    }>().id;
    await assign(itemId, { userIds: [learner.userId] });
    const url = (await t.request(session, 'POST', `/api/learn/items/${itemId}/launch`, {})).json<{
      url: string;
    }>().url;
    const path = new URL(url).pathname;
    expect((await content.inject({ url: path })).statusCode).toBe(200);
    await t.request(session, 'POST', '/api/auth/logout');
    expect((await content.inject({ url: path })).statusCode).toBe(404);
  });
});
