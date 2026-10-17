// SPDX-License-Identifier: Apache-2.0
import type { Question, QuizNode, SurveyNode } from '@coursecraft/course-model';
import {
  describeResponse,
  drawQuestions,
  quizResult,
  scoreQuestion,
  seededRandom,
  type QuestionResult,
  type Response,
} from '@coursecraft/course-model/scoring';
import { localized } from '../render/context.js';
import { h, present } from '../render/dom.js';
import { renderRichText } from '../render/richtext.js';
import type { NodeApi } from '../runtime/player.js';
import type { InteractionRecord } from '../tracking/types.js';
import { renderQuestion, type QuestionView } from './questions.js';

const format = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

function stateText(api: NodeApi, state: QuestionResult['state']): string {
  const s = api.strings;
  return state === 'correct'
    ? s.correct
    : state === 'partial'
      ? s.partial
      : state === 'pending'
        ? s.pending
        : state === 'incorrect'
          ? s.incorrect
          : '';
}

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

interface Answer {
  question: Question;
  response: Response;
  result: QuestionResult;
}

export function renderQuiz(
  quiz: QuizNode,
  api: NodeApi,
  track: (record: InteractionRecord) => void,
): HTMLElement {
  const { ctx, strings: s } = api;
  const root = h('section', { class: 'cc-quiz', attrs: { 'aria-label': localized(ctx, quiz.title) ?? '' } });
  let attempt = 0;
  let timer: number | undefined;
  let deadline = 0;

  const stopTimer = () => window.clearInterval(timer);

  const intro = () => {
    stopTimer();
    const facts = h('dl', { class: 'cc-quiz-facts' });
    const questions = quiz.items.reduce((n, item) => n + (item.type === 'question' ? 1 : item.draw), 0);
    const add = (term: string, value: string) =>
      facts.append(h('dt', { text: term }), h('dd', { text: value }));
    add(s.questions, String(questions));
    add(s.passingScore, `${quiz.settings.passingPercent} %`);
    if (quiz.settings.timeLimitSec) add(s.timeLimit, clock(quiz.settings.timeLimitSec * 1000));
    if (quiz.settings.attemptsAllowed) add(s.attempts, `${attempt} / ${quiz.settings.attemptsAllowed}`);
    const start = h('button', {
      class: 'cc-button cc-button-primary',
      attrs: { type: 'button' },
      text: s.startQuiz,
    });
    start.addEventListener('click', () => run());
    root.replaceChildren(
      ...present(
        h('h2', { class: 'cc-quiz-title', text: localized(ctx, quiz.title) ?? '' }),
        quiz.intro
          ? h('div', { class: 'cc-quiz-intro' }, [renderRichText(localized(ctx, quiz.intro), ctx)])
          : null,
        facts,
        h('div', { class: 'cc-quiz-actions' }, [start]),
      ),
    );
    start.focus();
  };

  const run = () => {
    attempt += 1;
    const random = seededRandom(Date.now() + attempt);
    const questions = drawQuestions(quiz, random);
    const answers: Answer[] = [];
    let index = 0;

    if (quiz.settings.timeLimitSec) {
      deadline = Date.now() + quiz.settings.timeLimitSec * 1000;
      timer = window.setInterval(() => {
        const left = deadline - Date.now();
        const label = root.querySelector('.cc-quiz-timer');
        if (label) label.textContent = `${s.timeLeft}: ${clock(left)}`;
        if (left <= 0) {
          stopTimer();
          // Unanswered questions count as wrong.
          for (const q of questions.slice(answers.length)) {
            const response = view?.response() ?? { type: 'essay', text: '' };
            answers.push({
              question: q,
              response,
              result:
                q === questions[index]
                  ? scoreQuestion(q, response, ctx.lang, ctx.fallbackLang)
                  : {
                      score: 0,
                      max: q.type === 'likert' ? 0 : q.points,
                      state: q.type === 'likert' ? 'ungraded' : 'incorrect',
                    },
            });
          }
          finish(answers, true);
        }
      }, 500);
    }

    let view: QuestionView | null = null;
    const show = () => {
      const question = questions[index];
      if (!question) return finish(answers, false);
      const started = Date.now();
      let tries = 0;
      const maxTries = question.type === 'likert' ? 1 : question.attempts;
      view = renderQuestion(question, ctx, s, random);
      const current = view;
      const feedback = h('div', { class: 'cc-feedback', attrs: { role: 'status', 'aria-live': 'polite' } });
      const submit = h('button', {
        class: 'cc-button cc-button-primary',
        attrs: { type: 'submit' },
        text: s.submit,
      });
      const next = h('button', {
        class: 'cc-button cc-button-primary',
        attrs: { type: 'button' },
        text: s.continue,
      });
      next.hidden = true;
      const form = h('form', { class: 'cc-quiz-form', attrs: { novalidate: '' } }, [
        current.root,
        feedback,
        h('div', { class: 'cc-quiz-actions' }, [submit, next]),
      ]);

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!current.answered() && question.type !== 'sequence') {
          current.root.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
          return;
        }
        tries += 1;
        const response = current.response();
        const result = scoreQuestion(question, response, ctx.lang, ctx.fallbackLang);
        const done =
          result.state === 'correct' ||
          result.state === 'pending' ||
          result.state === 'ungraded' ||
          tries >= maxTries;
        feedback.replaceChildren(h('strong', { text: stateText(api, result.state) }));
        feedback.className = `cc-feedback cc-feedback-${result.state}`;
        const custom =
          'feedback' in question
            ? question.feedback[
                result.state === 'correct' ? 'correct' : result.state === 'partial' ? 'partial' : 'incorrect'
              ]
            : undefined;
        if (custom && result.state !== 'pending')
          feedback.append(h('div', {}, [renderRichText(localized(ctx, custom), ctx)]));
        if (
          (question.type === 'singleChoice' || question.type === 'multipleChoice') &&
          response.type === question.type
        ) {
          const chosen = response.type === 'singleChoice' ? [response.choiceId] : response.choiceIds;
          for (const choice of question.choices) {
            if (chosen.includes(choice.id) && choice.feedback)
              feedback.append(h('div', {}, [renderRichText(localized(ctx, choice.feedback), ctx)]));
          }
        }
        if (!done) {
          submit.textContent = s.tryAgain;
          return;
        }
        current.disable();
        submit.hidden = true;
        next.hidden = false;
        next.disabled = false;
        next.focus();
        answers.push({ question, response, result });
        track({
          id: question.id,
          questionType: question.type,
          description:
            localized(ctx, question.prompt)
              ?.content.map((b) =>
                'content' in b && Array.isArray(b.content)
                  ? b.content.map((n) => ('text' in n ? n.text : '')).join('')
                  : '',
              )
              .join(' ') ?? '',
          response: describeResponse(response),
          result: result.state === 'ungraded' ? 'neutral' : result.state,
          ...(result.max ? { score: { raw: result.score, max: result.max } } : {}),
          latencyMs: Date.now() - started,
          parentId: quiz.id,
          data: response,
        });
        next.onclick = () => {
          const branch = 'branching' in question ? question.branching : undefined;
          const target = result.state === 'correct' ? branch?.onCorrect : branch?.onIncorrect;
          if (target?.type === 'finish') return finish(answers, false);
          if (target?.type === 'node') {
            finish(answers, false, false);
            return api.goTo(target.nodeId);
          }
          index += 1;
          show();
        };
      });

      root.replaceChildren(
        ...present(
          h('div', { class: 'cc-quiz-head' }, [
            h('span', { text: format(s.questionOf, { n: index + 1, total: questions.length }) }),
            quiz.settings.timeLimitSec
              ? h('span', {
                  class: 'cc-quiz-timer',
                  attrs: { role: 'timer' },
                  text: `${s.timeLeft}: ${clock(deadline - Date.now())}`,
                })
              : null,
          ]),
          form,
        ),
      );
      current.root.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    };
    show();
  };

  const finish = (answers: Answer[], timedOut: boolean, showResult = true) => {
    stopTimer();
    const result = quizResult(
      quiz,
      answers.map((a) => a.result),
    );
    api.reportScore(quiz.id, { scaled: result.scaled, passed: result.passed });
    api.markViewed();
    api.allowNext();
    if (!showResult) return;
    const percent = Math.round(result.scaled * 100);
    const canRetry =
      !result.passed && (!quiz.settings.attemptsAllowed || attempt < quiz.settings.attemptsAllowed);
    const review = h('button', { class: 'cc-button', attrs: { type: 'button' }, text: s.review });
    const retry = h('button', { class: 'cc-button', attrs: { type: 'button' }, text: s.retryQuiz });
    const next = h('button', {
      class: 'cc-button cc-button-primary',
      attrs: { type: 'button' },
      text: s.continueCourse,
    });
    review.hidden = !quiz.settings.allowReview;
    retry.hidden = !canRetry;
    next.addEventListener('click', () => api.next());
    retry.addEventListener('click', () => intro());
    review.addEventListener('click', () => {
      const list = h('ol', { class: 'cc-review' });
      for (const answer of answers) {
        const view = renderQuestion(answer.question, ctx, s, seededRandom(1));
        view.disable();
        view.reveal();
        list.append(
          h('li', {}, [
            view.root,
            h('p', {
              class: `cc-feedback cc-feedback-${answer.result.state}`,
              text: `${stateText(api, answer.result.state)} ${s.yourAnswer}: ${describeResponse(answer.response) || '–'}`,
            }),
          ]),
        );
      }
      root.append(list);
      review.hidden = true;
    });
    root.replaceChildren(
      ...present(
        h('h2', { class: 'cc-quiz-title', text: s.resultTitle }),
        timedOut ? h('p', { class: 'cc-feedback cc-feedback-incorrect', text: s.timeUp }) : null,
        quiz.settings.showResults
          ? h('p', { class: 'cc-quiz-score' }, [
              h('span', { text: `${s.yourScore}: ` }),
              h('strong', { text: `${percent} %` }),
            ])
          : null,
        h('p', {
          class: `cc-feedback ${result.passed ? 'cc-feedback-correct' : 'cc-feedback-incorrect'}`,
          attrs: { role: 'status' },
          text: result.pending ? s.pending : result.passed ? s.passed : s.failed,
        }),
        h('div', { class: 'cc-quiz-actions' }, [review, retry, next]),
      ),
    );
    next.focus();
  };

  intro();
  return root;
}

