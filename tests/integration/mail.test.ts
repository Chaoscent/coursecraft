// SPDX-License-Identifier: Apache-2.0
// E-mail against a local SMTP server: settings with a sealed password, test
// mail, password reset without account enumeration, assignment notices and
// due-date reminders (once each), plain-text bodies.
import { QUEUES, type MailJob } from '@coursecraft/shared';
import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RecordingQueue } from '../../apps/server/src/jobs/queue.js';
import { handleMailJob, sendDueReminders } from '../../apps/server/src/modules/mail/service.js';
import { scorm12Package } from '../support/packages.js';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';
import { uploadTo } from '../support/courses.js';

interface Received {
  to: string[];
  auth: string | null;
  body: string;
}
const received: Received[] = [];
let smtp: SMTPServer;
let port: number;
let t: TestApp;
let admin: Actor;

beforeAll(async () => {
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onAuth(auth, _session, callback) {
      callback(null, { user: `${auth.username}:${auth.password ?? ''}` });
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        received.push({
          to: session.envelope.rcptTo.map((r) => r.address),
          auth: typeof session.user === 'string' ? session.user : null,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  port = (smtp.server.address() as AddressInfo).port;
  t = await createTestApp({ COURSECRAFT_CONTENT_URL: 'http://localhost:3999' });
  admin = await t.actor(['admin']);
});
afterAll(async () => {
  await t.close();
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
});
beforeEach(() => {
  received.length = 0;
});

const mailJobs = () =>
  (t.ctx.jobs as RecordingQueue).sent.filter((j) => j.queue === QUEUES.mail).map((j) => j.data as MailJob);

/** Runs queued mail jobs like the worker does. */
async function deliverQueued(from: number): Promise<void> {
  for (const job of mailJobs().slice(from)) await handleMailJob(t.ctx, job);
}

async function configure(enabled = true) {
  const res = await t.request(admin, 'PUT', '/api/settings/smtp', {
    enabled,
    host: '127.0.0.1',
    port,
    security: 'none',
    username: 'mailer',
    password: 'smtp-secret-123',
    from: 'Coursecraft <noreply@example.org>',
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ password: { set: boolean } }>();
}

describe('e-mail', () => {
  it('stores the SMTP password sealed and sends a test mail', async () => {
    expect((await configure()).password).toEqual({ set: true });
    const row = await t.ctx.db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'smtp')
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(row.value)).not.toContain('smtp-secret');
    expect(
      JSON.stringify(await t.request(admin, 'GET', '/api/settings/smtp').then((r) => r.json())),
    ).not.toContain('smtp-secret');
    expect((await t.request(admin, 'POST', '/api/settings/smtp/test')).statusCode).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.to).toEqual([admin.email]);
    expect(received[0]?.auth).toBe('mailer:smtp-secret-123');
    expect(received[0]?.body).toContain('Content-Type: text/plain');
  });

  it('resets a password through a single-use link; unknown addresses look the same', async () => {
    await configure();
    const user = await t.createUser(['learner']);
    const before = mailJobs().length;
    const known = await t.request(null, 'POST', '/api/auth/password-reset', { email: user.email });
    const unknown = await t.request(null, 'POST', '/api/auth/password-reset', {
      email: 'nobody@example.org',
    });
    expect([known.statusCode, unknown.statusCode]).toEqual([200, 200]);
    expect(known.body).toBe(unknown.body);
    await expect.poll(() => mailJobs().length).toBe(before + 1);
    expect(JSON.stringify(mailJobs().at(-1))).not.toMatch(/reset-password#/);
    await deliverQueued(before);
    const body = received[0]?.body.replace(/=\r?\n/g, '') ?? '';
    const token = /reset-password#([A-Za-z0-9_-]+)/.exec(body)?.[1] ?? '';
    expect(token).toHaveLength(43);

    const session = await t.login(user.email);
    const confirm = (password: string) =>
      t.request(null, 'POST', '/api/auth/password-reset/confirm', { token, newPassword: password });
    expect((await confirm('a brand new password')).statusCode).toBe(200);
    expect((await confirm('another new password')).statusCode).toBe(400);
    expect((await t.request(session, 'GET', '/api/session')).json()).toMatchObject({ session: null });
    expect((await t.login(user.email, 'a brand new password')).cookie).toBeTruthy();
  });

  it('sends nothing while mail is switched off', async () => {
    await configure(false);
    const user = await t.createUser(['learner']);
    const before = mailJobs().length;
    await t.request(null, 'POST', '/api/auth/password-reset', { email: user.email });
    await new Promise((r) => setTimeout(r, 200));
    expect(mailJobs()).toHaveLength(before);
    expect((await t.request(admin, 'POST', '/api/settings/smtp/test')).statusCode).toBe(400);
  });

  it('notifies assigned learners once and reminds them before the due date', async () => {
    await configure();
    const imported = await uploadTo(
      t,
      admin,
      '/api/library/import',
      'pkg.zip',
      await scorm12Package({ title: 'Brandschutz Basis' }),
    );
    expect(imported.statusCode, imported.body).toBe(200);
    const itemId = imported.json<{ id: string }>().id;
    const a = await t.createUser(['learner']);
    const b = await t.createUser(['learner']);
    const group = (
      await t.request(admin, 'POST', '/api/groups', { name: `Team ${Date.now()}`, parentId: null })
    ).json<{ id: string }>();
    await t.request(admin, 'POST', `/api/groups/${group.id}/members`, { userIds: [b.id] });
    const dueAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
    const before = mailJobs().length;
    const assign = () =>
      t.request(admin, 'POST', `/api/library/${itemId}/assignments`, {
        userIds: [a.id],
        groupIds: [group.id],
        dueAt,
        notify: true,
      });
    expect((await assign()).statusCode).toBe(200);
    expect((await assign()).statusCode).toBe(200);
    expect(
      mailJobs()
        .slice(before)
        .map((j) => [j.kind, j.userId])
        .sort(),
    ).toEqual(
      [
        ['assigned', a.id],
        ['assigned', b.id],
      ].sort(),
    );
    await deliverQueued(before);
    expect(received.map((m) => m.to[0]).sort()).toEqual([a.email, b.email].sort());
    expect(received[0]?.body).toContain('Brandschutz Basis');

    const remindersBefore = mailJobs().length;
    expect(await sendDueReminders(t.ctx)).toBe(2);
    expect(await sendDueReminders(t.ctx)).toBe(0);
    expect(
      mailJobs()
        .slice(remindersBefore)
        .every((j) => j.kind === 'reminder'),
    ).toBe(true);
  });
});
