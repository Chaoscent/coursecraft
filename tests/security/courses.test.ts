// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Actor, type TestApp } from '../support/test-app.js';
import { getDoc, openCourse, PNG_1X1, upload } from '../support/courses.js';

let t: TestApp;
let alice: Actor;
let bob: Actor;
beforeAll(async () => {
  t = await createTestApp();
  alice = await t.actor(['author']);
  bob = await t.actor(['author']);
});
afterAll(async () => t.close());

describe('course access (IDOR)', () => {
  it("another author cannot read, change or export someone else's course", async () => {
    const { id, doc } = await openCourse(t, alice);
    const slideId = doc.course.structure.chapters[0]?.nodeIds[0] ?? '';
    for (const [method, url, body] of [
      ['GET', `/api/courses/${id}`, undefined],
      ['GET', `/api/courses/${id}/export?format=html5`, undefined],
      ['GET', `/api/courses/${id}/versions`, undefined],
      ['POST', `/api/courses/${id}/lock`, undefined],
      ['PATCH', `/api/courses/${id}`, { rev: doc.rev, title: 'hijacked' }],
      ['PUT', `/api/courses/${id}/nodes/${slideId}`, { rev: 1, doc: doc.course.nodes[slideId] }],
      ['DELETE', `/api/courses/${id}`, undefined],
    ] as const) {
      const res = await t.request(bob, method, url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const list = await t.request(bob, 'GET', '/api/courses');
    expect(list.json().items.map((c: { id: string }) => c.id)).not.toContain(id);
  });

  it('co-authors get access only when the owner adds them', async () => {
    const { id } = await openCourse(t, alice);
    expect((await t.request(bob, 'GET', `/api/courses/${id}`)).statusCode).toBe(404);
    expect(
      (await t.request(alice, 'PUT', `/api/courses/${id}/members`, { userIds: [bob.userId] })).statusCode,
    ).toBe(200);
    expect((await t.request(bob, 'GET', `/api/courses/${id}`)).statusCode).toBe(200);
    expect((await t.request(bob, 'PUT', `/api/courses/${id}/members`, { userIds: [] })).statusCode).toBe(403);
  });

  it('learners cannot author', async () => {
    const learner = await t.actor(['learner']);
    expect(
      (await t.request(learner, 'POST', '/api/courses', { title: 'x', language: 'de' })).statusCode,
    ).toBe(403);
  });

  it('assets of one course cannot be fetched through another course', async () => {
    const a = await openCourse(t, alice);
    const b = await openCourse(t, alice);
    const res = await upload(t, alice, a.id, 'dot.png', PNG_1X1);
    const sha = res.json().sha256;
    expect((await t.request(alice, 'GET', `/api/courses/${a.id}/assets/${sha}`)).statusCode).toBe(200);
    expect((await t.request(alice, 'GET', `/api/courses/${b.id}/assets/${sha}`)).statusCode).toBe(404);
  });
});

describe('editing rules', () => {
  it('changes require the edit lock', async () => {
    const created = await t.request(alice, 'POST', '/api/courses', { title: 'No lock', language: 'de' });
    const id = created.json().id;
    const doc = await getDoc(t, alice, id);
    expect(
      (await t.request(alice, 'PATCH', `/api/courses/${id}`, { rev: doc.rev, title: 'x' })).statusCode,
    ).toBe(409);
  });

  it('a second session cannot take a fresh lock; the owner can break it', async () => {
    const { id } = await openCourse(t, alice);
    const second = await t.login(alice.email);
    const res = await t.request(second, 'POST', `/api/courses/${id}/lock`);
    expect(res.json()).toMatchObject({ acquired: false, lock: { mine: false } });
    expect((await t.request(second, 'POST', `/api/courses/${id}/lock/break`)).statusCode).toBe(200);
    expect((await t.request(second, 'POST', `/api/courses/${id}/lock`)).json().acquired).toBe(true);
  });

  it('rejects stale revisions (optimistic concurrency)', async () => {
    const { id, doc } = await openCourse(t, alice);
    const slideId = doc.course.structure.chapters[0]?.nodeIds[0] ?? '';
    const node = doc.course.nodes[slideId];
    expect(
      (await t.request(alice, 'PUT', `/api/courses/${id}/nodes/${slideId}`, { rev: 1, doc: node }))
        .statusCode,
    ).toBe(200);
    expect(
      (await t.request(alice, 'PUT', `/api/courses/${id}/nodes/${slideId}`, { rev: 1, doc: node }))
        .statusCode,
    ).toBe(409);
    expect(
      (await t.request(alice, 'PATCH', `/api/courses/${id}`, { rev: doc.rev, title: 'a' })).statusCode,
    ).toBe(200);
    expect(
      (await t.request(alice, 'PATCH', `/api/courses/${id}`, { rev: doc.rev, title: 'b' })).statusCode,
    ).toBe(409);
  });

  it('rejects scripts and javascript: links in content', async () => {
    const { id, doc } = await openCourse(t, alice);
    const slideId = doc.course.structure.chapters[0]?.nodeIds[0] ?? '';
    const node = structuredClone(doc.course.nodes[slideId]) as unknown as {
      elements: { content?: unknown }[];
    };
    const evil = {
      de: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
            ],
          },
        ],
      },
    };
    const element = node.elements[0];
    if (element) element.content = evil;
    expect(
      (await t.request(alice, 'PUT', `/api/courses/${id}/nodes/${slideId}`, { rev: 1, doc: node }))
        .statusCode,
    ).toBe(400);
    if (element)
      element.content = {
        de: { type: 'doc', content: [{ type: 'html', value: '<script>alert(1)</script>' }] },
      };
    expect(
      (await t.request(alice, 'PUT', `/api/courses/${id}/nodes/${slideId}`, { rev: 1, doc: node }))
        .statusCode,
    ).toBe(400);
  });

  it('rejects references to files that are not part of the course', async () => {
    const { id, doc } = await openCourse(t, alice);
    const slideId = doc.course.structure.chapters[0]?.nodeIds[0] ?? '';
    const node = structuredClone(doc.course.nodes[slideId]) as unknown as { elements: unknown[] };
    node.elements.push({
      id: 'img1',
      name: 'x',
      type: 'image',
      frame: { x: 0, y: 0, width: 10, height: 10 },
      image: { $asset: 'a'.repeat(64) },
    });
    expect(
      (await t.request(alice, 'PUT', `/api/courses/${id}/nodes/${slideId}`, { rev: 1, doc: node }))
        .statusCode,
    ).toBe(400);
  });

  it('keeps structure and nodes consistent', async () => {
    const { id, doc } = await openCourse(t, alice);
    const structure = structuredClone(doc.course.structure);
    structure.chapters[0]?.nodeIds.push('ghost');
    expect(
      (await t.request(alice, 'PATCH', `/api/courses/${id}`, { rev: doc.rev, structure })).statusCode,
    ).toBe(400);
    const slideId = doc.course.structure.chapters[0]?.nodeIds[0] ?? '';
    expect(
      (await t.request(alice, 'DELETE', `/api/courses/${id}/nodes/${slideId}?rev=${doc.rev}`)).statusCode,
    ).toBe(409);
  });
});

