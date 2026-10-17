// SPDX-License-Identifier: Apache-2.0
import type { APIRequestContext, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import yauzl from 'yauzl';

/** Logs in through the API, creates a course with two slides and downloads an export. */
export async function exportCourse(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
  format: 'html5' | 'scorm12',
) {
  const headers = { origin: baseURL };
  const login = await request.post('/api/auth/login', { headers, data: { email, password } });
  const csrf = ((await login.json()) as { session: { csrfToken: string } }).session.csrfToken;
  const h = { ...headers, 'x-csrf-token': csrf };
  const created = (await (
    await request.post('/api/courses', { headers: h, data: { title: `Export ${format}`, language: 'de' } })
  ).json()) as { id: string };
  await request.post(`/api/courses/${created.id}/lock`, { headers: h });
  const doc = (await (await request.get(`/api/courses/${created.id}`)).json()) as {
    rev: number;
    course: { structure: { chapters: { id: string }[] } };
  };
  const chapterId = doc.course.structure.chapters[0]?.id ?? '';
  const second = {
    kind: 'slide',
    id: 's-second',
    title: { de: 'Zweite Folie' },
    elements: [
      {
        id: 't2',
        name: 'Text',
        type: 'text',
        frame: { x: 80, y: 80, width: 900, height: 120 },
        content: {
          de: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inhalt der zweiten Folie' }] }],
          },
        },
        style: {},
      },
    ],
  };
  await request.post(`/api/courses/${created.id}/nodes`, {
    headers: h,
    data: { rev: doc.rev, chapterId, index: 1, node: second },
  });
  const zip = await request.get(`/api/courses/${created.id}/export?format=${format}`);
  return unzip(await zip.body());
}

export function unzip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const files = new Map<string, Buffer>();
      zip.on('entry', (entry: yauzl.Entry) =>
        zip.openReadStream(entry, (err, stream) => {
          if (err) return reject(err);
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        }),
      );
      zip.on('end', () => resolve(files));
      zip.readEntry();
    });
  });
}

const TYPES: Record<string, string> = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  woff2: 'font/woff2',
  png: 'image/png',
  xml: 'application/xml',
};

/** Serves the harness, scorm-again and the package on a fake origin, fully offline. */
export async function serveLms(page: Page, files: Map<string, Buffer>): Promise<string[]> {
  const external: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://lms.test') {
      external.push(url.href);
      return route.abort();
    }
    let body: Buffer | undefined;
    if (url.pathname.startsWith('/pkg/')) body = files.get(decodeURIComponent(url.pathname.slice(5)));
    else if (url.pathname.startsWith('/harness/'))
      body = readFileSync(new URL(`./harness/${url.pathname.slice(9)}`, import.meta.url));
    else if (url.pathname === '/scorm-again/scorm12.min.js')
      body = readFileSync(new URL('../../node_modules/scorm-again/dist/scorm12.min.js', import.meta.url));
    if (!body) return route.fulfill({ status: 404 });
    const ext = url.pathname.split('.').pop() ?? '';
    return route.fulfill({ status: 200, body, contentType: TYPES[ext] ?? 'application/octet-stream' });
  });
  return external;
}
