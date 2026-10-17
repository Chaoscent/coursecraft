// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { fromScorm, fromStatement, learningStatus, parseIsoDuration, parseScormTime } from './projection.js';

describe('projection', () => {
  it('parses durations', () => {
    expect(parseIsoDuration('PT1H2M3.5S')).toBe(3_723_500);
    expect(parseIsoDuration('P1DT1S')).toBe(86_401_000);
    expect(parseIsoDuration('nonsense')).toBe(0);
    expect(parseScormTime('0001:30:00.5')).toBe(5_400_500);
    expect(parseScormTime('1:00')).toBe(0);
  });

  it('maps SCORM 1.2 status, score and mastery', () => {
    const cmi = {
      core: { lesson_status: 'completed', score: { raw: '75', min: '', max: '' }, session_time: '00:01:00' },
    };
    expect(fromScorm('scorm12', cmi, { masteryScore: 0.8, finished: true }).outcome).toEqual({
      completion: 'completed',
      success: 'failed',
      scoreScaled: 0.75,
      addTimeMs: 60_000,
    });
    expect(
      fromScorm('scorm12', { core: { lesson_status: 'browsed' } }, { masteryScore: null, finished: false })
        .outcome,
    ).toEqual({
      completion: 'incomplete',
    });
  });

  it('maps SCORM 2004 data and interactions', () => {
    const { outcome, responses } = fromScorm(
      'scorm2004',
      {
        completion_status: 'completed',
        success_status: 'passed',
        score: { scaled: '0.9' },
        interactions: {
          0: { id: 'q', type: 'choice', learner_response: 'a', result: 'incorrect', description: 'Frage' },
        },
      },
      { masteryScore: null, finished: false },
    );
    expect(outcome).toEqual({ completion: 'completed', success: 'passed', scoreScaled: 0.9 });
    expect(responses[0]).toMatchObject({ questionId: 'q', success: false, description: 'Frage' });
  });

  it('maps xAPI statements', () => {
    const verb = (v: string) => ({ id: `http://adlnet.gov/expapi/verbs/${v}` });
    expect(
      fromStatement({ verb: verb('passed'), object: {}, result: { score: { scaled: 2 } } }).outcome,
    ).toEqual({
      success: 'passed',
      scoreScaled: 1,
    });
    expect(
      fromStatement({ verb: verb('terminated'), object: {}, result: { duration: 'PT10S' } }).outcome,
    ).toEqual({ addTimeMs: 10_000 });
    const answered = fromStatement({
      verb: verb('answered'),
      object: { id: 'q1', definition: { interactionType: 'long-fill-in' } },
      result: { response: 'Text' },
    });
    expect(answered.response).toMatchObject({ questionId: 'q1', needsManualGrading: true, success: null });
    expect(learningStatus(undefined)).toBe('not_started');
    expect(learningStatus({ completion: 'completed', success: 'unknown' })).toBe('completed');
  });
});
