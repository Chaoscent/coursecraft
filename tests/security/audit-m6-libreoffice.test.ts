// SPDX-License-Identifier: Apache-2.0
// Security audit (SECURITY_AUDIT.md, F-19 / M-6): what LibreOffice does with
// pictures that a presentation links (TargetMode="External") instead of
// embedding, while rendering it to PDF exactly as the converter does.
// Runs the real converter image (coursecraft/converter:local, built by
// scripts/ci/build-images.sh) in a throwaway Docker network next to a
// listener that records every connection. Skipped when the image is missing.
// Never point this at a real installation.
//
// Findings (LibreOffice 25.2.3):
// - a picture linked to http://… is not fetched, with or without M-6;
// - a picture linked to file://… is read and embedded in the rendered slide
//   with today's (empty) profile, and blocked by M-6
//   (BlockUntrustedRefererLinks alone is enough).
//
// M-6 applied: the converter seeds HARDENED_PROFILE (libreoffice-profile.ts)
// before soffice starts, so a picture linked to a local file is no longer
// embedded. The test imports that exact profile.
import { execFileSync } from 'node:child_process';
import {
  GenericContainer,
  Network,
  type HealthCheck,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HARDENED_PROFILE } from '../../apps/converter/src/jobs/libreoffice-profile.js';
import { ZipArchive } from '../../apps/server/src/lib/zip.js';
import { zipFiles } from '../support/packages.js';
import { solidPng } from '../support/png.js';
import { buildPptx, picture } from '../support/pptx.js';

