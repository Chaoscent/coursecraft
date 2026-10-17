// SPDX-License-Identifier: Apache-2.0
import type { Course } from '@lernwerk/course-model';
import { lockResponseSchema, okSchema, saveCourseResponseSchema } from '@lernwerk/shared';
import { api, ApiError } from '../api/client.js';
import { errorMessage } from '../lib/errors.js';
import type { EditorStore } from './store.js';

const SAVE_DELAY_MS = 800;
const RETRY_MS = 5000;
const HEARTBEAT_MS = 20_000;

/** Everything that changed between the acknowledged and the current state. */
export function diffCourse(synced: Course, course: Course) {
  const upsertNodes = Object.values(course.nodes).filter((node) => synced.nodes[node.id] !== node);
  const deleteNodes = Object.keys(synced.nodes).filter((id) => !course.nodes[id]);
  const meta = course.meta !== synced.meta ? course.meta : undefined;
  return {
    ...(course.structure !== synced.structure ? { structure: course.structure } : {}),
    ...(meta ? { meta, title: meta.title[course.languages.default] ?? Object.values(meta.title)[0] } : {}),
    ...(course.settings !== synced.settings ? { settings: course.settings } : {}),
    ...(course.languages !== synced.languages ? { languages: course.languages } : {}),
    upsertNodes,
    deleteNodes,
  };
}

/**
 * Saves changes shortly after they happen and keeps the edit lock alive.
 * Returns a function that stops syncing and releases the lock.
 */
export function startSync(store: EditorStore, onLockLost: (holder: string | null) => void): () => void {
  let timer: number | undefined;
  let saving = false;
  let stopped = false;

  const schedule = (delay = SAVE_DELAY_MS) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void save(), delay);
  };

  const save = async () => {
    const state = store.getState();
    if (
      saving ||
      stopped ||
      state.readOnly ||
      state.course === state.synced ||
      state.save.kind === 'conflict'
    )
      return;
    saving = true;
    const sent = state.course;
    state.setSaveState({ kind: 'saving' });
    try {
      const result = await api(saveCourseResponseSchema, `/api/courses/${state.courseId}/save`, {
        method: 'POST',
        body: { rev: state.rev, ...diffCourse(state.synced, sent) },
      });
      store.getState().acknowledge(sent, result.rev);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409)
        store.getState().setSaveState({ kind: 'conflict' });
      else {
        store.getState().setSaveState({ kind: 'error', message: errorMessage(error) });
        schedule(RETRY_MS);
      }
    } finally {
      saving = false;
    }
    if (store.getState().course !== sent && store.getState().save.kind !== 'conflict') schedule();
  };

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.course !== previous.course) schedule();
  });

  const heartbeat = async () => {
    const { courseId, readOnly } = store.getState();
    if (readOnly || stopped) return;
    try {
      const result = await api(lockResponseSchema, `/api/courses/${courseId}/lock`, { method: 'POST' });
      if (!result.acquired) {
        store.getState().setReadOnly(true);
        onLockLost(result.lock?.userName ?? null);
      }
    } catch {
      // Network hiccup; the next heartbeat retries before the lock times out.
    }
  };
  const interval = window.setInterval(() => void heartbeat(), HEARTBEAT_MS);

  const beforeUnload = (event: BeforeUnloadEvent) => {
    const state = store.getState();
    if (state.course !== state.synced) event.preventDefault();
  };
  window.addEventListener('beforeunload', beforeUnload);

  // Last chance when the page goes away: send pending changes with keepalive.
  const pageHide = () => {
    const state = store.getState();
    if (state.readOnly || saving || state.course === state.synced || state.save.kind === 'conflict') return;
    void api(saveCourseResponseSchema, `/api/courses/${state.courseId}/save`, {
      method: 'POST',
      keepalive: true,
      body: { rev: state.rev, ...diffCourse(state.synced, state.course) },
    }).catch(() => undefined);
  };
  window.addEventListener('pagehide', pageHide);

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.clearInterval(interval);
    unsubscribe();
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('pagehide', pageHide);
    const { courseId, readOnly } = store.getState();
    if (!readOnly)
      void api(okSchema, `/api/courses/${courseId}/lock`, { method: 'DELETE', keepalive: true }).catch(
        () => undefined,
      );
  };
}

/** Saves immediately (before export, preview of the server state, closing). */
export async function flush(store: EditorStore): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const s = store.getState();
    if (s.course === s.synced && s.save.kind !== 'saving') return;
    if (s.save.kind === 'conflict' || s.save.kind === 'error') return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
