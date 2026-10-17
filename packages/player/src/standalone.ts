// SPDX-License-Identifier: Apache-2.0
/**
 * Entry of exported packages. Reads the course from `data/course.js` (a plain
 * script, so the package also works from file://) and starts the player with
 * the tracking adapter chosen at export time. No schema library is bundled:
 * the export validates the course, which keeps the player small.
 */
import type { Course } from '@coursecraft/course-model';
import { assetFileName } from '@coursecraft/course-model/assets';
import { Player } from './runtime/player.js';
import { cmi5Tracker } from './tracking/cmi5.js';
import { scorm12Tracker } from './tracking/scorm12.js';
import { scorm2004Tracker } from './tracking/scorm2004.js';
import { noTracking, type Tracker } from './tracking/types.js';
import { xapiTracker } from './tracking/xapi.js';

declare global {
  interface Window {
    COURSECRAFT_COURSE?: unknown;
    COURSECRAFT_EXPORT?: { tracking: 'none' | 'scorm12' | 'scorm2004' | 'xapi' | 'cmi5' };
  }
}

function start(): void {
  const root = document.getElementById('coursecraft');
  if (!root) return;
  // Validated and migrated by the server when the package was exported.
  const course = window.COURSECRAFT_COURSE as Course;
  const info = {
    id: course.id,
    title: course.meta.title[course.languages.default] ?? '',
    lang: course.languages.default,
  };
  const trackers: Record<string, () => Tracker> = {
    none: () => noTracking,
    scorm12: () => scorm12Tracker(),
    scorm2004: () => scorm2004Tracker(),
    xapi: () => xapiTracker(info),
    cmi5: () => cmi5Tracker(info),
  };
  const tracker = (trackers[window.COURSECRAFT_EXPORT?.tracking ?? 'none'] ?? (() => noTracking))();
  new Player(root, {
    course,
    tracker,
    assetUrl: (sha) => assetFileName(sha, course.assets[sha]?.mime ?? ''),
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
