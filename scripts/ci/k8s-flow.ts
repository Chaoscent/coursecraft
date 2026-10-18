// SPDX-License-Identifier: Apache-2.0
// Check of a running installation (used with the Helm chart): setup, login,
// a PPTX import through the converter, then the slide images. With HOST set,
// the request names that address (a tenant) and claims https through
// X-Forwarded-Proto, as the ingress controller would.
import { request } from 'node:http';
import { body, buildPptx, title } from '../../tests/support/pptx.js';

const target = new URL(process.env['BASE'] ?? 'http://127.0.0.1:8080');
const host = process.env['HOST'] ?? target.host;
const origin = process.env['HOST'] ? `https://${host}` : target.origin;
const token = process.env['SETUP_TOKEN'] ?? '';
let cookie = '';
let csrf = '';

function call(method: string, path: string, payload?: Buffer, type?: string) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request(
      {
        host: target.hostname,
        port: target.port,
        method,
        path,
        headers: {
          host,
          origin,
          ...(process.env['HOST'] ? { 'x-forwarded-proto': 'https' } : {}),
          ...(cookie ? { cookie } : {}),
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          ...(payload
            ? { 'content-type': type ?? 'application/json', 'content-length': payload.length }
            : {}),
        },
      },
      (res) => {
        const set = (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('__Host-cc_session='));
        if (set) cookie = set.split(';')[0] ?? '';
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

const json = (value: unknown) => Buffer.from(JSON.stringify(value));

const setup = await call(
  'POST',
  '/api/setup',
  json({
    token,
    email: 'admin@example.org',
    displayName: 'Admin',
    password: 'a long k8s test password',
    locale: 'en',
  }),
);
if (setup.status !== 200) throw new Error(`setup failed: ${setup.status} ${setup.text}`);
csrf = (JSON.parse(setup.text) as { session: { csrfToken: string } }).session.csrfToken;

const pptx = await buildPptx({
  title: 'Cluster check',
  slides: [{ shapes: [title(2, 'Hello cluster'), body(3, [])] }, { shapes: [title(2, 'Second')] }],
});
const boundary = '----cluster-check';
const form = Buffer.concat([
  Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cluster.pptx"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  ),
  pptx,
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);
const started = await call('POST', '/api/courses/import', form, `multipart/form-data; boundary=${boundary}`);
if (started.status !== 200) throw new Error(`import failed: ${started.status} ${started.text}`);
const { conversionId } = JSON.parse(started.text) as { conversionId: string };
for (let i = 0; i < 90; i += 1) {
  const status = JSON.parse((await call('GET', `/api/conversions/${conversionId}`)).text) as {
    status: string;
    warnings: { code: string }[];
  };
  if (status.status !== 'pending') {
    if (status.status !== 'done' || status.warnings.some((w) => w.code === 'render_failed'))
      throw new Error(`conversion did not finish with rendered slides: ${JSON.stringify(status)}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
const courses = await call('GET', '/api/courses');
console.log(`courses visible: ${(JSON.parse(courses.text) as { items: unknown[] }).items.length}`);
console.log('K8S FLOW OK');
