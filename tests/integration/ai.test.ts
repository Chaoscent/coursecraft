// SPDX-License-Identifier: Apache-2.0
// Optional AI adapter against fake providers on loopback: operator switch,
// sealed keys, preview = exactly what is sent, single-use confirmation,
// quotas, personal keys, untrusted responses, audit metadata, egress guard.
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openCourse } from '../support/courses.js';
import { blocked } from '../support/egress-guard.js';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';

interface Received {
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let reply: (url: string) => { status: number; body: string; headers?: Record<string, string> };
const received: Received[] = [];
let server: Server;
let base: string;

const QUESTIONS = {
  questions: [
    {
      prompt: 'Notruf?',
      choices: [
        { text: '112', correct: true },
        { text: '110', correct: false },
      ],
      feedback: 'Ja.',
    },
  ],
};
const openai = (content: string) => JSON.stringify({ choices: [{ message: { content } }] });

let t: TestApp;
let admin: Actor;
let author: Actor;
let courseId: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      const r = reply(req.url ?? '');
      res.writeHead(r.status, { 'content-type': 'application/json', ...r.headers });
      res.end(r.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t = await createTestApp({
    COURSECRAFT_AI_ENABLED: 'true',
    COURSECRAFT_AI_TIMEOUT_SECONDS: '5',
    COURSECRAFT_AI_RATE_LIMIT: '1000',
  });
  admin = await t.actor(['admin']);
  author = await t.actor(['author']);
  courseId = (await openCourse(t, author)).id;
});
afterAll(async () => {
  await t.close();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  received.length = 0;
  reply = () => ({ status: 200, body: openai(JSON.stringify(QUESTIONS)) });
});

