// SPDX-License-Identifier: Apache-2.0
// Exports built in the background: queued, built, stored, downloaded, purged.
import { QUEUES } from '@coursecraft/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RecordingQueue } from '../../apps/server/src/jobs/queue.js';
import { handleExportJob, purgeExports } from '../../apps/server/src/modules/exports/jobs.js';
import { openCourse, PNG_1X1, upload } from '../support/courses.js';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';

let t: TestApp;
let author: Actor;
let stranger: Actor;
let courseId: string;
let sha: string;

beforeAll(async () => {
  t = await createTestApp();
  author = await t.actor(['author']);
  stranger = await t.actor(['author']);
  const { id } = await openCourse(t, author, 'Großer Kurs');
  courseId = id;
  sha = (await upload(t, author, id, 'dot.png', PNG_1X1)).json<{ sha256: string }>().sha256;
});
afterAll(() => t.close());

const lastJob = () => {
  const sent = (t.ctx.jobs as RecordingQueue).sent.filter((j) => j.queue === QUEUES.exportBuild);
  return sent.at(-1)?.data as { exportId: string };
};

describe('background exports', () => {
  it('queues the export, builds it in the job and serves the archive', async () => {
    const started = await t.request(author, 'POST', `/api/courses/${courseId}/exports`, {
      format: 'scorm12',
    });
    expect(started.statusCode, started.body).toBe(200);
    const { id, status } = started.json<{ id: string; status: string }>();
    expect(status).toBe('pending');
    expect(lastJob()).toEqual({ exportId: id });
    expect((await t.request(author, 'GET', `/api/exports/${id}/download`)).statusCode).toBe(404);

    await handleExportJob(t.ctx, lastJob());
    const done = (await t.request(author, 'GET', `/api/exports/${id}`)).json<{
      status: string;
      fileName: string;
      size: number;
    }>();
    expect(done).toMatchObject({ status: 'done', fileName: 'Großer-Kurs-scorm12.zip' });
    const file = await t.request(author, 'GET', `/api/exports/${id}/download`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/zip');
    expect(file.rawPayload.length).toBe(done.size);
    // A ZIP starts with the local file header signature.
    expect(file.rawPayload.subarray(0, 4).toString('hex')).toBe('504b0304');
  });

  it('is visible only to the editors of the course', async () => {
    const { id } = (
      await t.request(author, 'POST', `/api/courses/${courseId}/exports`, { format: 'html5' })
    ).json<{ id: string }>();
    expect((await t.request(stranger, 'GET', `/api/exports/${id}`)).statusCode).toBe(404);
    expect((await t.request(stranger, 'GET', `/api/exports/${id}/download`)).statusCode).toBe(404);
    expect(
      (await t.request(stranger, 'POST', `/api/courses/${courseId}/exports`, { format: 'html5' })).statusCode,
    ).toBe(404);
    expect((await t.request(null, 'GET', `/api/exports/${id}`)).statusCode).toBe(401);
  });

  it('reports a failure instead of half an archive', async () => {
    const { id } = (
      await t.request(author, 'POST', `/api/courses/${courseId}/exports`, { format: 'xapi' })
    ).json<{ id: string }>();
    // A file the course uses has gone missing from storage.
    await t.ctx.blobs.remove(`assets/${sha.slice(0, 2)}/${sha}`);
    await handleExportJob(t.ctx, { exportId: id });
    const status = (await t.request(author, 'GET', `/api/exports/${id}`)).json<{
      status: string;
      error: string;
    }>();
    expect(status.status).toBe('failed');
    expect(status.error).toContain('missing');
  });

  it('removes archives after a day', async () => {
    await t.ctx.db
      .updateTable('course_exports')
      .set({ created_at: new Date(Date.now() - 25 * 3_600_000) } as never)
      .execute();
    expect(await purgeExports(t.ctx)).toBeGreaterThanOrEqual(3);
    expect(await t.ctx.blobs.list('exports')).toEqual([]);
  });
});
