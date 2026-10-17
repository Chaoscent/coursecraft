// SPDX-License-Identifier: Apache-2.0
import { useTranslation } from 'react-i18next';
import { insertNode, uploadFile } from './actions.js';
import { useEditor, useEditorStore } from './context.js';
import { newDialog } from './dialogModel.js';
import { newInteraction } from './interactionModel.js';
import { newQuestion, newQuiz, newSurvey } from './quizModel.js';

const IMAGES = 'image/png,image/jpeg,image/webp,image/svg+xml';

/** Inserts a new learning node (quiz, survey, interaction, dialog) after the current one. */
export function useInsertNodes() {
  const { t } = useTranslation();
  const store = useEditorStore();
  const lang = useEditor((s) => s.lang);
  const readOnly = useEditor((s) => s.readOnly);
  return {
    disabled: readOnly,
    quiz: () =>
      insertNode(
        store,
        newQuiz(
          lang,
          t('quiz.newQuizTitle'),
          newQuestion('singleChoice', lang, {
            prompt: t('quiz.newPrompt'),
            option: t('quiz.option'),
            blankText: t('quiz.newBlankText'),
          }),
        ),
      ),
    survey: () => insertNode(store, newSurvey(lang, t('quiz.newSurveyTitle'), t('quiz.newPrompt'))),
    interaction: () =>
      insertNode(
        store,
        newInteraction(lang, {
          title: t('interaction.newTitle'),
          entry: t('interaction.entry'),
          body: t('interaction.newBody'),
        }),
      ),
    /** A dialog needs a portrait for its first character: the author picks one. */
    dialog: () =>
      void uploadFile(store, IMAGES).then(
        (sha) =>
          sha &&
          insertNode(
            store,
            newDialog(
              lang,
              {
                title: t('dialog.newTitle'),
                character: t('dialog.character'),
                altText: '',
                speech: t('dialog.newSpeech'),
                good: t('dialog.goodResponse'),
                bad: t('dialog.badResponse'),
                passed: t('dialog.passedTitle'),
                failed: t('dialog.failedTitle'),
              },
              sha,
            ),
          ),
      ),
  };
}
