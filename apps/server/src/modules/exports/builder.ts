// SPDX-License-Identifier: Apache-2.0
import { assetFileName, CourseFormatError, loadCourse, type Course } from '@lernwerk/course-model';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZipFile } from 'yazl';
import { badRequest } from '../../http/errors.js';
import type { AssetStore } from '../assets/store.js';
import { cmi5Manifest, scorm2004Manifest, tincanManifest } from './manifests.js';
import { scorm12Manifest } from './scorm12.js';
import { escapeXml } from './xml.js';

export type ExportFormat = 'html5' | 'scorm12' | 'scorm2004-3' | 'scorm2004-4' | 'xapi' | 'cmi5';
type Tracking = 'none' | 'scorm12' | 'scorm2004' | 'xapi' | 'cmi5';

const TRACKING: Record<ExportFormat, Tracking> = {
  html5: 'none',
  scorm12: 'scorm12',
  'scorm2004-3': 'scorm2004',
  'scorm2004-4': 'scorm2004',
  xapi: 'xapi',
  cmi5: 'cmi5',
};

/**
 * Meta CSP of exported pages: everything from the package itself. xAPI and
 * cmi5 packages must reach the LRS named in the launch URL, which is not
 * known at export time; all other packages make no requests at all.
 */
function exportCsp(tracking: Tracking): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    tracking === 'xapi' || tracking === 'cmi5' ? 'connect-src https: http:' : "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

const PAGE_CSS = 'html,body{height:100%;margin:0}#lernwerk{height:100%}\n';

function courseTitle(course: Course): string {
  const title = course.meta.title;
  return title[course.languages.default] ?? Object.values(title)[0] ?? 'Course';
}

function indexHtml(course: Course, tracking: Tracking): string {
  const lang = escapeXml(course.languages.default);
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${exportCsp(tracking)}">
<meta name="generator" content="Lernwerk">
<title>${escapeXml(courseTitle(course))}</title>
<link rel="stylesheet" href="player/page.css">
<link rel="stylesheet" href="player/player.css">
</head>
<body>
<div id="lernwerk"></div>
<script src="data/course.js"></script>
<script src="player/player.js"></script>
</body>
</html>
`;
}

/** Course data as a classic script, so the package also runs from file://. */
function courseScript(course: Course, tracking: Tracking): string {
  return `window.LERNWERK_COURSE=${JSON.stringify(course)};\nwindow.LERNWERK_EXPORT=${JSON.stringify({ tracking })};\n`;
}

function playerFiles(playerDir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  files.set('player/player.js', readFileSync(join(playerDir, 'player.js')));
  files.set('player/player.css', readFileSync(join(playerDir, 'player.css')));
  for (const font of readdirSync(join(playerDir, 'fonts')))
    files.set(`player/fonts/${font}`, readFileSync(join(playerDir, 'fonts', font)));
  return files;
}

/**
 * Builds a self-contained package: the player, the validated course data and
 * all referenced media. Nothing in it loads from outside the package.
 */
export async function buildExport(
  document: unknown,
  format: ExportFormat,
  store: AssetStore,
  playerDir: string,
): Promise<{ buffer: Buffer; title: string; files: string[] }> {
  let course: Course;
  try {
    course = loadCourse(document);
  } catch (error) {
    if (error instanceof CourseFormatError) {
      const issue = error.issues[0];
      throw badRequest(
        `The course is not valid: ${issue ? `${issue.path.join('.')} ${issue.message}` : error.message}`,
      );
    }
    throw error;
  }

  const tracking = TRACKING[format];
  const entries = new Map<string, Buffer>();
  entries.set('index.html', Buffer.from(indexHtml(course, tracking)));
  entries.set('player/page.css', Buffer.from(PAGE_CSS));
  for (const [path, bytes] of playerFiles(playerDir)) entries.set(path, bytes);
  entries.set('data/course.js', Buffer.from(courseScript(course, tracking)));
  const assetPaths: [string, string][] = Object.entries(course.assets).map(([sha, meta]) => [
    assetFileName(sha, meta.mime),
    sha,
  ]);
  for (const [, sha] of assetPaths) {
    if (!store.has(sha)) throw badRequest('A file used by the course is missing');
  }
  const files = [...entries.keys(), ...assetPaths.map(([path]) => path)];
  const title = courseTitle(course);
  if (format === 'scorm12')
    entries.set('imsmanifest.xml', Buffer.from(scorm12Manifest(course, title, files)));
  if (format === 'scorm2004-3' || format === 'scorm2004-4') {
    entries.set(
      'imsmanifest.xml',
      Buffer.from(scorm2004Manifest(course, title, files, format === 'scorm2004-3' ? 3 : 4)),
    );
  }
  if (format === 'xapi') entries.set('tincan.xml', Buffer.from(tincanManifest(course, title)));
  if (format === 'cmi5') entries.set('cmi5.xml', Buffer.from(cmi5Manifest(course, title)));

  const zip = new ZipFile();
  for (const [path, bytes] of entries) zip.addBuffer(bytes, path, { mtime: new Date(0) });
  for (const [path, sha] of assetPaths) zip.addReadStream(store.open(sha), path, { mtime: new Date(0) });
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
  return {
    buffer: Buffer.concat(chunks),
    title: courseTitle(course),
    files: [...entries.keys(), ...assetPaths.map(([p]) => p)],
  };
}