describe('uploads', () => {
  it('accepts images by content and strips metadata by re-encoding', async () => {
    const { id } = await openCourse(t, alice);
    const res = await upload(t, alice, id, 'photo.exe', PNG_1X1);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mime: 'image/png', name: 'photo.exe' });
  });

  it('rejects unknown and disguised file types', async () => {
    const { id } = await openCourse(t, alice);
    expect(
      (await upload(t, alice, id, 'evil.png', Buffer.from('MZ\x90\x00 this is an executable'))).statusCode,
    ).toBe(415);
    expect(
      (await upload(t, alice, id, 'page.html', Buffer.from('<html><script>alert(1)</script></html>')))
        .statusCode,
    ).toBe(415);
    expect(
      (
        await upload(
          t,
          alice,
          id,
          'polyglot.png',
          Buffer.concat([PNG_1X1.subarray(0, 20), Buffer.from('<script>')]),
        )
      ).statusCode,
    ).toBe(415);
  });

  it('sanitizes SVG and serves it sandboxed', async () => {
    const { id } = await openCourse(t, alice);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><foreignObject><div>x</div></foreignObject><a href="javascript:alert(3)"><rect width="10" height="10"/></a><circle r="5"/></svg>';
    const res = await upload(t, alice, id, 'icon.svg', Buffer.from(svg));
    expect(res.statusCode).toBe(200);
    const file = await t.request(alice, 'GET', `/api/courses/${id}/assets/${res.json().sha256}`);
    expect(file.headers['content-security-policy']).toContain('sandbox');
    expect(file.body).not.toMatch(/script|onload|foreignObject|javascript/i);
    expect(file.body).toContain('<circle');
  });

  it('serves byte ranges for media seeking', async () => {
    const { id } = await openCourse(t, alice);
    const res = await upload(t, alice, id, 'dot.png', PNG_1X1);
    const part = await t.request(alice, 'GET', `/api/courses/${id}/assets/${res.json().sha256}`, undefined, {
      range: 'bytes=0-3',
    });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload).toHaveLength(4);
  });

  it('rejects multipart bodies on routes that do not take files', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/courses',
      headers: {
        origin: 'https://lernwerk.test',
        'x-csrf-token': alice.csrf,
        'content-type': 'multipart/form-data; boundary=x',
      },
      cookies: { __Host_lw: '' },
      payload: '--x--',
    });
    expect([401, 403, 415]).toContain(res.statusCode);
  });
});

