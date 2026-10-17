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
import { inactive, launchParams, parseActor, XapiClient } from './xapi.js';

const CMI5_CATEGORY = { id: 'https://w3id.org/xapi/cmi5/context/categories/cmi5', objectType: 'Activity' };
const MOVEON_CATEGORY = {
  id: 'https://w3id.org/xapi/cmi5/context/categories/moveon',
  objectType: 'Activity',
};
const MASTERY_EXTENSION = 'https://w3id.org/xapi/cmi5/context/extensions/masteryscore';
const RESUME_STATE = 'urn:coursecraft:resume';

interface LaunchData {
  contextTemplate?: { extensions?: Record<string, unknown>; contextActivities?: Record<string, unknown[]> };
  launchMode?: 'Normal' | 'Browse' | 'Review';
  moveOn?: string;
  masteryScore?: number;
  returnURL?: string;
}

/**
 * cmi5 Assignable Unit: fetches the auth token once, reads LMS.LaunchData,
 * and sends the "cmi5 defined" statements with the LMS context template.
 * In Browse and Review mode no completion or result is reported.
 */
export function cmi5Tracker(
  course: { id: string; title: string; lang: string },
  params = launchParams(),
): Tracker {
  const endpoint = params.get('endpoint');
  const fetchUrl = params.get('fetch');
  const actor = parseActor(params.get('actor'));
  const registration = params.get('registration') ?? undefined;
  const activityId = params.get('activityId');
  if (!endpoint || !fetchUrl || !actor || !activityId) return inactive('cmi5');

  let client: XapiClient | null = null;
  let launch: LaunchData = {};
  const startedAt = Date.now();
  let finished = false;
  let reported = false;

  const context = (categories: object[] = []): Record<string, unknown> => {
    const template = launch.contextTemplate ?? {};
    const activities = template.contextActivities ?? {};
    return {
      ...template,
      contextActivities: {
        ...activities,
        ...(categories.length ? { category: [...(activities['category'] ?? []), ...categories] } : {}),
      },
    };
  };
  const normal = () => (launch.launchMode ?? 'Normal') === 'Normal';

  return {
    name: 'cmi5',
    async start() {
      // The fetch URL may be used exactly once.
      const tokenResponse = await fetch(fetchUrl, { method: 'POST' }).catch(() => null);
      const token = tokenResponse?.ok
        ? ((await tokenResponse.json()) as { 'auth-token'?: string })['auth-token']
        : undefined;
      if (!token) return null;
      client = new XapiClient({
        endpoint,
        auth: `Basic ${token}`,
        actor,
        registration,
        activityId,
        courseTitle: course.title,
        lang: course.lang,
      });
      const raw = await client.getState('LMS.LaunchData');
      try {
        launch = raw ? (JSON.parse(raw) as LaunchData) : {};
      } catch {
        launch = {};
      }
      client.statement('initialized', { context: context([CMI5_CATEGORY]) });
      return decodeState(await client.getState(RESUME_STATE));
    },
    exitUrl: () => launch.returnURL ?? null,
    save(state: ResumeState) {
      client?.putState(RESUME_STATE, encodeState(state));
    },
    experienced(nodeId, title) {
      client?.statement('experienced', {
        object: {
          objectType: 'Activity',
          id: `${activityId}/${encodeURIComponent(nodeId)}`,
          definition: { name: { [course.lang]: title } },
        },
        context: context(),
      });
    },
    interaction(record: InteractionRecord) {
      if (!client) return;
      client.statement('answered', {
        object: client.questionObject(record),
        result: client.answeredResult(record),
        context: context(),
      });
    },
    complete(result: CompletionResult) {
      if (!client || !normal() || reported || !result.completed) return;
      reported = true;
      const duration = isoDuration(Date.now() - startedAt);
      if (result.score !== undefined && result.passed !== undefined) {
        const passed =
          launch.masteryScore !== undefined ? result.score >= launch.masteryScore : result.passed;
        const ctx = context([CMI5_CATEGORY, MOVEON_CATEGORY]);
        if (launch.masteryScore !== undefined)
          ctx['extensions'] = {
            ...(ctx['extensions'] ?? {}),
            [MASTERY_EXTENSION]: launch.masteryScore,
          };
        client.statement(passed ? 'passed' : 'failed', {
          result: { success: passed, score: { scaled: result.score }, duration },
          context: ctx,
        });
      }
      client.statement('completed', {
        result: { completion: true, duration },
        context: context([CMI5_CATEGORY, MOVEON_CATEGORY]),
      });
    },
    finish() {
      if (!client || finished) return;
      finished = true;
      client.statement(
        'terminated',
        { result: { duration: isoDuration(Date.now() - startedAt) }, context: context([CMI5_CATEGORY]) },
        true,
      );
    },
  };
}
