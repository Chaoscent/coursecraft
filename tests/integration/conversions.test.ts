// SPDX-License-Identifier: Apache-2.0
import { QUEUES } from '@lernwerk/shared';
import { existsSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RecordingQueue } from '../../apps/server/src/jobs/queue.js';
import { expireStale, handleConvertDone } from '../../apps/server/src/modules/conversions/service.js';
import { getDoc, openCourse, uploadTo } from '../support/courses.js';
import { solidPng } from '../support/png.js';
import { sineWav } from '../support/wav.js';
import { body, buildPptx, para, picture, table, title } from '../support/pptx.js';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';

let t: TestApp;
let author: Actor;
let other: Actor;
let work: string;
beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'lw-work-'));
  t = await createTestApp({ LERNWERK_WORK_DIR: work });
  author = await t.actor(['author']);
  other = await t.actor(['author']);
});
afterAll(async () => t.close());

const sent = () => (t.ctx.jobs as RecordingQueue).sent;

async function sample(): Promise<Buffer> {
  return buildPptx({
    title: 'Erste Hilfe',
    slides: [
      {
        shapes: [title(2, 'Start'), picture(3, 'rId5', { x: 10, y: 10, w: 100, h: 50 }, 'Logo')],
        images: { rId5: { name: 'image1.png', bytes: solidPng(20, 10, [255, 0, 0]) } },
        notes: 'Notiz',
      },
      { shapes: [title(2, 'Tabelle'), table(3, { x: 0, y: 0, w: 100, h: 100 })] },
      { shapes: [title(2, 'Ende'), body(3, [para(['Danke'])])] },
    ],
  });
}

async function startImport(actor = author): Promise<string> {
  const res = await uploadTo(t, actor, '/api/courses/import', 'kurs.pptx', await sample());
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ conversionId: string }>().conversionId;
}

const status = async (id: string, actor = author) => t.request(actor, 'GET', `/api/conversions/${id}`);

/** M4A header (ftyp brand M4A) — enough for content detection. */
const M4A = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypM4A ', 'latin1'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('M4A mp42', 'latin1'),
  Buffer.alloc(64),
]);

const wav = () => sineWav(0.1);

describe('PPTX import', () => {
  it('parses at once, queues rendering and creates the course with rendered slides', async () => {
    const id = await startImport();
    const job = sent().find(
      (j) => j.queue === QUEUES.pptxRender && (j.data as { jobId: string }).jobId === id,
    );
    expect(job?.data).toEqual({ jobId: id, widthPx: 1920 });
    expect(job?.options.expireInSeconds).toBe(20 * 60);
    expect(statSync(join(work, id, 'out')).mode & 0o777).toBe(0o770);
    expect(existsSync(join(work, id, 'in', 'source.pptx'))).toBe(true);
    expect((await status(id)).json()).toMatchObject({ status: 'pending', courseId: null });

    // What the converter would write: two valid pages, one broken file, one symlink.
    const out = join(work, id, 'out');
    writeFileSync(join(out, 'page-0001.png'), solidPng(64, 36, [0, 0, 255]));
    writeFileSync(join(out, 'page-0002.png'), solidPng(64, 36, [0, 255, 0]));
    writeFileSync(join(out, 'page-0003.png'), Buffer.from('not an image'));
    symlinkSync('/etc/hostname', join(out, 'page-0004.png'));
    await handleConvertDone(t.ctx, { jobId: id, queue: QUEUES.pptxRender, ok: true, outputs: [] });

    expect(existsSync(join(work, id))).toBe(false);
    const done = (await status(id)).json<{ status: string; courseId: string; warnings: unknown[] }>();
    expect(done.status).toBe('done');
    expect(done.warnings).toContainEqual({ code: 'unsupported_content', slide: 2 });

    const doc = await getDoc(t, author, done.courseId);
    const nodes = doc.course.structure.chapters.flatMap((c) => c.nodeIds).map((n) => doc.course.nodes[n]);
    expect(nodes.map((n) => (n?.['title'] as Record<string, string>)['de'])).toEqual([
      'Start',
      'Tabelle',
      'Ende',
    ]);
    expect(nodes[0]?.['fallbackImage']).toBeDefined();
    expect(nodes[0]?.['useFallbackImage']).toBe(false);
    // Slide 2 lost its table: the rendered image is used by default.
    expect(nodes[1]?.['useFallbackImage']).toBe(true);
    expect(nodes[2]?.['fallbackImage']).toBeUndefined();
    expect(JSON.stringify(nodes[0]?.['notes'])).toContain('Notiz');
    // Picture and renderings are attached to the course and can be served.
    const image = (nodes[0]?.['elements'] as { type: string; image?: { $asset: string } }[]).find(
      (e) => e.type === 'image',
    );
    const served = await t.request(
      author,
      'GET',
      `/api/courses/${done.courseId}/assets/${image?.image?.$asset}`,
    );
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(Object.keys(doc.course.assets)).toHaveLength(3);

    // A late or repeated message changes nothing.
    await handleConvertDone(t.ctx, { jobId: id, queue: QUEUES.pptxRender, ok: true, outputs: [] });
    const audit = await t.ctx.db
      .selectFrom('audit_log')
      .select('action')
      .where('target_id', '=', done.courseId)
      .execute();
    expect(audit.map((a) => a.action)).toEqual(['course.imported']);
  });

  it('creates the course without images when rendering fails or is skipped', async () => {
    const failed = await startImport();
    await handleConvertDone(t.ctx, {
      jobId: failed,
      queue: QUEUES.pptxRender,
      ok: false,
      error: 'timeout',
      outputs: [],
    });
    const result = (await status(failed)).json<{ status: string; warnings: { code: string }[] }>();
    expect(result.status).toBe('done');
    expect(result.warnings).toContainEqual({ code: 'render_failed' });

    const skipped = await startImport();
    expect((await t.request(other, 'POST', `/api/conversions/${skipped}/skip`)).statusCode).toBe(404);
    expect((await t.request(author, 'POST', `/api/conversions/${skipped}/skip`)).statusCode).toBe(200);
    const s = (await status(skipped)).json<{
      status: string;
      courseId: string;
      warnings: { code: string }[];
    }>();
    expect(s.status).toBe('done');
    expect(s.warnings).toContainEqual({ code: 'render_skipped' });
    const doc = await getDoc(t, author, s.courseId);
    expect(Object.values(doc.course.nodes).every((n) => n['fallbackImage'] === undefined)).toBe(true);
  });

  it('works without a work volume: no rendering, course created at once', async () => {
    writeFileSync(join(work, 'not-a-directory'), '');
    const t2 = await createTestApp({ LERNWERK_WORK_DIR: join(work, 'not-a-directory') });
    try {
      const actor = await t2.actor(['author']);
      const res = await uploadTo(t2, actor, '/api/courses/import', 'kurs.pptx', await sample());
      const id = res.json<{ conversionId: string }>().conversionId;
      const s = (await t2.request(actor, 'GET', `/api/conversions/${id}`)).json<{
        status: string;
        warnings: { code: string }[];
      }>();
      expect(s.status).toBe('done');
      expect(s.warnings).toContainEqual({ code: 'render_skipped' });
    } finally {
      await t2.close();
    }
  });

  it('refuses macro-enabled and damaged files', async () => {
    const macro = await buildPptx({ slides: [{ shapes: [] }], macroEnabled: true });
    expect((await uploadTo(t, author, '/api/courses/import', 'm.pptm', macro)).statusCode).toBe(415);
    expect(
      (await uploadTo(t, author, '/api/courses/import', 'x.pptx', Buffer.from('PK\u0003\u0004 broken')))
        .statusCode,
    ).toBe(422);
  });

  it('keeps conversions private to the user who started them', async () => {
    const id = await startImport();
    expect((await status(id, other)).statusCode).toBe(404);
    const learner = await t.actor(['learner']);
    expect((await status(id, learner)).statusCode).toBe(403);
    expect((await uploadTo(t, learner, '/api/courses/import', 'k.pptx', await sample())).statusCode).toBe(
      403,
    );
  });
});

