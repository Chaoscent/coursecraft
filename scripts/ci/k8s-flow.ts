// SPDX-License-Identifier: Apache-2.0
// Manual check of a running installation (used with the Helm chart): setup, login,
// a PPTX import through the converter, then the slide images.
import { body, buildPptx, title } from '../../tests/support/pptx.js';

const base = process.env['BASE'] ?? 'http://127.0.0.1:8080';
const token = process.env['SETUP_TOKEN'] ?? '';
let cookie = '';
let csrf = '';

async function call(method: string, path: string, data?: unknown, form?: FormData) {
  const res = await fetch(base + path, {
    method,
    headers: {
      origin: base,
      cookie,
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(data ? { 'content-type': 'application/json' } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
    ...(form ? { body: form } : {}),
  });
  const set = res.headers.getSetCookie().find((c) => c.startsWith('__Host-cc_session='));
  if (set) cookie = set.split(';')[0] ?? '';
  return res;
}

const setup = await call('POST', '/api/setup', {
  token,
  email: 'admin@example.org',
  displayName: 'Admin',
  password: 'a long k8s test password',
  locale: 'en',
});
if (!setup.ok) throw new Error(`setup failed: ${setup.status} ${await setup.text()}`);
csrf = ((await setup.json()) as { session: { csrfToken: string } }).session.csrfToken;

const pptx = await buildPptx({
  title: 'Cluster check',
  slides: [{ shapes: [title(2, 'Hello cluster'), body(3, [])] }, { shapes: [title(2, 'Second')] }],
});
const form = new FormData();
form.append('file', new Blob([new Uint8Array(pptx)]), 'cluster.pptx');
const started = await call('POST', '/api/courses/import', undefined, form);
if (!started.ok) throw new Error(`import failed: ${started.status} ${await started.text()}`);
const { conversionId } = (await started.json()) as { conversionId: string };
for (let i = 0; i < 90; i += 1) {
  const status = (await (await call('GET', `/api/conversions/${conversionId}`)).json()) as {
    status: string;
    courseId: string | null;
    warnings: { code: string }[];
  };
  if (status.status !== 'pending') {
    console.log(JSON.stringify(status));
    if (status.status !== 'done' || status.warnings.some((w) => w.code === 'render_failed'))
      throw new Error('conversion did not finish with rendered slides');
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.log('K8S FLOW OK');
