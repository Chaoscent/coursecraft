// SPDX-License-Identifier: Apache-2.0
/**
 * SCORM runtime for imported packages, served on the content origin at
 * /launch/<token>/_lw/wrapper.html. scorm-again answers the package's API
 * calls locally; commits and finish go to the host page on the app origin
 * via postMessage, which stores them with the learner's session.
 */

interface ScormApi {
  cmi: unknown;
  on(event: string, callback: (...args: unknown[]) => void): void;
  loadFromJSON(json: Record<string, unknown>, element?: string): void;
}
type ScormApiConstructor = new (settings: Record<string, unknown>) => ScormApi;

interface InitMessage {
  type: 'lw:init';
  launchId: string;
  kind: 'scorm12' | 'scorm2004';
  cmi: Record<string, unknown>;
  launchPath: string;
  learnerId: string;
  learnerName: string;
  mode: 'Normal' | 'Review';
}

const appOrigin = document.documentElement.dataset['appOrigin'] ?? '';

function isInit(data: unknown): data is InitMessage {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Record<string, unknown>;
  return (
    m['type'] === 'lw:init' &&
    typeof m['launchId'] === 'string' &&
    (m['kind'] === 'scorm12' || m['kind'] === 'scorm2004') &&
    typeof m['cmi'] === 'object' &&
    m['cmi'] !== null &&
    typeof m['launchPath'] === 'string' &&
    // Relative path inside the package only.
    !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(m['launchPath']) &&
    typeof m['learnerId'] === 'string' &&
    typeof m['learnerName'] === 'string' &&
    (m['mode'] === 'Normal' || m['mode'] === 'Review')
  );
}

const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

function start(init: InitMessage): void {
  const global = window as unknown as Record<string, unknown>;
  const Api = global[init.kind === 'scorm12' ? 'Scorm12API' : 'Scorm2004API'] as ScormApiConstructor;
  const api = new Api({ autocommit: true, autocommitSeconds: 30, lmsCommitUrl: false, logLevel: 5 });
  const stored = init.cmi;
  const resuming = Object.keys(stored).length > 0;
  const review = init.mode === 'Review';
  if (init.kind === 'scorm12') {
    const core = (stored['core'] as Record<string, unknown> | undefined) ?? {};
    api.loadFromJSON({
      cmi: {
        ...stored,
        core: {
          ...core,
          student_id: init.learnerId,
          student_name: init.learnerName,
          entry: resuming && core['exit'] === 'suspend' ? 'resume' : resuming ? '' : 'ab-initio',
          lesson_mode: review ? 'review' : 'normal',
          credit: review ? 'no-credit' : 'credit',
        },
      },
    });
  } else {
    api.loadFromJSON({
      cmi: {
        ...stored,
        learner_id: init.learnerId,
        learner_name: init.learnerName,
        entry: resuming && stored['exit'] === 'suspend' ? 'resume' : resuming ? '' : 'ab-initio',
        mode: review ? 'review' : 'normal',
        credit: review ? 'no-credit' : 'credit',
      },
    });
  }
  const send = (finished: boolean) =>
    window.parent.postMessage(
      { type: 'lw:commit', launchId: init.launchId, cmi: plain(api.cmi), finished },
      appOrigin,
    );
  const commitEvent = init.kind === 'scorm12' ? 'LMSCommit' : 'Commit';
  const finishEvent = init.kind === 'scorm12' ? 'LMSFinish' : 'Terminate';
  api.on(commitEvent, () => send(false));
  api.on(finishEvent, () => send(true));
  global[init.kind === 'scorm12' ? 'API' : 'API_1484_11'] = api;

  const frame = document.getElementById('sco') as HTMLIFrameElement;
  frame.src = `../${init.launchPath}`;
}

let started = false;
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (started || event.origin !== appOrigin || event.source !== window.parent || !isInit(event.data)) return;
  started = true;
  start(event.data);
});
window.parent.postMessage({ type: 'lw:ready' }, appOrigin);
