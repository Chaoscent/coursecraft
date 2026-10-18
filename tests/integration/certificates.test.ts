// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uploadTo } from '../support/courses.js';
import { scorm12Package } from '../support/packages.js';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';

let t: TestApp;
let admin: Actor;
let learner: Actor;
let other: Actor;
let itemId: string;

beforeAll(async () => {
  t = await createTestApp({ COURSECRAFT_CONTENT_URL: 'https://content.coursecraft.test' });
  admin = await t.actor(['admin']);
  learner = await t.actor(['learner']);
  other = await t.actor(['learner']);
  const imported = await uploadTo(
    t,
    admin,
    '/api/library/import',
    'p.zip',
    await scorm12Package({ title: 'Brandschutz (Grundlagen)', mastery: 70 }),
  );
  itemId = imported.json<{ id: string }>().id;
  await t.request(admin, 'POST', `/api/library/${itemId}/assignments`, { userIds: [learner.userId] });
});
afterAll(async () => t.close());

async function attempt(status: string, raw: string, newAttempt = false) {
  const launch = (
    await t.request(learner, 'POST', `/api/learn/items/${itemId}/launch`, { newAttempt })
  ).json<{ launchId: string }>();
  const res = await t.request(learner, 'POST', `/api/learn/launches/${launch.launchId}/scorm`, {
    cmi: { core: { lesson_status: status, score: { raw, min: '0', max: '100' }, session_time: '00:01:00' } },
    finished: true,
  });
  expect(res.statusCode, res.body).toBe(200);
}

describe('certificates', () => {
  it('are refused before the course is passed, also after a failed attempt', async () => {
    expect((await t.request(learner, 'POST', `/api/learn/items/${itemId}/certificate`)).statusCode).toBe(403);
    await attempt('passed', '50');
    expect((await t.request(learner, 'POST', `/api/learn/items/${itemId}/certificate`)).statusCode).toBe(403);
  });

  it('are issued once per passed attempt and downloaded as PDF by the owner', async () => {
    await attempt('passed', '90', true);
    const first = await t.request(learner, 'POST', `/api/learn/items/${itemId}/certificate`);
    expect(first.statusCode, first.body).toBe(200);
    const cert = first.json<{ id: string; serial: string; itemTitle: string }>();
    expect(cert.serial).toMatch(/^CC-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(cert.itemTitle).toBe('Brandschutz (Grundlagen)');
    expect((await t.request(learner, 'POST', `/api/learn/items/${itemId}/certificate`)).json()).toMatchObject(
      { id: cert.id },
    );

    const pdf = await t.request(learner, 'GET', `/api/certificates/${cert.id}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain(`${cert.serial}.pdf`);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.rawPayload.toString('latin1')).toContain('/Helvetica');

    const list = (await t.request(learner, 'GET', '/api/learn/certificates')).json<{
      items: { id: string }[];
    }>();
    expect(list.items.map((c) => c.id)).toEqual([cert.id]);

    // Nobody else sees it, except people who may read reports.
    expect((await t.request(other, 'GET', `/api/certificates/${cert.id}/pdf`)).statusCode).toBe(404);
    expect((await t.request(admin, 'GET', `/api/certificates/${cert.id}/pdf`)).statusCode).toBe(200);
    expect((await t.request(other, 'POST', `/api/learn/items/${itemId}/certificate`)).statusCode).toBe(403);
  });

  it('can be verified by anyone who has the number, and nothing else is revealed', async () => {
    const [cert] = (await t.request(learner, 'GET', '/api/learn/certificates')).json<{
      items: { serial: string }[];
    }>().items;
    const serial = cert?.serial ?? '';
    const res = await t.request(null, 'GET', `/api/certificates/verify/${serial.toLowerCase()}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<Record<string, string>>();
    expect(body).toMatchObject({ serial, itemTitle: 'Brandschutz (Grundlagen)' });
    expect(body['learnerName']).toBeTruthy();
    // No ids, e-mail addresses or scores.
    expect(Object.keys(body).sort()).toEqual([
      'completedAt',
      'issuedAt',
      'itemTitle',
      'learnerName',
      'serial',
    ]);
    expect((await t.request(null, 'GET', '/api/certificates/verify/CC-AAAA-BBBB-CCCC')).statusCode).toBe(404);
    expect((await t.request(null, 'GET', "/api/certificates/verify/CC-AAAA-BBBB-CCC'")).statusCode).toBe(400);
  });

  it('prints the verification address on the certificate', async () => {
    const [cert] = (await t.request(learner, 'GET', '/api/learn/certificates')).json<{
      items: { id: string; serial: string }[];
    }>().items;
    const pdf = await t.request(learner, 'GET', `/api/certificates/${cert?.id ?? ''}/pdf`);
    // Text is written as hex strings in the content stream.
    expect(pdf.rawPayload.toString('latin1')).toContain(
      Buffer.from(`/verify/${cert?.serial ?? ''}`).toString('hex'),
    );
  });

  it('exports the report as Excel workbook for report readers only', async () => {
    const xlsx = await t.request(admin, 'GET', `/api/reports/items/${itemId}/xlsx`);
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(xlsx.rawPayload.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect((await t.request(learner, 'GET', `/api/reports/items/${itemId}/xlsx`)).statusCode).toBe(403);
  });
});
