// SPDX-License-Identifier: Apache-2.0
import type { LightMyRequestResponse } from 'fastify';
import { SESSION_COOKIE } from '../../apps/server/src/auth/sessions.js';
import { ORIGIN, type Actor, type TestApp } from './test-app.js';

/** Creates a course as the actor and opens it for editing (lock). */
export async function openCourse(
  t: TestApp,
  actor: Actor,
  title = 'Test course',
): Promise<{ id: string; doc: CourseDoc }> {
  const created = await t.request(actor, 'POST', '/api/courses', { title, language: 'de' });
  if (created.statusCode !== 200) throw new Error(created.body);
  const id = created.json<{ id: string }>().id;
  await t.request(actor, 'POST', `/api/courses/${id}/lock`);
  return { id, doc: await getDoc(t, actor, id) };
}

export interface CourseDoc {
  course: {
    structure: { chapters: { id: string; nodeIds: string[] }[] };
    nodes: Record<string, Record<string, unknown> & { id: string }>;
    assets: Record<string, { mime: string }>;
  };
  rev: number;
  nodeRevs: Record<string, number>;
  lock: { mine: boolean } | null;
}

export async function getDoc(t: TestApp, actor: Actor, id: string): Promise<CourseDoc> {
  const res = await t.request(actor, 'GET', `/api/courses/${id}`);
  if (res.statusCode !== 200) throw new Error(res.body);
  return res.json<CourseDoc>();
}

export function upload(
  t: TestApp,
  actor: Actor,
  courseId: string,
  name: string,
  bytes: Buffer,
): Promise<LightMyRequestResponse> {
  return uploadTo(t, actor, `/api/courses/${courseId}/assets`, name, bytes);
}

/** Multipart upload of one file to any upload endpoint. */
export async function uploadTo(
  t: TestApp,
  actor: Actor,
  url: string,
  name: string,
  bytes: Buffer,
): Promise<LightMyRequestResponse> {
  const boundary = '----coursecraft-test';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return t.app.inject({
    method: 'POST',
    url,
    headers: {
      origin: ORIGIN,
      'x-csrf-token': actor.csrf,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    cookies: { [SESSION_COOKIE]: actor.cookie },
    payload,
  });
}

/** Smallest valid PNG (1×1, transparent). */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