const IMAGE = 'coursecraft/converter:local';
const imagePresent = (() => {
  try {
    execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** The arguments of apps/converter/src/jobs/pptx-render.ts (presentationToPdf), unchanged. */
const PDF_FILTER =
  'pdf:impress_pdf_Export:' +
  JSON.stringify({
    ExportHiddenSlides: { type: 'boolean', value: 'true' },
    ExportNotesPages: { type: 'boolean', value: 'false' },
    UseLosslessCompression: { type: 'boolean', value: 'true' },
  });

/** The profile the converter seeds in production (apps/converter/src/jobs/libreoffice-profile.ts). */
const PRODUCTION_PROFILE: string | undefined = HARDENED_PROFILE;

const LISTENER = `
const fs = require('fs');
const png = Buffer.from(process.env.PNG, 'base64');
require('net').createServer((s) => {
  fs.appendFileSync('/tmp/hits.log', 'connect\\n');
  s.once('data', (d) => {
    fs.appendFileSync('/tmp/hits.log', d.toString('latin1').split('\\r\\n')[0] + '\\n');
    s.write('HTTP/1.1 200 OK\\r\\nContent-Type: image/png\\r\\nContent-Length: ' + png.length + '\\r\\nConnection: close\\r\\n\\r\\n');
    s.end(png);
  });
}).listen(8080);
setInterval(() => {}, 1 << 30);
`;

// The image's own health check waits for the converter heartbeat, which these containers do not run.
const NO_HEALTH_CHECK: HealthCheck = {
  test: ['CMD-SHELL', 'true'],
  interval: 1000,
  timeout: 1000,
  retries: 1,
  startPeriod: 0,
};
const PICTURE_BOX = { x: 100, y: 100, w: 400, h: 300 };
const LOCAL_PICTURE = '/tmp/local-linked.png';

let network: StartedNetwork;
let listener: StartedTestContainer;
let converter: StartedTestContainer;
let jobs = 0;

/** A one-slide deck whose picture is linked to `target` instead of embedded. */
async function linkedPictureDeck(target: string): Promise<Buffer> {
  const built = await buildPptx({
    slides: [{ shapes: [picture(4, 'rIdLinked', PICTURE_BOX).replace('r:embed=', 'r:link=')] }],
  });
  const zip = await ZipArchive.open(built, {
    maxEntries: 200,
    maxTotalBytes: 50e6,
    maxEntryBytes: 20e6,
    maxRatio: 1000,
  });
  const files: Record<string, Buffer> = {};
  for (const name of zip.names()) files[name] = await zip.read(name);
  zip.close();
  const rels = 'ppt/slides/_rels/slide1.xml.rels';
  files[rels] = Buffer.from(
    (files[rels] ?? Buffer.alloc(0))
      .toString('utf8')
      .replace(
        '</Relationships>',
        '<Relationship Id="rIdLinked" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
          `Target="${target}" TargetMode="External"/></Relationships>`,
      ),
  );
  return zipFiles(files);
}

/** Connections and request lines the listener saw since the last call. */
async function takeHits(): Promise<string[]> {
  const { output } = await listener.exec(['sh', '-c', 'cat /tmp/hits.log 2>/dev/null; : > /tmp/hits.log']);
  return output.split('\n').filter(Boolean);
}

/** Renders a deck like presentationToPdf (optionally with a seeded profile); returns the PDF's picture count. */
async function render(
  deck: Buffer,
  profile: string | undefined,
): Promise<{ pdf: boolean; pictures: number }> {
  const dir = `/tmp/job-${++jobs}`;
  await converter.copyContentToContainer([
    { content: deck, target: `${dir}/source.pptx`, mode: 0o644 },
    ...(profile
      ? [{ content: profile, target: `${dir}/profile/user/registrymodifications.xcu`, mode: 0o644 }]
      : []),
  ]);
  // Copied files belong to root; in production the job directory belongs to the converter's group.
  await converter.exec(['chown', '-R', '10002:10000', dir], { user: 'root' });
  await converter.exec(
    [
      'soffice',
      `-env:UserInstallation=file://${dir}/profile`,
      '--headless',
      '--invisible',
      '--nologo',
      '--norestore',
      '--nolockcheck',
      '--nodefault',
      '--convert-to',
      PDF_FILTER,
      '--outdir',
      dir,
      `${dir}/source.pptx`,
    ],
    { env: { HOME: dir, TMPDIR: dir, SAL_USE_VCLPLUGIN: 'svp', PATH: '/usr/local/bin:/usr/bin:/bin' } },
  );
  const { output } = await converter.exec([
    'sh',
    '-c',
    `test -s ${dir}/source.pdf && grep -a -o '/Subtype */Image' ${dir}/source.pdf | wc -l || echo none`,
  ]);
  const value = output.trim();
  return value === 'none' ? { pdf: false, pictures: 0 } : { pdf: true, pictures: Number(value) };
}

describe.skipIf(!imagePresent)('F-19 / M-6: LibreOffice and linked pictures', () => {
  beforeAll(async () => {
    network = await new Network().start();
    listener = await new GenericContainer(IMAGE)
      .withNetwork(network)
      .withNetworkAliases('probe')
      .withEntrypoint(['node', '-e', LISTENER])
      .withEnvironment({ PNG: solidPng(8, 8, [200, 30, 30]).toString('base64') })
      .withHealthCheck(NO_HEALTH_CHECK)
      .start();
    converter = await new GenericContainer(IMAGE)
      .withNetwork(network)
      .withEntrypoint(['node', '-e', 'setInterval(() => {}, 1 << 30)'])
      .withHealthCheck(NO_HEALTH_CHECK)
      .start();
    await converter.copyContentToContainer([
      { content: solidPng(64, 64, [10, 120, 200]), target: LOCAL_PICTURE, mode: 0o644 },
    ]);
  }, 180_000);

  afterAll(async () => {
    await converter?.stop();
    await listener?.stop();
    await network?.stop();
  });

  it('controls: the listener is reachable, and an embedded picture renders with and without M-6', async () => {
    await takeHits();
    await converter.exec([
      'node',
      '-e',
      "fetch('http://probe:8080/control').then((r) => r.arrayBuffer()).catch(() => {})",
    ]);
    expect(await takeHits()).toContain('GET /control HTTP/1.1');

    const embedded = await buildPptx({
      slides: [
        {
          shapes: [picture(4, 'rIdPic', PICTURE_BOX)],
          images: { rIdPic: { name: 'image1.png', bytes: solidPng(64, 64, [10, 120, 200]) } },
        },
      ],
    });
    expect(await render(embedded, undefined)).toEqual({ pdf: true, pictures: 1 });
    expect(await render(embedded, HARDENED_PROFILE)).toEqual({ pdf: true, pictures: 1 });
  }, 120_000);

  it('a picture linked to an http address is not fetched (today and with M-6)', async () => {
    const deck = await linkedPictureDeck('http://probe:8080/linked.png');
    for (const profile of [PRODUCTION_PROFILE, HARDENED_PROFILE]) {
      await takeHits();
      expect(await render(deck, profile)).toEqual({ pdf: true, pictures: 0 });
      expect(await takeHits()).toEqual([]);
    }
  }, 120_000);

  // F-19 (M-6 applied): the shipped profile blocks the local-file link that an
  // empty profile would embed.
  it('the production profile does not embed a picture linked to a local file', async () => {
    const deck = await linkedPictureDeck(`file://${LOCAL_PICTURE}`);
    expect(await render(deck, PRODUCTION_PROFILE)).toEqual({ pdf: true, pictures: 0 });
  }, 120_000);
});
