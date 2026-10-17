// SPDX-License-Identifier: Apache-2.0
import type { Response } from '@lernwerk/course-model/scoring';
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

/** One answered question, for SCORM interactions and xAPI "answered" statements. */
export interface InteractionRecord {
  id: string;
  /** Lernwerk question type; adapters map it to their vocabulary. */
  questionType: string;
  description: string;
  response: string;
  result: 'correct' | 'incorrect' | 'partial' | 'pending' | 'neutral';
  score?: { raw: number; max: number };
  latencyMs: number;
  /** Activity the question belongs to (quiz or survey id). */
  parentId: string;
  /** Structured answer, for adapters with strict response formats. */
  data?: Response;
}

/**
 * Connection to whatever records progress: nothing (HTML5), an LMS API
 * (SCORM) or an LRS (xAPI, cmi5). Calls must never throw into the player.
 */
export interface Tracker {
  readonly name: string;
  /** Initializes the session; may need a round trip to the LMS or LRS. */
  start(): ResumeState | null | Promise<ResumeState | null>;
  /** Where to go when the learner leaves (cmi5 returnURL). */
  exitUrl?(): string | null;
  save(state: ResumeState, progress: number): void;
  complete(result: CompletionResult): void;
  interaction(record: InteractionRecord): void;
  /** A node (slide, interaction) was shown. */
  experienced(nodeId: string, title: string): void;
  finish(): void;
}

export const noTracking: Tracker = {
  name: 'none',
  start: () => null,
  save: () => undefined,
  interaction: () => undefined,
  experienced: () => undefined,
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

/** ISO 8601 duration (SCORM 2004, xAPI) from milliseconds. */
export function isoDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10)) / 100;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.round((total % 60) * 100) / 100;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s}S`;
}

/** SCORM time formats from milliseconds. */
export function scorm12Time(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10)) / 100;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(4, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}
