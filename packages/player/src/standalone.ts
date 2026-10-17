// SPDX-License-Identifier: Apache-2.0
/**
 * Entry of exported packages. Reads the course from `data/course.js` (a plain
 * script, so the package also works from file://) and starts the player with
 * the tracking adapter chosen at export time. No schema library is bundled:
 * the export validates the course, which keeps the player small.
 */
import type { Course } from '@lernwerk/course-model';
import { assetFileName } from '@lernwerk/course-model/assets';
import { Player } from './runtime/player.js';
import { scorm12Tracker } from './tracking/scorm12.js';
import { noTracking, type Tracker } from './tracking/types.js';

declare global {
  interface Window {
    LERNWERK_COURSE?: unknown;
    LERNWERK_EXPORT?: { tracking: 'none' | 'scorm12' };
  }
}

function start(): void {
  const root = document.getElementById('lernwerk');
  if (!root) return;
  // Validated and migrated by the server when the package was exported.
  const course = window.LERNWERK_COURSE as Course;
  const trackers: Record<string, () => Tracker> = { none: () => noTracking, scorm12: () => scorm12Tracker() };
  const tracker = (trackers[window.LERNWERK_EXPORT?.tracking ?? 'none'] ?? (() => noTracking))();
  new Player(root, {
    course,
    tracker,
    assetUrl: (sha) => assetFileName(sha, course.assets[sha]?.mime ?? ''),
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
