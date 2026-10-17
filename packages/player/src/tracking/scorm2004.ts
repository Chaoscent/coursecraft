// SPDX-License-Identifier: Apache-2.0
import type { Response } from '@coursecraft/course-model/scoring';
import {
  decodeState,
  encodeState,
  isoDuration,
  type CompletionResult,
  type InteractionRecord,
  type ResumeState,
  type Tracker,
} from './types.js';

/** SCORM 2004 run-time API (API_1484_11). */
interface Scorm2004Api {
  Initialize(arg: ''): string;
  Terminate(arg: ''): string;
  GetValue(element: string): string;
  SetValue(element: string, value: string): string;
  Commit(arg: ''): string;
}

function isApi(value: unknown): value is Scorm2004Api {
  return (
    typeof value === 'object' && value !== null && typeof (value as Scorm2004Api).Initialize === 'function'
  );
}

export function findScorm2004Api(start: Window = window): Scorm2004Api | null {
  const search = (win: Window): Scorm2004Api | null => {
    let current: Window = win;
    for (let depth = 0; depth < 10; depth++) {
      try {
        const candidate = (current as unknown as { API_1484_11?: unknown }).API_1484_11;
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

const TYPES: Record<string, string> = {
  singleChoice: 'choice',
  multipleChoice: 'choice',
  hotspot: 'choice',
  trueFalse: 'true-false',
  shortAnswer: 'fill-in',
  fillInBlanks: 'fill-in',
  selectBlanks: 'fill-in',
  wordBank: 'fill-in',
  essay: 'long-fill-in',
  matching: 'matching',
  dragDrop: 'matching',
  sequence: 'sequencing',
  likert: 'likert',
  numeric: 'numeric',
};

/** Short identifiers per SCORM 2004 (no spaces or delimiters). */
const sid = (value: string) => value.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 250) || '_';

/** learner_response in the format SCORM 2004 prescribes for the type. */
export function scorm2004Response(data: Response | undefined, fallback: string): string {
  if (!data) return fallback.slice(0, 4000);
  switch (data.type) {
    case 'singleChoice':
      return data.choiceId ? sid(data.choiceId) : '';
    case 'multipleChoice':
      return data.choiceIds.map(sid).join('[,]');
    case 'hotspot':
      return data.areaIds.map(sid).join('[,]');
    case 'trueFalse':
      return data.value === null ? '' : String(data.value);
    case 'shortAnswer':
    case 'essay':
      return data.text.slice(0, 4000);
    case 'fillInBlanks':
      return Object.values(data.blanks).join('[,]').slice(0, 4000);
    case 'selectBlanks':
    case 'wordBank':
      return Object.values(data.blanks).map(sid).join('[,]');
    case 'matching':
      return Object.entries(data.pairs)
        .map(([a, b]) => `${sid(a)}[.]${sid(b)}`)
        .join('[,]');
    case 'dragDrop':
      return Object.entries(data.placements)
        .filter(([, zone]) => zone)
        .map(([item, zone]) => `${sid(item)}[.]${sid(zone ?? '')}`)
        .join('[,]');
    case 'sequence':
      return data.order.map(sid).join('[,]');
    case 'likert':
      return sid(Object.values(data.answers)[0] ?? '');
    case 'numeric':
      return data.value === null ? '' : String(data.value);
  }
}

export function scorm2004Tracker(api: Scorm2004Api | null = findScorm2004Api()): Tracker {
  const startedAt = Date.now();
  let active = false;
  let finished = false;
  let completed = false;
  const set = (key: string, value: string) => {
    if (active) api?.SetValue(key, value);
  };
  const commit = () => {
    if (active) api?.Commit('');
  };

  return {
    name: 'scorm2004',
    start() {
      if (!api) return null;
      active = api.Initialize('') === 'true';
      if (!active) return null;
      const status = api.GetValue('cmi.completion_status');
      if (status === 'completed') completed = true;
      if (!status || status === 'unknown' || status === 'not attempted')
        set('cmi.completion_status', 'incomplete');
      const state = decodeState(api.GetValue('cmi.suspend_data'));
      if (state) return state;
      const location = Number(api.GetValue('cmi.location'));
      return Number.isInteger(location) && location > 0 ? { location, viewed: [] } : null;
    },
    save(state: ResumeState, progress: number) {
      set('cmi.location', String(state.location));
      set('cmi.suspend_data', encodeState(state).slice(0, 64000));
      set('cmi.progress_measure', progress.toFixed(2));
      commit();
    },
    complete(result: CompletionResult) {
      if (!result.completed) return;
      completed = true;
      set('cmi.completion_status', 'completed');
      if (result.score !== undefined) {
        set('cmi.score.scaled', result.score.toFixed(4));
        set('cmi.score.raw', String(Math.round(result.score * 100)));
        set('cmi.score.min', '0');
        set('cmi.score.max', '100');
      }
      if (result.passed !== undefined) set('cmi.success_status', result.passed ? 'passed' : 'failed');
      commit();
    },
    interaction(record: InteractionRecord) {
      if (!active || !api) return;
      const n = Number(api.GetValue('cmi.interactions._count')) || 0;
      const type = TYPES[record.questionType] ?? 'other';
      const p = `cmi.interactions.${n}`;
      set(`${p}.id`, `urn:coursecraft:${sid(record.parentId)}:${sid(record.id)}`);
      set(`${p}.type`, type);
      set(`${p}.timestamp`, new Date().toISOString().slice(0, 19));
      set(
        `${p}.learner_response`,
        type === 'other' ? record.response.slice(0, 4000) : scorm2004Response(record.data, record.response),
      );
      set(
        `${p}.result`,
        record.result === 'correct'
          ? 'correct'
          : record.result === 'incorrect' || record.result === 'partial'
            ? 'incorrect'
            : 'neutral',
      );
      if (record.score) set(`${p}.weighting`, String(record.score.max));
      set(`${p}.latency`, isoDuration(record.latencyMs));
      if (record.description) set(`${p}.description`, record.description.slice(0, 250));
      commit();
    },
    experienced() {
      // Progress goes into cmi.location, suspend data and progress_measure.
    },
    finish() {
      if (!active || finished) return;
      finished = true;
      set('cmi.session_time', isoDuration(Date.now() - startedAt));
      set('cmi.exit', completed ? 'normal' : 'suspend');
      commit();
      api?.Terminate('');
    },
  };
}
