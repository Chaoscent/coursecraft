// SPDX-License-Identifier: Apache-2.0
import { gradingQueueSchema, okSchema } from '@lernwerk/shared';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Button } from '../components/Button.js';
import { DataTable } from '../components/DataTable.js';
import { Notice } from '../components/Notice.js';
import { Page } from '../components/Page.js';
import { errorMessage } from '../lib/errors.js';
import { formatDateTime } from '../lib/format.js';
import { useApi } from '../lib/useApi.js';
import styles from './AdminPages.module.css';

/** Free-text answers waiting for a trainer's score. */
export function GradingPage() {
  const { t } = useTranslation();
  const fetcher = useCallback(() => api(gradingQueueSchema, '/api/grading').then((r) => r.items), []);
  const { data, error, reload } = useApi(fetcher);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const rows = (data ?? []).map((r) => ({ ...r, id: `${r.registrationId}|${r.questionId}` }));

  const save = (row: (typeof rows)[number]) => {
    const score = Number((scores[row.id] ?? '').replace(',', '.'));
    if (!Number.isFinite(score)) return;
    void api(okSchema, '/api/grading', {
      method: 'POST',
      body: { registrationId: row.registrationId, questionId: row.questionId, score },
    })
      .then(() => {
        setSaveError(null);
        reload();
      })
      .catch((e: unknown) => setSaveError(errorMessage(e)));
  };

  return (
    <Page title={t('grading.title')} meta={t('grading.count', { count: rows.length })}>
      <div className={styles.stack}>
        {error || saveError ? <Notice tone="danger">{saveError ?? error}</Notice> : <span />}
        <DataTable
          label={t('grading.title')}
          rows={rows}
          empty={t('grading.empty')}
          columns={[
            { id: 'learner', label: t('grading.learner'), isRowHeader: true, render: (r) => r.learnerName },
            { id: 'course', label: t('grading.course'), render: (r) => r.itemTitle },
            { id: 'question', label: t('grading.question'), render: (r) => r.description || r.questionId },
            { id: 'answer', label: t('grading.answer'), render: (r) => r.response },
            { id: 'date', label: t('grading.answered'), render: (r) => formatDateTime(r.answeredAt) },
            {
              id: 'score',
              label: t('grading.score'),
              render: (r) => (
                <span className={styles.gradeCell}>
                  <input
                    className={styles.gradeInput}
                    inputMode="decimal"
                    aria-label={t('grading.scoreFor', { name: r.learnerName })}
                    value={scores[r.id] ?? ''}
                    onChange={(e) => setScores({ ...scores, [r.id]: e.target.value })}
                  />
                  {r.scoreMax !== null ? <span className={styles.muted}>/ {r.scoreMax}</span> : null}
                  <Button onPress={() => save(r)} isDisabled={!scores[r.id]}>
                    {t('grading.save')}
                  </Button>
                </span>
              ),
            },
          ]}
        />
      </div>
    </Page>
  );
}
