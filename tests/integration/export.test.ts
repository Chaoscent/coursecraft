// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import yauzl from 'yauzl';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';
import { getDoc, openCourse, PNG_1X1, upload } from '../support/courses.js';

let t: TestApp;
let author: Actor;
beforeAll(async () => {
  t = await createTestApp();
  author = await t.actor(['author']);
});
afterAll(async () => t.close());

function unzip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const files = new Map<string, Buffer>();
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (err, stream) => {
          if (err) return reject(err);
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(files));
      zip.readEntry();
    });
  });
}

describe('export', () => {
  it('builds a self-contained SCORM 1.2 package', async () => {
    const { id, doc } = await openCourse(t, author, 'Brandschutz & <Sicherheit>');
    const sha = (await upload(t, author, id, 'dot.png', PNG_1X1)).json().sha256;
    const slideId = doc.course.structure.chapters[0]?.nodeIds[0] ?? '';
    const node = structuredClone(doc.course.nodes[slideId]) as unknown as { elements: unknown[] };
    node.elements.push({
      id: 'img1',
      name: 'Bild',
      type: 'image',
      frame: { x: 100, y: 200, width: 200, height: 200 },
      image: { $asset: sha },
      altText: { de: 'Ein Punkt' },
    });
    expect(
      (await t.request(author, 'PUT', `/api/courses/${id}/nodes/${slideId}`, { rev: 1, doc: node }))
        .statusCode,
    ).toBe(200);
    await getDoc(t, author, id);

    const res = await t.request(author, 'GET', `/api/courses/${id}/export?format=scorm12`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const files = await unzip(res.rawPayload);
    for (const path of [
      'index.html',
      'imsmanifest.xml',
      'data/course.js',
      'player/player.js',
      'player/player.css',
      `assets/${sha}.png`,
    ]) {
      expect(files.has(path), path).toBe(true);
    }
    const manifest = files.get('imsmanifest.xml')?.toString() ?? '';
    expect(manifest).toContain('<schemaversion>1.2</schemaversion>');
    expect(manifest).toContain('Brandschutz &amp; &lt;Sicherheit&gt;');
    expect(manifest).toContain(`<file href="assets/${sha}.png"/>`);
    const html = files.get('index.html')?.toString() ?? '';
    expect(html).toContain("default-src 'self'");
    expect(html).not.toMatch(/<script>[^<]/);
    for (const [path, bytes] of files) {
      if (!/\.(html|js|css|xml)$/.test(path)) continue;
      const text = bytes.toString();
      const external = [...text.matchAll(/(?:src|href)=["']?(https?:)?\/\//g)];
      expect(external, path).toEqual([]);
    }
    expect(files.get('data/course.js')?.toString()).toContain('"tracking":"scorm12"');
  });

  it('HTML5 export has no SCORM manifest and no tracking', async () => {
    const { id } = await openCourse(t, author);
    const files = await unzip(
      (await t.request(author, 'GET', `/api/courses/${id}/export?format=html5`)).rawPayload,
    );
    expect(files.has('imsmanifest.xml')).toBe(false);
    expect(files.get('data/course.js')?.toString()).toContain('"tracking":"none"');
  });
});

describe('export formats with quizzes', () => {
  async function courseWithQuiz() {
    const { id, doc } = await openCourse(t, author, 'Quizkurs');
    const chapter = doc.course.structure.chapters[0];
    const first = chapter?.nodeIds[0] ?? '';
    const quiz = {
      kind: 'quiz',
      id: 'quiz1',
      title: { de: 'Test' },
      settings: { passingPercent: 60 },
      items: [
        {
          type: 'question',
          question: {
            id: 'q1',
            type: 'trueFalse',
            prompt: { de: { type: 'doc', content: [] } },
            correct: true,
          },
        },
      ],
    };
    const structure = { chapters: [{ ...chapter, nodeIds: [first, 'quiz1'] }] };
    const save = await t.request(author, 'POST', `/api/courses/${id}/save`, {
      rev: doc.rev,
      structure,
      upsertNodes: [quiz],
      settings: { completion: { type: 'quizPassed', quizId: 'quiz1' } },
    });
    expect(save.statusCode).toBe(200);
    return id;
  }

  it('SCORM 2004 4th edition manifest with mastery objective', async () => {
    const id = await courseWithQuiz();
    const files = await unzip(
      (await t.request(author, 'GET', `/api/courses/${id}/export?format=scorm2004-4`)).rawPayload,
    );
    const manifest = files.get('imsmanifest.xml')?.toString() ?? '';
    expect(manifest).toContain('<schemaversion>2004 4th Edition</schemaversion>');
    expect(manifest).toContain('adlcp:scormType="sco"');
    expect(manifest).toContain('<imsss:minNormalizedMeasure>0.60</imsss:minNormalizedMeasure>');
    expect(files.get('data/course.js')?.toString()).toContain('"tracking":"scorm2004"');
  });

  it('SCORM 2004 3rd edition is labelled accordingly', async () => {
    const id = await courseWithQuiz();
    const files = await unzip(
      (await t.request(author, 'GET', `/api/courses/${id}/export?format=scorm2004-3`)).rawPayload,
    );
    expect(files.get('imsmanifest.xml')?.toString()).toContain('2004 3rd Edition');
  });

  it('cmi5 course structure uses moveOn Passed and the mastery score', async () => {
    const id = await courseWithQuiz();
    const files = await unzip(
      (await t.request(author, 'GET', `/api/courses/${id}/export?format=cmi5`)).rawPayload,
    );
    const structure = files.get('cmi5.xml')?.toString() ?? '';
    expect(structure).toContain(`<course id="urn:lernwerk:course:${id}">`);
    expect(structure).toContain('moveOn="Passed"');
    expect(structure).toContain('masteryScore="0.60"');
    expect(structure).toContain('<url>index.html</url>');
    expect(files.get('index.html')?.toString()).toContain('connect-src https: http:');
  });

  it('xAPI package has tincan.xml; SCORM packages keep connect-src none', async () => {
    const id = await courseWithQuiz();
    const xapi = await unzip(
      (await t.request(author, 'GET', `/api/courses/${id}/export?format=xapi`)).rawPayload,
    );
    expect(xapi.get('tincan.xml')?.toString()).toContain('<launch lang="und">index.html</launch>');
    const scorm = await unzip(
      (await t.request(author, 'GET', `/api/courses/${id}/export?format=scorm12`)).rawPayload,
    );
    expect(scorm.get('index.html')?.toString()).toContain("connect-src 'none'");
  });
});
