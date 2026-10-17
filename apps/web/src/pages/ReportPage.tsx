// SPDX-License-Identifier: Apache-2.0
import { itemReportSchema } from '@lernwerk/shared';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { api, download } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { ToolButton } from '../components/Button.js';
import { DataTable } from '../components/DataTable.js';
import { Notice } from '../components/Notice.js';
import { Page } from '../components/Page.js';
import { formatDateTime } from '../lib/format.js';
import { useApi } from '../lib/useApi.js';
import { STATUS_TONE } from './HomePage.js';
import styles from './AdminPages.module.css';

const percent = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)} %`);
const minutes = (ms: number) => `${Math.round(ms / 60_000)} min`;

/** Learners of one library item: status, score, time, due dates; question statistics. */
export function ReportPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const fetcher = useCallback(() => api(itemReportSchema, `/api/reports/items/${id}`), [id]);
  const { data, error } = useApi(fetcher);
  const rows = (data?.rows ?? []).map((r) => ({ ...r, id: r.userId }));
  const questions = (data?.questions ?? []).map((q) => ({ ...q, id: q.questionId }));

  return (
    <Page
      title={data ? t('report.title', { title: data.item.title }) : t('report.loading')}
      meta={t('report.learners', { count: rows.length })}
      toolbar={
        <ToolButton
          icon="download"
          isDisabled={!data}
          onPress={() => void download(`/api/reports/items/${id}/csv`, 'report.csv')}
        >
          {t('report.csv')}
        </ToolButton>
      }
    >
      <div className={styles.reportGrid}>
        {error ? <Notice tone="danger">{error}</Notice> : <span />}
        <DataTable
          label={t('report.learnersTable')}
          rows={rows}
          empty={t('report.empty')}
          columns={[
            { id: 'name', label: t('report.name'), isRowHeader: true, render: (r) => r.displayName },
            { id: 'email', label: t('report.email'), render: (r) => r.email },
            {
              id: 'status',
              label: t('report.status'),
              render: (r) => <Badge tone={STATUS_TONE[r.status]}>{t(`learning.status.${r.status}`)}</Badge>,
            },
            { id: 'score', label: t('report.score'), numeric: true, render: (r) => percent(r.scoreScaled) },
            { id: 'attempts', label: t('report.attempts'), numeric: true, render: (r) => r.attempts },
            { id: 'time', label: t('report.time'), numeric: true, render: (r) => minutes(r.timeSpentMs) },
            {
              id: 'due',
              label: t('report.due'),
              numeric: true,
              render: (r) => (
                <span className={r.overdue ? styles.overdue : ''}>{formatDateTime(r.dueAt)}</span>
              ),
            },
            {
              id: 'completed',
              label: t('report.completed'),
              numeric: true,
              render: (r) => formatDateTime(r.completedAt),
            },
          ]}
        />
        <h2 className={styles.sectionTitle}>{t('report.questions')}</h2>
        <DataTable
          label={t('report.questions')}
          rows={questions}
          empty={t('report.noQuestions')}
          columns={[
            {
              id: 'q',
              label: t('report.question'),
              isRowHeader: true,
              render: (q) => q.description || q.questionId,
            },
            { id: 'type', label: t('report.type'), render: (q) => q.interactionType },
            { id: 'answers', label: t('report.answers'), numeric: true, render: (q) => q.answers },
            {
              id: 'correct',
              label: t('report.correctRate'),
              numeric: true,
              render: (q) => (q.answers ? `${Math.round((q.correct / q.answers) * 100)} %` : '–'),
            },
            { id: 'pending', label: t('report.pending'), numeric: true, render: (q) => q.pendingGrading },
          ]}
        />
      </div>
    </Page>
  );
}
