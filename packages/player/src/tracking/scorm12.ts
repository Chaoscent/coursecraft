// SPDX-License-Identifier: Apache-2.0
import {
  decodeState,
  encodeState,
  scorm12Time,
  type CompletionResult,
  type ResumeState,
  type Tracker,
} from './types.js';

/** SCORM 1.2 run-time API as provided by the LMS. */
interface Scorm12Api {
  LMSInitialize(arg: ''): string;
  LMSFinish(arg: ''): string;
  LMSGetValue(element: string): string;
  LMSSetValue(element: string, value: string): string;
  LMSCommit(arg: ''): string;
  LMSGetLastError(): string;
}

function isApi(value: unknown): value is Scorm12Api {
  return (
    typeof value === 'object' && value !== null && typeof (value as Scorm12Api).LMSInitialize === 'function'
  );
}

/** Standard API discovery: parent frames first, then the opener's frames. */
export function findScorm12Api(start: Window = window): Scorm12Api | null {
  const search = (win: Window): Scorm12Api | null => {
    let current: Window = win;
    for (let depth = 0; depth < 10; depth++) {
      try {
        const candidate = (current as unknown as { API?: unknown }).API;
        if (isApi(candidate)) return candidate;
      } catch {
        return null;
      }
      if (current.parent === current) break;
      current = current.parent;
    }
    return null;
  };
  return search(start) ?? (start.opener ? search(start.opener as Window) : null);
}

export function scorm12Tracker(api: Scorm12Api | null = findScorm12Api()): Tracker {
  const startedAt = Date.now();
  let active = false;
  let finished = false;
  const set = (key: string, value: string) => {
    if (active) api?.LMSSetValue(key, value);
  };

  return {
    name: 'scorm12',
    start() {
      if (!api) return null;
      active = api.LMSInitialize('') === 'true';
      if (!active) return null;
      const status = api.LMSGetValue('cmi.core.lesson_status');
      if (!status || status === 'not attempted') set('cmi.core.lesson_status', 'incomplete');
      const state = decodeState(api.LMSGetValue('cmi.suspend_data'));
      if (state) return state;
      const location = Number(api.LMSGetValue('cmi.core.lesson_location'));
      return Number.isInteger(location) && location > 0 ? { location, viewed: [] } : null;
    },
    save(state: ResumeState) {
      set('cmi.core.lesson_location', String(state.location));
      set('cmi.suspend_data', encodeState(state).slice(0, 4096));
      if (active) api?.LMSCommit('');
    },
    complete(result: CompletionResult) {
      if (!result.completed) return;
      if (result.score !== undefined) {
        set('cmi.core.score.min', '0');
        set('cmi.core.score.max', '100');
        set('cmi.core.score.raw', String(Math.round(result.score * 100)));
      }
      set(
        'cmi.core.lesson_status',
        result.passed === undefined ? 'completed' : result.passed ? 'passed' : 'failed',
      );
      if (active) api?.LMSCommit('');
    },
    finish() {
      if (!active || finished) return;
      finished = true;
      set('cmi.core.session_time', scorm12Time(Date.now() - startedAt));
      set('cmi.core.exit', 'suspend');
      api?.LMSCommit('');
      api?.LMSFinish('');
    },
  };
}