export function renderSurvey(
  survey: SurveyNode,
  api: NodeApi,
  track: (record: InteractionRecord) => void,
): HTMLElement {
  const { ctx, strings: s } = api;
  const random = seededRandom(7);
  const views = survey.questions.map((sq) => {
    if (sq.type === 'likert') return { sq, view: renderQuestion(sq, ctx, s, random) };
    if (sq.type === 'choice') {
      const question: Question = {
        id: sq.id,
        type: sq.multiple ? 'multipleChoice' : 'singleChoice',
        prompt: sq.prompt,
        choices: sq.options.map((o) => ({ id: o.id, text: o.text, correct: false })),
        shuffle: false,
        points: 0,
        attempts: 1,
        scoring: 'allOrNothing',
        feedback: {},
      };
      return { sq, view: renderQuestion(question, ctx, s, random) };
    }
    const question = {
      id: sq.id,
      type: 'essay',
      prompt: sq.prompt,
      maxLength: sq.maxLength,
      points: 0,
      attempts: 1,
      scoring: 'allOrNothing',
      feedback: {},
    } as Question;
    const view = renderQuestion(question, ctx, s, random);
    if (!sq.multiline) view.root.querySelector('textarea')?.setAttribute('rows', '2');
    return { sq, view };
  });
  const submit = h('button', {
    class: 'cc-button cc-button-primary',
    attrs: { type: 'submit' },
    text: s.surveySubmit,
  });
  const form = h('form', { class: 'cc-quiz-form' }, [
    ...views.map((v) => v.view.root),
    h('div', { class: 'cc-quiz-actions' }, [submit]),
  ]);
  const root = h(
    'section',
    { class: 'cc-quiz cc-survey', attrs: { 'aria-label': localized(ctx, survey.title) ?? '' } },
    [
      h('h2', { class: 'cc-quiz-title', text: localized(ctx, survey.title) ?? '' }),
      survey.intro
        ? h('div', { class: 'cc-quiz-intro' }, [renderRichText(localized(ctx, survey.intro), ctx)])
        : null,
      form,
    ],
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const { sq, view } of views) {
      if (!view.answered()) continue;
      track({
        id: sq.id,
        questionType: sq.type === 'text' ? 'essay' : sq.type === 'choice' ? 'singleChoice' : 'likert',
        description: '',
        response: describeResponse(view.response()),
        result: 'neutral',
        latencyMs: 0,
        parentId: survey.id,
      });
    }
    api.markViewed();
    api.allowNext();
    const next = h('button', {
      class: 'cc-button cc-button-primary',
      attrs: { type: 'button' },
      text: s.continueCourse,
    });
    next.addEventListener('click', () => api.next());
    form.replaceWith(
      h('p', { class: 'cc-feedback cc-feedback-correct', attrs: { role: 'status' }, text: s.surveyThanks }),
      h('div', { class: 'cc-quiz-actions' }, [next]),
    );
    next.focus();
  });
  return root;
}
