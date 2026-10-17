// SPDX-License-Identifier: Apache-2.0
import {
  decodeState,
  encodeState,
  isoDuration,
  type CompletionResult,
  type InteractionRecord,
  type ResumeState,
  type Tracker,
} from './types.js';

/** ADL verbs used by Lernwerk. */
export const VERBS = {
  initialized: 'http://adlnet.gov/expapi/verbs/initialized',
  experienced: 'http://adlnet.gov/expapi/verbs/experienced',
  answered: 'http://adlnet.gov/expapi/verbs/answered',
  completed: 'http://adlnet.gov/expapi/verbs/completed',
  passed: 'http://adlnet.gov/expapi/verbs/passed',
  failed: 'http://adlnet.gov/expapi/verbs/failed',
  terminated: 'http://adlnet.gov/expapi/verbs/terminated',
} as const;
type Verb = keyof typeof VERBS;

const INTERACTION_TYPES: Record<string, string> = {
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

export interface XapiConfig {
  endpoint: string;
  auth: string;
  actor: Record<string, unknown>;
  registration?: string | undefined;
  activityId: string;
  courseTitle: string;
  lang: string;
}

export interface StatementExtras {
  result?: Record<string, unknown>;
  context?: Record<string, unknown>;
  object?: Record<string, unknown>;
}

export function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Sends statements and state documents to the LRS from the launch
 * parameters. The only network access of the player; nothing else is
 * contacted.
 */
export class XapiClient {
  readonly config: XapiConfig;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(config: XapiConfig) {
    this.config = config;
  }

  #url(path: string, query: Record<string, string> = {}): string {
    const base = this.config.endpoint.endsWith('/') ? this.config.endpoint : `${this.config.endpoint}/`;
    const params = new URLSearchParams(query).toString();
    return `${base}${path}${params ? `?${params}` : ''}`;
  }

  #headers(json = true): Record<string, string> {
    return {
      Authorization: this.config.auth,
      'X-Experience-API-Version': '1.0.3',
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  statement(verb: Verb, extras: StatementExtras = {}, keepalive = false): void {
    const statement = {
      id: uuid(),
      timestamp: new Date().toISOString(),
      actor: this.config.actor,
      verb: { id: VERBS[verb], display: { 'en-US': verb } },
      object: extras.object ?? {
        objectType: 'Activity',
        id: this.config.activityId,
        definition: {
          type: 'http://adlnet.gov/expapi/activities/course',
          name: { [this.config.lang]: this.config.courseTitle },
        },
      },
      ...(extras.result ? { result: extras.result } : {}),
      context: {
        ...(this.config.registration ? { registration: this.config.registration } : {}),
        ...(extras.context ?? {}),
      },
    };
    // Sequential sending keeps statement order in the LRS.
    this.#queue = this.#queue
      .then(() =>
        fetch(this.#url('statements'), {
          method: 'POST',
          headers: this.#headers(),
          body: JSON.stringify(statement),
          keepalive,
        }),
      )
      .catch(() => undefined);
  }

  #stateQuery(stateId: string): Record<string, string> {
    return {
      activityId: this.config.activityId,
      agent: JSON.stringify(this.config.actor),
      stateId,
      ...(this.config.registration ? { registration: this.config.registration } : {}),
    };
  }

  async getState(stateId: string): Promise<string | null> {
    try {
      const res = await fetch(this.#url('activities/state', this.#stateQuery(stateId)), {
        headers: this.#headers(false),
      });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  putState(stateId: string, body: string): void {
    this.#queue = this.#queue
      .then(() =>
        fetch(this.#url('activities/state', this.#stateQuery(stateId)), {
          method: 'PUT',
          headers: this.#headers(),
          body,
        }),
      )
      .catch(() => undefined);
  }

  /** Object for a question, with its interaction definition. */
  questionObject(record: InteractionRecord): Record<string, unknown> {
    const type = INTERACTION_TYPES[record.questionType];
    return {
      objectType: 'Activity',
      id: `${this.config.activityId}/${encodeURIComponent(record.parentId)}/${encodeURIComponent(record.id)}`,
      definition: {
        type: 'http://adlnet.gov/expapi/activities/cmi.interaction',
        ...(type ? { interactionType: type } : { interactionType: 'other' }),
        ...(record.description ? { description: { [this.config.lang]: record.description } } : {}),
      },
    };
  }

  answeredResult(record: InteractionRecord): Record<string, unknown> {
    return {
      response: record.response,
      duration: isoDuration(record.latencyMs),
      ...(record.result === 'correct' || record.result === 'incorrect' || record.result === 'partial'
        ? { success: record.result === 'correct' }
        : {}),
      ...(record.score
        ? {
            score: {
              raw: record.score.raw,
              min: 0,
              max: record.score.max,
              scaled: record.score.max ? record.score.raw / record.score.max : 0,
            },
          }
        : {}),
    };
  }
}