describe('batch save', () => {
  it('applies node, structure and title changes atomically', async () => {
    const { id, doc } = await openCourse(t, alice);
    const chapter = doc.course.structure.chapters[0];
    const first = chapter?.nodeIds[0] ?? '';
    const added = { kind: 'slide', id: 's-new', title: { de: 'Neu' }, elements: [] };
    const structure = { chapters: [{ ...chapter, nodeIds: ['s-new', first] }] };
    const res = await t.request(alice, 'POST', `/api/courses/${id}/save`, {
      rev: doc.rev,
      title: 'Umbenannt',
      structure,
      upsertNodes: [added],
    });
    expect(res.statusCode).toBe(200);
    const after = await getDoc(t, alice, id);
    expect(after.course.structure.chapters[0]?.nodeIds).toEqual(['s-new', first]);
    expect(after.rev).toBe(doc.rev + 1);
  });

  it('rolls back everything when the result would be inconsistent', async () => {
    const { id, doc } = await openCourse(t, alice);
    const added = { kind: 'slide', id: 's-orphan', title: { de: 'Waise' }, elements: [] };
    const res = await t.request(alice, 'POST', `/api/courses/${id}/save`, {
      rev: doc.rev,
      title: 'Nicht gespeichert',
      upsertNodes: [added],
    });
    expect(res.statusCode).toBe(400);
    const after = await getDoc(t, alice, id);
    expect(after.rev).toBe(doc.rev);
    expect(Object.keys(after.course.nodes)).not.toContain('s-orphan');
  });

  it('rejects a save based on an old revision', async () => {
    const { id, doc } = await openCourse(t, alice);
    expect(
      (await t.request(alice, 'POST', `/api/courses/${id}/save`, { rev: doc.rev, title: 'eins' })).statusCode,
    ).toBe(200);
    expect(
      (await t.request(alice, 'POST', `/api/courses/${id}/save`, { rev: doc.rev, title: 'zwei' })).statusCode,
    ).toBe(409);
  });
});