describe('media conversion', () => {
  it('queues a recording and attaches the converted audio to the course', async () => {
    const { id: courseId } = await openCourse(t, author);
    const res = await uploadTo(
      t,
      author,
      `/api/courses/${courseId}/media?target=audio`,
      'aufnahme.wav',
      wav(),
    );
    expect(res.statusCode, res.body).toBe(200);
    const id = res.json<{ conversionId: string }>().conversionId;
    const job = sent().find((j) => j.queue === QUEUES.media && (j.data as { jobId: string }).jobId === id);
    expect(job?.data).toEqual({ jobId: id, target: 'audio', normalize: true });
    expect(existsSync(join(work, id, 'in', 'source.wav'))).toBe(true);

    writeFileSync(join(work, id, 'out', 'audio.m4a'), M4A);
    await handleConvertDone(t.ctx, {
      jobId: id,
      queue: QUEUES.media,
      ok: true,
      outputs: ['audio.m4a'],
      durationMs: 1234,
    });
    const s = (await status(id)).json<{
      status: string;
      asset: { sha256: string; mime: string; name: string; durationMs: number };
    }>();
    expect(s).toMatchObject({
      status: 'done',
      asset: { mime: 'audio/mp4', name: 'aufnahme.m4a', durationMs: 1234 },
    });
    const served = await t.request(author, 'GET', `/api/courses/${courseId}/assets/${s.asset.sha256}`);
    expect(served.statusCode).toBe(200);
  });

  it('marks failed and unanswered conversions, refuses unknown formats and foreign courses', async () => {
    const { id: courseId } = await openCourse(t, author);
    const res = await uploadTo(t, author, `/api/courses/${courseId}/media`, 'a.wav', wav());
    const id = res.json<{ conversionId: string }>().conversionId;
    await handleConvertDone(t.ctx, {
      jobId: id,
      queue: QUEUES.media,
      ok: false,
      error: 'unsupported',
      outputs: [],
    });
    expect((await status(id)).json()).toMatchObject({ status: 'failed', error: 'unsupported' });

    const stale = (await uploadTo(t, author, `/api/courses/${courseId}/media`, 'b.wav', wav())).json<{
      conversionId: string;
    }>().conversionId;
    await t.ctx.db
      .updateTable('conversions')
      .set({ created_at: new Date(Date.now() - 3_600_000) })
      .where('id', '=', stale)
      .execute();
    expect(await expireStale(t.ctx)).toBeGreaterThanOrEqual(1);
    expect((await status(stale)).json()).toMatchObject({ status: 'failed', error: 'timeout' });

    expect(
      (await uploadTo(t, author, `/api/courses/${courseId}/media`, 'x.txt', Buffer.from('hello'))).statusCode,
    ).toBe(415);
    expect((await uploadTo(t, other, `/api/courses/${courseId}/media`, 'a.wav', wav())).statusCode).toBe(404);
  });
});
