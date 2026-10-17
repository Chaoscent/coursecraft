// SPDX-License-Identifier: Apache-2.0
/** State the player restores when a learner returns. */
export interface ResumeState {
  /** Index of the node the learner was on. */
  location: number;
  /** Indexes of viewed nodes (compact for SCORM 1.2's 4096-character limit). */
  viewed: number[];
}

export interface CompletionResult {
  completed: boolean;
  /** 0..1, only when the course has a scored quiz. */
  score?: number;
  passed?: boolean;
}

/**
 * Connection to whatever records progress: nothing (HTML5), an LMS API
 * (SCORM) or an LRS (xAPI, cmi5). Calls must never throw into the player.
 */
export interface Tracker {
  readonly name: string;
  start(): ResumeState | null;
  save(state: ResumeState, progress: number): void;
  complete(result: CompletionResult): void;
  finish(): void;
}

export const noTracking: Tracker = {
  name: 'none',
  start: () => null,
  save: () => undefined,
  complete: () => undefined,
  finish: () => undefined,
};

export function encodeState(state: ResumeState): string {
  return JSON.stringify({ l: state.location, v: state.viewed });
}

export function decodeState(raw: string | null | undefined): ResumeState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { l?: unknown; v?: unknown };
    if (typeof value.l !== 'number' || !Array.isArray(value.v)) return null;
    return { location: value.l, viewed: value.v.filter((n): n is number => typeof n === 'number') };
  } catch {
    return null;
  }
}

/** SCORM time formats from milliseconds. */
export function scorm12Time(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10)) / 100;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(4, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}