async function provider(input: Record<string, unknown> = {}): Promise<string> {
  const res = await t.request(admin, 'POST', '/api/ai/providers', {
    name: 'Lokal',
    kind: 'openai',
    baseUrl: `${base}/v1`,
    model: 'test-model',
    enabled: true,
    allowUserKeys: false,
    dailyQuota: null,
    key: 'sk-shared-secret-1234',
    ...input,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ id: string }>().id;
}

const questionsPreview = (providerId: string, actor = author, course = courseId) =>
  t.request(actor, 'POST', '/api/ai/preview', {
    task: 'questions',
    providerId,
    courseId: course,
    count: 1,
    lang: 'de',
    text: 'Der Notruf ist 112.',
  });

describe('AI adapter', () => {
  it('stores keys sealed, shows only the last four characters', async () => {
    const id = await provider();
    const list = (await t.request(admin, 'GET', '/api/ai/providers')).json<{
      allowedByOperator: boolean;
      providers: { id: string; key: unknown }[];
    }>();
    expect(list.allowedByOperator).toBe(true);
    expect(list.providers.find((p) => p.id === id)?.key).toEqual({ set: true, last4: '1234' });
    const row = await t.ctx.db
      .selectFrom('ai_providers')
      .select('api_key')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(row.api_key)).not.toContain('sk-shared');
    const audit = await t.ctx.db.selectFrom('audit_log').select('meta').where('target_id', '=', id).execute();
    expect(JSON.stringify(audit)).not.toContain('sk-shared');
  });

  it('previews without sending, then sends exactly the previewed body once', async () => {
    const id = await provider();
    const status = (await t.request(author, 'GET', '/api/ai/status')).json<{
      available: boolean;
      providers: { id: string; ready: boolean }[];
    }>();
    expect(status.available).toBe(true);
    expect(status.providers.find((p) => p.id === id)?.ready).toBe(true);

    const preview = await questionsPreview(id);
    expect(preview.statusCode, preview.body).toBe(200);
    const p = preview.json<{ previewId: string; endpoint: string; body: string }>();
    expect(p.endpoint).toBe(`${base}/v1/chat/completions`);
    expect(p.body).not.toContain('sk-shared');
    expect(received).toHaveLength(0);

    const run = await t.request(author, 'POST', '/api/ai/run', { previewId: p.previewId });
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json()).toEqual({ task: 'questions', questions: QUESTIONS.questions });
    expect(received).toHaveLength(1);
    expect(received[0]?.body).toBe(p.body);
    expect(received[0]?.headers['authorization']).toBe('Bearer sk-shared-secret-1234');

    expect((await t.request(author, 'POST', '/api/ai/run', { previewId: p.previewId })).statusCode).toBe(404);
    expect(received).toHaveLength(1);

    const audit = await t.ctx.db
      .selectFrom('audit_log')
      .select('meta')
      .where('action', '=', 'ai.request')
      .where('actor_user_id', '=', author.userId)
      .execute();
    expect(audit.at(-1)?.meta).toMatchObject({ task: 'questions', outcome: 'ok', inputChars: 19 });
    expect(JSON.stringify(audit)).not.toContain('Notruf');
  });

  it('keeps previews private and needs edit rights on the course', async () => {
    const id = await provider();
    const other = await t.actor(['author']);
    expect((await questionsPreview(id, other)).statusCode).toBe(404);
    const p = (await questionsPreview(id)).json<{ previewId: string }>();
    expect((await t.request(other, 'POST', '/api/ai/run', { previewId: p.previewId })).statusCode).toBe(404);
    expect((await t.request(admin, 'POST', '/api/ai/run', { previewId: p.previewId })).statusCode).toBe(404);
    expect(received).toHaveLength(0);
  });

  it('enforces the daily quota per user', async () => {
    const id = await provider({ dailyQuota: 1 });
    const first = (await questionsPreview(id)).json<{ previewId: string }>();
    const second = (await questionsPreview(id)).json<{ previewId: string }>();
    expect((await t.request(author, 'POST', '/api/ai/run', { previewId: first.previewId })).statusCode).toBe(
      200,
    );
    const refused = await t.request(author, 'POST', '/api/ai/run', { previewId: second.previewId });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ error: { code: 'quota_exceeded' } });
    expect(received).toHaveLength(1);
  });

  it('uses a personal key when the provider allows it', async () => {
    const id = await provider({ kind: 'anthropic', baseUrl: base, key: null, allowUserKeys: true });
    reply = () => ({ status: 200, body: JSON.stringify({ content: [{ type: 'text', text: 'Kurz.' }] }) });
    const status = () =>
      t
        .request(author, 'GET', '/api/ai/status')
        .then((r) => r.json<{ providers: { id: string; ready: boolean }[] }>());
    expect((await status()).providers.find((p) => p.id === id)?.ready).toBe(false);
    expect(
      (await t.request(author, 'PUT', `/api/ai/providers/${id}/key`, { key: 'sk-personal-9876' })).statusCode,
    ).toBe(200);
    expect((await status()).providers.find((p) => p.id === id)?.ready).toBe(true);
    const p = (
      await t.request(author, 'POST', '/api/ai/preview', {
        task: 'rewrite',
        providerId: id,
        courseId,
        mode: 'shorten',
        text: 'Ein langer Text.',
      })
    ).json<{ previewId: string }>();
    const run = await t.request(author, 'POST', '/api/ai/run', { previewId: p.previewId });
    expect(run.json()).toEqual({ task: 'rewrite', text: 'Kurz.' });
    expect(received[0]?.url).toBe('/v1/messages');
    expect(received[0]?.headers['x-api-key']).toBe('sk-personal-9876');

    const closed = await provider({ allowUserKeys: false });
    expect(
      (await t.request(author, 'PUT', `/api/ai/providers/${closed}/key`, { key: 'sk-x' })).statusCode,
    ).toBe(403);
  });

  it('treats failures, redirects and malformed answers as upstream errors', async () => {
    const id = await provider();
    const attempt = async () => {
      const p = (await questionsPreview(id)).json<{ previewId: string }>();
      return t.request(author, 'POST', '/api/ai/run', { previewId: p.previewId });
    };
    reply = () => ({ status: 500, body: '{"error":"boom"}' });
    expect((await attempt()).json()).toMatchObject({ error: { code: 'upstream_failed' } });
    reply = () => ({ status: 302, body: '', headers: { location: 'http://127.0.0.1:1/' } });
    expect((await attempt()).statusCode).toBe(502);
    reply = () => ({ status: 200, body: openai('Leider weiß ich das nicht.') });
    expect((await attempt()).json()).toMatchObject({ error: { code: 'upstream_failed' } });
    reply = () => ({ status: 200, body: 'x'.repeat(2 * 1024 * 1024) });
    expect((await attempt()).statusCode).toBe(502);
  });

  it('never reaches hosts other than loopback in tests (egress guard)', async () => {
    const id = await provider({ baseUrl: 'https://ai.example.org/v1' });
    const p = (await questionsPreview(id)).json<{ previewId: string }>();
    expect((await t.request(author, 'POST', '/api/ai/run', { previewId: p.previewId })).statusCode).toBe(502);
    expect(blocked).toContain('ai.example.org');
  });
});

describe('AI adapter switched off by the operator', () => {
  let off: TestApp;
  beforeAll(async () => {
    off = await createTestApp();
  });
  afterAll(async () => off.close());

  it('hides AI and refuses configuration', async () => {
    const a = await off.actor(['admin']);
    expect((await off.request(a, 'GET', '/api/ai/status')).json()).toEqual({
      available: false,
      providers: [],
    });
    const res = await off.request(a, 'POST', '/api/ai/providers', {
      name: 'X',
      kind: 'openai',
      baseUrl: 'http://127.0.0.1:9/v1',
      model: 'm',
      enabled: true,
      allowUserKeys: false,
      dailyQuota: null,
    });
    expect(res.statusCode).toBe(403);
  });
});