/** Reads Tin Can launch parameters from the page URL. */
export function launchParams(search = window.location.search): URLSearchParams {
  return new URLSearchParams(search);
}

export function parseActor(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const actor = JSON.parse(raw) as Record<string, unknown> & { mbox?: unknown; account?: unknown };
    // Tin Can launches sometimes pass arrays for mbox/name.
    for (const key of ['mbox', 'name', 'mbox_sha1sum', 'openid'] as const) {
      const value = actor[key];
      if (Array.isArray(value)) actor[key] = value[0];
    }
    if (Array.isArray(actor.account)) actor.account = actor.account[0];
    return actor;
  } catch {
    return null;
  }
}

const RESUME_STATE = 'urn:lernwerk:resume';

/** xAPI (Tin Can launch): statements for progress, answers and results. */
export function xapiTracker(
  course: { id: string; title: string; lang: string },
  params = launchParams(),
): Tracker {
  const endpoint = params.get('endpoint');
  const actor = parseActor(params.get('actor'));
  if (!endpoint || !actor) return inactive('xapi');
  const client = new XapiClient({
    endpoint,
    auth: params.get('auth') ?? '',
    actor,
    registration: params.get('registration') ?? undefined,
    activityId: params.get('activity_id') ?? `urn:lernwerk:course:${course.id}`,
    courseTitle: course.title,
    lang: course.lang,
  });
  const startedAt = Date.now();
  let saveTimer: number | undefined;
  let finished = false;

  return {
    name: 'xapi',
    async start() {
      client.statement('initialized');
      return decodeState(await client.getState(RESUME_STATE));
    },
    save(state: ResumeState) {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => client.putState(RESUME_STATE, encodeState(state)), 1000);
    },
    experienced(nodeId, title) {
      client.statement('experienced', {
        object: {
          objectType: 'Activity',
          id: `${client.config.activityId}/${encodeURIComponent(nodeId)}`,
          definition: { type: 'http://adlnet.gov/expapi/activities/module', name: { [course.lang]: title } },
        },
        context: {
          contextActivities: { parent: [{ id: client.config.activityId, objectType: 'Activity' }] },
        },
      });
    },
    interaction(record: InteractionRecord) {
      client.statement('answered', {
        object: client.questionObject(record),
        result: client.answeredResult(record),
        context: {
          contextActivities: { parent: [{ id: client.config.activityId, objectType: 'Activity' }] },
        },
      });
    },
    complete(result: CompletionResult) {
      if (!result.completed) return;
      const score =
        result.score !== undefined
          ? { score: { scaled: result.score, raw: Math.round(result.score * 100), min: 0, max: 100 } }
          : {};
      client.statement('completed', {
        result: {
          completion: true,
          ...score,
          ...(result.passed !== undefined ? { success: result.passed } : {}),
        },
      });
      if (result.passed !== undefined)
        client.statement(result.passed ? 'passed' : 'failed', {
          result: { success: result.passed, ...score },
        });
    },
    finish() {
      if (finished) return;
      finished = true;
      client.statement('terminated', { result: { duration: isoDuration(Date.now() - startedAt) } }, true);
    },
  };
}

export function inactive(name: string): Tracker {
  return {
    name,
    start: () => null,
    save: () => undefined,
    complete: () => undefined,
    interaction: () => undefined,
    experienced: () => undefined,
    finish: () => undefined,
  };
}
