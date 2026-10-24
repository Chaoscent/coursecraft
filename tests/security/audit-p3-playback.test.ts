// SPDX-License-Identifier: Apache-2.0
// Security audit (SECURITY_AUDIT.md, Priority 3): playback on the app origin.
// Default installation: no COURSECRAFT_CONTENT_URL and a single organisation,
// so own courses play under /launch/<token>/ on the APP origin.
//
// F-12 (SECURITY_AUDIT.md): the end-to-end test is marked `it.fails`
// (expected failure) while the finding is open. With M-4 applied it passes,
// `it.fails` then reports it, and `.fails` must be removed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openCourse } from '../support/courses.js';
import { createTestApp, ORIGIN, type Actor, type TestApp } from '../support/test-app.js';

let t: TestApp;
let admin: Actor;
let author: Actor;
let learner: Actor;

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.actor(['admin']);
  author = await t.actor(['author']);
  learner = await t.actor(['learner']);
});
afterAll(async () => t.close());

const tokenOf = (url: string) => /\/launch\/([A-Za-z0-9_-]{43})\//.exec(url)?.[1] ?? '';

/** The CSP directive values a browser would apply, by directive name. */
function csp(header: string | string[] | number | undefined): Map<string, string[]> {
  const value = Array.isArray(header) ? header.join(',') : String(header ?? '');
  return new Map(
    value
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name ?? '', values]),
  );
}

type Headers = Record<string, string | string[] | number | undefined>;

/**
 * What M-4 (SECURITY_AUDIT.md) guarantees for a stored document: a
 * server-chosen inert type, no sniffing, download instead of rendering, and a
 * sandbox that blocks scripts even if a browser rendered it anyway.
 */
function isInertDocument(headers: Headers): boolean {
  const type = String(headers['content-type'] ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  const policy = csp(headers['content-security-policy']);
  return (
    ['application/json', 'text/plain', 'application/octet-stream'].includes(type ?? '') &&
    headers['x-content-type-options'] === 'nosniff' &&
    /^attachment\b/i.test(String(headers['content-disposition'] ?? '')) &&
    policy.has('sandbox') &&
    (policy.get('default-src') ?? []).includes("'none'")
  );
}

describe('P3: xAPI documents served on the app origin', () => {
  it('the safety predicate accepts the M-4 headers and rejects what is served today', () => {
    // Headers the drafted M-4 sends for a document stored as text/html.
    const m4: Headers = {
      'content-type': 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'attachment',
      'content-security-policy': "default-src 'none'; sandbox",
    };
    expect(isInertDocument(m4)).toBe(true);
    const today: Headers = {
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self';script-src 'self';frame-ancestors 'none'",
    };
    expect(isInertDocument(today)).toBe(false);
  });

  // F-12: fails today; remove `.fails` once the fix is in.
  it.fails('a learner cannot make the app origin serve their HTML and script to another user', async () => {
    // Setup: an own course, published and assigned to the (malicious) learner.
    const { id: courseId } = await openCourse(t, author, `xss ${Date.now()}`);
    const itemId = (await t.request(author, 'POST', '/api/library/publish', { courseId })).json<{
      id: string;
    }>().id;
    await t.request(admin, 'POST', `/api/library/${itemId}/assignments`, { userIds: [learner.userId] });
    const launch = (
      await t.request(learner, 'POST', `/api/learn/items/${itemId}/launch`, { newAttempt: false })
    ).json<{
      url: string;
    }>();
    expect(new URL(launch.url).origin).toBe(ORIGIN);
    const token = tokenOf(launch.url);
    const doc = (id: string) => `/launch/${token}/xapi/activities/profile?activityId=urn:x&profileId=${id}`;

    // The learner stores a script and a page that loads it (activity profiles need no agent).
    const put = (id: string, type: string, payload: string) =>
      t.app.inject({ method: 'PUT', url: doc(id), headers: { 'content-type': type }, payload });
    expect(
      (await put('js', 'application/javascript', "fetch('/api/session').then(r=>r.json())")).statusCode,
    ).toBe(204);
    expect(
      (await put('page', 'text/html; charset=utf-8', `<script src="${doc('js')}"></script>`)).statusCode,
    ).toBe(204);

    // The victim (an administrator) opens the link; the browser sends the session cookie.
    const page = await t.app.inject({
      method: 'GET',
      url: doc('page'),
      cookies: { '__Host-cc_session': admin.cookie },
    });
    const script = await t.app.inject({
      method: 'GET',
      url: doc('js'),
      cookies: { '__Host-cc_session': admin.cookie },
    });
    const policy = csp(page.headers['content-security-policy']);
    const rendersHtml = page.statusCode === 200 && /^text\/html/.test(String(page.headers['content-type']));
    const runsSameOriginScript =
      !policy.has('sandbox') &&
      (policy.get('script-src') ?? policy.get('default-src') ?? ["'self'"]).includes("'self'") &&
      script.statusCode === 200 &&
      /javascript/.test(String(script.headers['content-type']));

    // Evidence for the report.
    console.info(
      'page:',
      page.statusCode,
      page.headers['content-type'],
      page.headers['content-security-policy'],
    );
    console.info('script:', script.statusCode, script.headers['content-type']);
    expect(rendersHtml && runsSameOriginScript).toBe(false);
    // M-4: both stored documents come back inert, whatever type the learner sent.
    expect(isInertDocument(page.headers)).toBe(true);
    expect(isInertDocument(script.headers)).toBe(true);
  });
});
