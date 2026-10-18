// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';
import { ADMIN } from '../support.js';
import { exportCourse, serveLms, serveLrs, takeQuiz } from '../support-export.js';

test('SCORM 2004 package reports score, success and interactions', async ({ page, request, baseURL }) => {
  const files = await exportCourse(request, baseURL ?? '', ADMIN.email, ADMIN.password, 'scorm2004-4', true);
  const external = await serveLms(page, files);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://lms.test/harness/scorm2004.html');
  await takeQuiz(page.frameLocator('#sco'));
  const cmi = await page.evaluate(() => {
    const api = (window as unknown as { API_1484_11: { GetValue: (k: string) => string } }).API_1484_11;
    return {
      success: api.GetValue('cmi.success_status'),
      completion: api.GetValue('cmi.completion_status'),
      scaled: Number(api.GetValue('cmi.score.scaled')),
      interactions: Number(api.GetValue('cmi.interactions._count')),
      firstType: api.GetValue('cmi.interactions.0.type'),
      firstResponse: api.GetValue('cmi.interactions.0.learner_response'),
      thirdResult: api.GetValue('cmi.interactions.2.result'),
    };
  });
  expect(cmi).toMatchObject({
    success: 'passed',
    completion: 'completed',
    interactions: 3,
    firstType: 'choice',
    firstResponse: 'a',
    thirdResult: 'incorrect',
  });
  expect(cmi.scaled).toBeCloseTo(0.6667, 3);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('cmi5 package follows the launch protocol and sends cmi5 statements', async ({
  page,
  request,
  baseURL,
}) => {
  const files = await exportCourse(request, baseURL ?? '', ADMIN.email, ADMIN.password, 'cmi5', true);
  const registration = '7d3a0fa1-8c0e-4d0e-9c6f-0a4f0c3d2b11';
  const lrs = await serveLrs(page, files, {
    launchMode: 'Normal',
    moveOn: 'Passed',
    masteryScore: 0.6,
    returnURL: 'http://pkg.test/returned.html',
    contextTemplate: {
      contextActivities: { grouping: [{ id: 'urn:test:course' }] },
      extensions: { 'https://w3id.org/xapi/cmi5/context/extensions/sessionid': 'session-1' },
    },
  });
  const actor = JSON.stringify({
    objectType: 'Agent',
    account: { homePage: 'http://lms.test', name: 'learner-1' },
  });
  const params = new URLSearchParams({
    endpoint: 'http://lrs.test/xapi/',
    fetch: 'http://lrs.test/fetch',
    actor,
    registration,
    activityId: 'urn:coursecraft:au:test',
  });
  await page.goto(`http://pkg.test/index.html?${params}`);
  await takeQuiz(page);
  await expect
    .poll(() => lrs.statements.filter((s) => (s['verb'] as { id: string }).id.endsWith('/completed')).length)
    .toBe(1);
  await page.getByRole('button', { name: 'Beenden' }).click();
  await expect(page).toHaveURL(/returned\.html$/);

  const verbs = lrs.statements.map((s) => (s['verb'] as { id: string }).id.split('/').pop());
  expect(verbs[0]).toBe('initialized');
  expect(verbs).toContain('answered');
  expect(verbs.indexOf('passed')).toBeGreaterThan(verbs.lastIndexOf('answered'));
  expect(verbs).toContain('completed');
  expect(verbs.at(-1)).toBe('terminated');
  expect(lrs.tokenFetches).toBe(1);
  for (const statement of lrs.statements) {
    const context = statement['context'] as {
      registration: string;
      extensions?: Record<string, unknown>;
      contextActivities?: { category?: { id: string }[] };
    };
    expect(context.registration).toBe(registration);
    expect(context.extensions?.['https://w3id.org/xapi/cmi5/context/extensions/sessionid']).toBe('session-1');
  }
  const passed = lrs.statements.find((s) => (s['verb'] as { id: string }).id.endsWith('/passed'));
  expect(passed?.['result']).toMatchObject({ success: true });
  const categories = (
    passed?.['context'] as { contextActivities: { category: { id: string }[] } }
  ).contextActivities.category.map((c) => c.id);
  expect(categories).toContain('https://w3id.org/xapi/cmi5/context/categories/moveon');
  const answered = lrs.statements.find((s) => (s['verb'] as { id: string }).id.endsWith('/answered'));
  const answeredCategories = (answered?.['context'] as { contextActivities: { category?: unknown[] } })
    .contextActivities.category;
  expect(answeredCategories).toBeUndefined();
});

test('cmi5 in Browse mode reports no completion', async ({ page, request, baseURL }) => {
  const files = await exportCourse(request, baseURL ?? '', ADMIN.email, ADMIN.password, 'cmi5', true);
  const lrs = await serveLrs(page, files, { launchMode: 'Browse', moveOn: 'Passed' });
  const params = new URLSearchParams({
    endpoint: 'http://lrs.test/xapi/',
    fetch: 'http://lrs.test/fetch',
    actor: JSON.stringify({ mbox: 'mailto:a@example.org' }),
    registration: '7d3a0fa1-8c0e-4d0e-9c6f-0a4f0c3d2b12',
    activityId: 'urn:x',
  });
  await page.goto(`http://pkg.test/index.html?${params}`);
  await takeQuiz(page);
  await page.waitForTimeout(500);
  const verbs = lrs.statements.map((s) => (s['verb'] as { id: string }).id.split('/').pop());
  expect(verbs).not.toContain('completed');
  expect(verbs).not.toContain('passed');
});

test('xAPI package sends statements and resumes from the state API', async ({ page, request, baseURL }) => {
  const files = await exportCourse(request, baseURL ?? '', ADMIN.email, ADMIN.password, 'xapi', true);
  const lrs = await serveLrs(page, files, {});
  const params = new URLSearchParams({
    endpoint: 'http://lrs.test/xapi/',
    auth: 'Basic dG9rZW4=',
    actor: JSON.stringify({ mbox: 'mailto:a@example.org', name: 'A' }),
    activity_id: 'urn:coursecraft:test',
  });
  await page.goto(`http://pkg.test/index.html?${params}`);
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect.poll(() => lrs.state.has('urn:coursecraft:resume')).toBe(true);
  await page.reload();
  await expect(page.getByText('2 von 3')).toBeVisible();
  const verbs = lrs.statements.map((s) => (s['verb'] as { id: string }).id.split('/').pop());
  expect(verbs).toContain('initialized');
  expect(verbs).toContain('experienced');
});
