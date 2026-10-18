// SPDX-License-Identifier: Apache-2.0
import { expect, type APIRequestContext, type FrameLocator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import yauzl from 'yauzl';

type Format = 'html5' | 'scorm12' | 'scorm2004-4' | 'xapi' | 'cmi5';

const para = (text: string) => ({
  de: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
});

/** Quiz with three question types; completion requires passing it (50 %). */
export const QUIZ = {
  kind: 'quiz',
  id: 'quiz1',
  title: { de: 'Abschlusstest' },
  settings: { passingPercent: 50 },
  items: [
    {
      type: 'question',
      question: {
        id: 'q1',
        type: 'singleChoice',
        prompt: para('Notrufnummer?'),
        shuffle: false,
        choices: [
          { id: 'a', text: { de: '112' }, correct: true },
          { id: 'b', text: { de: '110' }, correct: false },
        ],
      },
    },
    {
      type: 'question',
      question: { id: 'q2', type: 'trueFalse', prompt: para('Fluchtwege freihalten?'), correct: true },
    },
    {
      type: 'question',
      question: {
        id: 'q3',
        type: 'fillInBlanks',
        prompt: para('Ergänzen'),
        template: { de: 'Sammelplatz ist der {{b1}}.' },
        blanks: [{ id: 'b1', accepted: { de: ['Parkplatz'] } }],
      },
    },
  ],
};

/** Logs in through the API and creates a course (two slides, optionally a quiz). */
export async function createCourse(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
  title: string,
  withQuiz = false,
): Promise<{ id: string; headers: Record<string, string> }> {
  const headers = { origin: baseURL };
  const login = await request.post('/api/auth/login', { headers, data: { email, password } });
  const csrf = ((await login.json()) as { session: { csrfToken: string } }).session.csrfToken;
  const h = { ...headers, 'x-csrf-token': csrf };
  const created = (await (
    await request.post('/api/courses', { headers: h, data: { title, language: 'de' } })
  ).json()) as { id: string };
  await request.post(`/api/courses/${created.id}/lock`, { headers: h });
  const doc = (await (await request.get(`/api/courses/${created.id}`)).json()) as {
    rev: number;
    course: { structure: { chapters: { id: string; title: unknown; nodeIds: string[] }[] } };
  };
  const chapter = doc.course.structure.chapters[0];
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
        content: para('Inhalt der zweiten Folie'),
        style: {},
      },
    ],
  };
  const nodes = [...(chapter?.nodeIds ?? []), 's-second', ...(withQuiz ? ['quiz1'] : [])];
  const saved = await request.post(`/api/courses/${created.id}/save`, {
    headers: h,
    data: {
      rev: doc.rev,
      upsertNodes: withQuiz ? [second, QUIZ] : [second],
      structure: { chapters: [{ ...chapter, nodeIds: nodes }] },
      ...(withQuiz ? { settings: { completion: { type: 'quizPassed', quizId: 'quiz1' } } } : {}),
    },
  });
  if (!saved.ok()) throw new Error(`save failed: ${saved.status()} ${await saved.text()}`);
  return { id: created.id, headers: h };
}

/** Creates a course and downloads an export as the zip archive. */
export async function exportPackage(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
  format: Format,
  withQuiz = false,
): Promise<Buffer> {
  const { id } = await createCourse(request, baseURL, email, password, `Export ${format}`, withQuiz);
  const zip = await request.get(`/api/courses/${id}/export?format=${format}`);
  if (!zip.ok()) throw new Error(`export failed: ${zip.status()} ${await zip.text()}`);
  return zip.body();
}

/** Creates a course and downloads an export, unpacked. */
export async function exportCourse(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
  format: Format,
  withQuiz = false,
) {
  return unzip(await exportPackage(request, baseURL, email, password, format, withQuiz));
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
    else if (url.pathname.startsWith('/scorm-again/'))
      body = readFileSync(
        new URL(`../../node_modules/scorm-again/dist/${url.pathname.slice(13)}`, import.meta.url),
      );
    if (!body) return route.fulfill({ status: 404 });
    const ext = url.pathname.split('.').pop() ?? '';
    return route.fulfill({ status: 200, body, contentType: TYPES[ext] ?? 'application/octet-stream' });
  });
  return external;
}

export interface MockLrs {
  statements: Record<string, unknown>[];
  state: Map<string, string>;
  tokenFetches: number;
}

/**
 * Minimal LRS on a fake origin for cmi5/xAPI tests: one-time auth token,
 * LMS.LaunchData state, statement and state storage.
 */
export async function serveLrs(
  page: Page,
  files: Map<string, Buffer>,
  launchData: Record<string, unknown>,
): Promise<MockLrs> {
  const lrs: MockLrs = {
    statements: [],
    state: new Map([['LMS.LaunchData', JSON.stringify(launchData)]]),
    tokenFetches: 0,
  };
  await page.route('http://lrs.test/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/fetch') {
      lrs.tokenFetches += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ 'auth-token': 'dG9rZW4=' }),
      });
    }
    if (req.headers()['authorization'] !== 'Basic dG9rZW4=' && !url.pathname.startsWith('/fetch'))
      return route.fulfill({ status: 401 });
    if (url.pathname === '/xapi/statements' && req.method() === 'POST') {
      lrs.statements.push(JSON.parse(req.postData() ?? '{}') as Record<string, unknown>);
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (url.pathname === '/xapi/activities/state') {
      const id = url.searchParams.get('stateId') ?? '';
      if (req.method() === 'GET') {
        const value = lrs.state.get(id);
        return value
          ? route.fulfill({ status: 200, contentType: 'application/json', body: value })
          : route.fulfill({ status: 404 });
      }
      lrs.state.set(id, req.postData() ?? '');
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404 });
  });
  await page.route('http://pkg.test/**', async (route) => {
    const url = new URL(route.request().url());
    const body = files.get(decodeURIComponent(url.pathname.slice(1)));
    if (!body) return route.fulfill({ status: 404 });
    const ext = url.pathname.split('.').pop() ?? '';
    return route.fulfill({ status: 200, body, contentType: TYPES[ext] ?? 'application/octet-stream' });
  });
  return lrs;
}

/** Goes to the quiz, answers q1 and q2 correctly and q3 wrong (2 of 3 → 67 %, passed at 50 %). */
export async function takeQuiz(course: FrameLocator | Page) {
  await course.getByRole('button', { name: 'Weiter' }).click();
  await course.getByRole('button', { name: 'Weiter' }).click();
  await course.getByRole('button', { name: 'Quiz starten' }).click();
  await course.getByRole('radio', { name: '112' }).check();
  await course.getByRole('button', { name: 'Antworten' }).click();
  await expect(course.getByText('Richtig.')).toBeVisible();
  await course.getByRole('button', { name: 'Nächste Frage' }).click();
  await course.getByRole('radio', { name: 'Wahr' }).check();
  await course.getByRole('button', { name: 'Antworten' }).click();
  await course.getByRole('button', { name: 'Nächste Frage' }).click();
  await course.getByRole('textbox', { name: 'Lücke 1' }).fill('Bahnhof');
  await course.getByRole('button', { name: 'Antworten' }).click();
  await expect(course.getByText('Leider falsch.')).toBeVisible();
  await course.getByRole('button', { name: 'Nächste Frage' }).click();
  await expect(course.getByText('67 %')).toBeVisible();
  await expect(course.getByText('Bestanden.')).toBeVisible();
}
